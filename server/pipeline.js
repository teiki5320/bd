import path from 'node:path';
import fs from 'node:fs';
import { SPEAKER_COLORS, EPISODE_COUNT, videoSceneIndexes } from '../shared/catalog.js';
import { VIDEO_SCENES } from './config.js';
import { openartGenerateVideo } from './openart.js';
import { buildSceneVoiceTrack, lipsyncVideo } from './lipsync.js';
import { renderEpisode } from './render.js';
import {
  askClaudeForJson,
  buildSeriesPrompt,
  buildCustomSeriesPrompt,
  buildEpisodePrompt,
  buildNewFacePrompt,
  drawVariety,
} from './claudegen.js';
import { generateImage, currentProvider } from './images.js';
import { assignVoices, synthesize, voiceFor, isCatalogVoice } from './tts.js';
import {
  newId,
  createProjectDirs,
  saveProject,
  assetsDir,
  findEpisode,
  listProjects,
  loadProject,
} from './projects.js';
import { LINE_START_DELAY, LINE_GAP } from '../src/remotion/timing.js';

const KEN_BURNS_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left', 'zoom-in', 'pan-up'];

// Compteur de consommation du projet (crédits/appels par service).
export function ensureUsage(project) {
  if (!project.usage) {
    project.usage = {
      claudeCalls: 0,
      openartImages: 0,
      openartVideos: 0,
      pollinationsImages: 0,
      falImages: 0,
      elevenClips: 0,
      elevenChars: 0,
      edgeClips: 0,
      sayClips: 0,
      falLipsyncs: 0,
    };
  }
  return project.usage;
}

function countImage(project, provider) {
  const u = ensureUsage(project);
  if (provider === 'openart') u.openartImages += 1;
  else if (provider === 'fal') u.falImages += 1;
  else if (provider === 'pollinations') u.pollinationsImages += 1;
}

function countVideo(project) {
  const u = ensureUsage(project);
  u.openartVideos = (u.openartVideos || 0) + 1;
}

function countVoice(project, result) {
  const u = ensureUsage(project);
  if (result.engine === 'elevenlabs') {
    u.elevenClips += 1;
    u.elevenChars += result.chars;
  } else if (result.engine === 'edge') {
    u.edgeClips += 1;
  } else {
    u.sayClips += 1;
  }
}

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
    const { ok, url, provider } = await generateImage(prompt, path.join(dir, file), {});
    if (ok) {
      c.portrait = file;
      c.portraitUrl = url;
      countImage(project, provider);
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
        const { ok, url, provider } = await generateImage(scene.imagePrompt, path.join(dir, file), {
          referenceUrls: sceneReferenceUrls(project, scene),
        });
        if (ok) {
          scene.image = file;
          scene.imageUrl = url || null;
          countImage(project, provider);
        }
      } catch (e) {
        console.error(`Image scène ${scene.id} :`, e.message);
        scene.imageError = e.message;
      }
      saveProject(project);
    }
  }

  // 2. Voix (Edge TTS, puis voix macOS en secours)
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    update(`Épisode ${episode.number} — voix ${i + 1}/${scenes.length}…`, i / scenes.length);
    for (let j = 0; j < scene.lines.length; j++) {
      const line = scene.lines[j];
      if (line.audio) {
        continue;
      }
      const base = `e${episode.number}_${scene.id}_l${j}_v${scene.version}`;
      try {
        const result = await synthesize({
          text: line.text,
          ...voiceFor(project, line.speaker),
          outBase: path.join(dir, base),
        });
        line.audio = path.basename(result.file);
        line.audioDurationSec = result.durationSec;
        line.audioEngine = result.engine;
        // ElevenLabs attendu mais moteur de secours utilisé (crédits épuisés ?)
        line.audioFallback =
          Boolean(process.env.ELEVENLABS_API_KEY) && result.engine !== 'elevenlabs'
            ? true
            : undefined;
        countVoice(project, result);
        delete line.audioError;
      } catch (e) {
        console.error(`Voix scène ${scene.id} ligne ${j} :`, e.message);
        line.audioError = e.message;
        line.audioDurationSec = Math.max(1.5, line.text.split(/\s+/).length * 0.42);
      }
    }
    recomputeSceneDuration(scene);
    saveProject(project);
  }

  // 3. Clips vidéo (OpenArt) : nombre réglable par drama (3 par défaut),
  // scènes réparties uniformément. Après les voix, pour connaître la durée cible.
  const videoCount = Number.isInteger(project.videoScenes) ? project.videoScenes : undefined;
  if (provider === 'openart' && VIDEO_SCENES && videoCount !== 0) {
    const wanted = videoSceneIndexes(scenes.length, videoCount);
    for (let k = 0; k < wanted.length; k++) {
      const scene = scenes[wanted[k]];
      if (scene.video || scene.videoDisabled || !scene.image) {
        continue;
      }
      update(
        `Épisode ${episode.number} — vidéo ${k + 1}/${wanted.length} (scène ${wanted[k] + 1}, plusieurs minutes)…`,
        k / wanted.length,
      );
      try {
        await generateSceneVideo(project, episode, scene, () => {});
      } catch (e) {
        console.error(`Vidéo scène ${scene.id} :`, e.message);
        scene.videoError = e.message;
        saveProject(project);
      }
      // Version Synchro : lèvres animées sur la voix, dans la foulée du clip.
      if (project.mode === 'synchro' && scene.video && !scene.lipsynced) {
        update(
          `Épisode ${episode.number} — synchro labiale ${k + 1}/${wanted.length} (scène ${wanted[k] + 1})…`,
          k / wanted.length,
        );
        try {
          await lipsyncSceneVideo(project, episode, scene, () => {});
        } catch (e) {
          console.error(`Synchro scène ${scene.id} :`, e.message);
          scene.lipsyncError = e.message;
          saveProject(project);
        }
      }
    }
  }

  episode.status = 'ready';
  saveProject(project);
}

