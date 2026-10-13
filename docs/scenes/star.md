# Scene `star` — Act II "THE GIANT" (143.54 – 219.07)

The life of a massive star, computed from math only and shown as **phenomena, not objects**: a blinding blue
supergiant whose limb melts into glowing chromosphere and corona, soft plasma prominences, an eruption; the swelling
to a red supergiant wrapped in a glowing molecular haze and dusty shells; the star turning into translucent luminous
gas to reveal its nested fusion shells around a dark iron core; and the core collapsing to a blinding point (the
supernova itself belongs to `nova`). Per the director's rule there are no hard surfaces, no cut planes, no cell
walls with dark outlines and no crisp silhouettes.

Files

| file | what |
|---|---|
| `app/shaders/star.frag` | the scene shader |
| `app/shaders/star_lib.glsl` | reusable plasma photosphere (`starSurface…`, `starLimbGlow`, `starRay`, `starSphere`, `starHalo4`); depends only on `common.glsl`, declares **no uniforms** |
| `app/src/scenes/star.js` | `DEFAULTS`, staging helpers, `filmShots()` = every storyboard shot of this scene on the bar grid |
| `app/src/tests/star.js` | the film shots, each compressed into a one-second test slot (shutter scaled to match) |
| `out/sheets/star_final.png` | contact sheet (scale 0.5, spp 4), 16 frames across the 9 shots |
| `out/wip/star.mp4` | motion check of the test slots (time-compressed) |

The star sits at the world origin; `uRadius` is its photosphere radius in world units. Inside the shader everything
is in a body frame where the photosphere radius is 1 (`uSpin` rotates that frame about +y). Directions (`uHero`,
`uHeroChord`) are body-frame and need not be normalised.

## How it is built

| layer | technique |
|---|---|
| photosphere (`star_lib.glsl`) | analytic ray/sphere hit. Convection = soft Gaussian upflow blobs around moving feature points (no Voronoi walls), sheared by a slowly drifting flow field, plus flowing fbm fine structure and large-scale mottling; faculae near the limb. Eddington–Barbier limb darkening **and** reddening via the blackbody LUT (`T(mu) = T (3/4 (mu + 2/3))^(1/4)`). At normal exposures the disk rolls off to near-white; structure shows as subtle flowing brightness. Red supergiant style (`uAge` → 1): a handful of giant soft plumes. Cells smaller than a pixel fade to their mean. |
| soft limb | the disk edge is blended to the edge radiance over the outer 30 % of mu and continues outward as a glowing two-scale exponential skirt (`starLimbGlow`, scale `uLimbH`), so the star never has a crisp silhouette |
| chromosphere | analytic (Chapman grazing column), H-alpha fringe + a forest of spicule jets indexed by the position along the limb (stable on screen). Seen from afar its thickness is widened to ≥ 2.5 px with the flux preserved, so it never draws a pink outline |
| prominences | 10 soft plasma arcs along elliptical field lines (two footpoints, kinked by a smooth displacement field); sphere-traced approach + jittered fixed-step march inside. Ragged wide cross-section + halo, field-aligned threads evaluated in a ray-perpendicular frame (noise-free), clumps and gaps along the arc, coronal-rain knots draining down the legs, the underside lit by the photosphere. Loop 0 = hero, 1–3 = post-flare arcade, 4–9 = active regions. In front of the disk they nearly vanish (as in white light) |
| eruption | `uEruption`: activation (0–0.25), then the hero rope rises, balloons, twists, kinks, one leg tears loose and the rope detaches; flare ribbons brighten the surface below; a faint limb-brightened CME front expands ahead |
| corona / wind | thin transition layer (analytic column) + K corona with helmet streamers + r^-2.5 wind, 16 equiangular samples; the streamer pattern is evaluated once per ray at closest approach (radial by construction) |
| molecular envelope (RSG) | lumpy exponential layer (MOLsphere), analytic column: glows dull orange-red, reddens and darkens what is behind it; the far-half occlusion fades in over one scale height so the glow is continuous across the limb (no dark outline) |
| dust shells | up to 5 expanding clumpy Gaussian shells, analytic column at each crossing, Henyey–Greenstein forward scattering of the starlight, chromatic extinction; shells fade in leaving the star and fade out before being dropped (continuous `uShellPhase`) |
| interior (`uInside`, or automatically when the camera is inside the star) | the photosphere dissolves into translucent glowing gas. The burning shells (photosphere, H, He, C, Ne, O, Si) are thin luminous plasma layers with soft glow skirts — physically normalised, so faint face-on and bright where seen edge-on (like planetary-nebula shells) — with turbulent wandering radii and slowly churning plasma brightness; warm convective gas fills the space between them (24 equiangular jittered samples); a mean extinction dims the far side so depth reads. The inert **iron core** is a dense Gaussian absorber with a dull dark-red glow of its own (`uIron` grows it) |
| collapse | `uCollapse`: the core shrinks (slowly, then the last 10 % to a point) and heats; all shells fall inward, the inner ones fastest, with growing turbulence (spiky inflow); the interior dims; a proto-neutron star appears as a tiny overwhelming point (HDR ~20 000 core + halo) |

