// ACT III — BIRTH (241.77–384.92): the newborn black hole inside the supernova remnant. Everything seen is light:
// the remnant's filaments and the stars, bent by the hole (geodesic ray tracing); then the ejecta that failed to escape
// fall back (SPH simulation), collide in the equatorial plane, radiate and settle into a ring; on the third climax the
// ring spreads inward to the innermost stable orbit and the inner disk, heated by viscous friction, ignites.
import { S, bar, kf, ramp, orbit, orbitCam, ease, spline, pchip } from './kit.js';
import { DEFAULTS } from '../scenes/bh.js';
import { REMNANT } from '../scenes/nova.js';
import { simLayer, bounds } from './simkit.js';

const A = 2;
const B = (k) => bar(A, k);
const T0 = B(0);
const disk = (t) => ({ uDiskTime: t - T0 + 20, uDiskSpeed: 0.03 });
const REM = { ...REMNANT, uRemAmt: 2.5, uStars: 0.7, uMilky: 0.35 };
const base = { ...DEFAULTS, ...REM, uDisk: 0 };
const postQuiet = { exposure: 0.35, bloom: 0.08, tm: 0.7, vignette: 0.45 };

// ---- the fallback simulation (tools/sph/fallback.py) ----
const fbTau = pchip([[B(14), 60], [B(18), 420], [B(22), 900], [B(26), 1700], [B(30), 3200], [B(32), 4100]]);
const fb = simLayer('fallback', {
  tau: fbTau,
  boxes: (T, parts) => { const b = bounds(parts, 1.04, 30); return [[0, 0, 0, 24], [0, 0, 0, Math.min(118, Math.max(Math.hypot(b[0], b[1], b[2]) + b[3], 30))]]; },
  opts: { rhoRef: 1e-9, uRef: 9e-6, tRef: 2400, tGamma: 0.16, tMin: 1400 },
});
const SIMU = { uSimKappa: 0.05, uSimRhoPow: 0.85, uSimBright: 1.6, uSimDoppler: 1, uSimTMax: 40000, uSimSat: 1.6 };
const DS = { HAS_REMNANT: 1, HAS_SIM: 1, MAXSTEPS: 900 };

// the third climax is a 5-bar crescendo: 0 at its first downbeat -> 1 at its last bar
const swell = (t) => ramp(t, B(32), B(36) + 1.5, 'inOutSine');
// the analytic thin disk takes over from the simulated ring during the dip; on the downbeat its inner edge starts
// to spread inward from the ring (~12 r_s) to the ISCO, heating as it goes (T ∝ r^-3/4)
function diskState(t) {
  const c0 = B(32);
  if (t < c0) {
    const k = ramp(t, B(30), c0, 'inOutSine');
    return { uDisk: k, uDiskTemp: 3600 + 800 * k, uDiskBright: 0.7 * k, uIgnDir: -1, uIgnFront: 12.5, uIgnWidth: 1.8, uEmber: 0, uIgnFlash: 0 };
  }
  const L = t - c0;
  const front = 12.5 - 9.5 * ease.inOutSine(Math.min(1, L / 7.2));
  return {
    uDisk: 1, uDiskTemp: 4400 + 2300 * swell(t), uDiskBright: 0.7 + 2.2 * swell(t), uIgnDir: -1,
    uIgnFront: front > 3.05 ? front : 0, uIgnWidth: 1.4 + 0.12 * front, uEmber: 0, uIgnFlash: 0,
  };
}

