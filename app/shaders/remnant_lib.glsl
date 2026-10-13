// remnant_lib.glsl - a supernova remnant's emission-line filament network, computed from math only.
// Depends only on common.glsl. Uniforms are prefixed uRem (defaults: REMNANT in app/src/scenes/nova.js).
//
//   vec3 remnantSky(vec3 dir, float fp)
//       The remnant seen from its centre, as a direction-only radiance function - e.g. the gravitationally lensed
//       background around the black hole that lives at the centre. dir = unit direction (world), fp = footprint of the
//       pixel on the sky in radians (pass the lensed footprint): filaments thinner than fp widen to it and dim
//       (flux-conserving), so the pattern stays alias-free when magnified or squeezed. Closed form, 9 noise fetches.
//   void remField(vec3 q, float lod, out vec4 n, out vec4 a)
//       The same field as a volume (nova.frag renders it from anywhere): q = position / shell radius (blast wave at
//       |q| ~ 1). n = two pairs of fields whose common zero sets are the filaments, a = emissivities.
//   vec3 remSegment(vec4 n0, vec4 n1, vec4 a0, vec4 a1, float L, float pfq)
//       Exact integral of the filaments' emission over a ray segment of length L (q units) between two samples
//       (fields linear inside the segment); pfq = pixel footprint in q units. remColor() maps the result to RGB.
//
// Physics. Optical remnants (Simeis 147, the Veil, Cas A) are nets of thin filaments of shock-excited gas lying in
// rippled shells; most of the volume is dark. A filament here is a curve on a wrinkled shell: the common zero set of
// (distance to the shell) and a smooth "cutting" field, i.e. the cutting field's contour lines drawn on the shell.
// Its emissivity is a 2D Gaussian across the curve, exp(-(n1^2 + n2^2) / w^2): along a ray that is a Gaussian in the
// ray parameter, so each segment integrates in closed form (erf) and hair-thin filaments stay smooth with coarse steps.
// The width never drops below the pixel footprint and the emissivity is normalised by 1/(pi w^2), so the flux per
// unit length of filament does not depend on the width. Neighbouring contour levels give combed bundles of strands,
// broken into knots and gaps by a slowly varying brightness; a faint diffuse glow hugs the shells.
// Lines: H-alpha 656 nm (+ a little H-beta) red-pink and [S II] 672 nm dark red on the inner shells (the S II / H-alpha
// ratio differs from strand to strand); [O III] 501 nm teal on the outermost shell (the fastest shocks), softer.
#include "common.glsl"

uniform float uRemAmt;      // overall line brightness
uniform mat3 uRemRot;       // orientation of the pattern (world -> remnant frame)
uniform float uRemSeed;     // pattern offset (any number)
uniform vec3 uRemLines;     // weights of H-alpha, [O III], [S II]
uniform float uRemPatch;    // 0..1: how much of the shell is dark (0 = complete shell, 1 = a few bright arcs)
uniform float uRemWidth;    // intrinsic filament half-width in field units (thinner = more delicate), ~0.007

const vec3 REM_HA = vec3(1.0, 0.16, 0.22);
const vec3 REM_O3 = vec3(0.16, 0.80, 0.74);
const vec3 REM_S2 = vec3(0.75, 0.07, 0.07);

float remErf(float x) {
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.47047 * a);
  float y = 1.0 - t * (0.3480242 + t * (-0.0958798 + t * 0.7478556)) * exp(-a * a);
  return x < 0.0 ? -y : y;
}

// integral over a segment of length L of exp(-|n|^2 / w^2) / (pi w^2), n in R^2 linear from n0 to n1
float remTube(vec2 n0, vec2 n1, float w, float L) {
  vec2 b = n1 - n0;
  float iw2 = 1.0 / (w * w);
  float B = dot(b, b), C = dot(n0, b), A = dot(n0, n0);
  if (B * iw2 < 1e-3) { vec2 m = n0 + 0.5 * b; return L * exp(-dot(m, m) * iw2) * iw2 * 0.3183; }
  float d2 = max(A - C * C / B, 0.0) * iw2;   // closest approach to the filament, squared, in widths
  if (d2 > 16.0) return 0.0;
  float um = -C / B;
  float sB = sqrt(B * iw2);
  return L * exp(-d2) * 0.886227 / sB * (remErf(sB * (1.0 - um)) + remErf(sB * um)) * iw2 * 0.3183;
}

// integral over a segment of length L of exp(-(n/w)^2) / (sqrt(pi) w), n linear from n0 to n1 (thin sheet)
float remSheet(float n0, float n1, float w, float L) {
  float a = n0 / w, b = n1 / w, d = b - a;
  if (abs(d) < 0.03) { float m = 0.5 * (a + b); return L * exp(-m * m) * 0.5642 / w; }
  if (min(abs(a), abs(b)) > 4.0 && a * b > 0.0) return 0.0;
  return L * 0.5 * (remErf(b) - remErf(a)) / (d * w);
}

