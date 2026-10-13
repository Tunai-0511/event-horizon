// Act I "THE ENDLESS" — scene helpers for app/shaders/nebula.frag (see docs/scenes/nebula.md).
//
// World (units ~ light years, origin = the hero core that collapses and ignites; its spin axis is +y):
//   * the cloud: a smooth union of ellipsoids (BLOBS) torn and eroded by noise, centred near CLOUD_C;
//   * cluster A: an older group of O stars inside the cloud at A_POS. It has blown an HII bubble (radius ~A_R) with a
//     blister opening towards A_OPEN (away from the +z exterior camera). The pillars stand on the bubble floor and
//     point at the cluster; cometary globules float inside the bubble;
//   * cluster B: embryos (faint red protostars in dark cocoons) around the hub; they ignite one by one on uCluster;
//   * the hero core at the origin: collapses on uCollapse, ignites on uIgnite, its ionisation front expands on uFront
//     (log radius from the core to the whole cloud) and breaks out of the cloud's top (champagne flow).
// Everything is deterministic: positions come from fixed tables and a sin-hash, story curves are pure functions of time.
import { SKY } from '../u.js';
import { norm, sub, add, mul, cross, len, lerp, ease, orbit } from '../cam.js';
import { barFrom } from '../music.js';

export const CLOUD_C = [-16, 0, 0];
// The cloud's shape: metaball ellipsoids [centre, radii]: a wide base with towers on top.
export const BLOBS = [
  [[-12, -6, 0], [64, 30, 48]],
  [[-72, 16, 4], [26, 26, 24]],
  [[12, 22, 10], [24, 25, 22]],
  [[38, 12, -14], [20, 21, 20]],
  [[-90, -14, 14], [28, 17, 24]],
  [[66, -10, 6], [30, 19, 28]],
  [[-20, 18, 26], [22, 15, 18]],
];
export const A_POS = [-38, 9, -6];
export const A_R = 28;
export const A_OPEN = norm([-0.05, 0.45, -0.89]);

// deterministic pseudo-random numbers (no Math.random anywhere)
function hash(i, s = 0) { const x = Math.sin(i * 127.1 + s * 311.7 + 74.7) * 43758.5453; return x - Math.floor(x); }

// rotate the unit vector `d` by small angles (degrees) about two axes perpendicular to it
function tilt(d, a, b) {
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = norm(cross(d, up)), e2 = cross(e1, d);
  const r = Math.PI / 180;
  return norm(add(add(d, mul(e2, Math.tan(a * r))), mul(e1, Math.tan(b * r))));
}

// Pillars: [tilt a (deg), tilt b (deg), head distance from A, head radius, base radius, neck radius, density]
// They stand on the bubble floor below cluster A (distance ~A_R) and point straight up at it.
const DOWN = norm([0.05, -0.85, -0.52]);
const PILLAR_DEF = [
  [0, 0, 9.0, 1.8, 4.2, 1.45, 2.4],
  [5.5, 10.0, 12.5, 1.4, 3.4, 1.15, 2.4],
  [-7.0, 12.0, 15.0, 1.15, 2.9, 0.95, 2.6],
  [11.0, -10.0, 16.5, 0.95, 2.4, 0.78, 2.6],
  [-12.0, -8.0, 17.5, 0.85, 2.2, 0.7, 2.6],
  [3.0, -19.0, 19.0, 0.7, 1.9, 0.58, 2.8],
];
export const PILLARS = PILLAR_DEF.map(([a, b, D, rh, rb, rn, k]) => {
  const dir = tilt(DOWN, a, b);
  const L = A_R + 4 - D;
  const head = add(A_POS, mul(dir, D));
  return { dir, head, rh, L, rb, rn, k, base: add(head, mul(dir, L)) };
});

