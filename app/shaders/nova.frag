// SUPERNOVA — core bounce, shock breakout, expanding ejecta, light echoes, the remnant.
// Units: the progenitor (a red supergiant) has radius 1 and sits at the origin. Everything is light, gas and plasma:
// ray-marched emitting/absorbing volumes with soft boundaries (no surfaces), plus analytic point sources.
// The phase is chosen by the progress uniforms (staging helpers and per-bar keyframes: app/src/scenes/nova.js):
//   uBounce   0..1  core bounce: the star glows from within, turns translucent, a white-blue plasma bubble rises
//   uBreakout 0..1  shock breakout: a flash front sweeps the photosphere, the star swells into billowing lobes,
//                   bright rifts open, flames boil off
//   uExpand   > 1   ejecta: radius of the expanding debris (R*); a self-similar fireball with Rayleigh-Taylor fingers
//                   that hollows into a shell and tears into radial filaments as it grows
//   uEcho     > 0   light echoes: light-travel distance of the flash front through interstellar dust sheets
//   uDim      0..1  the light dies; uAge 0..1 the hot ejecta give way to the line-emitting filament network
// Debug defines: REMSKY_ONLY (remnantSky() + stars as seen from the centre), REMSKY_MARCHED (the marched reference of
// remnantSky), REMSKY_LENS (remnantSky behind a toy point lens, to check the footprint filtering under magnification).
#include "common.glsl"
#include "sky.glsl"
#include "remnant_lib.glsl"

uniform float uSkyAmt;
uniform float uNovaSeed;
// progenitor
uniform float uStarT;       // photosphere temperature (K)
uniform float uStarBright;  // photosphere luminance (HDR)
uniform float uConv;        // convection contrast (1 = default)
uniform float uStarHS;      // atmospheric scale height (fraction of the radius): softness of the limb
uniform float uBounce;      // 0..1
uniform float uBounceLum;   // brightness of the bounce light
uniform float uBreakout;    // 0..1
uniform vec3 uBoAxis;       // breakout: direction where the shock emerges first (the front sweeps away from it)
// ejecta
uniform float uExpand;      // ejecta outer radius (R*)
uniform float uExpandBlur;  // radius change during one sub-frame (per-pixel motion blur)
uniform float uFingers;     // Rayleigh-Taylor finger length 0..1
uniform float uEjT;         // core temperature of the ejecta (K)
uniform float uEjBright;    // ejecta brightness
uniform float uEjOpacity;   // ejecta opacity
uniform float uEjDense;     // density of the fireball body (with uEjOpacity: how opaque the debris is)
uniform float uCorePt;      // central compact remnant brightness
uniform float uDim;         // 0..1 the light dies
uniform float uHole;        // radius (absolute units) of the black occluder at the centre
uniform float uEmber;       // faint glow of the dying interior around the centre (the black point is seen against it)
uniform float uAge;         // 0..1 young ejecta -> filament network
// light echoes
uniform float uEcho;        // light-travel distance of the echo front (absolute units)
uniform float uEchoAmt;
uniform float uEchoW;       // depth of the lit band (absolute units)
uniform float uDust;        // dust density (echo strength + extinction of the background)
uniform float uDustR;       // dust geometry scale (absolute units)
uniform mat3 uDustRot;

// ---------------------------------------------------------------------------------------------------------------
vec2 sphereT(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd), c = dot(ro, ro) - R * R, h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
float hgPhase(float mu, float g) { float g2 = g * g; float d = max(1.0 + g2 - 2.0 * g * mu, 1e-4); return (1.0 - g2) / (12.566 * d * sqrt(d)); }
float sq(float x) { return x * x; }
// visible "fire" brightness of a blackbody, compressed so cool filaments stay visible next to the hot core
vec3 fire(float T) { return bbColor(T) * pow(max(bbLum(T) / bbLum(6500.0), 1e-6), 0.4); }
// visible brightness of a blackbody with an adjustable compression of its luminance (k = 1: physical)
vec3 fireK(float T, float k) { return bbColor(T) * pow(max(bbLum(T) / bbLum(6500.0), 1e-8), k); }
// unresolved source at the origin, flux in the sky's REF_PIX units; tc = distance of closest approach along the ray
float pointPSF(vec3 ro, vec3 rd, float pa, float tc) {
  if (tc <= 0.0) return 0.0;
  float ang = length(ro + rd * tc) / tc;
  float s = 0.6 * pa;
  return REF_PIX * REF_PIX * exp(-ang * ang / (2.0 * s * s)) / (6.2832 * s * s);
}

