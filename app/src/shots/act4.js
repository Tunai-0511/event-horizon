// ACT IV — DEVOUR (384.92–474.75, then the galaxy scene): a sun-like star on an eccentric orbit is torn apart by the
// hole. Everything here is the SPH simulation (tools/sph/tde.py: 32k particles, self-gravity, Paczynski–Wiita hole,
// radiative cooling of shocked gas), ray-marched along the bent light rays: the star stretches, the debris unspools
// into a stream, half of it swings back, the returning stream precesses, crosses itself, shocks and settles into a
// glowing disk. Nothing is posed by hand.
import { S, bar, kf, ramp, ease, orbit, add, mul, norm, sub, cross, pchip } from './kit.js';
import { DEFAULTS } from '../scenes/bh.js';
import { simLayer, centroid } from './simkit.js';

const SIM = 'tde';
const A = 3;
const B = (k) => bar(A, k);
const T0 = B(0);
const disk = (t) => ({ uDiskTime: t - T0 + 40, uDiskSpeed: 0.03 });

// film time -> simulation time: slow through the pericentre passage, fast through the long return
const tau = pchip([
  [B(0), 150], [B(4), 640], [B(6), 900], [B(8), 1040], [B(10), 1130], [B(12), 1320], [B(14), 2100],
  [B(16), 3900], [B(18), 5800], [B(20), 7800], [B(22), 9800], [B(24), 11300],
]);
const RHO_REF = 1e-6 / ((4 / 3) * Math.PI * 0.236 ** 3);

// volume boxes: a fine box on the star while it is whole (then on the inner disk), a coarse box holding all the debris
function boxes(T, parts) {
  const c = centroid(parts);
  let spread = 0, n = 0;
  for (let k = 0; k < parts.N; k += 7) {
    if (parts.pos[k * 4 + 3] <= 0) continue;
    spread = Math.max(spread, Math.hypot(parts.pos[k * 4] - c[0], parts.pos[k * 4 + 1] - c[1], parts.pos[k * 4 + 2] - c[2])); n++;
  }
  const fine = spread < 5 ? [...c, Math.max(0.6, spread * 1.25 + 0.3)] : [0, 0, 0, 26];
  // coarse: bounding cube of everything, capped (far debris then falls outside: it is faint and far)
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let k = 0; k < parts.N; k++) {
    if (parts.pos[k * 4 + 3] <= 0) continue;
    for (let i = 0; i < 3; i++) { const v = parts.pos[k * 4 + i]; lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); }
  }
  const cc = lo.map((v, i) => 0.5 * (v + hi[i]));
  const half = Math.min(220, Math.max(...lo.map((v, i) => 0.5 * (hi[i] - v))) * 1.05 + 1);
  return [fine, [...cc, Math.max(half, fine[3])]];
}
const sim = simLayer(SIM, { tau, boxes, opts: { rhoRef: RHO_REF, uRef: 8e-7, tRef: 5800, tGamma: 0.1, tMin: 1800 } });
const SIMU = { uSimKappa: 6, uSimRhoPow: 0.5, uSimBright: 14.0, uSimDoppler: 1, uSimTMax: 60000, uSimSat: 1.4 };
const D = { HAS_SIM: 1, MAXSTEPS: 1100 };
// the hole is quiet: its old disk has drained away long ago (it fades during the first bars)
const world = (t) => ({ ...DEFAULTS, ...disk(t), uDisk: kf(t, [[B(0), 0.35], [B(2), 0]]), uDiskBright: 0.6, uDiskTemp: 5200,
  ...sim.uniforms(), ...SIMU, uMilky: 0.7, uStars: 0.9 });
const post = { exposure: -1.2, bloom: 0.14, tm: 0.7, vignette: 0.42 };

// star centroid at film time t (from the data the layer last loaded; cameras that need it run after prepare)
const starC = () => centroid(sim.parts());

