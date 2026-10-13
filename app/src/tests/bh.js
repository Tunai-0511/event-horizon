// Test harness for the black hole shader: one camera setup per second of "film time".
import { BH } from '../u.js';
import { orbit } from '../cam.js';

const views = [
  // [distance, azimuth, elevation, fov, extra uniforms]
  [32, 0, 4, 38, {}],
  [32, 0, 12, 38, {}],
  [22, 40, 2, 55, { uHaze: 0.6 }],
  [40, 0, 70, 32, {}],
  [60, 0, 1, 20, { uDisk: 0 }],
  [14, 0, 6, 70, {}],
  [32, 0, 4, 38, { uJet: 1, uJetLen: 300 }],
  [32, 0, 4, 38, { uDisk: 0, uShell: 1 }],
];

export const shots = views.map(([dist, az, el, fov, extra], i) => ({
  id: `bh${i}`, t0: i, t1: i + 1, scene: 'bh', spp: 4,
  at: (t) => ({
    cam: { pos: orbit([0, 0, 0], dist, az, el), look: [0, 0, 0], fov },
    u: { ...BH, ...extra },
    post: { exposure: -1.0, bloom: 0.06 },
  }),
}));
export const duration = views.length;