// =============================================================================================================
// PROGENITOR: a red supergiant of radius 1, rendered as glowing plasma with no hard surface. Above the photospheric
// base the density falls off exponentially over a scale height gHS (2-3 % of the radius, as in real red supergiants),
// so the limb is fuzzy, darker and redder (limb darkening emerges from the temperature gradient), and a faint clumpy
// molecular envelope glows around the star.
// Bounce: a hot plume bubble grows from the core; the envelope turns translucent and the star glows from within,
// its giant convection cells in silhouette (radial shadows). Breakout: the envelope is opaque again; a flash front
// sweeps the photosphere (the shock emerges first where the star is thinnest), the outer layers are shock-heated
// yellow-white and cool to orange while the star swells into soft billowing lobes; bright rifts open over the
// stretched lobes and a corona of flames boils off.
// =============================================================================================================
float gBub, gKap, gLum, gBulge, gTear, gThK, gBo, gHS;
vec3 gFlashCol, gEnvCol, gBubHot, gBubCool;   // per-frame constant colours

// large lobes of the breakout (0..1)
float lobesAt(vec3 dir, float lod) { return smoothstep(0.3, 0.72, nzl(dir * 0.75 + vec3(1.7, 0.3, 4.1) + uNovaSeed * 0.21, lod).r); }
// giant convection cells, soft: +1 hot rising cell centre, -1 cooler, denser sinking lane
float convAt(vec3 dir, float r, float lod) {
  // a handful of giant cells (as imaged on Betelgeuse) with softer mottling inside them
  float c1 = nzl(dir * 0.55 + vec3(0.0, 0.0, r * 0.15) + uNovaSeed * 0.37, lod).g;
  float c2 = nzl(dir * 1.4 + vec3(0.0, 0.0, r * 0.3) + 3.1 + uNovaSeed * 0.53, lod + 0.6).b;
  return clamp(((c1 - 0.5) * 3.0 + (c2 - 0.5) * 1.1) * uConv, -1.0, 1.0);
}
// column density through the envelope from radius a to b (mean profile rho = 1 + 3 (1 - s))
float envColumn(float a, float b) { return 4.0 * (b - a) - 1.5 * (b * b - a * a); }
// thermal emission (luminance = uStarBright at the photospheric temperature); luminance compressed with exponent
// 0.35 so that 2500 K embers and a 9000 K rift both fit one exposure
vec3 starTh(float T) { return fireK(T, 0.35) * gThK; }

// breakout timing and rifts (direction only): x = time since the front passed, y = rift core (0..1),
// z = hot zone around the rifts (0..1). All soft-edged.
vec3 breakoutAt(vec3 dir, float lb, float lod) {
  vec4 nw = nzl(dir * 0.8 + vec3(9.3, 4.4, 2.1), lod) - 0.5;
  float since = gBo - (0.02 + 0.34 * smoothstep(-1.0, 1.0, -dot(dir, uBoAxis) + nw.r * 0.5));
  vec3 cd = dir + nw.gbr * 0.5;
  // rifts along the walls of a warped cellular pattern; they open behind the front, widest on the stretched lobes
  float ck = nzl(cd * 0.45 + vec3(3.3, 9.1, 1.2) + uNovaSeed * 0.7, lod + 0.5).a;
  float open = smoothstep(0.06, 0.5, since);
  float w = gTear * smoothstep(0.35, 0.85, lb) * open;
  float rift = 1.0 - smoothstep(0.0, 1.6 * w + 0.01, ck);
  float seam = (1.0 - smoothstep(w, 3.0 * w + 0.04, ck)) * open;
  return vec3(since, rift, seam);
}

