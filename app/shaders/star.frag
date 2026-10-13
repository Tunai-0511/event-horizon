// THE GIANT — Act II: the life of a massive star, computed from math. Everything reads as light, plasma and gas:
//   photosphere   blinding self-luminous plasma (star_lib.glsl): soft convective upflow blobs sheared by a drifting
//                 flow, Eddington–Barbier limb darkening + reddening; the edge melts into a glowing limb (no crisp
//                 silhouette); flare ribbons under an eruption
//   chromosphere  analytic H-alpha fringe + soft spicule forest at the limb
//   prominences   magnetic loops = soft glowing plasma arcs along elliptical field lines (kinked, clumpy, frayed),
//                 ray-marched with jittered start; threads evaluated in a ray-perpendicular frame (noise-free); the
//                 hero loop erupts (uEruption) into a twisting, ballooning rope with a faint CME front
//   corona/wind   equiangular-sampled optically thin emission: K corona with helmet streamers, extended wind halo;
//                 red supergiant: a glowing molecular envelope that reddens and darkens the limb
//   shells        clumpy expanding dusty mass-loss shells (analytic Gaussian-shell columns, forward scattering)
//   interior      (uInside, or whenever the camera is inside the star) the star turns to translucent glowing gas:
//                 nested luminous fusion shells (H, He, C, Ne, O, Si burning fronts) as turbulent emissive sheets with
//                 soft glowing halos, warm convective gas between them, and the inert iron core as a dim, dense, dark
//                 absorbing volume at the centre (uIron grows it). uCollapse: the core shrinks to a blinding point
//                 while the layers rush inward.
// Units: body frame with photosphere radius 1 (uRadius scales it into the world). The star sits at the world origin.
#include "common.glsl"
#include "sky.glsl"
#include "star_lib.glsl"

// ---- star ----
uniform float uRadius;      // photosphere radius in world units
uniform float uTemp;        // effective temperature (K)
uniform float uAge;         // 0 blue supergiant .. 1 red supergiant: style blend (plumes, limb, atmosphere)
uniform float uSurf;        // surface brightness scale (HDR)
uniform float uLumK;        // 1: surface brightness follows the blackbody exactly; 0: normalised (same at every T)
uniform float uCells;       // convection cells per radian
uniform float uGranC;       // convection contrast
uniform float uBoil;        // convection clock rate (x uTime) — keep constant within a shot
uniform float uSpin;        // rotation of the body about +y (rad)
uniform float uLimbH;       // soft-limb glow scale height (fraction of R)
uniform float uLumpy;       // irregularity of the limb glow / molecular envelope (0..1)
uniform float uActivity;    // faculae
// ---- atmosphere ----
uniform float uChromo;      // chromosphere + spicules
uniform float uChromoH;     // chromosphere thickness (fraction of R)
uniform float uCorona;      // K corona
uniform float uStreamers;   // streamer contrast 0..1
uniform float uWind;        // extended halo / wind
uniform float uMol;         // red-supergiant molecular envelope
// ---- prominences ----
uniform float uProm;        // overall amount
uniform vec3 uHero;         // body-frame direction of the hero loop's apex
uniform vec3 uHeroChord;    // chord direction of the hero loop (footpoint to footpoint)
uniform float uHeroH;       // hero apex height (fraction of R)
uniform float uHeroSpan;    // hero footpoint half-span (radians of arc)
uniform float uEruption;    // 0..1 hero loop eruption
// ---- mass-loss shells ----
uniform float uShells;      // amount
uniform float uShellPhase;  // expansion phase (+1 = one shell spacing outward)
// ---- pulsation ----
uniform float uPulse;       // amplitude 0..1
uniform float uPulsePhase;  // radians
// ---- interior ----
uniform float uInside;      // 0 opaque star .. 1 translucent: the luminous interior is seen (forced 1 inside the star)
uniform float uIron;        // iron core growth 0..1
uniform float uCollapse;    // core collapse 0..1
uniform float uInterior;    // interior brightness scale
uniform float uSkyAmt;

const vec3 HALPHA = vec3(1.0, 0.16, 0.26);   // Balmer emission (H-alpha dominated) in linear sRGB

// ---- per-pixel globals ----
float gRph;     // photosphere radius (body units, pulsation)
float gT;       // effective temperature incl. pulsation
float gSurfK;   // surface radiance scale
float gRsg;     // red-supergiant style
vec4 gRnd;
vec3 gStarCol;  // radiance of the disk centre (for scattered light)
float gDisk;    // its luminance
float gClk;     // convection clock

float pow2s(float x) { return x * x; }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
vec3 anyPerp(vec3 n) { return normalize(cross(n, abs(n.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))); }
float erfA(float x) {   // Abramowitz–Stegun 7.1.26, |error| < 1.5e-7
  float a = abs(x), t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return x < 0.0 ? -y : y;
}

// =================================================================================================
// photosphere edge: radiance of the disk at mu -> 0 (limb-darkened, reddened), gently varying along the limb
vec3 edgeRadiance(vec3 d) {
  float ld0 = 1.0 - mix(0.55, 0.5, gRsg) - mix(0.15, 0.2, gRsg);
  float v = nzl(d * 3.0 + vec3(0.3, 0.7, 0.1) + gClk * 0.0015, 0.0).r;
  return blackbody(starTmu(gT, 0.0)) * 1.2 * ld0 * gSurfK * (0.8 + 0.4 * v);
}

// =================================================================================================
// prominences. Loop i: apex direction m, chord a, footpoint half-span beta, apex height H above the surface,
// horizontal semi-axis A (>= footpoint half-width; > makes the arch balloon), tube radius w, brightness, twist.
struct Loop { vec3 m; vec3 a; float beta; float H; float A; float w; float br; float tw; float sd; float lift; float leg; float wob; float asym; };

