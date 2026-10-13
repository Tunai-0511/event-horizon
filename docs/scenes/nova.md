# `nova` — the supernova (Act II climax 219.07 → 238.02, stop 238.02 → 241.77, Act III opening 241.77 → 256.82)

Files

| file | what |
|---|---|
| `app/shaders/nova.frag` | the scene shader (progenitor, ejecta, light echoes, remnant) |
| `app/shaders/remnant_lib.glsl` | the remnant's filament network as a volume (`remField`/`remSegment`) and as a sky (`remnantSky(dir, fp)`) |
| `app/src/scenes/nova.js` | `DEFAULTS`, `REMNANT`, `NOVA_BARS`, one staging function per storyboard shot, `novaShots()` |
| `app/src/tests/nova.js` | test shots: one per storyboard row (each 1-s slot plays its whole bar, with the film's shutter) + `remsky` (`remnantSky()` alone) |
| `out/sheets/nova_final.png` | contact sheet (scale 0.5, spp 4), 3–4 frames per storyboard shot |
| `out/wip/nova_film_check.mp4` | motion check on the real timeline 219.07 → 256.8 with the soundtrack (scale 0.35, spp 2) |

## Look rules followed

* **Everything is light, gas and plasma.** No surfaces anywhere: the red supergiant has an exponential atmosphere
  (scale height `uStarHS` = 2.5 % of the radius, as real red supergiants), so its limb is fuzzy, darker and redder; the
  bounce bubble, the swelling breakout fireball, the ejecta fingers, the shell and the remnant filaments are all
  emitting/absorbing volumes with soft boundaries. The compact remnant is a point of light (an analytic PSF), the
  black hole at the end a black point.
* **Crescendo, not a slam.** The bounce starts on the beat (219.07) but the glow grows from within over ~1 s; the
  breakout flash is a *front* that sweeps across the star over ~1.3 s; the ejecta keep growing and brightening through
  226.65 → 230.44 → 234.23 and the light echoes at the end of the last bar are the peak; the light dies at 238.02 in
  ~0.4 s. Measured mean display brightness of the staged run (`out/wip/nova_film_check.mp4`, 30 fps), start → end of
  each bar: bounce 0.24 → 0.32 (a brief 0.20 while the exposure catches the glow), breakout 0.14 → 0.26, explosion
  0.10 → 0.46, engulf 0.24 → 0.40, echoes 0.34 → 0.29 → 0.42, stop 0.02 → 0.09, remnant 0.06–0.10. No white-outs:
  the exposure keys keep the highlights' structure (95th percentile ≤ 0.93 in every frame); inside a shot the mean
  never jumps by more than 0.026 between frames.
* Thermal colours come from the blackbody LUT (`bbColor/bbLum`; luminance compressed with exponents 0.3–0.45 so that a
  1500 K ember and a 30 000 K plasma fit one exposure); the remnant uses H-alpha 656 nm, [S II] 672 nm and [O III] 501 nm.
* Every random quantity comes from the noise volume or `pixelRand`; ray-march starts are jittered and stratified across
  the frame's sub-frames (Cranley–Patterson rotation of k/n per pixel), so 4 sub-frames give 4 evenly spread offsets.

Debug defines (shot `defines`): `REMSKY_ONLY` (remnantSky + stars from the centre), `REMSKY_MARCHED` (its 28-step
marched reference), `REMSKY_LENS` (remnantSky behind a toy point lens, for checking the footprint filtering).

## Uniforms (`DEFAULTS` in `app/src/scenes/nova.js`)

Phase selection: `uExpand > 1` → the ejecta/remnant volume (radius `uExpand`), otherwise the progenitor (radius 1)
driven by `uBounce`/`uBreakout`. Light echoes (`uEcho > 0`) and dust extinction (`uDust > 0`) are added on top.
The sky (`sky.glsl`, all `SKY` uniforms) is skipped behind opaque matter.

| uniform | default | meaning |
|---|---|---|
| `uSkyAmt` | 1 | background stars / Milky Way multiplier (`uStars`, `uMilky` … also apply) |
| `uNovaSeed` | 0 | offsets every pattern of the star and the ejecta (another explosion) |
| **progenitor** | | |
| `uStarT` | 3300 | photospheric temperature (K) of the red supergiant |
| `uStarBright` | 0.8 | its photospheric radiance (HDR) |
| `uConv` | 1 | contrast of the giant convection cells (soft, Betelgeuse-like) |
| `uStarHS` | 0.025 | atmospheric scale height / radius — the softness of the limb |
| `uBounce` | 0 | 0..1 core bounce: glow from within (ramps over b ∈ [0, 0.27]), translucent envelope with radial shadows of the cells, a white-blue plasma bubble rising (radius 0.95 at b = 1). Leave 0 for the quiet star |
| `uBounceLum` | 1 | brightness of the bounce light and bubble |
| `uBreakout` | 0 | 0..1 shock breakout: flash front sweeps the photosphere for b ∈ [0.02, 0.36], the shocked layers glow 7000 K and cool to 3500 K, the star swells (up to 1.4 R) into billowing lobes, bright rifts open on the lobes, flames boil off. Any value > 0 switches the bounce off |
| `uBoAxis` | (-0.8, 0.35, 0.5) | direction where the shock emerges first (the front sweeps away from it) — aim it at the side of the star you frame first |
| **ejecta / remnant** | | |
| `uExpand` | 0 | ejecta radius in progenitor radii (> 1 selects this phase). Self-similar: structure scales with it; with radius the fireball cools (`T ∝ (1 + R/60)^-½`), hollows into a shell (R 60 → 300) and tears into radial filaments (R 70 → 230) |
| `uExpandBlur` | 0 | radius change during one sub-frame; each pixel samples a jittered radius in that range (radial motion blur). Staging helpers set it from the radius curve |
| `uFingers` | 1 | Rayleigh–Taylor finger length |
| `uEjT` | 22000 | core temperature (K) of the young fireball |
| `uEjBright` | 1 | ejecta brightness |
| `uEjOpacity`, `uEjDense` | 1, 14 | opacity scale and body density of the debris (lower = more see-through) |
| `uCorePt` | 1 | brightness of the compact remnant (a point of light at the centre) |
| `uDim` | 0 | 0..1 the light dies (glow ×e^-5, fingers ×0.04, opacity ↓); ≥ 0.995 switches to the cheap remnant-only march |
| `uHole` | 0 | radius (absolute units) of the black point at the centre (occludes everything behind it) |
| `uEmber` | 0 | faint dying glow around the centre, against which the black point reads |
| `uAge` | 0 | 0..1 cross-fade from the hot ejecta to the remnant's emission-line filaments (`remnant_lib.glsl`, scaled by `uExpand`) |
| **light echoes** | | |
| `uEcho` | 0 | light-travel distance (absolute units) of the flash front: the echo is the ellipsoid with foci at the supernova and the camera cutting four warped dust sheets |
| `uEchoAmt` | 14 | echo brightness |
| `uEchoW` | 420 | duration of the light curve in distance units (breakout spike → main peak → red tail) |
| `uDust`, `uDustR`, `uDustRot` | 0, 2000, I | dust on/off (+ extinction of the stars), sheet scale and orientation. The sheets face +z of `uDustRot`; viewed along that axis the echo is a full ring |
| **remnant (`REMNANT`, shared with `remnant_lib.glsl`)** | | |
| `uRemAmt` | 1 | line brightness |
| `uRemRot` | rotYXZ(20, 35, 10) | orientation of the filament pattern (world → remnant) |
| `uRemSeed` | 0 | another remnant |
| `uRemLines` | (1, 1, 1) | weights of H-alpha, [O III], [S II] |
| `uRemPatch` | 0.55 | 0 = complete shell, 1 = a few bright arcs (most of the sky dark) |
| `uRemWidth` | 0.007 | intrinsic filament width (never thinner than the pixel footprint) |

## Staging — one function per storyboard shot (`app/src/scenes/nova.js`)

Each `stage(p, t)` returns `{ cam, u, post }` for the progress `p ∈ [0, 1]` through its bar (`t` = seconds into the
shot, drives the camera shake). `novaShots()` returns all seven as film shots on the snapped bar grid; or wrap one:

```js
import { DEFAULTS, bounce } from './scenes/nova.js';
const s0 = 219.07, s1 = 222.86;
shots.push({ id: 'nova-bounce', t0: s0, t1: s1, scene: 'nova', spp: 4,
  at: (t) => { const s = bounce((t - s0) / (s1 - s0), t - s0); return { cam: s.cam, u: { ...DEFAULTS, ...s.u }, post: s.post }; } });
```

| bar | shot | function | camera | key uniforms over the bar | post (exposure EV) |
|---|---|---|---|---|---|
| 211.49 | dip, bar 1 (silence) | — (`star` scene: the iron core shrinks to a point inside the cross-section) | — | — | — |
| 215.28 | dip, bar 2 (optional) | `quiet(p)` — the quiet red supergiant from outside, so the climax opens on the bounce framing | slow push 4.2 → 3.75 R, az 12 → 16°, el 7°, fov 40, no shake | `uBounce 0` (soft limb, giant cells, faint envelope) | +0.3 |
| **219.07** | CORE BOUNCE | `bounce(p)` | 3.75 → 3.05 R from the star, az 16 → 23°, el 7°, fov 40, slight shake after the onset | `uBounce = p`: glow from within over the first ~1 s, translucent star with radial shadows, plasma bubble fills it | 0.3, −0.4 (p .1), −2.4 (.25), −3.6 (.4), −4.5, −5.3, −5.9, −6.3 (1) |
| **222.86** | SHOCK BREAKOUT | `breakout(p)` | 2.6 → 3.6 R, az 40 → 46°, star frame-left with its right limb against black, fov 50, impact shake at p .06 | `uBreakout = p`, `uBoAxis` = frame-left → the flash front sweeps left → right (p .02 → .36), then swelling, rifts, flames | −2.4, −2.9 (.1), −2.5 (.35), −0.9 (.6), 0 (1) |
| **226.65** | EXPLOSION | `explosion(p)` | 175 R away (az 30, el 9); fov opens with the fireball so it grows from 60 % to 125 % of the frame | `uExpand = 1.3 → 93` (fast eruption that keeps going), `uEjBright 1 → 1.4` | −2.0, −1.5 (.3), −1.2 |
| **230.44** | ENGULF | `engulf(p)` | fixed at 260 R, looking sideways across the flow (centre frame-left), fov 70 → 80, shake peaks at the crossing | `uExpand 235 → 395 (p .42) → 470 (.52) → 720`: the shell approaches, a quick flash-through of the dense body, then radial streams rushing past | −0.2, −0.6 (.45), −1.0 (.56), +0.4 (.7), +0.8 |
| **234.23** | LIGHT ECHOES (peak) | `echoes(p)` | along the dust normal, 2250 → 2000 away, fov 70 | `uExpand 760 → 900`, `uEjBright 2.6 → 4`, `uEcho 250 → 1700` (outSine), `uEchoAmt 15 → 60 (.3) → 260`, `uDust 1`, `uCorePt 3` | +0.3 → +1.9, bloom 0.12 → 0.18 |
| **238.02** | STOP | `stop(p)` | 2600 away, fov 45, static | `uDim 0 → 1` in 0.41 s (p .11), `uEmber` 1.2 → 0.45, `uAge 0 → 0.35`, `uHole 14` (7 px black point at 1080p) | 0.2 → 1.6 (.12) → 2.0 |
| **241.77 → 256.82** | REMNANT (4 bars) | `remnant(p)` | from 2.3 R outside the shell, through the filaments (p ≈ .55), to 0.42 R from the dark centre; fov 46 → 64 | `uExpand 1.0001`, `uAge 1`, `uDim 1`, `uHole 0.004`, `uRemAmt 1.2` | 0.4 |

Suggested cut for Act III: keep `nova-remnant` for 241.77 → 249.29 (outside → inside) and hand over to `bh` with
`remnantSky()` as its lensed background from 249.29 (or right away at 241.77 — the inside view of `remnant(p > .8)`
and `remnantSky` are the same field).

## `remnant_lib.glsl` for the black-hole scene

```glsl
#include "remnant_lib.glsl"          // needs only common.glsl; declares the uRem* uniforms
...
if (!captured) bg += remnantSky(normalize(dout), fp);   // dout = escaped direction (world), fp = lensed footprint (rad)
```

and merge `REMNANT` from `app/src/scenes/nova.js` into the shot's uniforms (same values = the same remnant as the
`nova` shots; `uRemRot` turns it). `remnantSky` integrates the filament field radially through the shells, so filaments
thinner than `fp` widen and dim instead of aliasing; magnified by
lensing they stay smooth (checked with the toy lens in `nova.frag` `#define REMSKY_LENS`). It is not a separate
painting: along a radial ray the shell-distance fields of the volume are exactly linear, so the line integral through
the filament network has a closed form, one field evaluation per shell crossing. Radiance: bright
filaments ≈ 0.2–1 (red), the dark sky between them < 0.02 (my shots use exposure +0.4; at the bh scene's −1 EV raise
`uRemAmt` to about 2.5). Cost: closed form, 9 noise fetches per pixel — about 29 ms of shader time for a full
1080p frame (`remnantSkyMarched`, the 28-step reference it replaces, takes 62 ms; the two images match, only the
finest wiggles differ slightly).

