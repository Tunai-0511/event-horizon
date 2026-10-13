// Schwarzschild black hole, ray traced per pixel.
// Units: Schwarzschild radius r_s = uLens (1 for a fully formed hole). Light follows null geodesics, integrated
// with RK4 in the Cartesian "Binet" form  x'' = -3/2 r_s h^2 x / r^5  (h = |x × x'|, conserved),
// which reproduces u'' + u = 3/2 r_s u^2 exactly.  Emission: thin accretion disk (Novikov–Thorne temperature,
// Doppler + gravitational shift on a blackbody), optional volumetric haze, jets, a background shell, the sky.
#include "common.glsl"
#include "sky.glsl"
#include "remnant_lib.glsl"

uniform float uLens;        // r_s (0 = no gravity, flat space)
uniform float uObsStatic;   // 1: camera is a static observer at |uCamPos| (local-frame aberration + blueshift)
uniform float uObsFall;     // 1: camera falls freely from rest at infinity (the "rain" frame; valid inside the horizon)
uniform float uRfar;        // integration bound
// disk
uniform float uDisk;        // overall amount 0..1
uniform float uDiskIn;      // inner edge (ISCO = 3 r_s)
uniform float uDiskOut;     // outer edge
uniform float uDiskTemp;    // peak temperature (K)
uniform float uDiskBright;  // emission multiplier
uniform float uDiskTau;     // optical depth scale
uniform float uDoppler;     // 0..1 how much of the relativistic shift is shown
uniform float uBeam;        // extra intensity beaming exponent weight
uniform float uDiskSpeed;   // inner-edge orbits per second (cinematic time)
uniform float uDiskTurb;    // texture contrast
uniform float uDiskSeed;
uniform float uDiskSat;     // chroma boost of the thermal colour (1 = pure blackbody)
// haze (thick, faint corona around the disk)
uniform float uHaze;
uniform float uHazeH;
// jets along +-y
uniform float uJet;
uniform float uJetLen;
// misc
uniform float uSkyAmt;
uniform float uFlash;       // global emission flash (adds hot light from the disk plane)
uniform float uReveal;      // < 1: only a random subset of pixels has been 'computed' so far (the image develops)

#ifndef MAXSTEPS
#define MAXSTEPS 420
#endif

float RS;
float H2;

vec3 accel(vec3 x) {
  float r2 = dot(x, x);
  return -1.5 * RS * H2 * x / (r2 * r2 * sqrt(r2));
}

// ---- accretion disk ----------------------------------------------------------------------------
uniform float uDiskTime;    // disk clock (s); differential rotation shears the texture with it
uniform float uForm;        // 0..1 disk formation: infalling spiral streams (cold, sparse) -> full hot disk
uniform float uIgnFront;    // ignition front radius (r_s); gas inside it burns at full temperature. <= 0: no ignition effect
uniform float uIgnWidth;    // width of the bright front
uniform float uEmber;       // brightness of not-yet-ignited gas (relative)
uniform float uIgnFlash;    // flare at the inner edge when ignition starts
uniform float uIgnDir;      // +1: gas inside the front burns (front moving out); -1: the disk exists only outside the front (gas spreading inward from a ring)

// x = how ignited the gas at radius r is (0 ember .. 1 burning), y = glow of the passing front
vec2 ignition(float r) {
  if (uIgnFront <= 0.0) return vec2(1.0, 0.0);
  float lit = uIgnDir < 0.0 ? smoothstep(uIgnFront - uIgnWidth, uIgnFront + uIgnWidth * 0.5, r)
                            : smoothstep(uIgnFront + uIgnWidth, uIgnFront - uIgnWidth * 0.5, r);
  float d = (r - uIgnFront) / uIgnWidth;
  return vec2(lit, exp(-d * d));
}

