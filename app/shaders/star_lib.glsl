// star_lib.glsl — a reusable stellar photosphere that reads as self-luminous plasma, computed from math only.
// Depends only on common.glsl (hash, noise volume, blackbody LUT). Declares NO uniforms of its own.
//
//   vec3 starSurface  (vec3 n, vec3 viewDir, float T, float time, float cellScale)
//   vec3 starSurfaceFP(vec3 n, vec3 viewDir, float T, float time, float cellScale, float fp)
//   vec3 starSurfaceEx(vec3 n, vec3 viewDir, float T, float time, float cellScale, float fp, vec4 style)
//   vec3 starSurfaceN (vec3 n, vec3 nShade, vec3 viewDir, float T, float time, float cellScale, float fp, vec4 style)
//   float starLimbGlow(float b, float R, float h)        soft off-limb continuation of the disk (0..1)
//   vec3 starRay(...)                                    a whole star along one ray (disk + soft limb + glow)
//
//   n          unit surface direction in the star's body frame (the texture lives on it; apply spin yourself)
//   nShade     direction used for limb darkening (normally = n)
//   viewDir    unit vector from the surface point toward the eye (mu = dot(n, viewDir))
//   T          effective temperature in K (blue supergiant 25000, Sun 5800, red supergiant 3500)
//   time       seconds; drives the convection (multiply it to boil faster; keep the factor constant within a shot)
//   cellScale  convection cells per radian: hot-star close-up ~150-250, sun-like 120..200, red supergiant ~2
//   fp         footprint of one pixel on the surface in radians of arc (~ dist * pixelAngle() / (R * max(mu, 0.06)));
//              cells smaller than a pixel fade to their mean instead of aliasing. starSurface() assumes fp = 0.
//   style      x convection contrast (1 = default), y red-supergiant-ness 0..1 (a few giant soft plumes, stronger
//              molecular limb darkening), z activity (bright faculae near the limb), w seed (any number)
//
// The look: no cell walls, no dark outlines. Convection is a field of soft Gaussian upflow blobs (moving feature
// points) sheared by a slowly drifting flow field, with flowing fine structure on top: at normal exposures the disk
// rolls off to near-white and the structure shows as subtle, flowing brightness variations. Colour comes from the
// blackbody LUT at the Eddington–Barbier temperature seen at each mu (T(mu) = T (3/4 (mu + 2/3))^(1/4)): the limb is
// darker AND redder. Use starLimbGlow() just outside the disk so the edge dissolves instead of cutting.
// Radiance: disk centre ~ 1.2 * bbLum(T) (so 6500 K -> ~1.2). Scale it yourself.

// Soft upflow blobs around moving feature points (one per cell). p in cell units.
// sharp: Gaussian sharpness (3 = very soft, 6 = distinct blobs); lifeAmt: per-blob brightness pulsing.
float starBlobs(vec3 p, float t, int seed, float sharp, float lifeAmt) {
  p += 2048.0;                       // keep cell indices positive
  vec3 ip = floor(p), f = p - ip;
  ivec3 ic = ivec3(ip);
  float acc = 0.0;
  for (int k = 0; k < 27; k++) {
    ivec3 o = ivec3(k % 3 - 1, (k / 3) % 3 - 1, k / 9 - 1);
    vec4 h = hash44i(ivec4(ic + o, seed));
    vec3 fpt = 0.5 + 0.30 * (2.0 * h.xyz - 1.0) + 0.16 * sin(t * (0.35 + 0.5 * h.w) + TAU * h.yzx);
    vec3 r = vec3(o) + fpt - f;
    float life = 1.0 + 0.3 * lifeAmt * sin(t * (0.3 + 0.35 * h.w) + TAU * fract(h.w * 7.31));
    acc += exp(-dot(r, r) * sharp) * (0.55 + 0.45 * h.w) * life;
  }
  return acc;                        // ~0.25 between blobs .. ~1.1 on a blob
}

float starTmu(float T, float mu) { return T * sqrt(sqrt(0.75 * (max(mu, 0.0) + 0.6667))); }

