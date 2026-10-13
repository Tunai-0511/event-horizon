// ACT V — US (527.50–625.70): our solar system, computed (N-body), falls into the hole.
// 18 years of fall are time-lapsed with a smooth speed ramp: the planets keep orbiting while the tide slowly distorts
// the system; at the end the hole takes Jupiter, the Sun (lensed into a ring as it passes behind), the inner planets,
// and last of all the outer planets that the tide had strung out behind.
import { S, bar, kf, ramp, ease, add, mul, norm, sub, cross, dot, joinNamed } from './kit.js';
import { DEFAULTS } from '../scenes/bh.js';
import { bodyAt, solarUniforms, trailLines, trailOverlay, pchip, T_SUN, ECL_N, timeAtRadius, PERIOD } from '../scenes/solarsim.js';

const A = 4;
const B = (k) => bar(A, k);
const T0 = B(0);
const disk = (t) => ({ uDiskTime: t - T0 + 60, uDiskSpeed: 0.03 });
const D = { HAS_SOLAR: 1 };
const post = { exposure: 0.3, bloom: 0.12, tm: 0.7, vignette: 0.42 };
// the hole after its quasar years: a dim, cool disk; the Sun is the brightest thing near it
const EMBER = { uDiskBright: 0.34, uDiskTemp: 4400, uDiskTau: 0.8 };

// film time -> simulation time: monotone speed ramp through the Sun's milestones (log of the time left)
const TEND = T_SUN + 70;
const tr = (R) => Math.log(TEND - timeAtRadius(R));
const LOGREM = pchip([
  [B(0), tr(1500)], [B(6), tr(1100)], [B(10), tr(700)], [B(14), tr(400)], [B(16), tr(200)], [B(18), tr(60)], [B(20), tr(25)], [B(22), tr(8)],
  [B(23), tr(5)], [B(24), Math.log(TEND - T_SUN)], [B(25), Math.log(TEND - (T_SUN + 34))], [B(26), Math.log(TEND - (T_SUN + 50))],
]);
export const tauAt = (t) => TEND - Math.exp(LOGREM(t));
const dTauAt = (t) => (tauAt(t + 0.02) - tauAt(t - 0.02)) / 0.04;

// exposure window of the trails: ~ two thirds of the Earth's year early on, shrinking with the speed ramp
const EARTH_YEAR = 2138;
// each body's exposure: one revolution where the history allows it, shrinking with the time left near the end
const winAt = (t) => (k) => Math.min(1.02 * PERIOD[k], 0.8 * (TEND - tauAt(t)));
const world = (t, extra = {}) => ({ ...DEFAULTS, ...disk(t), ...EMBER, ...solarUniforms(tauAt(t), dTauAt(t)), ...extra });
const trails = trailOverlay((t) => trailLines(tauAt(t), winAt(t)));
const trailsFixed = trailOverlay((t) => trailLines(tauAt(t), winAt(t), { coMoving: false }));

// camera in the system's frame: h = toward the hole, n = ecliptic normal (made orthogonal to h), s = side
function frame(t) {
  const Sx = bodyAt(0, Math.min(tauAt(t), T_SUN - 0.5));
  const h = norm(mul(Sx, -1));
  const n = norm(sub(ECL_N, mul(h, dot(ECL_N, h))));
  const s = cross(h, n);
  return { Sx, h, n, s };
}
const at = (f, a, b, c) => add(f.Sx, add(add(mul(f.h, a), mul(f.n, b)), mul(f.s, c)));

const shots = [
  // quiet -> intro -> first build phrase, one take: home. Close to the Sun among the inner orbits, the camera draws
  // back until all eight paths are in frame, then swings round so the hole — a faint point — sits behind the system.
  S('5.system', B(0), B(10), 'bh', (t, u) => {
    const f = frame(t);
    const k = ease.inOutSine(ramp(t, B(0) + 1, B(6)));
    const sw = ease.inOutSine(ramp(t, B(5), B(10)));
    const d = 0.12 * Math.pow(3.4 / 0.12, k);
    const ang = Math.PI * (0.25 + 0.75 * sw);
    const el = kf(t, [[B(0), 0.75], [B(6), 0.55], [B(10), 0.22]]);
    const pos = at(f, d * Math.cos(ang) * Math.cos(el), d * Math.sin(el), d * Math.sin(ang) * Math.cos(el));
    const look = add(f.Sx, mul(f.h, kf(t, [[B(5), 0], [B(10), 0.9 * d]])));
    return { cam: { pos, look, up: f.n, fov: kf(t, [[B(0), 50], [B(10), 44]]) }, u: world(t), post: { ...post, exposure: kf(t, [[B(0), -4], [B(0) + 3, 0.3, 'outSine']]) } };
  }, { defines: D, overlay: trails, dissolve: 3.0 }),
  // build: the fall, one take from behind the system: the hole grows in the distance; the outer paths begin to bend
  S('5.fall', B(10), B(18), 'bh', (t, u) => {
    const f = frame(t);
    const d = kf(t, [[B(10), 3.4], [B(12), 1.3, 'inOutSine'], [B(18), 1.0]]);
    const pos = at(f, -d * 0.93, d * kf(t, [[B(10), 0.22], [B(18), 0.3]]), d * kf(t, [[B(10), 0.0], [B(18), 0.25]]));
    const look = add(f.Sx, mul(f.h, kf(t, [[B(10), 3.0], [B(18), 2.0]])));
    return { cam: { pos, look, up: f.n, fov: kf(t, [[B(10), 44], [B(18), 50]]) }, u: world(t), post };
  }, { defines: D, overlay: trails }),
  // dip: the Earth's path, the hole filling the sky behind it
  S('5.home', B(18), B(20), 'bh', (t, u) => {
    const f = frame(t);
    const pos = at(f, -0.22, 0.09, 0.05);
    return { cam: { pos, look: add(f.Sx, mul(f.h, 2)), up: f.n, fov: 52 }, u: world(t), post: { ...post, exposure: 0.45 } };
  }, { defines: D, overlay: trails }),
];

// climax, one take from a fixed point on the far side: Jupiter goes first, then the Sun — lensed into a ring as it
// passes behind the hole — the inner planets, and last the outer planets the tide had strung out behind
const SUNEND = bodyAt(0, T_SUN - 3);
const CAM = add(mul(norm(SUNEND), -26), [0.4, 3.2, 0.3]);
shots.push(
  S('5.plunge', B(20), B(25), 'bh', (t, u) => ({
    cam: { pos: mul(CAM, kf(t, [[B(20), 1.0], [B(25), 0.85]])), look: [0, 0, 0], fov: kf(t, [[B(20), 40], [B(24), 34]]) },
    u: world(t), post: { ...post, exposure: kf(t, [[B(20), 0.45], [B(25), 0.3]]), bloom: 0.14 },
  }), { defines: D, overlay: trailsFixed }),
  // stop: hard cut, silence: nothing of us remains
  S('5.stop', B(25), B(26), 'bh', (t, u) => ({
    cam: { pos: mul(CAM, 0.85), look: [0, 0, 0], fov: 34 },
    u: { ...DEFAULTS, ...disk(t), ...EMBER }, post: { ...post, exposure: kf(u, [[0, 0.3], [1, 0.1]]) },
  })),
);
export default joinNamed(shots, ['5.home'], 2.0);