void starSample(vec3 p, vec3 rd, float lod, out vec3 src, out float sig, out vec3 em) {
  float r = length(p);
  vec3 dir = p / max(r, 1e-5);
  src = vec3(0.0); sig = 0.0; em = vec3(0.0);
  float lb = gBulge > 0.0 ? lobesAt(dir, lod) : 0.0;
  // swelling surface: big lobes + soft billows (3D position: R = smooth Perlin height, G = billow temperature)
  vec4 bw = gBo > 0.0 ? nzl(p * 2.0 + vec3(2.0, 6.0, 3.0) + uNovaSeed * 0.3, lod + 1.2) : vec4(0.5);
  float sl = bw.r;
  float Rs = 1.0 + gBulge * (lb + 0.5 * (sl - 0.5));
  // ---- the bounce bubble: neutrino-heated plasma rising in a few big plumes
  float rb = 0.0, bub = 0.0;
  vec3 srcB = vec3(0.0); float sigB = 0.0;
  if (gBub > 0.0 && r < 1.5 * gBub * Rs) {
    float pl = nzl(dir * 0.8 + vec3(7.1, 2.2, 0.4) + uNovaSeed * 0.5, lod).r;
    float pl2 = nzl(dir * 2.2 + vec3(1.1, 5.2, 3.4), lod).g;
    rb = gBub * (0.86 + 0.75 * (pl - 0.5) + 0.18 * (pl2 - 0.5)) * Rs;
    // soft plasma boundary (no hard edge between the bubble and the envelope)
    bub = 1.0 - smoothstep(rb * 0.88, rb * 1.12, r);
    if (bub > 0.0) {
      float x = min(r / rb, 1.0);
      // (rising plasma: the pattern zooms outward with the bubble; a radial offset would be singular at the centre)
      float tq = nzl(p * 2.6 / (1.0 + 0.6 * gBub) + vec3(4.0, 1.0, 2.0) + uNovaSeed, lod + 1.4).g;
      sigB = 2.2 * (0.25 + 1.5 * tq * tq);
      srcB = mix(gBubHot, gBubCool, x * x) * (0.2 + 1.8 * tq * tq);
      if (bub >= 1.0) { sig = sigB; src = srcB; return; }
    }
  }
  float h = r - Rs;                                   // height above the photospheric base (negative inside)
  vec3 bt = gBo > 0.0 ? breakoutAt(dir, lb, lod) : vec3(-1.0, 0.0, 0.0);
  float hot = smoothstep(0.0, 0.05, bt.x);
  // giant convection cells (behind the breakout front the shock has erased them: the billows take over)
  float bill = clamp((bw.g - 0.5) * 2.4, -1.0, 1.0);
  float cv = hot < 1.0 ? mix(convAt(dir, r, lod), bill, hot) : bill;
  // the shocked atmosphere puffs up behind the front
  float hs = gHS * (1.0 + 0.7 * hot);
  // density: interior profile, exponential atmosphere above the base (the soft limb); cells modulate it
  float rho = (1.0 + 3.0 * sat(-h / Rs)) * exp(min(-h / hs, 0.0)) * (1.0 - 0.45 * cv);
  // temperature: hotter below, cooler in the atmosphere -> darker, redder limb
  float Te = uStarT * (1.0 + 0.8 * max(-h, 0.0) - 2.2 * max(h, 0.0) + 0.1 * cv);
  vec3 add = vec3(0.0);
  if (gBo > 0.0) {
    float since = bt.x;
    // flash: a narrow band of extreme emission rides the front through the photospheric layer
    float fl = smoothstep(-0.01, 0.0, since) * exp(-max(since, 0.0) / 0.03);
    float skin = exp(-abs(h) / (2.0 * hs));
    add = gFlashCol * fl * skin * gKap;
    // behind the front the outer layers are shock-heated: yellow-white cooling to orange, soft billows and bright
    // rifts modulate the temperature
    // large soft billows (3D), cooler protruding lobe tops, hotter creases, bright rifts
    // (the rifts are direction-only patterns: confined to the base layer so they never extrude into radial streaks)
    float rw = 1.0 - smoothstep(-0.03, 0.02, h);
    float Thot = mix(7000.0, 3500.0, smoothstep(0.0, 0.6, since)) * (1.0 + 0.3 * bill) * (1.22 - 0.4 * lb)
               * (1.0 + (1.0 * bt.z + 0.3 * bt.y) * rw);
    Te = mix(Te, Thot * (1.0 - 1.2 * max(h, 0.0)), hot);
    // flames boil off the swelling surface, tallest over the rifts and the lobes; they bend and cool with height
    if (h > 0.0) {
      float grow = smoothstep(0.05, 0.7, bt.x);
      float H = (0.012 + 0.07 * grow) * (0.6 + 0.8 * lb + 1.2 * bt.z);
      // turbulence sheared along the radius: tongues of flame
      float tq = nzl(p * 3.6 / (1.0 + 0.8 * gBo) - dir * h * 6.0 + vec3(1.0, 7.0, 3.0), lod + 2.0).g;
      float rf = grow * exp(-h / H) * (0.05 + 2.2 * tq * tq * tq) * 0.06;
      float Tf = mix(7000.0, 1900.0, sqrt(sat(h / (2.0 * H)))) * (0.85 + 0.3 * tq);
      // mix the flame gas into the atmosphere sample (density-weighted temperature)
      Te = (Te * rho + Tf * rf) / max(rho + rf, 1e-6);
      rho += rf;
    }
  }
  sig = gKap * rho;
  // limb darkening of the thermal glow (the volumetric temperature gradient alone is too weak after the luminance
  // compression); mu from the radial direction - the limb is soft, so no surface normal is needed
  float mu = sat(-dot(rd, dir) * 1.25);
  src = starTh(Te) * (0.3 + 0.7 * sqrt(mu)) + add / max(sig, 1e-4);
  if (h > 0.0 && gBo <= 0.0) {
    // extended molecular envelope: a faint clumpy red glow out to ~2 radii (emission only)
    float cl = nzl(p * 1.1 + vec3(2.0, 5.0, 1.0) + uNovaSeed, lod + 0.5).g;
    em = gEnvCol * exp(-h / 0.3) * (0.3 + 1.4 * cl * cl);
  }
  if (gLum > 0.0) {
    // light of the core + bubble reaching this point through the envelope (radial shadows = the convection pattern)
    // (nominal bubble radius, direction-independent: the per-direction rb is only fetched near the bubble)
    float rIn = max(gBub * 0.86 * Rs, 0.03);
    float tau = gKap * max(envColumn(rIn, min(r, Rs)), 0.0) * (1.0 - 0.5 * cv) + gKap * hs * (1.0 - exp(min(-h / hs, 0.0)));
    float Ein = gLum * exp(-tau) / (12.566 * (r * r + 0.5 * rIn * rIn + 0.01));
    src += vec3(1.0, 0.9, 0.82) * exp(-tau * vec3(0.0, 0.22, 0.55)) * Ein * 0.6;
  }
  if (bub > 0.0) { src = mix(src, srcB, bub); sig = mix(sig, sigB, bub); }
}

