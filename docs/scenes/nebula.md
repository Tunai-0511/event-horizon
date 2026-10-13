# `nebula` — Act I "THE ENDLESS" (38.05 – 143.54)

A giant molecular cloud that gives birth to a massive star, rendered as one ray-marched volume (noise volume +
analytic shapes, no meshes, no solids: every object is gas with a frayed, turbulent boundary). Files:

| file | what |
|---|---|
| `app/shaders/nebula.frag` | main: point-source queue, stratified jittered march with exact per-segment integration, sky behind |
| `app/shaders/nebula_lib.glsl` | uniforms, density field, light transport, stars/jets, compile-time feature switches |
| `app/src/scenes/nebula.js` | `DEFAULTS`, world layout, story curves (`storyState`), cameras (`CAMS`), cut list (`ACT1_CUTS`), ready engine shots (`act1Shots`) |
| `app/src/tests/nebula.js` | 18 test shots = the 18 storyboard cuts, each cut's full time range compressed into its 1-s slot |
| `app/src/tests/nebfilm.js` | the same cuts at real film time (38.05 – 143.54) for video checks |
| `app/src/tests/nebsteps.js` | debug: march samples per pixel (`DBG_STEPS`) for every cut |
| `out/sheets/nebula_final.png` | contact sheet of the 18 cuts (scale 0.5, spp 4) |

**Drop-in for the timeline** — replace the `1.todo` placeholder (B(10)…B(38)) in `app/src/shots/act1.js`:

```js
import { act1Shots } from '../scenes/nebula.js';
export default [ /* 1.void, 1.unveil, 1.deep … */ ...act1Shots({ spp: 4 }) ];   // 18 cuts, 38.05 → 143.54 on the bar grid
```

`BAR(k)` in nebula.js = bar k counted from 38.05, i.e. `BAR(k) === B(10 + k)` of the act file.

## The world (units ≈ light years)

* **Cloud**: smooth union of 7 ellipsoids (`BLOBS`, ~210 × 90 × 100 around `CLOUD_C`), torn at its outer boundary by a
  mid-scale warp and ridged erosion (translucent, wispy edge), filled with eroded masses, sheet ∩ sheet filaments and
  faint diffuse gas. The Milky Way's bulge sits behind it as seen from +z (`GAL_C`, `SKY_ROT`) → silhouette + rim light.
* **Cluster A** (`A_POS` -38, 9, -6): 7 old O stars that blew an HII bubble (radius `A_R` 28) with a blister opening
  towards `A_OPEN` (-z, away from the exterior camera). Teal [O III] heart, rose H-alpha walls, photo-evaporation
  flows on every lit surface. Six **pillars** stand on its floor and point at it (bright ionised heads, dark fluted
  bodies, evaporating knots at the tips). **Cometary globules** float inside (dark heads with glowing rims and shadow
  tails; ~45 % hide a red embryo). `EMBRYO_GLOBULE` is one of them (the embryo cut looks at it).
* **Hub** (origin): the hero core, fed by converging gas streams, in a clear cave ~20 across. Spin axis = +y.
* **Cluster B** (`EMBRYOS`): 16 embryos 8–23 from the hub in dark cocoons; they ignite on `uCluster`, nearest first.

## Rendering model

* **Light needs no second march**: every column density from a light to a sample is closed form. Cluster A: its
  ionisation front (bubble wall = noise on the sphere of directions, pillars as explicit occluders) + a constant column
  per length beyond it + exact chords through globules/knots + one short local self-shadow tap. Hero star: disk shadow
  + its own front + radial streams that shadow themselves (bright tips, dark spokes).
* **Emission lines**: ionising photons die in a thin skin → H-alpha/[S II] rims; ionised gas glows in recombination,
  photon-limited (∝ flux), coloured by ionisation parameter and depth inside the front (teal near hot stars, rose at the
  walls). Colours `uHa`, `uO3`, `uS2` are linear-sRGB line colours (H-alpha+H-beta mix, [O III] 5007/4959, [S II]).