Loop getLoop(int i) {
  Loop L;
  vec4 h = hash44i(ivec4(i, 7, 3, 1931));
  vec4 h2 = hash44i(ivec4(i, 11, 5, 2741));
  vec3 hm = normalize(uHero);
  vec3 ha = normalize(uHeroChord - hm * dot(uHeroChord, hm));
  vec3 hn = cross(hm, ha);
  L.sd = h.w * 17.0;
  L.lift = 0.0; L.leg = 1.0; L.asym = 0.0;
  if (i == 0) {
    // eruption: slow activation (e < 0.25), then the flux rope accelerates outward and balloons into a bubble;
    // at the very end it detaches from the surface and its legs drain away
    float e = uEruption;
    float e1 = sat(e / 0.25), e2 = sat((e - 0.25) / 0.75);
    float e2p = e2 * sqrt(e2);
    float wr = 0.45 * e2 * e2;   // writhe: the rising rope rotates about its axis
    L.m = hm;
    L.a = normalize(ha * cos(wr) + hn * sin(wr));
    L.beta = uHeroSpan;
    L.H = uHeroH * (1.0 + 0.6 * e1) + 1.1 * e2p * e2;
    L.A = sin(uHeroSpan) * (1.0 + 0.3 * e1 + 4.5 * e2p);
    L.w = 0.016 * (1.0 + 0.4 * e1 + 3.6 * e2);
    L.br = (1.0 + 1.0 * e1) * (1.0 + 2.2 * e2) / (1.0 + 0.5 * e2 * e2);
    L.tw = 2.5 + 8.0 * e;
    float lo = sat((e - 0.7) / 0.3);
    L.lift = 0.35 * lo * lo;
    L.leg = 1.0 - 0.85 * smoothstep(0.75, 1.0, e);
    // the rising rope kinks and frays; one leg tears loose before the other
    L.wob = L.H * (0.12 + 0.3 * e2);
    L.asym = smoothstep(0.45, 0.85, e);
  } else if (i < 4) {
    // post-flare arcade beside the hero, rotated so its loops are seen obliquely
    float k = float(i) - 2.0;
    float rotA = 0.65;
    vec3 aa = normalize(ha * cos(rotA) + hn * sin(rotA));
    vec3 an = cross(hm, aa);
    vec3 c0 = normalize(hm - ha * 0.2 + hn * 0.03);
    L.m = normalize(c0 + an * 0.03 * k);
    L.a = normalize(aa - L.m * dot(aa, L.m));
    L.beta = 0.045 + 0.01 * h.x;
    L.H = 0.05 + 0.015 * h.y;
    L.A = sin(L.beta);
    L.w = 0.005 + 0.0015 * h.z;
    L.br = 0.8 + 0.5 * h2.x;
    L.tw = 1.0 + 2.0 * h2.y;
    L.wob = L.H * 0.1;
  } else {
    // scattered active regions around the star (low latitudes)
    float z = (2.0 * h.x - 1.0) * 0.75;
    float ph = TAU * h.y;
    L.m = vec3(sqrt(1.0 - z * z) * cos(ph), z, sqrt(1.0 - z * z) * sin(ph));
    vec3 t1 = anyPerp(L.m), t2 = cross(L.m, t1);
    float ps = TAU * h.z;
    L.a = t1 * cos(ps) + t2 * sin(ps);
    L.beta = 0.035 + 0.09 * h2.x;
    L.H = L.beta * (0.6 + 1.2 * h2.y);
    L.A = sin(L.beta) * (1.0 + 0.4 * h2.w * h2.w);
    L.w = 0.006 + 0.007 * h2.z;
    L.br = 0.6 + 0.6 * h2.w;
    L.tw = 1.0 + 4.0 * h.w;
    L.wob = L.H * 0.3;
  }
  return L;
}

// Arch geometry in the loop plane (x along a, y along m): an ellipse through the footpoints (+-W, y0) and the apex
// (0, y0 + Hh) with horizontal semi-axis A; centre at height yc above the footpoint baseline (yc > 0 when A > W).
struct Arch { float W; float y0; float Hh; float A; float B; float yc; float thf; };
Arch archFrame(Loop L) {
  Arch g;
  float Rb = gRph;
  g.W = Rb * sin(L.beta);
  g.y0 = Rb * cos(L.beta) + L.lift;
  g.Hh = Rb + L.H + L.lift - g.y0;
  g.A = max(L.A, g.W);
  float q = sqrt(max(1.0 - g.W * g.W / (g.A * g.A), 0.0));
  g.B = g.Hh / (1.0 + q);
  g.yc = g.Hh - g.B;
  g.thf = asin(clamp(g.yc / g.B, 0.0, 0.999));
  return g;
}
// smooth displacement field (~[-0.5, 0.5]^3) that kinks and frays the arches
vec3 loopWobble(vec3 p, float f, float sd) {
  vec3 q = p * f * 0.25 + sd * 0.11;
  return nzl(q, 0.0).rbg - vec3(0.5, 0.5, 0.55);
}
// approximate distance to the arch; phi = 0 at the apex, +-(pi/2 + thf) at the footpoints
float archDist(Loop L, Arch g, vec3 pn, vec3 p, out float phi, out float sd, out float dp) {
  dp = dot(p, pn);
  float x = dot(p, L.a), y = dot(p, L.m) - g.y0 - g.yc;
  float k = g.A / g.B;
  float yk = y * k;
  float len = sqrt(x * x + yk * yk);
  float gr = sqrt(x * x + yk * yk * k * k) / max(len, 1e-6);
  sd = (len - g.A) / max(gr, 0.25);
  phi = atan(x, yk);                     // 0 at the apex, positive toward +a
  return sqrt(sd * sd + dp * dp);
}

