// Renders the walkthrough frame-by-frame in headless Chromium and encodes it with ffmpeg.
//   node maca-3d/record.mjs                      -> maca-3d/out/maca-walkthrough.mp4
//   STILLS=0,7.5,13 node maca-3d/record.mjs      -> preview JPEGs at those times
// Env: FPS (30), W (1280), H (720)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const threeDir = path.resolve(here, '../node_modules/three');
const out = path.join(here, 'out');
const FPS = +(process.env.FPS || 30);
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const types = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript' };

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
// Serve three.js from node_modules and the page from disk so no network is needed.
await page.route('https://cdn.jsdelivr.net/npm/three@0.169.0/**', (r) => {
  const rel = r.request().url().split('three@0.169.0/')[1];
  r.fulfill({ path: path.join(threeDir, rel), contentType: 'application/javascript' });
});
await page.route('http://maca.local/**', (r) => {
  const rel = new URL(r.request().url()).pathname.slice(1) || 'index.html';
  r.fulfill({ path: path.join(here, rel), contentType: types[path.extname(rel)] || 'application/octet-stream' });
});
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => { console.error('[page error]', e); process.exitCode = 1; });

await page.goto(`http://maca.local/index.html?record=1&w=${W}&h=${H}`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 180000 });

const grab = async (t, file) => {
  const url = await page.evaluate((t) => window.renderAt(t), t);
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
};

fs.mkdirSync(out, { recursive: true });
if (process.env.STILLS) {
  for (const t of process.env.STILLS.split(',').map(Number)) {
    const f = path.join(out, `still-${t.toFixed(1)}.jpg`);
    const t0 = Date.now();
    await grab(t, f);
    console.log(`${f} (${Date.now() - t0} ms)`);
  }
} else {
  const frames = path.join(out, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames);
  const duration = await page.evaluate(() => window.TOUR_DURATION);
  const n = Math.round(duration * FPS);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await grab(i / FPS, path.join(frames, `${String(i).padStart(5, '0')}.jpg`));
    if (i % 30 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const mp4 = path.join(out, 'maca-walkthrough.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
  console.log('wrote', mp4);
}
await browser.close();
