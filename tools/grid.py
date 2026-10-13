"""Musical grid for the Interstellar theme (extended edit).

The edit loops one ~2:20 cue six times.  Every loop is:  quiet organ  ->  build  ->  dip (breath)  ->  climax  ->  hard stop.
The pulse is eighth notes at ~128/min, the bar (= one chord) is 8 eighths = 3.75 s, a phrase is 4 bars = 15 s.

    tools/.venv/bin/python -I tools/grid.py

Reads app/data/audio.json, writes app/data/grid.json:
    beats      eighth-note pulse (from the beat tracker)
    bars       downbeats (chord changes), phase solved per loop because the edit's splices shift it
    sections   [{kind, t0, t1, loop}]  kind in quiet|build|dip|climax|stop|tail
"""
import json
from pathlib import Path

import librosa
import numpy as np
import scipy.ndimage as ndi

ROOT = Path(__file__).resolve().parents[1]
A = json.loads((ROOT / "app/data/audio.json").read_text())
R = A["rate"]
loud = np.array(A["env"]["loud"])
high = ndi.gaussian_filter1d(np.array(A["env"]["high"]), 5)
sub = ndi.gaussian_filter1d(np.array(A["env"]["sub"]), 5)
rms = np.array(A["env"]["rms"])
T = np.arange(len(loud)) / R
dur = A["duration"]

# ---- sections from the loudness / brightness curves -------------------------------------------
# quiet = loud < 0.70 for > 8 s ; climax = high band > 0.86 sustained (after a dip)
quiet_mask = ndi.binary_opening(ndi.gaussian_filter1d(rms, 8) < 0.70, iterations=40)
lab, n = ndi.label(quiet_mask)
quiet = [(T[lab == i][0], T[lab == i][-1]) for i in range(1, n + 1)]
print("quiet:", [(round(a, 1), round(b, 1)) for a, b in quiet])

y, sr = librosa.load(ROOT / "audio/theme.wav", sr=22050, mono=True)
HOP = 512
C = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
cf = sr / HOP
Cn = librosa.util.normalize(C, axis=0)
nov = np.r_[0, np.linalg.norm(np.diff(Cn, axis=1), axis=0)]
nov = ndi.gaussian_filter1d(nov, 2)
novmax = ndi.maximum_filter1d(nov, 5)
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)


def at(sig_, t, rate):
    i = int(round(t * rate))
    return sig_[max(0, min(len(sig_) - 1, i))]


# ---- bar grid: period 3.75 s nominal; solve period+phase per loop on chroma novelty ----------
loops = []
edges = [0.0] + [b for a, b in quiet[:]] + [dur]
# loops start where a quiet section starts (the first loop starts at 0)
starts = [0.0] + [a for a, b in quiet if a > 5]
starts = sorted(set(round(s, 1) for s in starts))
starts.append(dur)
bars = []
for k in range(len(starts) - 1):
    a, b = starts[k], starts[k + 1]
    best = None
    for per in np.arange(3.70, 3.80, 0.0025):
        for ph in np.arange(0, per, 0.02):
            ts = np.arange(a + ph, b - 0.5, per)
            sc = novmax[np.clip((ts * cf).astype(int), 0, len(novmax) - 1)].mean()
            if best is None or sc > best[0]:
                best = (sc, per, ph)
    sc, per, ph = best
    ts = np.arange(a + ph, b - 0.2, per)
    # allow the first bar before the solved phase if it fits
    if ts[0] - per > a - 0.01:
        ts = np.r_[ts[0] - per, ts]
    print(f"loop {k}: {a:.1f}-{b:.1f}  bar {per:.4f}s  phase {ph:.2f}  score {sc:.3f}  bars {len(ts)}")
    loops.append({"t0": a, "t1": b, "bar": round(per, 4), "phase": round(a + ph, 3)})
    bars += [round(float(t), 3) for t in ts]

# ---- per loop landmarks: build start, dip, climax, stop ---------------------------------------
sections = []
for k, L in enumerate(loops):
    a, b = L["t0"], L["t1"]
    q = [x for x in quiet if abs(x[0] - a) < 2 or (k == 0 and x[0] < 3)]
    q_end = q[0][1] if q else a
    if k == 0:
        q_end = max(q_end, 22.0) if not q else q_end
    # climax: last time high band crosses 0.86 upward before the loop end, sustained > 8 s
    m = (T > a + 20) & (T < b)
    idx = np.where(m)[0]
    hi = high[idx] > 0.80
    lab2, n2 = ndi.label(hi)
    runs = [(T[idx][lab2 == i][0], T[idx][lab2 == i][-1]) for i in range(1, n2 + 1)]
    runs = [r for r in runs if r[1] - r[0] > 6]
    clim = runs[-1] if runs else (b - 25, b - 5)
    # dip: the low-brightness pocket right before the climax
    m2 = (T > clim[0] - 16) & (T < clim[0])
    j = np.where(m2)[0]
    dip0 = T[j][np.argmax(high[j] < 0.55)] if np.any(high[j] < 0.55) else clim[0] - 8
    # stop: where loudness collapses after the climax
    m3 = (T > clim[1] - 2) & (T < b + 1)
    j3 = np.where(m3)[0]
    stop = T[j3][np.argmax(rms[j3] < 0.70)] if np.any(rms[j3] < 0.70) else clim[1]
    snap = lambda t: min(bars, key=lambda x: abs(x - t))
    sections += [
        {"kind": "quiet", "loop": k, "t0": round(a, 2), "t1": round(q_end, 2)},
        {"kind": "build", "loop": k, "t0": round(q_end, 2), "t1": round(dip0, 2)},
        {"kind": "dip", "loop": k, "t0": round(dip0, 2), "t1": round(clim[0], 2)},
        {"kind": "climax", "loop": k, "t0": round(clim[0], 2), "t1": round(stop, 2)},
    ]
    print(f"   quiet {a:.1f}-{q_end:.1f}  build -{dip0:.1f}  dip -{clim[0]:.1f}  climax -{stop:.1f}"
          f"   (nearest bars: build {snap(q_end):.2f} dip {snap(dip0):.2f} climax {snap(clim[0]):.2f} stop {snap(stop):.2f})")

out = {"duration": dur, "beats": A["beats"], "bars": bars, "loops": loops, "sections": sections}
(ROOT / "app/data/grid.json").write_text(json.dumps(out, indent=1))
print("wrote grid.json;", len(bars), "bars")
