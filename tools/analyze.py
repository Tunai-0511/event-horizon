"""Analyse the soundtrack: energy envelopes, onsets, beat grid, section boundaries.

    tools/.venv/bin/python -I tools/analyze.py audio/theme.wav

Writes app/data/audio.json (consumed by the timeline) and out/analysis/*.png (for reading the structure).
"""
import json
import sys
from pathlib import Path

import librosa
import matplotlib
import numpy as np
import scipy.ndimage as ndi
import scipy.signal as sig

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
src = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "audio/theme.wav")
OUT_JSON = ROOT / "app/data/audio.json"
OUT_FIG = ROOT / "out/analysis"
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
OUT_FIG.mkdir(parents=True, exist_ok=True)

SR = 22050
HOP = 512
y, sr = librosa.load(src, sr=SR, mono=True)
dur = len(y) / sr
print(f"duration {dur:.3f}s")

# --- energy envelopes (10 Hz) -------------------------------------------------------------
S = np.abs(librosa.stft(y, n_fft=4096, hop_length=HOP))
freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
times = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)


def band(lo, hi):
    m = (freqs >= lo) & (freqs < hi)
    return np.sqrt((S[m] ** 2).sum(0))


rms = librosa.feature.rms(S=S, frame_length=4096)[0]
bands = {"sub": band(20, 80), "low": band(80, 300), "mid": band(300, 2000), "high": band(2000, 11000)}


def to_db_norm(x):
    d = 20 * np.log10(x + 1e-9)
    hi = np.percentile(d, 99.5)
    return np.clip((d - (hi - 60)) / 60, 0, 1)  # 0 = -60 dB below loud, 1 = loud


def resample(x, rate=10):
    tt = np.arange(0, dur, 1 / rate)
    return np.interp(tt, times, x)


env = {k: resample(to_db_norm(v)).round(4).tolist() for k, v in bands.items()}
env["rms"] = resample(to_db_norm(rms)).round(4).tolist()
# slow loudness (2 s smoothing) — the "intensity" the visuals follow
loud = ndi.gaussian_filter1d(np.array(env["rms"]), 10)
env["loud"] = loud.round(4).tolist()

# --- onsets & beat grid ---------------------------------------------------------------------
oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP, aggregate=np.median)
onsets = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=HOP, units="time", backtrack=False)
tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=HOP, units="time", tightness=120)
tempo = float(np.atleast_1d(tempo)[0])
print(f"tempo ~{tempo:.1f} BPM, {len(beats)} beats, {len(onsets)} onsets")

# tempogram-based local tempo to see if the piece has a steady pulse
tg = librosa.feature.tempogram(onset_envelope=oenv, sr=sr, hop_length=HOP, win_length=384)
tfreq = librosa.tempo_frequencies(tg.shape[0], sr=sr, hop_length=HOP)

# --- structure: chroma/MFCC self-similarity novelty -------------------------------------------
chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=HOP)
mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=20)
# beat-free fixed 1 s frames keep the matrix small
fr = int(round(1.0 * sr / HOP))
def pool(X):
    n = X.shape[1] // fr
    return X[:, : n * fr].reshape(X.shape[0], n, fr).mean(2)
F = np.vstack([librosa.util.normalize(pool(chroma), axis=0), 0.5 * librosa.util.normalize(pool(mfcc), axis=0)])
R = librosa.segment.recurrence_matrix(F, width=3, mode="affinity", sym=True)
SSM = np.corrcoef(F.T)
# checkerboard novelty
def novelty(ssm, k=16):
    g = np.outer(sig.windows.gaussian(2 * k, k / 2), sig.windows.gaussian(2 * k, k / 2))
    cb = np.block([[np.ones((k, k)), -np.ones((k, k))], [-np.ones((k, k)), np.ones((k, k))]]) * g
    n = ssm.shape[0]
    pad = np.pad(ssm, k, mode="edge")
    return np.array([(pad[i : i + 2 * k, i : i + 2 * k] * cb).sum() for i in range(n)])
nov = novelty(SSM, 12)
nov = (nov - nov.min()) / (np.ptp(nov) + 1e-9)
pk, _ = sig.find_peaks(nov, distance=12, prominence=0.08)
bounds = [float(p) for p in pk]
print("novelty boundaries (s):", [round(b) for b in bounds])

