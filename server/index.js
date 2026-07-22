import './config.js';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { PORT, DIST_DIR } from './config.js';
import { EPISODE_COUNT, STYLES, MAX_STYLES } from '../shared/catalog.js';
import {
  listProjects,
  loadProject,
  saveProject,
  deleteProject,
  projectDir,
  rendersDir,
  findEpisode,
  findScene,
} from './projects.js';
import { startJob, getJob, activeJobFor } from './jobs.js';
import {
  createProject,
  createCustomProject,
  produceEpisode,
  produceSeason,
  regenerateScript,
  ensureCharacterPortraits,
  regenerateAllImages,
  regenerateAllAudio,
  regenerateSceneImage,
  regenerateSceneAudio,
  generateSceneVideo,
  removeSceneVideo,
  regenerateCharacterPortrait,
  newCharacterFace,
  characterVoicePreview,
  saveUploadedImage,
  saveUploadedMusic,
} from './pipeline.js';
import { renderEpisode } from './render.js';
import { currentProvider } from './images.js';
import { ttsInfo, elevenBalance } from './tts.js';
import { openartCredits } from './openart.js';
import { exportAllProjects, EXPORT_ROOT } from './exporter.js';

const app = express();
app.use(express.json({ limit: '60mb' }));

// ---------- Santé ----------
app.get('/api/health', (req, res) => {
  execFile('claude', ['--version'], { timeout: 15000 }, (err, stdout) => {
    res.json({
      ok: true,
      claude: err ? null : String(stdout).trim(),
      imageProvider: currentProvider(),
      tts: ttsInfo(),
      episodeCount: EPISODE_COUNT,
    });
  });
});

// ---------- Soldes de crédits (ElevenLabs + OpenArt) ----------
let creditsCache = { at: 0, data: null };
app.get('/api/credits', async (req, res) => {
  if (creditsCache.data && Date.now() - creditsCache.at < 60000) {
    res.json(creditsCache.data);
    return;
  }
  const [elevenlabs, openart] = await Promise.all([
    elevenBalance().catch((e) => ({ error: e.message })),
    currentProvider() === 'openart'
      ? openartCredits().catch((e) => ({ error: e.message }))
      : Promise.resolve(null),
  ]);
  creditsCache = { at: Date.now(), data: { elevenlabs, openart } };
  res.json(creditsCache.data);
});

// ---------- Projets ----------
app.get('/api/projects', (req, res) => {
  res.json(listProjects());
});

app.post('/api/projects', (req, res) => {
  const { styles, theme } = req.body || {};
  if (!Array.isArray(styles) || styles.length < 1 || styles.length > 3) {
    res.status(400).json({ error: 'Choisis 1 à 3 styles.' });
    return;
  }
  const job = startJob('Création du drama', (update) =>
    createProject({ styles, theme: (theme || '').slice(0, 500) }, update),
  );
  res.json({ jobId: job.id });
});

// Mode « mon script » : l'auteur fournit son histoire via le formulaire guidé.
app.post('/api/projects/custom', (req, res) => {
  const b = req.body || {};
  const script = String(b.script || '').trim();
  if (script.length < 30) {
    res.status(400).json({
      error: 'Raconte ton histoire (au moins quelques phrases) — c\'est la base de tout le drama.',
    });
    return;
  }
  const validStyle = (s) => STYLES.some((x) => x.id === s);
  const answers = {
    script: script.slice(0, 20000),
    title: String(b.title || '').trim().slice(0, 120),
    setting: String(b.setting || '').trim().slice(0, 300),
    charactersText: String(b.charactersText || '').trim().slice(0, 2000),
    styles: (Array.isArray(b.styles) ? b.styles : []).filter(validStyle).slice(0, MAX_STYLES),
    mustHappen: String(b.mustHappen || '').trim().slice(0, 1000),
    fidelity: b.fidelity === 'libre' ? 'libre' : 'fidele',
  };
  const job = startJob('Création depuis ton script', (update) =>
    createCustomProject(answers, update),
  );
  res.json({ jobId: job.id });
});

