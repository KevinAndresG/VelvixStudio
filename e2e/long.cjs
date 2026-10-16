// #17 Long export: a 60 min video through the export dialog, with a simulated failure at the middle
// (automatic retry from the last checkpoint) and memory sampled during the whole export.
// Usage: node e2e/long.cjs   (PKG=1 for the packaged app). Takes ~10–20 min; not part of full.cjs.
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..');
const FF = require(APP + '/node_modules/ffmpeg-static'), FP = require(APP + '/node_modules/ffprobe-static').path;
const MIN = +(process.env.MIN || 60), SRC = path.join(__dirname, 'gen', `long${MIN}.mp4`), OUT = path.win32.normalize(path.join(__dirname, `out-long${MIN}.mp4`));

(async () => {
  if (!fs.existsSync(SRC)) {
    console.log(`generando ${MIN} min de prueba…`);
    fs.mkdirSync(path.dirname(SRC), { recursive: true });
    cp.execFileSync(FF, ['-y', '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=30:d=${MIN * 60}`, '-f', 'lavfi', '-i', `sine=f=440:d=${MIN * 60}`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', SRC], { stdio: 'inherit' });
  }
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, OUT);
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card'); await page.click('.new-card'); await page.waitForSelector('.editor');
  await page.evaluate(async (f) => { const { actions: A } = window.__velvix; const [m] = await A.importPaths([f]); A.addToTimeline(m); }, SRC);
  const frames = MIN * 60 * 30;
  await page.evaluate((n) => { window.__velvixFail = { at: n, n: 1 }; }, Math.floor(frames / 2));
  await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
  await page.selectOption('.export label:has(> span:text-is("Resolución")) select', '480');
  const t0 = Date.now();
  await page.click('.export .btn.primary');
  const mem = []; let text = '';
  const sample = async () => {
    const m = await app.evaluate(({ app }) => app.getAppMetrics().map((x) => [x.type, x.memory.workingSetSize]));
    const by = (t) => Math.round(m.filter(([k]) => k === t).reduce((a, [, v]) => a + v, 0) / 1024);
    mem.push({ s: Math.round((Date.now() - t0) / 1000), tab: by('Tab'), gpu: by('GPU'), browser: by('Browser'), total: Math.round(m.reduce((a, [, v]) => a + v, 0) / 1024) });
  };
  for (let i = 0; i < 6 * 120; i++) {
    await page.waitForTimeout(10000);
    await sample();
    text = await page.evaluate(() => document.querySelector('.export')?.innerText.replace(/\s+/g, ' ') || '');
    if (i % 6 === 0) console.log(mem[mem.length - 1], text.slice(0, 60));
    if (/completa|fall/.test(text)) break;
  }
  const secs = (Date.now() - t0) / 1000;
  const probe = cp.execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_type,duration,nb_frames', '-of', 'csv=p=0', OUT]).toString().trim();
  const v = probe.split(/\r?\n/).map((l) => l.split(',')).find((x) => x[0] === 'video') || [], a = probe.split(/\r?\n/).map((l) => l.split(',')).find((x) => x[0] === 'audio') || [];
  // Leak check: working set at the end of the export vs. after the first minute (decoders/bitmaps are freed per frame).
  const run = mem.filter((m) => m.s >= 60), first = run.slice(0, 3), last = run.slice(-4, -1);
  const avg = (xs, k) => xs.reduce((s, m) => s + m[k], 0) / Math.max(1, xs.length);
  const growth = Math.round(avg(last, 'total') - avg(first, 'total')), peak = Math.max(...mem.map((m) => m.total));
  const fails = [];
  const check = (name, ok, info) => { console.log((ok ? 'OK   ' : 'FAIL ') + name + ' — ' + info); if (!ok) fails.push(name); };
  check(`#17 exportación de ${MIN} min completa (con un fallo simulado a la mitad)`, /completa/.test(text), `${Math.round(secs)} s (${Math.round(frames / secs)} fps)`);
  check('#17 duración y cuadros exactos', Math.abs(+v[1] - MIN * 60) < 0.05 && +v[2] === frames && Math.abs(+a[1] - MIN * 60) < 0.1, probe.replace(/\s+/g, ' '));
  check('#17 memoria estable durante la exportación', growth < 300, `pico ${peak} MB, crecimiento ${growth} MB`);
  console.log('ERRORS:', errors.join('\n'));
  fs.writeFileSync(path.join(__dirname, 'gen', `long${MIN}-mem.json`), JSON.stringify(mem));
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
