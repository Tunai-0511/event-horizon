"""Supernova fallback onto the newborn black hole: clumpy, slowly rotating ejecta that failed to escape fall back,
collide in the equatorial plane, radiate, and settle into the first accretion disk.

    tools/.venv/bin/python -I tools/sph/fallback.py        -> app/data/sim/fallback/

Units r_s = 1, c = 1, G M = 0.5.  Gas: 24k SPH particles, ideal gas with radiative cooling of shock heat (beta = 1),
self-gravity on (negligible here), the hole as a Paczynski–Wiita potential, accretion inside 3 r_s.
Initial state: a thick shell 35–110 r_s, density in clumps (fBm-modulated), falling inward at a fraction of free fall,
rotating about +y with specific angular momentum j ∝ sin^2(theta) so that the equatorial gas circularises near
12–16 r_s while the polar gas falls almost straight in.
"""
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sph import SPH, GM, RS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ["FB_OUT"]) if os.environ.get("FB_OUT") else ROOT / "app/data/sim/fallback"
N = int(os.environ.get("FB_N", "24000"))
T_END = float(os.environ.get("FB_TEND", "5200"))
DT_SNAP = float(os.environ.get("FB_DTSNAP", "4"))


def value_noise3(p, seed):
    """Smooth 3D value noise (trilinear of hashed lattice values), p: (n, 3)."""
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)
    def h(ix, iy, iz):
        x = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
        x = (x ^ (x >> 13)) * 1274126177
        return ((x ^ (x >> 16)) & 0xFFFF) / 65535.0
    c = np.zeros(len(p))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                c += w * h(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return c


def fbm(p, seed, octaves=4):
    s, a, n = 0.0, 0.5, 0.0
    for o in range(octaves):
        s = s + a * value_noise3(p * (2 ** o), seed + o)
        n += a
        a *= 0.5
    return s / n


def initial():
    rng = np.random.default_rng(11)
    # rejection-sample a clumpy shell
    pts = []
    while sum(len(q) for q in pts) < N:
        m = 400000
        r = 35 + 75 * rng.random(m) ** 0.8
        u = rng.uniform(-1, 1, m)
        ph = rng.uniform(0, 2 * math.pi, m)
        s = np.sqrt(1 - u * u)
        x = np.stack([r * s * np.cos(ph), r * u, r * s * np.sin(ph)], 1)
        d = fbm(x / 9.0, 3) * 0.7 + fbm(x / 3.5, 7) * 0.3
        keep = rng.random(m) < np.clip((d - 0.42) * 3.2, 0, 1) ** 2
        pts.append(x[keep])
    x = np.concatenate(pts)[:N]
    r = np.linalg.norm(x, axis=1)
    rhat = x / r[:, None]
    yaxis = np.array([0.0, 1.0, 0.0])
    sin2 = 1 - (rhat @ yaxis) ** 2
    # rotation: j = j0 sin^2(theta) (equatorial gas circularises at r_c = j^2 / GM for Keplerian), plus a little shear
    rc = 13.0
    j0 = math.sqrt(GM * rc) * rc / (rc - RS)
    j = j0 * sin2 * (0.85 + 0.3 * rng.random(N))
    phi_hat = np.cross(yaxis, rhat)
    nphi = np.linalg.norm(phi_hat, axis=1)
    phi_hat = phi_hat / np.maximum(nphi, 1e-9)[:, None]
    v = phi_hat * (j / r)[:, None]
    # infall at ~35 % of the local free-fall speed, with turbulence
    vff = np.sqrt(2 * GM / (r - RS))
    v += -rhat * (0.35 * vff)[:, None]
    v += rng.normal(0, 1, (N, 3)) * (0.06 * vff)[:, None]
    # cold gas: sound speed ~ 5 % of the orbital speed
    u = 0.5 * (0.05 * np.sqrt(GM / r)) ** 2
    m_part = 1e-4 / N          # total fallback mass 1e-4 M_bh: self-gravity negligible, as it should be
    return x, v, u, m_part


def main():
    x, v, u, m = initial()
    print(f"N={len(x)}  r range {np.linalg.norm(x, axis=1).min():.1f}-{np.linalg.norm(x, axis=1).max():.1f}")
    sim = SPH(x, v, u, m, bh=True, r_acc=3.0, self_gravity=False, alpha=1.0, cool_beta=1.0)
    OUT.mkdir(parents=True, exist_ok=True)
    times, next_snap, t0 = [], 0.0, time.time()
    while sim.t <= T_END:
        if sim.t >= next_snap:
            sim.snapshot().tofile(OUT / f"s{len(times):05d}.bin")
            times.append(sim.t)
            next_snap += DT_SNAP
            if len(times) % 25 == 1:
                rr = np.linalg.norm(sim.x[sim.alive], axis=1)
                print(f"snap {len(times) - 1:5d} t={sim.t:7.1f} alive={sim.alive.sum()} r50={np.median(rr):.1f} r10={np.percentile(rr, 10):.1f} wall {time.time() - t0:.0f}s", flush=True)
            (OUT / "meta.json").write_text(json.dumps({"N": len(x), "fields": ["x", "y", "z", "vx", "vy", "vz", "h", "u"], "times": times, "m": m,
                                                        "units": "r_s = 1, c = 1, GM = 0.5", "kind": "fallback"}))
        dt = min(sim.timestep(), next_snap - sim.t + 1e-9)
        sim.step(max(dt, 1e-6))
    print("done", time.time() - t0)


if __name__ == "__main__":
    main()