// accumulate emission (rgb) and transmittance (a) of all loops along [0, tmax]
vec4 prominences(vec3 ro, vec3 rd, float tmax, float pa) {
  vec3 E = vec3(0.0);
  float tr = 1.0;
  if (uProm <= 0.0) return vec4(E, tr);
  for (int i = 0; i < 10; i++) {
    Loop L = getLoop(i);
    Arch g = archFrame(L);
    vec3 pn = cross(L.m, L.a);
    vec3 bc = L.m * (g.y0 + g.Hh * 0.5);
    float bR = sqrt(g.A * g.A + g.Hh * g.Hh * 0.25) + L.w * 5.0 + L.wob * 0.6;
    vec2 tb = starSphere(ro - bc, rd, bR);
    if (tb.y <= 0.0) continue;
    float t0 = max(tb.x, 0.0), t1 = min(tb.y, tmax);
    if (t1 <= t0) continue;
    float wmax = L.w * 1.5;
    float stepIn = L.w * 0.5;
    float t = t0;
    bool jit = false;
    float smax = 0.5 * PI + g.thf;
    float wobF = 1.6 / max(g.Hh, 0.05);
    for (int k = 0; k < 80; k++) {
      if (t >= t1) break;
      vec3 p = ro + rd * t;
      float phi, sd, dp;
      float d = archDist(L, g, pn, p + loopWobble(p, wobF, L.sd) * L.wob, phi, sd, dp);
      if (d > 2.6 * wmax) { t += max((d - 2.3 * wmax) * 0.65, stepIn); jit = false; continue; }
      if (!jit) { jit = true; t += stepIn * gRnd.y; if (t >= t1) break; p = ro + rd * t; d = archDist(L, g, pn, p + loopWobble(p, wobF, L.sd) * L.wob, phi, sd, dp); }
      float s = phi / smax;                  // -1..1 between the footpoints
      float as = abs(s);
      // thickness varies along the arch; legs are fatter
      vec4 alongN = nzl(vec3(phi * 0.25 + L.sd, 0.3, 0.6), 0.0);   // b: thickness, r: fragmentation
      float wv = L.w * (0.7 + 0.6 * alongN.b) * (1.0 + 0.5 * smoothstep(0.5, 1.0, as));
      // field-aligned threads. The pattern lives on (position along the arch, offset across the tube measured
      // perpendicular to both the tube and the ray), so it is constant along each ray inside the tube: the
      // integral is smooth (no sampling noise) and the strands read as fine glowing hair along the field.
      vec3 Tt = normalize(L.a * (g.A * cos(phi)) - L.m * (g.B * sin(phi)));
      vec3 nOut = normalize(L.a * (g.B * sin(phi)) + L.m * (g.A * cos(phi)));
      vec3 e1 = cross(Tt, rd);
      e1 *= inversesqrt(max(dot(e1, e1), 1e-6));
      float ut = (sd * dot(nOut, e1) + dp * dot(pn, e1)) / wv;
      float lod = max(0.0, log2(t * pa / wv * 0.45 * 128.0 + 1e-6) - 0.5);
      vec3 tq = vec3(phi * 0.13 + L.sd, ut * 0.6 + L.tw * s * 0.05, L.sd * 0.37);
      vec4 nn = nzl(tq, lod);
      float r2 = nzl(tq * vec3(1.7, 2.3, 1.0) + vec3(0.31, 0.17, 0.5), lod + 1.0).r;
      float ridge = 1.0 - abs(2.0 * nn.r - 1.0);
      float ridge2 = 1.0 - abs(2.0 * r2 - 1.0);
      float threads = (ridge * ridge * ridge * 0.75 + ridge2 * ridge2 * ridge2 * 0.5) * (0.5 + 0.9 * nn.b);
      // soft, frayed cross-section: the edge of the tube is ragged and the profile wide
      float rr = d / wv * (0.8 + 0.45 * nn.g);
      float prof = exp(-rr * rr * 0.75);
      float halo = exp(-rr * rr * 0.22);
      // knots drifting down the legs (coronal rain); clumps and gaps along the arch
      float fl = nzl(vec3(abs(phi) * 1.2 - uTime * 0.08 + L.sd, rr * 0.15, L.sd * 0.7), lod).g;
      float frag = smoothstep(0.3, 0.65, alongN.r);
      frag = i == 0 ? 0.2 + 0.8 * frag : 0.08 + 0.92 * frag * frag;
      float legs = 0.6 + 0.7 * smoothstep(0.4, 0.95, as);
      float base = smoothstep(1.1, 0.97, as) * mix(1.0, smoothstep(0.9, 0.55, as), 1.0 - L.leg);
      base *= 1.0 - L.asym * smoothstep(0.15, 0.75, s);   // one leg tears loose first
      float dens = (prof * (0.45 + 0.9 * threads) * (0.5 + 1.2 * fl * fl) * frag + 0.12 * halo) * legs * base;
      float dt = stepIn;
      vec3 em = mix(HALPHA, vec3(1.0, 0.6, 0.66), 0.3 * threads * prof) * L.br * dens / wv;
      E += tr * em * dt * uProm * gDisk * 0.3;
      // photospheric light scattered by the prominence plasma: strongest on the arch's inner side, which faces
      // the surface (dilution factor W(r) of a uniform disk)
      float rp = length(p) / gRph;
      float W = 0.5 * (1.0 - sqrt(max(1.0 - 1.0 / (rp * rp), 0.0)));
      float under = smoothstep(0.4, -1.3, sd / wv);
      E += tr * gStarCol * (dens / wv) * dt * W * (0.15 + 0.85 * under) * uProm * 0.1;
      tr *= exp(-prof * dens * dt * 1.2 / wv * uProm);
      t += dt;
      if (tr < 0.01) break;
    }
  }
  return vec4(E, tr);
}

