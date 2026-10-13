"""Smoothed-particle hydrodynamics with self-gravity around a black hole.

Units: Schwarzschild radius r_s = 1, c = 1, G M_bh = 0.5 (the same units the renderer uses).
The hole acts through the Paczynski–Wiita potential  Phi = -G M / (r - r_s): it reproduces the marginally stable
(ISCO, 3 r_s) and marginally bound (2 r_s) orbits and the apsidal precession that makes returning debris collide
with itself.  Gas: ideal gas (gamma = 5/3), M4 cubic-spline kernel with K nearest neighbours (2h = distance to the
K-th neighbour), Monaghan signal-velocity artificial viscosity, optional cooling.  Self-gravity: direct summation on
the GPU (PyTorch / Metal), Plummer-softened with the smoothing length.  Particles that fall inside r_acc are accreted.
Integration: kick-drift-kick leapfrog with a global time step.
"""
import math
import time

import numpy as np
import torch
from scipy.spatial import cKDTree

GM = 0.5
RS = 1.0


def w_kernel(q):
    """M4 cubic spline (unnormalised): W = w(q) / (pi h^3), support q < 2."""
    return np.where(q < 1.0, 1.0 - 1.5 * q * q + 0.75 * q ** 3, np.where(q < 2.0, 0.25 * (2.0 - q) ** 3, 0.0))


def dw_kernel(q):
    """dW/dr * pi h^4."""
    return np.where(q < 1.0, -3.0 * q + 2.25 * q * q, np.where(q < 2.0, -0.75 * (2.0 - q) ** 2, 0.0))


