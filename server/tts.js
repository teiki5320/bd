import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { VOICES } from '../shared/catalog.js';
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

// Voix macOS (`say`) — plan B local quand les services en ligne sont inaccessibles.
const SAY_MALE = ['Thomas', 'Nicolas'];
const SAY_FEMALE = ['Amélie', 'Audrey', 'Aurélie', 'Chantal'];
const NARRATOR_SAY = 'Thomas';

// Voix ElevenLabs — catalogue partagé (shared/catalog.js), casting par Claude
// ou choix manuel dans l'interface ; ces pools servent de repli.
const ELEVEN_MALE = VOICES.filter((v) => v.gender === 'homme').map((v) => v.id);
const ELEVEN_FEMALE = VOICES.filter((v) => v.gender === 'femme').map((v) => v.id);
const ELEVEN_NARRATOR = 'onwK4e9ZLuTAKqWW03F9'; // Daniel

export function isCatalogVoice(id) {
  return VOICES.some((v) => v.id === id);
}

// Attribue une voix distincte à chaque personnage selon son genre.
export function assignVoices(characters) {
  let m = 0;
  let f = 0;
  for (const c of characters) {
    if ((c.gender || '').toLowerCase().startsWith('f')) {
      c.voice = FEMALE_VOICES[f % FEMALE_VOICES.length];
      c.sayVoice = SAY_FEMALE[f % SAY_FEMALE.length];
      // ne pas écraser un casting déjà fait (par Claude ou par l'utilisateur)
      c.elevenVoice = c.elevenVoice || ELEVEN_FEMALE[f % ELEVEN_FEMALE.length];
      f++;
    } else {
      c.voice = MALE_VOICES[m % MALE_VOICES.length];
      c.sayVoice = SAY_MALE[m % SAY_MALE.length];
      c.elevenVoice = c.elevenVoice || ELEVEN_MALE[m % ELEVEN_MALE.length];
      m++;
    }
  }
  return characters;
}