// Cluster B: embryos in the cloud body around the hero core (outside the bubble). w = ignition threshold on uCluster.
export const EMBRYOS = (() => {
  const out = [];
  let s = 0;
  while (out.length < 16 && s < 600) {
    s++;
    const u = hash(s, 1), v = hash(s, 2), w = hash(s, 3);
    const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1);
    const r = 8.5 + 15 * Math.sqrt(w);
    const p = [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th)];
    if (len(sub(p, A_POS)) < A_R + 5) continue;
    if (len(p) < 8) continue;
    if (out.some((q) => len(sub(q, p)) < 5.5)) continue;
    out.push(p);
  }
  // ignition order: nearest to the hero star first (its light front triggers them), with some scatter
  const order = out.map((p, k) => [len(p) + 6 * hash(k, 9), k]).sort((a, b) => a[0] - b[0]);
  const thr = new Array(out.length);
  order.forEach(([, k], j) => { thr[k] = 0.04 + (0.9 * j) / (out.length - 1); });
  return out.map((p, k) => ({ pos: p, th: thr[k] }));
})();

function packPillars() {
  const tip = new Float32Array(6 * 4), dim = new Float32Array(6 * 4);
  PILLARS.forEach((p, i) => { tip.set([...p.head, p.rh], i * 4); dim.set([p.L, p.rb, p.rn, p.k], i * 4); });
  // bounding sphere of the pillar field and the cone (seen from cluster A) that contains it
  const pts = PILLARS.flatMap((p) => [p.head, p.base]);
  const c = mul(pts.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / pts.length);
  const R = Math.max(...PILLARS.flatMap((p) => [len(sub(p.head, c)) + p.rh * 3.4, len(sub(add(p.base, mul(p.dir, 3)), c)) + p.rb * 2.4 + 2.5]));
  const ax = norm(sub(c, A_POS));
  const cosMin = Math.min(...PILLARS.map((p) => { const a = Math.acos(Math.max(-1, Math.min(1, ax.reduce((s, x, i) => s + x * p.dir[i], 0)))); const w = Math.atan(p.rb * 1.3 / len(sub(p.head, A_POS))); return Math.cos(a + w + 0.05); }));
  return { uPilTip: tip, uPilDim: dim, uPilN: PILLARS.length, uPilBound: [...c, R], uPilCone: [...ax, cosMin] };
}
function packBlobs() {
  const c = new Float32Array(8 * 4), r = new Float32Array(8 * 4);
  BLOBS.forEach(([cc, rr], i) => { c.set([...cc, 1], i * 4); r.set([1 / rr[0], 1 / rr[1], 1 / rr[2], 1], i * 4); });
  return { uBlobC: c, uBlobR: r, uBlobN: BLOBS.length };
}
function packEmbryos() {
  const a = new Float32Array(16 * 4);
  EMBRYOS.forEach((e, i) => a.set([...e.pos, e.th], i * 4));
  const R = Math.max(...EMBRYOS.map((e) => len(e.pos))) + 8;
  return { uClu: a, uCluN: EMBRYOS.length, uCluBound: R };
}

// Sky orientation from where the galactic centre and north pole should appear in world space.
// Returns the world -> celestial rotation (column-major mat3) for uSkyRot.
export function skyRotFor(galCworld, galNworld) {
  const frame = (c, n) => { const N = norm(n), C = norm(sub(c, mul(N, c.reduce((s, x, i) => s + x * N[i], 0)))); return [N, C, cross(N, C)]; };
  const [Nw, Cw, Bw] = frame(galCworld, galNworld);
  const [Nc, Cc, Bc] = frame(SKY.uGalC, SKY.uGalN);
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i][j] = Nc[i] * Nw[j] + Cc[i] * Cw[j] + Bc[i] * Bw[j];
  return [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
}
// Milky Way behind the cloud as seen from the exterior side (+x): galactic centre a little off the cloud, band tilted
export const GAL_C = norm([0.08, 0.2, -0.97]);
export const SKY_ROT = skyRotFor(GAL_C, [-0.42, 0.88, 0.22]);

