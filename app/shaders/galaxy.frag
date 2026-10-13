// EVENT HORIZON — `galaxy`: the grown black hole at the heart of a spiral galaxy, which then becomes a quasar.
//
// Units: galaxy units (GU). The visible stellar disk ends near r = 1 GU (~15 kpc). The disk lies in the xz plane,
// rotation axis +y; the jets run along +-y. Front-to-back emission/absorption along each camera ray:
//   thin disk (slab |y| < HS, r < RMAX), ray-marched: old-disk light, diffuse young arms, dust (R_V = 3.1 reddening,
//             faint scattered starlight, lit from the centre by the quasar)
//   knots:    HII regions + young clusters as discrete flux-conserving sources in the disk plane (crisp at any range)
//   bulge + thick disk: multi-Gaussian expansion integrated analytically along the ray (erf): exact cusp at any step
//             size, silhouetted by the dust it shares the slab with
//   stars:    when the camera is inside the galaxy, stars closer than uResolve are drawn as points (3D cell DDA) and
//             removed from the continuum
//   nucleus:  AGN point (uGrow, uQuasar) + quasar light scattered by the circumnuclear medium (analytic line integrals)
//   jets:     twin relativistic jets (beamed), advected shock knots, twisted filaments, hotspots, billowy radio lobes
//             (pure emission), attenuated by the disk where they lie behind it
//   sky:      intergalactic: faint stars + deep field (sky.glsl)
#include "common.glsl"
#include "sky.glsl"
#include "galaxy_lib.glsl"

uniform float uSkyAmt;
uniform float uSpin;      // disk pattern rotation (rad)
uniform float uPitch;     // arm pitch angle (deg)
uniform float uArms;      // number of arms (integer)
uniform float uBulge;     // bulge brightness
uniform float uDiskAmt;   // old-disk brightness
uniform float uYoung;     // young blue population
uniform float uHII;       // HII regions / clusters (knots)
uniform float uDust;      // dust optical depth multiplier
uniform float uGalSeed;   // structure seed
uniform float uResolve;   // radius around the camera inside which stars are resolved into points (0 = off)
uniform float uStarAmt;   // resolved-star brightness
uniform float uStepK;     // march step growth with distance (quality / speed)
uniform float uGrow;      // 0..1 active nucleus brightening
uniform float uQuasar;    // quasar luminosity (0 = off, 1 = full quasar; the climax climbs to ~1.6)
uniform float uJet;       // jet length (galaxy radii = GU)
uniform float uFlow;      // jet flow clock (s)
uniform float uFlowBlur;  // per-pixel flow-clock jitter (s): fills in between the motion-blur sub-frames
uniform float uBeam;      // relativistic beaming (0 = off, 1 = bulk beta 0.6)
uniform float uLobe;      // radio lobe amount
uniform float uJetAmt;    // jet brightness

#ifndef MAXS
#define MAXS 140
#endif

const float RMAX = 1.3;   // disk march radius
const float HS = 0.12;    // disk march half-thickness
const vec3 KEXT = vec3(0.74, 1.0, 1.32);   // relative extinction R,G,B (R_V = 3.1)
const float COTP2 = 2.2;  // secondary (branching) arm pattern: pitch ~24 deg
const float SINP2 = 0.414;
const float COTF = 0.70;  // feathers: pitch ~55 deg
const float SINF = 0.819;
const float A_OLD = 11.0; // old-disk emissivity scale

float COTP, SINP, FLOW, NSTEP = 0.0, NRETRY = 0.0;
mat2 TOGAL, TOWORLD;       // world xz -> galaxy frame (de-rotated by uSpin) and back
vec3 RD;
vec3 C_OLD, C_YOUNG, C_HII, C_Q;

// ---- bulge + thick disk: sigma (GU), flattening, central emissivity, colour temperature
const int NB = 6;
const int NB_DENSE = 3;   // components 0..2 (nuclear cusp, inner bulge) stay a glow even close up
const float BS[NB] = float[NB](0.004, 0.016, 0.05, 0.13, 0.28, 0.50);
const float BQ[NB] = float[NB](0.90, 0.85, 0.78, 0.72, 0.62, 0.18);
const float BA[NB] = float[NB](110.0, 28.0, 14.0, 4.0, 0.6, 0.16);
const float BT[NB] = float[NB](4000.0, 4100.0, 4250.0, 4450.0, 4700.0, 5300.0);
vec3 G[NB];
bool GON[NB];
vec3 BC[NB];

vec3 bulgeSeg(float ta, float tb) {
  vec3 s = vec3(0.0);
  for (int k = 0; k < NB; k++) if (GON[k]) s += BC[k] * gaussSeg(G[k], ta, tb);
  return s;
}
// broad components only (the part that dissolves into resolved stars near the camera)
vec3 bulgeSegBroad(float ta, float tb) {
  vec3 s = vec3(0.0);
  for (int k = NB_DENSE; k < NB; k++) if (GON[k]) s += BC[k] * gaussSeg(G[k], ta, tb);
  return s;
}
// bulge emissivity (luminance-ish scalar) at a point, for the resolved-star density
float bulgeDens(vec3 p) {
  float s = 0.0;
  for (int k = NB_DENSE; k < NB - 1; k++) s += BA[k] * exp(-(dot(p.xz, p.xz) + sqr(p.y / BQ[k])) / (BS[k] * BS[k]));
  return s * uBulge;
}

