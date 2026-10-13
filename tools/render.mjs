// Offline driver: serves app/, drives system Chrome (ANGLE/Metal WebGL2) through puppeteer-core.
//
//   node tools/render.mjs stills --times 10,20,30 [--test bh] [--scale 0.5] [--spp 4] [--out out/stills] [--tag name]
//   node tools/render.mjs sheet  --times 10,20,... [--cols 4] [--scale 0.4] ...          -> out/sheets/<tag>.png
//   node tools/render.mjs perf   --times 10,20 [--spp 1]
//   node tools/render.mjs video  --from 0 --to 30 [--fps 30] [--crf 16] [--out out/clip.mp4] [--audio audio/theme.wav]
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes(`--${k}`);
process.env.PATH = `${process.env.HOME}/.local/bin:${process.env.PATH}`;

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glsl': 'text/plain', '.frag': 'text/plain', '.vert': 'text/plain' };
let onFrame = null;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && u === '/frame') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try { await onFrame(Buffer.concat(chunks), +new URL(req.url, 'http://x').searchParams.get('i')); res.end('ok'); }
      catch (e) { res.statusCode = 500; res.end(String(e)); }
    });
    return;
  }
  const f = path.join(APP, u === '/' ? 'index.html' : u);
  if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', mime[path.extname(f)] || 'application/octet-stream');
  res.setHeader('cache-control', 'no-store');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const scale = +opt('scale', mode === 'sheet' ? '0.4' : '1');
const W = Math.round(1920 * scale), H = Math.round(1080 * scale);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  protocolTimeout: 0,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-gpu-watchdog'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (!/Download the React|DevTools/.test(t)) console.log('[page]', t); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) console.log('[http]', r.status(), r.url()); });
const qs = new URLSearchParams({ scale: String(scale) });
if (opt('test')) qs.set('test', opt('test'));
if (flag('simprofile')) qs.set('simprofile', '1');
await page.goto(`http://localhost:${port}/index.html?${qs}`);
await page.waitForFunction('window.__ready === true || window.__error', { timeout: +opt('boot-timeout', '180000') });
const err = await page.evaluate(() => window.__error);
if (err) { console.error(err); await browser.close(); server.close(); process.exit(1); }
const info = await page.evaluate(() => ({ duration: window.EH.duration, shots: window.EH.shots }));

const spp = opt('spp') ? +opt('spp') : undefined;
const fps = +opt('fps', '30');
let times = (opt('times', '') || '').split(',').filter(Boolean).map(Number);
// --pershot [--at 0.5[,0.9]] [--from a --to b]: sample every shot in the range at the given fractions
if (flag('pershot')) {
  const fr = (opt('at', '0.5') || '0.5').split(',').map(Number);
  const a = +opt('from', '0'), b = +opt('to', '1e9');
  times = [];
  for (const s of info.shots) if (s.t1 > a && s.t0 < b && s.id !== 'black') for (const f of fr) times.push(+(s.t0 + (s.t1 - s.t0) * f).toFixed(3));
}

async function still(t, file) {
  const id = await page.evaluate(async (t, spp, fps) => { const id = await window.EH.render(t, { spp, fps }); window.EH.finish(); return id; }, t, spp, fps);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  return id;
}