vec3 marchStar(vec3 ro, vec3 rd, float jit, float pa, inout float T) {
  float hsMax = gHS * (gBo > 0.0 ? 1.7 : 1.0);
  float rTop = 1.0 + gBulge * 1.3 + (gBo > 0.0 ? 0.3 : 0.0);
  float Rst = rTop + 7.0 * hsMax + (gBo > 0.0 ? 0.0 : 0.6);   // the envelope glow reaches further out
  vec2 h = sphereT(ro, rd, Rst);
  vec3 col = vec3(0.0);
  float tc = -dot(ro, rd);
  // the core itself: a point of light before the bubble swallows it
  float core = gLum * 3.0e4 * (1.0 - smoothstep(0.03, 0.3, gBub));
  if (h.y <= 0.0) return col;
  float t = max(h.x, 0.0), t1 = h.y;
  float sigPrev = 0.0;
  bool first = true, crossed = tc < t;
  for (int i = 0; i < 220; i++) {
    vec3 p = ro + rd * t;
    float r = length(p);
    // resolve the soft photosphere where it is opaque (about a scale height per step), coarse steps in the faint
    // envelope, the thin flame gas and the translucent interior
    float inSkin = (r > 1.0 - gBulge * 0.3 - 4.0 * hsMax && r < 1.0 + gBulge * 1.3 + 3.0 * hsMax) ? 1.0 : 0.0;
    float dtMax = r > rTop + 6.0 * hsMax ? 0.1 : (inSkin > 0.5 && gKap > 10.0 ? (gBo > 0.0 ? 1.2 : 0.9) * hsMax : (gBo > 0.0 && r > 1.0 ? 0.05 : 0.08));
    float dt = clamp(0.4 / max(sigPrev, 1e-3), 0.003, dtMax);
    if (first) { t += dt * jit; p = ro + rd * t; first = false; }
    if (t > t1) break;
    float lod = max(log2(t * pa * 128.0 * 1.3), 0.0);
    vec3 src, em; float sig;
    starSample(p, rd, lod, src, sig, em);
    float a = 1.0 - exp(-sig * dt);
    col += T * (src * a + em * dt);
    T *= 1.0 - a;
    sigPrev = sig;
    if (!crossed && t + dt >= tc) { crossed = true; col += T * pointPSF(ro, rd, pa, tc) * core * fire(60000.0); }
    if (T < 0.003) break;
    t += dt;
  }
  return col;
}

// =============================================================================================================
// EJECTA (q = p / R, self-similar): a lobed fireball with a white-hot turbulent interior, Rayleigh-Taylor fingers
// with hot mushroom caps and dense clumps of heavy elements, core light escaping between the fingers into a thin haze
// (shafts). With growing R it cools, hollows into a shell and tears into radially combed filaments; the compact
// remnant is a point of light at the centre. All boundaries are soft (smoothstep densities, no surfaces).
// =============================================================================================================
float gEvo, gHot, gFil, gGlow, gEKap, gCoreL, gHollow, gClump;
vec3 gHazeCol, gCoreCol;   // per-frame constants (colours of the scattered core light)

