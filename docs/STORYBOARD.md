# EVENT HORIZON — storyboard

13-minute film computed entirely in fragment shaders (no meshes, no models, no images, no text).
Music: Hans Zimmer, *Interstellar Main Theme* (extended edit, 775.13 s). The edit loops one cue six times;
each loop is **quiet organ → 2 rising bars → build → 2-bar dip → 5-bar climax → hard stop**. Bar ≈ 3.77 s.
Six loops = six acts. Each climax is a bigger revelation; each hard stop is a hard cut.

Times are seconds. `app/src/music.js` has the exact bar grid (`BARS`, `ACT[k]`).

## I. 無垠 THE ENDLESS (0.00 – 143.54) — `space`, `nebula`
| time | section | shot |
|---|---|---|
| 0.00–15.45 | quiet | `1.void` Black. One star appears on the first organ note, then others by brightness, the Milky Way faintly. |
| 15.45–22.98 | intro | `1.unveil` Each rising organ chord unveils a layer: stars, the Milky Way and its dust lanes; slow pan and widening. |
| 22.98–38.05 | build | `1.deep` Exponential zoom into a dark patch (50 deg -> 0.16 deg): thousands of galaxies. |
| 38.05–53.12 | build | `neb_exterior` A giant dark cloud silhouetted against the Milky Way's bulge, rim-lit. |
| 53.12–68.19 | build | `neb_pillarsWide` -> `neb_pillarsClose` (joined into one move): pillars with ionised edges, a teal [O III] heart. |
| 68.19–83.27 | build | `neb_globules`, `neb_embryo`: comet globules with shadow tails; a red embryo glowing inside a dark cocoon. |
| 83.27–98.33 | build | `neb_collapse` -> `neb_spiral` (joined): a dense clump fed by streams, then spiral streamers winding in. |
| 98.33–113.41 | build | `neb_disk`, `neb_diskClose`, `neb_jets`, `neb_jetsWide` (every bar): flattened spinning disk, dull red protostar, first jets. |
| 113.41–120.94 | dip | `neb_dip` slow push into the flickering protostar; light dims. |
| 120.94–139.78 | climax | `neb_ignite`, `neb_blast` (joined), `neb_front`, `neb_cluster` (joined), `neb_ablaze`: the star turns on and keeps brightening; the light front tears through the cloud; other stars ignite; wide: the cloud ablaze from inside. Brightness climbs every bar. |
| 139.78–143.54 | stop | `neb_aftermath` quiet wide, the blue star at the heart. |

## II. 巨星 THE GIANT (143.54 – 241.77) — `star`, `nova`
| time | section | shot |
|---|---|---|
| 143.54–158.43 | quiet | `star_limb` the blue supergiant's limb: near-white flowing plasma, prominence arches, spicules. |
| 158.43–166.01 | intro | `star_full` pull back to the whole star; a prominence erupts on the chord. |
| 166.01–181.17 | build | `star_evolve` blue -> yellow -> red supergiant (radius x7), dusty mass loss. |
| 181.17–196.33 | build | `star_inside` fly into the star: nested luminous fusion shells (H, He, C, Ne, O, Si) around a growing dark iron core. |
| 196.33–211.49 | build | `star_throes_a..d` (every bar): the red supergiant pulsing, shedding shells. |
| 211.49–219.07 | dip | `star_collapse` the iron core shrinks to a blinding point; layers rush inward. |
| 219.07–238.02 | climax | `nova-bounce` -> `nova-breakout` (joined), `nova-explosion`, `nova-engulf`, `nova-echoes`: glow from within, breakout front, Rayleigh–Taylor fireball, the shell sweeps past us, light echoes in dust sheets. Crescendo to the last bar. |
| 238.02–249.29 | stop + quiet | `nova-stop`, `nova-remnant`: the light dies; centuries later a filament network (H-alpha, [O III], [S II]); its centre is dark. |

## III. 誕生 BIRTH (241.77 – 384.92) — `bh` (+ lensed remnant), SPH fallback
| time | section | shot |
|---|---|---|
| 249.29–264.36 | quiet + intro | `3.quiet` (dissolve from the nova remnant) one take inside the remnant: a black point bends the filaments and stars; a star behind it closes into an Einstein ring on the intro bar. |
| 264.36–294.50 | build | `3.orbit` one take circling the naked hole: the remnant's filaments and the stars are lensed into arcs and rings (geodesic ray tracing — light is never drawn, only imaged). |
| 294.50–324.64 | build | `3.fallback` SPH (tools/sph/fallback.py, 24k particles): ejecta that failed to escape rain back onto the hole. |
| 324.64–354.78 | build | `3.ring` the infall collides in the equatorial plane, radiates, keeps its angular momentum: a glowing ring. |
| 354.78–362.31 | dip | `3.dip` the ring settles; the thin-disk solution takes over from the particles. |
| 362.31–381.15 | climax | `3.reveal` + `3.skim`: the disk spreads inward from the ring to the ISCO, heating (T ∝ r^-3/4) — the inner disk ignites; one continuous rise and swing, then skimming the inner edge. |
| 381.15–384.92 | stop | `3.stop` silent edge-on view. |

## IV. 吞噬 DEVOUR (384.92 – 527.50) — SPH tidal disruption, `galaxy`
| time | section | shot |
|---|---|---|
| 384.92–437.08 | quiet → build | `4.near` (dissolve) one take, SPH (tools/sph/tde.py: 32k particles, self-gravity, Paczynski–Wiita hole, cooling of shocked gas): a sun-like star falls in; it bulges, is stretched along the line to the hole and squeezed across it, and torn; the camera rises and draws back as the debris unspools. |
| 437.08–474.75 | build | `4.return` one take: the stream swings out and back; the returning gas precesses, crosses itself, shocks, glows and settles into a disk. |
| 474.75–527.50 | build → climax → stop | galaxy scene (dissolve in): pull back to the galaxy around the hole; quasar ignition; jets. |

## V. 我們 US (527.50 – 625.70) — N-body solar system (tools/sph/solar.py)
| time | section | shot |
|---|---|---|
| 527.50–565.11 | quiet → build | `5.system` (dissolve) one take: our Sun among the inner orbits; long-exposure trails (one revolution each) of the eight planets; the camera draws back and swings round until the hole sits behind the system. |
| 565.11–595.43 | build | `5.fall` one take from behind the system: 79 years of fall time-lapsed; the outer paths bend as the tide grows; Uranus, Neptune and Jupiter are torn away. |
| 595.43–603.01 | dip | `5.home` (joined) the inner system, the hole filling the sky behind it. |
| 603.01–621.96 | climax | `5.plunge` one take from the far side: Jupiter, then the Sun — lensed into a ring as it passes behind — the inner planets, last the outer planets the tide had strung out. |
| 621.96–625.70 | stop | `5.stop` nothing of us remains. |

## VI. 視界 HORIZON (625.70 – 775.13) — free-falling observer (rain frame)
| time | section | shot |
|---|---|---|
| 625.70–708.56 | quiet → build | `6.fall` (dissolve) one long take: alone, falling; the hole and its disk grow from a distant jewel to the whole sky. |
| 708.56–738.70 | build | `6.sphere` past the photon sphere, looking sideways: the sky folds into a band. |
| 738.70–746.23 | dip | `6.horizon` the horizon passes — nothing happens; the camera swings back to look ahead. |
| 746.23–765.07 | climax | `6.inside` inside: the universe is only visible outside a black cone ahead (half-angle acos √r), blueshifted without limit at its edge; the camera follows the edge as the cone opens: a blazing ring, then a line. |
| 765.07–775.13 | stop | the singularity: black. |