// the star's orbital plane (from the simulation's initial conditions): normal pointing to +y
const NUP = [0, 0.866, -0.5];
// aim between two subjects (unit-weighted directions), so both stay in frame
function aimBetween(P, a, b, wa) {
  const da = norm(sub(a, P)), db = norm(sub(b, P));
  return norm(add(mul(da, wa), mul(db, 1 - wa)));
}
// one continuous camera for the approach and the tearing: riding just behind the star with the hole ahead; rising above
// it as it is stretched through pericentre; then drawing back above the orbital plane as the debris unspools
function camNear(t) {
  const c = starC(), h = norm(mul(c, -1)), side = norm(cross(h, NUP));
  // A: behind and slightly above the star
  const pA = add(add(c, mul(h, -kf(t, [[B(0), 3.2], [B(6), 2.2]]))), add(mul(NUP, kf(t, [[B(0), 0.9], [B(6), 0.7]])), mul(side, 0.6)));
  // B: above the star, rising
  const up = kf(t, [[B(6), 2.6], [B(10), 3.4], [B(14), 70, 'inExpo']]);
  const pB = add(add(c, mul(NUP, up)), mul(h, -0.25 * up));
  const w = ramp(t, B(4.5), B(8), 'inOutSine');
  const pos = add(mul(pA, 1 - w), mul(pB, w));
  // subjects: the star (or the debris' centre) and the hole; the star dominates, the hole takes over at the end
  const ws = kf(t, [[B(0), 0.72], [B(6), 0.85], [B(10), 0.8], [B(14), 0.45]]);
  return { pos, fwd: aimBetween(pos, c, [0, 0, 0], ws), up: [0, 1, 0], fov: kf(t, [[B(0), 52], [B(6), 54], [B(14), 50]]) };
}

export default [
  // quiet + intro + two build phrases, one take: a lone star falls toward the hole; it bulges toward it, is stretched
  // along the line to the hole and squeezed across it, and torn; the camera draws back as the debris unspools
  S('4.near', B(0), B(14), 'bh', (t, u) => ({
    cam: camNear(t), u: world(t), post: { ...post, exposure: kf(t, [[B(0), -4], [B(0) + 3, -1.2, 'outSine'], [B(10), -1.0], [B(14), 0.2]]) },
  }), { defines: D, prepare: sim.prepare, spp: 3, dissolve: 4.0 }),
  // build, one take from above the orbit: the debris swings out to apocentre and back, again and again (one orbit per
  // two bars); each pass through pericentre stretches it further, the relativistic precession turns its orbit a little
  // each time, and the returning gas runs into itself and heats up. The camera drifts down toward the hole at the end.
  S('4.return', B(14), B(24), 'bh', (t, u) => {
    const W = [0, 0.5, 0.866];                                     // in-plane axis (orbit's initial velocity direction)
    const centre = add(mul([1, 0, 0], kf(t, [[B(14), 27], [B(22), 18], [B(24), 6]])), mul(W, kf(t, [[B(14), 0], [B(24), -6]])));
    const D = kf(t, [[B(14), 175], [B(20), 150], [B(23), 140], [B(24), 72, 'inOutSine']]);
    const tilt = kf(t, [[B(14), 0.35], [B(24), 0.75]]);            // lean from straight above toward the orbit plane
    const dir = norm(add(mul(NUP, 1), add(mul([1, 0, 0], -tilt * 0.6), mul(W, tilt * 0.8))));
    const o = { pos: add(centre, mul(dir, D)), look: centre, fov: kf(t, [[B(14), 46], [B(24), 50]]) };
    const of = norm(sub(o.look, o.pos));
    const w = ramp(t, B(14), B(16.5), 'inOutSine');
    const ex = { ...post, exposure: kf(t, [[B(14), 0.4], [B(20), 0.2], [B(24), -0.2]]) };
    if (w >= 1) return { cam: { pos: o.pos, fwd: of, up: [1, 0, 0], fov: o.fov }, u: world(t), post: ex };
    const n = camNear(B(14) - 1e-3);
    return {
      cam: { pos: add(mul(n.pos, 1 - w), mul(o.pos, w)), fwd: norm(add(mul(n.fwd, 1 - w), mul(of, w))), up: norm(add(mul([0, 1, 0], 1 - w), mul([1, 0, 0], w))), fov: n.fov + (o.fov - n.fov) * w },
      u: world(t), post: ex,
    };
  }, { defines: D, prepare: sim.prepare, spp: 3 }),
];

function orbitCam(dist, az, el, fov) { return { pos: orbit([0, 0, 0], dist, az, el), look: [0, 0, 0], fov }; }
