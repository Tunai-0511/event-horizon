// Supernova scene helpers (shader: app/shaders/nova.frag, remnant library: app/shaders/remnant_lib.glsl).
//
// The climax of Act II is a 5-bar CRESCENDO (219.07 -> 238.02), then a hard stop. Every state function below takes
// the progress p in [0, 1] through its storyboard bar (and t = seconds into the shot, for camera shake) and returns
// { cam, u, post } ready for a shot's at(t). Exposure keys are tuned so the mean frame brightness keeps rising
// through each bar while the highlights keep their structure (no white-outs):
//   quiet(p)     215.28  (optional, the second dip bar) the quiet red supergiant, pushing in to the bounce framing
//   bounce(p)    219.07  the core bounce: a white-blue glow grows from within the red supergiant over ~1 s, the star
//                        turns translucent (radial shadows of its giant cells), a plasma bubble rises and fills it
//   breakout(p)  222.86  shock breakout: a flash front sweeps across the photosphere, the star swells into soft
//                        billowing lobes, bright rifts open, flames boil off
//   explosion(p) 226.65  the ejecta erupt: Rayleigh-Taylor fingers, the fireball grows until it overfills the frame
//   engulf(p)    230.44  the shell sweeps past the camera: radial streams rush by, a flash-through, then inside it
//   echoes(p)    234.23  peak: a ring of light races out through the dust sheets while the remnant blazes
//   stop(p)      238.02  hard stop: the light dies in ~0.4 s; embers, faint filaments, a black point at the centre
//   remnant(p)   241.77  (4 bars) centuries later: drift from outside through the filament net to the dark centre
// novaShots() builds the whole run (219.07 -> 256.82) as film shots on the real bar grid.
import { SKY, I3, rotYXZ } from '../u.js';
import { orbit, kf, ease, shake, lerp, norm, cross, sub, add, mul } from '../cam.js';
import { snap } from '../music.js';

// remnant_lib.glsl uniforms (shared with any scene that includes remnant_lib.glsl and calls remnantSky())
export const REMNANT = {
  uRemAmt: 1.0, uRemRot: rotYXZ(20, 35, 10), uRemSeed: 0.0, uRemLines: [1.0, 1.0, 1.0], uRemPatch: 0.55, uRemWidth: 0.007,
};

export const DEFAULTS = {
  ...SKY, ...REMNANT,
  uSkyAmt: 1, uNovaSeed: 0.0,
  // progenitor (radius 1)
  uStarT: 3300, uStarBright: 0.8, uConv: 1.0, uStarHS: 0.025, uBounce: 0, uBounceLum: 1.0, uBreakout: 0, uBoAxis: [-0.8, 0.35, 0.5],
  // ejecta (radius uExpand, in progenitor radii)
  uExpand: 0, uExpandBlur: 0, uFingers: 1.0, uEjT: 22000, uEjBright: 1.0, uEjOpacity: 1.0, uEjDense: 14, uCorePt: 1.0,
  uDim: 0, uHole: 0, uEmber: 0, uAge: 0,
  // light echoes
  uEcho: 0, uEchoAmt: 14.0, uEchoW: 420, uDust: 0, uDustR: 2000, uDustRot: I3,
};

// storyboard bar lines (snapped to the real grid in app/data/grid.json)
export const NOVA_BARS = {
  dip: snap(211.49), bounce: snap(219.07), breakout: snap(222.86), explosion: snap(226.65), engulf: snap(230.44),
  echoes: snap(234.23), stop: snap(238.02), remnant: snap(241.77), intro: snap(256.82),
};

// one sub-frame of the default shutter (0.5 at 30 fps, 4 sub-frames): the ejecta radius is jittered per pixel over it
const SUB = 0.5 / 30 / 4;
const BAR = 3.77;

// ---- ejecta radius through the explosion and engulf bars ----
// explosion: fast eruption that keeps going; engulf (the shell has grown during the cut): approach, a quick
// flash-through of the dense body, then inside it. echoes/stop continue at 760 -> 920.
export function explosionRadius(p) { return 1.3 + 92 * (1 - (1 - p) ** 2.2); }
export function engulfRadius(p) {
  return kf(p, [[0, 235], [0.42, 395, 'outQuad'], [0.52, 470, 'inOutSine'], [1, 720, 'outQuad']]);
}
const rate = (f, p, len) => (f(Math.min(1, p + 1e-3)) - f(Math.max(0, p - 1e-3))) / (2e-3 * len);

function withShake(cam, t, amp, freq, seed) {
  if (amp <= 1e-4) return cam;
  const s = shake(t, amp, freq, seed);
  return { ...cam, yaw: (cam.yaw || 0) + s.yaw, pitch: (cam.pitch || 0) + s.pitch, roll: (cam.roll || 0) + s.roll };
}

