import { spawn } from 'node:child_process';

// Génération d'images via le MCP officiel OpenArt (https://mcp.openart.ai/mcp),
// piloté par Claude Code en mode headless. Le MCP doit être enregistré sur la
// machine (`claude mcp add --transport http --scope user openart https://mcp.openart.ai/mcp`)
// et authentifié une fois via `/mcp`.

const MCP_NAME = process.env.OPENART_MCP_NAME || 'openart';
const TIMEOUT_MS = 8 * 60 * 1000;

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

function runClaude(instruction) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      [
        '-p',
        instruction,
        '--output-format',
        'json',
        '--allowedTools',
        `mcp__${MCP_NAME},mcp__${MCP_NAME}__*`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('OpenArt : génération trop longue (délai dépassé).'));
    }, TIMEOUT_MS);
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

async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) {
    throw new Error(`Téléchargement de l'image OpenArt : HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) {
    throw new Error("L'URL OpenArt ne renvoie pas une image valide.");
  }
  return buf;
}

// Retourne { buffer, url } — l'URL sert de référence de visage pour les scènes suivantes.
export async function openartGenerate({ prompt, referenceUrls = [] }) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await runClaude(buildInstruction(prompt, referenceUrls));
      if (/^ERREUR\s*:/i.test(text)) {
        const cause = text.replace(/^ERREUR\s*:/i, '').trim();
        if (/credit|crédit/i.test(cause)) {
          throw new Error(`OpenArt : crédits insuffisants — ${cause}`);
        }
        if (/auth|connect|login|token/i.test(cause)) {
          throw new Error(
            `OpenArt : problème d'authentification MCP — relance \`claude\`, tape /mcp, et reconnecte "${MCP_NAME}". (${cause})`,
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
