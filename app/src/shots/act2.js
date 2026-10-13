// ACT II — THE GIANT (143.54–241.77): the massive star's life (star scene) and its death (nova scene).
import { S, bar, ramp, ease, add, mul, norm, joinNamed } from './kit.js';
import { camBasis } from '../cam.js';
import { SKY } from '../u.js';
import { filmShots as starShots } from '../scenes/star.js';
import { novaShots } from '../scenes/nova.js';

// the supernova (219.07–241.77) and the first half of the remnant drift; the black hole takes over at 249.29
const HANDOVER = bar(2, 2);
const nova = novaShots().map((s) => (s.id === 'nova-remnant' ? { ...s, t1: HANDOVER } : s));
// no cut between the core bounce and the shock breakout: the breakout camera starts on the bounce's last framing
// and eases onto its own path over the first ~1.6 s
{
  const bo = nova.find((s) => s.id === 'nova-bounce'), br = nova.find((s) => s.id === 'nova-breakout');
  const end = camBasis(bo.at(bo.t1 - 1e-3).cam);
  const orig = br.at;
  br.at = (t) => {
    const st = orig(t);
    const w = ease.inOutSine(ramp(t, br.t0, br.t0 + 1.6));
    if (w >= 1) return st;
    const cb = camBasis(st.cam);
    const fwd = norm(add(mul(end.f, 1 - w), mul(cb.f, w)));
    return { ...st, cam: { pos: add(mul(end.pos, 1 - w), mul(cb.pos, w)), fwd, up: [0, 1, 0], fov: end.fov + (cb.fov - end.fov) * w } };
  };
}
const stars = starShots();
// the act begins with the nebula's newborn blue star dissolving into the close view of its limb
stars[0] = { ...stars[0], dissolve: 4.5 };
// the core collapse dissolves into the bounce (the blinding point becomes the light inside the star)
const novaD = nova.map((s) => (s.id === 'nova-bounce' ? { ...s, dissolve: 1.2 } : s));
// the red supergiant's death throes and the explosion are continuous camera moves, not cuts
export default joinNamed([...stars, ...novaD], ['star_throes_b', 'star_throes_c', 'star_throes_d', 'nova-engulf', 'nova-echoes', 'nova-stop'], 2.2);
