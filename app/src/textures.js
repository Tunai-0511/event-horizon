// Procedural lookup textures, all computed at boot:
//   noise3D  128^3 tileable RGBA8 noise volume (see shaders/noisegen.frag), mipmapped, REPEAT
//   bbLUT    blackbody colour: Planck spectrum x CIE 1931 observer (Wyman et al. 2013 analytic fit) -> linear sRGB
import { Program } from './gl.js';

export function buildNoise3D(gl) {
  const N = 128;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.texStorage3D(gl.TEXTURE_3D, 1 + Math.log2(N), gl.RGBA8, N, N, N);
  const prog = new Program(gl, 'noisegen.frag');
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, N, N);
  prog.use();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (let z = 0; z < N; z++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
    prog.set({ uZ: (z + 0.5) / N });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (z % 32 === 0) { gl.finish(); window.dbg?.('noise layer ' + z); }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.generateMipmap(gl.TEXTURE_3D);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
  return tex;
}

// --- blackbody -------------------------------------------------------------------------------
export const BB = { N: 1024, Tmin: 400, Tmax: 200000 };
function g(x, mu, s1, s2) { const t = (x - mu) / (x < mu ? s1 : s2); return Math.exp(-0.5 * t * t); }
function cmf(l) {
  return [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ];
}
function planck(lnm, T) {
  const l = lnm * 1e-9, h = 6.62607015e-34, c = 2.99792458e8, k = 1.380649e-23;
  return (2 * h * c * c) / (l ** 5) / (Math.exp((h * c) / (l * k * T)) - 1);
}
export function blackbodyXYZ(T) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 360; l <= 830; l += 2) { const b = planck(l, T), m = cmf(l); X += b * m[0]; Y += b * m[1]; Z += b * m[2]; }
  return [X, Y, Z];
}
export function buildBlackbodyLUT(gl) {
  const { N, Tmin, Tmax } = BB;
  const data = new Float32Array(N * 4);
  const Yref = blackbodyXYZ(6500)[1];
  for (let i = 0; i < N; i++) {
    const T = Tmin * Math.pow(Tmax / Tmin, i / (N - 1));
    const [X, Y, Z] = blackbodyXYZ(T);
    let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
    let gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
    let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
    // out-of-gamut (very red / very blue): clip negatives, keep luminance
    r = Math.max(r, 0); gg = Math.max(gg, 0); b = Math.max(b, 0);
    const Yc = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    data.set([r / Yc, gg / Yc, b / Yc, Math.log10(Math.max(Y / Yref, 1e-30))], i * 4);
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, 1, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
