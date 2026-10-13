# BRIEF — building a scene for EVENT HORIZON

Read this whole file, then `docs/STORYBOARD.md`, before writing anything.

## The film
A 13-minute film about black holes, set to Hans Zimmer's *Interstellar Main Theme* (extended edit). Arc: endless space →
a nebula gives birth to a giant star → the star dies in a supernova → a black hole is born → it devours a star and grows into a
quasar → it destroys a living world (us) → we fall through the event horizon into darkness. The feeling to land is **awe, then
overwhelming scale, then despair**. Think IMAX space documentary photographed by Roger Deakins, not a screensaver.

## Hard rules (the director's requirements)
1. **Everything is computed from math in fragment shaders.** No meshes, no geometry buffers, no models, no image/texture files,
   no fonts, no text on screen. Volumes are ray-marched density functions, surfaces are analytic (ray/sphere, SDF), detail is noise.
2. **Physically motivated.** Use the blackbody LUT for anything thermal (`blackbody(T)`, `bbColor(T)`), emission lines for nebulae
   (H-alpha 656 nm deep red-pink, O-III 501 nm teal, S-II dark red), real ordering of events. Artistic exaggeration of scale/speed is
   fine; impossible colours are not.
3. **Deterministic.** All randomness comes from `hash.glsl` / the noise volume. No `Math.random`. Animation is a pure function of the
   uniforms you receive (`uTime`, `uLocal`, your own progress uniforms). The engine renders several jittered sub-frames per frame
   (motion blur + anti-aliasing), so every quantity must be continuous in time.
4. **No text, no UI, no lens-flare sprites.** Glow comes from HDR values + the engine's bloom.

## Engine (already built — do not modify shared files)
- `app/index.html` → `app/src/main.js` boots WebGL2, compiles every scene shader, exposes `window.EH`.
- A **shot** is `{ id, t0, t1, scene, spp, defines, at(t) }`; `at(t)` returns `{ cam, u, post }` for film time `t`:
  - `cam`: `{ pos:[x,y,z], look:[x,y,z] | fwd:[x,y,z], up:[0,1,0], fov: verticalDegrees, roll, yaw, pitch }` (see `app/src/cam.js`:
    `orbit()`, `kf()` keyframes, `ease`, `ramp()`, `hit()`, `shake()`, `spline()`).
  - `u`: your uniforms (plain numbers / arrays). Unknown names are ignored.
  - `post`: grading per shot — `{ exposure (EV), bloom, scatter, streak, sat, contrast, lift, gain, tint, vignette, grain, fade, ca }`
    (defaults in `app/src/engine.js` `POST_DEFAULTS`). Tonemapping is ACES filmic; bloom is a physically-plausible wide glow.
- Scene shader = `app/shaders/<scene>.frag`, starting with `#include "common.glsl"`. Call `emit(vec3 linearHDRRadiance)` exactly once.
  `common.glsl` gives you: `camRay()`, `uCamPos`, `uTime`, `uLocal`, `uRes`, `pixelAngle()`, `ndc()`, `pixelRand(gl_FragCoord.xy, uSeed)`
  (per-sub-frame random numbers — use them to jitter ray-march start offsets), `uNoise` (128³ tileable RGBA8 noise volume:
  R = Perlin fBm, G = inverted Worley fBm (billows), B = second Perlin fBm, A = Worley F2−F1 (cell walls → filaments/cracks)),
  `nz(p)`, **`nzl(p, lod)` (use this inside loops — implicit-derivative `texture()` is undefined in non-uniform control flow)**,
  `fbm3l()`, `blackbody(T)`, `bbColor(T)`, `bbLum(T)`, `rot2()`, `sat()`, `lum()`.
  `sky.glsl` gives `sky(dir, footprint)` — the shared procedural star field + Milky Way (uniform defaults: `SKY` in `app/src/u.js`).
  Put your own helpers in `app/shaders/<scene>_lib.glsl` if you need them. **Never use `pow(x, y)` with x possibly negative** (NaN on
  this GPU → black pixels) — square by multiplication.
- Units are yours. HDR conventions: background stars ≈ 0.01–10, nebula emission ≈ 0.02–2, stellar surfaces ≈ 5–50, flashes ≈ 100+.
  Typical exposure 0 EV. Keep the darkest parts truly dark (space is black), let highlights roll off through ACES + bloom.
- Performance budget: **≤ 180 ms per sub-frame at 1920×1080** on this Mac (Apple M5) — measure with `perf`. Ray-march with
  jittered start (`pixelRand`) and fewer, smarter steps (empty-space skipping, step size growing with distance, early exit at
  opacity) rather than brute force. Default `spp: 4`.

## Test loop (this is how you see your work — use it constantly)
Write `app/src/tests/<scene>.js` exporting `shots` (each test shot occupies one second: `t0: i, t1: i + 1`) and `duration`.
```
node tools/render.mjs sheet --test <scene> --times 0.5,1.5,2.5,3.5 --cols 2 --scale 0.5 --spp 2 --tag <scene>_v1   # -> out/sheets/<tag>.png
node tools/render.mjs stills --test <scene> --times 0.5 --scale 1 --spp 4 --tag <scene>_full                        # full-res check
node tools/render.mjs perf --test <scene> --times 0.5,1.5 --spp 1                                                   # ms per sub-frame
node tools/render.mjs video --test <scene> --from 0 --to 4 --fps 30 --scale 0.5 --spp 2 --out out/wip/<scene>.mp4  # motion check
```
Look at every sheet you render (Read the PNG). Judge it like a harsh cinematographer: is it beautiful, legible, physically
convincing, does it have depth, contrast, a focal point? Iterate until it is. Typical failure modes: grey fog everywhere (no true
blacks), uniform noise with no large-scale structure, banding/stair-stepping in ray-marched volumes (jitter the start!),
saturated cartoon colours, tiny subject lost in the frame, NaN black holes, everything the same brightness.

## Deliverables
1. `app/shaders/<scene>.frag` (+ optional `<scene>_lib.glsl`).
2. `app/src/scenes/<scene>.js` exporting `DEFAULTS` (all your uniforms with sane values) and any camera/animation helpers that make
   the storyboard shots easy (e.g. `collapseState(progress)`).
3. `app/src/tests/<scene>.js` with test shots covering **every storyboard shot of your scene** (one test shot per storyboard row,
   animated over its 1-second slot where motion matters).
4. `docs/scenes/<scene>.md`: what each uniform does, how to stage each storyboard shot (camera + uniforms + suggested keyframes
   tied to the bar grid), measured ms per sub-frame, known limitations.
5. A final contact sheet `out/sheets/<scene>_final.png` (scale 0.5) of the storyboard shots.

Do not edit `app/src/engine.js`, `gl.js`, `main.js`, `cam.js`, `u.js`, `music.js`, `common.glsl`, `hash.glsl`, `sky.glsl`, `bh.frag`,
`tools/render.mjs`, or other agents' files. If you believe a shared file needs a change, describe it in your report instead.
Other agents are working in parallel on other scenes and share the GPU: keep test renders small (scale 0.5, spp 2) except for final checks.
