// Test shots for the `star` scene: every storyboard row of Act II exactly as staged in scenes/star.js filmShots()
// (the death-throes row has its four bar cuts), each compressed into a one-second slot. The shutter is scaled by the
// compression so motion blur matches the film's 180° shutter.
import { filmShots } from '../scenes/star.js';

const film = filmShots();
export const shots = film.map((s, i) => {
  const len = s.t1 - s.t0;
  return {
    id: s.id.replace('star_', ''), t0: i, t1: i + 1, scene: 'star', spp: s.spp, shutter: 0.5 / len,
    at: (t) => s.at(s.t0 + Math.min(Math.max(t - i, 0), 0.9999) * len),
  };
});
export const duration = shots.length;
