// nebula_lib.glsl — density, light transport and sources for nebula.frag (Act I "THE ENDLESS").
// Units ~ light years. Origin = the hero core (spin axis +y).
//
// Compile-time feature switches (shot `defines`) strip components a shot cannot see, for speed:
//   NEB_NO_PILLARS  pillars + evaporating knots          NEB_NO_COMETS   cometary globules in cluster A's bubble
//   NEB_NO_GLOBULES procedural Bok globules              NEB_NO_CORE     hero core, disk, hub streams, jets
//   NEB_NO_CLUSTER  cluster B embryos / their bubbles    NEB_NO_HERO     hero star light, ionisation front, cavity
//   NEB_NO_RIM      external rim light                   NEB_NO_FIELD    embedded field stars
//   NEB_NO_EDGEWARP the mid-scale warp that tears the cloud's outer boundary (interior shots never see it)
//   NEB_NO_SELFSHADOW the local self-shadow tap of cluster A's light (dim backdrops)
// With no defines everything is on (always correct, slowest).

// ---------------------------------------------------------------------------------------------------------------------
// uniforms
uniform float uSkyAmt;
uniform float uDust;        // dust opacity per unit density per unit length
uniform float uEmit;        // emission-line brightness
uniform float uScat;        // dust-scattered starlight
uniform float uAmb;         // faint glow of the diffuse gas in the cloud's canyons (a backdrop for silhouettes)
uniform float uDetail;      // fine-detail contrast
uniform vec3 uHa;           // H-alpha (+H-beta) colour, luminance ~1
uniform vec3 uO3;           // [O III] 5007 colour
uniform vec3 uS2;           // [S II] 6716/31 colour
uniform vec3 uExt;          // relative extinction per channel (reddening law)
uniform vec3 uCloudC;       // centre of the cloud complex (march bounds, field-star shells)
uniform vec3 uAPos;         // cluster A: old O stars inside the cloud; they blew the HII bubble and shaped the pillars
uniform float uALum;
uniform float uATemp;
uniform float uAR;          // bubble radius (distance from cluster A to its ionisation front)
uniform vec3 uAOpen;        // direction of the bubble's blister opening (light and ionised gas escape there)
#define NPIL 6
uniform vec4 uPilTip[NPIL]; // head centre xyz, head radius
uniform vec4 uPilDim[NPIL]; // length, base radius, neck radius, density
uniform int uPilN;
uniform vec4 uPilBound;     // bounding sphere of the pillar field
uniform vec4 uPilCone;      // axis (from cluster A) and cos(half angle) of the cone containing the pillars
#define NCLU 16
uniform vec4 uClu[NCLU];    // embryo position xyz, ignition threshold on uCluster
uniform int uCluN;
uniform float uCluBound;    // all embryos (and their bubbles) lie within this radius of the origin
uniform float uCollapse;    // 0..1 the hero core collapses into a disk + protostar
uniform float uFlow;        // flow clock of the core (infall / rotation / jet knots), integrated by the JS helper
uniform float uIgnite;      // 0..1 protostar -> flash -> blazing O star
uniform float uFront;       // 0..1 ionisation front radius (log scale, core -> whole cloud)
uniform float uBubA;        // debug/grade: cluster A bubble recombination glow multiplier (1 = as designed)
uniform float uCluster;     // 0..1 cluster B embryos ignite one after another
uniform float uJet;         // 0..2 jets: 0 none, 1 first jets (Herbig-Haro), 2 blasting
uniform float uFlash;       // optional extra transient brightening of the hero star (impulse, e.g. on a beat)
uniform float uPreGlow;     // 0..1 the protostar's accretion flickers and swells in the dip before ignition
uniform vec4 uKey;          // soft key light for the core close-ups: direction to light (xyz), intensity (w)
uniform vec3 uKeyCol;       // its colour
uniform float uHub;         // gas streams converging on the hub (multiplier)
uniform float uMass;        // density of the cloud masses (1 = default)
uniform float uLeak;        // 0..1 porosity of the bubble wall: cluster A's reddened light leaks deep into the cloud
uniform float uCoreGlow;    // dull-red glow of the infalling gas (compression / accretion heating)
uniform float uField;       // embedded field stars (brightness multiplier)
uniform float uStepK;       // ray-march step as a fraction of distance
uniform float uCoreStep;    // multiplier of the (small) march step inside the hero core
uniform float uStepMin;     // smallest march step outside the core (near the camera the distance-proportional step is tiny)
uniform float uOuterStep;   // step multiplier away from the hub (core close-ups: the dim backdrop needs fewer samples)
uniform float uFineFar;     // fine-noise detail is dropped farther than this from the hub (core close-ups: dim backdrop)
#define NBLOB 8
uniform vec4 uBlobC[NBLOB]; // the cloud's shape: metaball ellipsoids (centre)
uniform vec4 uBlobR[NBLOB]; // (inverse radii)
uniform int uBlobN;
uniform vec4 uRim;          // external light (galactic radiation field from the bright bulge): direction to it, intensity
uniform vec3 uRimCol;
uniform vec4 uFieldDir;     // magnetic-field direction (xyz) and stretch 0..1: dust and gas are combed along it

const float WORLD_R = 125.0;    // march bounds: sphere around uCloudC
const float SC_L = 1.0 / 170.0;   // large-scale structure  (wavelengths 42 .. 2.7)
const float SC_M = 1.0 / 30.0;    // medium detail          (7.5 .. 0.47)
const float SC_F = 1.0 / 5.0;     // fine detail            (1.25 .. 0.08)
const vec3 OFF_L = vec3(0.37, 0.11, 0.73);
const vec3 OFF_M = vec3(0.61, 0.29, 0.05);
const float KD = 0.012;           // diffuse gas in the canyons between the cloud masses
const float KM = 0.07;            // mean column per unit length beyond the bubble wall (masses + diffuse), for light
const float KF = 1.2;             // compressed gas behind cluster A's ionisation front
const float LF = 1.5;             // its depth
const float EMK = 60.0;           // recombination emissivity per n_e^2

