# Scene `galaxy` — the black hole at the heart of a galaxy, which becomes a quasar (Act IV, 474.75–527.50)

Files
- `app/shaders/galaxy.frag` — the scene shader (one ray per pixel, everything computed from math).
- `app/shaders/galaxy_lib.glsl` — analytic helpers: erf, Gaussian line integrals, ray/slab/cylinder/ellipsoid
  intersections, scattered-light line integrals.
- `app/src/scenes/galaxy.js` — `DEFAULTS`, camera presets, animation curves, `STAGE.<shot>(t, u)` and a ready-made
  `shots` array for the timeline.
- `app/src/tests/galaxy.js` — one 1-second test slot per storyboard shot (0 pullback, 1 edge, 2 face, 3 indisk, 4 dip,
  5 quasar, 6 jets, 7 ride, 8 cosmic, 9 freeze; film time mapped onto the slot, shutter scaled so motion blur matches the
  film) + 5 extra stills (10 inclined, 11 low angle, 12 nucleus, 13 quasar at the peak, 14 edge-on core telephoto).
  Final sheet: `node tools/render.mjs sheet --test galaxy --times 0.15,0.6,1.5,2.5,3.5,4.6,5.35,5.8,6.5,7.45,8.5,9.5 --cols 4 --scale 0.5 --spp 4 --tag galaxy_final`
- `app/src/tests/galaxyfilm.js` — the same shots at their real film times, for motion checks:
  `node tools/render.mjs video --test galaxyfilm --from 474.75 --to 527.5 --fps 24 --scale 0.35 --spp 1 --out out/wip/galaxy.mp4`

## Units and model

Galaxy units (GU): the visible stellar disk ends near r = 1 GU (~15 kpc). The disk lies in the xz plane, rotation axis
+y, rotation counter-clockwise seen from +y, arms trailing. Jets run along ±y; `uJet` is their length in GU (= galaxy
radii). Front-to-back emission/absorption along every camera ray:

| component | how | notes |
|---|---|---|
| thin disk | ray-marched in the slab \|y\|<0.12, r<1.3; jittered start (`pixelRand`), steps grow with distance and height, at most 0.75 optical depth per step (dense dust retakes a shorter step) | old disk (sech², 5300 K), diffuse young arms (17000 K), dust with R_V=3.1 reddening (R:G:B extinction 0.74:1:1.32) + faint scattered starlight |
| spiral structure | logarithmic spiral (`uPitch`, `uArms`), phase wobble + arm strength from low-frequency noise, a second more open pattern that branches in the outer disk, irregular nuclear spiral | noise is sampled in an "unwound" frame (θ + cot(p)·ln r) so filaments are sheared along the arms; dust lane on the concave (upstream) edge, ~70 feathers per turn, Worley filament webs |
| knots | HII regions (pink, Hα+Hβ) and blue clusters as discrete sources on a grid in the disk plane, accepted by the local young-star density; flux-conserving Gaussian blobs (≥ 1 pixel) | crisp at any distance; faded out below ~6° grazing |
| nuclear ring | star-forming ring at r ≈ 0.046 with its dust ring inside | colour in the core close-ups |
| bulge + thick disk | 6-component multi-Gaussian expansion (σ 0.004…0.5 GU, 4000–5300 K) integrated **analytically** along the ray with erf, per march step | exact nuclear cusp at any step size; silhouetted correctly by the dust lane |
| resolved stars | `uResolve > 0`: a 3D DDA through 0.006 GU cells near the camera draws stars as points; the broad bulge components and the old disk are removed from the continuum there | only for camera positions inside the galaxy (nucleus, in-disk) |
| nucleus | AGN point (`uGrow`, `uQuasar`) + quasar light scattered by the circum-nuclear medium (analytic 1/b + 1/b² line integrals, the far half attenuated by the disk), dust near the centre lit by the quasar (Henyey-Greenstein g=0.4) | no sprite: the glow is scattered light |
| jets | Gaussian-profile beam (r = 0.004 + 0.013·\|y\|), bright spine, faint sheath, twisted filaments and fine plasma streaks advected at 3 GU/s, quasi-periodic shock knots launched every ~0.14 s of flow clock, slow helical kink, relativistic beaming (β = 0.6, `uBeam`) | flux conserving when thinner than a pixel |
| hotspot / bow shock / lobes | analytic Gaussians at the jet head; lobes = ellipsoidal cocoons (size grows with `uJet`) of billowy, filamentary, edge-brightened emission, blue-violet, brightest toward the hotspot, slow backflow drift | lobes appear from `uJet` ≈ 0.8 |
| sky | `sky.glsl` with `uMilky 0`, `uGal 1`, `uStars 0.08` | intergalactic space |

