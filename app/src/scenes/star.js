// Scene `star` — Act II "THE GIANT": uniform defaults + staging helpers for every storyboard shot.
// Everything reads as light and plasma: a blinding photosphere that melts into a glowing limb, soft prominences,
// a dominant corona; inside, the star is shown as nested luminous gas shells around a dark iron core (no cut planes).
// The star sits at the world origin with photosphere radius uRadius. Directions such as uHero are in the star's body
// frame, which equals the world frame when uSpin = 0 (uSpin rotates the body about +y).
//
//   DEFAULTS                 every uniform of star.frag with sane values (a blue supergiant, R = 1, opaque)
//   evolve(age)              uniforms of the blue -> yellow -> red supergiant evolution (age 0..1)
//   evolveExposure(age)      matching exposure (EV)
//   evolveCam(age, opts)     camera that retreats slower than the star swells
//   RSG                      red supergiant baseline (= evolve(1)) for the inside / throes / collapse shots
//   insideState(p)           the star turning into translucent glowing gas + the iron core growing (p 0..1)
//   pulseState(t, t0)        pulsation + shell ejection locked to the bar grid
//   collapseState(p)         core collapse (p 0..1 over the dip)
//   limbCam / starCam / orbitCam / flyCam   camera helpers
//   filmShots()              the scene's storyboard shots, ready for the timeline (absolute film times)
import { SKY } from '../u.js';
import { add, sub, mul, norm, cross, dot, lerp, clamp, kf, ease, ramp } from '../cam.js';
import { blackbodyXYZ } from '../textures.js';
import { barsIn } from '../music.js';

export const DEFAULTS = {
  ...SKY,
  // star
  uRadius: 1, uTemp: 25000, uAge: 0, uSurf: 3, uLumK: 0.5, uCells: 80, uGranC: 1, uBoil: 4, uSpin: 0,
  uLimbH: 0.05, uLumpy: 0, uActivity: 0.6,
  // atmosphere
  uChromo: 1, uChromoH: 0.012, uCorona: 1, uStreamers: 0.8, uWind: 1, uMol: 0,
  // prominences
  uProm: 1, uHero: [0, 1, 0], uHeroChord: [1, 0, 0], uHeroH: 0.16, uHeroSpan: 0.12, uEruption: 0,
  // mass loss
  uShells: 0, uShellPhase: 0,
  // pulsation
  uPulse: 0, uPulsePhase: 0,
  // interior (the star as translucent luminous gas: nested fusion shells, iron core)
  uInside: 0, uIron: 0, uCollapse: 0, uInterior: 1,
  uSkyAmt: 1,
};

const smooth = ease.smooth;
const mixv = (a, b, t) => a + (b - a) * t;

// shell phase reached at the end of the evolution; .75 so that pulseState() births shells at radius maxima
export const SHELL0 = 2.75;