// ------------------------------------------------------------------------------------------------ disk
// scale heights (GU): old thin disk, young population, dust (all flare outwards)
float hOld(float r) { return 0.015 + 0.02 * r; }
float hYng(float r) { return 0.004 + 0.003 * r; }
float hDst(float r) { return min(0.002 + 0.07 * r, 0.009 + 0.01 * r); }

float stepLen(vec3 p, vec3 rd, float t, float kPrev) {
  float r = length(p.xz);
  float hd = hDst(r), ay = abs(p.y);
  float dv = max(0.55 * hd, 0.33 * ay) / max(abs(rd.y), 1e-3);
  float dh = (0.0015 + uStepK * t) * mix(1.0, 3.5, smoothstep(2.5 * hd, 4.0 * hd, ay)) / max(length(rd.xz), 1e-3);
  float dk = 0.75 / max(kPrev, 1e-3);             // at most ~0.75 optical depth per step
  return clamp(min(min(dv, dh), dk), 0.0005, 0.3);
}

// noise channel normalisation: R,B ~ N(0.5, 0.095); G (billows) mean 0.48, 95% below 0.675; A (cell walls) 0 on walls
float zR(float v) { return (v - 0.5) * 10.5; }

struct Arm { float r, lr, ang, d, d2, s2, armS, wmul, fph, fph2; };

// spiral arm geometry at galaxy-frame position q (de-rotated by uSpin); fpw = footprint (GU)
Arm armAt(vec2 q, float fpw, bool full) {
  Arm a;
  a.r = length(q);
  float rr = max(a.r, 1e-4);
  a.lr = log(rr);
  a.ang = atan(q.y, q.x);
  float psi = a.ang + COTP * a.lr;               // constant along a trailing log spiral (the arms)
  vec2 wp = rr * vec2(cos(psi), sin(psi));       // unwound frame: noise here is sheared along the arms
  vec4 nA = nzl(vec3(wp.x * 0.5, 0.37 + uGalSeed, wp.y * 0.5), 0.0);
  float phase = uArms * psi + 0.5 * zR(nA.r);
  if (a.r < 0.45) {                              // the nuclear spiral is irregular
    vec4 nI = nzl(vec3(q.x * 7.0 + 0.13, 0.81 + uGalSeed, q.y * 7.0 + 0.57), 0.0);
    phase += 1.1 * zR(nI.r) * exp(-a.r / 0.12);
  }
  a.d = fract(phase / TAU + 0.5) - 0.5;         // 0 = arm crest, < 0 = upstream (concave) side: dust lane
  a.fph = fpw * uArms / (TAU * rr * SINP);       // footprint in arm-phase units
  a.fph2 = fpw * uArms / (TAU * rr * SINP2);
  a.armS = clamp(1.0 + 0.55 * zR(nA.b), 0.2, 2.2);
  a.d2 = 0.5; a.s2 = 0.0; a.wmul = 1.0;
  if (full) {
    vec4 nB = nzl(vec3(q.x * 1.3 + 0.71, 0.53 + uGalSeed, q.y * 1.3 + 0.29), 0.0);
    float phase2 = uArms * (a.ang + COTP2 * a.lr) + 2.2 + 0.7 * zR(nA.g);
    a.d2 = fract(phase2 / TAU + 0.5) - 0.5;     // secondary, more open arms branching in the outer disk
    a.s2 = smoothstep(0.32, 0.7, a.r) * clamp(0.45 + 0.5 * zR(nB.r), 0.0, 1.0);
    a.wmul = clamp(1.0 + 0.3 * zR(nB.b), 0.6, 1.6);
  }
  return a;
}
float envYoung(float r) { return smoothstep(0.1, 0.32, r) * exp(-r / 0.55) * (1.0 - smoothstep(0.92, 1.25, r)); }
// circumnuclear star-forming ring (gas driven inward piles up at an inner resonance)
float envRing(float r) { return exp(-0.5 * sqr((r - 0.046) / 0.007)); }
float envOldF(float r) { return exp(-r / 0.26) * (1.0 - smoothstep(1.0, 1.35, r)); }

