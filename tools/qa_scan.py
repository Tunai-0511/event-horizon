"""Scan finished chunks for broken frames: per-frame mean luma, frame-to-frame change and the share of near-black pixels.
Flags: sudden single-frame flashes/drops (not on a cut), frozen stretches, frames that are almost entirely black while
their neighbours are not.   tools/.venv/bin/python -I tools/qa_scan.py out/chunks/f00*.mp4 > out/qa_scan.txt
"""
import shutil
import subprocess
import sys

import numpy as np

W, H = 192, 108
for path in sys.argv[1:]:
    base = path.rsplit('/', 1)[-1]
    f0 = int(base[1:7])
    raw = subprocess.run([shutil.which('ffmpeg') or 'ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                         capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
    mean = fr.mean((1, 2))
    diff = np.r_[0, np.abs(np.diff(fr, axis=0)).mean((1, 2))]
    black = (fr < 6).mean((1, 2))
    for i in range(1, len(fr) - 1):
        t = (f0 + i) / 30
        # isolated spike: this frame differs from both neighbours while they agree with each other
        nb = np.abs(fr[i + 1] - fr[i - 1]).mean()
        if diff[i] > 12 and np.abs(fr[i + 1] - fr[i]).mean() > 12 and nb < 0.5 * diff[i]:
            print(f'SPIKE  t={t:8.3f}  frame {f0 + i}  diff {diff[i]:.1f} (neighbours {nb:.1f})  mean {mean[i]:.1f}')
        if black[i] > 0.995 and black[i - 1] < 0.9 and black[i + 1] < 0.9:
            print(f'BLACK  t={t:8.3f}  frame {f0 + i}')
    # frozen: 20+ identical frames with content
    run = 0
    for i in range(1, len(fr)):
        run = run + 1 if diff[i] < 0.02 and mean[i] > 3 else 0
        if run == 20:
            print(f'FROZEN t={(f0 + i) / 30:8.3f}  frame {f0 + i}')
    print(f'# {base}: mean luma {mean.mean():5.1f}  min {mean.min():5.1f}  max {mean.max():5.1f}', flush=True)
