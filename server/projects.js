import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECTS_DIR } from './config.js';

export function newId() {
  return `p${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export function projectDir(id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) {
    throw new Error('Identifiant de projet invalide');
  }
  return path.join(PROJECTS_DIR, id);
}

export function assetsDir(id) {
  return path.join(projectDir(id), 'assets');
}

export function rendersDir(id) {
  return path.join(projectDir(id), 'renders');
}

export function createProjectDirs(id) {
  fs.mkdirSync(assetsDir(id), { recursive: true });
  fs.mkdirSync(rendersDir(id), { recursive: true });
}

export function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  const file = path.join(projectDir(project.id), 'project.json');
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  return project;
}

export function loadProject(id) {
  const file = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR)) {
    try {
      const p = loadProject(entry);
      if (p) {
        out.push({
          id: p.id,
          title: p.title,
          logline: p.logline,
          styles: p.styles,
          custom: Boolean(p.custom),
          stage: p.stage || 'production',
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          episodes: (p.episodes || []).map((e) => ({
            number: e.number,
            title: e.title,
            status: e.status,
            rendered: Boolean(e.renderedFile),
          })),
        });
      }
    } catch {
      // dossier incomplet — ignorer
    }
  }
  out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return out;
}

export function deleteProject(id) {
  fs.rmSync(projectDir(id), { recursive: true, force: true });
}

export function findEpisode(project, number) {
  return (project.episodes || []).find((e) => e.number === Number(number)) || null;
}

export function findScene(episode, sceneId) {
  return (episode.scenes || []).find((s) => s.id === sceneId) || null;
}