// ---------- ElevenLabs (qualité studio, clé requise) ----------
async function synthesizeEleven(text, voiceId, outPath) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error('ELEVENLABS_API_KEY absente du .env');
  }
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.35 },
      }),
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error('ElevenLabs : clé API invalide.');
    }
    if (res.status === 429 || /quota/i.test(t)) {
      throw new Error('ElevenLabs : quota de caractères épuisé.');
    }
    throw new Error(`ElevenLabs ${res.status} : ${t.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) {
    throw new Error('ElevenLabs : audio vide.');
  }
  fs.writeFileSync(outPath, buf);
  return audioDurationSec(outPath);
}

// ---------- Détection des meilleures voix macOS installées ----------
// Les voix "Premium"/"Enhanced" (à télécharger dans Réglages Système →
// Accessibilité → Contenu énoncé) sont bien plus naturelles que les compactes.
let sayVoicesPromise = null;
function installedFrenchSayVoices() {
  if (!sayVoicesPromise) {
    sayVoicesPromise = execFileP('say', ['-v', '?'])
      .then((out) =>
        String(out)
          .split('\n')
          .map((l) => {
            const m = l.match(/^(.+?)\s{2,}([a-z]{2}[_-][A-Z]{2})\s/);
            return m ? { name: m[1].trim(), locale: m[2] } : null;
          })
          .filter((v) => v && v.locale.toLowerCase().startsWith('fr')),
      )
      .catch(() => []);
  }
  return sayVoicesPromise;
}

function sayQuality(name) {
  if (/premium/i.test(name)) return 3;
  if (/enhanced|améliorée/i.test(name)) return 2;
  return 1;
}

async function resolveBestSayVoice(baseName) {
  const voices = await installedFrenchSayVoices();
  if (voices.length === 0) {
    return baseName || null;
  }
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const candidates = baseName
    ? voices.filter((v) => norm(v.name).startsWith(norm(baseName)))
    : [];
  const pool = candidates.length > 0 ? candidates : voices;
  pool.sort(
    (a, b) =>
      sayQuality(b.name) - sayQuality(a.name) ||
      (b.locale === 'fr_FR' ? 1 : 0) - (a.locale === 'fr_FR' ? 1 : 0),
  );
  return pool[0].name;
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
// Utilise automatiquement la meilleure variante installée (Premium > Enhanced).
async function synthesizeSay(text, sayVoice, outBase) {
  const aiff = `${outBase}.aiff`;
  const m4a = `${outBase}.m4a`;
  const voice = await resolveBestSayVoice(sayVoice);
  try {
    if (voice) {
      try {
        await execFileP('say', ['-v', voice, '-o', aiff, text]);
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

// Solde de crédits ElevenLabs (nécessite la permission « User → Read » sur la clé).
export async function elevenBalance() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return null;
  }
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (/user_read|missing_permission/i.test(t)) {
      return { error: 'permission' };
    }
    return { error: `HTTP ${res.status}` };
  }
  const d = await res.json();
  return {
    used: d.character_count,
    limit: d.character_limit,
    resetAt: d.next_character_count_reset_unix ? d.next_character_count_reset_unix * 1000 : null,
  };
}

// Décrit la chaîne de voix active (affichée dans l'interface).
export function ttsInfo() {
  const pref = (process.env.TTS_PROVIDER || 'auto').toLowerCase();
  if (pref !== 'auto') {
    return pref;
  }
  if (process.env.ELEVENLABS_API_KEY) {
    return 'elevenlabs';
  }
  return process.platform === 'darwin' ? 'edge → voix macOS' : 'edge';
}

// Synthétise une réplique. Ordre en mode auto :
//   ElevenLabs (si clé) → Edge TTS → voix macOS.
// TTS_PROVIDER=elevenlabs | edge | say dans .env pour forcer un moteur.
// Retourne { file (chemin complet), durationSec, engine, chars } — engine/chars
// alimentent le compteur de consommation du projet.
export async function synthesize({ text, edgeVoice, sayVoice, elevenVoice, outBase }) {
  const pref = (process.env.TTS_PROVIDER || 'auto').toLowerCase();
  const canSay = process.platform === 'darwin';
  const hasElevenKey = Boolean(process.env.ELEVENLABS_API_KEY);
  const chars = text.length;

  // 1. ElevenLabs — qualité studio
  if (pref === 'elevenlabs' || (pref === 'auto' && hasElevenKey)) {
    try {
      const mp3 = `${outBase}.mp3`;
      const durationSec = await synthesizeEleven(text, elevenVoice, mp3);
      return { file: mp3, durationSec, engine: 'elevenlabs', chars };
    } catch (e) {
      if (pref === 'elevenlabs') {
        throw e;
      }
      console.error('ElevenLabs indisponible, bascule :', e.message);
    }
  }

  // 2. Edge TTS — gratuit, en ligne
  const skipEdge =
    pref === 'say' ||
    (pref === 'auto' && canSay && Date.now() - edgeFailedAt < EDGE_RETRY_AFTER_MS);
  if (pref !== 'elevenlabs' && !skipEdge) {
    try {
      const mp3 = `${outBase}.mp3`;
      const durationSec = await synthesizeEdge(text, edgeVoice, mp3);
      return { file: mp3, durationSec, engine: 'edge', chars };
    } catch (edgeErr) {
      edgeFailedAt = Date.now();
      if (!canSay || pref === 'edge') {
        throw edgeErr;
      }
    }
  }

  // 3. Voix macOS — locale, infaillible
  if (!canSay) {
    throw new Error('Aucune méthode de synthèse vocale disponible sur cette machine.');
  }
  const m4a = await synthesizeSay(text, sayVoice, outBase);
  return { file: m4a, durationSec: await audioDurationSec(m4a), engine: 'say', chars };
}

export function voiceFor(project, speaker) {
  if (speaker === 'narrator') {
    return { edgeVoice: NARRATOR_VOICE, sayVoice: NARRATOR_SAY, elevenVoice: ELEVEN_NARRATOR };
  }
  const c = (project.characters || []).find((x) => x.id === speaker);
  const female = c ? (c.gender || '').toLowerCase().startsWith('f') : false;
  if (!c) {
    return { edgeVoice: NARRATOR_VOICE, sayVoice: NARRATOR_SAY, elevenVoice: ELEVEN_NARRATOR };
  }
  return {
    edgeVoice: c.voice || (female ? FEMALE_VOICES[0] : MALE_VOICES[0]),
    sayVoice: c.sayVoice || (female ? SAY_FEMALE[0] : SAY_MALE[0]),
    elevenVoice: c.elevenVoice || (female ? ELEVEN_FEMALE[0] : ELEVEN_MALE[0]),
  };
}