// emission (per GU) and extinction (per GU); `cont` scales the stellar continuum (resolved stars near the camera)
void diskSample(vec3 p, float fpw, float cont, out vec3 em, out vec3 ext) {
  ext = vec3(0.0);
  vec2 q = TOGAL * p.xz;
  float r = length(q);
  float hs = hOld(r), hy = hYng(r), hd = hDst(r);
  float y = p.y;
  bool thin = abs(y) < 3.3 * max(hd, hy);
  float vOld = sech2(y / hs);
  if (!thin && vOld < 0.03) {                      // far from the midplane: smooth old disk only
    em = A_OLD * uDiskAmt * cont * envOldF(r) * 0.85 * vOld * C_OLD;
    return;
  }
  Arm a = armAt(q, fpw / max(abs(RD.y), 0.3), thin);

  // old disk: smooth, broad density wave
  float envOld = envOldF(r);
  float old = envOld * (0.55 + 0.8 * a.armS * gbump(a.d, 0.16, a.fph) * smoothstep(0.03, 0.25, r)) * vOld;
  em = A_OLD * uDiskAmt * cont * old * C_OLD;
  if (!thin) return;                               // the thin layers are negligible out here

  // noise: clouds (weakly sheared, pitch ~50 deg), filament webs (pitch ~28 deg), fine grain
  float psiC = a.ang + 0.85 * a.lr, psiW = a.ang + 1.9 * a.lr;
  vec2 wc = max(r, 1e-4) * vec2(cos(psiC), sin(psiC));
  vec2 ww = max(r, 1e-4) * vec2(cos(psiW), sin(psiW));
  float axzR = length(RD.xz);
  float lodC = lodOf(fpw, max(6.0, 12.0 * axzR)), lodW = lodOf(fpw, max(5.0, 10.0 * axzR)), lodK = lodOf(fpw, max(22.0, 33.0 * axzR));
  float fC = smoothstep(1.5, 3.6, lodC), fW = smoothstep(1.5, 3.6, lodW), fK = smoothstep(1.5, 3.6, lodK);
  // fully filtered lookups are replaced by their means (saves fetches on distant / long grazing steps)
  vec4 nC = fC < 0.999 ? nzl(vec3(wc.x * 6.0, y * 12.0 + 0.11, wc.y * 6.0), lodC) : vec4(0.5, 0.48, 0.5, 0.32);
  vec4 nW = fW < 0.999 ? nzl(vec3(ww.x * 5.0 + 0.2, y * 10.0 + 0.61, ww.y * 5.0), lodW) : vec4(0.5, 0.48, 0.5, 0.32);
  vec4 nK = fK < 0.999 ? nzl(vec3(wc.x * 22.0 + 0.3, y * 33.0 + 0.71, wc.y * 22.0), lodK) : vec4(0.5, 0.48, 0.5, 0.32);
  float cloud = mix(smoothstep(0.38, 0.66, nC.g), 0.45, fC);
  float grain = mix(smoothstep(0.42, 0.62, nK.g), 0.45, fK);

  // diffuse young arms (main + branches); the knots are a separate point layer
  float vY = exp(-0.5 * y * y / (hy * hy));
  float armP = gbump(a.d, (a.d < 0.0 ? 0.035 : 0.11) * a.wmul, a.fph)
             + a.s2 * gbump(a.d2, (a.d2 < 0.0 ? 0.03 : 0.07) * a.wmul, a.fph2);
  float young = envYoung(r) * (a.armS * armP * (0.3 + 0.7 * cloud) * (0.5 + 0.8 * grain) + 0.05 * cloud) * vY
              + 0.9 * envRing(r) * (0.25 + 0.9 * cloud * grain) * vY;

  // dust: crisp lanes on the concave edge of each arm, feathers into the inter-arm, filament webs
  float vD = exp(-0.5 * y * y / (hd * hd));
  float envD = smoothstep(0.003, 0.02, r) * (exp(-r / 0.45) + 0.7 * exp(-r / 0.06)) * (1.0 - smoothstep(0.95, 1.3, r))
             + 0.8 * exp(-0.5 * sqr((r - 0.038) / 0.006));
  float x = a.d + 0.045 + 0.008 * zR(nW.b);
  float lane = gbump(x, (x < 0.0 ? 0.010 : 0.026) * a.wmul, a.fph);
  float x2 = a.d2 + 0.04;
  lane += 0.8 * a.s2 * gbump(x2, (x2 < 0.0 ? 0.01 : 0.022) * a.wmul, a.fph2);
  float psiF = a.ang + COTF * a.lr;
  float fx = fract(11.0 * psiF + 0.25 * zR(nC.r)) - 0.5;             // ~70 feathers per turn
  float fphF = fpw / max(abs(RD.y), 0.3) * 70.0 / (TAU * max(r, 1e-4) * SINF);
  float feath = gbump(fx, 0.11, fphF) * gbump(a.d - 0.09, 0.1, a.fph) * smoothstep(0.45, 0.6, nC.b);
  float web = mix(smoothstep(0.10, 0.015, nW.a), 0.12, fW);
  float patchy = mix(smoothstep(0.43, 0.57, nK.r), 0.5, fK);
  float armD = smoothstep(0.004, 0.05, r) * a.armS;
  float dust = envD * (armD * (2.6 * lane + 1.3 * feath) + 0.55 * web * (0.25 + 0.75 * armD * gbump(a.d, 0.2, a.fph)) + 0.14)
             * (0.15 + 1.7 * patchy) * vD;

  em += 100.0 * uYoung * young * C_YOUNG;
  float kd = 170.0 * uDust * dust;
  ext = kd * KEXT;
  em += kd * 0.025 * envOld * C_OLD;              // scattered ambient starlight
  if (uQuasar > 0.0) {                             // dust lit from the centre by the quasar (HG phase, g = 0.4)
    float r3 = length(p);
    float tauC = 18.0 * uDust * r * min(1.0, 1.5 * hd / max(abs(y), 1e-4));
    float mu = dot(p, -RD) / max(r3, 1e-5);
    float hg = 0.84 / pow(1.16 - 0.8 * mu, 1.5);
    em += kd * 0.006 * uQuasar * hg * exp(-tauC) / (r3 * r3 + 1e-4) * C_Q;
  }
}