HDR levels: face-on disk 0.05–0.5, bulge centre ~2, knots 0.2–2, quasar glow 1–100 near the nucleus (designed for an
exposure of about −2.3 EV), jets 0.3–5, lobes 0.3–1. Output is clamped at 3e4 (FP16 accumulation).

## Uniforms (`DEFAULTS` in `app/src/scenes/galaxy.js`)

| uniform | default | meaning |
|---|---|---|
| `uSpin` | 0 | rotation of the whole disk pattern (rad). The staging turns it 0.02 rad/s ("eons pass") |
| `uPitch` | 17 | arm pitch angle (deg) |
| `uArms` | 2 | number of arms — **integer** (non-integers leave a seam) |
| `uBulge`, `uDiskAmt`, `uYoung`, `uHII`, `uDust` | 1 | brightness of bulge / old disk / young arms / knots, dust optical depth |
| `uGalSeed` | 0 | structure seed (shifts every noise lookup to another slice of the noise volume) |
| `uResolve` | 0 | radius (GU) around the camera inside which stars are drawn as points; 0 = off (cheap). 0.08–0.12 when the camera is inside the bulge / disk |
| `uStarAmt` | 0.35 | resolved-star brightness |
| `uStepK` | 0.03 | march step growth with distance (quality vs speed). 0.012 for the edge-on, 0.05 for the dip, 0.07 near the nucleus, 0.11 for in-disk |
| `uGrow` | 0 | 0..1 nucleus activity (a growing point of light) |
| `uQuasar` | 0 | quasar luminosity: 0 off, 1 full quasar; the climax climbs to 1.6. Exposure must follow (≈ −1 EV per doubling) |
| `uJet` | 0 | jet length in galaxy radii (0 → 8) — the head (hotspot + bow shock) sits at y = ±uJet |
| `uFlow` | 0 | jet flow clock (s): knots and filaments are advected with it; hold it constant to freeze the jets |
| `uFlowBlur` | 0.004 | per-pixel jitter of the flow clock (s), fills the gaps between motion-blur sub-frames (0.008 for the ride) |
| `uBeam` | 0.6 | relativistic beaming (0 none, 1 β = 0.6): approaching jet brighter than the counter-jet |
| `uLobe` | 1 | radio lobe amount |
| `uJetAmt` | 1 | jet + hotspot + lobe brightness |
| sky | `uMilky 0, uStars 0.08, uGal 1, uSkyAmt 1` | intergalactic background |

Animation is a pure function of these uniforms; nothing reads `uTime`.

## Staging (bar grid: `bar(3, k)` of `app/src/shots/kit.js`)

`import { shots } from './scenes/galaxy.js'` gives ten shots (`4.gal.*`, scene `galaxy`, spp 4) that exactly replace
the `4.todo` placeholder (bar 24 → bar 38) in `app/src/timeline.js`:

```js
import { shots as galaxy } from './scenes/galaxy.js';
export const shots = [...act1, ...act2, ...act3, ...act4, ...galaxy, ...act5, ...act6];
```
 Each is `STAGE.<name>(t, u)` with `t` = film time, `u` = 0..1 across the
shot; the uniform curves (`growAt`, `quasarAt`, `jetAt`, `jetAmtAt`, `lobeAt`, `flowAt`, `spinAt`) are functions of
absolute film time, so they stay continuous across cuts.

| shot | film time | camera | what happens |
|---|---|---|---|
| `pullback` | 474.75–486.06 (3 bars) | from 0.08 GU beside the nucleus (el 35°, inside the bulge, resolved stars within 0.065 GU) out to 3.1 GU (el 30°), exponential dolly that leaves the core briskly and settles; fov 45→38 | the nucleus' dust spiral and ring → the inner galaxy → the whole galaxy; `uGrow` 0.2→0.6, exposure −2.0→0 |
| `edge` | 486.06–489.82 | edge-on, el 1.2→2.6°, dist 2.85→2.6, fov 32 | dust lane through disk and bulge; `uStepK 0.012` |
| `face` | 489.82–493.59 | face-on, el 78→84°, dist 3.35→3.2 | the spiral turning |
| `indisk` | 493.59–497.36 | inside the disk at r 0.42→0.37, y = 0.004, looking at the core, fov 60 | our-Milky-Way view: band, dust clouds, bulge glow, resolved stars; `uResolve 0.12, uStepK 0.11, uStars 0, uGal 0`, contrast 1.12 |
| `dip` | 497.36–504.89 (2 bars) | long lens just above the plane: dist 1.45→0.95, el 6.5→5.5°, fov 18→21 | the bulge rising over the near dust lane, the active nucleus; quiet push in; flicker of the nucleus in the last 5 s |
| `quasar` | 504.89–508.66 | inclined, dist 2.35→2.8, el 28→30° | ignition **unfolds over ~1.8 s**; exposure follows it down (−1.0 → −2.3 EV) so no frame whites out; the jets leave the nucleus at 505.79 and their heads are visibly moving out by the end of the bar |
| `jets` | 508.66–512.43 | low angle (el 9→12°), dist 2.6→3.8, rotated 50° from the previous shot | twin beams pierce out of the disk, heads leaving the frame |
| `ride` | 512.43–516.20 | alongside the upper jet, 0.16 GU off its axis, flying up from y 0.9 to 4.6 (accelerating), looking ahead, roll −12→−28°, fov 64 | knots and plasma streaks overtake the camera; we fly into the young lobe toward the hotspot |
| `cosmic` | 516.20–523.73 (2 bars) | pull back 5 → 14.5 GU, el 22→28°, roll −66→−80° (jets near-horizontal), look point drifts to y 1.6 so both lobes sit symmetrically in frame | the galaxy dwarfed by its jets, lobes at both ends; intensity peaks at 519.96 |
| `freeze` | 523.73–527.50 | the last cosmic frame | everything frozen (flow clock and all curves held at 523.73) |