Colour is always physical: thermal light from the blackbody LUT (photosphere, interior, scattered starlight in the
corona and dust), Balmer/H-alpha for prominences and chromosphere. The interior shell colours map the real ordering
(cooler outside → hotter inside) onto visible blackbody colours (display temperatures 2 000 → 9 000 K); the real
10^7–10^9 K would all render identical blue-white.

## Uniforms (`DEFAULTS` in `scenes/star.js`)

| uniform | default | meaning |
|---|---|---|
| `uRadius` | 1 | photosphere radius (world units) |
| `uTemp` | 25000 | effective temperature (K) |
| `uAge` | 0 | 0 blue … 1 red supergiant *style* (plumes, limb, envelope). Use `evolve(age)` to drive everything together |
| `uSurf` | 3 | surface radiance scale (HDR) |
| `uLumK` | 0.5 | how much of the blackbody's brightness-vs-T is kept: 1 physical, 0 normalised |
| `uCells` | 80 | convection cells per radian (blue close-up ~200, red supergiant ~1.7) |
| `uGranC` | 1 | convection contrast |
| `uBoil` | 4 | convection clock rate (× uTime). Keep it constant within a shot |
| `uSpin` | 0 | rotation of the body about +y (rad) |
| `uLimbH` | 0.05 | soft-limb glow scale height (fraction of R); 0.012 for the limb close-up, 0.09 for the red supergiant |
| `uLumpy` | 0 | irregularity of the limb glow and molecular envelope (red supergiant 1) |
| `uActivity` | 0.6 | faculae |
| `uChromo` | 1 | chromosphere + spicules |
| `uChromoH` | 0.012 | chromosphere scale (fraction of R, exaggerated so it reads) |
| `uCorona` | 1 | corona (transition layer + K corona) |
| `uStreamers` | 0.8 | streamer contrast |
| `uWind` | 1 | extended halo / wind |
| `uMol` | 0 | molecular envelope (red supergiant 2.5) |
| `uProm` | 1 | prominences overall |
| `uHero` | [0,1,0] | apex direction of the hero loop |
| `uHeroChord` | [1,0,0] | footpoint-to-footpoint direction of the hero loop |
| `uHeroH` | 0.16 | hero apex height (fraction of R) |
| `uHeroSpan` | 0.12 | hero footpoint half-span (rad) |
| `uEruption` | 0 | 0..1 hero eruption |
| `uShells` | 0 | dust shells amount |
| `uShellPhase` | 0 | expansion phase; +1 = one shell spacing outward; a shell is born at every integer |
| `uPulse` | 0 | pulsation amplitude (radius ±7 %, brightness ±25 %, temperature ±5 %) |
| `uPulsePhase` | 0 | pulsation phase (rad) |
| `uInside` | 0 | 0 opaque star … 1 translucent luminous interior (forced to 1 when the camera is inside the star) |
| `uIron` | 0 | iron core growth 0..1 (radius 0.04 → 0.10 R) |
| `uCollapse` | 0 | core collapse 0..1 (use `collapseState(p)`) |
| `uInterior` | 1 | interior brightness |
| `uSkyAmt` | 1 | background sky (`sky.glsl`); all `SKY` uniforms from `u.js` are included in `DEFAULTS` |

## Helpers (`app/src/scenes/star.js`)

- `evolve(age)` → uniforms for blue → yellow → red: T 25 000 → 3 500 K (log), R ×7, cells 80 → 1.7 per radian,
  corona/prominences/chromosphere fade, molecular envelope and dust shells fade in (shells already expanding).
  `evolveExposure(age)` → matching EV; `evolveCam(age, {az, el, fov})` → camera retreating as R^0.75.

  | age | T (K) | R | cells/rad | EV |
  |---|---|---|---|---|
  | 0 | 25 000 | 1.00 | 80 | −2.3 |
  | 0.25 | 17 500 | 1.41 | 58 | −2.1 |
  | 0.5 | 8 200 | 2.27 | 14 | −1.3 |
  | 0.75 | 4 200 | 3.89 | 2.9 | −0.3 |
  | 1 | 3 500 | 7.00 | 1.7 | −0.8 |