// texture on direction n, limb darkening from ns
vec3 starSurfaceN(vec3 n, vec3 ns, vec3 V, float T, float time, float F, float fp, vec4 style) {
  float contrast = style.x, rsg = clamp(style.y, 0.0, 1.0), act = style.z;
  int seed = int(mod(abs(style.w), 1000.0)) + 11;
  float so = style.w * 0.137;
  float mu = clamp(dot(ns, V), 0.0, 1.0);
  float pixC = fp * F;                                       // pixel footprint in cell units

  // ---- flow: a slowly drifting warp field shears and stirs the cells (the visible pattern deforms in place) ----
  vec3 wq = n * mix(1.3, 0.8, rsg) + so + vec3(0.011, -0.009, 0.013) * time * 0.12;
  vec3 warp = nzl(wq, 0.0).rbg - vec3(0.5, 0.5, 0.55);
  float lodW = max(0.0, log2(pixC * 128.0 / 16.0 + 1e-6));
  vec3 fq = n * F / 16.0 + so * 0.53 + vec3(-0.007, 0.012, 0.009) * time * 0.12;
  vec3 flow = nzl(fq, lodW).gbr - vec3(0.55, 0.5, 0.5);
  vec3 q = n * F + warp * mix(1.2, 2.4, rsg) + flow * mix(2.2, 0.8, rsg);

  // ---- convection: soft blobs (fade to the mean once a cell is smaller than ~a pixel) ----
  float fade = smoothstep(0.25, 0.9, pixC);
  float g = 0.62;
  if (fade < 1.0) {
    float bl = starBlobs(q, time, seed, mix(4.5, 3.2, rsg), mix(1.0, 0.25, rsg));
    g = mix(bl, 0.62, fade);
  }
  // red supergiants: a few bright plume cores in a darker, cooler surface (smooth remap, no edges)
  g = mix(g, 0.32 + 0.75 * smoothstep(0.3, 1.05, g), rsg);
  // flowing fine structure (pure fbm, sheared by the same flow)
  float lodF = max(0.0, log2(pixC * 3.0 * 128.0 / 4.0 + 1e-6));
  float fine = nzl(q * 0.75 + so + 0.9, lodF).r - 0.5;
  // large-scale mottling
  float mott = nzl(n * mix(2.0, 0.9, rsg) + so + 0.27 + vec3(0.0, 0.0, time * 0.0015), 0.0).r - 0.5;
  // faculae: bright patches that only show near the limb
  float region = smoothstep(0.5, 0.7, nzl(n * 0.8 + so + 0.71, 0.0).b);
  float fac = act * region * (1.0 - mu) * (1.0 - mu);

  // ---- temperature + intensity field ----
  float var = (g - 0.62) + 0.35 * fine * (1.0 - fade * 0.7) + 0.8 * mott;
  float dT = contrast * mix(0.035, 0.16, rsg) * var;
  float Tl = starTmu(T, mu) * (1.0 + dT + 0.05 * fac);
  vec3 c = blackbody(Tl);
  // hot stars barely change brightness with a few % of temperature: add a direct intensity term (subtle)
  float cI = contrast * mix(0.45, 0.2, rsg) * smoothstep(9000.0, 20000.0, T);
  c *= max(1.0 + cI * var + 0.5 * fac, 0.05);
  // extra limb darkening (molecular opacity for red supergiants)
  float x = 1.0 - mu;
  float ld = 1.0 - mix(0.55, 0.5, rsg) * x - mix(0.15, 0.2, rsg) * x * x;
  return c * max(ld, 0.0) * 1.2;
}

vec3 starSurfaceEx(vec3 n, vec3 V, float T, float time, float F, float fp, vec4 style) {
  return starSurfaceN(n, n, V, T, time, F, fp, style);
}
vec3 starSurfaceFP(vec3 n, vec3 viewDir, float T, float time, float cellScale, float fp) {
  return starSurfaceN(n, n, viewDir, T, time, cellScale, fp, vec4(1.0, 0.0, 0.6, 0.0));
}
vec3 starSurface(vec3 n, vec3 viewDir, float T, float time, float cellScale) {
  return starSurfaceN(n, n, viewDir, T, time, cellScale, 0.0, vec4(1.0, 0.0, 0.6, 0.0));
}

