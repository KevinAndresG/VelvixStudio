// 4K benchmark: preview frame rate and 4K export time of a 4K clip with a heavy grade (vintage preset +
// chroma key + sharpen). Usage: node e2e/bench4k.cjs [appDir]  (appDir = another checkout to compare)
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(process.argv[2] || path.join(__dirname, '..')), S = __dirname, GEN = path.join(S, 'gen');
const FF = require(path.join(__dirname, '..', 'node_modules/ffmpeg-static'));
const SRC = path.join(GEN, 'src4k.mp4'), OUT = path.win32.normalize(path.join(GEN, 'bench4k-out.mp4'));

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  if (!fs.existsSync(SRC)) cp.execFileSync(FF, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30:d=6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', SRC]);
  const app = await _electron.launch({ executablePath: require(path.join(__dirname, '..', 'node_modules/electron')), args: [APP], cwd: APP });
  await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, OUT);
  const page = await app.firstWindow();
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  await page.evaluate(async (f) => {
    const { actions: A, store } = window.__velvix;
    const [m] = await A.importPaths([f]);
    A.addToTimeline(m);
    store.update((d) => { const c = d.clips[0]; c.filter.preset = 'vintage'; c.filter.sharpen = 30; c.chroma = { on: true, color: '#00ff00', similarity: 20, smooth: 10 }; });
  }, SRC);
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(async () => {
    const { store } = window.__velvix;
    store.setState({ time: 0, playing: true });
    await new Promise((r) => setTimeout(r, 500));
    let n = 0; const t0 = performance.now();
    await new Promise((r) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
    store.setState({ playing: false });
    return +(n / ((performance.now() - t0) / 1000)).toFixed(1);
  });
  await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
  await page.selectOption('.export label:has(> span:text-is("Resolución")) select', '2160');
  const t0 = Date.now();
  await page.click('.export .btn.primary');
  let t = ''; for (let i = 0; i < 600 && !/completa|fall/.test(t); i++) { await page.waitForTimeout(250); t = await page.evaluate(() => document.querySelector('.export')?.innerText || ''); }
  const secs = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ app: APP, previewFps: fps, export4kSecs: secs, exportFps: +(180 / secs).toFixed(1), result: t.replace(/\s+/g, ' ').slice(0, 60) }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
