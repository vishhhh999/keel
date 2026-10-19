import React from 'react';
import Svg, { Path, G } from 'react-native-svg';
import { COLORS } from './model';

/** The Keel mark. `tilt` in degrees: 6 live, 12 weak, 18 holding. Bottom half stays level. */
export function Mark({ size = 84, tilt = 6, bottom = COLORS.bone }: { size?: number; tilt?: number; bottom?: string }) {
  return (
    <Svg width={size} height={(size * 110.2) / 92} viewBox="0 0 92 110.2">
      <G transform="translate(46 52.21)">
        <G transform={`translate(0 -6.21) rotate(${-tilt})`}>
          <Path d="M-46 0A46 46 0 0 1 46 0Z" fill={COLORS.buoy} />
        </G>
        <Path d="M-46 12H46A46 46 0 0 1 -46 12Z" fill={bottom} />
      </G>
    </Svg>
  );
}
