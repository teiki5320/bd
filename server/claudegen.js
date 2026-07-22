import { spawn } from 'node:child_process';
import { EPISODE_COUNT, styleLabel, VOICES } from '../shared/catalog.js';

const VOICE_CATALOG = VOICES.map((v) => `"${v.id}" = ${v.name} (${v.gender}, ${v.desc})`).join(' ; ');

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
  "characters": [ids des personnages VISIBLES à l'image dans cette scène, [] si aucun],
  "imagePrompt": "EN ANGLAIS : le plan cinématographique précis (lieu, action, émotion, cadrage) en répétant mot pour mot la description visuelle 'visual' de chaque personnage présent, terminé par : cinematic film still, african drama series, warm natural light, shallow depth of field, 9:16 vertical"
}`;

const SERIES_SCHEMA = `{
  "title": "titre de la série",
  "logline": "accroche en une phrase",
  "setting": "lieu et contexte (ville/pays africain précis)",
  "characters": [3 à 5 personnages : {
    "id": "slug_court",
    "name": "prénom + nom",
    "gender": "homme" ou "femme",
    "age": nombre,
    "role": "rôle dans l'histoire",
    "visual": "EN ANGLAIS : description physique très détaillée et STABLE (âge apparent, visage, coiffure, tenue signature, corpulence) réutilisée à l'identique dans toutes les images",
    "voice": "CASTING VOCAL : l'id EXACT de la voix la plus adaptée au genre, à l'âge et à la personnalité du personnage, choisie dans ce catalogue : ${VOICE_CATALOG}"
  }],
  "episodeSummaries": [${EPISODE_COUNT} éléments : {"number": n, "title": "titre", "summary": "résumé en 2 phrases avec le cliffhanger"}],
  "episode1": {
    "number": 1,
    "title": "titre de l'épisode 1",
    "scenes": [8 à 10 scènes : ${SCENE_SCHEMA}],
    "cliffhanger": "phrase de suspense qui donne envie de voir l'épisode 2"
  }
}`;

const SERIES_RULES = `Contraintes STRICTES :
- CLARTÉ AVANT TOUT : un spectateur qui découvre l'épisode sur son téléphone doit tout comprendre du premier coup. Phrases courtes et simples, aucun sous-entendu obscur, aucune ellipse confuse. Une scène = une seule idée claire qui fait avancer l'intrigue. Les personnages s'appellent par leur prénom dans les dialogues pour qu'on sache toujours qui parle à qui.
- Le narrateur ("narrator") OUVRE l'épisode en posant la situation en une phrase simple (« Awa vient d'enterrer son père. Ce matin, le notaire lit le testament. »), puis n'intervient que pour clarifier une transition (3 fois max par épisode).
- DRAMA MAXIMAL : conflits frontaux, confrontations directes en face à face, révélations chocs, phrases qui claquent. Chaque épisode contient AU MOINS une confrontation intense et une révélation. Émotions fortes et assumées : colère, larmes, menaces, amour interdit, humiliation publique.
- Total des répliques de l'épisode ≈ 140 mots (≈ 60 secondes de voix). Répliques ≤ 18 mots, percutantes, naturelles à l'oral, expressions d'Afrique de l'Ouest francophone par petites touches.
- Le cliffhanger final doit donner physiquement envie de voir la suite (danger imminent, secret sur le point d'éclater, retournement).
- Les "imagePrompt" sont autonomes : quelqu'un qui n'a pas lu le script doit pouvoir générer l'image.`;

export function buildSeriesPrompt(styles, theme) {
  const styleNames = styles.map((s) => styleLabel(s)).join(' + ');
  return `Tu es scénariste de micro-dramas africains au format vertical (type TikTok), épisodes de 60 secondes très addictifs.

Crée une NOUVELLE série en ${EPISODE_COUNT} épisodes mêlant ces thèmes : ${styleNames}.${theme ? `\nIdée imposée par le producteur : ${theme}` : ''}

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucun commentaire), selon ce schéma exact :
${SERIES_SCHEMA}

${SERIES_RULES}`;
}

// Série construite à partir du script fourni par l'auteur (mode « mon script »).
export function buildCustomSeriesPrompt(answers) {
  const { script, title, setting, charactersText, styles = [], mustHappen, fidelity } = answers;
  const styleNames = styles.map((s) => styleLabel(s)).join(' + ');
  return `Tu es scénariste de micro-dramas africains au format vertical (type TikTok), épisodes de 60 secondes très addictifs.

Un auteur te confie SON histoire. Ta mission : la structurer en une série de ${EPISODE_COUNT} épisodes SANS la dénaturer — c'est son histoire, pas la tienne.

=== MATÉRIAU DE L'AUTEUR ===
${title ? `Titre imposé : ${title}\n` : ''}${setting ? `Lieu et contexte imposés : ${setting}\n` : ''}${styleNames ? `Ton souhaité : ${styleNames}\n` : ''}${
    charactersText
      ? `Personnages décrits par l'auteur (noms, genres, âges et apparences à RESPECTER) :\n${charactersText}\n`
      : ''
  }Histoire / script :
"""
${script}
"""
${mustHappen ? `Moments imposés (doivent absolument arriver dans la saison) : ${mustHappen}\n` : ''}=== FIN DU MATÉRIAU ===

Règles de FIDÉLITÉ (prioritaires sur tout le reste) :
- L'intrigue, les personnages et leurs noms viennent de l'auteur : tu ne changes RIEN à l'histoire. Tu la découpes en ${EPISODE_COUNT} épisodes équilibrés, tu la clarifies, et tu complètes UNIQUEMENT ce que l'auteur n'a pas précisé.
- ${
    fidelity === 'libre'
      ? "Tu peux réécrire les dialogues pour le format 60 secondes, à condition de garder le sens des scènes et le caractère des personnages."
      : "Si l'auteur a écrit des dialogues, reprends-les tels quels dans les répliques (raccourcis à 18 mots maximum si nécessaire, sans changer le sens)."
  }
- Complète sans contredire : genre, âge, rôle et description visuelle détaillée des personnages s'ils manquent ; lieu précis s'il manque ; cliffhanger par épisode.
- Histoire trop courte pour ${EPISODE_COUNT} épisodes → développe des rebondissements cohérents avec l'univers de l'auteur. Trop longue → condense sans perdre les moments clés.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour, aucun commentaire), selon ce schéma exact :
${SERIES_SCHEMA}