* **Dust**: reddening extinction (`uExt` ∝ 1/λ), two-lobe Henyey-Greenstein scattering, one multiple-scattering octave.
* **Thermal**: protostar, disk and infall glow use the blackbody LUT (`bbColor`), 700 → 3000 K before ignition.
* **Point sources** (cluster A, embryos, hero star, world-fixed field stars on three shells, the jets' analytic line
  integral) are queued before the march and composited at their depth: dust in front dims and reddens them.
* **March**: segment length max(`uStepK`·t, `uStepMin`) × (×3.2 in empty space … ×0.7 in bright dense gas), a dedicated
  scale near the core, ×`uOuterStep` away from the hub; each segment is sampled at a per-pixel random fraction of its
  length (no rings / banding); exact exponential integration; exit at 0.3 % transmittance. 20–35 samples per pixel.
* Where a coarse sample would turn a thin lit skin into speckle, the lit layer widens with the sample footprint
  (energy-conserving).

## Uniforms (`DEFAULTS` in `app/src/scenes/nebula.js`)

Sky: everything from `SKY` (u.js), with `uSkyRot: SKY_ROT`, `uMilky` 1.4, `uGal` 0.6, plus `uSkyAmt` (1).

**Look**

| uniform | default | meaning |
|---|---|---|
| `uDust` | 1 | dust opacity (scales every extinction) |
| `uEmit` | 1 | emission-line brightness (fronts, HII gas, bubbles) |
| `uScat` | 1 | dust-scattered starlight |
| `uAmb` | 1 | faint red glow of the diffuse gas in the canyons (backdrop for silhouettes) |
| `uDetail` | 1 | fine-noise contrast (0 = smooth) |
| `uMass` | 1 | density of the cloud masses |
| `uLeak` | 0 | porosity of cluster A's bubble wall: 0.3–0.6 lets its reddened light leak deep into the cloud (interior fill) |
| `uHa`, `uO3`, `uS2` | see file | line colours (linear sRGB, luminance ≈ 1) |
| `uExt` | [0.72, 1, 1.38] | relative extinction per channel |
| `uField` | 1 | embedded field stars |
| `uFieldDir` | [dir, 0.55] | magnetic-field direction + stretch: gas is combed along it |
| `uRim`, `uRimCol` | [GAL_C, 0], warm | external light from the bulge behind the cloud (dir, intensity ≈ 1.6 for the exterior) |
| `uKey`, `uKeyCol` | dir + w, warm | soft key light for core close-ups (w 1–7; 0 = off) |
| `uCoreGlow` | 1 | dull-red compression glow of the infalling gas |
| `uHub` | 1 | the converging gas streams |

**Story** (use `storyState(t)`; all are pure functions of film time)

| uniform | range | meaning |
|---|---|---|
| `uCollapse` | 0 – 1 | 0 an elongated lumpy clump at a filament junction · 0.1–0.6 streamers wind into log-spirals and flow inward, faster as it spins up · 0.3–0.85 flattens into an oblate rotating pseudo-disk + thin flared disk · 0.4–1 a dull red protostar heats the inner disk |
| `uFlow` | clock | flow clock of streamers / jet knots (`flowAt(t)` integrates it, accelerating with collapse and ignition) |
| `uJet` | 0 – 2 | 0 none · 1 first Herbig-Haro jets (knots, broken bow shocks, bipolar cavity) · 2 blasting, ~33 long |
| `uPreGlow` | 0 – 1 | the protostar's accretion flickers and swells (irregular, continuous) |
| `uIgnite` | 0 – 1 | 0 → 0.15: the star turns on (dull orange → blue-white, ~1 s) · 0.15 → 1: keeps brightening (L ∝ 0.2 + 0.8·uIgnite²) |
| `uFront` | 0 – 1 | ionisation front radius (log 2.3 → 34, runs ahead upward and breaks out of the top): behind it the cloud is evacuated and glows thinly, a swept-up shell glows at the front; envelope and disk evaporate by uFront ≈ 0.12 / 0.22 |
| `uCluster` | 0 – 1 | cluster B ignites one embryo after another, each blowing a glowing bubble |
| `uFlash` | ≥ 0 | optional extra impulse on the hero star (e.g. `hit(t, BAR(k), 0.4)` on a downbeat) |

