// Galaxy scene (act IV, 474.75–527.50): the grown black hole at the heart of a spiral galaxy, which becomes a quasar.
// Units: GU — the visible stellar disk ends near r = 1 (~15 kpc); disk in the xz plane, rotation axis +y, jets along +-y.
//
// Exports
//   DEFAULTS            every uniform of galaxy.frag (+ the intergalactic sky) with sane values
//   PRESETS / presetCam camera presets in galaxy units
//   T                   film times of the storyboard shots (bar grid)
//   growAt, quasarAt, jetAt, flowAt, spinAt   animation state as functions of absolute film time
//   STAGE.<shot>(t, u)  -> { cam, u, post } for absolute film time t and shot progress u (0..1)
//   shots               the storyboard shots, ready to drop into the timeline (replaces the '4.todo' placeholder)
import { SKY } from '../u.js';
import { orbit, kf, ramp, shake, lerp, clamp, noise1 } from '../cam.js';
import { bar } from '../shots/kit.js';

export const DEFAULTS = {
  ...SKY,
  // intergalactic background: no Milky Way, faint stars, deep-field galaxies
  uMilky: 0, uStars: 0.08, uGal: 1.0, uGalDeep: 0, uSkyAmt: 1,
  // galaxy structure
  uSpin: 0, uPitch: 17, uArms: 2, uBulge: 1, uDiskAmt: 1, uYoung: 1, uHII: 1, uDust: 1, uGalSeed: 0,
  // resolved stars around the camera (0 = off) + march quality
  uResolve: 0, uStarAmt: 0.35, uStepK: 0.03,
  // nucleus / quasar / jets
  uGrow: 0, uQuasar: 0, uJet: 0, uFlow: 0, uFlowBlur: 0.004, uBeam: 0.6, uLobe: 1, uJetAmt: 1,
};

// ---------------------------------------------------------------------------------------------- cameras
// orbit presets around a look point: dist (GU), az / el (deg), fov (vertical deg), roll (deg)
export const PRESETS = {
  FACE_ON: { dist: 3.3, az: 0, el: 82, fov: 40 },
  INCLINED: { dist: 3.0, az: 35, el: 35, fov: 40 },
  LOW: { dist: 2.6, az: 60, el: 10, fov: 40 },
  EDGE_ON: { dist: 2.8, az: 10, el: 1.5, fov: 32 },
  CORE_LOW: { dist: 1.2, az: 42, el: 6, fov: 20 },        // long lens, just above the plane: bulge rising over the dust lane
  NUCLEUS: { dist: 0.08, az: 30, el: 35, fov: 45 },       // inside the bulge, above the nuclear dust spiral
  QUASAR: { dist: 2.5, az: 50, el: 28, fov: 40 },
  JETS: { dist: 3.6, az: 105, el: 10, fov: 45, look: [0, 0.3, 0] },
  COSMIC: { dist: 14.5, az: 75, el: 28, fov: 45, roll: -80, look: [0, 1.6, 0] },   // look shifted: the near lobe is larger in perspective
};
export function presetCam(p, over = {}) {
  const q = { ...p, ...over };
  const look = q.look ?? [0, 0, 0];
  return { pos: orbit(look, q.dist, q.az, q.el), look, fov: q.fov, roll: q.roll ?? 0 };
}
export const orbitCam = (dist, az, el, fov = 40, look = [0, 0, 0], roll = 0) => ({ pos: orbit(look, dist, az, el), look, fov, roll });
// inside the disk, at radius r and height y, looking at the core
export const inDiskCam = (r, az, y = 0.004, fov = 60, lookY = 0.0) => ({ pos: orbit([0, 0, 0], r, az, 0).map((v, i) => (i === 1 ? y : v)), look: [0, lookY, 0], fov });

// ---------------------------------------------------------------------------------------------- timing
const B = (k) => bar(3, k);
export const T = {
  start: B(24), edge: B(27), face: B(28), indisk: B(29), dip: B(30), quasar: B(32), jets: B(33), ride: B(34), cosmic: B(35), peak: B(36), freeze: B(37), end: B(38),
};
T.launch = T.quasar + 0.9;   // the jets leave the nucleus ~1 s after the ignition downbeat

