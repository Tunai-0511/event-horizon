// The view of an observer falling freely into the hole (rain frame), across the horizon.
import { DEFAULTS } from '../scenes/bh.js';
import { orbit, norm, mul, cross } from '../cam.js';
const base = { ...DEFAULTS, uObsFall: 1, uDiskTime: 50, uDiskBright: 2.4 };
// [r, look ('in' | 'out' | 'side'), fov]
const views = [
  [1.2, 'in', 100], [0.9, 'in', 100], [0.5, 'in', 110], [0.2, 'in', 120],
  [0.9, 'side', 110], [0.5, 'side', 110], [0.2, 'side', 120], [0.05, 'side', 130],
  [0.9, 'out', 100], [0.5, 'out', 110], [0.2, 'out', 120], [0.05, 'in', 140],
];
export const shots = views.map(([r, look, fov], i) => {
  const pos = orbit([0, 0, 0], r, 20, 16);
  const out = norm(pos);
  const side = norm(cross([0, 1, 0], out));
  const fwd = look === 'out' ? out : look === 'in' ? mul(out, -1) : side;
  return {
    id: `ff${i}`, t0: i, t1: i + 1, scene: 'bh', spp: 2,
    at: () => ({ cam: { pos, fwd, up: look === 'side' ? out : [0, 1, 0], fov }, u: base, post: { exposure: -0.6, bloom: 0.1, tm: 0.7 } }),
  };
});
export const duration = views.length;