// ---- 215.28 (optional, second dip bar) the quiet star, so the climax opens on the bounce framing ----------------
export function quiet(p, t = p * BAR) {
  const cam = { pos: orbit([0, 0, 0], lerp(4.2, 3.75, ease.inOutSine(p)), 12 + 4 * p, 7), look: [0, 0, 0], fov: 40 };
  return { cam, u: { uBounce: 0 }, post: { exposure: 0.3, bloom: 0.1, scatter: 0.7, tm: 0.3, sat: 1.1 } };
}

// ---- 219.07 core bounce -----------------------------------------------------------------------------------
export function bounce(p, t = p * BAR) {
  const cam = { pos: orbit([0, 0, 0], lerp(3.75, 3.05, ease.inOutSine(p)), 16 + 7 * p, 7), look: [0, 0, 0], fov: 40 };
  return {
    cam: withShake(cam, t, 0.25 * kf(p, [[0, 0], [0.25, 1], [1, 0.3]]), 0.7, 3),
    u: { uBounce: p },
    // exposure follows the glow with a lag, so the frame keeps brightening (measured mean 0.22 -> 0.32 over the
    // bar) while the bubble stays readable: the crescendo starts here
    post: { exposure: kf(p, [[0, 0.3], [0.1, -0.4], [0.25, -2.4], [0.4, -3.6], [0.55, -4.5], [0.7, -5.3], [0.85, -5.9], [1, -6.3]]), bloom: 0.1, scatter: 0.7, tm: 0.3, sat: 1.1 },
  };
}

// ---- 222.86 shock breakout --------------------------------------------------------------------------------
export function breakout(p, t = p * BAR) {
  // the camera backs away as the star swells, keeping its torn silhouette in frame
  const pos = orbit([0, 0, 0], lerp(2.6, 3.6, ease.inOutSine(p)), 40 + 6 * p, 6);
  const fwd0 = norm(sub([0, 0, 0], pos)), right = norm(cross(fwd0, [0, 1, 0])), toCam = norm(pos);
  // the star sits frame-left with its right limb against black; the shock emerges on the far left and sweeps right
  const cam = { pos, look: add([0, 0, 0], mul(right, lerp(0.55, 0.45, p))), fov: 50 };
  const axis = norm(add(add(mul(right, -0.9), mul(toCam, 0.25)), [0, 0.2, 0]));
  return {
    cam: withShake(cam, t, kf(p, [[0, 0], [0.06, 1.2], [0.35, 0.5], [1, 0.25]]), 1.1, 11),
    // (the breakout starts from the ordinary-looking star: the shock is still inside, nothing shows yet)
    u: { uBounce: 0, uBreakout: Math.max(p, 1e-4), uBoAxis: axis },
    post: { exposure: kf(p, [[0, -2.4], [0.1, -2.9], [0.35, -2.5], [0.6, -0.9], [1, 0.0]]), bloom: 0.1, scatter: 0.7, tm: 0.4, sat: 1.25 },
  };
}

// ---- 226.65 explosion -------------------------------------------------------------------------------------
// fixed camera far away; the field of view opens as the fireball grows so that it keeps filling more of the frame
export function explosion(p, t = p * BAR) {
  const R = explosionRadius(p);
  const D = 175;
  const fill = lerp(0.6, 1.25, ease.inOutSine(p));
  const fov = (2 * Math.atan((0.62 * R) / (D * fill)) * 180) / Math.PI;
  const cam = { pos: orbit([0, 0, 0], D, 30, 9), look: [0, 0, 0], fov };
  return {
    cam: withShake(cam, t, kf(p, [[0, 1.6], [0.25, 0.6], [1, 0.25]]) * fov / 40, 1.4, 21),
    u: { uExpand: R, uExpandBlur: rate(explosionRadius, p, BAR) * SUB, uEjBright: lerp(1.0, 1.4, p), uStars: 0.5 },
    post: { exposure: kf(p, [[0, -2.0], [0.3, -1.5], [1, -1.2]]), bloom: 0.1, scatter: 0.7, tm: 0.25, sat: 1.2 },
  };
}