// surface density texture in co-rotating polar coordinates (log r, angle): anisotropic -> streaks along the orbit
float diskDensity(float r, float phi, float lod0) {
  float om = pow(uDiskIn / r, 1.5);
  float a = phi - om * uDiskTime * TAU * uDiskSpeed;
  float lr = log(r / uDiskIn);
  float u = a / TAU;
  // large clumps / gaps, puffy mid-scale billows, finer turbulence, faint filaments (decreasing anisotropy)
  float big = nzl(vec3(lr * 1.4, u * 2.0, uDiskSeed), lod0).r;
  float mid = nzl(vec3(lr * 4.0, u * 5.0, uDiskSeed + 0.31), lod0).g;
  float fine = nzl(vec3(lr * 14.0, u * 13.0, uDiskSeed + 0.63), lod0 + 0.5).r;
  float fil = nzl(vec3(lr * 40.0, u * 31.0, uDiskSeed + 0.87), lod0 + 1.5).b;
  float rings = nzl(vec3(lr * 6.0, 0.37, uDiskSeed + 0.5), 0.0).b;
  float n = big * 0.48 + mid * 0.30 + fine * 0.15 + fil * 0.07;
  float d = 0.06 + 2.2 * smoothstep(0.40 - 0.10 * uDiskTurb, 0.70, n);
  d *= 0.55 + 0.9 * smoothstep(0.30, 0.70, rings);
  d *= 0.8 + 0.4 * fine;
  // ragged outer edge
  float edge = smoothstep(0.0, 0.35, (1.0 - r / uDiskOut) * 1.6 + (big - 0.5) * 0.9);
  if (uForm < 1.0) {
    // formation: gas arrives along two trailing spiral streams that wind up and fill in
    float wind = mix(2.2, 9.0, uForm);
    float arm = 0.5 + 0.5 * cos(2.0 * (a + wind * lr * 0.35) + big * 2.0);
    arm = pow(arm, mix(9.0, 1.0, uForm * uForm));
    float inner = smoothstep(uDiskIn * mix(4.0, 0.9, sqrt(uForm)), uDiskIn * mix(6.0, 1.1, sqrt(uForm)), r);
    d *= mix(arm * inner * 1.6, 1.0, smoothstep(0.55, 1.0, uForm));
  }
  return d * edge;
}

float ntProfile(float r) {
  float x = uDiskIn / r;
  float prof = pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25) / 0.488;
  return r < uDiskIn ? 0.22 * smoothstep(uDiskIn * 0.9, uDiskIn, r) : prof;
}

float gShift(float r, float Ly, float gObs) {
  float Om = sqrt(0.5 * RS / (r * r * r));
  float ut = 1.0 / sqrt(max(1.0 - 1.5 * RS / r, 0.02));
  return mix(1.0, gObs / (ut * (1.0 - Om * Ly)), uDoppler);
}

// emission (rgb) and alpha for a crossing of the disk mid-plane at p
vec4 diskShade(vec3 p, float Ly, float gObs, float pixw) {
  float r = length(p.xz);
  if (r < uDiskIn * 0.9 || r > uDiskOut) return vec4(0.0);
  float phi = atan(p.z, p.x);
  float prof = ntProfile(r);
  float d = diskDensity(r, phi, max(0.0, log2(pixw * 300.0 / r)));
  float g = gShift(r, Ly, gObs);
  vec2 ig = ignition(r);
  if (uIgnDir < 0.0) d *= min(ig.x + 1.3 * ig.y, 1.6);       // inside the inward-moving front there is no gas yet
  float flare = uIgnFlash * exp(-(r - uDiskIn) / 1.6);
  float T = uDiskTemp * prof * (0.9 + 0.12 * d) * mix(0.55, 1.0, ig.x) * (1.0 + 0.3 * ig.y + 0.25 * flare) * g;
  vec3 bc = bbColor(T);
  bc = max(mix(vec3(lum(bc)), bc, uDiskSat), 0.0);
  vec3 e = bc * bbLum(T) / bbLum(uDiskTemp) * pow(g, 3.0 * uBeam);
  e *= d * uDiskBright * mix(1.0, prof, 0.6) * (mix(uEmber, 1.0, ig.x) + 1.4 * ig.y + 2.5 * flare);
  float alpha = 1.0 - exp(-uDiskTau * d * (0.25 + 1.2 * prof));
  return vec4(e, alpha) * uDisk;
}