// faint, limb-brightened shell of swept-up coronal plasma ahead of the erupting rope (Thomson-scattered light)
vec3 cmeFront(vec3 ro, vec3 rd, float tmax) {
  float e = sat((uEruption - 0.35) / 0.65);
  if (e <= 0.0 || uProm <= 0.0) return vec3(0.0);
  vec3 m = normalize(uHero);
  float e2c = sat((uEruption - 0.25) / 0.75);
  float Hap = uHeroH * 1.6 + 1.1 * e2c * e2c * sqrt(e2c);
  float Rc = 0.3 + 0.62 * Hap;
  vec3 cc = m * (gRph + Hap * 0.8);
  float wc = 0.03 + 0.04 * e;
  vec3 o = ro - cc;
  float tc = -dot(o, rd);
  float b = length(o + rd * tc);
  if (b > Rc + 3.0 * wc) return vec3(0.0);
  vec3 E = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float hh = sqrt(max(Rc * Rc - b * b, 0.0));
    float t = k == 0 ? tc - hh : tc + hh;
    if (t < 0.0 || t > tmax) continue;
    vec3 p = ro + rd * t;
    vec3 dn = normalize(p - cc);
    float front = smoothstep(0.1, 0.7, dot(dn, m));
    float colm = wc * Rc / max(hh, sqrt(2.0 * Rc * wc)) * exp(-pow2s(max(b - Rc, 0.0) / wc));
    float n = nzl(dn * 3.0 + 0.3, 0.0).g;
    E += gStarCol * 0.02 * colm * front * (0.3 + 1.4 * n * n) * (1.0 - e * 0.6) * smoothstep(0.0, 0.2, e);
  }
  return E * uProm;
}

// flare ribbons on the surface under the erupting loop
float flareRibbons(vec3 n) {
  float e = uEruption;
  float amt = smoothstep(0.15, 0.32, e) * (1.0 - 0.75 * smoothstep(0.45, 1.0, e));
  if (amt <= 0.0) return 0.0;
  vec3 hm = normalize(uHero);
  vec3 ha = normalize(uHeroChord - hm * dot(uHeroChord, hm));
  vec3 hn = cross(hm, ha);
  if (dot(n, hm) < 0.9) return 0.0;
  float x = dot(n, ha), y = dot(n, hn);
  float sep = sin(uHeroSpan) * (0.35 + 0.45 * smoothstep(0.15, 1.0, e));
  float wig = (nzl(vec3(y * 14.0, 0.3, 0.7), 0.0).r - 0.5) * 0.02;
  float r1 = exp(-pow2s((x - sep + wig) / 0.008));
  float r2 = exp(-pow2s((x + sep - wig) / 0.008));
  float len = smoothstep(0.09, 0.03, abs(y));
  return amt * (r1 + r2) * len;
}

// =================================================================================================
// chromosphere + spicules: analytic, noise-free (Chapman grazing column of exponential layers; the spicule pattern is
// indexed by the position along the limb, so the jets stay put on screen). Off-limb only.
vec3 chromosphere(vec3 ro, vec3 rd, float pa) {
  if (uChromo <= 0.0) return vec3(0.0);
  float tc = -dot(ro, rd);
  if (tc <= 0.0) return vec3(0.0);
  vec3 pc = ro + rd * tc;
  float b = length(pc);
  float R = gRph;
  float H0 = uChromoH * R;
  float H = max(H0, 2.5 * tc * pa);                  // seen from afar the fringe widens into a soft glow
  float flux = H0 / H;
  float hgt = b - R;
  if (hgt > 8.0 * H) return vec3(0.0);
  float edge = smoothstep(-1.5 * tc * pa, 0.0, hgt);
  if (edge <= 0.0) return vec3(0.0);
  vec3 ax = normalize(ro);
  vec3 dc = pc - ax * dot(pc, ax);
  dc *= inversesqrt(max(dot(dc, dc), 1e-8));
  vec3 tg = cross(ax, dc);
  float h = max(hgt, 0.0) / H;
  float Hb = 0.35 * H, Hs = 1.6 * H;
  float colB = exp(-h / 0.35) * sqrt(TAU * b * Hb);
  float K = 90.0;
  float lod = max(0.0, log2(tc * pa / R * K * 128.0 / 4.0 + 1e-6));
  float s1 = nzl(dc * K + tg * h * 0.08, lod).r;
  float s2 = nzl(dc * K * 1.7 - tg * h * 0.12 + 3.7, lod + 0.5).r;
  float top1 = 0.8 + 2.6 * nzl(dc * K * 0.21 + 0.5, lod).b;
  float top2 = 0.5 + 1.8 * nzl(dc * K * 0.33 + 1.5, lod).b;
  float j1 = smoothstep(0.35, 0.85, s1) * smoothstep(top1 * 1.2, top1 * 0.2, h);
  float j2 = smoothstep(0.4, 0.88, s2) * smoothstep(top2 * 1.2, top2 * 0.2, h);
  float colS = exp(-h / 1.6) * sqrt(TAU * b * Hs) * (0.6 * j1 + 0.4 * j2);
  return HALPHA * (0.8 * colB + 0.7 * colS) / H * edge * uChromo * gDisk * 0.03 * flux;
}

// =================================================================================================
// Column of an exponential layer (scale height H) on a sphere of radius R along a ray with impact parameter b,
// in units of H: near half only when the ray hits the sphere (b < R), both halves when it passes above it.
float layerColumn(float b, float R, float H) {
  if (b < R) return R / sqrt(R * R - b * b + 2.0 * R * H);
  return 2.0 * R / sqrt(2.0 * R * H) * exp(-(b - R) / H);
}