- `RSG` = `evolve(1)`.
- `insideState(p, {reveal, iron})` → the photosphere dissolves (`uInside` over `reveal`), molecules and dust fade,
  then the iron core grows (`uIron` over `iron`).
- `pulseState(t, t0)` → one radial pulsation per 2 bars; a dust shell is born at each radius maximum.
  `pulseRadius(u)` → current radius factor (close cameras can ride the heave).
- `collapseState(p)` → `uCollapse` (slow, then the last 10 % to a point), interior dimming, inside view.
- Cameras: `limbCam({h, a, R, dist, horizon, slide, fov, roll})` puts the hero direction exactly on the silhouette,
  looking along the loop plane (arch side-on); `starCam({dist, az, el, lookOff})` around the hero axis;
  `orbitCam({R, dist, az, el, look, roll})`; `flyCam(u, {R, p0, p1, l0, l1, fov, roll, e})` straight eased flights.
- `filmShots({spp, dipBars})` → the 9 shots below with absolute film times snapped to `music.js` bars. `act2.js` can
  simply spread them: `...filmShots()`. `dipBars: 1` ends the collapse at 215.28 if the second dip bar goes to the
  nova scene's optional `quiet(p)` shot.

## Staging (as implemented in `filmShots()`)

Bar lines: 143.54 147.06 150.85 154.64 | 158.43 162.22 | 166.01 169.80 173.59 177.38 | 181.17 184.96 188.75 192.54 |
196.33 200.12 203.91 207.70 | 211.49 215.28 | 219.07.

| storyboard | shot | camera | uniforms / keys | post |
|---|---|---|---|---|
| 143.54–158.43 quiet: the limb | `star_limb` (4 bars) | `limbCam` dist 1.14 → 1.11 R, horizon −9°, fov 34, slow truck slide −0.07 → +0.07 R | DEFAULTS + uCells 200, uGranC 0.9, uCorona 0.15, uWind 0.1, uLimbH 0.012, uSkyAmt 0.5 | EV −1.6, bloom 0.3, scatter 0.12 |
| 158.43–166.01 intro: whole star, eruption on the chord | `star_full` | `starCam` dist 2.3 → 6 R (outCubic), az 18, el 4, look +0.8 → 1 R up | uCells 150, uBoil 8; `uEruption` 158.43: 0 → 162.22: 0.3 (inQuad) → 166.01: 1 (outQuad) — the rope kicks off on the 162.22 chord | EV −2.6, bloom 0.5 |
| 166.01–181.17 build: blue → yellow → red | `star_evolve` | `evolveCam(age)`, az −20 → 15 | `evolve(age)`, age = inOutSine over the 4 bars, uBoil 12 | `evolveExposure(age)` (−2.3 → −0.8), bloom 0.5, sat 1 → 1.3 |
| 181.17–196.33 build: inside the star, the iron core grows | `star_inside` | `flyCam` from (1.2, 0.2, 2.1) R7 to (0.21, 0.04, 0.66) R7 looking at the centre, inOutSine — through the dissolving surface into the nested shells | RSG + `insideState(u, {reveal: [0.05, 0.3], iron: [0.3, 0.95]})` | EV −1.4 → −2.6 (u .3) → −4.0, bloom 0.2 → 0.6, sat 1.3 → 1.5 |
| 196.33–200.12 (bar 1) | `star_throes_a` | outside the shells: orbit dist 7 R7, fov 30 | RSG + `pulseState(t, 196.33)` | EV −1.0, bloom 0.3, sat 1.3 |
| 200.12–203.91 (bar 2) | `star_throes_b` | over the boiling limb: `limbCam` dist 1.5, horizon +3°, fov 40, roll −8, rides 75 % of the heave | RSG + pulse, uShells 1.4 | EV −0.5 |
| 203.91–207.70 (bar 3) | `star_throes_c` | from behind the dust: lit clumps drift past in the foreground, star off-centre (`flyCam`) | RSG + pulse, uShells 1.3 | EV −0.5 |
| 207.70–211.49 (bar 4) | `star_throes_d` | close over the surface, dist 2.2, el 25, fov 50 | RSG + pulse, uShells 0.5 | EV −1.0 |
| 211.49–219.07 dip: the core collapses | `star_collapse` | inside, between the shells: (0.18, 0.06, 0.58) → (0.15, 0.05, 0.5) R7, looking at the centre, fov 45 | RSG + `collapseState((t − 211.49) / 7.58)` | EV −4.2, bloom 0.7, sat 1.5 |

