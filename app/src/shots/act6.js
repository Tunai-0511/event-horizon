// ACT VI — HORIZON (625.70–775.13): we fall in. The camera is a free-falling observer (the "rain" frame: radial infall
// from rest at infinity, v = sqrt(r_s/r) relative to static observers), so the view is physically right all the way
// through the horizon: the shadow grows, nothing happens at the horizon, and inside it the outside universe is
// squeezed into a blueshifted ring ahead and a reddening, fading sky behind, until the singularity ends everything.
// Proper time to fall from r to 0:  tau = (2/3) r^(3/2)  (r_s = c = 1).
import { S, bar, kf, ramp, ease, orbit, add, mul, norm, cross, pchip } from './kit.js';
import { DEFAULTS } from '../scenes/bh.js';
import { DURATION } from '../music.js';

const A = 5;
const B = (k) => bar(A, k);
const T0 = B(0);
const disk = (t) => ({ uDiskTime: t - T0 + 80, uDiskSpeed: 0.03 });
const base = (t) => ({ ...DEFAULTS, ...disk(t), uObsFall: 1, uDiskBright: 2.2, uDiskTemp: 6300 });
const post = { exposure: -0.5, bloom: 0.12, tm: 0.7, vignette: 0.45 };

// film time -> radius: a smooth speed ramp in log r through the act's sections (the fall itself is free fall:
// the mapping only decides how fast the film's clock runs against the observer's proper time)
const LOGR = pchip([
  [B(0), Math.log(140)], [B(6), Math.log(60)], [B(14), Math.log(14)], [B(22), Math.log(3.2)], [B(30), Math.log(1.25)],
  [B(32), Math.log(0.82)], [B(37), Math.log(0.015)],
]);
const R = (t) => Math.exp(LOGR(t));
const AZ = 20, EL = 14;
const posAt = (t) => orbit([0, 0, 0], R(t), AZ, EL);

// view: 'in' = toward the hole; mixes with the side / outward directions by angles (deg) yaw (around the up axis)
// and pitch (up = away from the disk side)
function view(t, yaw = 0, pitch = 0, fov = 60, roll = 0) {
  const p = posAt(t), out = norm(p);
  const inw = mul(out, -1);
  const side = norm(cross([0, 1, 0], out));
  const up = norm(cross(out, side));
  const a = (yaw * Math.PI) / 180, b = (pitch * Math.PI) / 180;
  const f = norm(add(add(mul(inw, Math.cos(a) * Math.cos(b)), mul(side, Math.sin(a) * Math.cos(b))), mul(up, Math.sin(b))));
  return { pos: p, fwd: f, up, fov, roll };
}

const shots = [
  // quiet + intro + build, one long take: alone, falling. The hole and its disk grow from a distant jewel to the whole
  // sky; the camera drifts to the side to watch the disk's far side arch over the shadow
  S('6.fall', B(0), B(22), 'bh', (t, u) => ({
    cam: view(t, kf(t, [[B(0), 0], [B(10), 0], [B(16), 14], [B(22), 24]]), kf(t, [[B(0), 0], [B(14), -4], [B(22), -10]]),
      kf(t, [[B(0), 30], [B(8), 34], [B(16), 58], [B(22), 84]])),
    u: base(t),
    post: { ...post, exposure: kf(t, [[B(0), -0.4], [B(16), -0.6], [B(22), -0.9]]) },
  }), { dissolve: 4.0 }),
  // build, one take: past the photon sphere the camera turns to look along the fall's side — the sky folds into a band
  S('6.sphere', B(22), B(30), 'bh', (t, u) => ({
    cam: view(t, kf(t, [[B(22), 24], [B(26), 70], [B(30), 82]]), kf(t, [[B(22), -10], [B(30), -4]]), kf(t, [[B(22), 84], [B(30), 104]])),
    u: base(t), post: { ...post, exposure: kf(t, [[B(22), -0.9], [B(30), -1.1]]) },
  })),
  // dip: the horizon passes. Nothing happens — the camera swings back to look ahead
  S('6.horizon', B(30), B(32), 'bh', (t, u) => ({
    cam: view(t, kf(t, [[B(30), 82], [B(32), 18, 'inOutSine']]), kf(t, [[B(30), -4], [B(32), 0]]), kf(t, [[B(30), 104], [B(32), 110]])),
    u: base(t), post: { ...post, exposure: kf(t, [[B(30), -1.1], [B(32), -1.4]]) },
  })),
  // climax, one take inside the horizon. For the falling observer the light of the universe can now only arrive from
  // outside a black cone ahead of half-angle acos(sqrt(r)); at its edge the light is blueshifted without limit. The
  // camera follows that edge as the cone opens toward 90 degrees: the universe becomes a blazing ring, then a line.
  S('6.inside', B(32), B(37), 'bh', (t, u) => {
    const cone = (Math.acos(Math.sqrt(Math.min(R(t), 1))) * 180) / Math.PI;
    return {
      cam: view(t, Math.max(18, cone - 10), 0, kf(t, [[B(32), 110], [B(37), 96]]), kf(t, [[B(32), 0], [B(37), 24]])),
      u: { ...base(t), uStars: kf(t, [[B(32), 1.2], [B(36), 2.2]]), uMilky: kf(t, [[B(32), 1.2], [B(36), 2.2]]) },
      post: { ...post, exposure: kf(t, [[B(32), -1.4], [B(34), -2.2], [B(37), -3.6]]), bloom: kf(t, [[B(32), 0.12], [B(37), 0.24]]) },
    };
  }),
  // the singularity: nothing
  S('6.black', B(37), DURATION, 'black', () => ({ cam: { pos: [0, 0, 0], fwd: [0, 0, -1] } }), { spp: 1 }),
];
export default shots;
