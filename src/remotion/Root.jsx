import React from 'react';
import { Composition } from 'remotion';
import { Episode } from './Episode.jsx';
import { FPS, WIDTH, HEIGHT, episodeDurationInFrames } from './timing.js';

export const RemotionRoot = () => {
  return (
    <Composition
      id="Episode"
      component={Episode}
      durationInFrames={FPS * 60}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{
        episode: null,
        characters: [],
        assetBase: '',
        musicFile: null,
        seriesTitle: '',
      }}
      calculateMetadata={({ props }) => ({
        durationInFrames: episodeDurationInFrames(props.episode),
      })}
    />
  );
};
