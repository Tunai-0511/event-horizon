// Test shots for the nebula scene: one test shot per storyboard cut of Act I (38.05-143.54), each compressed into its
// own 1-second slot (t in [i, i+1) maps onto the cut's full film-time range, so motion and story uniforms play out).
// The staging itself lives in app/src/scenes/nebula.js (act1Shots / CAMS / storyState).
import { act1Shots } from '../scenes/nebula.js';

const film = act1Shots({ spp: 4 });
export const shots = film.map((s, i) => ({
  ...s, id: `neb${i}_${s.id.slice(4)}`, t0: i, t1: i + 1,
  at: (t) => s.at(s.t0 + Math.min(Math.max(t - i, 0), 0.9999) * (s.t1 - s.t0)),
}));
export const duration = shots.length;