// puffy volume around the mid-plane: same texture, Gaussian in height, flaring with radius
vec4 hazeSample(vec3 p, float Ly, float gObs) {
  float r = length(p.xz);
  if (r < uDiskIn * 0.85 || r > uDiskOut) return vec4(0.0);
  float H = uHazeH * r;
  float y = p.y / H;
  float vert = exp(-y * y);
  if (vert < 0.02) return vec4(0.0);
  float phi = atan(p.z, p.x);
  float d = diskDensity(r, phi + p.y * 0.8, 1.0) * vert;
  // vertical billows
  d *= 0.5 + nzl(vec3(p.x, p.y * 3.0, p.z) * 0.12 + uDiskSeed, 1.0).g;
  float prof = ntProfile(r);
  float g = gShift(r, Ly, gObs);
  vec2 ig = ignition(r);
  float T = uDiskTemp * max(prof, 0.08) * mix(0.55, 1.0, ig.x) * (1.0 + 0.3 * ig.y) * g;
  vec3 bc = bbColor(T);
  bc = max(mix(vec3(lum(bc)), bc, uDiskSat), 0.0);
  vec3 e = bc * bbLum(T) / bbLum(uDiskTemp) * d * uHaze * 0.7 * (mix(uEmber, 1.0, ig.x) + 1.2 * ig.y);
  return vec4(e, d * uHaze * 0.22 * (0.25 + prof));
}

// relativistic jets: collimated, knotty, blue-white synchrotron glow
vec4 jetSample(vec3 p) {
  float y = abs(p.y);
  if (y < 1.5 || y > uJetLen) return vec4(0.0);
  float rad = length(p.xz);
  float w = 0.35 + 0.045 * y;
  float core = exp(-pow(rad / w, 2.0));
  if (core < 0.003) return vec4(0.0);
  float s = y - uTime * 6.0;
  float knots = 0.6 + 0.8 * pow(nzl(vec3(p.x * 0.05, s * 0.012, p.z * 0.05 + sign(p.y) * 0.5), 1.0).r, 3.0);
  float fall = smoothstep(1.5, 4.0, y) * pow(1.0 - y / uJetLen, 1.5) / (1.0 + 0.02 * y);
  vec3 c = mix(vec3(0.55, 0.7, 1.0), vec3(0.9, 0.95, 1.0), core);
  return vec4(c * core * knots * fall * uJet * 2.0, 0.0);
}


// ---- objects carried along the curved rays --------------------------------------------------------








#ifdef HAS_SOLAR
// Our solar system, drawn in light: the Sun and the planets are point sources, their orbits hair-thin lines of light in
// the ecliptic plane. Everything is evaluated along the bent rays, so it is lensed like the rest of the scene.
uniform vec3 uSunPos;
uniform vec3 uSunVel;       // r_s per film second (motion streak)
uniform float uSunFlux;
uniform float uSunTemp;
uniform vec4 uPl[8];        // planet position xyz, flux w
uniform vec3 uPlVel[8];     // planet velocity (r_s per film second)
uniform float uOrbPh[8];    // orbital phase of each planet in the ecliptic (from uEclX)
uniform float uPlHeat[8];   // 0..1 incandescence of a planet being vaporised
uniform vec4 uOrb[8];       // orbit radius, line brightness, drawn fraction of the circle (behind the planet), tidal elongation
uniform vec3 uEclN;         // ecliptic normal
uniform vec3 uEclX;         // in-plane axis pointing to the hole
uniform float uOrbW;        // line width (pixels)
uniform float uOrbR;        // bounding radius of all drawn orbits around the Sun (r_s)
uniform float uSubDt;       // film seconds covered by one sub-frame
uniform vec3 uCamVel;       // camera velocity (streaks are relative to the camera)
// the road in: the infall path drawn as light behind whatever is travelling it (planets after they are torn away, the Sun)
uniform float uPathR[96];   // r(phi) of the infall path, uniform in phi
uniform float uPathPhi0;
uniform float uPathPhi1;
uniform vec3 uPathN;        // normal of the infall plane (through the hole)
uniform vec3 uPathE1;       // in-plane axis where phi = 0
uniform float uTrHead[9];   // phi of each traveller (8 planets, then the Sun)
uniform float uTrTail[9];   // phi where its trail fades out
uniform float uTrAmt[9];

const vec3 PLCOL[8] = vec3[8](vec3(0.80, 0.76, 0.72), vec3(1.00, 0.88, 0.70), vec3(0.42, 0.66, 1.00), vec3(1.00, 0.52, 0.32),
                              vec3(1.00, 0.84, 0.64), vec3(1.00, 0.86, 0.58), vec3(0.58, 0.90, 1.00), vec3(0.42, 0.58, 1.00));

