"""Tidal disruption of a sun-like star by a 10^6 M_sun black hole, from first approach to disk formation.

    tools/.venv/bin/python -I tools/sph/tde.py relax      # build + relax the star in isolation  -> star_relaxed.npz
    tools/.venv/bin/python -I tools/sph/tde.py run        # the encounter                         -> app/data/sim/tde/

Physical set-up (units r_s = 1, c = 1, G M_bh = 0.5; r_s/c = 9.85 s for 10^6 M_sun):
    star: M = 1e-6 M_bh (the Sun), R = 0.236 r_s (R_sun), polytrope n = 1.5
    tidal radius r_t = R (M_bh/M)^(1/3) = 23.6 r_s; penetration beta = 2  ->  pericentre r_p = 11.8 r_s
    orbit: eccentric (e ~ 0.7, as for a star delivered by binary break-up), so all the debris is bound and comes back
    within a few orbital times; relativistic apsidal precession (Paczynski–Wiita) makes the returning stream cross
    itself, the collision shocks circularise it into a disk.
"""
import json
import math
import os
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sph import SPH, GM, RS, polytrope_star  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / "tools/sph/work"
OUT = Path(os.environ["TDE_OUT"]) if os.environ.get("TDE_OUT") else ROOT / "app/data/sim/tde"
WORK.mkdir(parents=True, exist_ok=True)

N = int(os.environ.get("TDE_N", "16000"))
M_STAR = 1e-6
R_STAR = 0.236
R_P = 11.8
R_A = 66.0


def relax():
    x, v, u, m = polytrope_star(N, M_STAR, R_STAR, n=1.5, G=GM)
    sim = SPH(x, v, u, m, bh=False, self_gravity=True, grav_every=1, damping=0.0, alpha=1.0)
    tdyn = math.sqrt(R_STAR ** 3 / (GM * M_STAR))
    print(f"N={N}  m={m:.3e}  t_dyn={tdyn:.1f}  h_med={np.median(sim.h):.4f}")
    t_end = 6.0 * tdyn
    t0 = time.time()
    while sim.t < t_end:
        # velocity damping that fades out: removes the noise of the initial lattice
        sim.damping = 0.05 / tdyn * 20 * max(0.0, 1.0 - sim.t / (0.8 * t_end))
        dt = sim.timestep()
        sim.step(dt)
        if sim.step_no % 50 == 0:
            r = np.linalg.norm(sim.x - sim.x.mean(0), axis=1)
            ek = 0.5 * (sim.v ** 2).sum(1).mean()
            print(f"t={sim.t:8.1f}/{t_end:.0f}  dt={dt:.3f}  R90={np.percentile(r, 90):.4f}  Rmax={r.max():.4f}  Ek={ek:.2e}  {time.time() - t0:.0f}s", flush=True)
    np.savez(WORK / "star_relaxed.npz", x=sim.x - sim.x.mean(0), v=sim.v - sim.v.mean(0), u=sim.u, m=m)
    print("saved", WORK / "star_relaxed.npz")


def orbit_ic(r_a, r_p):
    """Position/velocity at apocentre for an orbit with turning points r_a, r_p in the Paczynski–Wiita potential."""
    L2 = 2.0 * GM * (1.0 / (r_a - RS) - 1.0 / (r_p - RS)) / (1.0 / r_a ** 2 - 1.0 / r_p ** 2)
    L = math.sqrt(L2)
    # orbital plane: tilted 30 deg from the renderer's x-z plane (the camera framing decides the rest)
    inc = math.radians(30.0)
    pos = np.array([r_a, 0.0, 0.0])
    vel = np.array([0.0, math.sin(inc), math.cos(inc)]) * (L / r_a)
    return pos, vel, L


def run():
    d = np.load(WORK / os.environ.get("TDE_STAR", "star_relaxed.npz"))
    x, v, u, m = d["x"], d["v"], d["u"], float(d["m"])
    n_run = len(x)                      # the relaxed star decides the particle count
    pos, vel, L = orbit_ic(R_A, R_P)
    cool = float(os.environ.get("TDE_COOL", "0")) or None
    sim = SPH(x + pos, v + vel, u, m, bh=True, r_acc=3.0, self_gravity=True, grav_every=4, alpha=1.0, cool_beta=cool)
    OUT.mkdir(parents=True, exist_ok=True)
    t_end = float(os.environ.get("TDE_TEND", "7000"))
    dt_snap = float(os.environ.get("TDE_DTSNAP", "4"))
    times = []
    next_snap = 0.0
    t0 = time.time()
    while sim.t <= t_end:
        if sim.t >= next_snap:
            snap = sim.snapshot()
            snap.tofile(OUT / f"s{len(times):05d}.bin")
            times.append(sim.t)
            next_snap += dt_snap
            alive = sim.alive.sum()
            print(f"snap {len(times) - 1:5d}  t={sim.t:8.1f}  alive={alive}  rmin={np.linalg.norm(sim.x[sim.alive], axis=1).min():.2f}  "
                  f"wall {time.time() - t0:.0f}s", flush=True)
            (OUT / "meta.json").write_text(json.dumps({
                "N": n_run, "fields": ["x", "y", "z", "vx", "vy", "vz", "h", "u"], "times": times, "m": m,
                "units": "r_s = 1, c = 1, GM = 0.5", "star": {"M": M_STAR, "R": R_STAR, "r_p": R_P, "r_a": R_A},
            }))
        # self-gravity matters most while the star is whole and being torn; afterwards refresh it less often
        sim.grav_every = 4 if sim.t < 1800 else 8
        dt = min(sim.timestep(), next_snap - sim.t + 1e-9)
        sim.step(max(dt, 1e-6))
    print("done", time.time() - t0)


if __name__ == "__main__":
    {"relax": relax, "run": run}[sys.argv[1]]()
