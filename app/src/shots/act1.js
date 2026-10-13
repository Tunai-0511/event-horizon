// ACT I — THE ENDLESS (0–143.54): from nothing, stars; the Milky Way; a dive into a deep field of galaxies;
// then the nebula that will give birth to the giant star (nebula shots appended from the nebula scene).
import { S, bar, kf, ramp, hit, kicks, ease, joinNamed, add, mul, norm } from './kit.js';
import { SKY } from '../u.js';
import { act1Shots, SKY_ROT, CAMS as NEB_CAMS } from '../scenes/nebula.js';
import { camBasis } from '../cam.js';

const A = 0;
const B = (k) => bar(A, k);
// organ chords of the intro (onsets) — each unveils a layer of the sky
const CHORDS = [15.45, 16.05, 16.65, 17.30];
// the whole act shares the nebula's sky orientation (SKY_ROT: world -> celestial), so the open-space shots and the
// nebula shots show the same Milky Way and the same stars; celestial targets are converted to world directions
const RT = (c) => { const m = SKY_ROT; return [m[0] * c[0] + m[1] * c[1] + m[2] * c[2], m[3] * c[0] + m[4] * c[1] + m[5] * c[2], m[6] * c[0] + m[7] * c[1] + m[8] * c[2]]; };
const FWD = RT([0.93, 0.02, 0.36]);    // where we look first: just beside the galactic centre
const DEEP = RT([0.31, 0.93, 0.2]);    // a dark patch far from the galactic plane
// where the nebula's first shot begins: the open sky must end exactly there so the cloud can appear in it
const EXT0 = camBasis(NEB_CAMS.exterior(0));

const shots1 = [
  S('1.void', 0, B(4), 'space', (t, u) => ({
    cam: { pos: [0, 0, 0], fwd: FWD, fov: kf(t, [[0, 52], [B(4), 47, 'lin']]) },
    u: { ...SKY, uSkyRot: SKY_ROT, uSkyAmt: 1, uStars: 1, uMilky: kf(t, [[6, 0], [B(4), 0.18]]), uGal: 0.6,
      uStarReveal: kf(t, [[3.0, 0.0], [B(4), 0.10, 'inSine']]),
      uHeroDir: [0.93, 0.02, 0.36], uHeroFlux: 7000 * ramp(t, B(0), B(0) + 2.4, 'outSine'), uHeroTemp: 9500 },
    post: { exposure: 0.2, bloom: 0.1, vignette: 0.3 },
  })),
  S('1.unveil', B(4), B(6), 'space', (t, u) => {
    const steps = CHORDS.map((c, i) => [c, i]);
    let rev = 0.10, mw = 0.18;
    for (const [c, i] of steps) { const k = ramp(t, c, c + 0.45, 'outCubic'); rev += k * [0.12, 0.2, 0.25, 0.33][i]; mw += k * 0.36; }
    return {
      cam: { pos: [0, 0, 0], fwd: FWD, fov: kf(u, [[0, 47], [1, 62]]), roll: kf(u, [[0, 0], [1, -8]]) },
      u: { ...SKY, uSkyRot: SKY_ROT, uSkyAmt: 1, uStarReveal: Math.min(rev, 1), uMilky: Math.min(mw, 1.4), uGal: 0.8, uHeroDir: [0.93, 0.02, 0.36], uHeroFlux: 7000, uHeroTemp: 9500 },
      post: { exposure: 0.2, bloom: 0.06 + 0.06 * kicks(t, CHORDS, 0.5), vignette: 0.3, tm: 0.6, sat: 1.15 },
    };
  }),
  // build, one take: the camera turns from the galactic centre to a dark patch of sky and dives into it — thousands of
  // galaxies — then pulls back out and turns to where, against the Milky Way, a dark cloud is waiting
  S('1.deep', B(6), B(10), 'space', (t, u) => {
    const z = ramp(t, B(6) + 1.5, B(9) - 0.6, 'inOutSine');                // dive in
    const o = ramp(t, B(9) - 0.6, B(10), 'inOutSine');                     // pull back out
    const pan = ramp(t, B(6), B(6) + 3.2, 'inOutSine');
    const turn = ramp(t, B(9), B(10), 'inOutSine');
    const toDeep = norm(add(mul(FWD, 1 - pan), mul(DEEP, pan)));
    const fwd = norm(add(mul(toDeep, 1 - turn), mul(EXT0.f, turn)));
    const fovIn = 62 * Math.pow(0.16 / 62, z);
    const fov = fovIn * Math.pow(EXT0.fov / fovIn, o);
    return {
      cam: { pos: [0, 0, 0], fwd, up: [0, 1, 0], fov, roll: 12 * z * (1 - o) },
      u: { ...SKY, uSkyRot: SKY_ROT, uSkyAmt: 1, uGal: 1, uGalDeep: 1, uMilky: kf(t, [[B(6), 1.4], [B(7), 0.6], [B(9), 0.6], [B(10), 1.4]]) },
      post: { exposure: kf(t, [[B(6), 0.2], [B(8), 0.9], [B(9), 0.9], [B(10), 0.5]]), bloom: 0.06, vignette: 0.35, tm: 0.6, sat: 1.15 },
    };
  }),
  // the nebula: exterior -> pillars -> interior -> collapse -> disk -> ignition -> aftermath (nebula scene)
  ...act1Shots({ spp: 12 }).map((sh) => (sh.id === 'neb_exterior' ? { ...sh, dissolve: 3.0 } : sh)),
];
// the nebula cuts that would read as jump cuts become continuous moves
export default joinNamed(joinNamed(shots1, ['neb_pillarsClose', 'neb_spiral', 'neb_blast', 'neb_cluster', 'neb_diskClose', 'neb_jets', 'neb_front', 'neb_aftermath'], 1.8), ['1.deep'], 3.0);
