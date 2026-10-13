// Procedural celestial sphere: stars (4 magnitude layers on cube-face cells), Milky Way with dust lanes,
// a deep field of distant galaxies, and optional emission-nebula haze.
// Everything is filtered by the ray footprint fp (radians) so lensed / zoomed views stay alias-free.

uniform mat3 uSkyRot;        // world -> celestial
uniform float uStars;        // star brightness multiplier
uniform float uStarReveal;   // 0..1: fraction of stars that exist (brightest appear first)
uniform float uMilky;        // Milky Way amount
uniform vec3 uGalN;          // galactic north pole (celestial coords)
uniform vec3 uGalC;          // galactic centre direction (celestial coords)
uniform float uGal;          // distant galaxies amount
uniform float uNebSky;       // emission nebula haze amount
uniform vec3 uNebSkyA;       // nebula colour A
uniform vec3 uNebSkyB;       // nebula colour B
uniform float uSkyShift;     // Doppler/gravitational shift factor of all sky light (1 = none)
uniform vec3 uHeroDir;       // one placed star (celestial coords), e.g. exactly behind the hole -> Einstein ring
uniform float uHeroFlux;
uniform float uHeroTemp;

float gSkyShift = 1.0;        // set by a scene before calling sky(): extra Doppler/gravitational shift (e.g. a static observer near the hole)
const float REF_PIX = 0.000727; // pixel angle of a 45 deg / 1080p frame: star fluxes are defined in these units

void cubeProj(vec3 d, out int f, out vec2 uv) {
  vec3 a = abs(d);
  if (a.x >= a.y && a.x >= a.z) { f = d.x > 0.0 ? 0 : 1; uv = vec2(d.z, d.y) / a.x; }
  else if (a.y >= a.z) { f = d.y > 0.0 ? 2 : 3; uv = vec2(d.x, d.z) / a.y; }
  else { f = d.z > 0.0 ? 4 : 5; uv = vec2(d.x, d.y) / a.z; }
}
vec3 cubeDir(int f, vec2 uv) {
  if (f == 0) return normalize(vec3(1.0, uv.y, uv.x));
  if (f == 1) return normalize(vec3(-1.0, uv.y, uv.x));
  if (f == 2) return normalize(vec3(uv.x, 1.0, uv.y));
  if (f == 3) return normalize(vec3(uv.x, -1.0, uv.y));
  if (f == 4) return normalize(vec3(uv.x, uv.y, 1.0));
  return normalize(vec3(uv.x, uv.y, -1.0));
}

// stellar temperature: mostly cool dwarfs, some sun-like, a few hot giants (brighter layers skew hot)
float starTemp(float h, float hot) {
  float r = clamp(h - hot * 0.25, 0.0, 1.0);
  if (r < 0.50) return 3100.0 + 2000.0 * (r / 0.50);
  if (r < 0.82) return 5100.0 + 2600.0 * ((r - 0.50) / 0.32);
  return 7700.0 + 22000.0 * pow((r - 0.82) / 0.18, 2.0);
}

vec3 shiftCol(float T, float D) {
  float Ts = T * D;
  return bbColor(Ts) * (bbLum(Ts) / bbLum(T));
}

vec3 starLayer(vec3 d, int f, vec2 uv, float N, float dens0, float flux, float fp, int layer, float hot, float rankLo, float rankHi, float dm) {
  float dens = min(dens0 * dm, 0.98);
  float cellAng = 1.5708 / N;
  float sig = 0.55 * fp;
  float smoothW = smoothstep(0.25, 0.7, sig / cellAng); // footprint too wide for discrete stars -> mean radiance
  vec3 acc = vec3(0.0);
  float k = REF_PIX * REF_PIX * flux;
  if (smoothW < 0.999) {
    vec2 g = (uv * 0.5 + 0.5) * N;
    vec2 c0 = floor(g);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = c0 + vec2(i, j);
      if (c.x < 0.0 || c.y < 0.0 || c.x >= N || c.y >= N) continue;
      vec4 h = hash44i(ivec4(ivec2(c), f, layer * 7919 + 13));
      if (h.w > dens) continue;
      // reveal: rank inside this layer's slice of the global brightness order
      float rank = mix(rankLo, rankHi, h.w / dens);
      float vis = smoothstep(rank, rank + 0.04, uStarReveal);
      if (vis <= 0.0) continue;
      vec4 h2 = hash44i(ivec4(ivec2(c), f, layer * 7919 + 977));
      vec2 p = (c + 0.03 + 0.94 * h.xy) / N * 2.0 - 1.0;
      vec3 sd = cubeDir(f, p);
      vec3 dd = d - sd;
      float a2 = dot(dd, dd);
      float F = k * exp(-4.2 * h.z) * vis;
      float s2 = sig * sig;
      float T = starTemp(h2.x, hot);
      vec3 col = mix(vec3(1.0), bbColor(T), 0.55);
      if (uSkyShift * gSkyShift != 1.0) col *= shiftCol(T, uSkyShift * gSkyShift);
      acc += col * F * exp(-a2 / (2.0 * s2)) / (6.2832 * s2);
    }
  }
  // mean radiance of the layer (keeps total flux when the image is magnified/demagnified)
  float mean = dens * k * (1.0 - exp(-4.2)) / 4.2 / (cellAng * cellAng) * smoothstep(rankLo, rankHi, uStarReveal);
  vec3 meanC = vec3(mean) * vec3(1.0, 0.97, 0.93);
  if (uSkyShift * gSkyShift != 1.0) meanC *= shiftCol(5200.0, uSkyShift * gSkyShift);
  return mix(acc, meanC, smoothW);
}