export const DEFAULTS = {
  ...SKY,
  uSkyRot: SKY_ROT, uSkyAmt: 1, uMilky: 1.4, uStars: 1, uGal: 0.6,
  // medium
  uDust: 1.0, uEmit: 1.0, uScat: 1.0, uAmb: 1.0, uDetail: 1.0,
  uHa: [3.3, 0.28, 0.75], uO3: [0.12, 1.22, 1.02], uS2: [4.3, 0.05, 0.12], uExt: [0.72, 1.0, 1.38],
  // geometry
  uCloudC: CLOUD_C, uAPos: A_POS, uALum: 2500, uATemp: 40000, uAR: A_R, uAOpen: A_OPEN,
  ...packPillars(), ...packEmbryos(), ...packBlobs(),
  // story
  uCollapse: 0, uFlow: 0, uIgnite: 0, uFront: 0, uCluster: 0, uJet: 0, uFlash: 0, uPreGlow: 0,
  uKey: [-0.9, 0.35, -0.2, 0.0], uKeyCol: [1.0, 0.72, 0.5], uCoreGlow: 1, uHub: 1, uLeak: 0, uMass: 1, uField: 1, uFootStep: 0.15, uBubA: 1, uStepK: 0.08, uCoreStep: 2.0, uStepMin: 0.25, uOuterStep: 1, uFineFar: 1e9, uRim: [...GAL_C, 0.0], uRimCol: [1.0, 0.8, 0.62], uFieldDir: [...norm([1, 0.22, -0.3]), 0.55],
};

// =====================================================================================================================
// Staging helpers
// =====================================================================================================================

// bar lines of Act I from the exterior shot on (k = 0 -> 38.05 ... 27 -> 139.78, 28 -> 143.54)
export const BAR = (k) => barFrom(38.0, k);
export const T = {
  exterior: BAR(0), pillars: BAR(4), interior: BAR(8), collapse: BAR(12), disk: BAR(16), jets: BAR(18),
  dip: BAR(20), ignite: BAR(22), stop: BAR(27), end: BAR(28),
};
const sat01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b, e = 'smooth') => (typeof e === 'function' ? e : ease[e])(sat01((t - a) / (b - a)));

// ---- story uniforms as pure functions of film time (continuous: safe for motion-blur sub-frames) ----------------
export function collapseAt(t) { return 0.12 * seg(t, T.collapse - 6, T.collapse) + 0.43 * seg(t, T.collapse, T.disk, 'inOutSine') + 0.45 * seg(t, T.disk, T.dip, 'outQuad'); }
// first jets in the build, blasting in climax bars 2-4, then they die with the accretion (quiet aftermath)
export function jetAt(t) { return seg(t, T.jets, T.dip, 'outQuad') + seg(t, BAR(23), BAR(24), 'inOutSine') - 1.6 * seg(t, BAR(26), T.end, 'inOutSine'); }
// dip: the protostar's accretion flickers and swells towards the downbeat
export function preGlowAt(t) { return seg(t, T.dip, T.ignite, 'inQuad'); }
// ignition starts ON the downbeat and unfolds: the star turns on over ~1 s (uIgnite 0 -> 0.15), then keeps brightening
// through the whole 5-bar crescendo (0.15 -> 1). Never a single white slam.
export function igniteAt(t) {
  if (t < T.ignite) return 0;
  return 0.15 * seg(t, T.ignite, T.ignite + 1.0, 'outCubic') + 0.85 * seg(t, T.ignite + 1.0, T.stop, (x) => x * (0.6 + 0.4 * x));
}
// ionisation front (log radius 2.3 -> 34): races out over the first 2 bars, then keeps carving, decelerating
export function frontAt(t) { const x = sat01((t - T.ignite) / (T.stop - T.ignite)); return 1 - Math.pow(1 - x, 1.6); }
// cluster B ignites over bars 3-5 (nearest the hero star first: thresholds are sorted by distance)
export function clusterAt(t) { return seg(t, BAR(24), T.stop, 'lin'); }
// light dims in the dip ("hush"), then climbs again through the climax
export function envLightAt(t) { return 1 - 0.45 * seg(t, T.dip, T.dip + 2.5) + 0.45 * seg(t, T.ignite, T.stop, 'inQuad'); }
// flow clock of the core: rotation / infall / jet knots run faster as the core spins up (integrated, deterministic)
export function flowAt(t) {
  const t0 = T.collapse - 20, dt = 0.05;
  let f = 0, x = t0;
  const rate = (s) => 1.0 + 3.0 * collapseAt(s) + 2.0 * igniteAt(s);
  for (; x + dt <= t; x += dt) f += rate(x + 0.5 * dt) * dt;
  return f + rate(0.5 * (x + t)) * Math.max(0, t - x);
}
// all story uniforms for film time t (merge over DEFAULTS)
export function storyState(t) {
  return {
    uCollapse: collapseAt(t), uJet: jetAt(t), uPreGlow: preGlowAt(t), uIgnite: igniteAt(t), uFront: frontAt(t),
    uCluster: clusterAt(t), uFlow: flowAt(t), uALum: DEFAULTS.uALum * envLightAt(t),
  };
}

