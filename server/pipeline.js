import path from 'node:path';
import fs from 'node:fs';
import { SPEAKER_COLORS } from '../shared/catalog.js';
import { askClaudeForJson, buildSeriesPrompt, buildEpisodePrompt } from './claudegen.js';
import { generateImage, currentProvider } from './images.js';
import { assignVoices, synthesize, voiceFor } from './tts.js';
import {
  newId,
  createProjectDirs,
  saveProject,
  assetsDir,
  findEpisode,
} from './projects.js';
import { LINE_START_DELAY, LINE_GAP } from '../src/remotion/timing.js';

const KEN_BURNS_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left', 'zoom-in', 'pan-up'];

const MIN_SCENE_SEC = 3.5;
const MAX_SCENE_SEC = 16;

function normalizeEpisode(raw, number) {
  const scenes = (raw.scenes || []).slice(0, 12).map((s, i) => {
    const lines = (s.lines || [])
      .filter((l) => l && l.text)
      .slice(0, 3)
      .map((l) => ({
        speaker: l.speaker || 'narrator',
        text: String(l.text).trim(),
        audio: null,
        audioDurationSec: null,
      }));
    // Personnages visibles : fournis par Claude, sinon déduits des répliques.
    const characters = Array.isArray(s.characters)
      ? s.characters.filter((c) => typeof c === 'string')
      : [...new Set(lines.map((l) => l.speaker).filter((sp) => sp !== 'narrator'))];
    return {
      id: `s${i + 1}`,
      lines,
      characters,
      imagePrompt: String(s.imagePrompt || '').trim(),
      image: null,
      kenBurns: KEN_BURNS_CYCLE[i % KEN_BURNS_CYCLE.length],
      durationSec: 6,
      version: 0,
    };
  });
  return {
    number,
    title: raw.title || `Épisode ${number}`,
    scenes,
    cliffhanger: raw.cliffhanger || '',
    status: 'script',
    renderedFile: null,
  };
}

function recomputeSceneDuration(scene) {
  const spoken = (scene.lines || []).reduce(
    (sum, l) => sum + (l.audioDurationSec || 2) + LINE_GAP,
    0,
  );
  scene.durationSec = Math.min(
    MAX_SCENE_SEC,
    Math.max(MIN_SCENE_SEC, LINE_START_DELAY + spoken + 0.9),
  );
}

// Références de visages : URLs des portraits des personnages visibles dans la scène.
function sceneReferenceUrls(project, scene) {
  return (scene.characters || [])
    .map((id) => (project.characters || []).find((c) => c.id === id))
    .filter((c) => c && c.portraitUrl)
    .map((c) => c.portraitUrl);
}

// Avec OpenArt : crée d'abord un portrait de référence par personnage,
// réutilisé ensuite dans toutes les scènes pour garder les mêmes visages.
export async function ensureCharacterPortraits(project, update) {
  if (currentProvider() !== 'openart') {
    return;
  }
  const dir = assetsDir(project.id);
  const chars = project.characters || [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c.portrait && c.portraitUrl) {
      continue;
    }
    update(`Portrait de référence ${i + 1}/${chars.length} — ${c.name}…`, i / chars.length);
    c.portraitVersion = (c.portraitVersion || 0) + 1;
    const file = `char_${c.id}_v${c.portraitVersion}.jpg`;
    const prompt =
      `Character reference portrait, waist-up, facing camera, neutral expression, ` +
      `plain warm background, soft natural light: ${c.visual}. ` +
      `Photorealistic, cinematic film still, 9:16 vertical.`;
    const { ok, url } = await generateImage(prompt, path.join(dir, file), {});
    if (ok) {
      c.portrait = file;
      c.portraitUrl = url;
    }
    saveProject(project);
  }
}

async function generateEpisodeAssets(project, episode, update) {
  const dir = assetsDir(project.id);
  const provider = currentProvider();
  const scenes = episode.scenes || [];

  // 0. Portraits de référence (OpenArt uniquement) — la clé des visages constants.
  await ensureCharacterPortraits(project, update);

  // 1. Images
  if (provider !== 'manual') {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (scene.image) {
        continue;
      }
      update(`Épisode ${episode.number} — image ${i + 1}/${scenes.length}…`, i / scenes.length);
      const file = `e${episode.number}_${scene.id}_v${scene.version}.jpg`;
      try {
        const { ok } = await generateImage(scene.imagePrompt, path.join(dir, file), {
          referenceUrls: sceneReferenceUrls(project, scene),
        });
        if (ok) {
          scene.image = file;
        }
      } catch (e) {
        console.error(`Image scène ${scene.id} :`, e.message);
        scene.imageError = e.message;
      }
      saveProject(project);
    }
  }

  // 2. Voix
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    update(`Épisode ${episode.number} — voix ${i + 1}/${scenes.length}…`, i / scenes.length);
    for (let j = 0; j < scene.lines.length; j++) {
      const line = scene.lines[j];
      if (line.audio) {
        continue;
      }
      const file = `e${episode.number}_${scene.id}_l${j}_v${scene.version}.mp3`;
      try {
        line.audioDurationSec = await synthesize(
          line.text,
          voiceFor(project, line.speaker),
          path.join(dir, file),
        );
        line.audio = file;
      } catch (e) {
        console.error(`Voix scène ${scene.id} ligne ${j} :`, e.message);
        line.audioError = e.message;
        line.audioDurationSec = Math.max(1.5, line.text.split(/\s+/).length * 0.42);
      }
    }
    recomputeSceneDuration(scene);
    saveProject(project);
  }

  episode.status = 'ready';
  saveProject(project);
}