class SPH:
    def __init__(self, x, v, u, m, *, gamma=5.0 / 3.0, K=64, alpha=1.0, beta=2.0, G=0.5, bh=True, r_acc=3.0,
                 self_gravity=True, grav_every=4, cool_beta=None, u_floor=1e-12, damping=0.0, device="mps"):
        self.x = np.asarray(x, np.float64)
        self.v = np.asarray(v, np.float64)
        self.u = np.asarray(u, np.float64)
        self.N = len(self.x)
        self.m = float(m)
        self.gamma, self.K, self.alpha, self.beta = gamma, K, alpha, beta
        self.G, self.bh, self.r_acc = G, bh, r_acc
        self.self_gravity, self.grav_every = self_gravity, grav_every
        self.cool_beta, self.u_floor, self.damping = cool_beta, u_floor, damping
        self.alive = np.ones(self.N, bool)
        self.t = 0.0
        self.step_no = 0
        self.dev = torch.device(device)
        self.g_self = np.zeros_like(self.x)
        self.h = np.full(self.N, 1e-2)
        self.rho = np.ones(self.N)
        self.accreted_mass = 0.0
        self._neighbours()
        self._density()
        # each particle's starting adiabat: cooling only removes heat above it (shock heating), never the star's own
        self.A0 = (self.gamma - 1.0) * self.u / np.maximum(self.rho, 1e-300) ** (self.gamma - 1.0)
        self.a, self.du = self._accel()

    # ---------------------------------------------------------------------------------------------- neighbours / density
    def _neighbours(self):
        idx = np.flatnonzero(self.alive)
        self.idx = idx
        xa = self.x[idx]
        k = min(self.K, len(idx))
        tree = cKDTree(xa)
        d, j = tree.query(xa, k=k, workers=-1)
        self.nd = d                          # (Na, K) distances, first column = self
        self.nj = j                          # indices into the alive subset
        ha = np.maximum(0.5 * d[:, -1], 1e-6)
        self.h[idx] = ha

    def _density(self):
        idx = self.idx
        ha = self.h[idx]
        q = self.nd / ha[:, None]
        rho = self.m * w_kernel(q).sum(1) / (math.pi * ha ** 3)
        self.rho[idx] = rho

    # ---------------------------------------------------------------------------------------------- forces
    def _gravity(self):
        """Self-gravity of the alive particles (direct sum on the GPU, chunked, origin-shifted for precision)."""
        idx = self.idx
        xa = self.x[idx]
        # spatial ordering keeps each chunk compact (precision of the |a|^2 + |b|^2 - 2ab expansion)
        order = np.lexsort(np.floor(xa / max(np.ptp(xa) / 16.0, 1e-9)).T[::-1])
        xs = torch.from_numpy(xa[order].astype(np.float32)).to(self.dev)
        eps2 = torch.from_numpy((self.h[idx][order] ** 2).astype(np.float32)).to(self.dev)
        acc = torch.zeros_like(xs)
        C = 4096
        for s in range(0, xs.shape[0], C):
            a = xs[s:s + C]
            o = a.mean(0, keepdim=True)
            a = a - o
            b = xs - o
            r2 = (a * a).sum(1, keepdim=True) + (b * b).sum(1)[None, :] - 2.0 * (a @ b.T)
            inv = (r2.clamp_min(0.0) + 0.125 * (eps2[s:s + C, None] + eps2[None, :])).rsqrt()
            inv3 = inv * inv * inv
            acc[s:s + C] = inv3 @ b - a * inv3.sum(1, keepdim=True)
        out = np.zeros((len(idx), 3))
        out[order] = acc.cpu().numpy().astype(np.float64)
        g = np.zeros_like(self.x)
        g[idx] = self.G * self.m * out
        return g

    def _accel(self):
        idx = self.idx
        xa, va, ua, ha, rhoa = self.x[idx], self.v[idx], self.u[idx], self.h[idx], self.rho[idx]
        P = (self.gamma - 1.0) * rhoa * ua
        cs = np.sqrt(np.maximum(self.gamma * (self.gamma - 1.0) * ua, 0.0))
        j = self.nj[:, 1:]                       # skip self
        r = self.nd[:, 1:]
        dx = xa[:, None, :] - xa[j]              # (Na, K-1, 3)  x_i - x_j
        dv = va[:, None, :] - va[j]
        rinv = 1.0 / np.maximum(r, 1e-12)
        # symmetric kernel gradient with the mean smoothing length
        hij = 0.5 * (ha[:, None] + ha[j])
        q = r / hij
        dW = dw_kernel(q) / (math.pi * hij ** 4)  # dW/dr (<= 0)
        gradW = dW[..., None] * dx * rinv[..., None]
        # artificial viscosity (Monaghan 1997)
        vdotr = (dv * dx).sum(-1) * rinv
        appr = vdotr < 0.0
        vsig = cs[:, None] + cs[j] - self.beta * np.where(appr, vdotr, 0.0)
        rhoij = 0.5 * (rhoa[:, None] + rhoa[j])
        Pi = np.where(appr, -0.5 * self.alpha * vsig * vdotr / rhoij, 0.0)
        Pr = (P / rhoa ** 2)[:, None] + (P / rhoa ** 2)[j]
        coef = Pr + Pi
        a_hyd = -self.m * (coef[..., None] * gradW).sum(1)
        du = self.m * (((P / rhoa ** 2)[:, None] + 0.5 * Pi) * (dv * gradW).sum(-1)).sum(1)
        a = np.zeros_like(self.x)
        a[idx] = a_hyd
        # black hole (Paczynski–Wiita)
        if self.bh:
            rr = np.linalg.norm(xa, axis=1)
            a[idx] += (-GM / (rr - RS) ** 2)[:, None] * (xa / rr[:, None])
        # self-gravity (refreshed every grav_every steps)
        if self.self_gravity:
            if self.step_no % self.grav_every == 0:
                self.g_self = self._gravity()
            a[idx] += self.g_self[idx]
        if self.damping > 0.0:
            a[idx] -= self.damping * va
        dU = np.zeros(self.N)
        dU[idx] = du
        if self.cool_beta is not None and self.bh:
            # radiative cooling of shock-heated gas (Bonnerot et al. 2016 style): the heat above the gas's original
            # adiabat is radiated away on cool_beta local orbital times; unshocked gas (the star) is untouched
            rr = np.linalg.norm(xa, axis=1)
            om = np.sqrt(GM / rr) / np.maximum(rr - RS, 1e-3)
            u_ad = self.A0[idx] * rhoa ** (self.gamma - 1.0) / (self.gamma - 1.0)
            dU[idx] -= np.maximum(ua - u_ad, 0.0) * om / self.cool_beta
        self._cs, self._vsigmax = cs, vsig.max(1) if vsig.size else cs
        return a, dU

    # ---------------------------------------------------------------------------------------------- time step
    def timestep(self, C_cour=0.3, C_acc=0.25, C_orb=0.03):
        idx = self.idx
        ha = self.h[idx]
        dt = C_cour * ha / np.maximum(self._vsigmax, 1e-12)
        an = np.linalg.norm(self.a[idx], axis=1)
        dt = np.minimum(dt, C_acc * np.sqrt(ha / np.maximum(an, 1e-20)))
        if self.bh:
            rr = np.linalg.norm(self.x[idx], axis=1)
            dt = np.minimum(dt, C_orb * np.sqrt(rr ** 3 / GM) * (1.0 - RS / rr))
        return float(dt.min())

    def step(self, dt):
        idx = self.idx
        # kick
        self.v[idx] += 0.5 * dt * self.a[idx]
        self.u[idx] = np.maximum(self.u[idx] + 0.5 * dt * self.du[idx], self.u_floor)
        # drift
        self.x[idx] += dt * self.v[idx]
        self.t += dt
        self.step_no += 1
        # accretion
        if self.bh:
            rr = np.linalg.norm(self.x, axis=1)
            gone = self.alive & (rr < self.r_acc)
            if gone.any():
                self.alive[gone] = False
                self.accreted_mass += self.m * gone.sum()
        self._neighbours()
        self._density()
        self.a, self.du = self._accel()
        idx = self.idx
        self.v[idx] += 0.5 * dt * self.a[idx]
        self.u[idx] = np.maximum(self.u[idx] + 0.5 * dt * self.du[idx], self.u_floor)

    def snapshot(self):
        """float32 [N, 8]: x, y, z, vx, vy, vz, h (0 = accreted), u."""
        out = np.zeros((self.N, 8), np.float32)
        out[:, 0:3] = self.x
        out[:, 3:6] = self.v
        out[:, 6] = np.where(self.alive, self.h, 0.0)
        out[:, 7] = self.u
        return out


