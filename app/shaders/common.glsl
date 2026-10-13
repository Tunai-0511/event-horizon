// Shared scene-shader prelude. Every scene shader starts with #include "common.glsl".
#include "hash.glsl"

#define PI 3.14159265358979
#define TAU 6.28318530717959

in vec2 vUv;
out vec4 fragOut;

// ---- engine-provided uniforms ----
uniform vec2 uRes;          // render target size in pixels
uniform vec2 uJitter;       // sub-pixel jitter for this sub-frame (pixels)
uniform float uTime;        // film time (s) of this sub-frame
uniform float uLocal;       // seconds since the shot started
uniform float uSeed;        // sub-frame index (for stochastic sampling)
uniform float uWeight;      // 1 / sub-frames (output is pre-weighted)
uniform vec3 uCamPos;
uniform mat3 uCamRot;       // columns: right, up, forward
uniform float uTanFov;      // tan(vertical fov / 2)
uniform sampler3D uNoise;   // tileable noise volume (R perlin fbm, G worley fbm, B perlin fbm 2, A worley edges)
uniform sampler2D uBB;      // blackbody LUT

const float BB_TMIN = 400.0, BB_TMAX = 200000.0;

// blackbody: linear sRGB with luminance 1 at the given temperature
vec3 bbColor(float T) {
  float u = log(clamp(T, BB_TMIN, BB_TMAX) / BB_TMIN) / log(BB_TMAX / BB_TMIN);
  return texture(uBB, vec2(u, 0.5)).rgb;
}
// relative visible luminance of a blackbody (1 at 6500 K)
float bbLum(float T) {
  float u = log(clamp(T, BB_TMIN, BB_TMAX) / BB_TMIN) / log(BB_TMAX / BB_TMIN);
  return pow(10.0, texture(uBB, vec2(u, 0.5)).a);
}
vec3 blackbody(float T) { return bbColor(T) * bbLum(T); }

// ---- camera ----
vec2 screenUV() { return (gl_FragCoord.xy + uJitter) / uRes; }        // [0,1]^2
vec2 ndc() { vec2 p = (gl_FragCoord.xy + uJitter) * 2.0 - uRes; return p / uRes.y; } // y in [-1,1]
vec3 camRay() {
  vec2 p = ndc();
  return normalize(uCamRot * vec3(p * uTanFov, 1.0));
}
// angular size of one pixel (radians)
float pixelAngle() { return 2.0 * uTanFov / uRes.y; }

// ---- noise helpers (volume texture, period 1.0 in texture space) ----
vec4 nz(vec3 p) { return texture(uNoise, p); }
vec4 nzl(vec3 p, float lod) { return textureLod(uNoise, p, lod); }
// signed fbm from the R channel, several scales
float fbm3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * (nz(p).r * 2.0 - 1.0);
    n += a; a *= 0.5; p = p * 2.03 + vec3(0.131, 0.517, 0.271);
  }
  return s / n;
}
float fbm3l(vec3 p, int oct, float lod) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * (nzl(p, lod).r * 2.0 - 1.0);
    n += a; a *= 0.5; p = p * 2.03 + vec3(0.131, 0.517, 0.271); lod += 1.0;
  }
  return s / n;
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }

void emit(vec3 radiance) {
  // guard: NaN/Inf would poison the accumulation buffer for the whole frame
  if (any(isnan(radiance)) || any(isinf(radiance))) radiance = vec3(0.0);
  fragOut = vec4(max(radiance, 0.0) * uWeight, uWeight);
}