// red supergiant molecular envelope (TiO-like): a lumpy exponential layer of warm gas that glows dull red and absorbs
// blue/green more than red; analytic column (no sampling noise). Returns emission; trc = transmittance.
vec3 molEnvelope(vec3 ro, vec3 rd, float through, out vec3 trc) {
  trc = vec3(1.0);
  if (uMol <= 0.0) return vec3(0.0);
  float tc = -dot(ro, rd);
  vec3 pc = ro + rd * tc;
  float b = length(pc);
  float R = gRph;
  if (tc < 0.0 && b >= R) return vec3(0.0);
  // where the ray meets the layer: the entry point on the disk, or the grazing point above the limb
  vec3 dc = b < R ? normalize(ro + rd * (tc - sqrt(R * R - b * b))) : pc / max(b, 1e-5);
  // lumpy scale height and density
  float lump = nzl(dc * 1.6 + 0.2 + vec3(0.0, gClk * 0.002, 0.0), 0.0).g;
  float H = (0.14 + 0.1 * uLumpy * lump) * R;
  float C = layerColumn(b, R, H) * H;                 // physical column (near half on the disk)
  float md = C * uMol * (0.35 + 1.3 * lump);
  trc = exp(-md * 0.5 * vec3(0.9, 2.0, 2.7));
  // emission: on the disk the far half is hidden by the photosphere; let that occlusion fade in over ~H from the
  // limb so the envelope's glow is continuous across the edge (no dark outline at the silhouette)
  float far = b < R ? exp(-(R - b) / H) : 0.0;
  return bbColor(2500.0) * gDisk * 0.16 * md * (1.0 + far);
}

// optically thin corona and wind halo: a thin transition layer (analytic) + the K corona with helmet streamers and
// the wind (broad, equiangular sampling about the centre)
vec3 atmosphere(vec3 ro, vec3 rd, float tmax, float pa) {
  vec3 E = vec3(0.0);
  if (uCorona <= 0.0 && uWind <= 0.0) return E;
  float tc = -dot(ro, rd);
  float b = length(ro + rd * tc);
  const float ROUT = 14.0;
  if (b > ROUT) return E;
  float hs = sqrt(ROUT * ROUT - b * b);
  float t0 = max(0.0, tc - hs), t1 = min(tmax, tc + hs);
  if (t1 <= t0) return E;
  // streamer pattern, evaluated at the point of closest approach (radial structures by construction)
  float helm = 0.5, fine = 0.5, fine2 = 0.5;
  vec3 dc;
  {
    vec3 pc = ro + rd * clamp(tc, t0, t1);
    float rc = max(length(pc), 1e-3);
    dc = pc / rc;
    float lodc = max(0.0, log2(clamp(tc, t0, t1) * pa * 128.0 * 0.6 / max(rc, 0.5) + 1e-6));
    if (uStreamers > 0.0) {
      helm = nzl(dc * 0.55 + vec3(0.3, 0.1, 0.7), lodc).r;
      fine = nzl(dc * 3.1 + vec3(0.7, 0.2, 0.4), lodc).b;
    }
    fine2 = nzl(dc * 11.0 + vec3(0.17, 0.62, 0.33), lodc + 1.0).r;
  }
  vec3 cor = gStarCol;
  // transition layer hugging the limb (analytic column)
  if (tc > 0.0 || b < gRph) {
    float Hl = 0.04 * gRph;
    E += cor * uCorona * 0.6 * (0.8 + 0.25 * fine2) * layerColumn(b, gRph, Hl) * Hl * 0.25;
  }
  float bb = max(b, 0.03);
  float th0 = atan((t0 - tc) / bb), th1 = atan((t1 - tc) / bb);
  const int N = 16;
  float dth = (th1 - th0) / float(N);
  for (int i = 0; i < N; i++) {
    float th = th0 + (float(i) + gRnd.z) * dth;
    float ct = cos(th);
    float t = tc + bb * tan(th);
    float ds = bb / (ct * ct) * dth;
    vec3 p = ro + rd * t;
    float r = length(p);
    if (r < gRph) continue;                  // inside the star: no corona there
    float rr = r / gRph;
    float ir = 1.0 / rr;
    float ir2 = ir * ir, ir4 = ir2 * ir2;
    float thr = mix(0.46, 0.6, smoothstep(1.0, 3.5, rr));
    float st = smoothstep(thr - 0.1, thr + 0.1, helm);
    float S = mix(1.0, (0.2 + 1.7 * st) * (0.75 + 0.5 * fine * fine) * (0.9 + 0.2 * fine2), uStreamers);
    float kcor = ir4 * ir2 * 0.12 * S;
    float dens = uCorona * kcor + uWind * ir2 * sqrt(ir) * (0.5 + 0.5 * S) * 0.022;
    E += cor * dens * ds * 0.25;
  }
  return E;
}