// ---- cameras (u = 0..1 progress through the shot). All positions verified inside clear space. -------------------
// A cometary globule (procedural, position found by replicating the shader's hash) that hides an embryo.
export const EMBRYO_GLOBULE = [-46.66, -4.65, -17.56];
const GAX = norm(sub(EMBRYO_GLOBULE, A_POS));
const P0 = PILLARS[0].head;
const A = A_POS;
const eio = ease.inOutSine;
const o3 = (d, az, el) => orbit([0, 0, 0], d, az, el);
export const CAMS = {
  // 38.05-53.12  pull out: the whole dark cloud silhouetted against the Milky Way's bulge, its torn rim lit by it
  exterior: (u) => ({ pos: lerp([-30, -5, 150], [-10, -22, 218], eio(u)), look: lerp([-30, 22, -10], [-10, 12, 0], eio(u)), fov: lerp(42, 50, eio(u)) }),
  // 53.12-60.66  through the blister opening: the pillars against the teal heart of the HII region
  pillarsWide: (u) => ({ pos: lerp([-37, -3, -58], [-37, -4, -47], eio(u)), look: [-37, -6, -14], fov: 45 }),
  // 60.66-68.19  closer: drift past the main pillar's lit head
  pillarsClose: (u) => ({ pos: lerp([-22, 1, -41], [-28, 0, -36], eio(u)), look: lerp(add(P0, [1.5, -1, 0]), P0, eio(u)), fov: 40 }),
  // 68.19-75.73  deep inside the bubble's folds: cometary globules, dark tails, red embryos
  globules: (u) => ({ pos: lerp(add(A, [-17, 11, 9]), add(A, [-13, 9, 6]), eio(u)), look: add(A, [6, 6, -8]), fov: 50 }),
  // 75.73-83.27  an embryo glowing red inside an evaporating globule
  embryo: (u) => ({ pos: lerp(add(EMBRYO_GLOBULE, add(mul(GAX, -5.8), [1.7, 1.7, 0])), add(EMBRYO_GLOBULE, add(mul(GAX, -4.6), [1.3, 1.4, 0])), eio(u)),
    look: add(add(EMBRYO_GLOBULE, mul(GAX, 1.5)), [0, 0.35, 0]), fov: 30 }),
  // 83.27-90.80  the hub: a dense lumpy core fed by gas streams starts to collapse (key light from camera side)
  collapse: (u) => ({ pos: o3(lerp(9, 7.8, eio(u)), lerp(20, 35, u), lerp(38, 46, u)), look: [0, 0, 0], fov: 42 }),
  // 90.80-98.33  from above: spiral streamers wind inward
  spiral: (u) => ({ pos: o3(lerp(7.5, 6.6, eio(u)), lerp(35, 65, u), lerp(66, 60, u)), look: [0, 0, 0], fov: 45 }),
  // 98.33-102.10 oblique: the flattened disk around the dull red protostar
  disk: (u) => ({ pos: o3(5.6, lerp(38, 52, u), 24), look: [0, 0, 0], fov: 45 }),
  // 102.10-105.87 close on the inner disk
  diskClose: (u) => ({ pos: o3(lerp(3.4, 2.9, eio(u)), lerp(60, 74, u), 17), look: [0, 0, 0], fov: 50 }),
  // 105.87-109.64 edge-on: the first jets
  jets: (u) => ({ pos: o3(6.5, lerp(38, 48, u), 4), look: [0, 0.4, 0], fov: 45 }),
  // 109.64-113.41 wider: knots and bow shocks
  jetsWide: (u) => ({ pos: o3(lerp(9.5, 11, eio(u)), lerp(28, 34, u), 8), look: [0, 1.2, 0], fov: 45 }),
  // 113.41-120.94 dip: slow push into the flickering protostar
  dip: (u) => ({ pos: o3(lerp(6.5, 3.8, eio(u)), lerp(40, 46, u), lerp(14, 11, u)), look: [0, 0, 0], fov: 45 }),
  // 120.94-124.71 climax bar 1: ignition seen close (light bursts out through the bipolar cavity)
  ignite: (u) => ({ pos: o3(lerp(9, 11, eio(u)), lerp(40, 46, u), 14), look: [0, 0, 0], fov: 50 }),
  // 124.71-128.47 bar 2: inside the new cavity as the front races outward, jets blasting
  blast: (u) => ({ pos: o3(lerp(12, 14.5, eio(u)), lerp(46, 56, u), 12), look: [0, 0.5, 0], fov: 55 }),
  // 128.47-132.24 bar 3: the light front carving the cloud
  front: (u) => ({ pos: o3(lerp(6, 9, eio(u)), lerp(56, 66, u), 15), look: [0, 0, 0], fov: 70 }),
  // 132.24-136.01 bar 4: the embryos ignite across the cloud, each lighting its own bubble
  cluster: (u) => ({ pos: o3(lerp(10, 14, eio(u)), lerp(66, 76, u), 18), look: [0, 0, 0], fov: 70 }),
  // 136.01-139.78 bar 5: pull back from the exterior side: the same dark cloud now ablaze from inside (bookend)
  ablaze: (u) => ({ pos: o3(lerp(96, 128, eio(u)), lerp(22, 12, u), lerp(16, 11, u)), look: [-7, 6, 0], fov: 45 }),
  // 139.78-143.54 stop: quiet wide, the massive blue star at the heart of the lit nebula
  aftermath: (u) => ({ pos: o3(lerp(158, 162, u), lerp(-4, -5, u), 8), look: [-12, 7, 0], fov: 45 }),
};

