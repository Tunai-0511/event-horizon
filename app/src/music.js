// Musical grid of the soundtrack (Interstellar Main Theme, extended edit, 775.13 s).
// The edit loops one cue six times; each loop = quiet organ -> 2 rising bars -> build -> 2-bar dip -> 5-bar climax -> stop bar.
// A bar (one chord) is ~3.77 s = 8 eighth notes at ~128/min.
import grid from '../data/grid.json' with { type: 'json' };

export const DURATION = 775.13;

// bar downbeats, with the two splice gaps of the edit filled in
export const BARS = (() => {
  const b = grid.bars.slice().sort((x, y) => x - y);
  const out = [b[0]];
  for (let i = 1; i < b.length; i++) {
    const gap = b[i] - out[out.length - 1];
    if (gap > 5.2) { const n = Math.round(gap / 3.77); for (let k = 1; k < n; k++) out.push(out[out.length - 1] + gap / n); }
    out.push(b[i]);
  }
  return out;
})();

// Acts = loops. Each lists its section boundaries (seconds).
export const ACT = [
  { name: 'endless', quiet: 0.0, intro: 15.45, build: 22.98, dip: 113.41, climax: 120.94, stop: 139.78, end: 143.54 },
  { name: 'giant', quiet: 143.54, intro: 158.43, build: 166.01, dip: 211.49, climax: 219.07, stop: 238.02, end: 241.79 },
  { name: 'birth', quiet: 241.79, intro: 256.82, build: 264.36, dip: 354.78, climax: 362.31, stop: 381.15, end: 384.92 },
  { name: 'devour', quiet: 384.92, intro: 399.40, build: 406.94, dip: 497.36, climax: 504.89, stop: 523.73, end: 527.50 },
  { name: 'us', quiet: 527.50, intro: 542.37, build: 549.95, dip: 595.43, climax: 603.01, stop: 621.96, end: 625.72 },
  { name: 'horizon', quiet: 625.72, intro: 640.74, build: 648.28, dip: 738.70, climax: 746.23, stop: 765.07, end: 775.13 },
];

// nearest bar line to t
export function snap(t) { let best = BARS[0]; for (const b of BARS) if (Math.abs(b - t) < Math.abs(best - t)) best = b; return best; }
// bar k counted from time t0 (k = 0 -> the bar at/after t0)
export function barFrom(t0, k) { const i = BARS.findIndex((b) => b >= t0 - 0.05); return BARS[Math.min(BARS.length - 1, i + k)]; }
// all bar lines inside [a, b)
export function barsIn(a, b) { return BARS.filter((x) => x >= a - 0.05 && x < b - 0.05); }
// index of the bar containing t and the phase within it
export function barAt(t) { let i = 0; while (i + 1 < BARS.length && BARS[i + 1] <= t) i++; const len = (BARS[i + 1] ?? BARS[i] + 3.77) - BARS[i]; return { i, t0: BARS[i], phase: (t - BARS[i]) / len, len }; }
// sum of decaying impulses on every bar line in [a, b) — a "pulse" that kicks on each downbeat
export function barPulse(t, a, b, decay = 0.9) { let s = 0; for (const x of barsIn(a, b)) if (t >= x) s += Math.exp(-(t - x) / decay); return s; }
