// Test harness for the galaxy scene: every storyboard shot squeezed into a 1-second slot (u = 0..1 across the slot,
// film time mapped onto the real shot, shutter scaled so motion blur matches the film), then a few extra stills.
//   slot 0 pullback · 1 edge · 2 face · 3 indisk · 4 dip · 5 quasar · 6 jets · 7 ride · 8 cosmic · 9 freeze
//   10 inclined · 11 low angle · 12 nucleus · 13 quasar at the peak · 14 edge-on core (telephoto)
import { DEFAULTS, PLAN, STAGE, PRESETS, presetCam, T, quasarAt } from '../scenes/galaxy.js';

const story = PLAN.map(([id, t0, t1], i) => ({
  id: `g.${id}`, t0: i, t1: i + 1, scene: 'galaxy', spp: 4, shutter: 0.5 / (t1 - t0),
  at: (t) => { const u = Math.min(Math.max(t - i, 0), 1); return STAGE[id](t0 + u * (t1 - t0), u); },
}));

const n = story.length;
const still = (id, k, cam, u, post = {}) => ({
  id, t0: n + k, t1: n + k + 1, scene: 'galaxy', spp: 4,
  at: () => ({ cam, u: { ...DEFAULTS, uGrow: 0.6, ...u }, post: { exposure: 0, bloom: 0.06, vignette: 0.35, ...post } }),
});
const extra = [
  still('x.inclined', 0, presetCam(PRESETS.INCLINED), {}),
  still('x.low', 1, presetCam(PRESETS.LOW), {}),
  still('x.nucleus', 2, presetCam(PRESETS.NUCLEUS), { uResolve: 0.065, uGrow: 0.3, uStepK: 0.07, uSkyAmt: 0 }, { exposure: -2.0, contrast: 1.2 }),
  still('x.quasarpeak', 3, presetCam(PRESETS.QUASAR, { dist: 2.8 }), { uGrow: 1, uQuasar: quasarAt(T.peak), uJet: 1.2, uFlow: 2.0 }, { exposure: -2.3, bloom: 0.12 }),
  still('x.edgecore', 4, presetCam(PRESETS.EDGE_ON, { dist: 2.7, el: 1.9, fov: 12 }), { uStepK: 0.02 }, { exposure: 0.2 }),
];

export const shots = [...story, ...extra];
export const duration = n + extra.length;
