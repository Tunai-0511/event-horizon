// Builds one Z layer of the tileable 128^3 noise volume (RGBA8):
//   R  gradient (Perlin) fBm, 5 octaves, base period 4
//   G  inverted Worley fBm (billows / cells), base period 4
//   B  gradient fBm, decorrelated seed, base period 8
//   A  Worley F2-F1 at period 8 (cell walls -> filaments, cracks)
#include "hash.glsl"
uniform float uZ;
in vec2 vUv;
out vec4 o;

ivec3 wrap(ivec3 c, int P) { return ((c % P) + P) % P; }

vec3 grad(ivec3 c, int P, int seed) {
  vec3 h = hash33i(wrap(c, P) + ivec3(seed * 131, seed * 71, seed * 37));
  return normalize(h * 2.0 - 1.0 + 1e-4);
}

float gnoise(vec3 p, int P, int seed) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec3 c = ivec3(i);
  float n000 = dot(grad(c + ivec3(0,0,0), P, seed), f - vec3(0,0,0));
  float n100 = dot(grad(c + ivec3(1,0,0), P, seed), f - vec3(1,0,0));
  float n010 = dot(grad(c + ivec3(0,1,0), P, seed), f - vec3(0,1,0));
  float n110 = dot(grad(c + ivec3(1,1,0), P, seed), f - vec3(1,1,0));
  float n001 = dot(grad(c + ivec3(0,0,1), P, seed), f - vec3(0,0,1));
  float n101 = dot(grad(c + ivec3(1,0,1), P, seed), f - vec3(1,0,1));
  float n011 = dot(grad(c + ivec3(0,1,1), P, seed), f - vec3(0,1,1));
  float n111 = dot(grad(c + ivec3(1,1,1), P, seed), f - vec3(1,1,1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbmP(vec3 uvw, int f0, int oct, int seed) {
  float a = 0.5, s = 0.0, n = 0.0;
  int f = f0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * gnoise(uvw * float(f), f, seed + i);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

vec2 worley(vec3 p, int P, int seed) {
  vec3 i = floor(p), f = fract(p);
  float d1 = 1e9, d2 = 1e9;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    ivec3 c = ivec3(i) + ivec3(x, y, z);
    vec3 off = hash33i(wrap(c, P) + ivec3(seed * 911, seed * 313, seed * 577));
    vec3 r = vec3(x, y, z) + off - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}

void main() {
  vec3 uvw = vec3(gl_FragCoord.xy / 128.0, uZ);
  float r = fbmP(uvw, 4, 5, 1);
  float w = 0.625 * worley(uvw * 4.0, 4, 3).x + 0.25 * worley(uvw * 8.0, 8, 4).x + 0.125 * worley(uvw * 16.0, 16, 5).x;
  float b = fbmP(uvw, 8, 4, 9);
  vec2 w8 = worley(uvw * 8.0, 8, 7);
  o = vec4(clamp(0.5 + 0.85 * r, 0.0, 1.0),
           clamp(1.0 - w, 0.0, 1.0),
           clamp(0.5 + 0.85 * b, 0.0, 1.0),
           clamp((w8.y - w8.x) * 1.6, 0.0, 1.0));
}