### Climax keyframes (497.36 → 504.89 → 523.73 → 527.50)

The climax is a 5-bar crescendo, so nothing slams: every curve is continuous, keeps climbing to the last bar and is
held from the stop. Values below are what `galaxy.js` produces (`quasarAt`, `jetAt`, `jetAmtAt`, `lobeAt`, exposure
from the stages).

| film time | bar | shot | uQuasar | uJet | uJetAmt | uLobe | exposure (EV) | note |
|---|---|---|---|---|---|---|---|---|
| 497.36 | dip 1 | dip | 0 | 0 | 0.70 | 0.55 | −0.95 | quiet core, `uGrow` = 1, long lens just above the dust lane |
| 501.13 | dip 2 | dip | 0 → flicker | 0 | 0.70 | 0.55 | −0.95 | from 499.4 the nucleus flickers (≤ 0.1, smooth noise), growing toward the downbeat |
| 504.89 | climax 1 | quasar | 0.1 | 0 | 0.70 | 0.55 | −1.0 | cut on the downbeat; ignition starts |
| 505.79 | | quasar | 0.55 | 0 (launch) | 0.70 | 0.55 | −1.55 | jets leave the nucleus |
| 506.69 | | quasar | 1.0 | 0.6 | 0.71 | 0.55 | −2.27 | ignition complete; glow floods the inner galaxy, arms still readable |
| 508.66 | climax 2 | jets | 1.03 | 1.8 | 0.75 | 0.55 | −2.0 | heads clear the disk, leave the frame |
| 512.43 | climax 3 | ride | 1.2 | 4.0 | 0.95 | 0.55 | −1.0 → −1.7 | lobes inflating; we fly into the upper one |
| 516.20 | climax 4 | cosmic | 1.4 | 5.8 | 1.16 | 0.93 | −1.0 | pull back begins |
| 519.96 | climax 5 | cosmic | 1.5 | 7.2 | 1.25 | 1.30 | −0.78 | peak intensity (jets and lobes at full brightness) |
| 523.73 | stop | freeze | 1.6 | 8.0 | 1.25 | 1.30 | −0.55 | everything held (flow clock, curves, camera) |
| 527.50 | end | — | | | | | | hard cut |

Curves: `uQuasar` = smoothstep blend of a flicker (`0.1·noise`, 499.4–504.89) into `kf[(504.89, 0.1), (506.69, 1.0
inOutSine), (519.96, 1.5 smooth), (523.73, 1.6 outSine)]`; `uJet = 8·(1 − (1 − x)^1.5)`, x from 505.79 to 523.73
(fast at launch, decelerating, no kinks); `uJetAmt` 0.7 → 1.25 and `uLobe` 0.55 → 1.3 (inOutSine) toward 519.96;
`uFlow` = seconds since 505.79, frozen at 523.73. Measured on a 24 fps preview: no frame has more than 1 % white pixels.

### Camera presets (`PRESETS`, orbit around the look point; dist GU, az/el deg)
`FACE_ON (3.3, 0, 82)`, `INCLINED (3.0, 35, 35)`, `LOW (2.6, 60, 10)`, `EDGE_ON (2.8, 10, 1.5, fov 32)`,
`CORE_LOW (1.2, 42, 6, fov 20)`, `NUCLEUS (0.08, 30, 35, fov 45)`, `QUASAR (2.5, 50, 28)`, `JETS (3.6, 105, 10, look y 0.3)`,
`COSMIC (14.5, 75, 28, fov 45, roll −80, look y 1.6)`. Helpers: `presetCam(p, overrides)`, `orbitCam(dist, az, el, fov, look, roll)`,
`inDiskCam(r, az, y, fov, lookY)`.

