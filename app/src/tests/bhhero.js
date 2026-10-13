import { BH } from '../u.js';
import { orbit } from '../cam.js';
const base = { ...BH, uDiskTemp: 6200, uDiskBright: 2.2, uDiskTau: 2.5, uDoppler: 1.0, uBeam: 0.25, uDiskOut: 18, uDiskTime: 30, uMilky: 0.6, uStars: 0.8 };
const views = [
  [30, 10, 5, 34, { uDiskSat: 1.7 }, -0.5],
  [30, 10, 5, 34, { uDiskSat: 2.2 }, -0.5],
  [26, 35, 17, 42, { uDiskSat: 1.7 }, -0.5],
  [26, 35, 17, 42, { uDiskSat: 2.2 }, -0.5],
];
export const shots = views.map(([dist, az, el, fov, extra, ev], i) => ({
  id: `hero${i}`, t0: i, t1: i + 1, scene: 'bh', spp: 4,
  at: (t) => ({ cam: { pos: orbit([0, 0, 0], dist, az, el), look: [0, 0, 0], fov }, u: { ...base, ...extra }, post: { exposure: ev, bloom: 0.12, vignette: 0.4, sat: 1.05, tm: 0.7 } }),
}));
export const duration = views.length;