float galLat(vec3 d) { return asin(clamp(dot(d, normalize(uGalN)), -1.0, 1.0)); }
float starDensity(vec3 d) {
  float b = galLat(d) / 0.22;
  float clouds = nzl(d * 0.9 + 5.0, 2.0).r;
  float m = 0.35 + 1.5 * exp(-b * b) * (0.6 + 0.8 * clouds) + 0.5 * (clouds - 0.5);
  return clamp(m, 0.15, 2.4) * uMilky + (1.0 - uMilky) * 0.8;
}
vec3 stars(vec3 d, float fp) {
  int f; vec2 uv;
  cubeProj(d, f, uv);
  vec3 s = vec3(0.0);
  float dm = starDensity(d);
  s += starLayer(d, f, uv, 9.0, 0.55, 1500.0, fp, 0, 1.0, 0.00, 0.08, 1.0);
  s += starLayer(d, f, uv, 28.0, 0.38, 140.0, fp, 1, 0.6, 0.08, 0.25, dm);
  s += starLayer(d, f, uv, 90.0, 0.28, 22.0, fp, 2, 0.2, 0.25, 0.60, dm);
  s += starLayer(d, f, uv, 280.0, 0.30, 4.0, fp, 3, 0.0, 0.60, 1.00, dm);
  return s;
}

// ---- Milky Way ----
vec3 milkyWay(vec3 d, float fp) {
  vec3 n = normalize(uGalN), c = normalize(uGalC - dot(uGalC, uGalN) * uGalN);
  vec3 e2 = cross(n, c);
  float b = asin(clamp(dot(d, n), -1.0, 1.0));
  float l = atan(dot(d, e2), dot(d, c));
  float bulge = exp(-l * l / 0.35);
  float w = 0.10 + 0.10 * bulge;
  float lod = clamp(log2(fp / 0.0015), 0.0, 6.0);
  float n1 = fbm3l(d * 1.7 + 3.1, 5, lod);
  float n2 = fbm3l(d * 5.3 + 7.7, 4, lod + 1.0);
  float bw = b / w;
  float band = exp(-bw * bw * (1.0 - 0.35 * n1));
  float halo = exp(-abs(b) / 0.55) * 0.12;
  // star clouds: bright ridged knots inside the band
  float clouds = smoothstep(-0.15, 0.55, n1 + 0.45 * n2);
  float I = band * (0.25 + 0.75 * exp(-l * l / 1.6)) * (0.25 + 1.5 * clouds * clouds) + halo * (0.6 + 0.4 * bulge);
  I += bulge * exp(-b * b / 0.016) * 1.4 * (0.6 + 0.6 * clouds);
  // dust lanes: ridged filaments hugging the plane (darker, less red so the band reads luminous, not muddy)
  float rid = 1.0 - abs(fbm3l(d * 3.3 + 1.3, 5, lod));
  float dust = smoothstep(0.62, 0.93, rid) * exp(-bw * bw / 0.36) * (0.5 + 0.7 * n2);
  dust += smoothstep(0.3, 0.8, n2 + 0.15) * exp(-bw * bw / 0.09) * 0.7;
  vec3 ext = exp(-dust * 2.4 * vec3(0.9, 1.05, 1.3));
  vec3 core = bbColor(5200.0), disk = bbColor(8500.0);
  vec3 col = mix(disk, core, smoothstep(0.0, 1.0, bulge * 1.3)) * I;
  // H-II regions: pink knots strung along the plane
  float hii = smoothstep(0.62, 0.9, fbm3l(d * 9.0 + 2.0, 3, lod + 1.5) * 0.5 + 0.5) * exp(-bw * bw / 0.36);
  col += vec3(1.0, 0.25, 0.42) * hii * 0.7;
  col *= ext;
  if (uSkyShift * gSkyShift != 1.0) col *= shiftCol(5500.0, uSkyShift * gSkyShift);
  return col * 0.11;
}