const shots3 = [
  // quiet + intro, one take: inside the remnant a black point at its heart; the camera drifts until a star exactly
  // behind the hole lines up — on the bar its two images close into an Einstein ring, then part again
  S('3.quiet', B(2), B(6), 'bh', (t, u) => {
    const P = [[-30, 14, 300], [-12, 4, 205], [0, 0.6, 172], [7, 0.4, 165]];
    const k = kf(t, [[B(2), 0], [B(4), 1, 'inOutSine'], [B(5), 2, 'outSine'], [B(6), 3, 'inSine']]);
    return {
      cam: { pos: spline(P, k / 3), look: [0, 0, 0], fov: kf(t, [[B(2), 24], [B(4), 22]]) },
      u: { ...base, uHeroDir: [0, 0, -1], uHeroFlux: 2600, uHeroTemp: 11000 },
      post: { ...postQuiet, exposure: kf(t, [[B(2), -0.6], [B(2) + 2.5, 0.35, 'outSine']]), bloom: kf(t, [[B(3), 0.08], [B(5), 0.12]]) },
    };
  }, { dissolve: 3.0 }),
  // build, one take: circling the naked hole — the filaments and the stars behind it are bent into arcs and rings
  S('3.orbit', B(6), B(14), 'bh', (t, u) => ({
    cam: orbitCam([0, 0, 0], kf(u, [[0, 80], [0.55, 34, 'inOutSine'], [1, 22, 'inOutSine']]), kf(u, [[0, -4], [1, 132, 'inOutSine']]),
      kf(u, [[0, 6], [0.5, 18, 'inOutSine'], [1, 7, 'inOutSine']]), kf(u, [[0, 36], [1, 48]])),
    u: base, post: postQuiet,
  })),
  // build: the ejecta that failed to escape fall back — clumps of gas rain onto the hole from every side
  S('3.fallback', B(14), B(22), 'bh', (t, u) => ({
    cam: orbitCam([0, 0, 0], kf(u, [[0, 150], [1, 80, 'inOutSine']]), kf(u, [[0, 140], [1, 175]]), kf(u, [[0, 24], [1, 34]]), kf(u, [[0, 44], [1, 46]])),
    u: { ...base, ...fb.uniforms(), ...SIMU }, post: { ...postQuiet, exposure: kf(u, [[0, 0.8], [0.4, -0.4], [1, -1.0]]) },
  }), { defines: DS, prepare: fb.prepare, spp: 3 }),
  // build: the infall meets itself in the equatorial plane; the shocked gas radiates, the angular momentum stays — a ring
  S('3.ring', B(22), B(30), 'bh', (t, u) => ({
    cam: orbitCam([0, 0, 0], kf(u, [[0, 80], [1, 46, 'inOutSine']]), kf(u, [[0, 175], [1, 228]]), kf(u, [[0, 34], [1, 17, 'inOutSine']]), kf(u, [[0, 46], [1, 44]])),
    u: { ...base, ...fb.uniforms(), ...SIMU }, post: { ...postQuiet, exposure: kf(u, [[0, -1.0], [1, -1.2]]) },
  }), { defines: DS, prepare: fb.prepare, spp: 3 }),
  // dip: the ring settles and cools; the thin disk equations take over from the particles
  S('3.dip', B(30), B(32), 'bh', (t, u) => {
    const k = ramp(t, B(30), B(32), 'inOutSine');
    return {
      cam: orbitCam([0, 0, 0], kf(u, [[0, 46], [1, 33]]), kf(u, [[0, 228], [1, 248]]), kf(u, [[0, 17], [1, 6]]), kf(u, [[0, 44], [1, 36]])),
      u: { ...base, ...disk(t), ...diskState(t), ...fb.uniforms(), ...SIMU, uSimBright: SIMU.uSimBright * (1 - k) },
      post: { ...postQuiet, exposure: kf(u, [[0, -0.1], [1, 0.1]]) },
    };
  }, { defines: DS, prepare: fb.prepare, spp: 3 }),
  // climax, one continuous rise: the disk spreads inward to the ISCO and the inner disk ignites; the light keeps
  // climbing with the crescendo while the camera rises over the disk and swings round
  S('3.reveal', B(32), B(35), 'bh', (t, u) => ({
    cam: orbitCam([0, 0, 0], kf(u, [[0, 33], [0.35, 29, 'outSine'], [1, 23, 'inOutSine']]), kf(u, [[0, 248], [1, 300, 'inOutSine']]),
      kf(u, [[0, 6], [0.3, 7], [1, 34, 'inOutSine']]), kf(u, [[0, 36], [1, 44, 'inOutSine']])),
    u: { ...base, ...disk(t), ...diskState(t) },
    post: { exposure: kf(u, [[0, 0.1], [0.4, -0.45], [1, -0.65]]), bloom: 0.12 + 0.1 * swell(t), tm: 0.7, vignette: 0.4 },
  }), { defines: { HAS_REMNANT: 1 } }),
  // the last bars of the crescendo: skimming the inner edge, the disk racing past
  S('3.skim', B(35), B(37), 'bh', (t, u) => ({
    cam: orbitCam([0, 0, 0], kf(u, [[0, 16], [1, 9.5, 'inOutSine']]), kf(u, [[0, 330], [1, 395]]), kf(u, [[0, 9], [1, 4]]), kf(u, [[0, 64], [1, 76]])),
    u: { ...base, ...disk(t), ...diskState(t), uHaze: 0.7, uHazeH: 0.03 },
    post: { exposure: kf(u, [[0, -1.0], [1, -1.7]]), bloom: 0.14 + 0.1 * swell(t), tm: 0.7, vignette: 0.45 },
  }), { defines: { HAS_REMNANT: 1 }, spp: 3 }),
  // stop: the music cuts — silent, still
  S('3.stop', B(37), B(38), 'bh', (t, u) => ({
    cam: orbitCam([0, 0, 0], 30, 8, 5, 34),
    u: { ...base, ...disk(t), uDisk: 1, uDiskBright: 2.9, uDiskTemp: 6700 },
    post: { exposure: kf(u, [[0, -0.6], [1, -0.9]]), bloom: 0.1, tm: 0.7, vignette: 0.45 },
  }), { defines: { HAS_REMNANT: 1 } }),
];
export default shots3.map((sh) => (sh.scene === 'bh' && !sh.defines ? { ...sh, defines: { HAS_REMNANT: 1 } } : sh));