// squared distance between segments [p1,q1] and [p2,q2] (Ericson, Real-Time Collision Detection 5.1.9)
float segSegD2(vec3 p1, vec3 q1, vec3 p2, vec3 q2) {
  vec3 d1 = q1 - p1, d2 = q2 - p2, r = p1 - p2;
  float a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  float s, t;
  if (e <= 1e-14) { t = 0.0; s = clamp(-dot(d1, r) / max(a, 1e-14), 0.0, 1.0); }
  else {
    float c = dot(d1, r), b = dot(d1, d2), den = a * e - b * b;
    s = den > 1e-14 ? clamp((b * f - c * e) / den, 0.0, 1.0) : 0.0;
    t = (b * s + f) / e;
    if (t < 0.0) { t = 0.0; s = clamp(-c / max(a, 1e-14), 0.0, 1.0); }
    else if (t > 1.0) { t = 1.0; s = clamp((b - c) / max(a, 1e-14), 0.0, 1.0); }
  }
  vec3 dd = (p1 + d1 * s) - (p2 + d2 * t);
  return dot(dd, dd);
}
#endif


#ifdef HAS_SIM
// SPH simulation volume (tools/sph -> app/src/sim.js): two nested boxes, each an RGBA16F pair
//   A = (rho, rho*T/1e4, rho*vx, rho*vy), B = (rho*vz, ...); rho in units of a reference density; T a colour temperature.
// Radiative transfer along the bent ray: source function = blackbody at the Doppler / gravitationally shifted T,
// extinction coefficient = kappa * rho^p.
uniform highp sampler3D uSimA0;
uniform highp sampler3D uSimB0;
uniform highp sampler3D uSimA1;
uniform highp sampler3D uSimB1;
uniform vec4 uSimBox0;
uniform vec4 uSimBox1;
uniform float uSimRes;
uniform float uSimOccLod;   // mip level of the density used as occupancy
uniform float uSimKappa;
uniform float uSimRhoPow;
uniform float uSimBright;
uniform float uSimDoppler;
uniform float uSimTMax;
uniform float uSimSat;
float gSimStep;
bool inBox(vec3 q) { return all(greaterThan(q, vec3(0.0))) && all(lessThan(q, vec3(1.0))); }
// suggested step length at p (empty-space skipping through the occupancy grids)
float simStepAt(vec3 p) {
  vec3 q0 = (p - (uSimBox0.xyz - uSimBox0.w)) / (2.0 * uSimBox0.w);
  float cells = uSimRes / exp2(uSimOccLod);
  if (inBox(q0)) {
    if (textureLod(uSimA0, q0, uSimOccLod).r > 1e-7) return 0.55 * 2.0 * uSimBox0.w / uSimRes;
    return 0.5 * 2.0 * uSimBox0.w / cells;
  }
  vec3 q1 = (p - (uSimBox1.xyz - uSimBox1.w)) / (2.0 * uSimBox1.w);
  if (inBox(q1)) {
    if (textureLod(uSimA1, q1, uSimOccLod).r > 1e-7) return 0.55 * 2.0 * uSimBox1.w / uSimRes;
    return 0.5 * 2.0 * uSimBox1.w / cells;
  }
  // outside both: distance to the outer box (Chebyshev)
  vec3 d = abs(p - uSimBox1.xyz) - uSimBox1.w;
  return max(max(d.x, max(d.y, d.z)), 0.05);
}
vec4 simSample(vec3 p, vec3 dir, float gObs) {
  vec4 A, B;
  vec3 q0 = (p - (uSimBox0.xyz - uSimBox0.w)) / (2.0 * uSimBox0.w);
  if (inBox(q0)) { A = textureLod(uSimA0, q0, 0.0); B = textureLod(uSimB0, q0, 0.0); }
  else {
    vec3 q1 = (p - (uSimBox1.xyz - uSimBox1.w)) / (2.0 * uSimBox1.w);
    if (!inBox(q1)) return vec4(0.0);
    A = textureLod(uSimA1, q1, 0.0); B = textureLod(uSimB1, q1, 0.0);
  }
  float rho = A.r;
  if (rho < 1e-6) return vec4(0.0);
  float T = A.g / rho * 1e4;
  vec3 vel = vec3(A.b, A.a, B.r) / rho;
  float r = length(p);
  float v2 = min(dot(vel, vel), 0.96);
  float g = sqrt(max(1.0 - RS / r, 0.0)) * sqrt(1.0 - v2) / (1.0 + dot(vel, dir));
  g = mix(1.0, g * gObs, uSimDoppler);
  float Ts = min(T, uSimTMax) * g;
  vec3 bc = bbColor(Ts);
  bc = max(mix(vec3(lum(bc)), bc, uSimSat), 0.0);
  vec3 S = bc * (bbLum(Ts) / bbLum(6000.0)) * uSimBright;
  float k = uSimKappa * pow(rho, uSimRhoPow);
  return vec4(S, k);
}
#endif