// Prompt de mouvement pour l'image-to-video : on anime l'image existante,
// gestes naturels et caméra discrète, sans changer visages ni décor.
// IMPORTANT : bouches immobiles — la voix off n'est pas synchronisée,
// des lèvres qui bougent au hasard casseraient l'illusion.
function videoMotionPrompt(scene) {
  return (
    `Bring this scene to life with subtle, realistic motion: characters breathe, ` +
    `blink and make small natural gestures; gentle slow cinematic camera push-in. ` +
    `CRITICAL: nobody speaks — mouths stay CLOSED and still, absolutely NO lip ` +
    `movement or talking (the voice-over is added separately and is not lip-synced). ` +
    `Faces, clothing and background stay EXACTLY as in the source image. ` +
    `Scene: ${scene.imagePrompt}`
  );
}

// Génère (ou régénère) le clip vidéo d'une scène via OpenArt.
export async function generateSceneVideo(project, episode, scene, update) {
  if (currentProvider() !== 'openart') {
    throw new Error('Les clips vidéo nécessitent IMAGE_PROVIDER=openart dans .env');
  }
  delete scene.videoDisabled;
  update('Génération du clip vidéo par OpenArt (plusieurs minutes)…');
  const durationSec = Math.max(5, Math.min(10, Math.round(scene.durationSec || 6)));
  const { buffer } = await openartGenerateVideo({
    prompt: videoMotionPrompt(scene),
    imageUrl: scene.imageUrl || null,
    referenceUrls: scene.imageUrl ? [] : sceneReferenceUrls(project, scene),
    durationSec,
  });
  scene.videoVersion = (scene.videoVersion || 0) + 1;
  const file = `e${episode.number}_${scene.id}_vid${scene.videoVersion}.mp4`;
  fs.writeFileSync(path.join(assetsDir(project.id), file), buffer);
  scene.video = file;
  // Nouveau clip = lèvres plus synchronisées (Version Synchro).
  scene.lipsynced = false;
  delete scene.videoError;
  countVideo(project);
  if (episode.status === 'done') {
    episode.status = 'ready';
  }
  saveProject(project);
  return file;
}

// Version Synchro : anime les lèvres du clip sur la piste voix de la scène
// (fal.ai). Le clip synchronisé remplace le clip muet ; la voix ElevenLabs
// d'origine joue par-dessus dans le montage, parfaitement calée.
export async function lipsyncSceneVideo(project, episode, scene, update) {
  if (project.mode !== 'synchro') {
    throw new Error('La synchro labiale est réservée aux dramas « Version Synchro ».');
  }
  if (!scene.video) {
    throw new Error("Génère d'abord le clip vidéo de la scène.");
  }
  const dir = assetsDir(project.id);
  update('Préparation de la piste voix de la scène…');
  const track = path.join(dir, `e${episode.number}_${scene.id}_voicetrack.mp3`);
  await buildSceneVoiceTrack(project, scene, track);
  scene.videoVersion = (scene.videoVersion || 0) + 1;
  const out = `e${episode.number}_${scene.id}_sync${scene.videoVersion}.mp4`;
  await lipsyncVideo({
    videoPath: path.join(dir, scene.video),
    audioPath: track,
    outPath: path.join(dir, out),
    update,
  });
  fs.rmSync(track, { force: true });
  scene.video = out;
  scene.lipsynced = true;
  delete scene.lipsyncError;
  ensureUsage(project).falLipsyncs = (ensureUsage(project).falLipsyncs || 0) + 1;
  if (episode.status === 'done') {
    episode.status = 'ready';
  }
  saveProject(project);
  return out;
}

