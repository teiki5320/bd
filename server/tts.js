import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { parseFile } from 'music-metadata';

const SYNTH_TIMEOUT_MS = 25_000;

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} : ${String(stderr || err.message).slice(0, 200)}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// Derrière un proxy d'entreprise, le WebSocket d'Edge TTS doit passer par l'agent.
function proxyAgent() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

export const NARRATOR_VOICE = 'fr-FR-RemyMultilingualNeural';

const MALE_VOICES = [
  'fr-FR-HenriNeural',
  'fr-FR-AlainNeural',
  'fr-FR-ClaudeNeural',
  'fr-FR-JeromeNeural',
  'fr-FR-YvesNeural',
];

const FEMALE_VOICES = [
  'fr-FR-DeniseNeural',
  'fr-FR-EloiseNeural',
  'fr-FR-VivienneMultilingualNeural',
  'fr-FR-BrigitteNeural',
  'fr-FR-JacquelineNeural',
];

// Voix macOS (`say`) — plan B local quand Edge TTS est inaccessible.
const SAY_MALE = ['Thomas', 'Nicolas'];
const SAY_FEMALE = ['Amélie', 'Audrey', 'Aurélie', 'Chantal'];
const NARRATOR_SAY = 'Thomas';

// Attribue une voix distincte à chaque personnage selon son genre.
export function assignVoices(characters) {
  let m = 0;
  let f = 0;
  for (const c of characters) {
    if ((c.gender || '').toLowerCase().startsWith('f')) {
      c.voice = FEMALE_VOICES[f % FEMALE_VOICES.length];
      c.sayVoice = SAY_FEMALE[f % SAY_FEMALE.length];
      f++;
    } else {
      c.voice = MALE_VOICES[m % MALE_VOICES.length];
      c.sayVoice = SAY_MALE[m % SAY_MALE.length];
      m++;
    }
  }
  return characters;
}

export async function audioDurationSec(file) {
  const meta = await parseFile(file);
  return meta.format.duration || 2;
}

// msedge-tts rejette parfois avec une chaîne ou un objet brut — normalise en Error.
function normalizeError(e) {
  if (e instanceof Error) {
    return e;
  }
  const text = typeof e === 'string' ? e : JSON.stringify(e);
  return new Error(`Synthèse vocale impossible : ${text}`);
}

// Synthèse via Edge TTS (en ligne, gratuit) — écrit un MP3.
async function synthesizeEdge(text, voice, outPath) {
  const tts = new MsEdgeTTS(proxyAgent());
  try {
    await Promise.race([
      (async () => {
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        await tts.toFile(outPath, text);
      })().catch((e) => {
        throw normalizeError(e);
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Edge TTS trop long (service inaccessible ?).')),
          SYNTH_TIMEOUT_MS,
        ),
      ),
    ]);
  } finally {
    try {
      tts.close();
    } catch {
      // déjà fermée
    }
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 500) {
    throw new Error('Edge TTS a produit un fichier vide.');
  }
  return audioDurationSec(outPath);
}

// Synthèse via la voix intégrée de macOS (`say`) — 100 % locale, écrit un M4A.
async function synthesizeSay(text, sayVoice, outBase) {
  const aiff = `${outBase}.aiff`;
  const m4a = `${outBase}.m4a`;
  try {
    if (sayVoice) {
      try {
        await execFileP('say', ['-v', sayVoice, '-o', aiff, text]);
      } catch {
        // voix non installée sur ce Mac → voix française par défaut
        await execFileP('say', ['-o', aiff, text]);
      }
    } else {
      await execFileP('say', ['-o', aiff, text]);
    }
    await execFileP('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a]);
  } finally {
    fs.rmSync(aiff, { force: true });
  }
  if (!fs.existsSync(m4a) || fs.statSync(m4a).size < 500) {
    throw new Error('La voix macOS a produit un fichier vide.');
  }
  return m4a;
}

// Après un échec Edge, on bascule sur les voix macOS pendant 10 min
// (évite d'attendre le timeout à chaque réplique quand le service est HS).
let edgeFailedAt = 0;
const EDGE_RETRY_AFTER_MS = 10 * 60 * 1000;

// Synthétise une réplique : Edge TTS d'abord, voix macOS en secours.
// TTS_PROVIDER=say ou =edge dans .env pour forcer l'un des deux.
// Retourne { file (chemin complet), durationSec }.
export async function synthesize({ text, edgeVoice, sayVoice, outBase }) {
  const pref = (process.env.TTS_PROVIDER || 'auto').toLowerCase();
  const canSay = process.platform === 'darwin';
  const skipEdge =
    pref === 'say' ||
    (pref === 'auto' && canSay && Date.now() - edgeFailedAt < EDGE_RETRY_AFTER_MS);
  if (!skipEdge) {
    try {
      const mp3 = `${outBase}.mp3`;
      const durationSec = await synthesizeEdge(text, edgeVoice, mp3);
      return { file: mp3, durationSec };
    } catch (edgeErr) {
      edgeFailedAt = Date.now();
      if (!canSay || pref === 'edge') {
        throw edgeErr;
      }
    }
  }
  if (!canSay) {
    throw new Error('Aucune méthode de synthèse vocale disponible sur cette machine.');
  }
  const m4a = await synthesizeSay(text, sayVoice, outBase);
  return { file: m4a, durationSec: await audioDurationSec(m4a) };
}

export function voiceFor(project, speaker) {
  if (speaker === 'narrator') {
    return { edgeVoice: NARRATOR_VOICE, sayVoice: NARRATOR_SAY };
  }
  const c = (project.characters || []).find((x) => x.id === speaker);
  if (!c) {
    return { edgeVoice: NARRATOR_VOICE, sayVoice: NARRATOR_SAY };
  }
  const female = (c.gender || '').toLowerCase().startsWith('f');
  return {
    edgeVoice: c.voice || (female ? FEMALE_VOICES[0] : MALE_VOICES[0]),
    sayVoice: c.sayVoice || (female ? SAY_FEMALE[0] : SAY_MALE[0]),
  };
}
