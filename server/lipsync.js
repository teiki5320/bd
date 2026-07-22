import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { findFfmpeg } from './studio.js';
import { assetsDir } from './projects.js';
import { LINE_START_DELAY, LINE_GAP } from '../src/remotion/timing.js';

// Synchronisation labiale via fal.ai (Version Synchro uniquement) :
// le clip vidéo de la scène + la piste voix (calée exactement comme dans
// Remotion) sont envoyés à un modèle de lip-sync, qui renvoie le clip avec
// les lèvres animées sur la voix. Le clip reste muet dans le montage : la
// voix ElevenLabs d'origine joue par-dessus, parfaitement alignée.

const LIPSYNC_TIMEOUT_MS = 12 * 60 * 1000;

function ffmpegP(args) {
  return new Promise((resolve, reject) => {
    const bin = findFfmpeg();
    if (!bin) {
      reject(new Error('ffmpeg introuvable (npm install pas terminé ?)'));
      return;
    }
    execFile(bin, args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg : ${String(stderr || err.message).slice(-300)}`));
      } else {
        resolve();
      }
    });
  });
}

// Reconstitue la piste voix de la scène avec les MÊMES décalages que le
// montage Remotion (lineOffsets) — les lèvres tomberont pile sur la voix.
export async function buildSceneVoiceTrack(project, scene, outPath) {
  const dir = assetsDir(project.id);
  const inputs = [];
  const delays = [];
  let t = LINE_START_DELAY;
  for (const line of scene.lines || []) {
    if (!line.audio) {
      throw new Error('Toutes les voix de la scène doivent être générées avant la synchro.');
    }
    inputs.push(path.join(dir, line.audio));
    delays.push(Math.round(t * 1000));
    t += (line.audioDurationSec || 2) + LINE_GAP;
  }
  if (inputs.length === 0) {
    throw new Error('Aucune réplique dans cette scène.');
  }
  const args = [];
  for (const f of inputs) {
    args.push('-i', f);
  }
  const chains = inputs
    .map((_, i) => `[${i}]adelay=${delays[i]}|${delays[i]}[a${i}]`)
    .join(';');
  const mix =
    inputs.length === 1
      ? `${chains};[a0]apad=pad_dur=1[out]`
      : `${chains};${inputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${inputs.length}:normalize=0,apad=pad_dur=1[out]`;
  args.push('-filter_complex', mix, '-map', '[out]', '-c:a', 'libmp3lame', '-q:a', '4', '-y', outPath);
  await ffmpegP(args);
  return outPath;
}

function fileToDataUri(file, mime) {
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

// Appel fal.ai en mode file d'attente (les synchros prennent plusieurs minutes).
async function falQueue(model, input, update) {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error(
      'La Version Synchro nécessite une clé fal.ai : ajoute FAL_KEY=... dans le fichier .env (https://fal.ai/dashboard/keys).',
    );
  }
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000),
  });
  if (!submit.ok) {
    const t = await submit.text().catch(() => '');
    if (submit.status === 401 || submit.status === 403) {
      throw new Error('fal.ai : clé invalide ou non autorisée (vérifie FAL_KEY dans .env).');
    }
    if (submit.status === 402 || /balance|credit/i.test(t)) {
      throw new Error('fal.ai : solde insuffisant — recharge ton compte sur fal.ai.');
    }
    throw new Error(`fal.ai ${submit.status} : ${t.slice(0, 200)}`);
  }
  const job = await submit.json();
  const statusUrl = job.status_url || `https://queue.fal.run/${model}/requests/${job.request_id}/status`;
  const responseUrl = job.response_url || `https://queue.fal.run/${model}/requests/${job.request_id}`;

  const start = Date.now();
  for (;;) {
    if (Date.now() - start > LIPSYNC_TIMEOUT_MS) {
      throw new Error('fal.ai : synchronisation trop longue (délai dépassé).');
    }
    await new Promise((r) => setTimeout(r, 4000));
    const res = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(30000) });
    const status = await res.json().catch(() => ({}));
    if (status.status === 'COMPLETED') {
      break;
    }
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error('fal.ai : la synchronisation a échoué côté serveur.');
    }
    if (update && status.status === 'IN_PROGRESS') {
      update('Synchronisation des lèvres en cours…');
    }
  }
  const out = await fetch(responseUrl, { headers, signal: AbortSignal.timeout(60000) });
  if (!out.ok) {
    throw new Error(`fal.ai : résultat illisible (HTTP ${out.status}).`);
  }
  return out.json();
}

// Synchronise le clip d'une scène avec sa piste voix. Retourne le chemin du
// clip synchronisé (écrit dans outPath).
export async function lipsyncVideo({ videoPath, audioPath, outPath, update }) {
  const model = process.env.FAL_LIPSYNC_MODEL || 'fal-ai/sync-lipsync';
  update('Envoi du clip et de la voix à fal.ai…');
  const result = await falQueue(
    model,
    {
      video_url: fileToDataUri(videoPath, 'video/mp4'),
      audio_url: fileToDataUri(audioPath, 'audio/mpeg'),
      sync_mode: 'cut_off',
    },
    update,
  );
  const url =
    (result.video && result.video.url) ||
    result.video_url ||
    (typeof result.url === 'string' ? result.url : null);
  if (!url) {
    throw new Error(`fal.ai : pas de vidéo dans la réponse (${JSON.stringify(result).slice(0, 150)}).`);
  }
  update('Téléchargement du clip synchronisé…');
  const dl = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!dl.ok) {
    throw new Error(`fal.ai : téléchargement du clip impossible (HTTP ${dl.status}).`);
  }
  const buf = Buffer.from(await dl.arrayBuffer());
  if (buf.length < 20000) {
    throw new Error('fal.ai : clip synchronisé invalide (fichier trop petit).');
  }
  fs.writeFileSync(outPath, buf);
  return outPath;
}
