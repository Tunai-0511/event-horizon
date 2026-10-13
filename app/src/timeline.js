// The film: all shots of all acts, in order. Gaps render black.
import { DURATION } from './music.js';
import act1 from './shots/act1.js';
import act2 from './shots/act2.js';
import act3 from './shots/act3.js';
import act4 from './shots/act4.js';
import act5 from './shots/act5.js';
import act6 from './shots/act6.js';
import { shots as galShots } from './scenes/galaxy.js';
// the galaxy pull-back begins on the new disk: dissolve from the last TDE frame
const gal = galShots.map((s, i) => (i === 0 ? { ...s, dissolve: 3.0 } : s));

export const shots = [...act1, ...act2, ...act3, ...act4, ...gal, ...act5, ...act6];
export const duration = DURATION;

// sanity: overlaps / gaps (logged at boot)
const s = shots.slice().sort((a, b) => a.t0 - b.t0);
for (let i = 1; i < s.length; i++) {
  const g = s[i].t0 - s[i - 1].t1;
  if (g < -1e-3) console.warn(`overlap ${s[i - 1].id} / ${s[i].id} (${g.toFixed(2)} s)`);
  else if (g > 1e-3) console.warn(`gap ${s[i - 1].id} -> ${s[i].id} (${g.toFixed(2)} s)`);
}