Other useful framings found during look-dev: the edge-on core through a long lens (`EDGE_ON` with fov 12: Sombrero-like
bulge split by the dust lane — test slot 14), and the inclined galaxy from 1 GU (pullback at u ≈ 0.6, test slot 0.6).

## Performance (ms per sub-frame at 1920×1080, `perf --spp 1`, includes ~42 ms engine post + read-back)

Measured on the Apple M5 in a quiet window (engine-only black frame = 40 ms), minimum of 6 runs per test slot:
`node tools/render.mjs perf --test galaxy --times <slot> --spp 1`. Budget 180 ms; all shots are inside it.

| test slot | shot / moment | ms |
|---|---|---|
| 0.02 | pullback start — inside the bulge, resolved stars (`uResolve 0.065`, sky skipped while hidden by the bulge) | 145 |
| 0.3 | pullback — inner galaxy (worst case of the film) | 178 |
| 0.6 | pullback — inclined galaxy from ~1 GU | 164 |
| 0.95 | pullback — full galaxy | 123 |
| 1.5 | edge-on (`uStepK 0.012`) | 118 |
| 2.5 | face-on | 134 |
| 3.5 | in-disk (`uResolve 0.12`, `uStepK 0.11`) | 174 |
| 4.5 | dip, long lens over the dust lane (`uStepK 0.05`) | 175 |
| 5.3 / 5.9 | quasar ignition / jets emerging | 150 / 139 |
| 6.5 | jets | 96 |
| 7.5 / 7.9 | ride / ride inside the lobe | 112 / 154 |
| 8.5 | cosmic | 89 |
| 9.5 | freeze | 79 |
| 10.5–14.5 | extra stills: inclined, low, nucleus, quasar peak, edge-on core telephoto | 124, 93, 145, 138, 139 |

Cost drivers: march steps × per-step work (≈ 1.7 ns per pixel-step: 5–6 noise fetches, 6 analytic bulge erf, arm
geometry), the shared `sky()` (≈ 35 ms at 1080p when stars + deep field are on), the resolved-star DDA (≈ 10–25 ms) and
the knot layer (≈ 10–20 ms). Quality knobs per shot: `uStepK`, `uResolve`, `MAXS`.

## Director notes honoured
- **Crescendo, not a slam** (504.89–523.73): flicker in the dip, ignition over ~1.8 s, jets launched ~1 s after the
  downbeat with a visibly travelling head, intensity climbing to 519.96, frozen at 523.73; exposure tracks the quasar so
  no frame whites out (≤ 1 % white pixels on the preview).
- **No solid-looking objects**: everything is an emission/absorption volume or an analytic Gaussian glow — bulge,
  nucleus (sub-pixel point + scattered light), knots (soft blobs), hotspots (soft, unsaturated glow inside the lobe, a
  flattened bow-shock haze ahead of it), lobes (billowy gas with noise-displaced, soft edges).

## Debug switches
- `defines: { DEBUG_STEPS: 1 }` — red = march steps / 100, green = dense-dust retries / 20.
- `defines: { NOBULGESTEP: 1 }` — skip the per-step analytic bulge (cost test only).
- `defines: { MAXS: n }` — cap the march (default 140).
- `uSkyAmt 0` skips `sky()` entirely (used while the camera is buried in the bulge).

## Known limitations
- The face-on arms have a slightly "painted" softness at 1080p — the young population is volumetric noise plus a point
  layer; there are no resolved individual stars in far views.
- Inside the disk / bulge the unresolved light is a soft glow; resolved stars only exist within `uResolve` of the camera
  (cost grows with it), so the very first frames of the pull-back read as a warm haze with stars.
- Grazing, close dust (dip foreground, in-disk) shows some per-pixel grain at spp 4 (stochastic march through
  optically thick, finely structured dust); spp 6–8 cleans it if the budget allows.
- The volumetric noise is isotropically mip-mapped; for grazing rays the LOD is pushed up (anisotropy), which softens the
  far disk slightly.
- Knots are evaluated around the disk-plane crossing; they fade out below ~6° grazing (the volumetric young population
  carries those views).
- Lobes read as glowing plasma "flames"/billows rather than true radio-map morphology; the jet is not lensed (the hole is
  far below a pixel at galaxy scale) and there is no light-travel delay along the jets.
- The quasar point is limited to 2e4 per pixel (FP16 headroom); its size impression comes from the scattered-light
  halo, which is designed for an exposure of about −2.3 EV.