// Soft limb: relative brightness of the glowing gas just outside the photosphere, continuing the disk's edge
// brightness outward (b = ray impact parameter, R = photosphere radius, h = scale height as a fraction of R).
// Two components: a bright inner rim (h) and a faint extended skirt (4 h). Multiply by the disk's edge radiance.
float starLimbGlow(float b, float R, float h) {
  float z = max(b - R, 0.0) / (h * R);
  return 0.85 * exp(-z) + 0.15 * exp(-z * 0.25);
}

// ---- helpers for a star in other scenes ----------------------------------------------------------
// ray/sphere: (tNear, tFar), or (-1,-1) when missed. rd normalised.
vec2 starSphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Analytic optically-thin glow of a halo with emissivity (R/r)^4 around a star of radius R at the origin,
// integrated along the ray from t0 to t1 (t1 = surface hit or 1e9). Returns the column in units of R.
float starHalo4(vec3 ro, vec3 rd, float R, float t0, float t1) {
  float tc = -dot(ro, rd);
  vec3 pc = ro + rd * tc;
  float b = max(length(pc) / R, 1e-3);
  float s0 = (t0 - tc) / R, s1 = (min(t1, 1e8) - tc) / R;
  // int ds / (b^2 + s^2)^2 = s / (2 b^2 (b^2 + s^2)) + atan(s / b) / (2 b^3)
  float b2 = b * b;
  float F1 = s1 / (2.0 * b2 * (b2 + s1 * s1)) + atan(s1 / b) / (2.0 * b2 * b);
  float F0 = s0 / (2.0 * b2 * (b2 + s0 * s0)) + atan(s0 / b) / (2.0 * b2 * b);
  return max(F1 - F0, 0.0);
}

// A whole star seen along one ray: photosphere (when hit), soft glowing limb, and a thin (R/r)^4 glow around it.
//   ro, rd   ray origin / unit direction (world);  c, R: star centre and radius;  T: effective temperature (K)
//   time     seconds (convection);  cells: cells per radian (sun-like ~150);  spin: rotation about +y (rad)
//   pixAng   angular size of one pixel (pixelAngle()), for filtering the convection
//   tHit     out: distance along the ray to the photosphere, -1 when the ray misses the disk
// Radiance scale: disk centre ~ 1.2 * bbLum(T) (6500 K -> 1.2); multiply by your own brightness.
vec3 starRay(vec3 ro, vec3 rd, vec3 c, float R, float T, float time, float cells, float spin, float pixAng, out float tHit) {
  vec3 o = (ro - c) / R;
  vec2 ts = starSphere(o, rd, 1.0);
  vec3 col = vec3(0.0);
  float tEnd = 1e9;
  tHit = -1.0;
  vec3 edge = blackbody(starTmu(T, 0.0)) * 1.2 * 0.3;          // disk radiance at the very edge (limb-darkened)
  if (ts.x > 0.0) {
    tHit = ts.x * R;
    tEnd = ts.x;
    vec3 n = normalize(o + rd * ts.x);
    float cs = cos(spin), sn = sin(spin);
    vec3 nb = vec3(cs * n.x - sn * n.z, n.y, sn * n.x + cs * n.z);
    vec3 vb = vec3(-cs * rd.x + sn * rd.z, -rd.y, -sn * rd.x - cs * rd.z);
    float mu = max(dot(nb, vb), 0.0);
    col = starSurfaceN(nb, nb, vb, T, time, cells, ts.x * pixAng / max(mu, 0.06), vec4(1.0, 0.0, 0.6, 0.0));
    col = mix(edge, col, smoothstep(0.0, 0.2, mu));            // soften the very edge into the limb glow
  } else {
    float tc = -dot(o, rd);
    if (tc > 0.0) col = edge * starLimbGlow(length(o + rd * tc), 1.0, 0.012);
  }
  col += blackbody(T) * 0.06 * starHalo4(o, rd, 1.0, 0.0, tEnd);
  return col;
}
