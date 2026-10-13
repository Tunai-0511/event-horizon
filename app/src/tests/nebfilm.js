// The nebula part of Act I at real film time (38.05-143.54) for motion / video checks:
//   node tools/render.mjs video --test nebfilm --from 83.27 --to 98.33 --fps 30 --scale 0.5 --spp 2 --out out/wip/neb_collapse.mp4
import { act1Shots } from '../scenes/nebula.js';
export const shots = act1Shots({ spp: 4 });
export const duration = 143.54;