float lodFor(float foot, float sc) { return clamp(log2(max(foot * sc * 128.0, 1e-6)), 0.0, 7.0); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec2 sphHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 o = ro - c;
  float b = dot(o, rd), h = b * b - dot(o, o) + r * r;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
float hg(float c, float g) { float g2 = g * g, d = max(1.0 + g2 - 2.0 * g * c, 1e-4); return (1.0 - g2) / (12.566 * d * sqrt(d)); }
// interstellar dust: strong forward lobe + some back-scatter; c = cos(scattering angle)
float dustPhase(float c) { return 0.7 * hg(c, 0.6) + 0.3 * hg(c, -0.25); }
// transmitted starlight incl. one multiple-scattering octave (diffuse light reaches deeper, reddened)
vec3 transL(float col) {
  float t = uDust * col;
  return exp(-t * uExt) + 0.06 * exp(-0.35 * t);
}
// emission-line mix vs ionisation: x = 0 low (H-alpha + [S II] at dense fronts) .. 1 high ([O III] in rarefied gas)
vec3 lineMix(float x) { return mix(uHa * 0.86 + uS2 * 0.2, uO3 * 0.85 + uHa * 0.05, x); }
float ionX(float flux, float n) { return smoothstep(6.0, 10.5, log2(max(flux, 1e-6) / (n + 2e-3))); }

// ---------------------------------------------------------------------------------------------------------------------
// cloud shape: smooth union of ellipsoids; field = 1 at a centre, 0 on the surface, negative outside
float blobField(vec3 q) {
  float f = -1.0;
  for (int i = 0; i < NBLOB; i++) {
    if (i >= uBlobN) break;
    vec3 o = (q - uBlobC[i].xyz) * uBlobR[i].xyz;
    float fi = 1.0 - dot(o, o);
    if (fi < f - 0.4) continue;
    // smooth max
    float h = clamp(0.5 + 0.5 * (fi - f) / 0.35, 0.0, 1.0);
    f = mix(f, fi, h) + 0.35 * h * (1.0 - h);
  }
  return f;
}
// column of a parabolic-profile density (1 - |o|^2) through every blob, from p along l to infinity (closed form)
float blobColumn(vec3 p, vec3 l) {
  float col = 0.0;
  for (int i = 0; i < NBLOB; i++) {
    if (i >= uBlobN) break;
    vec3 o = (p - uBlobC[i].xyz) * uBlobR[i].xyz, d = l * uBlobR[i].xyz;
    float a = dot(d, d), b = dot(o, d), c = dot(o, o) - 1.0;
    float h = b * b - a * c;
    if (h <= 0.0) continue;
    h = sqrt(h);
    float s0 = max((-b - h) / a, 0.0), s1 = (-b + h) / a;
    if (s1 <= s0) continue;
    // integral of -(a s^2 + 2 b s + c) ds
    col += -(a * (s1 * s1 * s1 - s0 * s0 * s0) / 3.0 + b * (s1 * s1 - s0 * s0) + c * (s1 - s0));
  }
  return col;
}

// ---------------------------------------------------------------------------------------------------------------------
// per-pixel constants
float gProto, gHeroL, gHeroT, gIon, gFrontR, gDiskR, gJetLen;
vec3 gHeroCol, gColA, gColB, gColEmb;
int gCluMask, gPilMask;      // per-ray culling: which embryos / pillars this ray passes near

// ray-sphere proximity masks, computed once per pixel
void rayMasks(vec3 ro, vec3 rd) {
  gCluMask = 0;
  gPilMask = 0;
#ifndef NEB_NO_CLUSTER
  for (int i = 0; i < NCLU; i++) {
    if (i >= uCluN) break;
    vec3 v = uClu[i].xyz - ro;
    float tc = max(dot(v, rd), 0.0);
    vec3 q = v - rd * tc;
    float reach = uCluster > uClu[i].w ? 49.0 : 9.0;   // an ignited embryo lights gas up to ~7 away
    if (dot(q, q) < reach) gCluMask |= 1 << i;
  }
#endif
#ifndef NEB_NO_PILLARS
  for (int i = 0; i < NPIL; i++) {
    if (i >= uPilN) break;
    vec3 ax = normalize(uPilTip[i].xyz - uAPos);
    vec3 c = uPilTip[i].xyz + ax * (0.5 * uPilDim[i].x - uPilTip[i].w);
    float R = 0.5 * uPilDim[i].x + uPilTip[i].w * 3.2 + uPilDim[i].y * 2.4 + 3.0;
    vec3 v = c - ro;
    float tc = max(dot(v, rd), 0.0);
    vec3 q = v - rd * tc;
    if (dot(q, q) < R * R) gPilMask |= 1 << i;
  }
#endif
}

// deterministic accretion flicker (continuous in time, irregular): 0..1
float flicker(float t) {
  float a = sin(t * 5.3) * sin(t * 1.7 + 1.1);
  float b = sin(t * 11.9 + 2.3) * sin(t * 0.83);
  float c = sin(t * 23.1 + 0.7);
  return clamp(0.5 + 0.45 * a + 0.3 * b * b * sign(b) + 0.12 * c, 0.0, 1.0);
}
void heroSetup() {
  float c = uCollapse;
  gProto = smoothstep(0.38, 0.95, c);
  float pg = clamp(uPreGlow, 0.0, 1.0);
  float Tp = mix(1400.0, 3000.0, gProto) + 900.0 * pg;
  float ig = clamp(uIgnite, 0.0, 1.0);
  // ignition unfolds instead of slamming on: the star turns on over the first ~15% of uIgnite (colour sweeps from
  // dull orange to blue-white), then keeps brightening all the way to 1 (the crescendo)
  float on = smoothstep(0.0, 0.15, ig);
  gHeroT = mix(Tp, 38000.0, smoothstep(0.0, 0.18, ig));
  gIon = smoothstep(0.03, 0.2, ig);
  float Lproto = 2.0 * gProto * (1.0 + pg * (1.2 + 3.5 * flicker(uTime)));
  gHeroL = Lproto * (1.0 - on) + 3000.0 * (0.2 * on + 0.8 * ig * ig) + uFlash * 1500.0;
  gHeroCol = bbColor(gHeroT);
  gFrontR = exp(mix(log(2.3), log(34.0), clamp(uFront, 0.0, 1.0)));
  gDiskR = 0.75 * smoothstep(0.3, 0.95, c) * (1.0 - smoothstep(0.02, 0.22, uFront));
  float j = max(uJet, 0.0);
  gJetLen = j <= 1.0 ? 0.15 + 2.6 * j : 2.75 + 30.0 * (j - 1.0);
  gColA = bbColor(uATemp);
  gColB = bbColor(24000.0);
  gColEmb = bbColor(1900.0);
}

// ---------------------------------------------------------------------------------------------------------------------
// queued point sources (stars, jets): composited at their depth during the march. Two slots are enough: a pixel
// sees at most one point star (the PSF is ~1 px) plus the jets; extra sources merge into the farther slot.
vec4 gQ0 = vec4(0.0, 0.0, 0.0, 1e10), gQ1 = vec4(0.0, 0.0, 0.0, 1e10);
void queuePush(float t, vec3 c) {
  if (gQ0.w > 1e9) gQ0 = vec4(c, t);
  else if (gQ1.w > 1e9) gQ1 = vec4(c, t);
  else if (gQ0.w > gQ1.w) gQ0 = vec4(gQ0.rgb + c, min(gQ0.w, t));
  else gQ1 = vec4(gQ1.rgb + c, min(gQ1.w, t));
}
void queueFlush(float t, vec3 T, inout vec3 col) {
  if (gQ0.w < t) { col += T * gQ0.rgb; gQ0 = vec4(0.0, 0.0, 0.0, 1e10); }
  if (gQ1.w < t) { col += T * gQ1.rgb; gQ1 = vec4(0.0, 0.0, 0.0, 1e10); }
}

// a star of visual luminosity Lv (sky.glsl flux units at distance 1) and radius rad
void star(vec3 ro, vec3 rd, float pa, vec3 S, float Lv, vec3 c, float rad, inout float tSolid, inout vec3 solidCol) {
  vec3 v = S - ro;
  float ts = dot(v, rd);
  if (ts <= 1e-3 || Lv <= 0.0) return;
  float th = length(v - rd * ts) / ts;
  float sig = 0.55 * pa;
  float alpha = rad / ts;
  float F = REF_PIX * REF_PIX * Lv / (ts * ts);
  if (alpha > sig) {
    // resolved photosphere: opaque disk with limb darkening, surface brightness = flux / solid angle
    float B = F / (PI * alpha * alpha);
    if (th < alpha) {
      float x = th / alpha;
      if (ts < tSolid) { tSolid = ts; solidCol = c * B * (0.45 + 0.55 * sqrt(max(1.0 - x * x, 0.0))) * 1.12; }
      return;
    }
    float e = th - alpha;
    queuePush(ts, c * B * 0.45 * exp(-e * e / (2.0 * sig * sig)));
    return;
  }
  float s2 = sig * sig;
  float e = th * th / (2.0 * s2);
  if (e > 14.0) return;
  queuePush(ts, c * F * exp(-e) / (6.2832 * s2));
}

void queueStars(vec3 ro, vec3 rd, float pa, inout float tSolid, inout vec3 solidCol) {
  // cluster A: seven O/B stars (one bounding test for the whole group)
  vec3 va = uAPos - ro;
  float ta = dot(va, rd);
  if (ta > 0.0 && length(va - rd * ta) < 4.5 + 4.0 * pa * ta)
  for (int k = 0; k < 7; k++) {
    vec4 h = hash44i(ivec4(k, 3, 5, 71));
    vec3 S = uAPos + (h.xyz - 0.5) * vec3(6.0, 4.0, 6.0);
    float T = mix(26000.0, 45000.0, h.w);
    star(ro, rd, pa, S, uALum * 900.0 * (0.25 + h.w), mix(vec3(1.0), bbColor(T), 0.8), 0.0, tSolid, solidCol);
  }
  // cluster B: embryos (dim, deep red, inside cocoons) that ignite into hot stars
#ifndef NEB_NO_CLUSTER
  if (gCluMask != 0)
  for (int i = 0; i < NCLU; i++) {
    if (i >= uCluN) break;
    if ((gCluMask & (1 << i)) == 0) continue;
    vec4 e = uClu[i];
    float ign = smoothstep(e.w, e.w + 0.05, uCluster);
    float fl = ign * exp(-max(uCluster - e.w - 0.02, 0.0) / 0.035);
    vec3 c = mix(gColEmb, mix(vec3(1.0), gColB, 0.75), ign);
    star(ro, rd, pa, e.xyz, mix(60.0, 6000.0, ign) * (1.0 + 5.0 * fl), c, 0.0, tSolid, solidCol);
  }
#endif
  // the hero star: a dull red protostar inside its disk, then the blazing O star
  float Lv = gHeroL * mix(400.0, 900.0, gIon);
  if (Lv > 0.0) star(ro, rd, pa, vec3(0.0), Lv, mix(gHeroCol, vec3(1.0), 0.15 * gIon), 0.0, tSolid, solidCol);
}

// embedded / foreground field stars: world-fixed stars on three shells around the cloud (radii 35, 70, 105). Each ray
// meets each shell at most twice; at each hit one cube-face cell of the shell is tested. The stars have true
// parallax and are queued at their depth, so the dust in front extinguishes and reddens them.
void fieldShell(vec3 ro, vec3 rd, float pa, float R, float N, int seed, float tHit) {
  if (tHit <= 0.5) return;
  vec3 hp = ro + rd * tHit - uCloudC;
  vec3 d = hp / R;
  int f; vec2 uv;
  cubeProj(d, f, uv);
  vec2 g = (uv * 0.5 + 0.5) * N;
  vec2 c = floor(g);
  vec4 h = hash44i(ivec4(ivec2(c), f, seed));
  if (h.w > 0.6) return;
  vec2 q = (c + 0.2 + 0.6 * h.xy) / N * 2.0 - 1.0;
  vec3 S = uCloudC + cubeDir(f, q) * R;
  vec3 v = S - ro;
  float ts = dot(v, rd);
  if (ts <= 0.5) return;
  float th = length(v - rd * ts) / ts;
  float sig = 0.55 * pa;
  float e = th * th / (2.0 * sig * sig);
  if (e > 12.0) return;
  vec4 h2 = hash44i(ivec4(ivec2(c), f, seed + 77));
  float T = h2.x < 0.6 ? mix(3200.0, 5500.0, h2.y) : mix(5500.0, 16000.0, h2.y * h2.y);
  float Lv = uField * 4e4 * exp(-6.0 * h2.z) * (h2.w < 0.06 ? 12.0 : 1.0);
  float F = REF_PIX * REF_PIX * Lv / (ts * ts);
  queuePush(ts, mix(vec3(1.0), bbColor(T), 0.6) * F * exp(-e) / (6.2832 * sig * sig));
}
void queueField(vec3 ro, vec3 rd, float pa) {
#ifdef NEB_NO_FIELD
  return;
#endif
  if (uField <= 0.0) return;
  for (int k = 0; k < 3; k++) {
    float R = 35.0 * float(k + 1);
    vec2 tb = sphHit(ro, rd, uCloudC, R);
    if (tb.y <= 0.0) continue;
    float N = 0.32 * R;     // ~6 units per cell on every shell
    fieldShell(ro, rd, pa, R, N, 4242 + 31 * k, tb.x);
    fieldShell(ro, rd, pa, R, N, 4242 + 31 * k, tb.y);
  }
}

// jets along +-y: analytic line integral through a Gaussian tube (thin features would alias in the march)
void queueJets(vec3 ro, vec3 rd, float pa) {
#ifdef NEB_NO_CORE
  return;
#endif
  if (uJet <= 0.0) return;
  float L = gJetLen;
  float b = rd.y, dd = dot(rd, ro), e = ro.y;
  float den = max(1.0 - b * b, 1e-4);
  float tc = (b * e - dd) / den;
  float yc = (e - b * dd) / den;
  if (tc <= 0.0) return;
  float ay = abs(yc);
  if (ay > L * 1.02) return;
  // slow precession wiggle of the jet axis
  vec2 wig = vec2(sin(ay * 0.9 + 1.3), cos(ay * 0.7 + 0.4)) * 0.035 * ay / (1.0 + 0.08 * ay);
  vec3 pc = ro + rd * tc;
  float dist = length(pc.xz - wig);
  float w = 0.01 + 0.035 * ay / (1.0 + 0.05 * ay) + 0.6 * pa * tc;
  float core = exp(-dist * dist / (w * w));
  if (core < 1e-3) return;
  float path = min(1.7725 * w / sqrt(den), 2.0 * L);
  // Herbig-Haro knots travelling outward: discrete, each with its own brightness
  float ph = ay * 7.0 / (1.0 + 0.12 * ay) - uFlow * 0.9 + (yc > 0.0 ? 0.0 : 2.1);
  float ki = floor(ph / 6.2832);
  float kb = 0.35 + 1.3 * hash11(ki * 1.37 + (yc > 0.0 ? 0.0 : 71.0));
  float kn = 0.45 + 1.4 * kb * pow(0.5 + 0.5 * sin(ph), 8.0);
  float fall = smoothstep(0.0, 0.06, ay) * (1.0 - smoothstep(0.8 * L, L, ay)) / (1.0 + 0.6 * ay);
  float blast = smoothstep(1.0, 2.0, uJet);
  vec3 c = mix(uHa * 0.75 + uS2 * 0.45, mix(uO3, vec3(1.0), 0.6) * 1.3, blast * exp(-ay / (0.25 * L + 0.1)));
  float amp = min(uJet, 1.0) * 6.0 + blast * 6.0 + gIon * 4.0;
  queuePush(tc, c * core * path * kn * fall * amp);
}

// ---------------------------------------------------------------------------------------------------------------------
// cluster A: first-hit front (bubble wall, pillars) and the column density from A to a point, in closed form along
// the ray from A. Returns x: column (density x length), y: first-hit distance incl. pillars, z: wall distance
// (pushed to infinity inside the blister opening).
vec3 tauA(vec3 p, float foot, out vec3 nA, out float rA) {
  vec3 d = p - uAPos;
  rA = max(length(d), 1e-3);
  nA = d / rA;
  // far behind the wall the front's relief no longer matters: skip the angular noise
  if (rA > uAR * 1.45 + 6.0) {
    float x0 = rA - uAR;
    float o0 = smoothstep(0.12, 0.38, dot(nA, uAOpen));
    return vec3((1.0 - o0) * (KF * LF + KM * x0) * (1.0 - 0.85 * uLeak), uAR + o0 * 300.0, uAR + o0 * 300.0);
  }
  vec4 a = nzl(nA * 1.6 + vec3(0.21, 0.63, 0.12), lodFor(foot / rA, 1.6));
  float rg = 1.0 - abs(a.b * 2.0 - 1.0);
  float wall = uAR * (1.0 + 0.42 * (a.r - 0.5)) + 3.0 * (a.g - 0.5) - 2.2 * rg * rg * rg;
  float open = smoothstep(0.12, 0.38, dot(nA, uAOpen) + 0.3 * (a.b - 0.5));
  float x = max(rA - wall, 0.0);
  float col = (1.0 - open) * (KF * LF * (1.0 - exp(-x / LF)) + KM * x) * (1.0 - 0.85 * uLeak);
  float h = wall + open * 300.0;       // continuous across the opening's rim (no visible cone)
#ifndef NEB_NO_PILLARS
  if (dot(nA, uPilCone.xyz) > uPilCone.w) {
    for (int i = 0; i < NPIL; i++) {
      if (i >= uPilN) break;
      vec4 T = uPilTip[i], D = uPilDim[i];
      vec3 ax = T.xyz - uAPos;
      float Dt = length(ax);
      ax /= Dt;
      float cc = dot(nA, ax);
      if (cc < 0.96) continue;
      float s2 = max(1.0 - cc * cc, 0.0);
      float q = Dt * sqrt(s2);
      float disc = T.w * T.w - Dt * Dt * s2;
      if (disc > 0.0) {
        float sq = sqrt(disc), t0 = Dt * cc - sq;
        h = min(h, t0);
        col += 0.3 * D.w * (clamp(rA, t0, Dt * cc + sq) - t0);
      }
      if (q < D.y) {
        float sIn = q <= D.z ? 0.0 : D.x * sqrt((q - D.z) / (D.y - D.z));
        float b0 = Dt + sIn;
        h = min(h, b0);
        col += 0.25 * D.w * (clamp(rA, b0, Dt + D.x) - b0);
      }
    }
  }
#endif
  return vec3(col, h, wall + open * 300.0);
}

// pillar bodies (3D): tapered columns with lumpy heads, pointing at cluster A, plus evaporating globules at the tips.
// eggCol returns a rough column towards cluster A inside the evaporating globules (their own shadow)
float pillars(vec3 p, float disp, float fine, float foot, out float egg, out float eggCol) {
  // Gas columns, not solids: a dense core that thins out gradually, its boundary torn into wisps by multi-scale
  // turbulence; the head is a lumpy, lobed mass of gas; evaporating knots are soft and stretched along the light.
  float acc = 0.0;
  egg = 0.0;
  eggCol = 0.0;
  float rid = 1.0 - abs(fine * 2.0 - 1.0);
  for (int i = 0; i < NPIL; i++) {
    if (i >= uPilN) break;
    if ((gPilMask & (1 << i)) == 0) continue;
    vec4 T = uPilTip[i], D = uPilDim[i];
    vec3 ax = normalize(T.xyz - uAPos);
    vec3 v = p - T.xyz;
    float s = dot(v, ax);
    if (s < -T.w * 3.2 || s > D.x + 3.0) continue;
    vec3 perp = v - ax * s;
    float rp = length(perp);
    if (rp > D.y * 2.4 + 2.5) continue;
    float sc = clamp(s / D.x, 0.0, 1.0);
    float rad = D.z + (D.y - D.z) * sc * sc;
    float dB = s < 0.0 ? length(vec2(rp, s)) - D.z : rp - rad;
    // lobed head: its radius wanders with the large-scale turbulence
    vec3 vh = v - ax * (0.45 * T.w);
    vh += (vec3(disp, fine - 0.5, rid - 0.5) * 0.9) * T.w * 0.45;
    float dH = length(vh - ax * dot(vh, ax) * 0.45) - T.w * (0.85 + 0.35 * disp);
    float sd = smin(dB, dH, 0.9 * T.w);
    float w = 0.35 * max(rad, T.w);
    // turbulent, frayed boundary (ridged fine noise = wisps), striations along the light
    sd += disp * w * 1.6 + (fine - 0.5) * w * 2.4 - rid * rid * w * 1.2;
    float x = sd / (0.55 * T.w);
    float dens = 1.0 - smoothstep(-1.1, 0.9, x);
    // patchy, striated gas inside (not a uniform solid): dense knots and thinner lanes
    float ptch = 0.35 + 1.1 * smoothstep(0.2, 0.8, fine * 0.7 + rid * 0.5 - 0.1) * (0.6 + 0.8 * (disp * 0.25 + 0.5));
    // the column's foot dissolves into the bubble floor (no cut at the end of its bounding range)
    dens *= 1.0 - smoothstep(D.x, D.x + 2.8, s);
    acc += D.w * 1.25 * dens * (0.55 + 0.45 * dens) * mix(1.0, ptch, 1.0 - dens * dens * 0.6);
    // evaporating knots: soft gas lumps stretched towards the light, frayed by the fine turbulence
    if (s < T.w * 0.6) {
      for (int k = 0; k < 2; k++) {
        vec4 h = hash44i(ivec4(i, k, 31, 7));
        vec3 off = -ax * (T.w * (0.9 + 0.9 * h.x)) + (h.yzw - 0.5) * T.w * 1.8;
        float rg = T.w * (0.1 + 0.12 * h.w);
        vec3 vg = v - off;
        float al = dot(vg, ax);
        float dq = length(vg - ax * al) / rg;
        float q = dq * dq + (al * al) / (rg * rg * 3.5);
        float e = 2.2 * exp(-1.6 * q) * smoothstep(0.1, 0.7, fine + 0.25 * disp + 0.25);
        egg += e;
        eggCol += e * rg * 1.5 * (al > 0.0 ? 1.0 : 0.4);
      }
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------------------------------
// the hero core (spin axis +y). Stages along uCollapse c:
//   0.00-0.25  a lumpy, roughly round dense core at the hub; it contracts and concentrates
//   0.10-0.60  rotation takes over: logarithmic-spiral streamers wind up, material visibly flows inward along them
//   0.30-0.85  flattening: the inner envelope becomes an oblate rotating pseudo-disk; a thin flared disk grows
//   0.40-1.00  a dull red protostar heats the inner disk; the bipolar outflow cavity opens with the jets (uJet)
float coreDens(vec3 p, float foot, out float dsk) {
  float c = uCollapse;
  float r = length(p);
  float Renv = mix(2.8, 2.1, c);
  // the young core is an elongated, lumpy clump at a filament junction (stretched along x); it rounds up as it
  // collapses and spins up
  float el = 1.0 - smoothstep(0.1, 0.5, c);
  dsk = 0.0;
  if (r > Renv * mix(1.3, 1.9, el)) return 0.0;
  float R = max(length(p.xz), 1e-4);
  float y = p.y;
  float spin = smoothstep(0.05, 0.85, c);
  float flt = smoothstep(0.3, 0.85, c);
  // oblate density contours (no wedge): axis ratio shrinks as rotation takes over
  float q = mix(1.0, 0.36, flt);
  float re = length(vec3(p.x * mix(1.0, 0.6, el), y / q, p.z * mix(1.0, 1.2, el)));
  // outside the flattened envelope and away from the disk: nothing here (skip the noise fetches)
  if (re >= Renv * 1.3 && (gDiskR <= 0.01 || abs(y) > 0.5 || R > 1.6 * gDiskR)) return 0.0;
  vec4 n0 = spin < 0.95 ? nzl(p * 0.28 + vec3(0.31, 0.52, 0.18), lodFor(foot, 0.28)) : vec4(0.5);
  // centrally concentrated, with a lumpy, irregular boundary (no spherical silhouette)
  float pe = mix(0.9, 1.45, smoothstep(0.0, 0.85, c));
  float edgeR = Renv * mix(0.65 + 0.65 * n0.g, 1.0, spin);
  float prof = pow(max(re, 0.05) / 0.6, -pe) * (1.0 - smoothstep(0.3 * edgeR, edgeR, re));
  // spiral streamers on logarithmic spirals; they wind up with spin, material flows inward along them
  vec4 n2 = spin < 0.6 ? nzl(p * 2.1 + vec3(0.77, 0.12, 0.44), lodFor(foot, 2.1)) : vec4(0.5);
  float kw = mix(0.3, 2.2, spin);
  // psi = azimuth + kw ln R - flow, evaluated by rotating (x, z)/R (no atan)
  float a = kw * log(max(R, 0.03)) - uFlow * 0.05;
  float ca = cos(a), sa = sin(a);
  vec2 cs = vec2(p.x * ca - p.z * sa, p.z * ca + p.x * sa) / R;      // (cos psi, sin psi)
  float s = R * sqrt(R) * 0.3 + uFlow * 0.022;
  float freq = 1.6 * max(1.0, kw / max(R, 0.03));
  vec4 n1 = nzl(vec3(cs * 1.6, s) + vec3(0.13, 0.71, 0.29), lodFor(foot, freq));
  float b = 2.4 * (n1.r - 0.5);
  float arm = 0.5 + 0.5 * ((cs.x * cs.x - cs.y * cs.y) * cos(b) - 2.0 * cs.x * cs.y * sin(b));
  arm *= arm; arm *= arm; arm *= arm;
  float armAmp = smoothstep(0.08, 0.45, c) * (1.0 - 0.5 * smoothstep(0.8, 1.0, c));
  // streamers are thick far out and settle onto the mid-plane as they fall in
  float hs = 0.08 + 0.2 * R * (1.0 - 0.4 * spin);
  float sheet = exp(-(y * y) / (hs * hs));
  float n2c = mix(n2.r, n1.a, smoothstep(0.45, 0.6, spin));
  float streak = mix(1.0, 0.05 + 4.5 * arm * sheet * (0.3 + 1.3 * n1.g) * (0.5 + n2c), armAmp);
  // lumpy, clumpy texture (strongest in the young core)
  float lump = mix(0.08 + 2.2 * n0.g * n0.g * n0.g, 0.6 + 0.8 * n0.g, spin) * (0.45 + 1.1 * n2c);
  float env = 2.4 * prof * streak * lump * (1.0 + 1.5 * (1.0 - smoothstep(0.1, 0.35, c)));
  // bipolar outflow cavity cleared by the jets
  float jet = clamp(uJet, 0.0, 1.0);
  float mu = abs(y) / max(r, 1e-4);
  float muC = cos(mix(0.12, 0.55, jet));
  env *= 1.0 - jet * smoothstep(muC - 0.08, muC + 0.03, mu);
  // the ionisation front of the ignited star blows the envelope away
  env *= 1.0 - smoothstep(0.0, 0.12, uFront);
  if (gDiskR > 0.01) {
    float x = R / gDiskR;
    // flared disk: scale height grows as R^1.25 (thin in the middle, thick at the rim)
    float x2 = x + 0.02;
    float Hd = 0.008 + 0.11 * gDiskR * x2 * sqrt(sqrt(x2));
    float sig = exp(-x * x * x) * pow(max(x, 0.05), -0.8) * smoothstep(0.015, 0.05, R);
    float rings = 0.75 + 0.5 * mix(n2.g, n1.b, smoothstep(0.45, 0.6, spin));
    dsk = 7.0 * sig * exp(-0.5 * y * y / (Hd * Hd)) * (0.6 + 0.8 * sqrt(arm)) * rings;
  }
  return env + dsk;
}
// accretion / compression heating of the infalling gas: a dull red glow rising towards the centre
vec3 coreGlow(vec3 p, float rhoEnv) {
  float c = uCollapse;
  float r = length(p);
  float k = uCoreGlow * (0.12 + 0.88 * smoothstep(0.08, 0.6, c)) * (1.0 - gIon);
  if (k <= 0.0) return vec3(0.0);
  float T = 700.0 + 1100.0 * exp(-r / 0.45) * (0.4 + 0.6 * c);
  return rhoEnv * k * 0.14 / (r + 0.25) * bbColor(T) * (0.35 + T / 1500.0);
}
// smooth (noise-free) core profile for cheap self-shadowing
float coreSmooth(vec3 p) {
  float c = uCollapse;
  float Renv = mix(2.8, 2.1, c);
  float q = mix(1.0, 0.36, smoothstep(0.3, 0.85, c));
  float el = 1.0 - smoothstep(0.1, 0.5, c);
  float re = length(vec3(p.x * mix(1.0, 0.6, el), p.y / q, p.z * mix(1.0, 1.2, el)));
  float prof = pow(max(re, 0.05) / 0.6, -mix(0.9, 1.45, smoothstep(0.0, 0.85, c))) * (1.0 - smoothstep(0.3 * Renv, Renv, re));
  // the mean over the clumps / spiral arms (most of the gas sits in arms with gaps between them)
  return 2.0 * prof * mix(0.6, 0.3, smoothstep(0.08, 0.45, c));
}

// hero star's ionisation front distance along direction n
float heroFront(vec3 n, float af) {
  vec4 a = nzl(n * 1.4 + vec3(0.71, 0.23, 0.52), lodFor(af, 1.4));
  float spike = smoothstep(0.55, 0.85, a.r);
  // champagne flow: the front runs ahead towards the cloud's thin top and breaks out there
  float up = 1.0 + 0.3 * smoothstep(-0.2, 0.9, n.y);
  return gFrontR * up * (0.75 + 0.5 * a.g) * (1.0 - 0.3 * spike * smoothstep(0.0, 0.3, uFront));
}

// thin dense filaments (sheet ∩ sheet of the medium noise)
float threadsM(vec4 nM) {
  float ridge = 1.0 - abs(nM.r * 2.0 - 1.0);
  float ridge2 = 1.0 - abs(nM.b * 2.0 - 1.0);
  float r2 = ridge * ridge; r2 *= r2; r2 *= r2;
  float q2 = ridge2 * ridge2; q2 *= q2;
  return r2 * r2 * q2;
}

// is there a cometary globule in this point's cell (cheap hash test, used to decide whether fine detail is needed)
bool carveCellNear(vec3 p) {
  vec3 cell = floor(p / 7.0);
  return hash44i(ivec4(ivec3(cell) + 777, 4243)).w < 0.2;
}

// ---------------------------------------------------------------------------------------------------------------------
struct Med { vec3 sig; vec3 emi; float busy; };

Med medium(vec3 p, vec3 rd, float foot) {
  Med m;
  m.sig = vec3(0.0); m.emi = vec3(0.0); m.busy = 0.0;
  float rO = length(p);
  vec3 nO = p / max(rO, 1e-4);


  // ---- large scale: envelope of the whole complex, and the warp for everything finer
  // (the hub sits in a fully cleared region: skip the cloud's shape and detail noise there)
  bool hubZone = rO < 4.5;
  vec4 nL = hubZone ? vec4(0.5) : nzl(p * SC_L + OFF_L, lodFor(foot, SC_L));
  vec3 wL = vec3(nL.r, nL.b, nL.g) * 2.0 - 1.0;
  // a second, mid-scale warp tears the metaball shapes into irregular gas (no rounded cumulus lobes)
#ifndef NEB_NO_EDGEWARP
  vec4 nW = hubZone ? vec4(0.5) : nzl(p * (1.0 / 64.0) + vec3(0.83, 0.27, 0.55), lodFor(foot, 1.0 / 64.0));
#else
  vec4 nW = vec4(0.5);
#endif
  vec3 wW = nW.rgb * 2.0 - 1.0;
  float bf = hubZone ? 0.9 : blobField(p + wL * 9.0 + wW * 8.0);
  float er = 1.0 - bf;
  float edge = 1.0 - smoothstep(0.05, 0.5, bf);    // 1 at the cloud's outer boundary, 0 deep inside
  float lobes = (nL.r - 0.5) * 1.1 + (nL.g - 0.5) * 0.7;
  float env = smoothstep(-0.25, 0.25, bf + lobes * 0.35);
  float dA0 = length(p - uAPos);
  float escape = smoothstep(85.0, 30.0, dA0) * smoothstep(0.15, 0.55, dot((p - uAPos) / dA0, uAOpen));
  if (env <= 0.0 && escape <= 0.0 && rO > 3.0) return m;

  vec3 nA; float rA;
  vec3 tA = tauA(p, foot, nA, rA);

  // ---- detail (domain-warped; combed along the magnetic field; stretched along the light from cluster A near it)
  vec3 pw = p + wL * 7.0;
  vec3 Fd = normalize(uFieldDir.xyz);
  pw -= Fd * dot(pw, Fd) * uFieldDir.w;
  pw -= nA * dot(pw - uAPos, nA) * 0.22 * smoothstep(uAR * 2.2, uAR, rA);
  float lodM = lodFor(foot, SC_M);
  vec4 nM = hubZone ? vec4(0.5) : nzl(pw * SC_M + OFF_M, lodM);
  float lodF = lodFor(foot, SC_F) + 1.0;
  // fine detail only where there is dense gas to detail (not in the rarefied interior of the HII bubble)
  float fl0 = rA - tA.z + (nM.r - 0.5) * 3.6;
#ifndef NEB_NO_PILLARS
  bool nearPil = gPilMask != 0 && length(p - uPilBound.xyz) < uPilBound.w;
#else
  bool nearPil = false;
#endif
#ifndef NEB_NO_COMETS
  bool nearCom = carveCellNear(p) && rA < uAR * 1.05;
#else
  bool nearCom = false;
#endif
  bool needFine = (fl0 > -3.0 || nearPil || rA > uAR * 1.05 || rA < 6.0 || nearCom) && rO < uFineFar;
  vec4 nF = (!hubZone && lodF < 4.2 && needFine) ? nzl(pw * SC_F + (nM.rgb - 0.5) * 0.7 + vec3(0.11, 0.53, 0.97), lodF) : vec4(0.5);
  float fine = mix(0.5, nF.r, uDetail);
  float disp = (nM.r - 0.5) * 2.0 + (fine - 0.5) * 0.9;

  // ---- cloud masses: large-scale lobes with eroded, wispy boundaries; open canyons between them;
  //      a clearing around the hub so the core can be seen
  float base = 1.0 - er;
  float clearing = smoothstep(22.0, 10.0, rO + 4.0 * (nL.g - 0.5));
  float massF = base * 1.3 + lobes - 0.25 - 1.6 * clearing;
  float ero = (1.0 - nM.g) * 0.22 + (0.5 - nM.r) * 0.45 + (0.5 - fine) * 0.3;
  // towards the outer boundary: big ridged tears (mid-scale), a wider, translucent transition, thinner gas
  float rgW = 1.0 - abs(nW.a * 2.0 - 1.0);
  float eroE = ero * (0.65 + 0.55 * edge) + edge * (0.35 * (nW.g - 0.5) + 0.3 * rgW * rgW);
  float mx = massF - eroE;
  float mk = smoothstep(-0.12 * edge, 0.2 + 0.25 * edge, mx);
  float rhoMass = mk * mix(1.0, mk, edge) * (0.45 + 0.9 * nM.r) * env * uMass;
  // tendrils: thin combed filaments trailing off the boundary (ridges of the field-aligned noise)
  float rgd = 1.0 - abs(nM.b * 2.0 - 1.0);
  rgd *= rgd; rgd *= rgd;
  float tendr = rgd * (0.5 + fine) * smoothstep(-0.5, -0.05, mx) * (1.0 - mk) * edge;
  rhoMass += 0.6 * tendr * uMass;
  float diffuse = KD * (0.3 + 1.6 * nM.g * nM.g) * env * (1.0 - 0.95 * clearing);
  float fil = 1.6 * threadsM(nM) * env * (1.0 - mk) * (1.0 - 0.8 * clearing);
  float fl = rA - tA.z + disp * 1.8;              // depth behind cluster A's bubble wall
  float carveA = smoothstep(-1.0, 0.7, fl);
  float layer = KF * exp(-max(fl, 0.0) / LF) * (0.15 + 0.85 * mk) * (0.5 + 1.0 * nM.g) * (0.6 + 0.8 * fine) * smoothstep(0.0, 0.3, env);
  float gas = (rhoMass + diffuse + fil + layer) * carveA;

  // ---- hero front: carves the cavity, compresses a shell, ionises what is inside
#ifndef NEB_NO_HERO
  float fOn = smoothstep(0.0, 0.08, uFront);
  float hH = (fOn > 0.0 || gIon > 0.0) ? heroFront(nO, foot / max(rO, 0.2)) : gFrontR;
#else
  float fOn = 0.0;
  float hH = gFrontR;
#endif
  // the front is not a sphere: it is torn into fingers and bays at the medium scale and frayed at the fine scale
  float ragM = smoothstep(0.3, 0.7, nM.r) - 0.5;                       // contrast-stretched medium-scale bays
  float ridR = 1.0 - abs(nM.b * 2.0 - 1.0); ridR *= ridR; ridR *= ridR;  // sharp ridges -> pillars left standing
  float hR = hH * (1.0 + 0.55 * ragM + 0.2 * (fine - 0.5) - 0.24 * ridR);
  float flH = rO - hR + disp * (0.14 * hR + 0.3);
  float carveH = mix(1.0, smoothstep(-0.12 * hH - 0.4, 0.0, flH), fOn);
  float shellH = fOn * exp(-max(flH, 0.0) / (0.06 * hH + 0.25)) * carveH;
  float keepH = mix(0.01, 1.0, carveH) * (1.0 + 2.0 * shellH);
  // the gas the front has swept up: a thin, clumpy shell (its column grows with the radius)
  float dSh = (rO - hR) / (0.035 * hR + 0.18);
  // swept-up gas breaks into clumps and filaments (never a continuous spherical skin)
  float sweptH = fOn * exp(-dSh * dSh) * (0.12 + 0.012 * hR) * (0.25 + 1.5 * nM.g * fine) * env
               * smoothstep(0.32, 0.72, nM.g * 0.7 + fine * 0.5);

  // ---- hub: gas streams converging on the hero core
  float rhoHub = 0.0;
  float hubMask = 0.0;
#if !defined(NEB_NO_CORE) && !defined(NEB_NO_HUB)
  if (rO < 21.0 && rO > 2.2 && carveH > 0.02) {
#else
  if (false) {
#endif
    vec3 nT = nO;
    nT.xz = rot2(log(rO) * 0.8) * nT.xz;
    vec4 hs = nzl(nT * 1.1 + vec3(0.42, 0.17, 0.66), lodFor(foot / rO, 1.1));
    float s1 = 1.0 - abs(hs.r * 2.0 - 1.0), s2 = 1.0 - abs(hs.b * 2.0 - 1.0);
    s1 *= s1; s1 *= s1; s1 *= s1; s1 *= s1; s1 *= s1;
    s2 *= s2; s2 *= s2; s2 *= s2; s2 *= s2;
    hubMask = s1 * s2;
    rhoHub = 9.0 * hubMask * (3.0 / (rO + 2.0)) * smoothstep(21.0, 11.0, rO) * smoothstep(1.6, 3.2, rO) * env;
    rhoHub *= (0.4 + 1.2 * fine) * carveA * uHub;
  }

  // ---- pillars and their evaporating globules (only inside the pillar field's bounding sphere)
  float egg = 0.0, eggCol = 0.0;
#ifndef NEB_NO_PILLARS
  float rhoPil = nearPil ? pillars(p, disp, fine, foot, egg, eggCol) : 0.0;
#else
  float rhoPil = 0.0;
#endif

  // ---- procedural Bok globules (some with an embryo glowing inside)
  float rhoGlob = 0.0;
  vec3 globEmi = vec3(0.0);
  float globCol = 0.0;
#ifndef NEB_NO_GLOBULES
  {
    vec3 cell = floor(p / 8.0);
    vec4 h = hash44i(ivec4(ivec3(cell) + 512, 911));
    if (h.w < 0.3 && env > 0.2 && foot < 0.25 && carveA > 0.5) {
      vec3 cg = (cell + 0.28 + 0.44 * h.xyz) * 8.0;
      float rg = 0.35 + 1.15 * fract(h.w * 37.1);
      vec3 vg = p - cg + (nM.rgb - 0.5) * rg * 1.4;
      float dg = length(vg);
      if (dg < rg * 1.7) {
        float x = dg / rg + 0.5 * (nM.g - 0.5) + 0.7 * (fine - 0.5);
        rhoGlob = 2.6 * exp(-2.2 * x * x) * smoothstep(1.5, 0.3, x);
        float bb = dot(vg, -nA);
        globCol = rhoGlob * max(-bb + sqrt(max(bb * bb - dg * dg + rg * rg, 0.0)), 0.0);
        vec4 h2 = hash44i(ivec4(ivec3(cell) + 512, 313));
        if (h2.x < 0.4) {
          float Le = 0.1 + 0.25 * h2.y;
          float colE = 2.6 * rg * (1.0 - exp(-dg / (0.5 * rg)));
          globEmi = rhoGlob * Le / (dg * dg + 0.01) * transL(colE) * gColEmb * 0.06;
        }
      }
    }
  }
#endif

  // ---- cometary globules inside cluster A's bubble: dense heads lit on the side facing the cluster, with dark
  //      shadow tails pointing away from it; some hide an embryo glowing red through the dust. A globule may reach
  //      into the next cell along its tail, so the point's own cell and the cell towards the cluster are both tested.
  float rhoCom = 0.0;
  float comCol = 0.0;
  vec3 comEmi = vec3(0.0);
#ifndef NEB_NO_COMETS
  if (carveA < 0.6 && rA < uAR * 1.05 && rA > 6.0) {
    vec3 c0 = floor(p / 7.0), c1 = floor((p - nA * 5.0) / 7.0);
    for (int k = 0; k < 2; k++) {
      vec3 cell = k == 0 ? c0 : c1;
      if (k == 1 && all(equal(c1, c0))) break;
      vec4 h = hash44i(ivec4(ivec3(cell) + 777, 4243));
      if (h.w >= 0.2) continue;
      vec3 cg = (cell + 0.3 + 0.4 * h.xyz) * 7.0;
      vec3 axg = normalize(cg - uAPos);                 // the tail points away from the cluster
      float sz = fract(h.w * 53.3);
      float rg = 0.3 + 1.1 * sz * sz;
      vec3 vg = p - cg + (nM.rgb - 0.5) * rg * 1.6 + (fine - 0.5) * rg * 0.6;
      float sAx = dot(vg, axg);
      vec3 perp = vg - axg * sAx;
      float tailL = rg * (3.0 + 4.0 * fract(h.w * 17.9));
      // head + tapering tail (distance-like field); the tail and its shadow dissolve smoothly at the end
      float tailEnd = smoothstep(0.6 * tailL, 1.2 * tailL, sAx);
      float tailR = rg * mix(0.85, 0.15, clamp(sAx / tailL, 0.0, 1.0));
      float dHead = length(vg) / rg;
      float dTail = sAx > 0.0 ? length(perp) / max(tailR, 1e-3) + 3.0 * tailEnd : 1e3;
      // fraying in the globule's own scale (scale-invariant: a big globule is as torn as a small one), so no globule
      // ever shows a clean round silhouette: lumpy lobes, ridged tears, wisps peeling off towards the light
      vec3 lq = vg / rg;
      float lodq = clamp(log2(max(foot / rg, 1e-4) * 48.0), 0.0, 5.0);
      float f1 = nzl(lq * 0.33 + h.xyz * 7.1, lodq).r;
      float f2 = nzl(lq * 0.85 + h.zyx * 3.3, lodq + 0.5).g;
      float f3 = nzl(lq * 2.1 + h.yxz * 5.7, lodq + 1.0).r;
      float tear = 1.0 - abs(f1 * 2.0 - 1.0); tear *= tear;
      // small globules fray strongly; the big ones keep a denser core (the embryo's cocoon must stay dark)
      float fk = mix(2.0, 1.0, smoothstep(0.7, 1.2, rg));
      float fray = fk * (1.2 * (f1 - 0.5) + 0.8 * (f2 - 0.5) + 0.45 * (f3 - 0.5)) - 0.55 * fk * tear * smoothstep(0.4, 1.2, dHead);
      float dd = min(dHead, dTail) + 0.45 * (nM.g - 0.5) + 0.6 * (fine - 0.5) + 0.25 * disp + fray;
      if (dd > 2.2 && sAx < 0.0) continue;
      // soft gas, not a ball: gaussian core, eroded and frayed edges, a streaky dissolving tail
      float head = exp(-1.5 * max(dd, 0.0) * max(dd, 0.0)) * smoothstep(1.9, 0.0, dd);
      float streak = sAx > 0.0 ? 0.55 + 0.9 * (1.0 - abs(fine * 2.0 - 1.0)) : 1.0;
      float rc = head * streak * mix(3.0, 0.9, clamp(sAx / tailL, 0.0, 1.0));
      rhoCom += rc;
      // light from the cluster: through the head (closed-form chord) -> the tail sits in the head's shadow
      float bb = dot(vg, -axg);
      // the light sees the same torn body (not the ideal sphere), so the lit rim is ragged too
      float rgL = rg * clamp(1.0 - 0.75 * fray, 0.35, 1.6);
      float chord = max(-bb + sqrt(max(bb * bb - dot(vg, vg) + rgL * rgL, 0.0)), 0.0);
      // opaque core, translucent frayed edges: backlit, the body stays dark and only the rim glows
      comCol += 1.4 * rc * chord + 2.5 * rc * rg
              + (sAx > 0.0 ? 3.0 * rg * smoothstep(rg * 1.2, rg * 0.5, length(perp)) * (1.0 - tailEnd) : 0.0);
      vec4 h2 = hash44i(ivec4(ivec3(cell) + 777, 99));
      if (h2.x < 0.45) {
        float de = length(vg);
        float colE = 3.0 * rg * (1.0 - exp(-de / (0.4 * rg)));
        comEmi += rc * (0.15 + 0.3 * h2.y) / (de * de + 0.01) * transL(colE) * gColEmb * 0.14;
      }
    }
  }
#endif

  // ---- cluster B: embryos in dark cocoons; ignition blows a bubble and lights the gas around it
  float rhoCoc = 0.0;
  vec3 cluEmi = vec3(0.0);
  float keepB = 1.0;
#ifndef NEB_NO_CLUSTER
  if (gCluMask != 0 && rO < uCluBound) {
    float gas0 = (gas + rhoHub + rhoGlob) * keepH;
    for (int i = 0; i < NCLU; i++) {
      if (i >= uCluN) break;
      if ((gCluMask & (1 << i)) == 0) continue;
      vec3 v = p - uClu[i].xyz;
      float d2 = dot(v, v);
      float th = uClu[i].w;
      if (d2 > (uCluster > th ? 49.0 : 9.0)) continue;
      float d = sqrt(d2);
      float ign = smoothstep(th, th + 0.05, uCluster);
      float coc = 2.6 * exp(-d2 / 1.0) * (0.35 + 1.3 * nM.g) * (0.6 + 0.8 * fine);
      float rb = 0.2 + 3.4 * sqrt(ign);
      float inB = ign * smoothstep(rb, 0.75 * rb, d);
      keepB = min(keepB, 1.0 - 0.95 * inB);
      coc *= 1.0 - inB;
      rhoCoc += coc;
      // pre-ignition: a dull red glow escaping through the cocoon
      if (coc > 1e-3 && ign < 1.0) {
        float colIn = 2.6 * (1.0 - exp(-d / 0.6));
        cluEmi += coc * 0.35 * (1.0 - ign) / (d2 + 0.01) * transL(colIn) * gColEmb * 0.08;
      }
      if (ign > 0.0) {
        float fl2 = ign * exp(-max(uCluster - th - 0.02, 0.0) / 0.035);
        float F = ign * 16.0 * (1.0 + 4.0 * fl2) / (d2 + 0.1);
        float colS = 2.0 * max(d - rb, 0.0);
        float rhoL = gas0 + coc;
        cluEmi += uScat * 0.6 * rhoL * F * transL(colS) * dustPhase(-dot(rd, v / max(d, 1e-3))) * gColB;
        float ne = gas0 * 0.08 * inB + 0.002 * inB;
        cluEmi += uEmit * rhoL * F * exp(-uDust * colS * 3.0) * lineMix(ionX(F, rhoL)) * 0.3;
        cluEmi += uEmit * EMK * ne * ne * lineMix(ionX(F, ne));
      }
    }
  }
#endif

  // ---- hero core
  float dsk = 0.0;
#ifndef NEB_NO_CORE
  float rhoCore = (rO < 3.0 && uFront < 0.25) ? coreDens(p, foot, dsk) : 0.0;
#else
  float rhoCore = 0.0;
#endif

  // ---- assemble the neutral (dusty) gas
  float pilAll = (rhoPil + egg) * mix(0.15, 1.0, carveH);
  float rho = (gas + rhoHub + rhoGlob) * keepH * keepB + rhoCoc + pilAll + rhoCore + sweptH + rhoCom * keepH;
  // ionised gas: rarefied inside cluster A's bubble, brighter in the photo-evaporation flows hugging every lit
  // surface, and escaping through the blister opening
  float flowA = rA < tA.y ? exp(-(tA.y - rA) / 1.7) : 0.0;
  float inBub = (1.0 - carveA) * smoothstep(0.0, 0.25, env) * smoothstep(uAR * 1.6, uAR * 0.9, rA);
  float stru = smoothstep(0.3, 0.85, nL.g * 0.7 + nM.g * 0.6 - 0.12);
  float plume = 0.0;
  if (escape > 0.0) {
    vec4 ry = nzl(nA * 5.0 + vec3(0.33, 0.66, 0.99), lodFor(foot / rA, 5.0));
    float rays = smoothstep(0.25, 0.75, ry.r) * 0.4 + 0.6;
    float sheets = smoothstep(0.25, 0.8, nM.g * 0.6 + nL.r * 0.6 + 0.25 * (fine - 0.5));
    plume = escape * (1.0 - env) * sheets * rays * (0.35 + 0.65 * smoothstep(0.55, 0.15, abs(nM.r - 0.5) * 2.0));
  }
  float tealZone = smoothstep(0.85, 0.45, rA / max(min(tA.y, tA.z), 1.0));
  float neA = (inBub * (0.002 + 0.006 * stru) * (1.0 + 0.8 * tealZone) * uBubA + 0.011 * plume + 0.018 * flowA * (0.3 + 1.2 * nM.g)) * keepH;

  // ---------------------------------------------------------------- lighting
  vec3 emi = globEmi + cluEmi + comEmi;
  // cluster A (flux capped by the cluster's own extent)
  float FA = uALum / (rA * rA + 60.0);
  float colA = tA.x + globCol + eggCol + comCol;
  // scattered light and the ionisation skin only where starlight still arrives (optical depth < ~14)
  if (rho > 1e-3 && uDust * colA < 14.0) {
    vec3 TA = transL(colA);
    float TAi = exp(-uDust * colA * 1.6 * clamp(0.25 / foot, 0.12, 1.0));
    // local self-shadowing: one short tap of the medium-scale masses towards the light
    float sh = 1.0;
#ifndef NEB_NO_SELFSHADOW
    if (rho > 0.05 && FA * TA.r > 0.02 && lodM < 2.5 && !hubZone) {
#else
    if (false) {
#endif
      vec4 a = nzl((pw - nA * 1.6) * SC_M + OFF_M, lodM + 0.5);
      float eroT = (1.0 - a.g) * 0.22 + (0.5 - a.r) * 0.45 + (0.5 - fine) * 0.3;
      float mkT = smoothstep(-0.12 * edge, 0.2 + 0.25 * edge, massF - eroT * (0.65 + 0.55 * edge));
      sh = exp(-uDust * carveA * env * mkT * (0.45 + 0.9 * a.r) * 1.6 * uMass);
    }
    float ph = dustPhase(-dot(rd, nA));
    vec3 eScat = uScat * 0.6 * rho * FA * TA * sh * ph * gColA * vec3(1.0, 0.93, 0.82);
    emi += eScat;
    // ionisation-front skin on the dense gas (thin: ionising photons die fast)
    vec3 eSkin = uEmit * rho * FA * TAi * sh * lineMix(ionX(FA * TAi, rho)) * 0.02;
    emi += eSkin;
  }
  // photon-limited recombination glow of the ionised gas: brightest near the ionising stars, [O III] inside
  if (neA > 1e-4) {
    float strat = smoothstep(0.85, 0.45, rA / max(min(tA.y, tA.z), 1.0));
    emi += uEmit * neA * FA * 0.035 * lineMix(max(strat, ionX(FA, neA) * 0.25));
    m.busy += neA * 25.0;
  }
  // hero star
#ifndef NEB_NO_HERO
  float rrH = max(rO, 0.015);
  float FH = gHeroL / (rrH * rrH + 0.004);
  // (before ignition the protostar only lights its immediate surroundings: skip where its light is negligible)
  if (gHeroL > 0.0 && (rho > 1e-3 || fOn > 0.0) && (gIon > 0.0 || (rO < 4.0 && FH * rho > 2e-4))) {
    float rr = rrH;
    float muH = abs(p.y) / rr;
    float colD = gDiskR > 0.0 ? 9.0 * smoothstep(0.0, 0.3, gDiskR) * exp(-muH * muH / 0.03) * smoothstep(0.02, 0.08, rr) : 0.0;
    float colH = colD + (rO < 3.0 ? coreSmooth(p * 0.5) * 1.2 * (1.0 - gIon) : 0.0);
    // light penetrates ~0.6 into the gas beyond the front; when the march samples coarsely, widen that lit layer
    // (and dim it to keep its integral) so coarse samples do not turn it into speckle
    float Lp = max(0.6, 1.5 * foot);
    float kp = 0.6 / Lp;
    if (gIon > 0.0) {
      float x = max(rO - hR, 0.0);
      colH += (2.5 + 2.0 * fOn) * (1.0 - exp(-x / Lp)) + KM * x;
      // radial streams point at the star and shadow themselves along their length (bright tips, dark spokes)
      colH += 12.0 * hubMask * max(log((rO + 2.0) / 5.0), 0.0) * uHub;
    }
    vec3 TH = transL(colH);
    float ph = dustPhase(-dot(rd, nO));
    emi += uScat * 0.6 * rho * FH * TH * ph * gHeroCol * mix(1.0, kp, gIon);
    if (gIon > 0.0) {
      float THi = exp(-uDust * colH * 3.0);
      // inside the evacuated cavity only wisps of residual gas glow (no uniform fill: the cavity must not read as an orb)
      float wispH = mix(smoothstep(0.42, 0.8, nM.g * 0.55 + fine * 0.55 + 0.15 * nM.r), 1.0, carveH);
      emi += uEmit * gIon * rho * FH * THi * lineMix(ionX(FH * THi, rho)) * 0.06 * kp * wispH;
      // the cavity is evacuated: a thin, patchy ionised fill (the young cluster must stay visible through it)
      float neH = gIon * fOn * ((gas + 0.25 * rhoHub) * 0.05 + 0.0018 * smoothstep(0.3, 0.8, nM.g + 0.3 * (fine - 0.5))) * (1.0 - carveH);
      // the ionised fill thins out towards the front, so the cavity has no glassy outline
      neH *= smoothstep(1.05, 0.45, rO / max(hR, 0.5)) * 0.45 * smoothstep(0.4, 0.82, nM.g * 0.55 + fine * 0.55 + 0.12 * nM.r);
      float stratH = smoothstep(0.8, 0.4, rO / max(hR, 0.5));
      emi += uEmit * neH * min(FH, 40.0) * 0.035 * lineMix(stratH);
      m.busy += neH * 25.0;
    }
  }
#endif
  // core: disk thermal glow (accretion heated) + key light
#ifndef NEB_NO_CORE
  if (rhoCore > 0.004) {
    float heat = smoothstep(0.42, 1.0, uCollapse) * (1.0 - gIon);
    float R = length(p.xz);
    float Td = mix(900.0, 2300.0, heat) * pow(max(R, 0.03) / 0.05, -0.45);
    float sb = Td / 1500.0;
    emi += dsk * heat * 0.25 * bbColor(Td) * sb * sb * sb * sb;
    emi += coreGlow(p, rhoCore - dsk);
    if (uKey.w > 0.0) {
      vec3 l = normalize(uKey.xyz);
      float colK = coreSmooth(p + l * 0.5) * 1.6;
      emi += uScat * 0.6 * rhoCore * uKey.w * transL(colK) * (0.5 * hg(dot(rd, l), 0.8) + 0.5 * dustPhase(dot(rd, l))) * uKeyCol;
    }
  }
#endif
  // external light (galactic radiation field): shadowed by the chord through the cloud towards it + one local tap
#ifndef NEB_NO_RIM
  if (uRim.w > 0.0 && rho > 0.01) {
    vec3 l = normalize(uRim.xyz);
    vec4 a = nzl((pw + l * 2.5) * SC_M + OFF_M, lodM + 0.5);
    float mkT = smoothstep(-0.12 * edge, 0.2 + 0.25 * edge, massF - ((1.0 - a.g) * 0.22 + (0.5 - a.r) * 0.45 + (0.5 - fine) * 0.3) * (0.65 + 0.55 * edge));
    float col = blobColumn(p + wL * 9.0 + wW * 8.0, l) * 0.2 + mkT * (0.45 + 0.9 * a.r) * 2.5;
    float ph = 0.6 * hg(dot(rd, l), 0.86) + 0.4 * dustPhase(dot(rd, l));
    emi += uScat * 0.6 * rho * uRim.w * exp(-uDust * col * uExt) * ph * uRimCol;
  }
#endif
  // Herbig-Haro bow shocks at the jet heads: paraboloid shells opening back towards the star
#ifndef NEB_NO_CORE
  if (uJet > 0.0) {
    float L = gJetLen;
    float ay = abs(p.y);
    float Rj = length(p.xz);
    float hsz = 0.05 * L + 0.05;
    if (ay > L - 3.0 * hsz && ay < L + hsz && Rj < 2.6 * hsz) {
      float yb = L - Rj * Rj / (1.6 * hsz);
      float d = (ay - yb) / (0.16 * hsz);
      float brk = smoothstep(0.35, 0.75, nzl(p * (2.0 / hsz) * 0.05 + vec3(0.3, 0.1, 0.7), 0.0).r);
      float bow = exp(-d * d) * smoothstep(2.6 * hsz, 0.4 * hsz, Rj) * brk;
      float blast = smoothstep(1.0, 2.0, uJet);
      emi += bow * (uHa * 0.7 + uS2 * 0.6) * (1.2 * min(uJet, 1.0) + 2.0 * blast) * 1.6 / (1.0 + 0.15 * L);
      m.busy += bow * 4.0;
    }
  }
#endif
  // faint glow of the diffuse gas in the canyons: a backdrop that the dense structures silhouette against
  emi += uAmb * diffuse * carveA * keepH * smoothstep(0.35, 0.8, nL.g + 0.25 * (nM.b - 0.5)) * vec3(1.0, 0.32, 0.22) * 0.5;

  m.sig = uDust * rho * uExt;
  m.emi = emi;
  m.busy += rho * 3.0 + max(emi.r, max(emi.g, emi.b)) * 6.0;
  return m;
}

// step: a fraction of the distance (pixel-footprint aware), longer through empty space, short near the core
float stepFor(float t, float pa, float busy, vec3 p) {
  float dt = max(uStepK * t, uStepMin);
  dt *= mix(3.2, 1.0, clamp(busy * 1.5, 0.0, 1.0)) * mix(1.0, 0.7, clamp((busy - 1.0) / 4.0, 0.0, 1.0));
  float rO = length(p);
  dt *= mix(1.0, uOuterStep, smoothstep(5.0, 9.0, rO));
#ifndef NEB_NO_CORE
  // the core has its own scale: fine steps near the protostar (never finer than a quarter of the footprint step)
  if (uFront < 0.25) {
    if (rO < 3.2) dt = min(dt, max((0.05 + 0.11 * rO) * uCoreStep, 0.25 * uStepK * t));
    // approaching the core from outside: never step past its envelope
    else dt = min(dt, max(rO - 3.0, 0.05) + 0.2);
  }
#endif
  return min(dt, 9.0);
}
