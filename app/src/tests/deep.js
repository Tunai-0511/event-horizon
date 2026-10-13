import { SKY } from '../u.js';
const fwd = [0.31, 0.93, 0.2];
const fovs = [60, 8, 1.5, 0.4, 0.12, 0.04];
export const shots = fovs.map((fov, i) => ({
  id: `deep${i}`, t0: i, t1: i + 1, scene: 'space', spp: 4,
  at: () => ({ cam: { pos: [0, 0, 0], fwd, fov }, u: { ...SKY, uSkyAmt: 1, uGalDeep: 1, uGal: 1 }, post: { exposure: 0.6, bloom: 0.06 } }),
}));
export const duration = fovs.length;
