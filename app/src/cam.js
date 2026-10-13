// Camera + animation math used by the shot definitions.

export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const mul = (a, s) => a.map((x) => x * s);
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(...a);
export const norm = (a) => { const l = len(a) || 1; return a.map((x) => x / l); };
export const lerp = (a, b, t) => (Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * t) : a + (b - a) * t);
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const deg = Math.PI / 180;

function rotAxis(v, k, ang) { // Rodrigues
  const c = Math.cos(ang), s = Math.sin(ang), kv = cross(k, v), kd = dot(k, v);
  return v.map((x, i) => x * c + kv[i] * s + k[i] * kd * (1 - c));
}

// cam: { pos, look | fwd, up=[0,1,0], fov (vertical deg), roll (deg), yaw/pitch offsets (deg, applied after look) }
export function camBasis(cam) {
  const pos = cam.pos;
  let f = norm(cam.fwd ?? sub(cam.look, pos));
  const up0 = cam.up ?? [0, 1, 0];
  let r = norm(cross(f, up0));
  let u = cross(r, f);
  if (cam.yaw) { f = rotAxis(f, u, -cam.yaw * deg); r = norm(cross(f, u)); }
  if (cam.pitch) { f = rotAxis(f, r, cam.pitch * deg); u = cross(r, f); }
  if (cam.roll) { r = rotAxis(r, f, cam.roll * deg); u = rotAxis(u, f, cam.roll * deg); }
  return { pos, rot: [...r, ...u, ...f], fov: cam.fov ?? 45, f, r, u };
}

// spherical placement around a centre: azimuth around +y from +z, elevation above the xz plane
export function orbit(center, dist, azDeg, elDeg) {
  const a = azDeg * deg, e = elDeg * deg;
  return [center[0] + dist * Math.cos(e) * Math.sin(a), center[1] + dist * Math.sin(e), center[2] + dist * Math.cos(e) * Math.cos(a)];
}

// ---- easing ----
export const ease = {
  lin: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outSine: (t) => Math.sin((t * Math.PI) / 2),
  inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};

// keyframes: kf(t, [[t0, v0], [t1, v1, 'ease'], ...]) — the ease on a key shapes the segment arriving at it
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e = 'smooth'] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const u = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return lerp(v0, v1, (typeof e === 'function' ? e : ease[e])(u));
    }
  }
  return keys[keys.length - 1][1];
}

// 0..1 ramp between a and b with easing
export function ramp(t, a, b, e = 'smooth') { return (typeof e === 'function' ? e : ease[e])(clamp((t - a) / (b - a))); }

// impulse that jumps to 1 at t0 and decays exponentially (seconds)
export function hit(t, t0, decay = 0.6) { return t < t0 ? 0 : Math.exp(-(t - t0) / decay); }

// smooth 1D value noise in [-1,1]
function h1(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
export function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return h1(i) * (1 - u) + h1(i + 1) * u; }
// hand-held / impact shake: returns {yaw, pitch, roll} in degrees
export function shake(t, amp, freq = 1.3, seed = 0) {
  return {
    yaw: amp * (noise1(t * freq + seed) * 0.7 + noise1(t * freq * 2.7 + seed + 11) * 0.3),
    pitch: amp * (noise1(t * freq + seed + 37) * 0.7 + noise1(t * freq * 2.9 + seed + 53) * 0.3),
    roll: amp * 0.5 * noise1(t * freq * 0.8 + seed + 91),
  };
}

// centripetal-ish Catmull-Rom through points (arrays), u in [0,1]
export function spline(pts, u) {
  const n = pts.length - 1;
  const x = clamp(u) * n, i = Math.min(Math.floor(x), n - 1), t = x - i;
  const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n)];
  const t2 = t * t, t3 = t2 * t;
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
