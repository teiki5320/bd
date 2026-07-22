import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { projectDir, listProjects, loadProject } from './projects.js';
import { tiktokCaption } from '../shared/catalog.js';

// Dossier d'export des épisodes validés : Bureau/Dramas/<Titre du drama>/
// EXPORT_DIR dans .env pour changer, avec le raccourci EXPORT_DIR=icloud
// qui vise iCloud Drive → Dramas (synchronisé sur tous les appareils).
function resolveExportRoot() {
  const raw = (process.env.EXPORT_DIR || '').trim();
  if (raw.toLowerCase() === 'icloud') {
    return path.join(
      os.homedir(),
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      'Dramas',
    );
  }
  return raw || path.join(os.homedir(), 'Desktop', 'Dramas');
}

export const EXPORT_ROOT = resolveExportRoot();
// Les dramas « Version Synchro » sont rangés à part (ex. iCloud/Dramas Synchro).
export const EXPORT_ROOT_SYNCHRO = `${EXPORT_ROOT} Synchro`;

export function exportRootFor(project) {
  return project && project.mode === 'synchro' ? EXPORT_ROOT_SYNCHRO : EXPORT_ROOT;
}

export function sanitizeName(s) {
  return (
    String(s || '')
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Drama'
  );
}

// Dossier d'export d'un drama (ex. iCloud Drive/Dramas/Ma Sœur, Mon Poison).
export function projectExportDir(project) {
  return path.join(exportRootFor(project), sanitizeName(project.title));
}

// Nom de fichier = légende TikTok (titre + hashtags) : TikTok pré-remplit la
// description avec le nom du fichier au moment de la publication.
function episodeFileName(project, episode) {
  const caption = tiktokCaption(project, episode)
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return `${caption}.mp4`;
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
    const dir = projectExportDir(project);
    fs.mkdirSync(dir, { recursive: true });
    // Supprime les anciens exports de CET épisode (ancien nom « Episode NN - … »
    // ou légende différente) pour éviter les doublons après renommage.
    const oldPrefix = `Episode ${String(episode.number).padStart(2, '0')}`;
    const newPrefix = `Épisode ${episode.number} `;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.mp4') && (f.startsWith(oldPrefix) || f.startsWith(newPrefix))) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
    }
    const dest = path.join(dir, episodeFileName(project, episode));
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