// ---- evolution: blue supergiant (age 0) -> yellow -> red supergiant (age 1) ---------------------------------
// Temperature falls on a log scale (25 000 K -> 3 500 K), the radius swells 7x, convection cells grow from fine
// granulation (80 per radian) to a handful of giant cells (1.7 per radian), the corona / chromosphere / prominences
// fade, a molecular atmosphere and dusty mass-loss shells appear.
export function evolve(age) {
  const a = clamp(age);
  const tA = smooth(clamp(a / 0.92));
  const T = Math.exp(mixv(Math.log(25000), Math.log(3500), tA));
  const R = Math.exp(mixv(0, Math.log(7), Math.pow(a, 1.25)));
  const cells = Math.exp(mixv(Math.log(80), Math.log(1.7), smooth(clamp((a - 0.1) / 0.85))));
  const rsg = smooth(clamp((a - 0.55) / 0.45));
  const hot = 1 - smooth(clamp((a - 0.05) / 0.5));
  return {
    uAge: a, uTemp: T, uRadius: R, uCells: cells,
    // the yellow phase gets extra granulation contrast so the disk never reads as a featureless white ball
    uLimbH: mixv(0.05, 0.09, rsg), uLumpy: rsg, uGranC: mixv(1.0, 1.15, rsg) + 1.0 * Math.exp(-(((a - 0.52) / 0.14) ** 2)),
    uActivity: 0.6 * hot,
    uChromo: hot, uCorona: mixv(0.15, 1, hot), uStreamers: 0.8 * hot, uProm: hot, uWind: mixv(0.6, 1, hot),
    // dusty shells fade in as they leave the star (their phase advances with age so they are seen expanding)
    uMol: 2.5 * rsg, uShells: smooth(clamp((a - 0.75) / 0.25)), uShellPhase: SHELL0 * clamp((a - 0.7) / 0.3),
    // keep the visible surface-brightness drop to ~2.5 EV instead of the physical ~6 EV
    uLumK: 0.42,
  };
}
// Visible luminance of a blackbody relative to 6500 K (same table as the shader's bbLum()).
const YREF = blackbodyXYZ(6500)[1];
export function bbLum(T) { return blackbodyXYZ(T)[1] / YREF; }
// Disk-centre radiance of the star for a uniform set (matches the shader's normalisation).
export function diskRadiance(u) { return 1.2 * u.uSurf * Math.pow(bbLum(u.uTemp), u.uLumK); }
// Suggested exposure (EV) along the evolution: the blue and yellow phases read as blinding white plasma (disk centre
// near the ACES shoulder, subtle flowing structure), the red supergiant is ~2.5 EV dimmer on screen so its giant
// plumes and colour show.
export function evolveExposure(age, surf = DEFAULTS.uSurf) {
  const ev = evolve(age);
  const target = kf(clamp(age), [[0, 3.0], [0.35, 2.6, 'smooth'], [0.65, 1.5, 'smooth'], [0.9, 0.55, 'smooth'], [1, 0.5]]);
  return Math.log2(target / diskRadiance({ uSurf: surf, ...ev }));
}
// Camera for the evolution shot: retreats as R^0.75, so the star keeps growing on screen (angular radius x1.6).
export function evolveCam(age, { az = 0, el = 8, fov = 42, d0 = 5.5 } = {}) {
  const R = evolve(age).uRadius;
  return orbitCam({ R: 1, dist: d0 * Math.pow(R, 0.75), az, el, fov });
}

// ---- red supergiant baseline used by the cutaway / death throes / collapse shots ----------------------------
export const RSG = evolve(1);

// ---- pulsation: phase and amplitude for the death-throes section, tied to the bar grid -----------------------
// barLen ~3.77 s. One radial pulsation per 2 bars (radius max half a bar after t0, then every 2 bars); a new shell is
// born exactly at every radius maximum (uShellPhase crosses an integer there). Radius swings +-7 %, brightness +-25 %.
export function pulseState(t, t0, barLen = 3.77, amp = 1) {
  const x = (t - t0) / (2 * barLen);
  return { uPulse: amp, uPulsePhase: x * Math.PI * 2, uShellPhase: SHELL0 + x, uBoil: 6 };
}
// photosphere radius factor for a pulse state (same formula as the shader's gRph) — lets close cameras ride the
// heaving surface instead of having the limb swing through the frame
export function pulseRadius(u) { return 1 + 0.07 * (u.uPulse ?? 0) * Math.sin(u.uPulsePhase ?? 0); }

// ---- inside the star: p 0..1 over the inside shot -------------------------------------------------------------
// The opaque photosphere dissolves into translucent glowing gas (uInside), the molecular haze and dust fade away,
// then the iron core grows at the centre (uIron).
export function insideState(p, { reveal = [0.0, 0.3], iron = [0.3, 1.0] } = {}) {
  const q = clamp(p);
  const vis = smooth(clamp((q - reveal[0]) / (reveal[1] - reveal[0])));
  return {
    uInside: vis, uMol: RSG.uMol * (1 - vis), uShells: 0, uIron: smooth(clamp((q - iron[0]) / (iron[1] - iron[0]))),
  };
}