// =================================================================================================
// dusty mass-loss shells: expanding clumpy Gaussian shells, analytic column at each crossing, forward scattering
vec3 dustShells(vec3 ro, vec3 rd, float tmax, float pa, out vec3 trc) {
  vec3 E = vec3(0.0);
  vec3 tr = vec3(1.0);
  trc = tr;
  if (uShells <= 0.0) return E;
  float tc = -dot(ro, rd);
  float b = length(ro + rd * tc);
  const int NS = 5;
  const float SP = 0.8;
  float ph = uShellPhase;
  float fl = floor(ph);
  vec3 V = -rd;
  for (int j = 0; j < NS; j++) {
    float id = fl - float(j);
    float age = ph - id;                       // j .. j+1
    float rs = gRph * (1.2 + age * SP);
    float w = gRph * (0.1 + 0.06 * age);
    if (b > rs + 2.5 * w) continue;
    // fade in as a shell leaves the star, fade out before it drops off the list (keeps uShellPhase continuous)
    float amp = smoothstep(0.0, 0.5, age) * exp(-age * 0.35) * (1.0 - smoothstep(float(NS) - 1.0, float(NS), age));
    vec4 hh = hash44i(ivec4(int(id) + 1000, 3, 77, 5));
    float hs = sqrt(max(rs * rs - b * b, 0.0));
    float L = 1.7725 * w * rs / max(hs, 0.4 * rs);   // limb brightening capped at 2.5x
    for (int k = 0; k < 2; k++) {
      float t = k == 0 ? tc - hs : tc + hs;
      if (t < 0.0 || t > tmax) continue;
      vec3 p = ro + rd * t;
      float r = length(p);
      vec3 d = p / r;
      float radial = exp(-pow2s((r - rs) / w));
      if (radial < 0.01) continue;
      float lod = max(0.0, log2(t * pa * 128.0 * 0.9 / gRph + 1e-6));
      vec3 q = p / gRph * 0.8 + hh.xyz * 7.0;
      vec4 n1 = nzl(q, lod);
      float cl2 = nzl(q * 2.9 + 0.37, lod + 1.0).g;
      float fil = 1.0 - smoothstep(0.0, 0.25, n1.a);
      float arcs = smoothstep(0.36, 0.6, nzl(d * 0.45 + hh.zyx * 3.0, 0.0).r);
      float clump = smoothstep(0.5, 0.86, n1.g * 0.75 + cl2 * 0.45);
      float dens = radial * (clump * (0.6 + 0.8 * clump) + 0.15 * fil * smoothstep(0.3, 0.6, n1.g)) * (0.1 + 0.9 * arcs) * amp;
      float colm = dens * L * uShells;
      float cs = dot(d, V);
      const float g = 0.6;
      float hg = (1.0 - g * g) / (4.0 * PI * pow(max(1.0 + g * g - 2.0 * g * cs, 1e-4), 1.5));
      float phase = 0.6 * hg + 0.4 / (4.0 * PI);
      float illum = gRph * gRph / (r * r);
      E += tr * gStarCol * colm * phase * illum * 22.0;
      tr *= exp(-colm * 0.9 * vec3(0.75, 1.0, 1.3));
    }
  }
  trc = tr;
  return E;
}

// =================================================================================================
// interior: nested luminous fusion shells. Index 0 = the photosphere (a translucent glowing sheet), 1..6 = the
// burning fronts at the base of the H, He, C, Ne, O, Si layers. Display temperatures map the real ordering
// (cooler outside -> hotter inside) onto visible blackbody colours (the real 1e7..4e9 K would all be the same white).
const float SH_T[7] = float[7](3500.0, 2000.0, 2500.0, 3100.0, 3900.0, 5000.0, 6800.0);
const float SH_B[7] = float[7](0.6, 0.8, 1.2, 2.0, 3.5, 6.0, 14.0);      // edge-on (rim) radiance of each shell
const float SH_W[7] = float[7](0.03, 0.006, 0.0055, 0.005, 0.0045, 0.004, 0.006);   // Gaussian thickness of each shell
const float SH_L[7] = float[7](0.035, 0.035, 0.03, 0.027, 0.024, 0.02, 0.012);   // soft glow skirt above each shell
const float SH_A[7] = float[7](0.01, 0.028, 0.024, 0.021, 0.019, 0.016, 0.012);  // turbulent wander of each shell
const float SH_FALL[7] = float[7](0.0, 0.05, 0.1, 0.16, 0.24, 0.34, 0.5);       // how far each falls at collapse
const float SIG_IN = 0.45;      // mean extinction of the interior gas (per unit radius): far layers dim, depth reads
float gSR[7];   // shell radii (collapse applied); [0] = photosphere
float gFe;      // iron core radius
float gFeTau;   // its central optical depth

void setupInterior() {
  float c = uCollapse, fall = c * c;
  float fe0 = mix(0.04, 0.1, uIron);
  float R0[7] = float[7](1.0, 0.62, 0.49, 0.385, 0.3, 0.23, fe0 * 1.45 + 0.03);
  for (int k = 0; k < 7; k++) gSR[k] = R0[k] * (1.0 - SH_FALL[k] * fall);
  gSR[0] = gRph;
  gFe = fe0 * (1.0 - c) * (1.0 - c) * (1.0 - 0.5 * c) + 0.002 * c;
  gFeTau = 9.0;
}

// transmittance of the iron core from the camera to distance t along the ray (Gaussian density blob)
float coreTrans(float t, float tc, float b) {
  float tau = gFeTau * exp(-b * b / (gFe * gFe));
  return exp(-tau * 0.5 * (1.0 + erfA((t - tc) / gFe)));
}

// plasma brightness on a shell (direction d): a few large soft bright patches over a fainter veil, slowly churning
float shellTex(vec3 d, int k, float lod) {
  vec4 wn = nzl(d * 0.7 + float(k) * 0.71 + vec3(0.0, gClk * 0.002, 0.0), 0.0);
  vec3 w = wn.rbg - vec3(0.5, 0.5, 0.55);
  float big = wn.g;                                           // billows: large soft patches (no cell walls)
  float inflow = uCollapse * uCollapse * 1.5;                 // streaming inward during the collapse
  vec3 q = (d * (0.9 + 0.25 * float(k)) + w * 0.8 + float(k) * 3.7) * 0.5 + vec3(0.0, 0.0, inflow);
  float bl = nzl(q, lod + 1.5).g;
  return (0.3 + 1.3 * bl * bl) * (0.45 + 1.1 * big) * (k == 6 ? 0.6 : 1.0);
}
// turbulent radius offset of shell k in direction d (smooth)
float shellTurb(vec3 d, int k) {
  vec3 q = d * (1.4 + 0.35 * float(k)) + float(k) * 1.37 + vec3(gClk * 0.0025, 0.0, 0.0);
  float n = nzl(q, 0.0).r - 0.5;
  return SH_A[k] * (1.0 + 1.5 * uCollapse * uCollapse) * n * 2.0;
}

