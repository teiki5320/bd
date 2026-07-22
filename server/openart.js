import { spawn, execFile } from 'node:child_process';

// Génération d'images via le MCP officiel OpenArt (https://mcp.openart.ai/mcp),
// piloté par Claude Code en mode headless. Le MCP doit être enregistré sur la
// machine et authentifié une fois via `/mcp`.

const TIMEOUT_MS = 8 * 60 * 1000;
// Les vidéos prennent bien plus longtemps qu'une image (files d'attente des modèles).
const VIDEO_TIMEOUT_MS = 25 * 60 * 1000;

// Détecte le nom sous lequel le MCP OpenArt est enregistré (`claude mcp list`).
let mcpNamePromise = null;
function detectMcpName() {
  if (process.env.OPENART_MCP_NAME) {
    return Promise.resolve(process.env.OPENART_MCP_NAME);
  }
  if (!mcpNamePromise) {
    mcpNamePromise = new Promise((resolve, reject) => {
      execFile('claude', ['mcp', 'list'], { timeout: 60000 }, (err, stdout) => {
        const lines = String(stdout || '').split('\n');
        const hit = lines.find((l) => /openart/i.test(l));
        if (hit) {
          const name = hit.split(':')[0].trim();
          if (name) {
            resolve(name);
            return;
          }
        }
        reject(
          new Error(
            "Le MCP OpenArt n'est pas installé sur cette machine. Installe-le avec : " +
              'claude mcp add --transport http --scope user openart https://mcp.openart.ai/mcp ' +
              "puis authentifie-le via `claude` → /mcp → openart.",
          ),
        );
      });
    });
    mcpNamePromise.catch(() => {
      mcpNamePromise = null;
    });
  }
  return mcpNamePromise;
}

function buildInstruction(prompt, referenceUrls) {
  const refs =
    referenceUrls.length > 0
      ? `\n- IMPORTANT — cohérence des visages : utilise ces images comme références de personnages (image-to-image / références externes d'OpenArt), les visages générés doivent être IDENTIQUES à ceux des références :\n${referenceUrls.map((u) => `  - ${u}`).join('\n')}`
      : '';
  return `Tu as accès aux outils MCP OpenArt. Génère UNE SEULE image via OpenArt :
- Prompt : ${prompt}
- Format : vertical 9:16 (par exemple 1080x1920).
- Choisis un modèle photoréaliste de qualité (Seedream, Nano Banana Pro ou équivalent disponible).${refs}
Attends la fin de la génération. Puis réponds UNIQUEMENT avec l'URL directe du fichier image généré (une seule ligne, aucune autre phrase). Si la génération échoue, réponds "ERREUR: " suivi de la cause exacte.`;
}

function runClaude(instruction, mcpName, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        instruction,
        '--output-format',
        'json',
        '--allowedTools',
        `mcp__${mcpName},mcp__${mcpName}__*`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('OpenArt : génération trop longue (délai dépassé).'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = out;
      try {
        const envelope = JSON.parse(out);
        if (typeof envelope.result === 'string') {
          text = envelope.result;
        }
      } catch {
        // stdout brut
      }
      if (code !== 0) {
        reject(new Error(`OpenArt via Claude a échoué (code ${code}) : ${(err || text).slice(0, 400)}`));
        return;
      }
      resolve(text.trim());
    });
  });
}

async function downloadFile(url, { minBytes = 5000, timeoutMs = 120000, label = "l'image" } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`Téléchargement de ${label} OpenArt : HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) {
    throw new Error(`L'URL OpenArt ne renvoie pas ${label === "l'image" ? 'une image valide' : 'une vidéo valide'}.`);
  }
  return buf;
}

const downloadImage = (url) => downloadFile(url, { label: "l'image" });

// Solde de crédits OpenArt via le MCP (mis en cache 10 min — chaque
// consultation coûte un appel Claude headless).
let creditsCache = { at: 0, value: null };
const CREDITS_TTL_MS = 10 * 60 * 1000;

export async function openartCredits() {
  if (Date.now() - creditsCache.at < CREDITS_TTL_MS) {
    return creditsCache.value;
  }
  const mcpName = await detectMcpName();
  const text = await runClaude(
    `Tu as accès aux outils MCP OpenArt. Consulte le SOLDE DE CRÉDITS restant de mon compte OpenArt (cherche un outil de type account / credits / balance / profile). Réponds UNIQUEMENT avec un objet JSON : {"credits": nombre} — ou "ERREUR: cause précise" si aucun outil ne permet de le savoir.`,
    mcpName,
  );
  let value;
  if (/^ERREUR/i.test(text.trim())) {
    value = { error: text.trim().replace(/^ERREUR\s*:\s*/i, '').slice(0, 200) };
  } else {
    const m = text.match(/\{[^{}]*"credits"[^{}]*\}/);
    if (!m) {
      value = { error: 'solde illisible' };
    } else {
      try {
        value = { credits: Number(JSON.parse(m[0]).credits) };
      } catch {
        value = { error: 'solde illisible' };
      }
    }
  }
  creditsCache = { at: Date.now(), value };
  return value;
}

