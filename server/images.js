import fs from 'node:fs';
import { IMAGE_PROVIDER } from './config.js';

// Format vertical 9:16 — dimensions raisonnables pour la génération.
const IMG_WIDTH = 768;
const IMG_HEIGHT = 1344;

export function currentProvider() {
  return IMAGE_PROVIDER;
}

async function fetchWithRetry(doFetch, { attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await doFetch();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function pollinations(prompt, seed) {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${IMG_WIDTH}&height=${IMG_HEIGHT}&nologo=true&model=flux&seed=${seed}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) {
    throw new Error(`Pollinations a répondu ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) {
    throw new Error('Image Pollinations invalide (réponse trop courte).');
  }
  return buf;
}

async function fal(prompt) {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error('IMAGE_PROVIDER=fal mais FAL_KEY est vide dans .env');
  }
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      Authorization: `Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: IMG_WIDTH, height: IMG_HEIGHT },
      num_images: 1,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) {
    throw new Error(`fal.ai a répondu ${res.status} : ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const imageUrl = data.images && data.images[0] && data.images[0].url;
  if (!imageUrl) {
    throw new Error('fal.ai : aucune image dans la réponse.');
  }
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(120000) });
  if (!imgRes.ok) {
    throw new Error(`Téléchargement de l'image fal.ai : ${imgRes.status}`);
  }
  return Buffer.from(await imgRes.arrayBuffer());
}

// Génère une image et l'écrit dans outPath. Retourne true, ou false en mode manuel.
export async function generateImage(prompt, outPath, { seed = Math.floor(Math.random() * 1e9) } = {}) {
  if (IMAGE_PROVIDER === 'manual') {
    return false;
  }
  const buf = await fetchWithRetry(() =>
    IMAGE_PROVIDER === 'fal' ? fal(prompt) : pollinations(prompt, seed),
  );
  fs.writeFileSync(outPath, buf);
  return true;
}