// one burning shell: a thin luminous plasma layer with a soft glow skirt above it (like a planetary-nebula shell:
// faint face-on, bright where seen edge-on); analytic column per crossing — smooth, grain-free
vec3 lumShell(vec3 ro, vec3 rd, float tc, float b, int k, float pa, float tin) {
  float R = gSR[k], w = SH_W[k], lam = SH_L[k];
  vec3 pc = ro + rd * tc;
  vec3 dc = b > 1e-5 ? pc / b : rd;
  float R1 = R + shellTurb(dc, k);
  vec3 col = (k == 0 ? bbColor(gT) : bbColor(SH_T[k])) * SH_B[k];
  vec3 E = vec3(0.0);
  float F = 1.4 + 0.45 * float(k);
  if (b < R1) {
    for (int s = 0; s < 2; s++) {
      float hs0 = sqrt(R1 * R1 - b * b);
      float t = s == 0 ? tc - hs0 : tc + hs0;
      vec3 d = normalize(ro + rd * t);
      float Rk = R + shellTurb(d, k);                 // refine at the actual crossing direction
      float q2 = Rk * Rk - b * b;
      float hs = sqrt(max(q2, 0.0));
      t = s == 0 ? tc - hs : tc + hs;
      // column / (sqrt(pi) w): 1 face-on, more at the limb; past the refined rim fall back to the Gaussian tail
      float dz = max(b - Rk, 0.0);
      float Lf = Rk / sqrt(max(q2, 0.0) + 2.0 * Rk * w) * exp(-dz * dz / (w * w));
      float Lh = Rk / sqrt(max(q2, 0.0) + 2.0 * Rk * lam) * exp(-dz / lam);
      float pathW = w * Lf * 2.0;
      float vis = smoothstep(-pathW, pathW, t);       // crossings slide smoothly behind the camera
      if (vis <= 0.0) continue;
      float lod = max(0.0, log2(abs(t) * pa * 128.0 * F * 0.5 + 1e-6));
      float tr = exp(-SIG_IN * max(t - tin, 0.0)) * coreTrans(t, tc, b);
      E += col * (Lf * sqrt(2.0 * w / Rk) + 0.6 * Lh * sqrt(2.0 * lam / Rk)) * shellTex(d, k, lod) * vis * tr;
    }
  } else if (tc > 0.0) {
    // passing just outside the shell: the Gaussian tail of the layer + the exponential tail of the skirt
    float dz = b - R1;
    float Lf = 2.0 * R1 / sqrt(2.0 * R1 * w) * exp(-dz * dz / (w * w));
    float Lh = 2.0 * R1 / sqrt(2.0 * R1 * lam) * exp(-dz / lam);
    float lod = max(0.0, log2(tc * pa * 128.0 * F * 0.5 + 1e-6));
    E += col * (Lf * sqrt(2.0 * w / R1) + 0.6 * Lh * sqrt(2.0 * lam / R1)) * shellTex(dc, k, lod) * exp(-SIG_IN * max(tc - tin, 0.0)) * coreTrans(tc, tc, b);
  }
  return E;
}

// display temperature vs radius, piecewise linear through the shells (cool outside -> hot inside)
float shellT(float rr) {
  float T = gT;
  for (int k = 1; k < 7; k++) {
    float Ro = gSR[k - 1], Ri = gSR[k];
    if (rr < Ro) T = mix(SH_T[k], k == 1 ? gT : SH_T[k - 1], sat((rr - Ri) / max(Ro - Ri, 1e-3)));
  }
  if (rr < gSR[6]) T = mix(8500.0, SH_T[6], sat((rr - gFe) / max(gSR[6] - gFe, 1e-3)));
  return T;
}

// warm convective gas filling the star between the shells: low-contrast rising plumes. The emission rises steeply
// toward the centre, so samples are placed equiangularly about the centre (dense near the closest approach).
vec3 interiorGas(vec3 ro, vec3 rd, float t0, float t1, float tc, float b, float pa) {
  const int N = 24;
  float bb = max(b, 0.02);
  float th0 = atan((t0 - tc) / bb), th1 = atan((t1 - tc) / bb);
  float dth = (th1 - th0) / float(N);
  vec3 E = vec3(0.0);
  float c = uCollapse;
  float flowR = -gClk * 0.004 + c * c * 3.0;                 // rising; rushing inward at the collapse
  for (int i = 0; i < N; i++) {
    float th = th0 + (float(i) + gRnd.x) * dth;
    float ct = cos(th);
    float t = tc + bb * tan(th);
    float ds = bb / (ct * ct) * dth;
    vec3 p = ro + rd * t;
    float r = length(p);
    vec3 d = p / max(r, 1e-4);
    float lod = max(0.0, log2(max(t, 0.02) * pa * 128.0 * 3.0 + 1e-6));
    float rr = r;
    float th2 = 0.08 + 0.12 * rr;
    // billowing plumes, only mildly stretched along the radius (soft fog-like gas, not streaks)
    vec3 q = d * (0.4 * max(rr, 0.05) / th2) + vec3(0.37, 0.52, 0.61) * (rr * 0.3 / th2 + flowR);
    float pl = nzl(q * 0.6, lod + 1.5).g;
    float fill = 0.03 * exp(-rr / 0.45);
    E += bbColor(shellT(rr)) * fill * (0.15 + 2.2 * pl * pl * pl) * exp(-SIG_IN * max(t - t0, 0.0)) * coreTrans(t, tc, b) * ds;
  }
  return E;
}