// ---- star-forming knots: one candidate per cell of a grid in the galaxy frame, accepted by the local young-star
// density; rendered as 3D Gaussian blobs (size >= pixel footprint, flux conserved) near the disk-plane crossing.
const float KCELL = 0.009;
vec3 knotLayer(vec3 ro, vec3 rd, float tP, float pa) {
  vec3 P = ro + rd * tP;
  vec2 q0 = TOGAL * P.xz;
  if (length(q0) > 1.28) return vec3(0.0);
  float sinE = max(abs(rd.y), 0.05);
  float sMax = 0.0032 + 0.6 * pa * tP;
  float N = clamp(ceil(2.2 * sMax / sinE / KCELL - 0.5), 1.0, 2.0);  // neighbourhood that covers the blob reach
  vec2 c0 = floor(q0 / KCELL);
  vec3 acc = vec3(0.0);
  for (int j = -3; j <= 3; j++)
  for (int i = -3; i <= 3; i++) {
    if (float(abs(i)) > N || float(abs(j)) > N) continue;
    vec2 c = c0 + vec2(i, j);
    vec4 h = hash44i(ivec4(ivec2(c) + 8192, 31, 7));
    vec2 kq = (c + 0.1 + 0.8 * h.xy) * KCELL;
    float rk = length(kq);
    float ey = envYoung(rk), er = envRing(rk);
    if (h.z > 2.6 * ey + 0.9 * er) continue;                 // cheap rejection against the largest possible density
    vec2 kw = TOWORLD * kq;
    vec3 v = vec3(kw.x, 0.0, kw.y) - ro;
    float tk = dot(v, rd);
    if (tk <= 0.0) continue;
    float d2 = max(dot(v, v) - tk * tk, 0.0);
    vec4 h2 = hash44i(ivec4(ivec2(c) + 8192, 32, 9));
    float size = 0.0008 + 0.0024 * h2.x * h2.x;
    float s2 = size * size + sqr(0.6 * pa * tk);
    if (d2 > 4.84 * s2) continue;                  // this knot is too far from the ray
    Arm a = armAt(kq, 0.0, true);
    vec4 nC = nzl(vec3(kq.x * 9.0, 0.5, kq.y * 9.0), 0.0);
    float prof = gbump(a.d + 0.005, 0.06 * a.wmul, 0.0) + a.s2 * gbump(a.d2 + 0.004, 0.05 * a.wmul, 0.0);
    float dens = ey * a.armS * prof * smoothstep(0.36, 0.6, nC.g) + 0.75 * er * smoothstep(0.3, 0.55, nC.g);
    if (h.z > 1.2 * dens + 0.02 * ey) continue;
    float L = 0.00005 * exp(-5.0 * h2.y) * (0.5 + dens);
    vec3 c3 = h2.z < 0.55 ? C_HII * (1.0 + 0.4 * h2.y) : C_YOUNG * 1.2;
    acc += c3 * (L / (TAU * s2)) * exp(-0.5 * d2 / s2);
  }
  return acc;
}