app.get('/api/projects/:id', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  res.json(p);
});

app.delete('/api/projects/:id', (req, res) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

app.post('/api/projects/:id/music', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  try {
    const file = saveUploadedMusic(p, req.body.data || '');
    res.json({ ok: true, file });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Parcours par étapes : scénario → personnages → production ----------
app.post('/api/projects/:id/regen-script', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  const job = startJob('Nouveau scénario', (update) => regenerateScript(p, update), { projectId: p.id });
  res.json({ jobId: job.id });
});

app.post('/api/projects/:id/validate-script', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  if (currentProvider() === 'openart') {
    p.stage = 'characters_review';
    saveProject(p);
    const job = startJob('Portraits des personnages', (update) =>
      ensureCharacterPortraits(p, update),
    { projectId: p.id });
    res.json({ stage: p.stage, jobId: job.id });
  } else {
    p.stage = 'production';
    saveProject(p);
    const job = startJob('Production épisode 1', (update) => produceEpisode(p, 1, update), { projectId: p.id });
    res.json({ stage: p.stage, jobId: job.id });
  }
});

app.post('/api/projects/:id/portraits', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  const job = startJob('Portraits des personnages', (update) =>
    ensureCharacterPortraits(p, update),
  { projectId: p.id });
  res.json({ jobId: job.id });
});

app.post('/api/projects/:id/validate-characters', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  p.stage = 'production';
  saveProject(p);
  const job = startJob('Production épisode 1', (update) => produceEpisode(p, 1, update), { projectId: p.id });
  res.json({ stage: p.stage, jobId: job.id });
});

// Job en cours pour ce projet (permet de raccrocher après un rechargement)
app.get('/api/projects/:id/active-job', (req, res) => {
  res.json(activeJobFor(req.params.id));
});

// Production de TOUTE la saison (script + images + voix + MP4 par épisode)
app.post('/api/projects/:id/produce-season', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  if (activeJobFor(p.id)) {
    res.status(409).json({ error: 'Une production est déjà en cours sur ce drama.' });
    return;
  }
  const job = startJob('Production de la saison', (update) => produceSeason(p, update), {
    projectId: p.id,
  });
  res.json({ jobId: job.id });
});

// Archive .zip de tous les MP4 rendus
app.get('/api/projects/:id/season.zip', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  const dir = rendersDir(p.id);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : [];
  if (files.length === 0) {
    res.status(404).json({ error: 'Aucun épisode MP4 rendu pour le moment.' });
    return;
  }
  const zipPath = path.join(dir, 'saison.zip');
  fs.rmSync(zipPath, { force: true });
  execFile(
    'zip',
    ['-j', zipPath, ...files.map((f) => path.join(dir, f))],
    { timeout: 120000 },
    (err) => {
      if (err) {
        res.status(500).json({ error: `Création du zip impossible : ${err.message}` });
        return;
      }
      res.download(zipPath, `${p.title} - saison complete.zip`);
    },
  );
});

app.post('/api/projects/:id/episodes/:n/regen-audio', (req, res) => {
  withEpisode(req, res, (p, ep) => {
    if (!ep) {
      res.status(404).json({ error: 'Épisode introuvable' });
      return;
    }
    const job = startJob(`Voix épisode ${ep.number}`, (update) =>
      regenerateAllAudio(p, ep, update),
    { projectId: p.id });
    res.json({ jobId: job.id });
  });
});

app.post('/api/projects/:id/characters/:charId/portrait', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  const job = startJob('Portrait de référence', (update) =>
    regenerateCharacterPortrait(p, req.params.charId, update),
  { projectId: p.id });
  res.json({ jobId: job.id });
});

