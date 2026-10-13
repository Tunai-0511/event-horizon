// Flags jump cuts: consecutive shots whose framing barely changes (similar view direction, position and fov)
// — those read as a glitch rather than a cut. Usage: node tools/cutcheck.mjs
import { shots } from '../app/src/timeline.js';
import { camBasis } from '../app/src/cam.js';

const s = shots.slice().sort((a, b) => a.t0 - b.t0);
const deg = 180 / Math.PI;
let flagged = 0;
for (let i = 1; i < s.length; i++) {
  const A = s[i - 1], B = s[i];
  if (Math.abs(A.t1 - B.t0) > 1e-3) continue;
  let ca, cb;
  try { ca = camBasis(A.at(A.t1 - 1e-3).cam); cb = camBasis(B.at(B.t0).cam); } catch (e) { console.log(`ERROR ${A.id} -> ${B.id}: ${e.message}`); flagged++; continue; }
  const dot = Math.max(-1, Math.min(1, ca.f[0] * cb.f[0] + ca.f[1] * cb.f[1] + ca.f[2] * cb.f[2]));
  const ang = Math.acos(dot) * deg;
  const dp = Math.hypot(ca.pos[0] - cb.pos[0], ca.pos[1] - cb.pos[1], ca.pos[2] - cb.pos[2]);
  const scale = Math.max(1e-6, Math.hypot(...ca.pos));
  const rel = dp / scale;
  const fovr = Math.max(ca.fov, cb.fov) / Math.min(ca.fov, cb.fov);
  const same = ang < 0.5 && rel < 0.01 && fovr < 1.01 && A.scene === B.scene;
  const jump = !same && A.scene === B.scene && ang < 25 && rel < 0.35 && fovr < 1.5;
  if (jump) { flagged++; console.log(`JUMP  ${B.t0.toFixed(2)}  ${A.id} -> ${B.id}   view ${ang.toFixed(1)} deg, move ${(rel * 100).toFixed(0)}%, fov x${fovr.toFixed(2)}`); }
}
console.log(`${flagged} suspicious cut(s)`);
