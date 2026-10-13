// Long-exposure trails of moving point sources (screen-space ribbons, occluded by the horizon sphere).
import { Program, shaderSource } from './gl.js';

export class Trails {
  constructor(gl) { this.gl = gl; this.prog = null; this.count = 0; this.vao = gl.createVertexArray(); this.vbo = gl.createBuffer(); }
  // lines: [{ pts: [[x,y,z], ...] newest first, color: [r,g,b], intensity }]
  set(lines) {
    let n = 0;
    for (const L of lines) n += Math.max(0, L.pts.length - 1);
    const data = new Float32Array(n * 12);
    let o = 0;
    for (const L of lines) {
      const m = L.pts.length;
      for (let i = 0; i + 1 < m; i++) {
        data.set([...L.pts[i], i / (m - 1)], o);
        data.set([...L.pts[i + 1], (i + 1) / (m - 1)], o + 4);
        data.set([...L.color, L.intensity], o + 8);
        o += 12;
      }
    }
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    for (let a = 0; a < 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 48, a * 16); gl.vertexAttribDivisor(a, 1); }
    gl.bindVertexArray(null);
    this.count = n;
    return this;
  }
  draw(engine, cb, u = {}) {
    if (!this.count) return;
    const gl = this.gl;
    if (!this.prog) this.prog = new Program(gl, 'trails.frag', {}, shaderSource('trails.vert'));
    this.prog.use().set({
      uCamRot: cb.rot, uCamPos: cb.pos, uTanFov: Math.tan((cb.fov * Math.PI) / 360), uRes: [engine.W, engine.H], uJitter: cb.jitter,
      uWidth: Math.max(1.0, 1.3 * engine.H / 1080), uFadePow: 0.35, uWeight: cb.weight, ...u,
    });
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }
}