// ---- resolved stars around the camera: 3D DDA through a grid of cells, each holding at most one star.
// Runs after the march; the dust transmittance at the star is interpolated from checkpoints at uResolve * k/4.
const float SCELL = 0.006;
vec3 starField(vec3 ro, vec3 rd, float pa, vec3 T1, vec3 T2, vec3 T3, vec3 T4) {
  vec3 g = ro / SCELL;
  ivec3 cell = ivec3(floor(g));
  ivec3 stp = ivec3(rd.x >= 0.0 ? 1 : -1, rd.y >= 0.0 ? 1 : -1, rd.z >= 0.0 ? 1 : -1);
  vec3 tdel = SCELL / max(abs(rd), vec3(1e-7));
  vec3 fr = g - floor(g);
  vec3 tmax = vec3(rd.x >= 0.0 ? 1.0 - fr.x : fr.x, rd.y >= 0.0 ? 1.0 - fr.y : fr.y, rd.z >= 0.0 ? 1.0 - fr.z : fr.z) * tdel;
  float tc = 0.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 200; i++) {
    if (tc >= uResolve) break;
    vec3 h3 = hash33i(cell + 65536);
    vec4 h = vec4(h3.xy, fract(h3.x * 61.7 + h3.y * 17.3), h3.z);
    if (h.w < 0.75) {
      vec3 sp = (vec3(cell) + 0.15 + 0.7 * h.xyz) * SCELL;
      vec3 v = sp - ro;
      float ts = dot(v, rd);
      float sig = 0.6 * pa * ts;
      float d2 = dot(v, v) - ts * ts;
      if (ts > 0.0 && d2 < 9.0 * sig * sig) {
        vec2 q = TOGAL * sp.xz;
        float dens = bulgeDens(sp) + A_OLD * uDiskAmt * envOldF(length(q)) * sech2(sp.y / hOld(length(q)));
        if (h.w < min(0.5 * dens, 0.8)) {
          vec4 h2 = hash44i(ivec4(cell + 65536, 616));
          float L = 4.5e-7 * (0.015 + 13.0 * pow(h2.x, 12.0));
          float fade = 1.0 - smoothstep(0.55 * uResolve, uResolve, ts);
          float f = clamp(ts / uResolve * 4.0, 0.0, 4.0);
          vec3 Ts = f < 1.0 ? mix(vec3(1.0), T1, f) : f < 2.0 ? mix(T1, T2, f - 1.0) : f < 3.0 ? mix(T2, T3, f - 2.0) : mix(T3, T4, f - 3.0);
          vec3 c = mix(vec3(1.0), bbColor(mix(3400.0, 6000.0, h2.y * h2.y) + 14000.0 * step(0.985, h2.z)), 0.85);
          acc += Ts * c * (L / (TAU * sig * sig)) * exp(-0.5 * d2 / (sig * sig)) * fade;
        }
      }
    }
    if (tmax.x < tmax.y && tmax.x < tmax.z) { tc = tmax.x; tmax.x += tdel.x; cell.x += stp.x; }
    else if (tmax.y < tmax.z) { tc = tmax.y; tmax.y += tdel.y; cell.y += stp.y; }
    else { tc = tmax.z; tmax.z += tdel.z; cell.z += stp.z; }
  }
  return acc * uStarAmt;
}
// fraction of the stellar continuum left unresolved at distance t from the camera
float contAt(float t) { return uResolve > 0.0 ? smoothstep(0.55 * uResolve, uResolve, t) : 1.0; }

// ------------------------------------------------------------------------------------------------ jets
const float JETV = 3.0;   // knot speed (GU per flow second)
float jetR(float ys) { return 0.004 + 0.013 * ys; }

float knotTrain(float ys, float side) {
  const float DTK = 0.14;
  float tau = FLOW - ys / JETV;                   // launch time of the plasma now at height ys
  float wt = min((1.8 * jetR(ys) + 0.02) / JETV, 0.3 * DTK);   // knots are shocks a few jet radii long
  float k0 = floor(tau / DTK);
  float s = 0.0;
  for (int i = -2; i <= 2; i++) {                 // +-2 neighbours: a knot is negligible before it drops out
    float k = k0 + float(i);
    vec4 h = hash44i(ivec4(int(k), int(side + 2.0), 911, 17));
    float tk = (k + 0.5 + 0.8 * (h.x - 0.5)) * DTK;
    float u = (tau - tk) / (wt * (0.4 + 1.2 * h.y));
    s += h.z * h.z * h.z * exp(-u * u);
  }
  return s;
}

// jet emissivity (per GU) at p; the jet along +-y with a slow helical kink, radius jetR(|y|)
vec3 jetEmit(vec3 p, float fpw) {
  float L = uJet;
  float ys = abs(p.y);
  float side = p.y >= 0.0 ? 1.0 : -1.0;
  float A = 0.004 * ys * smoothstep(0.3, 3.0, ys);
  float ph = 1.1 * ys + side * 1.3 - 0.5 * FLOW;
  vec2 q = p.xz - A * vec2(cos(ph), sin(ph));
  float rho2 = dot(q, q);
  float rj = jetR(ys);
  float rje2 = rj * rj + 0.5 * fpw * fpw;
  float x2 = rho2 / rje2;
  if (x2 > 20.0) return vec3(0.0);
  float prof = exp(-x2);
  float halo = exp(-0.15 * x2) * (1.0 - smoothstep(12.0, 20.0, x2)) * 0.035;   // faint luminous sheath (~3 jet radii)
  float kn = knotTrain(ys, side);
  // internal filaments: twisted, advected with the flow, scaled with the jet radius
  float lod = lodOf(fpw / rj, 0.4);
  vec2 qr = rot2(2.5 * ys * side) * q / rj;
  vec4 n = nzl(vec3(qr.x * 0.4, (ys - JETV * FLOW) * 0.9 / (1.0 + 4.0 * rj) + side * 5.0, qr.y * 0.4), lod);
  float fil = mix(smoothstep(0.40, 0.68, n.r), 0.5, smoothstep(1.5, 4.0, lod));
  float spark = 0.0;
  if (lod < 2.5) {
    vec4 n2 = nzl(vec3(qr.x * 1.3 + 0.37, (ys - JETV * FLOW) * 4.0 / (1.0 + 4.0 * rj) - side * 2.0, qr.y * 1.3), lod + 1.7);
    spark = smoothstep(0.62, 0.8, n2.g) * (1.0 - smoothstep(1.0, 2.5, lod));
  }
  float spine = exp(-x2 * 10.0);
  float head = smoothstep(L, L - 0.03 - 0.02 * L, ys);
  float base = smoothstep(0.0, 0.004, ys) * (1.0 + 2.5 * exp(-ys / 0.1));
  float beam = 1.0;
  if (uBeam > 0.0) beam = mix(1.0, pow(1.0 / (1.0 - 0.6 * (-RD.y * side)), 2.5), uBeam);
  float knotI = 0.5 + 3.0 * kn * (0.6 + 0.8 * n.g);
  vec3 c = mix(vec3(0.48, 0.64, 1.0), vec3(0.84, 0.91, 1.0), spine);
  float body = prof * (0.15 + 1.1 * fil * fil + 1.6 * spark) * knotI + 1.0 * spine * (0.6 + 0.6 * knotI) + halo * (0.6 + 0.4 * knotI);
  return c * (0.09 * uJetAmt / (PI * rje2)) * body * head * base * beam;
}

