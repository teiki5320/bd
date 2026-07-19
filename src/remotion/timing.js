// Constantes et calculs de durée partagés entre le Player (aperçu) et le rendu final.

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const TRANSITION_FRAMES = 12;
export const OUTRO_SECONDS = 2.6;

export const LINE_START_DELAY = 0.5; // secondes avant la première réplique d'une scène
export const LINE_GAP = 0.35; // pause entre deux répliques

export function sceneFrames(scene) {
  return Math.max(FPS, Math.round((scene.durationSec || 5) * FPS));
}

// Position de départ (en frames, relatives à la scène) de chaque réplique audio.
export function lineOffsets(scene) {
  const offsets = [];
  let t = LINE_START_DELAY;
  for (const line of scene.lines || []) {
    offsets.push(Math.round(t * FPS));
    t += (line.audioDurationSec || 2) + LINE_GAP;
  }
  return offsets;
}

export function episodeDurationInFrames(episode) {
  const scenes = episode?.scenes || [];
  if (scenes.length === 0) {
    return FPS * 3;
  }
  const scenesTotal = scenes.reduce((sum, sc) => sum + sceneFrames(sc), 0);
  const outro = Math.round(OUTRO_SECONDS * FPS);
  // TransitionSeries : les fondus se superposent, la durée totale est donc
  // la somme des séquences moins un fondu par coupe (scènes + carton de fin).
  const cuts = scenes.length; // scènes-1 coupes internes + 1 coupe vers l'outro
  return scenesTotal + outro - TRANSITION_FRAMES * cuts;
}
