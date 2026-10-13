// The galaxy stretch of the film at its real film times (474.75–527.50), for motion checks:
//   node tools/render.mjs video --test galaxyfilm --from 474.75 --to 527.5 --fps 30 --scale 0.5 --spp 2
import { shots as galaxyShots } from '../scenes/galaxy.js';
export const shots = galaxyShots;
export const duration = 527.5;
