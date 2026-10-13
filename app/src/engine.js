// Frame engine: accumulates N jittered sub-frames (motion blur + AA) of a scene shader into an HDR buffer,
// then bloom -> streak -> tonemap/grade into an RGBA8 target that is shown on the canvas and read back for encoding.
import { Program, target, bindTarget, fullscreen, preload } from './gl.js';
import { buildNoise3D, buildBlackbodyLUT } from './textures.js';
import { camBasis } from './cam.js';

export const POST_DEFAULTS = {
  exposure: 0, bloom: 0.05, scatter: 0.75, streak: 0, streakThresh: 4, streakLen: 1, streakTint: [0.75, 0.85, 1.0],
  sat: 1, contrast: 1, lift: [0, 0, 0], gain: [1, 1, 1], tint: [1, 1, 1], vignette: 0.35, grain: 0.012, fade: 1, ca: 0, tm: 0,
};

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

export class Engine {
  constructor(gl, W, H) { this.gl = gl; this.W = W; this.H = H; this.progs = new Map(); this.frameNo = 0; }

  async init(sceneShaders) {
    const gl = this.gl;
    for (const n of ['noisegen.frag', 'post_down.frag', 'post_up.frag', 'post_streak.frag', 'post_final.frag', 'splat.vert', 'splat.frag', 'trails.vert', 'trails.frag', 'blend.frag', ...sceneShaders]) await preload(n);
    let t = performance.now();
    window.dbg?.('noise start');
    this.noise = buildNoise3D(gl);
    window.dbg?.('noise done');
    gl.finish();
    console.log(`noise volume ${(performance.now() - t).toFixed(0)} ms`); t = performance.now();
    this.bb = buildBlackbodyLUT(gl);
    console.log(`blackbody LUT ${(performance.now() - t).toFixed(0)} ms`);
    window.dbg?.('post programs');
    this.pDown = new Program(gl, 'post_down.frag');
    this.pUp = new Program(gl, 'post_up.frag');
    this.pStreak = new Program(gl, 'post_streak.frag');
    this.pFinal = new Program(gl, 'post_final.frag');
    this.pBlend = new Program(gl, 'blend.frag');
    this.alloc();
  }

  alloc() {
    const gl = this.gl, W = this.W, H = this.H;
    this.accum = target(gl, W, H, 'rgba16f');
    this.accumB = target(gl, W, H, 'rgba16f');
    this.accumC = target(gl, W, H, 'rgba16f');
    this.out = target(gl, W, H, 'rgba8', 'nearest');
    this.down = []; this.up = [];
    let w = W, h = H;
    for (let i = 0; i < 7; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.down.push(target(gl, w, h, 'rgba16f'));
      this.up.push(target(gl, w, h, 'rgba16f'));
    }
    this.streakT = target(gl, this.down[2].w, this.down[2].h, 'rgba16f');
    this.pixels = new Uint8Array(W * H * 4);
  }

  program(frag, defines = {}) {
    const key = frag + JSON.stringify(defines);
    let p = this.progs.get(key);
    if (!p) { window.dbg?.('compile ' + key); p = new Program(this.gl, frag, defines); this.progs.set(key, p); window.dbg?.('compiled ' + key); }
    return p;
  }

  // shot: { t0, t1, scene, defines, spp, at(t) -> state }
  // state: { cam:{pos, look|fwd, up, fov, roll}, u:{...}, post:{...} }
  renderFrame(shot, T, opts = {}) {
    this.accumulate(shot, T, opts, this.accum);
    const post = { ...POST_DEFAULTS, ...(shot.at(Math.min(Math.max(T, shot.t0), shot.t1 - 1e-4)).post || {}) };
    this.post(post, this.accum);
    this.frameNo++;
  }

  // cross-dissolve between two shots in HDR: each pre-scaled by its own exposure, grading interpolated
  // (prepare hooks are run by the caller between the two accumulations: they may share GPU resources)
  async renderDissolve(a, b, w, T, opts = {}, prepA, prepB) {
    if (prepA) await prepA();
    this.accumulate(a, T, { ...opts, hi: T + 10 }, this.accumB);
    if (prepB) await prepB();
    this.accumulate(b, T, { ...opts, lo: T - 10 }, this.accum);
    const pa = { ...POST_DEFAULTS, ...(a.at(T).post || {}) }, pb = { ...POST_DEFAULTS, ...(b.at(T).post || {}) };
    const gl = this.gl;
    bindTarget(gl, this.accumC);
    this.pBlend.use().set({ uA: this.accumB.tex, uB: this.accum.tex, uSa: 2 ** pa.exposure, uSb: 2 ** pb.exposure, uW: w });
    fullscreen(gl);
    const P = {};
    for (const k in pb) {
      const x = pa[k], y = pb[k];
      P[k] = typeof y === 'number' && typeof x === 'number' ? x + (y - x) * w : Array.isArray(y) && Array.isArray(x) ? x.map((v, i) => v + (y[i] - v) * w) : y;
    }
    P.exposure = 0;
    this.post(P, this.accumC);
    this.frameNo++;
  }

