// Camera angular speed per shot: where the star field will smear into dotted streaks at the given sub-frame count.
// px per frame of motion blur = angular speed * shutter/fps / pixel angle. With n sub-frames the streak is n dots.
import { shots } from '../app/src/timeline.js';
import { camBasis } from '../app/src/cam.js';
const fps = 30, shutter = 0.5;
const rows = [];
for (const s of shots) {
  let worst = 0, worstT = s.t0, fov = 45;
  for (let t = s.t0 + 0.02; t < s.t1 - 0.03; t += 0.1) {
    const a = camBasis(s.at(t).cam), b = camBasis(s.at(t + 0.01).cam);
    const ang = Math.acos(Math.min(1, a.f[0] * b.f[0] + a.f[1] * b.f[1] + a.f[2] * b.f[2])) / 0.01;     // rad/s (view direction)
    const rol = Math.acos(Math.min(1, a.u[0] * b.u[0] + a.u[1] * b.u[1] + a.u[2] * b.u[2])) / 0.01;     // roll proxy
    const w = Math.max(ang, rol * 0.5);
    if (w > worst) { worst = w; worstT = t; fov = a.fov; }
  }
  const pxAngle = (fov * Math.PI / 180) / 1080;
  const streak = worst * shutter / fps / pxAngle;
  rows.push({ id: s.id, t0: s.t0, t1: s.t1, spp: s.spp, degs: worst * 180 / Math.PI, streak, worstT });
}
rows.sort((a, b) => b.streak - a.streak);
for (const r of rows.filter((r) => r.streak > 3)) console.log(`${r.id.padEnd(18)} ${r.t0.toFixed(1).padStart(7)}-${r.t1.toFixed(1).padEnd(7)} spp${r.spp}  ${r.degs.toFixed(1).padStart(6)} deg/s  streak ${r.streak.toFixed(1).padStart(5)} px at ${r.worstT.toFixed(1)}`);