// Retire le clip vidéo d'une scène : retour à l'image fixe (Ken Burns).
// videoDisabled empêche la production automatique de le régénérer.
export function removeSceneVideo(project, episode, scene) {
  scene.video = null;
  scene.videoDisabled = true;
  delete scene.videoError;
  if (episode.status === 'done') {
    episode.status = 'ready';
  }
  saveProject(project);
}

function mapCharacters(data) {
  return assignVoices(
    (data.characters || []).map((c, i) => ({
      id: c.id || `perso${i + 1}`,
      name: c.name || `Personnage ${i + 1}`,
      gender: c.gender || 'homme',
      age: c.age || 30,
      role: c.role || '',
      visual: c.visual || '',
      // casting vocal proposé par Claude (validé contre le catalogue)
      elevenVoice: isCatalogVoice(c.voice) ? c.voice : undefined,
      color: SPEAKER_COLORS[i % SPEAKER_COLORS.length],
    })),
  );
}

// Prénoms et contextes des dramas existants — interdits pour la prochaine
// série, afin que chaque histoire change vraiment (noms, pays, univers).
function usedNamesAndPlaces() {
  const names = new Set();
  const places = [];
  try {
    for (const summary of listProjects()) {
      const p = loadProject(summary.id);
      if (!p) {
        continue;
      }
      for (const c of p.characters || []) {
        const first = String(c.name || '').trim().split(/\s+/)[0];
        if (first) {
          names.add(first);
        }
      }
      if (p.setting) {
        places.push(`${p.title} : ${String(p.setting).slice(0, 70)}`);
      }
    }
  } catch {
    // la collecte ne doit jamais bloquer une création
  }
  return { names: [...names].slice(0, 40), places: places.slice(0, 10) };
}

export async function createProject({ styles, theme, mode }, update) {
  update('Écriture du scénario par Claude (1 à 3 minutes)…');
  const data = await askClaudeForJson(
    buildSeriesPrompt(styles, theme, drawVariety(), usedNamesAndPlaces()),
  );

  const id = newId();
  createProjectDirs(id);

  const project = {
    id,
    mode: mode === 'synchro' ? 'synchro' : 'normal',
    title: data.title || 'Drama sans titre',
    logline: data.logline || '',
    setting: data.setting || '',
    styles,
    theme: theme || '',
    characters: mapCharacters(data),
    episodeSummaries: (data.episodeSummaries || []).map((s, i) => ({
      number: s.number || i + 1,
      title: s.title || `Épisode ${i + 1}`,
      summary: s.summary || '',
    })),
    musicFile: null,
    episodes: [],
    createdAt: new Date().toISOString(),
  };
  ensureUsage(project).claudeCalls += 1;

  const ep1raw = data.episode1 || (Array.isArray(data.episodes) ? data.episodes[0] : null);
  if (!ep1raw) {
    throw new Error("Claude n'a pas fourni l'épisode 1.");
  }
  project.episodes.push(normalizeEpisode(ep1raw, 1));
  // Parcours par étapes : le scénario doit être validé avant toute production.
  project.stage = 'script_review';
  saveProject(project);
  return { projectId: id };
}

// Mode « mon script » : l'auteur fournit son histoire via le formulaire guidé ;
// Claude la structure fidèlement dans le même format que les séries générées.
export async function createCustomProject(answers, update) {
  update("Mise en forme de ton script par Claude (1 à 3 minutes)…");
  const data = await askClaudeForJson(buildCustomSeriesPrompt(answers));

  const id = newId();
  createProjectDirs(id);

  const project = {
    id,
    mode: answers.mode === 'synchro' ? 'synchro' : 'normal',
    title: answers.title || data.title || 'Drama sans titre',
    logline: data.logline || '',
    setting: answers.setting || data.setting || '',
    styles: answers.styles || [],
    theme: '',
    custom: true,
    // Conservé pour régénérer le scénario et garder les épisodes 2 à 10 fidèles.
    customAnswers: answers,
    source: {
      script: answers.script,
      mustHappen: answers.mustHappen || '',
      fidelity: answers.fidelity || 'fidele',
    },
    characters: mapCharacters(data),
    episodeSummaries: (data.episodeSummaries || []).map((s, i) => ({
      number: s.number || i + 1,
      title: s.title || `Épisode ${i + 1}`,
      summary: s.summary || '',
    })),
    musicFile: null,
    episodes: [],
    createdAt: new Date().toISOString(),
  };
  ensureUsage(project).claudeCalls += 1;

  const ep1raw = data.episode1 || (Array.isArray(data.episodes) ? data.episodes[0] : null);
  if (!ep1raw) {
    throw new Error("Claude n'a pas fourni l'épisode 1.");
  }
  project.episodes.push(normalizeEpisode(ep1raw, 1));
  project.stage = 'script_review';
  saveProject(project);
  return { projectId: id };
}

