import React from 'react';
import { AbsoluteFill, Audio, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { Scene } from './Scene.jsx';
import { FPS, TRANSITION_FRAMES, OUTRO_SECONDS, sceneFrames } from './timing.js';

const Outro = ({ title, cliffhanger }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 0.5 * fps], [0, 1], {
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(ellipse at 50% 35%, #241a0c 0%, #090705 75%)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
        padding: 80,
      }}
    >
      {cliffhanger ? (
        <div
          style={{
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#e8dcb8',
            fontSize: 46,
            textAlign: 'center',
            lineHeight: 1.4,
            marginBottom: 70,
          }}
        >
          « {cliffhanger} »
        </div>
      ) : null}
      <div
        style={{
          fontFamily: 'Georgia, serif',
          fontWeight: 700,
          color: '#d4af37',
          fontSize: 72,
          letterSpacing: 10,
          textTransform: 'uppercase',
        }}
      >
        À suivre…
      </div>
      <div
        style={{
          fontFamily: 'Helvetica, Arial, sans-serif',
          color: '#7d6f4d',
          fontSize: 32,
          marginTop: 40,
          letterSpacing: 3,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

export const Episode = ({ episode, characters, assetBase, musicFile, seriesTitle }) => {
  const scenes = episode?.scenes || [];

  if (scenes.length === 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#0c0a08', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#9c8a5a', fontSize: 48, fontFamily: 'Georgia, serif' }}>Épisode vide</div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#0c0a08' }}>
      {musicFile ? (
        <Audio
          src={`${assetBase}/${musicFile}`}
          loop
          volume={0.12}
        />
      ) : null}
      <TransitionSeries>
        {scenes.flatMap((scene, i) => {
          const parts = [
            <TransitionSeries.Sequence key={`scene-${i}`} durationInFrames={sceneFrames(scene)}>
              <Scene
                scene={scene}
                characters={characters}
                assetBase={assetBase}
                isFirst={i === 0}
                episodeTitle={episode.title}
                episodeNumber={episode.number}
              />
            </TransitionSeries.Sequence>,
            <TransitionSeries.Transition
              key={`tr-${i}`}
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />,
          ];
          return parts;
        })}
        <TransitionSeries.Sequence durationInFrames={Math.round(OUTRO_SECONDS * FPS)}>
          <Outro title={seriesTitle} cliffhanger={episode.cliffhanger} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