export async function createProject({ styles, theme }, update) {
  update('Écriture du scénario par Claude (1 à 3 minutes)…');
  const data = await askClaudeForJson(buildSeriesPrompt(styles, theme));

  const id = newId();
  createProjectDirs(id);

  const characters = assignVoices(
    (data.characters || []).map((c, i) => ({
      id: c.id || `perso${i + 1}`,
      name: c.name || `Personnage ${i + 1}`,
      gender: c.gender || 'homme',
      age: c.age || 30,
      role: c.role || '',
      visual: c.visual || '',
      color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
    })),
  );

  const project = {
    id,
    title: data.title || 'Drama sans titre',
    logline: data.logline || '',
    setting: data.setting || '',
    styles,
    theme: theme || '',
    characters,
    episodeSummaries: (data.episodeSummaries || []).map((s, i) => ({
      number: s.number || i + 1,
      title: s.title || `Épisode ${i + 1}`,
      summary: s.summary || '',
    })),
    musicFile: null,
    episodes: [],
    createdAt: new Date().toISOString(),
  };

  const ep1raw = data.episode1 || (Array.isArray(data.episodes) ? data.episodes[0] : null);
  if (!ep1raw) {
    throw new Error("Claude n'a pas fourni l'épisode 1.");
  }
  project.episodes.push(normalizeEpisode(ep1raw, 1));
  saveProject(project);

  await generateEpisodeAssets(project, project.episodes[0], update);
  return { projectId: id };
}

export async function produceEpisode(project, number, update) {
  let episode = findEpisode(project, number);
  if (!episode) {
    update(`Écriture du scénario de l'épisode ${number} par Claude…`);
    const raw = await askClaudeForJson(buildEpisodePrompt(project, number));
    episode = normalizeEpisode(raw, number);
    project.episodes.push(episode);
    project.episodes.sort((a, b) => a.number - b.number);
    saveProject(project);
  }
  await generateEpisodeAssets(project, episode, update);
  return { number };
}

export async function regenerateAllImages(project, episode, update) {
  const dir = assetsDir(project.id);
  const scenes = episode.scenes || [];
  const failures = [];
  await ensureCharacterPortraits(project, update);
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    update(`Image ${i + 1}/${scenes.length}…`, i / scenes.length);
    scene.version += 1;
    const file = `e${episode.number}_${scene.id}_v${scene.version}.jpg`;
    try {
      const { ok } = await generateImage(scene.imagePrompt, path.join(dir, file), {
        referenceUrls: sceneReferenceUrls(project, scene),
      });
      if (ok) {
        scene.image = file;
        delete scene.imageError;
      }
    } catch (e) {
      scene.imageError = e.message;
      failures.push(`scène ${i + 1}`);
    }
    saveProject(project);
  }
  if (failures.length > 0) {
    throw new Error(`Images en échec : ${failures.join(', ')}. Les autres ont été régénérées.`);
  }
}

export async function regenerateSceneImage(project, episode, scene, update) {
  update('Génération de la nouvelle image…');
  await ensureCharacterPortraits(project, update);
  scene.version += 1;
  const file = `e${episode.number}_${scene.id}_v${scene.version}.jpg`;
  const { ok } = await generateImage(scene.imagePrompt, path.join(assetsDir(project.id), file), {
    referenceUrls: sceneReferenceUrls(project, scene),
  });
  if (ok) {
    scene.image = file;
    delete scene.imageError;
  }
  saveProject(project);
}

// Refait le portrait de référence d'un personnage (les scènes suivantes l'utiliseront).
export async function regenerateCharacterPortrait(project, characterId, update) {
  const c = (project.characters || []).find((x) => x.id === characterId);
  if (!c) {
    throw new Error('Personnage introuvable');
  }
  c.portrait = null;
  c.portraitUrl = null;
  const before = currentProvider();
  if (before !== 'openart') {
    throw new Error("Les portraits de référence nécessitent IMAGE_PROVIDER=openart dans .env");
  }
  await ensureCharacterPortraits(project, update);
  if (!c.portrait) {
    throw new Error('Le portrait n\'a pas pu être généré.');
  }
}

export async function regenerateSceneAudio(project, episode, scene, update) {
  scene.version += 1;
  for (let j = 0; j < scene.lines.length; j++) {
    const line = scene.lines[j];
    update(`Voix ${j + 1}/${scene.lines.length}…`);
    const file = `e${episode.number}_${scene.id}_l${j}_v${scene.version}.mp3`;
    line.audioDurationSec = await synthesize(
      line.text,
      voiceFor(project, line.speaker),
      path.join(assetsDir(project.id), file),
    );
    line.audio = file;
    delete line.audioError;
  }
  recomputeSceneDuration(scene);
  saveProject(project);
}

export function saveUploadedImage(project, episode, scene, base64Data) {
  const m = base64Data.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!m) {
    throw new Error('Format attendu : data URL image/png, image/jpeg ou image/webp.');
  }
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  scene.version += 1;
  const file = `e${episode.number}_${scene.id}_v${scene.version}.${ext}`;
  fs.writeFileSync(path.join(assetsDir(project.id), file), Buffer.from(m[2], 'base64'));
  scene.image = file;
  delete scene.imageError;
  saveProject(project);
  return file;
}

export function saveUploadedMusic(project, base64Data) {
  const m = base64Data.match(/^data:audio\/(mpeg|mp3|wav|x-wav|m4a|mp4|aac);base64,(.+)$/);
  if (!m) {
    throw new Error('Format attendu : fichier audio MP3, WAV ou M4A.');
  }
  const ext = m[1].includes('wav') ? 'wav' : m[1] === 'm4a' || m[1] === 'mp4' || m[1] === 'aac' ? 'm4a' : 'mp3';
  const file = `music_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(assetsDir(project.id), file), Buffer.from(m[2], 'base64'));
  project.musicFile = file;
  saveProject(project);
  return file;
}