// ---- per-shot uniforms and grading ----------------------------------------------------------------------------------
const EXT = { uStepK: 0.012, uRim: [0.08, 0.2, -0.97, 1.6], uRimCol: [1.0, 0.55, 0.55], uMilky: 2.2 };
const KEYC = (dirToLight, w) => ({ uKey: [...dirToLight, w], uStepK: 0.1, uCoreStep: 2.6, uOuterStep: 2.4, uFineFar: 14, uStepMin: 0.3 });
export const SHOT_U = {
  exterior: EXT,
  pillarsWide: { uStepK: 0.07 }, pillarsClose: { uStepK: 0.065 },
  globules: { uStepK: 0.07 }, embryo: { uStepK: 0.11, uStepMin: 0.36 },
  collapse: KEYC([-0.6, 0.55, -0.55], 7), spiral: KEYC([-0.6, 0.55, -0.55], 3), disk: { ...KEYC([-0.6, 0.55, -0.55], 3), uStepK: 0.115 },
  diskClose: { ...KEYC([-0.6, 0.55, -0.55], 2), uStepK: 0.11 }, jets: { ...KEYC([-0.6, 0.55, -0.55], 3), uStepK: 0.12 }, jetsWide: KEYC([-0.6, 0.55, -0.55], 3),
  dip: { ...KEYC([-0.6, 0.55, -0.55], 1), uStepK: 0.11 }, ignite: { uStepK: 0.15, uCoreStep: 2.6, uOuterStep: 1.8 }, blast: { uStepK: 0.13, uOuterStep: 1.3 }, front: { uStepK: 0.12 }, cluster: { uStepK: 0.12 },
  ablaze: { uStepK: 0.024 }, aftermath: { uStepK: 0.02 },
};
export const POST = {
  exterior: { exposure: 0.5, bloom: 0.07, tm: 0.5 },
  pillarsWide: { exposure: -0.5, bloom: 0.08, tm: 0.35 }, pillarsClose: { exposure: -0.5, bloom: 0.08, tm: 0.35 },
  globules: { exposure: -0.8, bloom: 0.08, tm: 0.4 }, embryo: { exposure: -0.7, bloom: 0.08, tm: 0.4 },
  collapse: { exposure: 0.9, bloom: 0.07, tm: 0.5 }, spiral: { exposure: 0.5, bloom: 0.07, tm: 0.5 },
  disk: { exposure: 0.5, bloom: 0.08, tm: 0.5 }, diskClose: { exposure: 0.3, bloom: 0.08, tm: 0.5 },
  jets: { exposure: 0.5, bloom: 0.08, tm: 0.5 }, jetsWide: { exposure: 0.5, bloom: 0.08, tm: 0.5 },
  dip: { exposure: 0.0, bloom: 0.09, tm: 0.5 },
  ignite: { exposure: -1.0, bloom: 0.1, tm: 0.5 }, blast: { exposure: -0.5, bloom: 0.1, tm: 0.5 },
  front: { exposure: -0.15, bloom: 0.12, tm: 0.5 }, cluster: { exposure: 0.25, bloom: 0.13, tm: 0.5 },
  ablaze: { exposure: 1.9, bloom: 0.13, tm: 0.5 }, aftermath: { exposure: 1.3, bloom: 0.1, tm: 0.5 },
};