**Geometry** (generated from the layout constants — edit those, not the arrays): `uCloudC`, `uBlobC/uBlobR/uBlobN`
(inverse radii), `uAPos`, `uALum` (2500), `uATemp` (40000 K), `uAR`, `uAOpen`, `uPilTip/uPilDim/uPilN/uPilBound/uPilCone`,
`uClu/uCluN/uCluBound`.

**Quality / speed**: `uStepK` (0.08), `uStepMin` (0.25), `uCoreStep` (2), `uOuterStep` (1), `uFineFar` (1e9).
**Compile-time switches** (shot `defines`; `act1Shots` sets them per cut via `DEFS`; none = everything on):
`NEB_NO_PILLARS`, `NEB_NO_COMETS`, `NEB_NO_GLOBULES`, `NEB_NO_CORE` (core, disk, hub, jets), `NEB_NO_HUB`,
`NEB_NO_CLUSTER`, `NEB_NO_HERO`, `NEB_NO_RIM`, `NEB_NO_FIELD`, `NEB_NO_EDGEWARP`, `NEB_NO_SELFSHADOW`; `MAXSTEPS` (100),
`DBG_STEPS`.

## Helpers (`app/src/scenes/nebula.js`)

* `BAR(k)`, `T` (section starts: exterior, pillars, interior, collapse, disk, jets, dip, ignite, stop, end).
* `storyState(t)` = { uCollapse, uJet, uPreGlow, uIgnite, uFront, uCluster, uFlow, uALum } from `collapseAt`, `jetAt`,
  `preGlowAt`, `igniteAt`, `frontAt`, `clusterAt`, `flowAt`, `envLightAt`.
* `CAMS[name](u)` cameras (u = 0..1 across the cut), `SHOT_U[name]` per-cut uniforms, `POST[name]` grading,
  `DEFS[name]` feature switches, `ACT1_CUTS` = [name, fromBar, toBar], `act1Shots({ spp })`.
* `skyRotFor(galCentreWorld, galNorthWorld)` orients the Milky Way in world space.

Custom cut example: `{ id, scene: 'nebula', t0: BAR(22), t1: BAR(23), spp: 4, defines: DEFS.ignite, at: (t) => ({ cam:
CAMS.ignite((t - BAR(22)) / (BAR(23) - BAR(22))), u: { ...DEFAULTS, ...storyState(t), ...SHOT_U.ignite }, post: POST.ignite }) }`.

## Storyboard staging (bars counted from 38.05)