// Retourne { buffer, url } — l'URL sert de référence de visage pour les scènes suivantes.
export async function openartGenerate({ prompt, referenceUrls = [] }) {
  const mcpName = await detectMcpName();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await runClaude(buildInstruction(prompt, referenceUrls), mcpName);
      if (/^ERREUR\s*:/i.test(text)) {
        const cause = text.replace(/^ERREUR\s*:/i, '').trim();
        if (/credit|crédit/i.test(cause)) {
          throw new Error(`OpenArt : crédits insuffisants — ${cause}`);
        }
        if (/auth|connect|login|token/i.test(cause)) {
          throw new Error(
            `OpenArt : problème d'authentification MCP — relance \`claude\`, tape /mcp, et reconnecte "${mcpName}". (${cause})`,
          );
        }
        throw new Error(`OpenArt : ${cause}`);
      }
      const urls = [...text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0]);
      if (urls.length === 0) {
        throw new Error(`OpenArt : aucune URL d'image dans la réponse (« ${text.slice(0, 200)} »).`);
      }
      // Essaie de la dernière URL vers la première (la dernière est la réponse finale).
      for (let i = urls.length - 1; i >= 0; i--) {
        try {
          const buffer = await downloadImage(urls[i]);
          return { buffer, url: urls[i] };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('OpenArt : aucune URL téléchargeable.');
    } catch (e) {
      lastErr = e;
      // Les erreurs de crédits/auth ne se règlent pas en réessayant.
      if (/crédit|authentification/.test(e.message)) {
        throw e;
      }
    }
  }
  throw lastErr;
}

function buildVideoInstruction({ prompt, imageUrl, referenceUrls, durationSec }) {
  const source = imageUrl
    ? `\n- IMPORTANT — image-to-video : anime EXACTEMENT cette image (utilise-la comme image de départ / première frame, les visages et le décor doivent rester IDENTIQUES) :\n  ${imageUrl}`
    : referenceUrls.length > 0
      ? `\n- IMPORTANT — cohérence des visages : utilise ces portraits comme références de personnages, les visages doivent être IDENTIQUES à ceux des références :\n${referenceUrls.map((u) => `  - ${u}`).join('\n')}`
      : '';
  return `Tu as accès aux outils MCP OpenArt. Génère UN SEUL clip VIDÉO via OpenArt :
- Prompt : ${prompt}
- Format : vertical 9:16 (par exemple 1080x1920).
- Durée cible : ${durationSec} secondes (choisis la durée disponible la plus proche).${source}
- Choisis un modèle vidéo de qualité qui accepte une image de référence (Kling, Seedance, PixVerse, Wan ou équivalent disponible) ; à qualité comparable, prends le moins cher en crédits.
Attends la fin de la génération — cela peut prendre plusieurs minutes, patiente et vérifie le statut si nécessaire. Puis réponds UNIQUEMENT avec l'URL directe du fichier vidéo généré (.mp4, une seule ligne, aucune autre phrase). Si la génération échoue, réponds "ERREUR: " suivi de la cause exacte.`;
}

// Génère un clip vidéo (image-to-video de préférence). Retourne { buffer, url }.
export async function openartGenerateVideo({
  prompt,
  imageUrl = null,
  referenceUrls = [],
  durationSec = 5,
}) {
  const mcpName = await detectMcpName();
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await runClaude(
        buildVideoInstruction({ prompt, imageUrl, referenceUrls, durationSec }),
        mcpName,
        VIDEO_TIMEOUT_MS,
      );
      if (/^ERREUR\s*:/i.test(text)) {
        const cause = text.replace(/^ERREUR\s*:/i, '').trim();
        if (/credit|crédit/i.test(cause)) {
          throw new Error(`OpenArt : crédits insuffisants — ${cause}`);
        }
        if (/auth|connect|login|token/i.test(cause)) {
          throw new Error(
            `OpenArt : problème d'authentification MCP — relance \`claude\`, tape /mcp, et reconnecte "${mcpName}". (${cause})`,
          );
        }
        throw new Error(`OpenArt : ${cause}`);
      }
      const urls = [...text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0]);
      if (urls.length === 0) {
        throw new Error(`OpenArt : aucune URL de vidéo dans la réponse (« ${text.slice(0, 200)} »).`);
      }
      for (let i = urls.length - 1; i >= 0; i--) {
        // On ne re-télécharge pas l'image source si le modèle l'a recopiée dans sa réponse.
        if (urls[i] === imageUrl) {
          continue;
        }
        try {
          const buffer = await downloadFile(urls[i], {
            minBytes: 50000,
            timeoutMs: 300000,
            label: 'la vidéo',
          });
          return { buffer, url: urls[i] };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('OpenArt : aucune URL de vidéo téléchargeable.');
    } catch (e) {
      lastErr = e;
      if (/crédit|authentification/.test(e.message)) {
        throw e;
      }
    }
  }
  throw lastErr;
}