// Changement de voix d'un personnage
app.patch('/api/projects/:id/characters/:charId', (req, res) => {
  const p = loadProject(req.params.id);
  const c = p && (p.characters || []).find((x) => x.id === req.params.charId);
  if (!p || !c) {
    res.status(404).json({ error: 'Personnage introuvable' });
    return;
  }
  if (typeof req.body.elevenVoice === 'string' && req.body.elevenVoice) {
    c.elevenVoice = req.body.elevenVoice;
  }
  saveProject(p);
  res.json(p);
});

// Pré-écoute d'une voix (réplique réelle du personnage)
app.post('/api/projects/:id/characters/:charId/voice-preview', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  characterVoicePreview(p, req.params.charId, req.body.elevenVoice)
    .then((file) => res.json({ file }))
    .catch((e) => res.status(500).json({ error: e.message }));
});

// « Nouveau visage » : réécriture de la description + nouveau portrait
app.post('/api/projects/:id/characters/:charId/new-face', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  const job = startJob('Nouveau visage', (update) =>
    newCharacterFace(p, req.params.charId, req.body.instructions, update),
  { projectId: p.id });
  res.json({ jobId: job.id });
});

// Rouvrir l'étape personnages sur un projet déjà en production
app.post('/api/projects/:id/review-characters', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  p.stage = 'characters_review';
  saveProject(p);
  res.json({ stage: p.stage });
});

// ---------- Épisodes ----------
function withEpisode(req, res, fn) {
  const p = loadProject(req.params.id);
  const ep = p && findEpisode(p, req.params.n);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  fn(p, ep);
}

app.post('/api/projects/:id/episodes/:n/produce', (req, res) => {
  const p = loadProject(req.params.id);
  if (!p) {
    res.status(404).json({ error: 'Projet introuvable' });
    return;
  }
  const n = Number(req.params.n);
  if (!(n >= 1 && n <= EPISODE_COUNT)) {
    res.status(400).json({ error: `Numéro d'épisode invalide (1 à ${EPISODE_COUNT}).` });
    return;
  }
  const job = startJob(`Production épisode ${n}`, (update) => produceEpisode(p, n, update), { projectId: p.id });
  res.json({ jobId: job.id });
});

app.post('/api/projects/:id/episodes/:n/regen-images', (req, res) => {
  withEpisode(req, res, (p, ep) => {
    if (!ep) {
      res.status(404).json({ error: 'Épisode introuvable' });
      return;
    }
    const job = startJob(`Images épisode ${ep.number}`, (update) =>
      regenerateAllImages(p, ep, update),
    { projectId: p.id });
    res.json({ jobId: job.id });
  });
});

app.post('/api/projects/:id/episodes/:n/render', (req, res) => {
  withEpisode(req, res, (p, ep) => {
    if (!ep) {
      res.status(404).json({ error: 'Épisode introuvable' });
      return;
    }
    const job = startJob(`Rendu épisode ${ep.number}`, (update) => renderEpisode(p, ep, update), { projectId: p.id });
    res.json({ jobId: job.id });
  });
});

// ---------- Scènes ----------
function withScene(req, res, fn) {
  const p = loadProject(req.params.id);
  const ep = p && findEpisode(p, req.params.n);
  const scene = ep && findScene(ep, req.params.sceneId);
  if (!p || !ep || !scene) {
    res.status(404).json({ error: 'Scène introuvable' });
    return;
  }
  fn(p, ep, scene);
}

