import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const PROJECTS_DIR = path.join(ROOT, 'projects');
export const DIST_DIR = path.join(ROOT, 'dist');
export const PORT = Number(process.env.PORT || 4600);
export const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'pollinations').toLowerCase();

// Charge un éventuel fichier .env (simple, sans dépendance)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

fs.mkdirSync(PROJECTS_DIR, { recursive: true });