Notes for the edit: the pulsation is locked to the bars (radius maxima at 198.22 and 205.76, new shells born there).
The collapse ends at 219.07 with the neutron-star point at the frame centre for `nova`'s core-bounce flash. Cuts
between shots are hard cuts (state changes freely).

## star_lib.glsl (for other scenes, e.g. a sun-like star near the black hole)

```glsl
#include "star_lib.glsl"     // after common.glsl; no uniforms, no other dependencies
vec3 starSurface  (vec3 n, vec3 viewDir, float T, float time, float cellScale);              // fp = 0
vec3 starSurfaceFP(vec3 n, vec3 viewDir, float T, float time, float cellScale, float fp);    // fp: pixel footprint (rad of arc)
vec3 starSurfaceEx(vec3 n, vec3 viewDir, float T, float time, float cellScale, float fp, vec4 style);
     // style = (contrast, red-supergiant-ness 0..1, faculae activity, seed)
float starLimbGlow(float b, float R, float h);                 // soft glow just outside the disk (× edge radiance)
vec3 starRay(vec3 ro, vec3 rd, vec3 c, float R, float T, float time, float cells, float spin, float pixAng, out float tHit);
     // a whole star along one ray: disk (footprint-filtered) + soft glowing limb + thin (R/r)^4 glow; tHit = -1 on a miss
vec2 starSphere(vec3 ro, vec3 rd, float R);                    // ray/sphere (tNear, tFar)
float starHalo4(vec3 ro, vec3 rd, float R, float t0, float t1); // analytic column of an (R/r)^4 halo
```
Radiance: disk centre ≈ `1.2 * bbLum(T)` (5 800 K → 0.74); multiply by your own brightness. A sun-like star:
`starRay(ro, rd, c, R, 5800.0, uTime, 150.0, 0.0, pixelAngle(), tHit) * k`. For lensed rays pass the bent ray and a
footprint estimate as `pixAng`.

## Performance

`node tools/render.mjs perf --test star --times … --spp 1` at 1920×1080 (minimum of 12 repetitions; the GPU was
quiet for this run, medians matched within a few ms):

| shot (test time) | ms / sub-frame |
|---|---|
| limb (0.5) | 98 |
| full, before / during eruption (1.4 / 1.95) | 88 / 94 |
| evolve, blue / yellow / red (2.2 / 2.6 / 2.95) | 88 / 76 / 85 |
| inside: reveal / approach / deep (3.08 / 3.3 / 3.95) | 88 / 81 / 77 |
| throes a / b / c / d | 89 / 81 / 89 / 79 |
| collapse (8.5 / 8.97) | 77 / 77 |

All shots are well within the 180 ms budget (worst median 101 ms). The expensive parts are the 27-feature convection
field on the disk, the prominence march when a large arch fills the frame, and `sky()`.

## Known limitations

- The interior is a stylised onion: real shell radii and temperatures are compressed and recoloured to visible
  blackbody colours; the burning shells are drawn as luminous layers, not computed from a stellar model.
- The iron core reads as a darker, browner centre inside the white-hot silicon ring, but stays fairly subtle because
  the near halves of the inner shells glow in front of it.
- During the reveal (~181.5–185 s) the outer envelope shows for a moment as a softly bounded translucent sphere.
- Prominence threads are smooth glowing "hair" (by design, noise-free); the arches are parametric ellipses with a
  displacement field, not MHD field lines.
- The spicule forest is indexed by the limb position around the view axis, so a sideways truck makes the jets slide
  slightly along the limb (subtle at the staged speed).
- The yellow phase (age ≈ 0.45–0.55) is a pale, nearly featureless disk — physically right, visually the quietest
  moment of the evolution.
- Dust shells fill the frame with a warm haze when the camera sits inside them (dist < ~5 R); faint thin arcs of the
  shell edges are visible in wide shots.
- During the pulsation the limb swings by ±7 % R; close cameras should ride it (`pulseRadius`), as `throes_b` does.
- All animation runs on `uTime` (film time). In the time-compressed test harness the surfaces move slower relative
  to the camera than in the film.
