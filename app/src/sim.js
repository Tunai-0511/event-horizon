// Playback of SPH simulations (tools/sph): snapshots -> Hermite-interpolated particles -> splatted on the GPU into
// two nested density/temperature/velocity volumes that bh.frag ray-marches along the bent rays.
import { Program, shaderSource, preload } from './gl.js';

const FIELDS = 8; // x y z vx vy vz h u

export class SimPlayer {
  constructor(name) { this.name = name; this.meta = null; this.cache = new Map(); }

  async init() {
    if (this.meta) return;
    const r = await fetch(`/data/sim/${this.name}/meta.json`, { cache: 'no-store' });
    this.meta = await r.json();
    this.N = this.meta.N;
    this.times = this.meta.times;
  }

  async snap(k) {
    if (this.cache.has(k)) return this.cache.get(k);
    const r = await fetch(`/data/sim/${this.name}/s${String(k).padStart(5, '0')}.bin`, { cache: 'no-store' });
    const a = new Float32Array(await r.arrayBuffer());
    this.cache.set(k, a);
    if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value);
    return a;
  }

  // particles at simulation time tau: { pos: Float32Array(N*4) x,y,z,h ; aux: Float32Array(N*4) vx,vy,vz,u }
  async at(tau) {
    await this.init();
    const T = this.times;
    let k = 0;
    while (k + 1 < T.length - 1 && T[k + 1] <= tau) k++;
    const t0 = T[k], t1 = T[Math.min(k + 1, T.length - 1)];
    const dt = Math.max(t1 - t0, 1e-9);
    const f = Math.min(Math.max((tau - t0) / dt, 0), 1);
    const A = await this.snap(k), B = await this.snap(Math.min(k + 1, T.length - 1));
    const N = this.N;
    const pos = new Float32Array(N * 4), aux = new Float32Array(N * 4);
    const h00 = 2 * f ** 3 - 3 * f * f + 1, h10 = f ** 3 - 2 * f * f + f, h01 = -2 * f ** 3 + 3 * f * f, h11 = f ** 3 - f * f;
    for (let i = 0; i < N; i++) {
      const a = i * FIELDS;
      const ha = A[a + 6], hb = B[a + 6];
      if (ha <= 0 || hb <= 0) { pos[i * 4 + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) {
        pos[i * 4 + c] = h00 * A[a + c] + h10 * dt * A[a + 3 + c] + h01 * B[a + c] + h11 * dt * B[a + 3 + c];
        aux[i * 4 + c] = A[a + 3 + c] + (B[a + 3 + c] - A[a + 3 + c]) * f;
      }
      pos[i * 4 + 3] = ha + (hb - ha) * f;
      aux[i * 4 + 3] = A[a + 7] * Math.pow(Math.max(B[a + 7], 1e-30) / Math.max(A[a + 7], 1e-30), f);
    }
    return { pos, aux, N, m: this.meta.m };
  }
}

// GPU side: particle textures, two volume levels (inner fine box, outer coarse box), occupancy grids
export class SimVolume {
  constructor(gl, res = 192, occRes = 32) {
    this.gl = gl; this.res = res; this.occRes = occRes;
    this.levels = [0, 1].map(() => this._level());
    this.pTex = this._ptex(); this.aTex = this._ptex();
    this.prog = null;
  }
  _ptex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  _vol(fmt, res, mips = false) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    const levels = mips ? 1 + Math.floor(Math.log2(res)) : 1;
    if (fmt === 'rgba16f') gl.texStorage3D(gl.TEXTURE_3D, levels, gl.RGBA16F, res, res, res);
    else gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, res, res, res);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, fmt === 'rgba16f' ? (mips ? gl.LINEAR_MIPMAP_NEAREST : gl.LINEAR) : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, fmt === 'rgba16f' ? gl.LINEAR : gl.NEAREST);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
    return t;
  }
  _level() {
    // A is mipmapped: its coarse levels are the occupancy (the mean of a non-negative density is 0 only where it is empty)
    return { A: this._vol('rgba16f', this.res, true), B: this._vol('rgba16f', this.res), box: [0, 0, 0, 1], fbo: this.gl.createFramebuffer() };
  }

  // particles: { pos, aux, N, m }; boxes: [[cx,cy,cz,halfSize], [cx,cy,cz,halfSize]]; opts: { rhoRef, tScale }
  update(parts, boxes, opts) {
    const gl = this.gl;
    const N = parts.N, W = 128, H = Math.ceil(N / W);
    const pad = (a) => { const o = new Float32Array(W * H * 4); o.set(a); return o; };
    gl.bindTexture(gl.TEXTURE_2D, this.pTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, pad(parts.pos));
    gl.bindTexture(gl.TEXTURE_2D, this.aTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, pad(parts.aux));
    if (!this.prog) {
      this.prog = new Program(gl, 'splat.frag', {}, shaderSource('splat.vert'));
      this.vao = gl.createVertexArray();
    }
    const prevBlend = gl.isEnabled(gl.BLEND);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let L = 0; L < this.levels.length; L++) {
      const lv = this.levels[L], box = boxes[L] ?? boxes[0];
      lv.box = box;
      const vox = (2 * box[3]) / this.res;
      gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.viewport(0, 0, this.res, this.res);
      this.prog.use().set({
        uParts: this.pTex, uAux: this.aTex, uTexW: W, uBox: box, uRes: this.res, uVox: vox, uMass: parts.m,
        uRhoRef: opts.rhoRef, uUA: opts.uRef ?? 8e-7, uTA: opts.tRef ?? 5800, uTGamma: opts.tGamma ?? 0.1, uTMin: opts.tMin ?? 1600,
      });
      gl.bindVertexArray(this.vao);
      for (let z = 0; z < this.res; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, lv.A, 0, z);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, lv.B, 0, z);
        gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
        gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
        this.prog.set({ uSlice: z });
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, N);
      }
      gl.bindTexture(gl.TEXTURE_3D, lv.A);
      gl.generateMipmap(gl.TEXTURE_3D);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawBuffers([gl.BACK]);
    if (!prevBlend) gl.disable(gl.BLEND);
  }

  uniforms() {
    const [a, b] = this.levels;
    return {
      uSimA0: a.A, uSimB0: a.B, uSimBox0: a.box,
      uSimA1: b.A, uSimB1: b.B, uSimBox1: b.box,
      uSimRes: this.res, uSimOccLod: 3,
    };
  }
}

export async function preloadSimShaders() { await preload('splat.vert'); await preload('splat.frag'); }