## Performance (Apple M5, 1920×1080, 1 sub-frame, `node tools/render.mjs perf --test nova --spp 1`, idle GPU)

Measured with no other render job running (each value: 3 runs; numbers include the engine's fixed ~40 ms per frame for
bloom, tonemap and read-back — an empty frame measures 40 ms):

| shot | test times | ms per sub-frame |
|---|---|---|
| bounce | 0.02 / 0.3 / 0.6 / 0.9 | 103–112 / 124–126 / 141–142 / 154–156 |
| breakout | 1.05 / 1.2 / 1.5 / 1.8 / 1.98 | 140–142 / 140–147 / 141–144 / 154–158 / **160–163** (worst case) |
| explosion | 2.05 / 2.5 / 2.98 | 120–122 / 143–148 / 131–135 |
| engulf | 3.1 / 3.3 / 3.5 / 3.7 / 3.98 | 111–114 / 129–130 / 149–153 / 143–145 / 137–139 |
| echoes | 4.05 / 4.5 / 4.98 | 129–132 / 130–132 / 134–139 |
| stop | 5.02 / 5.3 / 5.5 / 5.9 | 127 / 102–103 / 95–103 / 102–105 |
| remnant | 6.02 / 6.5 / 6.98 | 104–109 / 140–154 / 89–94 |
| remsky (remnantSky + stars, full frame) | 7.5 | 74–81 |