vec3 lobeEmit(vec3 p, vec3 c, vec3 ax, float side, float fpw) {
  vec3 q = (p - c) / ax;                          // unit-ellipsoid coordinates; q.y * side > 0 toward the hotspot
  float lod = lodOf(fpw / ax.x, 0.5);
  vec3 drift = vec3(0.0, -0.025 * side * FLOW, 0.0);            // backflow from the hotspot toward the core
  vec3 qs = (q + drift) * vec3(1.0, 0.6, 1.0);                  // structures stretched along the backflow
  vec4 n1 = nzl(qs * 0.5 + vec3(0.31 * side, 0.2, 0.7), lod);
  vec4 n2 = nzl(qs * 1.5 + vec3(0.7, 0.1 * side, 0.4), lod + 1.6);
  float edge = 1.0 - length(q) + 1.3 * (n1.g - 0.48) + 0.25 * (n2.g - 0.48);
  if (edge < 0.0) return vec3(0.0);
  float shell = smoothstep(0.0, 0.1, edge) * (0.3 + 0.7 * exp(-edge / 0.22));
  float turb = 0.7 + 0.6 * smoothstep(0.38, 0.68, n2.g) + 0.5 * (n1.r - 0.5);
  float fila = smoothstep(0.07, 0.0, n2.a) * smoothstep(0.0, 0.2, edge) * (0.6 + 0.8 * smoothstep(0.3, 0.7, n1.b));
  float u = q.y * side;
  float front = smoothstep(-1.0, 1.0, u);
  vec3 dh = (q - vec3(0.0, 0.78 * side, 0.0)) * vec3(1.0, 0.7, 1.0);
  float hs = exp(-3.0 * dot(dh, dh));
  float dens = shell * turb * (0.3 + 0.7 * front) + 1.3 * fila * (0.4 + 0.6 * front) + 1.6 * hs * shell;
  vec3 col = mix(mix(vec3(0.55, 0.44, 1.0), vec3(0.42, 0.56, 1.0), front), vec3(0.76, 0.85, 1.0), hs);
  return col * dens;
}

// ∫ du / (b² + u²)^(3/2) over [u0, u1]  (point source scattered by a medium of density ∝ 1/s)
float scatCusp(float b, float u0, float u1) {
  float b2 = b * b;
  return (u1 * inversesqrt(b2 + u1 * u1) - u0 * inversesqrt(b2 + u0 * u0)) / b2;
}