// ---- core collapse: p 0..1 over the dip (211.49–219.07) --------------------------------------------------------
// The iron core shrinks slowly, then in the last ~10 % to a point; the shells fall inward (the inner ones fastest)
// with growing turbulence; the core heats as it shrinks and ends as a blinding proto-neutron-star point.
export function collapseState(p) {
  const q = clamp(p);
  const c = ease.inCubic(q) * 0.9 + 0.1 * smooth(clamp((q - 0.9) / 0.1));
  return { uCollapse: c, uIron: 1, uInside: 1, uMol: 0, uShells: 0, uInterior: 1 - 0.35 * smooth(clamp(q / 0.95)) };
}

// ---- cameras -------------------------------------------------------------------------------------------------------
// Limb close-up. The camera is placed so that the hero direction h lies exactly on the star's silhouette, looking
// along the hero loop's plane normal (the arch is seen side-on), then pitched so the horizon sits `horizon` degrees
// from the frame centre (negative = below).
//   h: hero direction, a: hero chord, R: star radius, dist: camera distance from the centre (in R, > 1),
//   horizon: screen elevation of the limb (deg), slide: truck along the limb (in R), fov, roll
export function limbCam({ h = DEFAULTS.uHero, a = DEFAULTS.uHeroChord, R = 1, dist = 1.12, horizon = -8, slide = 0, fov = 34, roll = 0 } = {}) {
  const H = norm(h);
  const A = norm(sub(a, mul(H, dot(a, H))));
  const F = cross(H, A); // plane normal: the camera looks along +F
  const s = Math.sqrt(Math.max(dist * dist - 1, 1e-6));
  const pos = add(add(mul(H, R), mul(F, -s * R)), mul(A, slide * R));
  const e = (-horizon * Math.PI) / 180;
  const fwd = add(mul(F, Math.cos(e)), mul(H, Math.sin(e)));
  return { pos, fwd, up: H, fov, roll };
}
// Whole-star view from distance `dist` (in R) along the hero plane normal, rotated by `az` degrees about the hero
// axis and raised by `el` (az = el = 0: the hero loop stands on the top limb, side-on). lookOff in units of R.
export function starCam({ h = DEFAULTS.uHero, a = DEFAULTS.uHeroChord, R = 1, dist = 5, az = 0, el = 0, fov = 40, lookOff = [0, 0, 0], roll = 0 } = {}) {
  const H = norm(h);
  const A = norm(sub(a, mul(H, dot(a, H))));
  const F = cross(H, A);
  const c = Math.cos((az * Math.PI) / 180), s = Math.sin((az * Math.PI) / 180);
  const ce = Math.cos((el * Math.PI) / 180), se = Math.sin((el * Math.PI) / 180);
  const dir = add(mul(add(mul(F, -c), mul(A, s)), ce), mul(H, se));
  return { pos: mul(dir, dist * R), look: mul(lookOff, R), up: H, fov, roll };
}
// Generic orbit around the star (azimuth about +y from +z, elevation), distance and look point in units of R.
export function orbitCam({ R = 1, dist = 4, az = 0, el = 10, fov = 40, look = [0, 0, 0], roll = 0 } = {}) {
  const A = (az * Math.PI) / 180, E = (el * Math.PI) / 180;
  return { pos: [dist * R * Math.cos(E) * Math.sin(A), dist * R * Math.sin(E), dist * R * Math.cos(E) * Math.cos(A)], look: mul(look, R), fov, roll };
}
// Camera on a straight flight from p0 to p1 (units of R) looking at a point that moves from l0 to l1, eased.
export function flyCam(u, { R = 1, p0, p1, l0 = [0, 0, 0], l1 = l0, fov = 45, roll = 0, e = 'inOutSine' } = {}) {
  const k = (typeof e === 'function' ? e : ease[e])(clamp(u));
  return { pos: mul(lerp(p0, p1, k), R), look: mul(lerp(l0, l1, k), R), fov, roll };
}

