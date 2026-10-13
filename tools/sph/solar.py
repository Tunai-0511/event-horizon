"""Our solar system falling into a 1.5e9 M_sun black hole (N-body, no shortcuts).

    tools/.venv/bin/python -I tools/sph/solar.py      -> app/data/sim/solar.json

Units: r_s = 1, c = 1, G M_bh = 0.5.  For 1.5e9 M_sun: r_s = 29.6 AU (Neptune's orbit), r_s/c = 4.1 h.
Bodies: the hole (fixed, Paczynski–Wiita potential), the Sun, the eight planets (point masses; planets feel the Sun
and the hole, the Sun feels the hole and the planets). Integrated with DOP853 at rtol 1e-11.
The Sun starts 1500 r_s out on a capture orbit (specific angular momentum 1.85 r_s c, just under the 2 r_s c of the
marginally bound orbit, so it whirls around the hole before it plunges); planets on their real orbits (semi-major
axis, eccentricity, inclination), random phases.  Each planet is torn from the Sun near its tidal radius
r_t = a (M_bh / M_sun)^(1/3) and continues on its own path.
"""
import json
import math
from pathlib import Path

import numpy as np
from scipy.integrate import solve_ivp

ROOT = Path(__file__).resolve().parents[2]
GM = 0.5
RS = 1.0
M_RATIO = 1.5e9
GMS = GM / M_RATIO                      # the Sun
AU = 1.0 / 29.6
# name, a [AU], e, i [deg], mass [M_sun]
PLANETS = [
    ("mercury", 0.387, 0.206, 7.0, 1.66e-7), ("venus", 0.723, 0.007, 3.4, 2.45e-6), ("earth", 1.000, 0.017, 0.0, 3.0e-6),
    ("mars", 1.524, 0.093, 1.9, 3.2e-7), ("jupiter", 5.203, 0.049, 1.3, 9.55e-4), ("saturn", 9.537, 0.057, 2.5, 2.86e-4),
    ("uranus", 19.19, 0.046, 0.8, 4.37e-5), ("neptune", 30.07, 0.010, 1.8, 5.15e-5),
]


def rhs(t, y):
    n = len(y) // 6
    pos = y[: 3 * n].reshape(n, 3)
    vel = y[3 * n:].reshape(n, 3)
    acc = np.zeros_like(pos)
    r = np.linalg.norm(pos, axis=1)
    acc -= (GM / np.maximum(r - RS, 1e-3) ** 2 / np.maximum(r, 1e-9))[:, None] * pos   # the hole (PW)
    gone = r < 1.15                                                                     # swallowed: frozen at the horizon
    vel = np.where(gone[:, None], 0.0, vel)
    sun = pos[0]
    d = pos[1:] - sun
    rd = np.linalg.norm(d, axis=1)
    acc[1:] -= (GMS / rd ** 3)[:, None] * d                                              # the Sun on the planets
    masses = np.array([p[4] for p in PLANETS]) * GMS
    acc[0] += ((masses / rd ** 3)[:, None] * d).sum(0)                                   # the planets on the Sun
    acc[gone] = 0.0
    return np.concatenate([vel.ravel(), acc.ravel()])


def kepler_state(a, e, inc, phase, GMc, rng):
    """Position/velocity relative to the Sun at true anomaly `phase`, orbit in a plane tilted by `inc`."""
    p = a * (1 - e * e)
    r = p / (1 + e * math.cos(phase))
    x, y = r * math.cos(phase), r * math.sin(phase)
    h = math.sqrt(GMc * p)
    vx, vy = -GMc / h * math.sin(phase), GMc / h * (e + math.cos(phase))
    node = rng.uniform(0, 2 * math.pi)
    ci, si, cn, sn = math.cos(inc), math.sin(inc), math.cos(node), math.sin(node)
    def rot(u, v):
        # rotate (u, v, 0) by the node and the inclination
        X = u * cn - v * sn * ci
        Y = v * si
        Z = u * sn + v * cn * ci
        return np.array([X, Y, Z])
    return rot(x, y), rot(vx, vy)