float remSq(float x) { return x * x; }
// radial profile helper: 0 outside [a, d], 1 inside [b, c]
float remBand(float x, float a, float b, float c, float d) { return smoothstep(a, b, x) * (1.0 - smoothstep(c, d, x)); }

// shell geometry for a direction in the remnant frame: x = radius of the H-alpha/[S II] shell, y = radius of the
// [O III] shell, z / w = how much of each is lit in this direction (large patches: most of the sky stays dark)
vec4 remShells(vec3 dirR, float lod) {
  vec3 so = vec3(uRemSeed * 0.173, uRemSeed * 0.311, uRemSeed * 0.097);
  vec4 W = nzl(dirR * 0.85 + so + vec3(5.3, 1.7, 8.9), lod + log2(0.85));
  // H-alpha: a second, deeper sheet takes over where the first is dark (patch-complementary)
  float pc = mix(0.42, 0.58, uRemPatch);
  float patchA = smoothstep(pc - 0.08, pc + 0.12, W.g);
  float patchB = smoothstep(pc - 0.04, pc + 0.12, 1.0 - W.g + (W.b - 0.5) * 0.6) * 0.8;
  float patchO = smoothstep(pc - 0.08, pc + 0.08, 1.04 - W.g * 0.55 - W.r * 0.45);
  float rA = 0.89 + 0.13 * (W.r - 0.5);
  float rB = 0.80 + 0.12 * (W.b - 0.5);
  float rO = 0.975 + 0.09 * (W.b - 0.5);
  // the H-alpha shell radius switches smoothly between the two sheets with the patches
  float wB = patchB / max(patchA + patchB, 1e-3);
  return vec4(mix(rA, rB, wB), rO, max(patchA, patchB), patchO);
}

void remField(vec3 q, float lod, out vec4 n, out vec4 a) {
  vec3 Q = uRemRot * q;
  float r = length(Q);
  vec3 dir = Q / max(r, 1e-4);
  vec3 so = vec3(uRemSeed * 0.173, uRemSeed * 0.311, uRemSeed * 0.097);
  vec4 sh = remShells(dir, lod);
  // C: smooth large-scale cutting fields (their contour lines on the shells are the filaments: long gentle arcs,
  // neighbouring levels = combed bundles); D: fine wiggles and knots; V: long-wavelength brightness along the strands
  vec4 C = nzl(Q * 0.42 + so * 1.7 + vec3(2.1, 7.7, 0.3), lod + log2(0.42) + 2.4);
  vec4 D = nzl(Q * 2.9 + so + vec3(0.6, 3.1, 9.4), lod + log2(2.9) + 0.6);
  vec4 V = nzl(Q * 0.6 + so + vec3(9.1, 4.4, 2.6), lod + log2(0.6) + 0.5);
  n = vec4((r - sh.x) * 9.0, (C.r - 0.5) * 15.0 + (D.r - 0.5) * 0.5, (r - sh.y) * 9.0, (C.b - 0.5) * 19.0 + (D.b - 0.5) * 0.45);
  float shH = remBand(r, sh.x - 0.07, sh.x - 0.03, sh.x + 0.03, sh.x + 0.07) * sh.z;
  float shO = remBand(r, sh.y - 0.06, sh.y - 0.025, sh.y + 0.025, sh.y + 0.06) * sh.w;
  // per-strand brightness: long bright stretches broken into knots and gaps, the rest faint
  vec3 v3 = smoothstep(vec3(0.36), vec3(0.66), V.gbr);
  float knots = 0.25 + 1.5 * remSq(smoothstep(0.3, 0.75, D.g));
  a = vec4(shH * (0.06 + 1.7 * v3 * v3) * knots, shO * (0.05 + 1.4 * remSq(smoothstep(0.36, 0.66, V.a * 0.5 + V.g * 0.5))) * (0.4 + 1.2 * D.a));
}