// ---- the storyboard ------------------------------------------------------------------------------------------------
// Act II rows handled by this scene, staged on the bar grid. Returns timeline shots { id, t0, t1, scene, spp, at(t) }
// with absolute film times; at(t) gives { cam, u, post }. Uses uTime (film time) for all surface/flow animation.
//   dipBars: 2 = the collapse fills both dip bars (211.49–219.07); 1 = it ends at 215.28, leaving the second dip bar
//   to the nova scene's optional quiet(p) shot.
export function filmShots({ spp = 4, dipBars = 2 } = {}) {
  const B = barsIn(143.0, 219.5); // 143.54 147.06 150.85 154.64 158.43 162.22 166.01 ... 211.49 215.28 219.07
  const bar = (t) => B.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), B[0]);
  const T = {
    limb: bar(143.54), full: bar(158.43), chord: bar(162.22), build: bar(166.01), inside: bar(181.17),
    throes: bar(196.33), dip: bar(211.49), climax: bar(dipBars === 1 ? 215.28 : 219.07),
  };
  const R7 = RSG.uRadius;
  const RSGPOST = { exposure: -1.0, bloom: 0.3, sat: 1.3 };
  const shot = (id, t0, t1, at) => ({ id: `star_${id}`, t0, t1, scene: 'star', spp, at: (t) => at(clamp((t - t0) / (t1 - t0)), t) });
  const throes = [T.throes, bar(200.12), bar(203.91), bar(207.7), T.dip];
  return [
    // 143.54–158.43 quiet: the blue supergiant's limb. Blinding plasma, glowing limb, spicules, prominences. Slow truck.
    shot('limb', T.limb, T.full, (u) => ({
      cam: limbCam({ dist: lerp(1.14, 1.11, ease.inOutSine(u)), horizon: -9, slide: lerp(-0.07, 0.07, u), fov: 34 }),
      u: { ...DEFAULTS, uCells: 200, uGranC: 0.9, uCorona: 0.15, uWind: 0.1, uLimbH: 0.012, uBoil: 4, uSkyAmt: 0.5 },
      post: { exposure: -1.6, bloom: 0.3, scatter: 0.12, vignette: 0.3 },
    })),
    // 158.43–166.01 intro: pull back to the whole star; the hero prominence activates, then erupts on the chord
    shot('full', T.full, T.build, (u, t) => ({
      cam: starCam({ dist: kf(u, [[0, 2.3], [1, 6.0, 'outCubic']]), az: 18, el: 4, fov: 40, lookOff: [0, kf(u, [[0, 0.8], [1, 1.0, 'outCubic']]), 0] }),
      u: { ...DEFAULTS, uCells: 150, uBoil: 8, uEruption: kf(t, [[T.full, 0], [T.chord, 0.3, 'inQuad'], [T.build, 1, 'outQuad']]) },
      post: { exposure: -2.6, bloom: 0.5, scatter: 0.5, vignette: 0.35 },
    })),
    // 166.01–181.17 build: millions of years in seconds — blue -> yellow -> red supergiant
    shot('evolve', T.build, T.inside, (u) => {
      const age = ease.inOutSine(u);
      return {
        cam: evolveCam(age, { az: lerp(-20, 15, u), el: 8, fov: 42 }),
        u: { ...DEFAULTS, ...evolve(age), uBoil: 12 },   // uBoil constant within the shot: uTime * uBoil is the clock
        post: { exposure: evolveExposure(age), bloom: 0.5, scatter: 0.5, sat: lerp(1.0, 1.3, smooth(clamp((age - 0.3) / 0.7))), vignette: 0.35 },
      };
    }),
    // 181.17–196.33 build: into the star. The surface dissolves into glowing gas as we approach (bar 1), we fly in
    // through the envelope toward the nested burning shells; the iron core grows at the centre (bars 2-4).
    // (never seen from outside as a translucent ball: the camera is already inside the envelope, flying down through
    // the layers at an angle, so the shells read as walls of glowing gas rather than a bull's-eye diagram)
    shot('inside', T.inside, T.throes, (u) => ({
      cam: flyCam(u, { R: R7, p0: [0.66, 0.22, 0.6], p1: [0.3, 0.05, 0.5], l0: [0.38, 0.16, -0.18], l1: [0.1, 0.0, 0.05], fov: 62, e: 'inOutSine' }),
      u: { ...DEFAULTS, ...RSG, ...insideState(u, { reveal: [0.0, 0.02], iron: [0.3, 0.95] }), uBoil: 4 },
      post: { exposure: kf(u, [[0, -2.6], [1, -4.0]]), bloom: 0.6, scatter: 0.5, sat: 1.5, vignette: 0.35 },
    })),
    // 196.33–211.49 build: red supergiant pulsing, shedding shells, boiling — four angles, a cut every bar
    shot('throes_a', throes[0], throes[1], (u, t) => ({
      // establishing: from outside the shells, the whole star breathing inside its dust
      cam: orbitCam({ R: R7, dist: 7.0, az: lerp(-10, -6, u), el: 5, fov: 30 }),
      u: { ...DEFAULTS, ...RSG, ...pulseState(t, T.throes) },
      post: RSGPOST,
    })),
    shot('throes_b', throes[1], throes[2], (u, t) => {
      // over the boiling limb: giant convection plumes, molecular fringe, shells leaving into space; the camera rides
      // 75 % of the heave so the limb breathes in frame without swinging out of it
      const ps = pulseState(t, T.throes);
      const Rp = R7 * (1 + 0.75 * (pulseRadius(ps) - 1));
      return {
        cam: limbCam({ h: [0.25, 0.95, 0.15], a: [1, 0, 0], R: Rp, dist: 1.5, horizon: 3, slide: lerp(0.0, 0.05, u), fov: 40, roll: -8 }),
        u: { ...DEFAULTS, ...RSG, ...ps, uShells: 1.4 },
        post: { ...RSGPOST, exposure: -0.5 },
      };
    }),
    shot('throes_c', throes[2], throes[3], (u, t) => ({
      // from behind the dust: lit clumps of the ejected shells drift past in the foreground, the star off-centre
      cam: flyCam(u, { R: R7, p0: [-1.75, 0.45, -4.3], p1: [-1.45, 0.55, -4.1], l0: [2.0, 0.6, 0.8], l1: [2.0, 0.7, 0.9], fov: 45, e: 'lin' }),
      u: { ...DEFAULTS, ...RSG, ...pulseState(t, T.throes), uShells: 1.3 },
      post: { ...RSGPOST, exposure: -0.5 },
    })),
    shot('throes_d', throes[3], throes[4], (u, t) => ({
      // close over the boiling surface (thin the dust so the near shells do not veil it)
      cam: orbitCam({ R: R7, dist: 2.2, az: 60 + 4 * u, el: 25, fov: 50, look: [0, 0.35, 0] }),
      u: { ...DEFAULTS, ...RSG, ...pulseState(t, T.throes), uShells: 0.5 },
      post: RSGPOST,
    })),
    // 211.49–219.07 dip: inside again — the iron core shrinks to a blinding point while the glowing layers rush in
    shot('collapse', T.dip, T.climax, (u) => ({
      cam: flyCam(u, { R: R7, p0: [0.18, 0.06, 0.58], p1: [0.15, 0.05, 0.5], l0: [-0.02, 0, 0], l1: [0, 0, 0], fov: 45, e: 'inOutSine' }),
      u: { ...DEFAULTS, ...RSG, ...collapseState(u), uBoil: 4 },
      post: { exposure: -4.2, bloom: 0.7, scatter: 0.5, sat: 1.5, vignette: 0.4 },
    })),
  ];
}

export { kf, ease, ramp, lerp };
