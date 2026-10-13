// debug: march step-count heatmap for every storyboard shot (pixel value = steps / MAXSTEPS, grey)
import { shots as main } from './nebula.js';
export const shots = main.map((s, i) => ({ ...s, id: `st${i}`, defines: { DBG_STEPS: 1 }, at: (t) => ({ ...s.at(t), post: { exposure: 0, bloom: 0, tm: 0, vignette: 0, grain: 0 } }) }));
export const duration = main.length;