// Réécrit entièrement la série (mêmes styles/thème — ou même script source
// pour un drama en mode « mon script ») tant que le scénario n'est pas validé.
export async function regenerateScript(project, update) {
  update('Nouvelle écriture du scénario par Claude (1 à 3 minutes)…');
  // Nouveau tirage au sort à chaque régénération : autre pays, autre univers,
  // autres noms (ceux du brouillon actuel sont inclus dans les interdits).
  const data = await askClaudeForJson(
    project.customAnswers
      ? buildCustomSeriesPrompt(project.customAnswers)
      : buildSeriesPrompt(project.styles, project.theme, drawVariety(), usedNamesAndPlaces()),
  );
  ensureUsage(project).claudeCalls += 1;
  project.title = (project.customAnswers && project.customAnswers.title) || data.title || project.title;
  project.logline = data.logline || '';
  project.setting = (project.customAnswers && project.customAnswers.setting) || data.setting || '';
  project.characters = mapCharacters(data);
  project.episodeSummaries = (data.episodeSummaries || []).map((s, i) => ({
    number: s.number || i + 1,
    title: s.title || `Épisode ${i + 1}`,
    summary: s.summary || '',
  }));
  const ep1raw = data.episode1 || (Array.isArray(data.episodes) ? data.episodes[0] : null);
  if (!ep1raw) {
    throw new Error("Claude n'a pas fourni l'épisode 1.");
  }
  project.episodes = [normalizeEpisode(ep1raw, 1)];
  project.stage = 'script_review';
  saveProject(project);
}

