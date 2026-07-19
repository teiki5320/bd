import fs from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { parseFile } from 'music-metadata';

const SYNTH_TIMEOUT_MS = 60_000;

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

// Attribue une voix distincte à chaque personnage selon son genre.
export function assignVoices(characters) {
  let m = 0;
  let f = 0;
  for (const c of characters) {
    if ((c.gender || '').toLowerCase().startsWith('f')) {
      c.voice = FEMALE_VOICES[f % FEMALE_VOICES.length];
      f++;
    } else {
      c.voice = MALE_VOICES[m % MALE_VOICES.length];
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

// Synthétise une réplique en MP3. Retourne la durée en secondes.
export async function synthesize(text, voice, outPath) {
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
          () => reject(new Error('Synthèse vocale trop longue (réseau bloqué ?).')),
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
    throw new Error('La synthèse vocale a produit un fichier vide.');
  }
  return audioDurationSec(outPath);
}

export function voiceFor(project, speaker) {
  if (speaker === 'narrator') {
    return NARRATOR_VOICE;
  }
  const c = (project.characters || []).find((x) => x.id === speaker);
  return (c && c.voice) || NARRATOR_VOICE;
}