app.patch('/api/projects/:id/episodes/:n/scenes/:sceneId', (req, res) => {
  withScene(req, res, (p, ep, scene) => {
    const { lines, imagePrompt, kenBurns, durationSec } = req.body || {};
    if (Array.isArray(lines)) {
      scene.lines = lines
        .filter((l) => l && typeof l.text === 'string' && l.text.trim())
        .slice(0, 4)
        .map((l, j) => {
          const prev = scene.lines[j];
          const unchanged = prev && prev.text === l.text.trim() && prev.speaker === (l.speaker || 'narrator');
          return {
            speaker: l.speaker || 'narrator',
            text: l.text.trim(),
            audio: unchanged ? prev.audio : null,
            audioDurationSec: unchanged ? prev.audioDurationSec : null,
          };
        });
    }
    if (typeof imagePrompt === 'string') {
      scene.imagePrompt = imagePrompt.trim();
    }
    if (typeof kenBurns === 'string') {
      scene.kenBurns = kenBurns;
    }
    if (typeof durationSec === 'number' && durationSec >= 2 && durationSec <= 20) {
      scene.durationSec = durationSec;
    }
    if (ep.status === 'done') {
      ep.status = 'ready';
    }
    saveProject(p);
    res.json(p);
  });
});

app.post('/api/projects/:id/episodes/:n/scenes/:sceneId/image', (req, res) => {
  withScene(req, res, (p, ep, scene) => {
    if (typeof req.body.imagePrompt === 'string' && req.body.imagePrompt.trim()) {
      scene.imagePrompt = req.body.imagePrompt.trim();
    }
    const job = startJob('Nouvelle image', (update) => regenerateSceneImage(p, ep, scene, update), { projectId: p.id });
    res.json({ jobId: job.id });
  });
});

// Clip vidéo d'une scène : génération (coûteuse en crédits) ou retour à l'image fixe.
app.post('/api/projects/:id/episodes/:n/scenes/:sceneId/video', (req, res) => {
  withScene(req, res, (p, ep, scene) => {
    const job = startJob('Clip vidéo de la scène', (update) =>
      generateSceneVideo(p, ep, scene, update),
    { projectId: p.id });
    res.json({ jobId: job.id });
  });
});

app.delete('/api/projects/:id/episodes/:n/scenes/:sceneId/video', (req, res) => {
  withScene(req, res, (p, ep, scene) => {
    removeSceneVideo(p, ep, scene);
    res.json(p);
  });
});

app.post('/api/projects/:id/episodes/:n/scenes/:sceneId/audio', (req, res) => {
  withScene(req, res, (p, ep, scene) => {
    const job = startJob('Nouvelles voix', (update) => regenerateSceneAudio(p, ep, scene, update), { projectId: p.id });
    res.json({ jobId: job.id });
  });
});

app.post('/api/projects/:id/episodes/:n/scenes/:sceneId/upload-image', (req, res) => {
  withScene(req, res, (p, ep, scene) => {
    try {
      const file = saveUploadedImage(p, ep, scene, req.body.data || '');
      res.json({ ok: true, file });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

// ---------- Jobs ----------
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job introuvable' });
    return;
  }
  res.json(job);
});

// ---------- Fichiers des projets (images, voix, rendus) ----------
app.get('/files/:id/*', (req, res) => {
  let dir;
  try {
    dir = projectDir(req.params.id);
  } catch {
    res.status(400).end();
    return;
  }
  const rel = req.params[0] || '';
  // `renders/<f>` est servi depuis le dossier des rendus, tout le reste depuis assets/.
  const base = rel.startsWith('renders/') ? path.join(dir, 'renders') : path.join(dir, 'assets');
  const target = rel.startsWith('renders/') ? path.join(dir, rel) : path.join(base, rel);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) {
    res.status(403).end();
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.status(404).end();
    return;
  }
  res.sendFile(resolved);
});

// ---------- Front (build Vite) ----------
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) {
      next();
      return;
    }
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  🎬 Drama Studio');
  console.log(`  → http://localhost:${PORT}`);
  if (!fs.existsSync(DIST_DIR)) {
    console.log('  (interface non construite : lance `npm run dev` ou `npm run build`)');
  }
  console.log('');
  // Synchronise les épisodes déjà validés vers Bureau/Dramas (rattrapage).
  setTimeout(() => {
    const copied = exportAllProjects();
    if (copied > 0) {
      console.log(`  📁 ${copied} épisode(s) synchronisé(s) dans ${EXPORT_ROOT}`);
    }
  }, 1500);
});