// the whole interior along a ray (camera inside or outside the star)
vec3 interior(vec3 ro, vec3 rd, float pa) {
  vec2 ts = starSphere(ro, rd, gRph * 1.03);
  if (ts.y <= 0.0) return vec3(0.0);
  float t0 = max(ts.x, 0.0), t1 = ts.y;
  float tc = -dot(ro, rd);
  float b = length(ro + rd * tc);
  vec3 E = vec3(0.0);
  for (int k = 0; k < 7; k++) E += lumShell(ro, rd, tc, b, k, pa, t0);
  E += interiorGas(ro, rd, t0, t1, tc, b, pa);
  // the inert iron core: a dim, dense, dark volume (dull red glow of its own; heats up as it collapses)
  if (tc > -gFe * 2.0) {
    float tau = gFeTau * exp(-b * b / (gFe * gFe));
    float heat = uCollapse * uCollapse;
    vec3 S = bbColor(mix(1500.0, 6000.0, heat)) * (0.015 + 6.0 * heat * heat);
    float lump = nzl(normalize(ro + rd * tc + 1e-4) * 4.0 + gClk * 0.002, 0.0).g;
    E += S * (1.0 - exp(-tau)) * (0.6 + 0.8 * lump) * smoothstep(-gFe * 2.0, 0.0, tc);
  }
  return E * uInterior;
}

// =================================================================================================
void main() {
  vec3 rdW = camRay();
  float R = max(uRadius, 1e-4);
  mat3 Bm = rotY(-uSpin);
  vec3 ro = Bm * (uCamPos / R);
  vec3 rd = Bm * rdW;
  float pa = pixelAngle();
  gRnd = pixelRand(gl_FragCoord.xy, uSeed);
  gClk = uTime * uBoil;

  gRph = 1.0 + 0.07 * uPulse * sin(uPulsePhase);
  gT = uTemp * (1.0 + 0.05 * uPulse * sin(uPulsePhase + 1.3));
  gRsg = smoothstep(0.55, 1.0, uAge);
  gSurfK = uSurf * pow(bbLum(uTemp), uLumK - 1.0) * (1.0 + 0.25 * uPulse * sin(uPulsePhase + 1.3));
  gStarCol = blackbody(gT) * gSurfK;
  gDisk = lum(gStarCol);

  float rCam = length(ro);
  float camIn = 1.0 - smoothstep(0.985 * gRph, 1.02 * gRph, rCam);   // the camera is inside the star
  float inside = max(uInside, camIn);
  float outsideK = 1.0 - camIn;                                      // exterior phenomena fade when we are inside

  float tc = -dot(ro, rd);
  float b = length(ro + rd * tc);
  vec3 dc = b > 1e-5 ? (ro + rd * tc) / b : rd;
  vec2 ts = starSphere(ro, rd, gRph);
  float tSurf = (ts.x > 0.0 && camIn < 1.0) ? ts.x : -1.0;
  bool through = ts.y > 0.0;                                         // the ray passes through the star

  vec3 col = vec3(0.0);
  // ---- exterior: blinding photosphere with a soft, glowing limb ----
  if (inside < 1.0 && tSurf > 0.0) {
    vec3 p = ro + rd * tSurf;
    vec3 d = normalize(p);
    float mu = sat(dot(d, -rd));
    float fp = tSurf * pa / max(mu, 0.06);
    vec3 ext = starSurfaceN(d, d, -rd, gT, gClk, uCells, fp, vec4(uGranC, gRsg, uActivity, 3.0)) * gSurfK;
    ext += blackbody(gT * 1.3) * gSurfK * 2.0 * flareRibbons(d);
    ext = mix(edgeRadiance(d), ext, smoothstep(0.0, 0.3, mu));        // the edge melts into the limb glow
    col += ext * (1.0 - inside);
  }
  // glowing gas just above the photosphere: the disk's edge continues outward and fades (no crisp silhouette)
  if (tc > 0.0 && b > gRph && camIn < 1.0) {
    float h = uLimbH * (1.0 + uLumpy * 1.6 * (nzl(dc * 2.5 + vec3(0.1, 0.4, 0.7) + gClk * 0.002, 0.0).g - 0.5));
    col += edgeRadiance(dc) * starLimbGlow(b, gRph, max(h, 0.002)) * (1.0 - 0.6 * inside);
  }
  // ---- interior: the star as translucent luminous gas ----
  if (inside > 0.0 && through) {
    setupInterior();
    col += interior(ro, rd, pa) * inside;
  }

  // ---- what lies outside the star (skipped when the camera is inside it) ----
  if (outsideK > 0.0) {
    float tmax = (tSurf > 0.0 && inside < 1.0) ? tSurf : 1e9;
    vec3 bg = through ? vec3(0.0) : sky(rdW, pa) * uSkyAmt;
    vec4 prom = prominences(ro, rd, tmax, pa);
    if (tSurf > 0.0) { prom.rgb *= 0.15; prom.a = mix(1.0, prom.a, 0.3); }   // in front of the disk: faint absorption
    vec3 atmT, dustT;
    vec3 atmE = atmosphere(ro, rd, tmax, pa) + molEnvelope(ro, rd, inside, atmT);
    vec3 dustE = dustShells(ro, rd, tmax, pa, dustT);
    vec3 chr = chromosphere(ro, rd, pa) * (1.0 - inside);
    col = (col + bg) * mix(vec3(1.0), prom.a * atmT * dustT, outsideK)
        + ((prom.rgb + chr) * atmT + atmE + dustE + cmeFront(ro, rd, tmax)) * outsideK;
  }

  // ---- proto-neutron star: a tiny overwhelming point at the centre once the core has collapsed ----
  if (uCollapse > 0.75 && tc > 0.0) {
    float fpix = tc * pa;
    float s = max(fpix * 1.2, 0.0015);
    float k = smoothstep(0.75, 1.0, uCollapse);
    col += bbColor(60000.0) * k * k * 20000.0 * exp(-b * b / (s * s)) * (fpix * fpix) / (s * s);
    col += bbColor(30000.0) * k * k * (6.0 * exp(-b / 0.01) + 2.0 * exp(-b / 0.04) + 0.5 * exp(-b / 0.15));
  }
  emit(col);
}
