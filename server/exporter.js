import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { projectDir, listProjects, loadProject } from './projects.js';

// Dossier d'export des épisodes validés : Bureau/Dramas/<Titre du drama>/
// (modifiable avec EXPORT_DIR dans .env)
export const EXPORT_ROOT =
  process.env.EXPORT_DIR || path.join(os.homedir(), 'Desktop', 'Dramas');

function sanitizeName(s) {
  return (
    String(s || '')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Drama'
  );
}

// Copie le MP4 d'un épisode validé vers le dossier du drama sur le Bureau.
// Ne lève jamais : l'export ne doit pas faire échouer un rendu.
export function exportEpisode(project, episode) {
  try {
    if (!episode.renderedFile) {
      return null;
    }
    const src = path.join(projectDir(project.id), episode.renderedFile);
    if (!fs.existsSync(src)) {
      return null;
    }
    const dir = path.join(EXPORT_ROOT, sanitizeName(project.title));
    fs.mkdirSync(dir, { recursive: true });
    const name = `Episode ${String(episode.number).padStart(2, '0')}${
      episode.title ? ` - ${sanitizeName(episode.title)}` : ''
    }.mp4`;
    const dest = path.join(dir, name);
    fs.copyFileSync(src, dest);
    return dest;
  } catch (e) {
    console.error('Export Bureau impossible :', e.message);
    return null;
  }
}

// Synchronise tous les épisodes validés de tous les dramas (au démarrage,
// pour rattraper ceux produits avant l'existence de l'export).
export function exportAllProjects() {
  let copied = 0;
  try {
    for (const summary of listProjects()) {
      const project = loadProject(summary.id);
      if (!project) {
        continue;
      }
      for (const episode of project.episodes || []) {
        if (exportEpisode(project, episode)) {
          copied++;
        }
      }
    }
  } catch (e) {
    console.error('Synchronisation Bureau/Dramas :', e.message);
  }
  return copied;
}