| bars | time | cut | on screen | story values over the cut |
|---|---|---|---|---|
| 0–4 | 38.05–53.12 | `exterior` | pull out: the dark cloud silhouetted against the Milky Way's bulge, its torn rim lit by it | `uRim` 1.6, `uMilky` 2.2, `uStepK` 0.012 |
| 4–6 | 53.12–60.66 | `pillarsWide` | through the blister opening: pillars against cluster A's teal heart | – |
| 6–8 | 60.66–68.19 | `pillarsClose` | drift past the main pillar's ionised head, globules around | – |
| 8–10 | 68.19–75.73 | `globules` | deep in the bubble: dark cometary globules with glowing rims and shadow tails, teal glow | – |
| 10–12 | 75.73–83.27 | `embryo` | push in on a dark globule with a red embryo glowing inside it | `uCollapse` 0 → 0.12 (off-screen) |
| 12–14 | 83.27–90.80 | `collapse` | the hub: a dark lumpy clump fed by converging streams, its red heart kindling | 0.12 → 0.33 |
| 14–16 | 90.80–98.33 | `spiral` | from above: streamers wind into a spiral and flow in | 0.33 → 0.55 |
| 16–17 | 98.33–102.10 | `disk` | oblique: the flattened spinning disk around a dull red protostar | 0.55 → 0.75 |
| 17–18 | 102.10–105.87 | `diskClose` | close on the inner disk | 0.75 → 0.89 |
| 18–19 | 105.87–109.64 | `jets` | edge-on: the first jets, knots | `uJet` 0 → 0.75 |
| 19–20 | 109.64–113.41 | `jetsWide` | wider: knots travelling out, bow shocks | `uJet` → 1 |
| 20–22 | 113.41–120.94 | `dip` | hush: slow push into the flickering protostar; cluster A's light dims to 55 % | `uPreGlow` 0 → 1 |
| 22 | 120.94–124.71 | `ignite` | IGNITION on the downbeat, unfolding: light bursts out through the bipolar cavity | `uIgnite` 0 → 0.15 (1 s) → 0.24, `uFront` 0 → 0.30 |
| 23 | 124.71–128.47 | `blast` | the front races outward, jets blasting, envelope evaporating | `uIgnite` → 0.38, `uFront` → 0.56, `uJet` 1 → 2 |
| 24 | 128.47–132.24 | `front` | inside the new cavity: the light front carving the cloud | `uIgnite` → 0.56, `uFront` → 0.77, `uCluster` → 0.33 |
| 25 | 132.24–136.01 | `cluster` | embryos ignite across the cloud, each lighting its own bubble | `uIgnite` → 0.76, `uFront` → 0.92, `uCluster` → 0.67 |
| 26 | 136.01–139.78 | `ablaze` | pull back on the exterior side: the same dark cloud now ablaze from inside (bookend of the exterior) | all → 1, `uJet` 2 → 1.2 |
| 27 | 139.78–143.54 | `aftermath` | quiet wide: the lit nebula in the dark cloud under the Milky Way, the blue star at its heart | 1, jets dying (→ 0.4) |

### Ignition, bar by bar (director's note: start on the beat, unfold, keep climbing; no white-out)

| bar | time | `uPreGlow` | `uIgnite` | `uFront` | `uCluster` | `uJet` | cluster A light | exposure |
|---|---|---|---|---|---|---|---|---|
| dip 1 | 113.41 | 0 | 0 | 0 | 0 | 1 | 100 → 55 % | 0 |
| dip 2 | 117.17 | 0.25 → 1 (flicker swells, inQuad) | 0 | 0 | 0 | 1 | 55 % | 0 |
| climax 1 | 120.94 | 1 | 0 → 0.15 in 1.0 s (outCubic), → 0.24 | 0 → 0.30 | 0 | 1 | 55 % | -1.0 |
| climax 2 | 124.71 | – | 0.24 → 0.38 | 0.30 → 0.56 | 0 | 1 → 2 | 57 % | -0.5 |
| climax 3 | 128.47 | – | 0.38 → 0.56 | 0.56 → 0.77 | 0 → 0.33 | 2 | 62 % | -1.0 |
| climax 4 | 132.24 | – | 0.56 → 0.76 | 0.77 → 0.92 | 0.33 → 0.67 | 2 | 71 % | -0.85 |
| climax 5 | 136.01 | – | 0.76 → 1.0 | 0.92 → 1.0 | 0.67 → 1.0 | 2 → 1.2 | 84 % | +1.0 (wide) |
| stop | 139.78 | – | 1 | 1 | 1 | → 0.4 | 100 % | +0.7 (wide) |

Hero luminosity grows ~5× from bar 1 to bar 5 and the visible lit volume grows with the front, so the light keeps
climbing through the crescendo; the per-cut exposures keep structure readable at every peak (test frames: p99 luma
≤ 218/255, no clipped pixels; mean luma dip 0.06 → bar 1 0.23 → bars 2–4 0.28–0.30; the wide bar-5 cut is darker on
average because most of its frame is the dark cloud and space, but its glow is the brightest structure of the act). For an accent on a downbeat add `uFlash: hit(t, BAR(k), 0.4)` instead of jumping
`uIgnite`.