All under the 180 ms budget. With other agents rendering at the same time the same frames measure 2–6× slower: re-measure
on an idle GPU. At the default 4 sub-frames a 1080p frame of the heaviest shot takes ~0.6 s.

Main optimisations: soft photosphere resolved only where it is opaque; empty-space skipping in the ejecta (outside the
lobed front, inside the hollow); late-shell mode drops the finger fields; remnant-only march with analytic filament
segments; per-frame constant colours hoisted out of the loops (blackbody LUT fetches were the largest cost); the sky is
skipped behind opaque matter; `remnantSky` in closed form.

## Known limitations

* Light transport is single-scattering and ad hoc: the bounce light reaches the envelope along radial paths only (the
  radial shadows are a stylisation of that), the ejecta scatter the core light with a fixed phase function, no
  multiple scattering anywhere.
* Time scales are artistic: a real red-supergiant breakout comes about a day after the bounce, and the ejecta radius
  and echo distances are compressed so each fits a bar.
* The breakout's rifts are direction-only patterns kept in the base layer of the atmosphere; seen exactly edge-on at
  the limb they can still smear slightly outward. The swollen fireball is intentionally soft and slightly blurry.
* The engulf is busy by design (radial streams + motion blur through per-pixel radius jitter); with 2 sub-frames the
  blur shows grain on the fastest streaks, 4 sub-frames (the shot default) are clean enough at 1080p.
* The echo dust sheets are fixed in world space: the echo reads as rings only when the camera looks along the sheets'
  normal (`uDustRot` +z, as staged); from oblique angles you get arcs. The dust has no colour of its own (it only
  scatters the flash).
* The remnant filaments are contour lines of smooth noise on wrinkled shells: up close, neighbouring contours form
  parallel "combed" bundles that read slightly graphic; most of the sky is dark by design (`uRemPatch`).
* The 128³ noise volume repeats every unit of texture space; at the remnant's largest magnifications (camera inside a
  filament) its trilinear facets would show — hidden by the near-field defocus within 0.16 R of the lens.
* Exposure is part of the staging (`post.exposure` keys measured for these cameras); retune if the grade changes.