// ---------------------------------------------------------------------------------------------- state
// The climax (504.89–523.73) is a 5-bar crescendo, not a slam: every curve below is continuous, keeps climbing to a peak
// on the last bar (519.96) and is frozen from the stop (523.73). Nothing is allowed to white out the frame.
const hold = (t) => Math.min(t, T.freeze);
// nucleus activity grows over the build, saturates for the dip
export const growAt = (t) => 0.2 + 0.8 * ramp(t, T.start, T.dip, 'inOutSine');
// quasar: faint flickers in the dip, ignition unfolding over ~1.8 s from the downbeat, then a slow climb to the peak
export function quasarAt(t) {
  t = hold(t);
  const flick = clamp(0.55 + 0.45 * noise1(t * 3.1) + 0.2 * noise1(t * 7.3 + 7.0), 0, 1.3);   // slow, uneven pulses
  const pre = 0.1 * ramp(t, T.dip + 2.0, T.quasar, 'inQuad') * flick;
  const main = kf(t, [[T.quasar, 0.1], [T.quasar + 1.8, 1.0, 'inOutSine'], [T.peak, 1.5, 'smooth'], [T.freeze, 1.6, 'outSine']]);
  return lerp(pre, main, ramp(t, T.quasar, T.quasar + 0.6, 'smooth'));
}
// jet length (galaxy radii): leaves the nucleus ~1 s after the downbeat, its head moving outward the whole climax
// (fast at first, decelerating), reaching the full 8 radii at the stop
export const jetAt = (t) => { const x = ramp(hold(t), T.launch, T.freeze, 'lin'); return t < T.launch ? 0 : 8.0 * (1 - Math.pow(1 - x, 1.5)); };
// jets / lobes brighten with the music
export const jetAmtAt = (t) => lerp(0.7, 1.25, ramp(hold(t), T.launch, T.peak, 'inOutSine'));
export const lobeAt = (t) => lerp(0.55, 1.3, ramp(hold(t), T.ride, T.peak, 'inOutSine'));
// jet flow clock: runs from the launch, frozen for the final hold
export const flowAt = (t) => clamp(t, T.launch, T.freeze) - T.launch;
// the disk turns slowly ("eons pass")
export const spinAt = (t) => 0.02 * (t - T.start);

const base = (t) => ({ ...DEFAULTS, uSpin: spinAt(hold(t)), uGrow: growAt(t), uQuasar: quasarAt(t), uJet: jetAt(t), uFlow: flowAt(t), uJetAmt: jetAmtAt(t), uLobe: lobeAt(t) });
const POST = { exposure: 0, bloom: 0.06, vignette: 0.35, grain: 0.012 };
const ex = (lo, hi, u) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * u);   // exponential dolly

