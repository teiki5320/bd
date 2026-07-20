import { spawn } from 'node:child_process';
import { EPISODE_COUNT, styleLabel } from '../shared/catalog.js';

// Appelle Claude Code en mode non interactif (`claude -p`).
// Utilise la session Claude Code de la machine (abonnement) — aucune clé API.
export function askClaude(prompt, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt, '--output-format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Claude a mis trop de temps à répondre (délai dépassé).'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') {
        reject(
          new Error(
            "La commande `claude` est introuvable. Installe Claude Code (https://claude.com/claude-code) et connecte-toi avec `claude` puis `/login`.",
          ),
        );
      } else {
        reject(e);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // Le message d'erreur de Claude Code sort tantôt sur stderr, tantôt
        // dans l'enveloppe JSON sur stdout — on remonte les deux.
        let detail = `${err}\n${out}`.trim();
        try {
          const envelope = JSON.parse(out);
          if (envelope.result) {
            detail = String(envelope.result);
          }
        } catch {
          // stdout n'était pas du JSON — garder le texte brut
        }
        if (/login|logged out|authenticat|api key|credential|oauth|expired/i.test(detail)) {
          reject(
            new Error(
              "Claude Code n'est pas connecté : dans un terminal, lance `claude`, tape `/login` pour te connecter, puis réessaie ici.",
            ),
          );
          return;
        }
        reject(
          new Error(
            `claude -p a échoué (code ${code}) : ${detail.slice(0, 600) || 'aucun message renvoyé'}`,
          ),
        );
        return;
      }
      try {
        const envelope = JSON.parse(out);
        resolve(typeof envelope.result === 'string' ? envelope.result : out);
      } catch {
        resolve(out);
      }
    });
  });
}

// Extrait le premier objet JSON d'un texte (Claude entoure parfois de ```json).
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Réponse de Claude sans JSON détectable.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

const SCENE_SCHEMA = `{
  "lines": [1 à 2 répliques : {"speaker": "narrator" OU l'id d'un personnage, "text": "réplique courte et percutante en français, 18 mots maximum"}],
  "imagePrompt": "EN ANGLAIS : le plan cinématographique précis (lieu, action, émotion, cadrage) en répétant mot pour mot la description visuelle 'visual' de chaque personnage présent, terminé par : cinematic film still, african drama series, warm natural light, shallow depth of field, 9:16 vertical"
}`;

export function buildSeriesPrompt(styles, theme) {
  const styleNames = styles.map((s) => styleLabel(s)).join(' + ');
  return `Tu es scénariste de micro-dramas africains au format vertical (type TikTok), épisodes de 60 secondes très addictifs.

Crée une NOUVELLE série en ${EPISODE_COUNT} épisodes mêlant ces thèmes : ${styleNames}.${theme ? `\nIdée imposée par le producteur : ${theme}` : ''}

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucun commentaire), selon ce schéma exact :
{
  "title": "titre de la série",
  "logline": "accroche en une phrase",
  "setting": "lieu et contexte (ville/pays africain précis)",
  "characters": [3 à 5 personnages : {
    "id": "slug_court",
    "name": "prénom + nom",
    "gender": "homme" ou "femme",
    "age": nombre,
    "role": "rôle dans l'histoire",
    "visual": "EN ANGLAIS : description physique très détaillée et STABLE (âge apparent, visage, coiffure, tenue signature, corpulence) réutilisée à l'identique dans toutes les images"
  }],
  "episodeSummaries": [${EPISODE_COUNT} éléments : {"number": n, "title": "titre", "summary": "résumé en 2 phrases avec le cliffhanger"}],
  "episode1": {
    "number": 1,
    "title": "titre de l'épisode 1",
    "scenes": [8 à 10 scènes : ${SCENE_SCHEMA}],
    "cliffhanger": "phrase de suspense qui donne envie de voir l'épisode 2"
  }
}

Contraintes STRICTES :
- Total des répliques de l'épisode ≈ 140 mots (≈ 60 secondes de voix). Répliques courtes, naturelles, dialectes d'Afrique de l'Ouest francophone bienvenus par petites touches.
- Drame intense : conflits, retournements, émotions fortes. Chaque scène fait avancer l'intrigue.
- Le narrateur ("narrator") n'intervient que pour poser le décor ou créer la tension (2-3 fois max par épisode).
- Les "imagePrompt" sont autonomes : quelqu'un qui n'a pas lu le script doit pouvoir générer l'image.`;
}

export function buildEpisodePrompt(project, number) {
  const summaries = project.episodeSummaries
    .map((s) => `Épisode ${s.number} — ${s.title} : ${s.summary}`)
    .join('\n');
  const previous = (project.episodes || [])
    .filter((e) => e.number < number && (e.scenes || []).length > 0)
    .map((e) => `Épisode ${e.number} (déjà produit) — cliffhanger final : ${e.cliffhanger}`)
    .join('\n');
  const characters = project.characters
    .map((c) => `- id "${c.id}" : ${c.name}, ${c.gender}, ${c.age} ans, ${c.role}. Visual (EN, à recopier tel quel dans les imagePrompt) : ${c.visual}`)
    .join('\n');

  return `Tu es scénariste de la série micro-drama africaine "${project.title}" (${project.logline}).
Contexte : ${project.setting}

Personnages (ids et descriptions visuelles à réutiliser EXACTEMENT) :
${characters}

Plan de la saison :
${summaries}
${previous ? `\n${previous}\n` : ''}
Écris maintenant le scénario COMPLET de l'épisode ${number}, fidèle au plan de saison et à la continuité.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour) :
{
  "number": ${number},
  "title": "titre de l'épisode",
  "scenes": [8 à 10 scènes : ${SCENE_SCHEMA}],
  "cliffhanger": "phrase de suspense finale"
}

Contraintes STRICTES : total des répliques ≈ 140 mots ; répliques ≤ 18 mots ; "speaker" = "narrator" ou un id de personnage listé ci-dessus ; imagePrompt autonomes incluant les descriptions visuelles complètes.`;
}

export async function askClaudeForJson(prompt) {
  const first = await askClaude(prompt);
  try {
    return extractJson(first);
  } catch (e) {
    // Seconde chance : demande de correction du JSON.
    const retry = await askClaude(
      `Le JSON suivant est invalide ou incomplet (${e.message}). Renvoie UNIQUEMENT ce contenu corrigé en JSON strictement valide, sans aucun texte autour :\n\n${first.slice(0, 30000)}`,
    );
    return extractJson(retry);
  }
}