def main():
    rng = np.random.default_rng(67)
    # ecliptic tilted against the infall plane: rotate everything by these angles
    tilt = np.radians(28.0)
    R = np.array([[1, 0, 0], [0, math.cos(tilt), -math.sin(tilt)], [0, math.sin(tilt), math.cos(tilt)]])
    r0 = 4000.0
    L = 1.85
    # radial infall from r0 with angular momentum L: energy of a parabolic orbit (falling in from far away)
    vt = L / r0
    vr = -math.sqrt(max(2 * GM / (r0 - RS) - vt * vt, 0.0))
    ang = np.radians(-35.0)
    rhat = np.array([math.cos(ang), 0.0, math.sin(ang)])
    that = np.array([-math.sin(ang), 0.12, math.cos(ang)])
    that /= np.linalg.norm(that)
    sun_x = rhat * r0
    sun_v = rhat * vr + that * vt
    xs, vs_ = [sun_x], [sun_v]
    for name, a, e, inc, m in PLANETS:
        px, pv = kepler_state(a * AU, e, math.radians(inc), rng.uniform(0, 2 * math.pi), GMS, rng)
        xs.append(sun_x + R @ px)
        vs_.append(sun_v + R @ pv)
    y0 = np.concatenate([np.array(xs).ravel(), np.array(vs_).ravel()])

    def captured(t, y):
        return np.linalg.norm(y[:3]) - 1.15
    captured.terminal = True
    t_ff = 0.5 * math.pi * math.sqrt(r0 ** 3 / (2 * GM))
    sol = solve_ivp(rhs, (0, 2.0 * t_ff), y0, method="DOP853", rtol=1e-11, atol=1e-14, events=captured, dense_output=True)
    T = sol.t[-1]
    print(f"Sun captured at t = {T:.1f} r_s/c = {T * 4.1 / 24 / 365.25:.2f} yr; steps {len(sol.t)}")
    # the planets carry on without the Sun until they too are swallowed: integrate the active ones, stop at each
    # capture (event), freeze that planet at the horizon, restart with the rest
    yT = sol.y[:, -1].copy()
    nb = len(PLANETS)
    pos0 = yT[3:3 * (nb + 1)].reshape(nb, 3).copy()
    vel0 = yT[3 * (nb + 1) + 3:].reshape(nb, 3).copy()
    active = [k for k in range(nb) if np.linalg.norm(pos0[k]) > 1.15]
    segs = []                                  # (t array, positions (nb, 3, n)) per segment
    frozen = {k: pos0[k].copy() for k in range(nb) if k not in active}
    t_cur, T_END = T, T + 3000.0
    while active and t_cur < T_END:
        idxs = list(active)
        def f(t, y):
            p = y[:3 * len(idxs)].reshape(-1, 3)
            v = y[3 * len(idxs):].reshape(-1, 3)
            r = np.linalg.norm(p, axis=1)
            a = -(GM / (r - RS) ** 2 / r)[:, None] * p
            return np.concatenate([v.ravel(), a.ravel()])
        evs = []
        for j in range(len(idxs)):
            ev = (lambda j: (lambda t, y: np.linalg.norm(y[3 * j:3 * j + 3]) - 1.15))(j)
            ev.terminal = True
            ev.direction = -1
            evs.append(ev)
        y0p = np.concatenate([pos0[idxs].ravel(), vel0[idxs].ravel()])
        s2 = solve_ivp(f, (t_cur, T_END), y0p, method="DOP853", rtol=1e-11, atol=1e-14, events=evs, dense_output=True)
        tt = np.linspace(t_cur, s2.t[-1], max(50, int((s2.t[-1] - t_cur) * 4)))
        Yp = s2.sol(tt)
        P = np.zeros((nb, 3, len(tt)))
        for k, pk in frozen.items():
            P[k] = pk[:, None]
        for j, k in enumerate(idxs):
            P[k] = Yp[3 * j:3 * j + 3]
        segs.append((tt, P))
        yend = s2.y[:, -1]
        for j, k in enumerate(idxs):
            pos0[k] = yend[3 * j:3 * j + 3]
            vel0[k] = yend[3 * len(idxs) + 3 * j:3 * len(idxs) + 3 * j + 3]
        hit = [idxs[j] for j in range(len(idxs)) if len(s2.t_events[j])]
        for k in hit:
            frozen[k] = pos0[k].copy()
            active.remove(k)
            print(f"  {PLANETS[k][0]} reaches the horizon at t={s2.t[-1]:.2f}")
        t_cur = s2.t[-1]
        if not hit:
            break
    T2 = t_cur
    # samples: uniform in time and dense in log(time to capture), so the final plunge is resolved
    n = nb + 1
    rem = np.geomspace(1e-3, T, 4000)
    ts1 = np.unique(np.concatenate([np.linspace(0, T, 6000), T - rem, sol.t]))
    ts1 = ts1[(ts1 >= 0) & (ts1 <= T)]
    Y1 = sol.sol(ts1)
    tps = [seg[0] for seg in segs]
    ts2 = np.concatenate(tps) if tps else np.zeros(0)
    Y2 = np.zeros((3 * n, len(ts2)))
    o = 0
    for tt, P in segs:
        Y2[0:3, o:o + len(tt)] = sol.y[0:3, -1][:, None]
        for k in range(nb):
            Y2[3 * (k + 1):3 * (k + 2), o:o + len(tt)] = P[k]
        o += len(tt)
    keep = ts2 > T
    ts = np.concatenate([ts1, ts2[keep]])
    Y = np.concatenate([Y1[:3 * n], Y2[:, keep]], axis=1)
    out = {"t": ts.round(5).tolist(), "names": ["sun"] + [p[0] for p in PLANETS], "r_s_AU": 29.6, "hours_per_unit": 4.1}
    for k in range(n):
        out[f"b{k}"] = Y[3 * k:3 * k + 3].T.round(7).tolist()
    # capture time of every planet
    cap = {}
    for k, (name, *_r) in enumerate(PLANETS, start=1):
        rr = np.linalg.norm(Y[3 * k:3 * k + 3], axis=0)
        i = np.argmax(rr < 1.2)
        cap[name] = float(ts[i]) if rr[i] < 1.2 else None
        print(f"{name:8s} swallowed at t={cap[name]}")
    out["capture"] = cap
    # stripping: when each planet's distance from the Sun first exceeds 3x its orbit
    strip = {}
    for k, (name, a, *_rest) in enumerate(PLANETS, start=1):
        d = np.linalg.norm(Y[3 * k:3 * k + 3] - Y[0:3], axis=0)
        i = np.argmax(d > 3 * a * AU)
        strip[name] = float(ts[i]) if d[i] > 3 * a * AU else None
        rsun = np.linalg.norm(Y[0:3, i])
        rt = a * AU * M_RATIO ** (1 / 3)
        print(f"{name:8s} stripped at t={strip[name]}  (Sun at r={rsun:.1f}; r_t={rt:.1f})")
    out["strip"] = strip
    out["t_capture"] = T
    (ROOT / "app/data/sim").mkdir(parents=True, exist_ok=True)
    (ROOT / "app/data/sim/solar.json").write_text(json.dumps(out))
    print("wrote app/data/sim/solar.json", len(ts), "samples")


if __name__ == "__main__":
    main()