// skip = 1 when the sample lies in empty space (the march may take a longer step)
void ejSample(vec3 q, vec3 rd, float lb, float lstep, out vec3 src, out float sig, out vec3 em, out float skip) {
  float r = length(q);
  vec3 dir = q / max(r, 1e-5);
  src = vec3(0.0); sig = 0.0; em = vec3(0.0); skip = 0.0;
  float Tc = uEjT * gHot;
  // bent directions: lobes and fingers lean and twist
  vec3 wv = nzl(q * 0.55 + vec3(1.3, 4.4, 0.6) + uNovaSeed * 0.11, lb + log2(0.55)).rgb - 0.5;
  vec3 dw = normalize(dir + wv * 0.7);
  // large cauliflower lobes of the front (G), its radius (R), radial haze streaks (B)
  // (the front's lobes use the unbent direction: a radially varying bend would fold the front into nested shells)
  vec4 Lb = nzl(dir * 1.15 + vec3(8.0, 1.0, 4.0) + uNovaSeed * 0.17, lb + log2(1.15));
  // Rayleigh-Taylor fingers: one per cell of a coarse cellular pattern (G), their lengths (B). Once the shell has
  // torn into radial filaments (gClump = 1) the fingers have merged into them: skipped
  bool late = gClump > 0.99;
  vec4 F = late ? vec4(0.0, 0.0, 0.5, 0.0) : nzl(dw * 0.62 + vec3(6.0, 2.0, 9.0) + uNovaSeed * 0.23, lb + log2(0.62));
  float flen = mix(0.12, 0.6, smoothstep(0.36, 0.64, F.b)) * uFingers;
  float rsBase = 0.60 + 0.42 * (Lb.g * 0.62 - 0.31) + 0.05 * (Lb.r - 0.5);
  // core light escaping between the fingers into the thin outer haze (shafts)
  float u0 = (r - rsBase - 0.16 * 0.38) / max(flen, 1e-3);
  float tauR = gEKap * 14.0 * smoothstep(0.57, 0.6, F.g) * flen * sat(u0);
  if (r > 0.5 * rsBase) {
    float Ic = gCoreL * exp(-tauR) * smoothstep(0.5 * rsBase, 0.8 * rsBase, r) / (r * r + 0.02);
    float rho = (0.1 + 1.6 * Lb.b * Lb.b) / (r * r + 0.3);
    em = rho * Ic * hgPhase(dot(dir, -rd), 0.5) * 12.566 * gHazeCol;
  }
  // empty space: beyond the front (max possible radius) and not inside any finger, or deep in the hollow interior
  if (r > rsBase + 0.16 * 0.42 + 0.06 && (late || F.g < 0.5 || u0 > 1.1)) { skip = 1.0; return; }
  if (gHollow > 0.999 && r < 0.6 * (rsBase - 0.08)) { skip = 1.0; return; }
  // detail zooms outward through the self-similar frame (scale-invariant: no singular radius)
  float zm = 1.0 / (1.0 + 0.06 * gEvo);
  // (mip level also covers the step length: no aliasing along the ray)
  vec4 Dt = nzl(q * 5.0 * zm + vec3(0.3, 0.9, 0.1), max(lb, lstep - 0.5) + log2(5.0 * zm));
  // small lobes of the front (irrelevant once the shell has fragmented: skipped to save a fetch)
  vec4 Ls = gClump < 0.95 ? nzl(dir * (3.4 - gEvo * 0.08) + vec3(2.0, 6.0, 3.0), lb + log2(3.4)) : vec4(0.5);
  // fine turbulence for close-ups; its mip level also covers the step length so it never aliases along the ray
  float fl = max(lb, lstep) + log2(19.0);
  float fine = (fl < 3.0 && !late) ? (nzl(q * 19.0 * zm * zm + vec3(5.1, 2.7, 8.3), fl).r - 0.5) * (1.0 - smoothstep(2.0, 3.0, fl)) : 0.0;
  float det = Dt.r - 0.5 + fine * 0.7;
  float lobes = Lb.g * 0.62 + Ls.g * 0.38;
  float rs = 0.60 + 0.42 * (lobes - 0.5) + 0.05 * (Lb.r - 0.5);
  float u = (r - rs) / max(flen, 1e-3);
  // ---- fireball: nearly solid inside its lobed front, hollowing out as it expands (nebular phase)
  float ball = 1.0 - smoothstep(rs - 0.12, rs + 0.03, r + det * 0.08);
  float hollow = gHollow * (1.0 - smoothstep(0.62, 0.96, r / rs));
  // late times: the shell tears into filaments combed along the radius by the expansion (the sampling is stretched
  // radially), with dark gaps between them; each filament has its own temperature
  float frag = 1.0, fT = 1.0;
  if (gClump > 0.0) {
    vec4 Rf = nzl(dw * 5.0 + vec3(r * 0.8) + vec3(1.0, 5.0, 2.0), max(lb, lstep - 1.0) + log2(5.0));
    // (the large lobes Lb.g leave whole regions of the sky empty: big dark voids between the streams)
    frag = mix(1.0, smoothstep(0.5, 0.62, Rf.g + (Lb.g - 0.5) * 0.55 + (Dt.g - 0.5) * 0.2 + fine * 0.25), gClump);
    fT = mix(1.0, 0.5 + 1.1 * smoothstep(0.3, 0.72, Rf.b), gClump);
  }
  float rhoB = ball * (0.55 + 0.9 * Dt.g) * (1.0 - hollow) * frag;
  float depth = sat((rs - r) / rs);
  // protruding lobes are cooler, creases and depths hotter
  float Ts = mix(5200.0, 2100.0, smoothstep(0.4, 0.7, lobes)) * (0.9 + 0.5 * det) * (0.45 + 0.55 * gHot);
  float Tpk = Tc * (0.65 + 0.7 * smoothstep(0.42, 0.7, Dt.g)) * (1.0 - 0.3 * gHollow);
  float Tb = mix(Ts, Tpk, smoothstep(0.0, 0.22, depth)) * fT;
  // ---- fingers beyond the front: narrowing spikes with hot mushroom caps
  float cap = exp(-sq((u - 0.88) / 0.09));
  float thr = mix(0.565, 0.655, sat(u)) - 0.05 * cap + det * 0.06;
  float fing = late ? 0.0 : smoothstep(thr - 0.012, thr + 0.045, F.g) * smoothstep(-0.1, 0.03, u) * (1.0 - smoothstep(0.92, 1.06, u));
  float stk = 0.5;
  if (fing > 0.01) stk = smoothstep(0.3, 0.7, nzl(dw * 6.5 + vec3(r * 1.1) + vec3(4.0, 1.0, 7.0), lb + log2(6.5)).r);
  float Tf = mix(4400.0, 1000.0, sqrt(sat(u))) * (1.0 + 0.6 * cap) * (0.85 + 0.4 * stk) * (0.45 + 0.55 * gHot);
  // clumps of heavy elements: the densest, hottest parts of the fingers (the streak texture's bright peaks)
  float kn = fing * smoothstep(0.62, 0.72, stk * 0.5 + Dt.g * 0.6);
  float sB = gEKap * uEjDense * rhoB;
  float sF = gEKap * uEjDense * 0.7 * fing * (0.45 + 1.1 * stk);
  float sK = gEKap * 30.0 * kn;
  sig = sB + sF + sK;
  if (sig < 1e-4 && r > rs) skip = 0.6;
  if (sig > 1e-5) {
    vec3 S = sB * fireK(max(Tb, 1000.0), 0.3) * 1.9 * gGlow;
    if (sF + sK > 0.0) {
      float Ic = gCoreL * exp(-tauR) / (r * r + 0.02);
      vec3 SF = fireK(max(Tf, 900.0), 0.45) * 3.2 * (0.5 + 0.9 * stk) * gFil + gCoreCol * Ic * hgPhase(dot(dir, -rd), 0.5) * 12.566 * 0.015;
      S += sF * SF + sK * fireK(max(Tf * 1.3, 1500.0), 0.45) * 4.0 * gFil;
    }
    src = S / sig * uEjBright;
  }
}