## Camera notes

* Exterior: stay ≥ 120 from the cloud on the +z side (the bulge is behind it); FOV 42–50.
* Pillars: look in through the opening from around (-37, -4, -58) … (-26, 0, -38); inside the bubble any point within
  ~20 of `A_POS` is clear. The pillars point at cluster A (towards -z / up).
* Interior: `EMBRYO_GLOBULE` and the comet heads are soft gas — keep ≥ 3 from them.
* Core: 3–10 from the origin. Elevation 20–45° reads the spiral, 60–70° shows it from above, 2–8° shows the disk
  edge-on with the jets. Key light from (-0.6, 0.55, -0.55) rims from behind-left.
* Climax: ≥ 3.5 from the star; pull back with the front (orbit ≈ 0.4 × front radius) so its bright rim stays in frame.
  Wide: the exterior side (az -5…22°, el 8–16°, 95–160 away) bookends the act.

## Performance

`node tools/render.mjs perf --test nebula --times 0.5,…,17.5 --spp 1` (1920×1080, Apple M5), minimum of 6 runs,
measured while another agent's production render was sharing the GPU (earlier clean runs agreed within ~5 %).
`perf` includes a fixed ~41 ms engine floor (post chain + readPixels; a trivial black shader measures 41 ms), so the
scene pass itself is ≈ raw − 41.

| cut | raw ms | scene pass | | cut | raw ms | scene pass |
|---|---|---|---|---|---|---|
| exterior | 125 | 84 | | jets | 175 | 134 |
| pillarsWide | 130 | 89 | | jetsWide | 171 | 130 |
| pillarsClose | 147 | 106 | | dip | 171 | 130 |
| globules | 161 | 120 | | ignite | 172 | 131 |
| embryo | 175 | 134 | | blast | 170 | 129 |
| collapse | 121 | 80 | | front | 161 | 120 |
| spiral | 118 | 77 | | cluster | 154 | 113 |
| disk | 154 | 113 | | ablaze | 173 | 132 |
| diskClose | 172 | 131 | | aftermath | 141 | 100 |

All cuts ≤ 175 ms raw (≤ 134 ms scene pass) per sub-frame. Without the per-cut `DEFS` (everything compiled in) the
close-ups cost ~20–40 % more.

## Known limitations

* **Speckle**: to stay in budget the march takes only 20–35 samples per pixel; thin bright skins (ionisation fronts,
  pillar rims, climax close-ups with `uStepK` 0.12–0.15) show stochastic grain at spp 4. Motion blur and film grain
  hide much of it; spp 6–8 on the climax cuts cleans it if render time allows.
* The exterior silhouette is torn and translucent at the edges but its large lobes still read slightly "cumulus"
  (metaball-built) rather than a filamentary dark nebula.
* Globule heads and comet tails are soft gas, but heads are roundish and tails are tapered cones (straight-ish
  silhouette edges in some views); the embryo cut's globule is round-ish by nature (Bok globule).
* Lighting is single scattering with analytic columns (constant density per length beyond cluster A's wall); interior
  fill is approximate (`uLeak` exists to brighten it).
* Close-up core cuts (`disk`, `diskClose`, `jets`, `dip`) drop the hub streams (`NEB_NO_HUB`) for speed — the dark
  background spokes differ slightly between those and the other core cuts.
* The jets are an analytic line integral composited at their closest point to the ray (no partial occlusion along
  their length).
* Ignited cluster-B stars are small points; the "young cluster" reads through the lit bubbles in the `cluster` cut, not
  as a resolved cluster in the wide shots. The hero star is a point source (no resolved surface, by design).
* The test file compresses each cut into 1 s, so test videos move 4–8× faster than the film (streaky motion blur);
  use `tests/nebfilm.js` for real-time checks.
* Eight distinct define sets → eight programs (~0.2–0.7 s compile each at boot).
