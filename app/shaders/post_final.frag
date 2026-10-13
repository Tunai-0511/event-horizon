// HDR composite -> display: bloom, exposure, ACES filmic, grade, vignette, grain, dither, sRGB.
#include "hash.glsl"
uniform sampler2D uHdr;
uniform sampler2D uBloom;
uniform sampler2D uStreak;
uniform vec2 uRes;
uniform float uFrame;
uniform float uExposure;   // EV
uniform float uBloomAmt;
uniform float uStreakAmt;
uniform vec3 uStreakTint;
uniform float uSat;
uniform float uContrast;
uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uTint;        // white balance multiplier
uniform float uVignette;
uniform float uGrain;
uniform float uFade;       // final multiplier (fade to black)
uniform float uCA;         // chromatic aberration strength (pixels at the corners)
uniform float uTonemap;    // 0 = ACES filmic, 1 = hue-preserving filmic (keeps glowing oranges saturated), blendable
in vec2 vUv;
out vec4 o;

const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 rrt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) { return clamp(ACESOut * rrt(ACESIn * c), 0.0, 1.0); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  vec3 hdr;
  if (uCA > 0.0) {
    vec2 off = d * dot(d, d) * uCA * 4.0 / uRes;
    hdr = vec3(texture(uHdr, uv - off).r, texture(uHdr, uv).g, texture(uHdr, uv + off).b);
  } else hdr = texture(uHdr, uv).rgb;
  vec3 c = hdr + texture(uBloom, uv).rgb * uBloomAmt + texture(uStreak, uv).rgb * uStreakAmt * uStreakTint;
  c *= exp2(uExposure) * uTint;
  // vignette in scene-linear space (like a lens)
  float r2 = dot(d * vec2(uRes.x / uRes.y, 1.0), d * vec2(uRes.x / uRes.y, 1.0));
  c *= mix(1.0, max(0.0, 1.0 - r2 * 0.9), uVignette);
  vec3 ca = aces(c);
  if (uTonemap > 0.0) {
    // tone-map luminance only, keep chromaticity, roll the brightest highlights to white
    float L = max(luma(c), 1e-6);
    float Lt = luma(aces(vec3(L)));
    vec3 h = c * (Lt / L);
    float mx = max(h.r, max(h.g, h.b));
    h = mix(h, vec3(Lt), smoothstep(0.55, 1.0, Lt) * 0.65);
    if (mx > 1.0) h = mix(h / mx, vec3(1.0), clamp((mx - 1.0) * 0.5, 0.0, 1.0));
    ca = mix(ca, clamp(h, 0.0, 1.0), uTonemap);
  }
  c = ca;
  // grade (display-referred, still linear)
  float l = luma(c);
  c = max(mix(vec3(l), c, uSat), 0.0);
  c = pow(c, vec3(uContrast)) * 0.18 / pow(0.18, uContrast) ;
  c = c * uGain + uLift * (1.0 - c);
  c = clamp(c, 0.0, 1.0) * uFade;
  vec3 s = srgb(clamp(c, 0.0, 1.0));
  // film grain: mid-tone weighted, changes every frame
  vec4 h = hash44i(ivec4(gl_FragCoord.xy, int(uFrame), 77));
  float gw = 4.0 * l * (1.0 - l) + 0.15;
  s += (h.x + h.y - 1.0) * uGrain * gw;
  // triangular dither to break 8-bit banding in the dark gradients
  s += (h.z + h.w - 1.0) / 255.0;
  o = vec4(clamp(s, 0.0, 1.0), 1.0);
}