// ------------------------------------------------------------------------------------------------ main
void main() {
  COTP = 1.0 / tan(radians(uPitch));
  TOGAL = rot2(-uSpin); TOWORLD = rot2(uSpin);
  SINP = sin(radians(uPitch));
  C_OLD = mix(vec3(1.0), bbColor(5300.0), 0.75);
  C_YOUNG = bbColor(17000.0);
  C_HII = vec3(1.0, 0.30, 0.48);
  C_Q = mix(vec3(1.0), bbColor(14000.0), 0.6);

  vec3 ro = uCamPos, rd = camRay();
  RD = rd;
  float pa = pixelAngle();
  vec4 rnd = pixelRand(gl_FragCoord.xy, uSeed);
  FLOW = uFlow + (pixelRand(gl_FragCoord.xy, uSeed + 0.37).x - 0.5) * uFlowBlur;
  bool res = uResolve > 0.0;
  vec3 TK1 = vec3(1.0), TK2 = vec3(1.0), TK3 = vec3(1.0), TK4 = vec3(1.0);   // transmittance checkpoints

  for (int k = 0; k < NB; k++) {
    G[k] = gaussRay(ro, rd, BS[k], BQ[k]); BC[k] = bbColor(BT[k]) * BA[k] * uBulge;
    GON[k] = G[k].x * BA[k] * uBulge > 2e-5;     // this component contributes along this ray
  }

  float tN = max(-dot(ro, rd), 0.0);              // closest approach to the nucleus
  float bN = length(ro + rd * tN);
  float tPlane = abs(rd.y) > 1e-8 ? -ro.y / rd.y : -1.0;
  float axz = max(length(rd.xz), 1e-3);

  vec3 col = vec3(0.0), T = vec3(1.0), TN = vec3(1.0), TP = vec3(1.0);
  vec2 seg = slabCyl(ro, rd, HS, RMAX);
  bool hit = seg.y > seg.x;
  float tA = hit ? seg.x : 1e8;
  if (res) {
    // continuum near the camera is (partly) resolved into stars: midpoint-integrate the bulge there
    float tr = min(tA, uResolve);
    for (int k = 0; k < NB; k++) {
      if (!GON[k]) continue;
      if (k < NB_DENSE) { col += BC[k] * gaussSeg(G[k], 0.0, tr); continue; }   // dense components stay a glow
      float e0 = erfa(G[k].y * (0.0 - G[k].z));
      for (int i = 1; i <= 6; i++) {                                              // broad ones fade into stars
        float a1 = tr * float(i) / 6.0;
        float e1 = erfa(G[k].y * (a1 - G[k].z));
        col += BC[k] * G[k].x * (e1 - e0) * contAt(a1 - tr / 12.0);
        e0 = e1;
      }
    }
    col += bulgeSeg(tr, tA);
  } else col += bulgeSeg(0.0, tA);
  if (hit) {
    float t = seg.x, kPrev = 0.0;
    float tj = min(t + stepLen(ro + rd * t, rd, t, 0.0) * rnd.x, seg.y);
    col += bulgeSeg(t, tj);
    t = tj;
    float E[NB];
    for (int k = 0; k < NB; k++) E[k] = erfa(G[k].y * (t - G[k].z));
    for (int i = 0; i < MAXS; i++) {
      if (t >= seg.y) break;
      NSTEP += 1.0;
      vec3 p = ro + rd * t;
      float dt = min(stepLen(p, rd, t, kPrev), seg.y - t);
      float tm = t + 0.5 * dt;
      float cont = contAt(tm);
      vec3 em, ex;
      // the footprint includes the in-plane extent of the step: long grazing steps see pre-filtered structure
      diskSample(p + rd * (0.5 * dt), max(tm * pa, 0.08 * dt * axz), cont, em, ex);
      if (ex.g * dt > 1.5) {                       // stepped into dense dust: retake a shorter step
        NRETRY += 1.0;
        dt = 0.9 / ex.g;
        tm = t + 0.5 * dt;
        cont = contAt(tm);
        diskSample(p + rd * (0.5 * dt), max(tm * pa, 0.08 * dt * axz), cont, em, ex);
      }
      vec3 be = vec3(0.0), beD = vec3(0.0);
#ifndef NOBULGESTEP
      for (int k = 0; k < NB; k++) if (GON[k]) {
        float e = erfa(G[k].y * (t + dt - G[k].z));
        vec3 c = BC[k] * G[k].x * (e - E[k]);
        if (k < NB_DENSE) beD += c; else be += c;
        E[k] = e;
      }
#endif
      if (res) {
        float te = t + dt, c1 = 0.25 * uResolve, c2 = 0.5 * uResolve, c3 = 0.75 * uResolve, c4 = uResolve;
        if (c1 >= t && c1 < te) TK1 = T * exp(-ex * (c1 - t));
        if (c2 >= t && c2 < te) TK2 = T * exp(-ex * (c2 - t));
        if (c3 >= t && c3 < te) TK3 = T * exp(-ex * (c3 - t));
        if (c4 >= t && c4 < te) TK4 = T * exp(-ex * (c4 - t));
      }
      vec3 xt = ex * dt, tr = exp(-xt);
      vec3 w = mix(dt * (1.0 - 0.5 * xt), (1.0 - tr) / max(ex, vec3(1e-12)), step(vec3(1e-3), xt));
      col += T * (em * w + (beD + be * cont) * (w / dt));
      if (tN >= t && tN < t + dt) TN = T * exp(-ex * (tN - t));
      if (tPlane >= t && tPlane < t + dt) TP = T * exp(-ex * (tPlane - t));
      T *= tr;
      kPrev = ex.g;
      t += dt;
      if (max(T.r, max(T.g, T.b)) < 0.006) { T = vec3(0.0); break; }
    }
    if (tN >= t) TN = T;
    if (tPlane >= t) TP = T;
    col += T * bulgeSeg(t, 1e8);
    if (res) {
      if (0.25 * uResolve >= t) TK1 = T;
      if (0.5 * uResolve >= t) TK2 = T;
      if (0.75 * uResolve >= t) TK3 = T;
      if (uResolve >= t) TK4 = T;
    }
  }
  vec3 Tdisk = T;
#ifdef DEBUG_STEPS
  emit(vec3(NSTEP / 100.0, NRETRY / 20.0, 0.0)); return;
#endif
  if (res) col += starField(ro, rd, pa, TK1, TK2, TK3, TK4);

  // ---- star-forming knots in the disk plane
  if (tPlane > 0.0 && uHII > 0.0) {
    float fade = smoothstep(0.08, 0.2, abs(rd.y));
    if (fade > 0.0) col += TP * knotLayer(ro, rd, tPlane, pa) * uHII * fade;
  }

  // ---- nucleus: AGN point + quasar light scattered by the circumnuclear medium
  float Lnuc = 0.03 * uGrow * uGrow + 40.0 * uQuasar;
  if (Lnuc > 0.0 && tN > 0.0) {
    float sig = 0.6 * pa;
    float th = bN / tN;
    float F = Lnuc / max(tN * tN, 1e-6);
    float pk = min(F / (TAU * sig * sig), 2.0e4);
    col += TN * C_Q * pk * exp(-0.5 * th * th / (sig * sig));
  }
  if (uQuasar > 0.0) {
    float b = max(bN, 4e-4);
    float u0 = -tN;
    float uP = (tPlane > 0.0) ? tPlane - tN : 1e8;
    float nearI = 0.003 * scatCusp(b, u0, uP) + 0.12 * scatLine(b, 1.0, u0, uP);
    float farI = (tPlane > 0.0) ? 0.003 * scatCusp(b, uP, 1e8) + 0.12 * scatLine(b, 1.0, uP, 1e8) : 0.0;
    col += C_Q * uQuasar * (nearI + Tdisk * farI);
  }

  // ---- jets, hotspots, lobes
  if (uJet > 0.0) {
    float L = uJet;
    float RB = 4.6 * jetR(L) + 0.004 * L + 0.01;
    vec2 js = slabCyl(ro, rd, L + 0.05, RB);
    if (js.y > js.x) {
      float sa = max(length(rd.xz), 0.02), ca = abs(rd.y);
      float t = js.x;
      float dt0 = min(0.35 * jetR(abs(ro.y + rd.y * t)) / sa, (0.02 + 0.01 * t) / max(ca, 1e-3));
      t += dt0 * rnd.y;
      vec3 jc = vec3(0.0);
      for (int i = 0; i < 96; i++) {
        if (t >= js.y) break;
        vec3 p = ro + rd * t;
        float fpw = t * pa;
        float rje = sqrt(sqr(jetR(abs(p.y))) + 0.5 * fpw * fpw);
        float dt = clamp(min(0.4 * rje / sa, (0.02 + 0.012 * t) / max(ca, 1e-3)), 0.0008, 0.5);
        vec3 e = jetEmit(p, fpw) * dt;
        if (tPlane > 0.0 && t > tPlane) e *= Tdisk;
        jc += e;
        t += dt;
      }
      col += jc;
    }
    // hotspots (analytic Gaussians)
    for (int s = 0; s < 2; s++) {
      float side = s == 0 ? 1.0 : -1.0;
      vec3 c = vec3(0.0, side * L, 0.0);
      float rh = 0.011 + 0.0095 * L;                              // a soft glow, never a hard ball
      vec3 g = gaussRay(ro - c, rd, rh, 1.6);                     // compact, elongated along the jet
      float Fh = 0.15 * uJetAmt * smoothstep(0.0, 0.3, L) * (0.15 + 0.85 * smoothstep(1.5, 6.0, L)) / (5.568 * 1.6 * rh * rh * rh);
      float tc = dot(c - ro, rd);
      vec3 cc = vec3(0.8, 0.88, 1.0) * Fh * g.x * (erfa(g.y * (1e8 - g.z)) - erfa(g.y * (0.0 - g.z)));
      vec3 cb = vec3(0.0, side * (L + 1.6 * rh), 0.0);              // bow shock: a flattened glow just ahead
      vec3 gb = gaussRay(ro - cb, rd, 2.4 * rh, 0.5);
      cc += vec3(0.62, 0.72, 1.0) * (0.06 * Fh / (2.4 * 2.4 * 2.4 * 0.5)) * gb.x * (erfa(gb.y * (1e8 - gb.z)) - erfa(gb.y * (0.0 - gb.z)));
      if (tPlane > 0.0 && tc > tPlane) cc *= Tdisk;
      col += cc;
    }
    // radio lobes: cocoons inflated by the backflow from the hotspots
    float lobeOn = uLobe * smoothstep(0.8, 2.5, L);
    if (lobeOn > 0.0) {
      for (int s = 0; s < 2; s++) {
        float side = s == 0 ? 1.0 : -1.0;
        float la = L * (0.1 + 0.22 * smoothstep(1.0, 8.0, L));
        vec3 ax = vec3(0.5 * la, la, 0.5 * la);
        vec3 c = vec3(0.0, side * (L - 0.78 * ax.y), 0.0);
        vec2 ls = ellRay(ro, rd, c, ax * 1.35);
        if (ls.y <= ls.x) continue;
        float dt = (ls.y - ls.x) / 28.0;
        float t = ls.x + dt * (s == 0 ? rnd.z : rnd.w);
        vec3 lc = vec3(0.0);
        for (int i = 0; i < 28; i++) {
          if (t >= ls.y) break;
          vec3 p = ro + rd * t;
          vec3 e = lobeEmit(p, c, ax, side, t * pa) * dt;
          if (tPlane > 0.0 && t > tPlane) e *= Tdisk;
          lc += e;
          t += dt;
        }
        col += lc * (0.8 / ax.x) * lobeOn * uJetAmt;
      }
    }
  }

  // ---- intergalactic sky
  if (uSkyAmt > 0.0 && max(T.r, max(T.g, T.b)) > 0.002) col += T * sky(rd, pa) * uSkyAmt;
  emit(min(col, vec3(3.0e4)));
}