vec3 marchEjecta(vec3 ro, vec3 rd, float R, float jit, float pa, inout float T) {
  vec3 o = ro / R;
  // once the light has died only the remnant's filaments remain: cheaper, coarser march (the filament integral is
  // analytic per segment, so coarse steps stay exact for the thin structure)
  bool remOnly = uAge >= 0.999 || uDim >= 0.995;
  float Rb = remOnly ? 1.09 : 1.55;
  vec2 h = sphereT(o, rd, Rb);
  vec3 col = vec3(0.0);
  float tc = -dot(o, rd);
  float bc = length(o + rd * tc);
  float hq = uHole / R;
  if (h.y <= 0.0) return col;
  float t = max(h.x, 0.0), t1 = h.y;
  bool first = true;
  bool crossed = tc < t;
  vec4 rnPrev = vec4(0.0), raPrev = vec4(0.0);
  float skip = 0.0, sigPrev = 0.0;
  for (int i = 0; i < 170; i++) {
    vec3 q = o + rd * t;
    float rq2 = dot(q, q);
    float dt;
    if (remOnly) dt = (rq2 < 0.2 ? 0.08 : 0.034 + 0.02 * t) + t * pa * 2.0;
    else {
      // fine steps in the debris, longer ones in empty space; never finer than ~2 pixels
      dt = skip > 0.0 ? clamp(max(0.03, t * pa * 4.0), 0.004, 0.05) * (1.0 + skip) : clamp(0.011 + 0.024 * t + t * pa * 1.5, 0.004, 0.045);
      // inside opaque matter each step covers at most ~0.8 optical depths (resolves the edges of dense fingers)
      dt = min(dt, max(0.8 / max(sigPrev, 1e-3), 0.003));
    }
    if (first) { t += dt * jit; q = o + rd * t; rq2 = dot(q, q); }
    if (t > t1) break;
    float lb = max(log2(max(t * pa * 128.0, 1e-4)), 0.0);
    vec3 src = vec3(0.0), em = vec3(0.0); float sig = 0.0;
    skip = 0.0;
    if (!remOnly) ejSample(q, rd, lb, log2(max(dt * 0.5 * 128.0, 1e-4)), src, sig, em, skip);
    if (uAge > 0.0 && rq2 < 1.17 && rq2 > 0.25) {
      vec4 rn, ra;
      remField(q, lb, rn, ra);
      // near-field defocus: filaments right in front of the lens widen and dim (flux-conserving), like a shallow
      // depth of field; it also hides the noise texture's trilinear facets at extreme magnification
      if (!first) col += T * remColor(remSegment(rnPrev, rn, raPrev, ra, dt, t * pa + 0.05 * max(0.16 - t, 0.0))) * uAge;
      rnPrev = rn; raPrev = ra;
    }
    first = false;
    sigPrev = sig;
    float a = 1.0 - exp(-sig * dt * (1.0 - uAge) * (1.0 - 0.85 * uDim));
    col += T * (src * a + em * dt) * (1.0 - uAge);
    T *= 1.0 - a;
    // the dying inner glow: a faint ember haze around the centre, against which the black point stands out
    if (uEmber > 0.0) {
      // (rays that pass the hole lose the glow along their whole length: its shadow reads as a clean black point)
      float sh = hq > 0.0 ? smoothstep(hq, 2.6 * hq, bc) : 1.0;
      col += T * fireK(2600.0, 0.5) * uEmber * 0.35 * exp(-rq2 / 0.08) * sh * dt;
    }
    // the compact remnant and the black hole at the centre
    if (!crossed && t + dt >= tc) {
      crossed = true;
      col += T * pointPSF(o, rd, pa, tc) * uCorePt * 3.0e5 * fire(80000.0) * (1.0 - uDim);
      if (hq > 0.0) T *= smoothstep(hq - tc * pa, hq + tc * pa, bc);
    }
    if (T < 0.004) break;
    t += dt;
  }
  return col;
}