# -------------------------------------------------------------------------------------------------- initial conditions
def lane_emden(n, dxi=1e-4):
    """Lane–Emden solution: returns xi, theta, mass coordinate m(xi) (normalised to 1 at the surface)."""
    xi, th, dth = dxi, 1.0 - dxi * dxi / 6.0, -dxi / 3.0
    xs, ts, ms = [0.0], [1.0], [0.0]
    mass = 0.0
    while th > 0.0:
        d2 = -th ** n - 2.0 / xi * dth
        dth += d2 * dxi
        th += dth * dxi
        xi += dxi
        mass += 4.0 * math.pi * xi * xi * max(th, 0.0) ** n * dxi
        xs.append(xi); ts.append(max(th, 0.0)); ms.append(mass)
    xs, ts, ms = np.array(xs), np.array(ts), np.array(ms)
    lane_emden.dtheta_surface = dth          # dtheta/dxi at the surface (tracked by the integrator, not differenced)
    return xs, ts, ms / ms[-1]


def polytrope_star(N, M, R, n=1.5, gamma=5.0 / 3.0, G=0.5, seed=1):
    """Particles sampling a polytrope of mass M, radius R: positions from a jittered lattice remapped radially so the
    enclosed mass follows Lane–Emden; internal energy from hydrostatic pressure P = K rho^gamma."""
    rng = np.random.default_rng(seed)
    xi, th, mfrac = lane_emden(n)
    xi1 = xi[-1]
    # uniform points in the unit ball (lattice + jitter, so the start is quiet)
    side = int(math.ceil((N * 6.0 / math.pi) ** (1.0 / 3.0))) + 2
    g = (np.indices((side, side, side)).reshape(3, -1).T + 0.5) / side * 2.0 - 1.0
    g += (rng.random(g.shape) - 0.5) * (0.35 / side)
    g = g[(g * g).sum(1) < 1.0]
    rr = np.linalg.norm(g, axis=1)
    g = g[np.argsort(rr)[:N]]
    r0 = np.linalg.norm(g, axis=1)
    f = (r0 / r0.max()) ** 3                         # enclosed mass fraction in the uniform ball
    xi_new = np.interp(f, mfrac, xi)
    r_new = xi_new / xi1 * R
    x = g / np.maximum(r0, 1e-12)[:, None] * r_new[:, None]
    # central density from M = 4 pi alpha^3 rho_c * (-xi^2 dtheta/dxi)|xi1
    dth1 = lane_emden.dtheta_surface
    alpha = R / xi1
    rho_c = M / (4.0 * math.pi * alpha ** 3 * (-xi1 * xi1 * dth1))
    # K from alpha^2 = (n+1) K rho_c^(1/n - 1) / (4 pi G)
    K = alpha ** 2 * 4.0 * math.pi * G / ((n + 1.0) * rho_c ** (1.0 / n - 1.0))
    theta = np.interp(xi_new, xi, th)
    rho = rho_c * np.maximum(theta, 1e-4) ** n
    P = K * rho ** (1.0 + 1.0 / n)
    u = P / ((gamma - 1.0) * rho)
    return x, np.zeros_like(x), u, M / N
