// Thin WebGL2 layer: context, shader preprocessing (#include / defines), programs with reflected uniforms, render targets.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 unavailable');
  for (const e of ['EXT_color_buffer_float', 'OES_texture_float_linear', 'EXT_float_blend', 'EXT_color_buffer_half_float']) gl.getExtension(e);
  return gl;
}

const srcCache = new Map();
export function shaderSource(name) { const s = srcCache.get(name); if (s == null) throw new Error(`not loaded: ${name}`); return s; }
export async function loadShaderSources(names) {
  await Promise.all(names.map(async (n) => {
    if (srcCache.has(n)) return;
    const r = await fetch(`/shaders/${n}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`shader ${n}: ${r.status}`);
    srcCache.set(n, await r.text());
  }));
}

// Resolve #include "file" recursively (each file once). Unknown includes are fetched on demand by preload().
function expand(name, seen) {
  if (seen.has(name)) return '';
  seen.add(name);
  const s = srcCache.get(name);
  if (s == null) throw new Error(`shader source not loaded: ${name}`);
  return s.replace(/^[ \t]*#include\s+"([^"]+)".*$/gm, (_, inc) => `// ---- ${inc}\n${expand(inc, seen)}\n// ---- end ${inc}`);
}

export async function preload(name, seen = new Set()) {
  if (seen.has(name)) return;
  seen.add(name);
  await loadShaderSources([name]);
  const incs = [...srcCache.get(name).matchAll(/^[ \t]*#include\s+"([^"]+)"/gm)].map((m) => m[1]);
  for (const i of incs) await preload(i, seen);
}

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const lines = src.split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log || '');
    let ctx = '';
    if (m) { const ln = +m[1]; ctx = lines.slice(Math.max(0, ln - 4), ln + 2).map((l, i) => `${ln - 3 + i}: ${l}`).join('\n'); }
    throw new Error(`compile ${label}:\n${log}\n${ctx}`);
  }
  return sh;
}

export class Program {
  constructor(gl, fragName, defines = {}, vertSrc = VERT) {
    this.gl = gl;
    this.name = fragName;
    const head = ['#version 300 es', 'precision highp float;', 'precision highp int;', 'precision highp sampler3D;', 'precision highp sampler2D;',
      ...Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`)].join('\n');
    const body = expand(fragName, new Set()).replace(/^#version.*$/m, '');
    const fsrc = `${head}\n${body}`;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertSrc, `${fragName}.vert`));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc, fragName));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link ${fragName}: ${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.u[name] = { loc: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
  }

  use() { this.gl.useProgram(this.p); this._unit = 0; return this; }

  // set many uniforms; silently ignores names the shader optimised away
  set(vals) {
    const gl = this.gl;
    for (const k in vals) {
      const u = this.u[k];
      if (!u) continue;
      const v = vals[k];
      switch (u.type) {
        case gl.FLOAT: u.size > 1 ? gl.uniform1fv(u.loc, v) : gl.uniform1f(u.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(u.loc, false, v); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(u.loc, false, v); break;
        case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(u.loc, v) : gl.uniform1i(u.loc, v); break;
        case gl.SAMPLER_2D: case gl.SAMPLER_3D: {
          const unit = this._unit++;
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(u.type === gl.SAMPLER_3D ? gl.TEXTURE_3D : gl.TEXTURE_2D, v);
          gl.uniform1i(u.loc, unit);
          break;
        }
        default: throw new Error(`uniform ${k}: unsupported type ${u.type}`);
      }
    }
    return this;
  }
}

export function target(gl, w, h, fmt = 'rgba16f', filter = 'linear') {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const F = {
    rgba16f: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
    rgba32f: [gl.RGBA32F, gl.RGBA, gl.FLOAT],
    rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
  }[fmt];
  gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], F[2], null);
  const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`fbo ${fmt} ${w}x${h} incomplete: ${st}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, fmt };
}

export function bindTarget(gl, t) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
  gl.viewport(0, 0, t ? t.w : gl.drawingBufferWidth, t ? t.h : gl.drawingBufferHeight);
}

let vao = null;
export function fullscreen(gl) {
  if (!vao) vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