${SERIES_RULES}`;
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

  // Mode « mon script » : l'histoire de l'auteur reste la référence absolue.
  const source =
    project.source && project.source.script
      ? `\nSCRIPT SOURCE DE L'AUTEUR — l'épisode doit y rester FIDÈLE${
          project.source.fidelity === 'libre'
            ? ' (dialogues adaptables, sens des scènes intouchable)'
            : ' (reprends ses dialogues tels quels quand ils existent, raccourcis à 18 mots max)'
        } :\n"""\n${project.source.script.slice(0, 9000)}\n"""\n${
          project.source.mustHappen
            ? `Moments imposés par l'auteur : ${project.source.mustHappen}\n`
            : ''
        }`
      : '';

  return `Tu es scénariste de la série micro-drama africaine "${project.title}" (${project.logline}).
Contexte : ${project.setting}

Personnages (ids et descriptions visuelles à réutiliser EXACTEMENT) :
${characters}

Plan de la saison :
${summaries}
${previous ? `\n${previous}\n` : ''}${source}
Écris maintenant le scénario COMPLET de l'épisode ${number}, fidèle au plan de saison et à la continuité.

Réponds UNIQUEMENT avec un objet JSON valide (aucun texte autour) :
{
  "number": ${number},
  "title": "titre de l'épisode",
  "scenes": [8 à 10 scènes : ${SCENE_SCHEMA}],
  "cliffhanger": "phrase de suspense finale"
}

Contraintes STRICTES :
- CLARTÉ AVANT TOUT : tout doit se comprendre du premier coup. Phrases courtes et simples, une seule idée par scène, les personnages s'appellent par leur prénom. Le narrateur ouvre l'épisode en rappelant la situation en une phrase simple, puis 3 interventions max.
- DRAMA MAXIMAL : au moins une confrontation intense en face à face et une révélation choc dans l'épisode. Émotions fortes et assumées, phrases qui claquent.
- Total des répliques ≈ 140 mots ; répliques ≤ 18 mots, percutantes et naturelles à l'oral.
- Cliffhanger final irrésistible (danger imminent, secret sur le point d'éclater, retournement).
- "speaker" = "narrator" ou un id de personnage listé ci-dessus ; imagePrompt autonomes incluant les descriptions visuelles complètes.`;
}

export function buildNewFacePrompt(character, instructions) {
  return `Personnage d'une série micro-drama africaine : ${character.name}, ${character.gender}, ${character.age} ans, ${character.role}.
Description visuelle actuelle (EN ANGLAIS) : ${character.visual}
${
  instructions
    ? `Consignes du réalisateur pour la NOUVELLE apparence : ${instructions}`
    : `Invente une apparence NETTEMENT différente de l'actuelle (autre visage, autre coiffure, autre tenue signature), cohérente avec l'âge, le genre et le rôle.`
}
Réponds UNIQUEMENT avec un objet JSON valide : {"visual": "nouvelle description physique EN ANGLAIS, très détaillée et STABLE (âge apparent, visage, coiffure, tenue signature, corpulence)"}`;
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