// ---- compile-time feature switches per shot (strip what a camera cannot see; see nebula_lib.glsl) ----------------
const D_EXT = { NEB_NO_PILLARS: 1, NEB_NO_COMETS: 1, NEB_NO_GLOBULES: 1, NEB_NO_CORE: 1, NEB_NO_CLUSTER: 1, NEB_NO_HERO: 1 };
const D_BUBBLE = { NEB_NO_CORE: 1, NEB_NO_CLUSTER: 1, NEB_NO_HERO: 1, NEB_NO_RIM: 1, NEB_NO_EDGEWARP: 1 };
const D_IN = { NEB_NO_PILLARS: 1, NEB_NO_COMETS: 1, NEB_NO_RIM: 1, NEB_NO_GLOBULES: 1, NEB_NO_EDGEWARP: 1 };
const D_CORE0 = { ...D_IN, NEB_NO_CLUSTER: 1, NEB_NO_HERO: 1, NEB_NO_SELFSHADOW: 1 };   // young core
const D_CORE1 = { ...D_IN, NEB_NO_CLUSTER: 1, NEB_NO_SELFSHADOW: 1 };                   // + protostar light
const D_CLOSE = { ...D_CORE1, NEB_NO_HUB: 1 };                                          // lens inside the hub
const D_CORE = D_IN;                                              // climax
const D_WIDE = { NEB_NO_RIM: 1 };
export const DEFS = {
  exterior: D_EXT, pillarsWide: D_BUBBLE, pillarsClose: D_BUBBLE, globules: D_BUBBLE, embryo: { ...D_BUBBLE, NEB_NO_GLOBULES: 1, NEB_NO_FIELD: 1 },
  collapse: D_CORE0, spiral: D_CORE0, disk: D_CLOSE, diskClose: D_CLOSE, jets: D_CLOSE, jetsWide: D_CORE1, dip: D_CLOSE,
  ignite: D_CORE, blast: D_CORE, front: D_CORE, cluster: D_CORE, ablaze: D_WIDE, aftermath: D_WIDE,
};

// ---- the storyboard cut list on the bar grid (2-bar cuts in the build, a cut every bar in the climax) --------------
export const ACT1_CUTS = [
  ['exterior', 0, 4], ['pillarsWide', 4, 6], ['pillarsClose', 6, 8], ['globules', 8, 10], ['embryo', 10, 12],
  ['collapse', 12, 14], ['spiral', 14, 16], ['disk', 16, 17], ['diskClose', 17, 18], ['jets', 18, 19], ['jetsWide', 19, 20],
  ['dip', 20, 22], ['ignite', 22, 23], ['blast', 23, 24], ['front', 24, 25], ['cluster', 25, 26], ['ablaze', 26, 27],
  ['aftermath', 27, 28],
];
// ready-made engine shots for Act I's nebula part (film time); spp per shot can be overridden by the caller
export function act1Shots({ spp = 4 } = {}) {
  return ACT1_CUTS.map(([name, k0, k1]) => {
    const t0 = BAR(k0), t1 = BAR(k1);
    return {
      id: `neb_${name}`, t0, t1, scene: 'nebula', spp, defines: DEFS[name],
      at: (t) => ({ cam: CAMS[name]((t - t0) / (t1 - t0)), u: { ...DEFAULTS, ...storyState(t), ...SHOT_U[name] }, post: POST[name] }),
    };
  });
}
