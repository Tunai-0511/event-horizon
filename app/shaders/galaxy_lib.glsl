// galaxy_lib.glsl — geometric / analytic helpers for galaxy.frag

float sqr(float x) { return x * x; }

// erf, Winitzki approximation (|err| < 1.3e-4), odd, saturates cleanly
float erfa(float x) {
  float x2 = x * x;
  float e = sqrt(max(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)), 0.0));
  return x < 0.0 ? -e : e;
}

float sech2(float x) { float e = exp(-2.0 * abs(x)); return 4.0 * e / ((1.0 + e) * (1.0 + e)); }

// mip level of a noise lookup at frequency `freq` (noise periods per GU) for a ray footprint fpw (GU)
#ifndef LODBIAS
#define LODBIAS 0.0
#endif
float lodOf(float fpw, float freq) { return max(log2(fpw * freq * 128.0) + float(LODBIAS), 0.0); }

// footprint-filtered Gaussian bump: widens to the footprint f but keeps its integral
float gbump(float x, float s, float f) { float s2 = s * s + f * f; return s * inversesqrt(s2) * exp(-0.5 * x * x / s2); }

// Line integral of an axisymmetric flattened Gaussian  exp(-((x²+z²)/s² + y²/(s q)²))  along o + t d:
//   ∫[t0,t1] = pre * (erf(alpha (t1 - tc)) - erf(alpha (t0 - tc)))      returns (pre, alpha, tc)
vec3 gaussRay(vec3 o, vec3 d, float s, float q) {
  vec3 iS = vec3(1.0 / s, 1.0 / (s * q), 1.0 / s);
  vec3 o2 = o * iS, d2 = d * iS;
  float a2 = dot(d2, d2);
  float b = dot(o2, d2);
  float qmin = max(dot(o2, o2) - b * b / a2, 0.0);
  float alpha = sqrt(a2);
  return vec3(exp(-qmin) * 0.886226925 / alpha, alpha, -b / a2);
}
float gaussSeg(vec3 g, float t0, float t1) { return g.x * (erfa(g.y * (t1 - g.z)) - erfa(g.y * (t0 - g.z))); }

// ray vs. slab |y| < H  ∩  cylinder x²+z² < R²  ->  [t0, t1]  (empty when t1 <= t0)
vec2 slabCyl(vec3 o, vec3 d, float H, float R) {
  float t0 = 0.0, t1 = 1e9;
  if (abs(d.y) > 1e-8) {
    float ta = (-H - o.y) / d.y, tb = (H - o.y) / d.y;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if (abs(o.y) > H) return vec2(1.0, 0.0);
  float a = dot(d.xz, d.xz), b = dot(o.xz, d.xz), c = dot(o.xz, o.xz) - R * R;
  if (a > 1e-12) {
    float disc = b * b - a * c;
    if (disc < 0.0) return vec2(1.0, 0.0);
    float sq = sqrt(disc);
    t0 = max(t0, (-b - sq) / a); t1 = min(t1, (-b + sq) / a);
  } else if (c > 0.0) return vec2(1.0, 0.0);
  return vec2(t0, t1);
}

// ray vs. axis-aligned ellipsoid (centre c, semi-axes ax) -> [t0, t1]
vec2 ellRay(vec3 o, vec3 d, vec3 c, vec3 ax) {
  vec3 oo = (o - c) / ax, dd = d / ax;
  float a = dot(dd, dd), b = dot(oo, dd), cc = dot(oo, oo) - 1.0;
  float disc = b * b - a * cc;
  if (disc < 0.0) return vec2(1.0, 0.0);
  float sq = sqrt(disc);
  return vec2(max((-b - sq) / a, 0.0), (-b + sq) / a);
}

// ∫0^dt exp(-k s) ds per channel, stable for tiny k
vec3 expInt(vec3 k, float dt) {
  vec3 x = k * dt;
  return mix(dt * (1.0 - 0.5 * x), (1.0 - exp(-x)) / max(k, vec3(1e-12)), step(vec3(1e-3), x));
}

// ∫ du / (b² + u²) * rc² / (rc² + b² + u²)  over [u0, u1]: light of a central point source scattered by a medium of
// density 1 / (1 + s²/rc²) (s = distance from the source), along a line with impact parameter b
float scatLine(float b, float rc, float u0, float u1) {
  float c = sqrt(b * b + rc * rc);
  return (atan(u1 / b) - atan(u0 / b)) / b - (atan(u1 / c) - atan(u0 / c)) / c;
}
