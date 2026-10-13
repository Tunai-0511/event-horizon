// Boot: GL context, engine, shot list; exposes window.EH for the offline driver (tools/render.mjs).
import { createGL } from './gl.js';
import { Engine } from './engine.js';

const q = new URLSearchParams(location.search);
if (q.has('simprofile')) globalThis.__simProfile = true;
const scale = +(q.get('scale') ?? 1);
const W = Math.round(1920 * scale), H = Math.round(1080 * scale);
const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
if (q.has('fit')) document.body.classList.add('fit');

// ?dbg: synchronous breadcrumbs that land in the static server's access log even if the tab dies
export function dbg(m) { if (!q.has('dbg')) return; try { const x = new XMLHttpRequest(); x.open('GET', '/__dbg?' + encodeURIComponent(m), false); x.send(); } catch (e) {} }
window.dbg = dbg;

async function boot() {
  dbg('boot');
  const gl = createGL(canvas);
  const engine = new Engine(gl, W, H);
  const mod = q.get('test') ? await import(`./tests/${q.get('test')}.js`) : await import('./timeline.js');
  const shots = (await (mod.load?.() ?? mod.shots)).slice().sort((a, b) => a.t0 - b.t0);
  const frags = [...new Set(shots.map((s) => s.frag ?? `${s.scene}.frag`))];
  await engine.init([...frags, 'black.frag']);
  const t0 = performance.now();
  for (const s of shots) { const a = performance.now(); engine.program(s.frag ?? `${s.scene}.frag`, s.defines ?? {}); console.log(`program ${s.scene} ${(performance.now() - a).toFixed(0)} ms`); }
  console.log(`compiled ${engine.progs.size} programs in ${(performance.now() - t0).toFixed(0)} ms`);

  const black = { id: 'black', t0: -1e9, t1: 1e9, scene: 'black', frag: 'black.frag', at: () => ({ cam: { pos: [0, 0, 0], fwd: [0, 0, -1] } }) };
  const shotAt = (T) => {
    let lo = 0, hi = shots.length - 1, best = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (shots[m].t0 <= T) { best = m; lo = m + 1; } else hi = m - 1; }
    if (best != null && T < shots[best].t1) return shots[best];
    return null;
  };
  const duration = mod.duration ?? Math.max(...shots.map((s) => s.t1));

  window.EH = {
    W, H, duration,
    shots: shots.map(({ id, t0, t1, scene, spp }) => ({ id, t0, t1, scene, spp })),
    async render(T, opts = {}) {
      const s = shotAt(T);
      if (!s) { engine.renderFrame(black, T, { ...opts, spp: 1 }); return null; }
      // cross-dissolve from the previous shot over the first `dissolve` seconds
      if (s.dissolve && T < s.t0 + s.dissolve) {
        const prev = shots.find((x) => Math.abs(x.t1 - s.t0) < 1e-3);
        if (prev) {
          const u = (T - s.t0) / s.dissolve, w = u * u * (3 - 2 * u);
          await engine.renderDissolve(prev, s, w, T, opts, prev.prepare && (() => prev.prepare(engine, T)), s.prepare && (() => s.prepare(engine, T)));
          return `${prev.id}>${s.id}`;
        }
      }
      if (s.prepare) await s.prepare(engine, T);
      engine.renderFrame(s, T, opts);
      return s.id;
    },
    finish() { engine.finish(); },
    read() { return engine.read(); },
    async perf(T, n = 3, opts = {}) {
      const out = [];
      for (let i = 0; i < n; i++) { const a = performance.now(); await this.render(T, opts); engine.read(); out.push(performance.now() - a); }
      return out;
    },
    // render frames [i0, i1) at fps and POST each raw RGBA frame (bottom-up rows) to the driver
    async stream(i0, i1, fps, opts = {}) {
      for (let i = i0; i < i1; i++) {
        await this.render(i / fps, { ...opts, fps });
        const px = engine.read();
        const r = await fetch(`/frame?i=${i}`, { method: 'POST', body: px });
        if (!r.ok) throw new Error(`frame ${i}: ${r.status}`);
      }
    },
  };
  window.__ready = true;
}

boot().catch((e) => { console.error(e); window.__error = String(e.stack || e); });