// ---- distant galaxies (deep field) ----
vec3 galaxy(vec2 q, vec4 h, vec4 h2, float size, float fp) {
  // q: offset in radians from centre, in a local tangent frame
  float ang = h.x * TAU;
  q = rot2(ang) * q;
  float incl = acos(mix(0.12, 1.0, h.y));
  q.y /= max(cos(incl), 0.12);
  float s = max(size, 1e-9);
  float r = length(q) / s;
  float blur = fp / s;
  float spiral = step(0.45, h.z);
  float I;
  vec3 col;
  if (spiral > 0.5) {
    float th = atan(q.y, q.x);
    float arms = 0.5 + 0.5 * cos(2.0 * th - 3.2 * log(r + 0.08) + h2.x * 6.0);
    float dsk = exp(-r * 3.2);
    I = dsk * (0.35 + 0.9 * arms * arms * smoothstep(0.05, 0.3, r)) + 1.4 * exp(-r * r / 0.012);
    col = mix(bbColor(9000.0), bbColor(4300.0), exp(-r * 4.0));
  } else {
    I = exp(-5.0 * pow(r, 0.5)) * 2.5;
    col = bbColor(4200.0 - 800.0 * h2.y);
  }
  float dim = 1.0 / (1.0 + blur * blur * 4.0);
  return col * I * dim;
}

uniform float uGalDeep;      // enable the fine galaxy layers (deep-field zooms only)

vec3 galaxyLayer(vec3 d, int f, vec2 uv, float N, float fill, float sizeLo, float sizeHi, float bright, int seed, float fp) {
  float cellAng = 1.5708 / N;
  float far = smoothstep(0.35, 1.0, fp / cellAng);
  vec3 acc = vec3(0.0);
  if (far < 0.999) {
    vec2 g = (uv * 0.5 + 0.5) * N;
    vec2 c0 = floor(g);
    for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 c = c0 + vec2(i, j);
      if (c.x < 0.0 || c.y < 0.0 || c.x >= N || c.y >= N) continue;
      vec4 h = hash44i(ivec4(ivec2(c), f, seed));
      if (h.w > fill) continue;
      vec4 h2 = hash44i(ivec4(ivec2(c), f, seed + 1010));
      vec2 p = (c + 0.2 + 0.6 * h.xy) / N * 2.0 - 1.0;
      vec3 sd = cubeDir(f, p);
      vec3 t1 = normalize(cross(sd, abs(sd.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
      vec3 t2 = cross(sd, t1);
      vec2 q = vec2(dot(d - sd, t1), dot(d - sd, t2));
      float size = cellAng * mix(sizeLo, sizeHi, pow(h2.z, 2.5));
      float redshift = h2.w;
      vec3 gcol = galaxy(q, vec4(h2.x, h.z, h2.y, 0.0), h2, size, fp);
      gcol *= mix(vec3(1.0), vec3(1.3, 0.75, 0.5), redshift * 0.85) * (0.3 + 0.7 * (1.0 - redshift));
      acc += gcol * bright * (size / (cellAng * 0.15));
    }
  }
  float mean = fill * bright * 0.004;
  return mix(acc, vec3(mean) * vec3(1.0, 0.85, 0.75), far);
}

vec3 deepField(vec3 d, float fp) {
  int f; vec2 uv;
  cubeProj(d, f, uv);
  vec3 c = galaxyLayer(d, f, uv, 1400.0, 0.55, 0.04, 0.26, 0.9, 5151, fp);
  if (uGalDeep > 0.0) {
    c += galaxyLayer(d, f, uv, 260.0, 0.35, 0.05, 0.22, 1.6, 7373, fp) * uGalDeep;   // rare large foreground galaxies
    c += galaxyLayer(d, f, uv, 5200.0, 0.6, 0.05, 0.3, 0.7, 8383, fp) * uGalDeep;    // the faint, distant multitude
    c += galaxyLayer(d, f, uv, 17000.0, 0.6, 0.06, 0.35, 0.55, 9393, fp) * uGalDeep;
  }
  return c;
}

vec3 nebSky(vec3 d, float fp) {
  float lod = clamp(log2(fp / 0.002), 0.0, 6.0);
  float a = fbm3l(d * 1.3 + 11.0, 5, lod);
  float b = fbm3l(d * 2.1 + 23.0, 5, lod);
  float m = smoothstep(0.05, 0.55, a) ;
  float m2 = smoothstep(0.1, 0.6, b) * smoothstep(-0.1, 0.4, a);
  return (uNebSkyA * m + uNebSkyB * m2) * 0.05;
}

vec3 heroStar(vec3 d, float fp) {
  vec3 dd = d - normalize(uHeroDir);
  float sig = max(0.55 * fp, 1e-6);
  float F = REF_PIX * REF_PIX * uHeroFlux;
  return mix(vec3(1.0), bbColor(uHeroTemp), 0.6) * F * exp(-dot(dd, dd) / (2.0 * sig * sig)) / (6.2832 * sig * sig);
}
vec3 sky(vec3 dw, float fp) {
  vec3 d = normalize(uSkyRot * dw);
  vec3 c = vec3(0.0);
  if (uHeroFlux > 0.0) c += heroStar(d, fp);
  if (uStars > 0.0) c += stars(d, fp) * uStars;
  if (uMilky > 0.0) c += milkyWay(d, fp) * uMilky;
  if (uGal > 0.0) c += deepField(d, fp) * uGal;
  if (uNebSky > 0.0) c += nebSky(d, fp) * uNebSky;
  return c;  // (galaxies / nebula haze are not shifted: they never matter near the horizon)
}