// =============================================================================================================
// LIGHT ECHOES: the flash front (an ellipsoid with foci at the supernova and the camera) sweeping through dust sheets
// =============================================================================================================
// interstellar dust: a few warped sheets (the echoes draw rings where the flash ellipsoid cuts them) made of
// swirling filaments with cavities, V838 Mon-like
float dustDensity(vec3 x, float lod) {
  vec3 y = uDustRot * (x / uDustR);
  vec3 w = nzl(y * 0.45 + vec3(3.1, 7.0, 1.0), lod + log2(0.45)).rgb - 0.5;
  vec3 y2 = y + w * 0.5;
  float disp = w.r * 0.9;
  float d = 0.0;
  d += exp(-sq((y.z - 0.55 + disp) / 0.10));
  d += 0.8 * exp(-sq((dot(y, vec3(0.31, 0.12, 0.94)) - 1.05 + disp * 1.3) / 0.14));
  d += 0.6 * exp(-sq((dot(y, vec3(-0.25, 0.3, 0.92)) + 0.6 - disp) / 0.18));
  d += 0.7 * exp(-sq((dot(y, vec3(0.1, -0.2, 0.97)) - 0.15 + disp * 0.7) / 0.07));
  if (d < 0.01) return 0.0;
  vec4 f = nzl(y2 * 1.5 + vec3(0.5, 2.5, 4.5), lod + log2(1.5));
  float rid = 1.0 - abs(f.r * 2.0 - 1.0);
  float fil = rid * rid * rid * rid * rid * rid;
  float cav = smoothstep(0.44, 0.6, f.b * 0.7 + f.g * 0.3);
  return d * (0.03 + 3.0 * fil + 0.35 * f.g * f.g) * cav;
}
vec3 echoLight(vec3 ro, vec3 rd, float jit, float pa) {
  float D = length(ro), cd = dot(ro, rd);
  const int N = 32;
  vec3 acc = vec3(0.0);
  float W = uEchoW;
  for (int i = 0; i < N; i++) {
    float age = W * (float(i) + jit) / float(N);
    float dl = uEcho - age;
    if (dl <= 0.0) break;
    float A = D + dl;
    float den = cd + A;
    float t = (A * A - D * D) / (2.0 * den);
    float dtd = (A * A + 2.0 * A * cd + D * D) / (2.0 * den * den);
    vec3 x = ro + rd * t;
    float rr = max(length(x), 1e-3);
    float lod = max(log2(t * pa * 128.0 / uDustR * 2.3), 0.0);
    float rho = dustDensity(x, lod);
    if (rho <= 0.0) continue;
    // light curve: blue-white shock-breakout spike, the broad main peak, an orange-red tail (later = cooler)
    float a = age / W;
    float Lf = 2.5 * exp(-a / 0.03);
    float Lm = (a / 0.16) * exp(1.0 - a / 0.16);
    vec3 Lc = Lf * fireK(30000.0, 0.3) + Lm * fireK(mix(7200.0, 2500.0, sat(a / 0.55)), 0.35);
    float ph = hgPhase(dot(x / rr, -rd), 0.45);
    acc += Lc * rho * ph * dtd / (rr * rr / (uDustR * uDustR) + 0.06);
  }
  return acc * (W / float(N)) / uDustR * uEchoAmt;
}
// extinction of the background by the dust sheets (column density at each sheet crossing)
float dustTau(vec3 ro, vec3 rd, float pa) {
  vec3 o = uDustRot * (ro / uDustR), d = uDustRot * rd;
  float tau = 0.0;
  vec4 N[4] = vec4[4](vec4(0.0, 0.0, 1.0, 0.55), vec4(0.31, 0.12, 0.94, 1.05), vec4(-0.25, 0.3, 0.92, -0.6), vec4(0.1, -0.2, 0.97, 0.15));
  vec4 H = vec4(0.10, 0.14, 0.18, 0.07), Am = vec4(1.0, 0.8, 0.6, 0.7);
  for (int i = 0; i < 4; i++) {
    vec3 n = normalize(N[i].xyz);
    float dn = dot(n, d);
    if (abs(dn) < 1e-3) continue;
    float t = (N[i].w - dot(n, o)) / dn;
    if (t <= 0.0) continue;
    vec3 y = o + d * t;
    float lod = max(log2(t * pa * 128.0 * 1.9), 0.0);
    vec4 f = nzl(y * 1.9 + vec3(0.5, 2.5, 4.5), lod);
    float wisp = 0.12 + 1.6 * sq(f.g);
    tau += Am[i] * H[i] * 1.77 * wisp / abs(dn);
  }
  return tau * uDust;
}

