import { SKY } from '../u.js';
const views = [
  // [fwd, fov, extra]
  [[1, -0.1, 0.3], 60, {}],          // toward the galactic centre
  [[-1, 0.1, -0.3], 60, {}],         // anticentre
  [[0.2, 1, 0.1], 70, {}],           // galactic pole
  [[1, -0.1, 0.3], 8, {}],           // zoom on the bulge
  [[0.3, 0.9, 0.2], 1.2, { uMilky: 0, uStars: 0.6 }], // deep field zoom
  [[1, -0.1, 0.3], 90, { uNebSky: 1 }],
];
export const shots = views.map(([fwd, fov, extra], i) => ({
  id: `sky${i}`, t0: i, t1: i + 1, scene: 'space', spp: 4,
  at: () => ({ cam: { pos: [0, 0, 0], fwd, fov }, u: { ...SKY, uSkyAmt: 1, ...extra }, post: { exposure: 0, bloom: 0.05 } }),
}));
export const duration = views.length;