// ---------------------------------------------------------------------------------------------- staging
export const STAGE = {
  // eons pass: pull back from beside the nucleus (inside the bulge) until the whole galaxy hangs in the frame
  pullback(t, u) {
    const e = 1 - Math.pow(Math.max(1 - u, 0), 1.8);     // leaves the core briskly, settles on the wide view
    const d = ex(PRESETS.NUCLEUS.dist, 3.1, e);
    const cam = orbitCam(d, lerp(30, 75, e), lerp(35, 30, e), lerp(45, 38, e));
    const res = 0.065 * (1 - ramp(d, 0.2, 0.6));
    return { cam, u: { ...base(t), uResolve: res, uStepK: lerp(0.07, 0.03, ramp(d, 0.3, 1.0)), uSkyAmt: ramp(d, 0.25, 0.8) }, post: { ...POST, exposure: lerp(-2.0, 0.0, ramp(e, 0, 0.75, 'smooth')), contrast: lerp(1.2, 1.0, e) } };
  },
  // edge-on: the dust lane splits the disk, the bulge rises above and below it
  edge(t, u) {
    const cam = presetCam(PRESETS.EDGE_ON, { dist: lerp(2.85, 2.6, u), el: lerp(1.2, 2.6, u), az: lerp(8, 13, u) });
    return { cam, u: { ...base(t), uStepK: 0.012 }, post: { ...POST, exposure: 0.3 } };     // grazing: finer steps (cheap view)
  },
  // face-on: the spiral turning
  face(t, u) {
    const cam = presetCam(PRESETS.FACE_ON, { dist: lerp(3.35, 3.2, u), el: lerp(78, 84, u), az: lerp(-6, 6, u) });
    return { cam, u: base(t), post: POST };
  },
  // inside the disk near the core: the galaxy as our own Milky Way, the bulge ahead, resolved stars around us
  indisk(t, u) {
    const cam = inDiskCam(lerp(0.42, 0.37, u), lerp(28, 31, u), 0.004, 60, lerp(0.0, 0.006, u));
    return { cam, u: { ...base(t), uResolve: 0.12, uStepK: 0.11, uStars: 0, uGal: 0 }, post: { ...POST, exposure: -0.3, contrast: 1.12 } };
  },
  // dip: the core, quiet — the bulge glowing behind the dust lane, the active nucleus; slow push
  dip(t, u) {
    const e = ramp(u, 0, 1, 'inOutSine');
    const cam = presetCam(PRESETS.CORE_LOW, { dist: ex(1.45, 0.95, e), el: lerp(6.5, 5.5, e), az: lerp(38, 46, e), fov: lerp(18, 21, e) });
    return { cam, u: { ...base(t), uStepK: 0.05 }, post: { ...POST, exposure: -0.95, contrast: 1.15 } };
  },
  // quasar ignition: the nucleus brightens over ~2 s until it outshines the galaxy (the exposure follows it down so the
  // frame never whites out); the jets start to pierce out of the core in the second half of the bar
  quasar(t, u) {
    const L = t - T.quasar;
    const cam = presetCam(PRESETS.QUASAR, { dist: lerp(2.35, 2.8, ramp(u, 0, 1, 'inOutSine')), az: lerp(50, 56, u), el: lerp(28, 30, u) });
    const s = shake(t, 0.25 * ramp(L, 0.3, 1.8, 'smooth'), 1.6, 3);
    return {
      cam: { ...cam, yaw: s.yaw, pitch: s.pitch, roll: s.roll },
      u: base(t),
      post: { ...POST, exposure: kf(L, [[0, -1.0], [2.0, -2.3, 'inOutSine'], [3.77, -2.25]]), bloom: 0.12 },
    };
  },
  // twin jets erupt along the rotation axis and pierce out of the disk
  jets(t, u) {
    const e = ramp(u, 0, 1, 'smooth');
    const cam = presetCam(PRESETS.JETS, { dist: lerp(2.6, 3.8, e), az: lerp(100, 110, e), el: lerp(9, 12, e), look: [0, lerp(0.15, 0.6, e), 0] });
    return { cam, u: base(t), post: { ...POST, exposure: lerp(-2.0, -1.6, e), bloom: 0.1 } };
  },
  // ride the jet: alongside the beam, looking back down at the galaxy; shock knots overtake us and rush past
  ride(t, u) {
    const y = lerp(0.9, 4.6, ramp(u, 0, 1, 'inSine'));
    const cam = { pos: [0.15, y, 0.06], look: [-0.05, y + 1.2, -0.02], fov: 64, roll: lerp(-12, -28, u) };
    return { cam, u: { ...base(t), uFlowBlur: 0.008, uBeam: 0.3 }, post: { ...POST, exposure: lerp(-1.0, -1.7, ramp(u, 0.4, 1)), bloom: 0.1 } };
  },
  // cosmic scale: pull back until the galaxy is a speck impaled on jets eight times its size
  cosmic(t, u) {
    const e = ramp(u, 0, 1, 'inOutSine');
    const cam = presetCam(PRESETS.COSMIC, { dist: ex(5.0, 14.5, e), el: lerp(22, 28, e), az: lerp(68, 75, e), roll: lerp(-66, -80, e), look: [0, 1.6 * e, 0] });
    return { cam, u: base(t), post: { ...POST, exposure: lerp(-1.0, -0.55, e), bloom: 0.08 } };
  },
  // the music stops: the frame freezes (flow clock stopped)
  freeze(t, u) {
    const st = STAGE.cosmic(T.freeze, 1);
    return { cam: st.cam, u: { ...st.u, uFlowBlur: 0 }, post: st.post };
  },
};

// storyboard order: [id, t0, t1]
export const PLAN = [
  ['pullback', T.start, T.edge], ['edge', T.edge, T.face], ['face', T.face, T.indisk], ['indisk', T.indisk, T.dip],
  ['dip', T.dip, T.quasar], ['quasar', T.quasar, T.jets], ['jets', T.jets, T.ride], ['ride', T.ride, T.cosmic],
  ['cosmic', T.cosmic, T.freeze], ['freeze', T.freeze, T.end],
];

// the shots, ready for the timeline
export const shots = PLAN.map(([id, t0, t1]) => ({
  id: `4.gal.${id}`, t0, t1, scene: 'galaxy', spp: 4,
  at: (t) => STAGE[id](t, (t - t0) / (t1 - t0)),
}));
