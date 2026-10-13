// Shot-building helpers shared by the act files.
import { BARS, ACT } from '../music.js';
import { camBasis } from '../cam.js';
import { shake, hit, kf, ramp, ease, orbit, lerp, add, sub, mul, norm, clamp, spline, cross, dot } from '../cam.js';

export { BARS, ACT, shake, hit, kf, ramp, ease, orbit, lerp, add, sub, mul, norm, clamp, spline, cross, dot };

// k-th bar line counted from the start of act `a` (bar 0 = first downbeat of the quiet section)
export function bar(a, k) {
  const i0 = BARS.findIndex((b) => b >= ACT[a].quiet - 0.3);
  const i = i0 + Math.floor(k), f = k - Math.floor(k);
  if (i + 1 >= BARS.length) return BARS[BARS.length - 1] + (i + f - (BARS.length - 1)) * 3.77;
  return BARS[i] + f * (BARS[i + 1] - BARS[i]);
}

// shot factory: fn(t, u, L) where u = 0..1 across the shot and L = seconds since its start
export function S(id, t0, t1, scene, fn, opts = {}) {
  return {
    id, t0, t1, scene, spp: opts.spp ?? 4, defines: opts.defines, overlay: opts.overlay, frag: opts.frag, shutter: opts.shutter, prepare: opts.prepare, dissolve: opts.dissolve,
    at: (t) => fn(t, (t - t0) / (t1 - t0), t - t0),
  };
}

// add hand-held / impact shake to a camera
export function shaken(cam, t, amp, freq = 1.1, seed = 0) {
  if (!amp) return cam;
  const s = shake(t, amp, freq, seed);
  return { ...cam, yaw: (cam.yaw || 0) + s.yaw, pitch: (cam.pitch || 0) + s.pitch, roll: (cam.roll || 0) + s.roll };
}

// decaying impulse summed over a list of hit times
export function kicks(t, times, decay = 0.7) { let s = 0; for (const x of times) if (t >= x) s += Math.exp(-(t - x) / decay); return s; }

// bar lines in [a, b)
export function barsBetween(a, b) { return BARS.filter((x) => x >= a - 0.05 && x < b - 0.05); }

// camera that orbits a centre with keyframed distance / azimuth / elevation
export function orbitCam(center, dist, az, el, fov, extra = {}) {
  return { pos: orbit(center, dist, az, el), look: center, fov, ...extra };
}

// Join two shots without a visible cut: `next` starts on `prev`'s last framing (camera, numeric uniforms, grading) and
// eases onto its own over `dur` seconds. Use it when two consecutive shots would otherwise read as a jump cut.
function lerpVal(a, b, w) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * w;
  if ((Array.isArray(a) || a instanceof Float32Array) && (Array.isArray(b) || b instanceof Float32Array) && a.length === b.length) return Array.from(a, (x, i) => x + (b[i] - x) * w);
  return b;
}
function lerpObj(a = {}, b = {}, w) { const o = { ...b }; for (const k in b) if (k in a) o[k] = lerpVal(a[k], b[k], w); return o; }
export function joinShots(prev, next, dur = 1.6) {
  const sA = prev.at(prev.t1 - 1e-3);
  const end = camBasis(sA.cam);
  const orig = next.at;
  return {
    ...next,
    at: (t) => {
      const st = orig(t);
      const w = ease.inOutSine(ramp(t, next.t0, next.t0 + dur));
      if (w >= 1) return st;
      const cb = camBasis(st.cam);
      const mix = (a, b) => a.map((x, i) => x + (b[i] - x) * w);
      return {
        ...st,
        cam: { pos: mix(end.pos, cb.pos), fwd: norm(mix(end.f, cb.f)), up: norm(mix(end.u, cb.u)), fov: end.fov + (cb.fov - end.fov) * w },
        u: lerpObj(sA.u, st.u, w),
        post: lerpObj(sA.post, st.post, w),
      };
    },
  };
}
// apply joinShots to the named shots of a list (each joined to the shot right before it)
export function joinNamed(list, ids, dur = 1.6) {
  const out = list.slice();
  for (let i = 1; i < out.length; i++) if (ids.includes(out[i].id)) out[i] = joinShots(out[i - 1], out[i], dur);
  return out;
}

// monotone cubic (PCHIP) through [x, y] keys: smooth, overshoot-free speed ramps
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
