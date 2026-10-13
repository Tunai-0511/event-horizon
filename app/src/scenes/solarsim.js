// Our solar system falling into the hole — playback of the N-body integration (tools/sph/solar.py -> data/sim/solar.json).
// Bodies are point sources ray-traced by bh.frag (HAS_SOLAR, so their light is lensed); their recent paths are drawn as
// long-exposure trails. Nothing here is posed by hand: every position comes from the integration.
import solar from '../../data/sim/solar.json' with { type: 'json' };
import { Trails } from '../trails.js';

const T = solar.t;
const NB = solar.names.length;               // 0 = Sun, 1..8 planets
const B = Array.from({ length: NB }, (_, k) => solar[`b${k}`]);
export const T_SUN = solar.t_capture;
export const CAPTURE = solar.capture;         // planet -> time it reached the horizon
export const ECL_N = [0, Math.cos((28 * Math.PI) / 180), Math.sin((28 * Math.PI) / 180)];
const FLUX = [9000, 140, 420, 380, 170, 520, 330, 130, 120];
export const COLORS = [[1, 0.9, 0.75], [0.8, 0.76, 0.72], [1.0, 0.88, 0.7], [0.42, 0.66, 1.0], [1.0, 0.52, 0.32], [1.0, 0.84, 0.64], [1.0, 0.86, 0.58], [0.58, 0.9, 1.0], [0.42, 0.58, 1.0]];

function idx(t) {
  let lo = 0, hi = T.length - 1;
  if (t <= T[0]) return [0, 0];
  if (t >= T[hi]) return [hi, 1];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  return [lo, (t - T[lo]) / (T[lo + 1] - T[lo])];
}
export function bodyAt(k, t) {
  const [i, f] = idx(t);
  const a = B[k][i], b = B[k][Math.min(i + 1, T.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export function velAt(k, t, dt = 0.02) {
  const a = bodyAt(k, t - dt), b = bodyAt(k, t + dt);
  return a.map((x, i) => (b[i] - x) / (2 * dt));
}
// simulation time at which the Sun first comes within radius R of the hole
export function timeAtRadius(R) {
  let lo = 0, hi = T.length - 1;
  const r = (i) => Math.hypot(...B[0][i]);
  if (r(0) <= R) return T[0];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r(m) > R && T[m] <= T_SUN) lo = m; else hi = m; }
  const ra = r(lo), rb = r(hi);
  return T[lo] + (T[hi] - T[lo]) * (ra - R) / Math.max(ra - rb, 1e-12);
}
const swallowedAt = (k) => (k === 0 ? T_SUN : CAPTURE[solar.names[k]] ?? Infinity);

// uniforms for bh.frag HAS_SOLAR at simulation time tau. dTau = simulation time per film second (for motion streaks).
export function solarUniforms(tau, dTau, { planetGain = 1, sunFlux = FLUX[0] } = {}) {
  const uPl = new Float32Array(32), uPlVel = new Float32Array(24), uPlHeat = new Float32Array(8);
  for (let k = 1; k < NB; k++) {
    const p = bodyAt(k, tau), v = velAt(k, tau).map((x) => x * dTau);
    const gone = tau >= swallowedAt(k);
    uPl.set([...p, gone ? 0 : FLUX[k] * planetGain], (k - 1) * 4);
    uPlVel.set(v, (k - 1) * 3);
  }
  const S = bodyAt(0, tau);
  return {
    uSunPos: S, uSunVel: velAt(0, tau).map((x) => x * dTau), uSunFlux: tau >= T_SUN ? 0 : sunFlux, uSunTemp: 5800,
    uPl, uPlVel, uPlHeat, uOrb: new Float32Array(32), uOrbPh: new Float32Array(8), uEclN: ECL_N, uEclX: [1, 0, 0], uOrbW: 1, uOrbR: 0.01,
    uTrAmt: new Float32Array(9), uTrHead: new Float32Array(9), uTrTail: new Float32Array(9), uPathR: new Float32Array(96),
    uPathPhi0: 0, uPathPhi1: 1, uPathN: [0, 1, 0], uPathE1: [1, 0, 0],
  };
}

// long-exposure trails: each body's path over the last `win` of simulation time (newest first)
// coMoving: the exposure is taken by a camera riding with the Sun, so the trails record positions relative to it
// (orbits); otherwise they are paths in the hole's rest frame
// orbital periods in simulation time (r_s/c), for choosing exposures
export const PERIOD = [0, 0.241, 0.615, 1.0, 1.881, 11.86, 29.46, 84.0, 164.8].map((y) => y * 2138);
// win: exposure (simulation time) as a number or a function of the body index
export function trailLines(tau, win, { gain = 1, sun = false, coMoving = true } = {}) {
  const lines = [];
  const S0 = bodyAt(0, Math.min(tau, T_SUN - 0.05));
  for (let k = sun ? 0 : 1; k < NB; k++) {
    const w = Math.min(typeof win === 'function' ? win(k) : win, tau);
    const tEnd = Math.min(tau, swallowedAt(k));
    if (tau - w > tEnd || w <= 0) continue;
    // enough samples for ~64 per revolution (the paths stay smooth however many turns the exposure holds)
    const K = Math.min(4000, Math.max(48, Math.ceil((64 * w) / Math.max(PERIOD[k] || 1, 1)) + 1));
    const pts = [];
    for (let j = 0; j < K; j++) {
      const tt = tEnd - (w * j) / (K - 1);
      if (tt < 0) break;
      const p = bodyAt(k, tt);
      if (coMoving) { const s = bodyAt(0, Math.min(tt, T_SUN - 0.05)); pts.push([p[0] - s[0] + S0[0], p[1] - s[1] + S0[1], p[2] - s[2] + S0[2]]); }
      else pts.push(p);
    }
    if (pts.length > 1) lines.push({ pts, color: COLORS[k], intensity: (k === 3 ? 1.1 : k >= 5 ? 0.95 : 0.7) * gain });
  }
  return lines;
}

// an overlay hook for shots: draws the trails into the HDR sub-frame
export function trailOverlay(getLines, extra = {}) {
  let tr = null;
  return (engine, st, cb) => {
    tr ??= new Trails(engine.gl);
    tr.set(getLines(cb.t));
    tr.draw(engine, cb, extra);
  };
}

// monotone cubic (PCHIP) through [x, y] keys
export function pchip(keys) {
  const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (3 * (d[i - 1] + d[i])) / ((2 * d[i] + d[i - 1]) / d[i - 1] + (d[i] + 2 * d[i - 1]) / d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const h00 = 2 * t ** 3 - 3 * t * t + 1, h10 = t ** 3 - 2 * t * t + t, h01 = -2 * t ** 3 + 3 * t * t, h11 = t ** 3 - t * t;
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
  };
}