try {
  if (mode === 'stills' || mode === 'sheet') {
    const tag = opt('tag', opt('test') || 'film');
    const dir = path.resolve(ROOT, opt('out', mode === 'sheet' ? `out/sheets/${tag}_frames` : `out/stills/${tag}`));
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (const [k, t] of times.entries()) {
      const f = path.join(dir, `${String(k).padStart(3, '0')}_t${t.toFixed(2)}.png`);
      const a = Date.now();
      const id = await still(t, f);
      console.log(`t=${t.toFixed(2)} [${id}] -> ${path.relative(ROOT, f)}  ${Date.now() - a} ms`);
      files.push(f);
    }
    if (mode === 'sheet') {
      const cols = +opt('cols', '4');
      const rows = Math.ceil(files.length / cols);
      const out = path.resolve(ROOT, `out/sheets/${tag}.png`);
      const inputs = files.flatMap((f) => ['-i', f]);
      // label each tile with its time
      const fc = files.map((f, i) => `[${i}:v]drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:text='${times[i].toFixed(2)}':x=8:y=8:fontsize=${Math.round(22 * scale / 0.4)}:fontcolor=white:box=1:boxcolor=black@0.5[v${i}]`).join(';')
        + ';' + files.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * H}`).join('|')}:fill=black[o]`;
      if (files.length === 1) fs.copyFileSync(files[0], out);
      else await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', fc, '-map', '[o]', '-frames:v', '1', out]);
      console.log(`sheet ${rows}x${cols} -> ${path.relative(ROOT, out)}`);
    }
  } else if (mode === 'perf') {
    for (const t of times) {
      const r = await page.evaluate(async (t, spp) => await window.EH.perf(t, 3, { spp }), t, spp);
      console.log(`t=${t}: ${r.map((x) => x.toFixed(0)).join(' / ')} ms`);
    }
  } else if (mode === 'video') {
    const from = +opt('from', '0'), to = Math.min(+opt('to', String(info.duration)), info.duration);
    const out = path.resolve(ROOT, opt('out', `out/clip_${from}-${to}.mp4`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const i0 = Math.round(from * fps), i1 = Math.round(to * fps);
    const ff = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-'];
    const audio = opt('audio');
    if (audio) ff.push('-ss', String(i0 / fps), '-t', String((i1 - i0) / fps), '-i', path.resolve(ROOT, audio));
    ff.push('-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', opt('preset', 'slow'), '-crf', opt('crf', '16'),
      '-tune', opt('tune', 'film'), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart');
    if (audio) ff.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
    ff.push(out);
    const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
    let n = 0; const tStart = Date.now();
    onFrame = async (buf, i) => {
      if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r));
      n++;
      if (n % 30 === 0 || i === i1 - 1) {
        const el = (Date.now() - tStart) / 1000, rate = n / el;
        process.stdout.write(`\r  frame ${i} (${n}/${i1 - i0})  ${rate.toFixed(2)} fps  ${(1000 / rate).toFixed(0)} ms/f  eta ${((i1 - i0 - n) / rate / 60).toFixed(1)} min    `);
      }
    };
    const CH = 30;
    for (let a = i0; a < i1; a += CH) {
      await page.evaluate((a, b, fps, spp) => window.EH.stream(a, b, fps, { spp }), a, Math.min(i1, a + CH), fps, spp);
    }
    enc.stdin.end();
    await new Promise((r) => enc.on('close', r));
    console.log(`\nwrote ${path.relative(ROOT, out)} in ${((Date.now() - tStart) / 60000).toFixed(1)} min`);
  } else if (mode === 'produce') {
    // chunked, resumable master render: out/chunks/f<i0>-<i1>.mp4, then concat + audio -> out/<name>.mp4
    const chunkSec = +opt('chunk', '20');
    const from = +opt('from', '0'), to = Math.min(+opt('to', String(info.duration)), info.duration);
    const cdir = path.resolve(ROOT, opt('chunks', 'out/chunks'));
    fs.mkdirSync(cdir, { recursive: true });
    const I0 = Math.round(from * fps), I1 = Math.round(to * fps), CH = Math.round(chunkSec * fps);
    const tStart = Date.now();
    let doneFrames = 0;
    for (let a = Math.floor(I0 / CH) * CH; a < I1; a += CH) {
      const b = Math.min(a + CH, Math.round(info.duration * fps));
      const name = path.join(cdir, `f${String(a).padStart(6, '0')}-${String(b).padStart(6, '0')}.mp4`);
      if (fs.existsSync(name)) continue;
      const tmp = name.replace('.mp4', '.part.mp4');
      const ff = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
        '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', opt('preset', 'slow'), '-crf', opt('crf', '15'),
        '-profile:v', 'high', '-tune', 'film', '-g', String(fps * 2), '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-f', 'mp4', tmp];
      const enc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
      let n = 0; const c0 = Date.now();
      onFrame = async (buf) => { if (!enc.stdin.write(buf)) await new Promise((r) => enc.stdin.once('drain', r)); n++; };
      for (let x = a; x < b; x += 15) await page.evaluate((x, y, fps, spp) => window.EH.stream(x, y, fps, { spp }), x, Math.min(b, x + 15), fps, spp);
      enc.stdin.end();
      await new Promise((r) => enc.on('close', r));
      fs.renameSync(tmp, name);
      doneFrames += b - a;
      const el = (Date.now() - tStart) / 1000, msf = ((Date.now() - c0) / (b - a)).toFixed(0);
      const left = (I1 - a - (b - a)) * (el / doneFrames);
      console.log(`chunk ${(a / fps).toFixed(1)}-${(b / fps).toFixed(1)} s: ${msf} ms/frame; elapsed ${(el / 60).toFixed(1)} min; eta ${(left / 60).toFixed(0)} min`);
    }
    if (flag('final')) {
      const list = fs.readdirSync(cdir).filter((f) => /^f\d+-\d+\.mp4$/.test(f)).sort();
      fs.writeFileSync(path.join(cdir, 'list.txt'), list.map((f) => `file '${f}'`).join('\n'));
      const out = path.resolve(ROOT, opt('out', 'out/EventHorizon.mp4'));
      const audio = path.resolve(ROOT, opt('audio', 'audio/theme.wav'));
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(cdir, 'list.txt'), '-i', audio,
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', '-shortest', out]);
      console.log(`wrote ${path.relative(ROOT, out)}`);
    }
  } else if (mode === 'info') {
    console.log(JSON.stringify(info, null, 1));
  } else {
    console.log('modes: stills | sheet | perf | video | info');
  }
} finally {
  await browser.close();
  server.close();
}

function run(cmd, args) {
  return new Promise((res, rej) => { const p = spawn(cmd, args, { stdio: 'inherit' }); p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))); });
}