# loudness landmarks: big rises (crescendo arrivals) and drops
d_loud = np.gradient(loud) * 10
rises, _ = sig.find_peaks(d_loud, height=0.05, distance=40)
falls, _ = sig.find_peaks(-d_loud, height=0.05, distance=40)

data = {
    "file": "theme.wav",
    "duration": round(dur, 4),
    "rate": 10,
    "tempo": round(tempo, 2),
    "beats": [round(float(b), 4) for b in beats],
    "onsets": [round(float(o), 4) for o in onsets],
    "bounds": [round(b, 2) for b in bounds],
    "rises": [round(r / 10, 2) for r in rises],
    "falls": [round(f / 10, 2) for f in falls],
    "env": env,
}
OUT_JSON.write_text(json.dumps(data))
print("wrote", OUT_JSON)

# --- figures: 4 rows x ~200 s ----------------------------------------------------------------
mel = librosa.power_to_db(librosa.feature.melspectrogram(S=S**2, sr=sr, n_mels=128), ref=np.max)
tt10 = np.arange(len(env["rms"])) / 10
rows = 4
seg = dur / rows
fig, axes = plt.subplots(rows * 2, 1, figsize=(30, 5 * rows), gridspec_kw={"height_ratios": [2, 1] * rows})
for r in range(rows):
    a0, a1 = r * seg, (r + 1) * seg
    ax = axes[2 * r]
    i0, i1 = np.searchsorted(times, [a0, a1])
    ax.imshow(mel[:, i0:i1], aspect="auto", origin="lower", extent=[a0, a1, 0, 128], cmap="magma")
    for b in bounds:
        if a0 <= b <= a1:
            ax.axvline(b, color="cyan", lw=1.5)
    ax.set_xlim(a0, a1)
    ax.set_xticks(np.arange(np.ceil(a0 / 10) * 10, a1, 10))
    ax.grid(axis="x", color="w", alpha=0.25)
    ax2 = axes[2 * r + 1]
    ax2.plot(tt10, env["rms"], color="k", lw=0.6, label="rms")
    ax2.plot(tt10, env["loud"], color="r", lw=1.5, label="loud")
    ax2.plot(tt10, env["sub"], color="b", lw=0.6, alpha=0.6, label="sub")
    ax2.plot(tt10, env["high"], color="g", lw=0.6, alpha=0.6, label="high")
    ot = librosa.frames_to_time(np.arange(len(oenv)), sr=sr, hop_length=HOP)
    ax2.plot(ot, oenv / oenv.max(), color="orange", lw=0.4, alpha=0.7)
    for b in beats:
        if a0 <= b <= a1:
            ax2.axvline(b, color="gray", lw=0.3, alpha=0.5)
    for b in bounds:
        if a0 <= b <= a1:
            ax2.axvline(b, color="cyan", lw=1.5)
    ax2.set_xlim(a0, a1)
    ax2.set_xticks(np.arange(np.ceil(a0 / 10) * 10, a1, 10))
    ax2.set_ylim(0, 1.05)
    ax2.grid(axis="x", alpha=0.4)
    if r == 0:
        ax2.legend(loc="upper left", fontsize=8)
plt.tight_layout()
plt.savefig(OUT_FIG / "overview.png", dpi=60)

fig, ax = plt.subplots(2, 1, figsize=(16, 16))
ax[0].imshow(SSM, cmap="gray_r", origin="lower", extent=[0, SSM.shape[0], 0, SSM.shape[0]])
ax[0].set_title("self-similarity (1 s frames)")
ax[1].imshow(tg[:, :: 4], aspect="auto", origin="lower", cmap="magma", extent=[0, dur, 0, tg.shape[0]])
yt = [i for i in range(0, tg.shape[0], 16)]
ax[1].set_yticks(yt, [f"{tfreq[i]:.0f}" for i in yt])
ax[1].set_title("tempogram")
plt.tight_layout()
plt.savefig(OUT_FIG / "ssm_tempogram.png", dpi=60)
print("figures in", OUT_FIG)