  accumulate(shot, T, { spp, shutter = 0.5, fps = 30, tiles = 1, lo, hi } = {}, dst = this.accum) {
    const gl = this.gl;
    const n = spp ?? this.adaptiveSpp(shot, T, shutter, fps);
    const tLo = lo ?? shot.t0, tHi = hi ?? shot.t1 - 1e-4;
    bindTarget(gl, dst);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const prog = this.program(shot.frag ?? `${shot.scene}.frag`, shot.defines ?? {});
    const sh = shot.shutter ?? shutter;
    for (let k = 0; k < n; k++) {
      let ts = T + sh * ((k + 0.5) / n - 0.5) / fps;
      ts = Math.min(Math.max(ts, tLo), tHi);
      const st = shot.at(ts);
      const cb = camBasis(st.cam);
      const cb2 = camBasis(shot.at(Math.min(ts + 1 / 240, tHi)).cam);
      const camVel = cb2.pos.map((x, i) => (x - cb.pos[i]) * 240);
      prog.use().set({
        uRes: [this.W, this.H],
        uJitter: [halton(k + 1 + (this.frameNo % 7) * n, 2) - 0.5, halton(k + 1 + (this.frameNo % 7) * n, 3) - 0.5],
        uTime: ts, uLocal: ts - shot.t0, uSeed: k + (this.frameNo % 997) * 16, uWeight: 1 / n, uSubDt: sh / fps / n, uCamVel: camVel,
        uCamPos: cb.pos, uCamRot: cb.rot, uTanFov: Math.tan((cb.fov * Math.PI) / 360),
        uNoise: this.noise, uBB: this.bb,
        ...(st.u || {}),
      });
      const jit = [halton(k + 1 + (this.frameNo % 7) * n, 2) - 0.5, halton(k + 1 + (this.frameNo % 7) * n, 3) - 0.5];
      if (tiles <= 1) fullscreen(gl);
      else {
        gl.enable(gl.SCISSOR_TEST);
        for (let y = 0; y < tiles; y++) {
          const y0 = Math.floor((this.H * y) / tiles), y1 = Math.floor((this.H * (y + 1)) / tiles);
          gl.scissor(0, y0, this.W, y1 - y0);
          fullscreen(gl);
          gl.flush();
        }
        gl.disable(gl.SCISSOR_TEST);
      }
      // optional geometry overlay drawn into the same HDR sub-frame (e.g. computed light paths)
      if (shot.overlay) shot.overlay(this, st, { ...cb, t: ts, weight: 1 / n, jitter: jit });
    }
    gl.disable(gl.BLEND);
  }

  // Motion-adaptive sub-frame count: a fast-turning camera smears point stars across many pixels per frame; with too few
  // sub-frames the streak breaks into dots. Use enough sub-frames that consecutive copies are ~1.2 px apart.
  adaptiveSpp(shot, T, shutter = 0.5, fps = 30) {
    const base = Math.max(1, shot.spp ?? 4);
    if (shot.adaptive === false) return base;
    const t0 = Math.min(Math.max(T, shot.t0), shot.t1 - 0.02);
    const a = camBasis(shot.at(t0).cam), b = camBasis(shot.at(t0 + 0.01).cam);
    const dotf = Math.min(1, a.f[0] * b.f[0] + a.f[1] * b.f[1] + a.f[2] * b.f[2]);
    const dotu = Math.min(1, a.u[0] * b.u[0] + a.u[1] * b.u[1] + a.u[2] * b.u[2]);
    const w = Math.max(Math.acos(dotf), 0.5 * Math.acos(dotu)) / 0.01;          // rad/s
    const px = (w * (shot.shutter ?? shutter)) / fps / (((a.fov * Math.PI) / 180) / this.H);
    return Math.max(base, Math.min(12, Math.ceil(px / 1.2)));
  }

  post(P, srcT = this.accum) {
    const gl = this.gl;
    // bloom pyramid
    let src = srcT;
    for (let i = 0; i < this.down.length; i++) {
      const d = this.down[i];
      bindTarget(gl, d);
      this.pDown.use().set({ uSrc: src.tex, uTexel: [1 / src.w, 1 / src.h], uKaris: i === 0 ? 1 : 0 });
      fullscreen(gl);
      src = d;
    }
    let coarse = this.down[this.down.length - 1];
    for (let i = this.down.length - 2; i >= 0; i--) {
      const u = this.up[i];
      bindTarget(gl, u);
      this.pUp.use().set({ uSrc: coarse.tex, uBase: this.down[i].tex, uTexel: [1 / coarse.w, 1 / coarse.h], uScatter: P.scatter });
      fullscreen(gl);
      coarse = u;
    }
    if (P.streak > 0) {
      bindTarget(gl, this.streakT);
      this.pStreak.use().set({ uSrc: this.down[1].tex, uTexel: [1 / this.streakT.w, 1 / this.streakT.h], uThresh: P.streakThresh, uLen: P.streakLen });
      fullscreen(gl);
    }
    bindTarget(gl, this.out);
    this.pFinal.use().set({
      uHdr: srcT.tex, uBloom: this.up[0].tex, uStreak: this.streakT.tex, uRes: [this.W, this.H], uFrame: this.frameNo,
      uExposure: P.exposure, uBloomAmt: P.bloom / (1 + P.scatter * 4), uStreakAmt: P.streak, uStreakTint: P.streakTint,
      uSat: P.sat, uContrast: P.contrast, uLift: P.lift, uGain: P.gain, uTint: P.tint, uVignette: P.vignette,
      uGrain: P.grain, uFade: P.fade, uCA: P.ca, uTonemap: P.tm,
    });
    fullscreen(gl);
    // show on canvas
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.out.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.W, this.H, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  read() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out.fbo);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.pixels; // bottom-up rows
  }

  finish() { this.gl.finish(); }
}