// ---- 230.44 engulf ----------------------------------------------------------------------------------------
export function engulf(p, t = p * BAR) {
  const R = engulfRadius(p);
  // sideways to the flow: the shell streams across the frame between the blazing interior (left) and black space
  const P = orbit([0, 0, 0], 260, 60, 5);
  const inward = norm(sub([0, 0, 0], P)), tangent = norm(cross(inward, [0, 1, 0]));
  const fwd = norm(add(mul(inward, lerp(0.55, 0.8, p)), mul(tangent, 0.85)));
  const cam = { pos: P, fwd, fov: lerp(70, 80, p) };
  return {
    cam: withShake(cam, t, kf(p, [[0, 0.3], [0.45, 1.6], [0.6, 1.4], [1, 0.3]]), 1.6, 31),
    u: { uExpand: R, uExpandBlur: rate(engulfRadius, p, BAR) * SUB, uEjBright: lerp(1.5, 2.2, p), uStars: 0.5 },
    post: { exposure: kf(p, [[0, -0.2], [0.45, -0.6], [0.56, -1.0], [0.7, 0.4], [1, 0.8]]), bloom: 0.1, scatter: 0.7, tm: 0.25, sat: 1.2 },
  };
}

// ---- 234.23 light echoes (the peak of the crescendo) ------------------------------------------------------
export function echoes(p, t = p * BAR) {
  // the remnant blazes at the centre while a ring of light sweeps outward through the surrounding dust sheets
  const cam = { pos: orbit([0, 0, 0], lerp(2250, 2000, ease.inOutSine(p)), 0, 0), look: [0, 0, 0], fov: 70 };
  return {
    cam: withShake(cam, t, 0.3, 0.6, 41),
    u: {
      uExpand: lerp(760, 900, p), uEjBright: lerp(2.6, 4.0, p), uCorePt: 3.0,
      uEcho: lerp(250, 1700, ease.outSine(p)), uEchoAmt: kf(p, [[0, 15], [0.3, 60], [1, 260, 'inQuad']]), uDust: 1, uStars: 0.8,
    },
    // still rising: the crescendo peaks at the end of this bar
    post: { exposure: kf(p, [[0, 0.3], [1, 1.9]]), bloom: kf(p, [[0, 0.12], [1, 0.18]]), scatter: 0.75, tm: 0.2, sat: 1.15 },
  };
}

// ---- 238.02 hard stop -------------------------------------------------------------------------------------
export function stop(p, t = p * BAR) {
  // hard stop: the light dies within ~0.4 s; embers, then the first filaments; a black point at the centre
  const cam = { pos: orbit([0, 0, 0], 2600, 18, 8), look: [0, 0, 0], fov: 45 };
  const R = lerp(905, 920, p);
  return {
    cam,
    u: {
      uExpand: R, uDim: kf(p, [[0, 0], [0.11, 1, 'outQuad']]), uAge: kf(p, [[0.11, 0], [1, 0.35, 'outSine']]),
      uEmber: kf(p, [[0, 0], [0.08, 1.2], [1, 0.45]]), uHole: 14, uCorePt: 0, uEjBright: 2.0, uStars: 0.45, uMilky: 0.6,
    },
    post: { exposure: kf(p, [[0, 0.2], [0.12, 1.6], [1, 2.0]]), bloom: 0.08, scatter: 0.7, sat: 1.0 },
  };
}

// ---- 241.77 -> 256.82 remnant (4 bars): from outside the shell, through the filaments, to the dark centre -------
export function remnant(p, t = p * 4 * BAR) {
  const d = lerp(2.3, 0.42, ease.inOutSine(p));
  const cam = { pos: orbit([0, 0, 0], d, 34 - 26 * p, 12 - 6 * p), look: [0, 0, 0], fov: lerp(46, 64, p) };
  return {
    cam,
    u: { uExpand: 1.0001, uAge: 1, uDim: 1, uCorePt: 0, uEmber: 0, uHole: 0.004, uStars: 0.7, uRemAmt: 1.2 },
    post: { exposure: 0.4, bloom: 0.08, scatter: 0.7, sat: 0.95 },
  };
}

// ---- film shots: 219.07 -> 256.82 on the bar grid -----------------------------------------------------------
const STAGES = [
  ['nova-bounce', 'bounce', 'breakout', bounce],
  ['nova-breakout', 'breakout', 'explosion', breakout],
  ['nova-explosion', 'explosion', 'engulf', explosion],
  ['nova-engulf', 'engulf', 'echoes', engulf],
  ['nova-echoes', 'echoes', 'stop', echoes],
  ['nova-stop', 'stop', 'remnant', stop],
  ['nova-remnant', 'remnant', 'intro', remnant],
];
export function novaShots({ spp = 4 } = {}) {
  return STAGES.map(([id, a, b, f]) => {
    const t0 = NOVA_BARS[a], t1 = NOVA_BARS[b];
    return {
      id, t0, t1, scene: 'nova', spp,
      at: (t) => { const s = f((t - t0) / (t1 - t0), t - t0); return { cam: s.cam, u: { ...DEFAULTS, ...s.u }, post: s.post }; },
    };
  });
}
