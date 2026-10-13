// Test harness for the supernova (scene `nova`): one storyboard shot per second, each slot plays its whole bar
// (progress p = t - i), staged exactly like the film by app/src/scenes/nova.js.
import { DEFAULTS, bounce, breakout, explosion, engulf, echoes, stop, remnant } from '../scenes/nova.js';

const stages = [
  ['bounce', bounce],       // 219.07 core bounce
  ['breakout', breakout],   // 222.86 shock breakout
  ['explosion', explosion], // 226.65 ejecta
  ['engulf', engulf],       // 230.44 shell sweeps through the camera
  ['echoes', echoes],       // 234.23 light echoes (peak)
  ['stop', stop],           // 238.02 the light dies, black point
  ['remnant', remnant],     // 241.77 -> 256.82 centuries later: outside -> through the filaments -> the dark centre
];

export const shots = [
  ...stages.map(([id, f], i) => ({
    // a 1-s slot plays a 3.77-s bar: shorten the shutter so motion blur matches the film (0.5 of a 30-fps frame)
    id, t0: i, t1: i + 1, scene: 'nova', spp: 4, shutter: 0.5 / (i === 6 ? 4 * 3.77 : 3.77),
    at: (t) => { const p = Math.min(Math.max(t - i, 0), 1); const s = f(p, p * 3.77); return { cam: s.cam, u: { ...DEFAULTS, ...s.u }, post: s.post }; },
  })),
  // remnantSky() alone (what the black-hole scene gets as its lensed background), seen from the centre
  {
    id: 'remsky', t0: 7, t1: 8, scene: 'nova', spp: 4, defines: { REMSKY_ONLY: 1 },
    at: (t) => ({ cam: { pos: [0, 0, 0], fwd: [0.3 * Math.cos(t * 0.2), 0.2, -1], fov: 60 }, u: { ...DEFAULTS, uStars: 0.7 }, post: { exposure: 0.4, bloom: 0.08 } }),
  },
];
export const duration = 8;