vec3 remSegment(vec4 n0, vec4 n1, vec4 a0, vec4 a1, float L, float pfq) {
  // |grad n| ~ 9 per q unit: never thinner than the pixel footprint
  float w = max(uRemWidth, pfq * 9.0);
  vec4 am = 0.5 * (a0 + a1);
  float h = 0.0, o = 0.0;
  if (am.x + am.y + am.z > 1e-4) {
    // contour levels of the cutting field on the H-alpha shell: combed bundles of arcs, each with a faint wide halo
    h = am.x * (remTube(n0.xy, n1.xy, w, L) + 0.15 * remTube(n0.xy, n1.xy, w * 5.0 + 0.04, L))
      + am.y * remTube(n0.xy - vec2(0.0, 0.13), n1.xy - vec2(0.0, 0.13), w, L)
      + am.z * (remTube(n0.xy + vec2(0.0, 0.22), n1.xy + vec2(0.0, 0.22), w, L) + 0.15 * remTube(n0.xy + vec2(0.0, 0.3), n1.xy + vec2(0.0, 0.3), w * 4.0 + 0.04, L))
      + 0.5 * am.x * remTube(n0.xy + vec2(0.0, 0.45), n1.xy + vec2(0.0, 0.45), w, L)
      + 0.4 * am.y * remTube(n0.xy - vec2(0.0, 0.62), n1.xy - vec2(0.0, 0.62), w, L);
  }
  if (am.w > 1e-4) {
    // [O III]: a faint veil on the outer shell (limb-brightened from outside) + a few teal strands in it
    o = am.w * (0.45 * remSheet(n0.z, n1.z, max(0.05, pfq * 9.0), L) + remTube(n0.zw, n1.zw, w * 1.4, L)
               + 0.5 * remTube(n0.zw - vec2(0.0, 0.2), n1.zw - vec2(0.0, 0.2), w * 1.4, L)
               + 0.3 * remTube(n0.zw, n1.zw, w * 6.0 + 0.05, L));
  }
  // faint diffuse glow of the shell around the filaments (depth and softness without greying the blacks)
  h += 0.7 * L * (am.x + am.y + am.z) * remSq(1.0 - min(abs(n0.x + n1.x) * 0.5 / 0.5, 1.0));
  o += 0.3 * L * am.w * remSq(1.0 - min(abs(n0.z + n1.z) * 0.5 / 0.45, 1.0));
  // [S II]/H-alpha ratio: continuous in the cutting field, so each filament (a contour of it) keeps its own ratio
  float s2 = 0.5 + 0.5 * sin(n0.y * 2.5 + 0.37);
  return vec3(h * (1.0 - 0.55 * s2), o, h * s2 * 0.8);
}

vec3 remColor(vec3 s) {
  return uRemAmt * 0.3 * (s.x * uRemLines.x * REM_HA + s.y * uRemLines.y * REM_O3 + s.z * uRemLines.z * REM_S2);
}

// radial line integral of one filament tube through a shell: along a radial ray the shell distance is exactly
// n1 = 9 (r - r_shell), so the integral of exp(-(n1^2 + n2^2) / w^2) / (pi w^2) is exp(-n2^2 / w^2) / (9 sqrt(pi) w)
float remCross(float n2, float w) { return exp(-n2 * n2 / (w * w)) * 0.0626896 / w; }

// The remnant seen from its centre. A radial ray crosses each shell exactly once and the shell-distance fields are
// linear along it, so the line integral through the filament network has a closed form: one field evaluation at
// each shell crossing (9 noise fetches in all) gives the same image as marching the volume (remnantSkyMarched).
vec3 remnantSky(vec3 dir, float fp) {
  float lod = clamp(log2(max(fp * 0.85 * 128.0, 1e-4)), 0.0, 6.0);
  vec4 sh = remShells(uRemRot * dir, lod);
  vec4 nH, aH, nO, aO;
  remField(dir * sh.x, lod, nH, aH);
  remField(dir * sh.y, lod, nO, aO);
  float w = max(uRemWidth, fp * sh.x * 9.0);
  float h = aH.x * (remCross(nH.y, w) + 0.15 * remCross(nH.y, w * 5.0 + 0.04))
          + aH.y * remCross(nH.y - 0.13, w)
          + aH.z * (remCross(nH.y + 0.22, w) + 0.15 * remCross(nH.y + 0.3, w * 4.0 + 0.04))
          + 0.5 * aH.x * remCross(nH.y + 0.45, w)
          + 0.4 * aH.y * remCross(nH.y - 0.62, w)
          + 0.024 * (aH.x + aH.y + aH.z);                         // the shell's diffuse glow
  float wo = max(uRemWidth, fp * sh.y * 9.0);
  float o = aO.w * (0.05 + 0.0075 + remCross(nO.w, wo * 1.4) + 0.5 * remCross(nO.w - 0.2, wo * 1.4) + 0.3 * remCross(nO.w, wo * 6.0 + 0.05));
  float s2 = 0.5 + 0.5 * sin(nH.y * 2.5 + 0.37);
  return remColor(vec3(h * (1.0 - 0.55 * s2), o, h * s2 * 0.8));
}

// reference: the same field marched radially (28 analytic segments) - kept for A/B checks (nova.frag REMSKY_MARCHED)
vec3 remnantSkyMarched(vec3 dir, float fp) {
  const int N = 28;
  const float r0 = 0.62, r1 = 1.05;
  float dr = (r1 - r0) / float(N);
  vec4 n0, a0; vec3 acc = vec3(0.0);
  float r = r0;
  float lod = clamp(log2(max(fp * r * 128.0, 1e-4)), 0.0, 6.0);
  remField(dir * r, lod, n0, a0);
  for (int i = 0; i < N; i++) {
    float rn = r + dr;
    float pfq = fp * rn;
    lod = clamp(log2(max(pfq * 128.0, 1e-4)), 0.0, 6.0);
    vec4 n1, a1;
    remField(dir * rn, lod, n1, a1);
    acc += remSegment(n0, n1, a0, a1, dr, pfq);
    n0 = n1; a0 = a1; r = rn;
  }
  return remColor(acc);
}