// Produit TOUTE la saison : pour chaque épisode restant, scénario + images +
// voix + rendu MP4. Long (souvent > 1 h avec OpenArt) — la progression est
// détaillée épisode par épisode et l'interface peut raccrocher en cours de route.
export async function produceSeason(project, update) {
  let doneCount = 0;
  const failures = [];
  for (let n = 1; n <= EPISODE_COUNT; n++) {
    const existing = findEpisode(project, n);
    if (existing && existing.status === 'done' && existing.renderedFile) {
      doneCount++;
      continue;
    }
    const prefix = `Épisode ${n}/${EPISODE_COUNT} — `;
    try {
      await produceEpisode(project, n, (step, p) =>
        update(prefix + step, (n - 1 + (p || 0) * 0.7) / EPISODE_COUNT),
      );
      const ep = findEpisode(project, n);
      await renderEpisode(project, ep, (step, p) =>
        update(prefix + step, (n - 1 + 0.7 + (p || 0) * 0.3) / EPISODE_COUNT),
      );
      doneCount++;
    } catch (e) {
      console.error(`Saison — épisode ${n} :`, e.message);
      failures.push(`épisode ${n} (${e.message.slice(0, 120)})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${doneCount}/${EPISODE_COUNT} épisodes terminés. En échec : ${failures.join(' ; ')}`,
    );
  }
  return { episodes: doneCount };
}

export async function produceEpisode(project, number, update) {
  let episode = findEpisode(project, number);
  if (!episode) {
    update(`Écriture du scénario de l'épisode ${number} par Claude…`);
    const raw = await askClaudeForJson(buildEpisodePrompt(project, number));
    ensureUsage(project).claudeCalls += 1;
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
      const { ok, url, provider } = await generateImage(scene.imagePrompt, path.join(dir, file), {
        referenceUrls: sceneReferenceUrls(project, scene),
      });
      if (ok) {
        scene.image = file;
        scene.imageUrl = url || null;
        // La vidéo animait l'ancienne image : elle ne correspond plus.
        scene.video = null;
        countImage(project, provider);
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
  const { ok, url, provider } = await generateImage(
    scene.imagePrompt,
    path.join(assetsDir(project.id), file),
    { referenceUrls: sceneReferenceUrls(project, scene) },
  );
  if (ok) {
    scene.image = file;
    scene.imageUrl = url || null;
    scene.video = null;
    countImage(project, provider);
    delete scene.imageError;
  }
  saveProject(project);
}

// « Nouveau visage » : Claude réécrit la description physique (guidée par les
// instructions éventuelles), les prompts d'images existants sont mis à jour,
// puis le portrait de référence est régénéré.
export async function newCharacterFace(project, characterId, instructions, update) {
  const c = (project.characters || []).find((x) => x.id === characterId);
  if (!c) {
    throw new Error('Personnage introuvable');
  }
  update(`Réécriture de ${c.name} par Claude…`);
  const data = await askClaudeForJson(buildNewFacePrompt(c, (instructions || '').slice(0, 300)));
  ensureUsage(project).claudeCalls += 1;
  const newVisual = String(data.visual || '').trim();
  if (!newVisual) {
    throw new Error("Claude n'a pas fourni de nouvelle description.");
  }
  const oldVisual = c.visual;
  c.visual = newVisual;
  // Les prompts de scènes recopient la description mot pour mot → remplacement direct.
  if (oldVisual) {
    for (const ep of project.episodes || []) {
      for (const s of ep.scenes || []) {
        if (s.imagePrompt && s.imagePrompt.includes(oldVisual)) {
          s.imagePrompt = s.imagePrompt.split(oldVisual).join(newVisual);
        }
      }
    }
  }
  c.portrait = null;
  c.portraitUrl = null;
  saveProject(project);
  await ensureCharacterPortraits(project, update);
}

// Extrait audio de pré-écoute d'une voix pour un personnage ou le narrateur
// (réplique réelle si possible).
export async function characterVoicePreview(project, characterId, elevenVoiceOverride) {
  const c = (project.characters || []).find((x) => x.id === characterId);
  if (!c && characterId !== 'narrator') {
    throw new Error('Personnage introuvable');
  }
  let line = null;
  for (const ep of project.episodes || []) {
    for (const s of ep.scenes || []) {
      const found = (s.lines || []).find((l) => l.speaker === characterId);
      if (found) {
        line = found.text;
        break;
      }
    }
    if (line) break;
  }
  const text =
    line ||
    (c ? `Je m'appelle ${c.name}. ${c.role}.` : `${project.title}. L'histoire commence ce soir.`);
  const v = voiceFor(project, characterId);
  const base = path.join(assetsDir(project.id), `preview_${characterId}_${Date.now()}`);
  const result = await synthesize({
    text,
    ...v,
    elevenVoice: elevenVoiceOverride || v.elevenVoice,
    outBase: base,
  });
  countVoice(project, result);
  saveProject(project);
  return path.basename(result.file);
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
    const base = `e${episode.number}_${scene.id}_l${j}_v${scene.version}`;
    const result = await synthesize({
      text: line.text,
      ...voiceFor(project, line.speaker),
      outBase: path.join(assetsDir(project.id), base),
    });
    line.audio = path.basename(result.file);
    line.audioDurationSec = result.durationSec;
    line.audioEngine = result.engine;
    line.audioFallback =
      Boolean(process.env.ELEVENLABS_API_KEY) && result.engine !== 'elevenlabs'
        ? true
        : undefined;
    countVoice(project, result);
    delete line.audioError;
  }
  recomputeSceneDuration(scene);
  // Voix refaites → les lèvres du clip synchronisé ne correspondent plus.
  if (project.mode === 'synchro' && scene.video && scene.lipsynced) {
    scene.lipsynced = false;
  }
  saveProject(project);
}

// Refait toutes les voix de l'épisode (après un changement de méthode ou des échecs).
export async function regenerateAllAudio(project, episode, update) {
  const scenes = episode.scenes || [];
  const failures = [];
  for (let i = 0; i < scenes.length; i++) {
    update(`Voix scène ${i + 1}/${scenes.length}…`, i / scenes.length);
    try {
      await regenerateSceneAudio(project, episode, scenes[i], () => {});
    } catch (e) {
      scenes[i].lines.forEach((l) => {
        if (!l.audio) {
          l.audioError = e.message;
        }
      });
      failures.push(`scène ${i + 1}`);
      saveProject(project);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Voix en échec : ${failures.join(', ')}. Les autres ont été régénérées.`);
  }
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
  // Image importée à la main : pas d'URL distante, et l'ancienne vidéo ne correspond plus.
  scene.imageUrl = null;
  scene.video = null;
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
