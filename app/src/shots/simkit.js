// Simulation layers for shots: an SPH run (tools/sph) played back at a film-time -> simulation-time mapping and
// splatted into the shared volume that bh.frag ray-marches (HAS_SIM).
import { SimPlayer, SimVolume } from '../sim.js';

let VOL = null;
export function simLayer(name, { tau, boxes, opts }) {
  const player = new SimPlayer(name);
  let uni = {}, parts = null;
  return {
    async prepare(engine, T) {
      const t0 = performance.now();
      parts = await player.at(tau(T));
      const t1 = performance.now();
      VOL ??= new SimVolume(engine.gl, 160, 32);
      VOL.update(parts, boxes(T, parts), opts);
      if (globalThis.__simProfile) { engine.gl.finish(); console.log(`sim ${name}: load+interp ${(t1 - t0).toFixed(0)} ms, splat ${(performance.now() - t1).toFixed(0)} ms`); }
      uni = VOL.uniforms();
    },
    uniforms: () => uni,
    parts: () => parts,
  };
}

// centre of mass of the alive particles (for following a body)
export function centroid(parts) {
  if (!parts) return [0, 0, 0];
  let s = [0, 0, 0], n = 0;
  for (let k = 0; k < parts.N; k++) if (parts.pos[k * 4 + 3] > 0) { s[0] += parts.pos[k * 4]; s[1] += parts.pos[k * 4 + 1]; s[2] += parts.pos[k * 4 + 2]; n++; }
  return n ? s.map((v) => v / n) : s;
}

// bounding cube of the alive particles, padded
export function bounds(parts, pad = 1.06, minHalf = 1) {
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let k = 0; k < parts.N; k++) {
    if (parts.pos[k * 4 + 3] <= 0) continue;
    for (let c = 0; c < 3; c++) { const v = parts.pos[k * 4 + c]; if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
  }
  const c = lo.map((v, i) => 0.5 * (v + hi[i]));
  const h = Math.max(...lo.map((v, i) => 0.5 * (hi[i] - v))) * pad + 0.5;
  return [...c, Math.max(h, minHalf)];
}