// =============================================================================================================
void main() {
  vec3 rd = camRay();
  vec3 ro = uCamPos;
  float pa = pixelAngle();
  vec4 rnd = pixelRand(gl_FragCoord.xy, uSeed);
  // march-start jitter stratified over the frame's sub-frames (Cranley-Patterson rotation of k/n per pixel):
  // with n sub-frames the start offsets of one pixel are evenly spread, which converges much faster than iid
  {
    float n = max(floor(1.0 / uWeight + 0.5), 1.0);
    float k = mod(uSeed, 16.0);
    vec4 rf = pixelRand(gl_FragCoord.xy, floor(uSeed / 16.0) + 0.5);
    rnd.xy = fract(rf.xy + vec2(k / n, fract(k * 0.618034)));
    // the per-pixel radius jitter of the ejecta motion blur, stratified the same way (in a different order)
    rnd.w = fract(rf.w + (n - 1.0 - k) / n);
  }

#ifdef REMSKY_ONLY
  emit(remnantSky(rd, pa) + sky(rd, pa) * uSkyAmt); return;
#endif
#ifdef REMSKY_MARCHED
  emit(remnantSkyMarched(rd, pa) + sky(rd, pa) * uSkyAmt); return;
#endif
#ifdef REMSKY_LENS
  {
    // debug: remnantSky behind a point lens (thin-lens deflection, Einstein radius 0.12 rad), footprint from fwidth
    vec3 f = uCamRot[2];
    vec3 c = normalize(rd - f * dot(rd, f));
    float th = acos(clamp(dot(rd, f), -1.0, 1.0));
    float thE = 0.12;
    float beta = th - thE * thE / max(th, 1e-4);
    vec3 d = normalize(f * cos(beta) + c * sin(beta));   // beta < 0: the secondary image, on the far side
    float fp = max(length(fwidth(d)), pa * 0.5);
    vec3 cl = th < 0.03 ? vec3(0.0) : remnantSky(d, fp) + sky(d, fp) * uSkyAmt;
    emit(cl); return;
  }
#endif

  vec3 col = vec3(0.0);
  float T = 1.0;
  if (uExpand > 1.0) {
    float R = max(uExpand + uExpandBlur * (rnd.w - 0.5), 1.0);
    gEvo = log(R);
    // cooling and dimming
    gHot = (1.0 - 0.35 * uDim) * pow(1.0 + R / 60.0, -0.5);
    gGlow = exp(-uDim * 5.0);
    gFil = mix(1.0, 0.04, sat(uDim));
    gEKap = uEjOpacity * 5.0 / (1.0 + R * R / 40000.0);
    gCoreL = 6.0 * gGlow;
    gHollow = smoothstep(60.0, 300.0, R);
    gClump = smoothstep(70.0, 230.0, R);
    gHazeCol = fireK(uEjT * gHot * 0.35, 0.4) * 0.002 * uEjBright;
    gCoreCol = fireK(uEjT * gHot * 0.6, 0.4);
    col += marchEjecta(ro, rd, R, rnd.x, pa, T);
  } else {
    float b = uBounce;
    // bubble radius, envelope opacity (opaque star -> translucent at the flash; opaque again for the breakout)
    // the glow grows from within over the first ~quarter of the bar (no single-frame flash), then the bubble rises
    float ig = smoothstep(0.0, 0.27, b);
    gBub = b > 0.0 ? 0.95 * smoothstep(0.08, 1.0, b) : 0.0;
    gLum = 1000.0 * uBounceLum * ig * ig * (1.0 + 0.6 * smoothstep(0.3, 1.0, b));
    gKap = mix(90.0, 1.2, smoothstep(0.0, 0.06, b));
    gBo = uBreakout;
    if (gBo > 0.0) { gKap = 70.0; gLum = 0.0; gBub = 0.0; }
    gBulge = 0.32 * pow(smoothstep(0.05, 1.0, gBo), 1.3);
    gTear = 0.11 * smoothstep(0.1, 1.0, gBo);
    gThK = uStarBright / pow(bbLum(uStarT) / bbLum(6500.0), 0.35);
    gHS = max(uStarHS, 1e-3);
    gFlashCol = starTh(70000.0) * 0.12;
    gEnvCol = starTh(uStarT * 0.85) * 0.03;
    gBubHot = fireK(60000.0, 0.3) * 150.0 * uBounceLum;
    gBubCool = fireK(20000.0, 0.3) * 150.0 * uBounceLum;
    col += marchStar(ro, rd, rnd.x, pa, T);
  }
  if (uEcho > 0.0) col += echoLight(ro, rd, rnd.y, pa);
  float ext = uDust > 0.0 ? dustTau(ro, rd, pa) : 0.0;
  float Ts = T * exp(-ext);
  if (Ts > 0.002) col += Ts * sky(rd, pa) * uSkyAmt;
  emit(col);
}