void main() {
  if (uReveal < 1.0) {
    // pixels finish in a random order (blocks of 2x2 so the quad derivatives stay valid)
    float hr = hash21(floor(gl_FragCoord.xy / 2.0) + 0.5);
    if (hr > uReveal) { emit(vec3(0.0)); return; }
  }
  vec3 rd = camRay();
  vec3 x = uCamPos;
  float rnd0 = pixelRand(gl_FragCoord.xy, uSeed).x;
  RS = max(uLens, 0.0);
  float r0 = length(x);
  float gObs = 1.0;
  if (uObsFall > 0.5 && RS > 0.0) {
    // free-fall (rain) observer, radial velocity v = sqrt(r_s/r) inward relative to static observers (any r > 0).
    // A photon arriving from view direction d (radial part d_r): the backward ray's Schwarzschild-coordinate
    // direction is (d_r + v) r̂ + d_perp, and light from infinity is shifted by g = 1 / (1 + v d_r).
    vec3 rh = x / r0;
    float vff = sqrt(RS / r0);
    float dr = dot(rd, rh);
    rd = normalize((dr + vff) * rh + (rd - dr * rh));
    // inside the horizon, directions with 1 + v d_r <= 0 belong to photons of negative Killing energy: they never came
    // from our universe (in a hole formed by collapse they end on the long-gone star) -> nothing to see there
    if (1.0 + vff * dr <= 0.0) { emit(vec3(0.0)); return; }
    gObs = 1.0 / (1.0 + vff * dr);
    gSkyShift = gObs;
  } else if (uObsStatic > 0.5 && RS > 0.0) {
    // static observer: local direction -> Schwarzschild coordinate direction (tan th_c = tan psi / sqrt(1 - rs/r))
    vec3 rh = x / r0;
    float a = sqrt(max(1.0 - RS / r0, 1e-5));
    float dr = dot(rd, rh);
    rd = normalize(a * dr * rh + (rd - dr * rh));
    gObs = 1.0 / a;
    gSkyShift = gObs;
  }
  vec3 v = rd;
  vec3 hv = cross(x, v);
  H2 = dot(hv, hv);
  // photon angular momentum about the disk axis per unit energy (sign: photon travels opposite to the traced ray)
  float sinth = sqrt(H2) / r0;
  float beff = r0 / sqrt(max(1.0 / max(sinth * sinth, 1e-8) - RS / r0, 1e-8));
  float Ly = -hv.y / max(sqrt(H2), 1e-8) * beff;

  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  // integrate from the camera (log-spaced steps make the far field cheap); bound well outside the camera
  float Rin = max(uRfar, r0 * 1.05);
  float pathLen = 0.0;
  bool exhausted = true;
#ifdef HAS_SOLAR
  float pD2[9], pL[9], pT[9];
  for (int i = 0; i < 9; i++) { pD2[i] = 1e18; pL[i] = 1.0; pT[i] = 1.0; }
  vec3 eclY = cross(uEclN, uEclX);
#endif
  for (int i = 0; i < MAXSTEPS; i++) {
    float r = length(x);
    if (r < RS * 1.002 && RS > 0.0 && dot(x, v) < 0.0) { captured = true; exhausted = false; break; }
    if (r > Rin * 1.001 && dot(x, v) > 0.0) { exhausted = false; break; }
    float sp = length(v);
    float dt = clamp(0.085 * max(r - 0.55 * RS, 0.15 * r), 0.0006, 1e5) / sp;
    // keep steps small near the disk plane so the haze is resolved
    if (uHaze > 0.0 && abs(x.y) < 3.0 * uHazeH * r) dt = min(dt, max(0.35 * uHazeH * r, 0.04) / sp);
#ifdef HAS_SIM
    dt = min(dt, 6.0 * simStepAt(x) / sp);      // the volume is sampled several times per geodesic step (below)
#endif
    vec3 xo = x;
    // RK4
    vec3 k1v = accel(x), k1x = v;
    vec3 k2v = accel(x + 0.5 * dt * k1x), k2x = v + 0.5 * dt * k1v;
    vec3 k3v = accel(x + 0.5 * dt * k2x), k3x = v + 0.5 * dt * k2v;
    vec3 k4v = accel(x + dt * k3x), k4x = v + dt * k3v;
    x += dt / 6.0 * (k1x + 2.0 * k2x + 2.0 * k3x + k4x);
    v += dt / 6.0 * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
    float dl = length(x - xo);
    pathLen += dl;
    vec3 mid = 0.5 * (x + xo);

    if (uDisk > 0.0 && xo.y * x.y < 0.0) {
      float f = xo.y / (xo.y - x.y);
      vec3 p = mix(xo, x, f);
      vec4 d = diskShade(p, Ly, gObs, pathLen * pixelAngle());
      col += trans * d.rgb;
      trans *= 1.0 - d.a;
    }
    if (uHaze > 0.0) {
      vec4 hz = hazeSample(mid, Ly, gObs);
      col += trans * hz.rgb * dl;
      trans *= exp(-hz.a * dl);
    }
    if (uJet > 0.0) {
      vec4 j = jetSample(mid);
      col += trans * j.rgb * dl;
    }
#ifdef HAS_SIM
    {
      // sub-sample the (nearly straight) chord of this geodesic step at the volume's resolution, jittered per pixel
      vec3 sd = x - xo;
      float sl = length(sd);
      vec3 sdir = sd / max(sl, 1e-9);
      float hs = simStepAt(mid);
      int ns = int(clamp(ceil(sl / hs), 1.0, 12.0));
      float ds = sl / float(ns);
      float jit = fract(rnd0 + float(i) * 0.618034);
      for (int k = 0; k < 12; k++) {
        if (k >= ns) break;
        vec3 ps = xo + sd * ((float(k) + jit) / float(ns));
        vec4 sm = simSample(ps, sdir, gObs);
        if (sm.a > 0.0) {
          float a = 1.0 - exp(-sm.a * ds);
          col += trans * sm.rgb * a;
          trans *= 1.0 - a;
        }
      }
    }
#endif
#ifdef HAS_SOLAR
    {
      // point sources: keep the closest approach of the path to each (moving) point
      for (int i = 0; i < 9; i++) {
        vec3 P = i < 8 ? uPl[i].xyz : uSunPos;
        float fl = i < 8 ? uPl[i].w : uSunFlux;
        if (fl <= 0.0) continue;
        vec3 V = ((i < 8 ? uPlVel[i] : uSunVel) - uCamVel) * (0.5 * uSubDt);
        // quick reject on the point-to-segment distance
        vec3 sdv = x - xo;
        float hq = clamp(dot(P - xo, sdv) / max(dot(sdv, sdv), 1e-14), 0.0, 1.0);
        vec3 dq = xo + sdv * hq - P;
        float lv = length(V);
        if (dot(dq, dq) > (pD2[i] + 2.0 * lv * sqrt(pD2[i]) + lv * lv)) continue;
        float d2 = lv > 1e-7 ? segSegD2(xo, x, P - V, P + V) : dot(dq, dq);
        if (d2 < pD2[i]) { pD2[i] = d2; pL[i] = pathLen - dl + dl * hq; pT[i] = trans; }
      }
      // trails on the infall path: crossings of the infall plane
      float po = dot(xo, uPathN), px = dot(x, uPathN);
      if (po * px < 0.0) {
        float fc2 = po / (po - px);
        vec3 c2 = mix(xo, x, fc2);
        float u2 = dot(c2, uPathE1), v2 = dot(c2, cross(uPathN, uPathE1));
        float rr = length(vec2(u2, v2));
        float ph = uPathPhi0 + mod(atan(v2, u2) - uPathPhi0, TAU);
        if (ph <= uPathPhi1) {
          float fi = (ph - uPathPhi0) / (uPathPhi1 - uPathPhi0) * 95.0;
          int i0 = int(floor(fi));
          float rp = mix(uPathR[i0], uPathR[min(i0 + 1, 95)], fi - float(i0));
          vec3 rdS = normalize(x - xo);
          float Lc = pathLen - dl * (1.0 - fc2);
          float w = max(uOrbW * 1.3 * pixelAngle() * Lc / max(abs(dot(rdS, uPathN)), 0.12), 1e-6);
          float dr = (rr - rp) / w;
          if (abs(dr) < 3.5) {
            float g = sqrt(max(1.0 - RS / rp, 0.0));
            float g4 = g * g * g * g;
            for (int k = 0; k < 9; k++) {
              if (uTrAmt[k] <= 0.0 || ph > uTrHead[k] || ph < uTrTail[k]) continue;
              float m = (ph - uTrTail[k]) / max(uTrHead[k] - uTrTail[k], 1e-4);
              m = m * m * uTrAmt[k];
              vec3 tc = k == 8 ? bbColor(uSunTemp * g) * 1.6 : mix(PLCOL[k], bbColor(3800.0 + 5000.0 * uPlHeat[k]), uPlHeat[k]);
              col += trans * tc * m * exp(-dr * dr) * g4;
            }
          }
        }
      }
      // orbits: crossings of the ecliptic plane
      float so = dot(xo - uSunPos, uEclN), sx = dot(x - uSunPos, uEclN);
      if (so * sx < 0.0) {
        float fc = so / (so - sx);
        vec3 q = mix(xo, x, fc) - uSunPos;
        if (dot(q, q) < uOrbR * uOrbR) {
          float u = dot(q, uEclX), v = dot(q, eclY);
          float rho = length(vec2(u, v));
          float phi = atan(v, u);
          vec3 rdS = normalize(x - xo);
          float Lc = pathLen - dl * (1.0 - fc);
          float w = max(uOrbW * pixelAngle() * Lc / max(abs(dot(rdS, uEclN)), 0.12), 1e-6);
          float cphi = max(cos(phi), 0.0);
          float tear = cphi * cphi * cphi;
          for (int i = 0; i < 8; i++) {
            vec4 o = uOrb[i];
            if (o.y <= 0.0 || o.z <= 0.0) continue;
            float R = o.x * (1.0 + o.w * tear);
            float dr = (rho - R) / w;
            if (abs(dr) > 3.5) continue;
            float dphi = mod(uOrbPh[i] - phi, TAU);
            float drawn = smoothstep(o.z * TAU, o.z * TAU - 0.35, dphi);
            float head = exp(-dphi / 0.22);
            col += trans * PLCOL[i] * o.y * exp(-dr * dr) * drawn * (1.0 + 2.5 * head);
          }
        }
      }
    }
#endif
    if (trans < 0.003) { exhausted = false; break; }
  }
  if (exhausted) captured = true; // skimming the photon sphere for many orbits: treat as captured
#ifdef HAS_SOLAR
  {
    float sa = 0.55 * pixelAngle();
    for (int i = 0; i < 9; i++) {
      float fl = i < 8 ? uPl[i].w : uSunFlux;
      if (fl <= 0.0 || pD2[i] > 1e17) continue;
      vec3 P = i < 8 ? uPl[i].xyz : uSunPos;
      float r = length(P);
      float g = sqrt(max(1.0 - RS / r, 0.0));              // light climbing out of the well
      float sw = sa * pL[i];
      float lv = length(((i < 8 ? uPlVel[i] : uSunVel) - uCamVel) * uSubDt);
      float F = fl * REF_PIX * REF_PIX * sw / (sw + 0.4 * lv);
      vec3 c;
      if (i == 8) {
        float T = uSunTemp * g;
        vec3 bc = bbColor(T);
        c = max(mix(vec3(lum(bc)), bc, 1.5), 0.0) * bbLum(T) / bbLum(uSunTemp);
        // the Sun's halo (scattered light / corona at pixel scale)
        col += pT[i] * c * F * 0.004 * exp(-sqrt(pD2[i]) / (sw * 14.0)) / (sa * sa);
      } else c = mix(PLCOL[i], bbColor(3800.0 + 5000.0 * uPlHeat[i] * g) * 1.4, uPlHeat[i]) * g * g * g * g;
      col += pT[i] * c * F * exp(-pD2[i] / (2.0 * sw * sw)) / (6.2832 * sa * sa);
    }
  }
#endif
  vec3 dout = normalize(v);
#ifdef NOFWIDTH
  float fp = pixelAngle();
#else
  float fp = max(length(fwidth(dout)), pixelAngle() * 0.5);
#endif
#ifdef DEBUG_FP
  emit(vec3(fp / pixelAngle() * 0.1, captured ? 1.0 : 0.0, exhausted ? 1.0 : 0.0)); return;
#endif
  if (!captured && trans > 0.003) {
    vec3 bg = sky(dout, fp) * uSkyAmt;
#ifdef HAS_REMNANT
    bg += remnantSky(dout, fp);
#endif
    col += trans * bg;
  }
  emit(col);
}
