import path from 'node:path';
import { ROOT, PORT } from './config.js';
import { rendersDir, saveProject } from './projects.js';
import { exportEpisode } from './exporter.js';
import { loadStudio } from './studio.js';

let bundlePromise = null;

async function getBundle() {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import('@remotion/bundler');
      return bundle({
        entryPoint: path.join(ROOT, 'src', 'remotion', 'index.jsx'),
        onProgress: () => {},
      });
    })();
    bundlePromise.catch(() => {
      bundlePromise = null;
    });
  }
  return bundlePromise;
}

export function buildEpisodeProps(project, episode, assetBase, studioBase) {
  return {
    episode: {
      number: episode.number,
      title: episode.title,
      cliffhanger: episode.cliffhanger,
      scenes: episode.scenes,
    },
    characters: project.characters,
    assetBase,
    musicFile: project.musicFile,
    seriesTitle: project.title,
    // Marque de l'auteur (sticker + outro), commune à tous les dramas.
    studio: loadStudio(),
    studioBase: studioBase || '',
  };
}

export async function renderEpisode(project, episode, update) {
  update('Préparation du moteur de rendu…');
  const serveUrl = await getBundle();

  const { renderMedia, selectComposition } = await import('@remotion/renderer');
  const inputProps = buildEpisodeProps(
    project,
    episode,
    `http://127.0.0.1:${PORT}/files/${project.id}`,
    `http://127.0.0.1:${PORT}/studio`,
  );

  update('Analyse de la composition…');
  const composition = await selectComposition({
    serveUrl,
    id: 'Episode',
    inputProps,
    browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || undefined,
  });

  const outName = `episode-${episode.number}.mp4`;
  const outputLocation = path.join(rendersDir(project.id), outName);

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || undefined,
    onProgress: ({ progress }) => {
      update(`Rendu de la vidéo… ${Math.round(progress * 100)} %`, progress);
    },
  });

  episode.renderedFile = `renders/${outName}`;
  episode.status = 'done';
  saveProject(project);

  update('Copie dans Bureau/Dramas…');
  const exported = exportEpisode(project, episode);
  if (exported) {
    episode.exportedTo = exported;
    saveProject(project);
  }

  return { file: episode.renderedFile, exportedTo: exported };
}
