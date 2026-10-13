#version 300 es
// Long-exposure trails: one instance = one segment of a body's recent path. Screen-aligned soft ribbon.
precision highp float;
layout(location = 0) in vec4 aP0;     // xyz, age (0 = now .. 1 = start of the exposure)
layout(location = 1) in vec4 aP1;
layout(location = 2) in vec4 aCol;    // rgb, intensity
uniform mat3 uCamRot;
uniform vec3 uCamPos;
uniform float uTanFov;
uniform vec2 uRes;
uniform vec2 uJitter;
uniform float uWidth;
uniform float uFadePow;
out float vI;
out float vD;
out vec3 vCol;
vec3 toCam(vec3 p) { return transpose(uCamRot) * (p - uCamPos); }
// hidden behind the horizon sphere (r = 1) along the straight sight line?
float visible(vec3 p) {
  // numerically stable: is the origin between camera and point, and does the sight line pass within r = 1 of it?
  vec3 o = uCamPos, d = p - o;
  float L = length(d); d /= L;
  float tc = -dot(o, d);
  if (tc <= 0.0 || tc >= L) return 1.0;
  return length(cross(o, d)) < 1.0 ? 0.0 : 1.0;
}
void main() {
  int v = gl_VertexID;
  int end = (v == 1 || v == 2 || v == 4) ? 1 : 0;
  float side = (v == 0 || v == 1 || v == 3) ? -1.0 : 1.0;
  vec3 c0 = toCam(aP0.xyz), c1 = toCam(aP1.xyz);
  float aspect = uRes.x / uRes.y;
  float zn = 1e-4;
  if (c0.z < zn && c1.z < zn) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vI = 0.0; return; }
  if (c0.z < zn) c0 = mix(c0, c1, (zn - c0.z) / (c1.z - c0.z));
  if (c1.z < zn) c1 = mix(c1, c0, (zn - c1.z) / (c0.z - c1.z));
  vec2 s0 = c0.xy / (c0.z * uTanFov), s1 = c1.xy / (c1.z * uTanFov);
  vec2 dir = s1 - s0;
  if (dot(dir, dir) < 1e-14) dir = vec2(1.0, 0.0);
  vec2 nrm = normalize(vec2(-dir.y, dir.x));
  vec2 sp = end == 1 ? s1 : s0;
  sp += nrm * side * uWidth * 2.0 / uRes.y;
  sp += uJitter * 2.0 / uRes.y;
  gl_Position = vec4(sp.x / aspect, sp.y, 0.0, 1.0);
  vec3 pw = end == 1 ? aP1.xyz : aP0.xyz;
  float age = end == 1 ? aP1.w : aP0.w;
  vI = aCol.w * pow(max(1.0 - age, 0.0), uFadePow) * visible(pw);
  vD = side;
  vCol = aCol.rgb;
}
