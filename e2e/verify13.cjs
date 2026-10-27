// v1.21.0 in the real app: export several formats at once (16:9 + 9:16 + 1:1), each extra one reframed
// following the face, the project itself left untouched.
// Usage: node e2e/verify13.cjs   (PKG=1 for the packaged app). Needs e2e/gen/cara-paneo.mp4 (node e2e/verify6.cjs).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), GEN = path.join(__dirname, 'gen');
const PROBE = require(APP + '/node_modules/ffprobe-static').path;
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const wh = (f) => (fs.existsSync(f) ? cp.execFileSync(PROBE, ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim() : 'falta');

(async () => {
  const OUT = path.join(__dirname, 'out-multi.mp4'), O916 = path.join(__dirname, 'out-multi-9x16.mp4'), O11 = path.join(__dirname, 'out-multi-1x1.mp4');
  for (const f of [OUT, O916, O11]) fs.rmSync(f, { force: true });
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const [id] = await ev((f) => window.__velvix.actions.importPaths(f).then((l) => l.map((m) => m.id)), [path.join(GEN, 'cara-paneo.mp4')]);
  await page.waitForTimeout(800);
  await ev((id) => { const { actions, store } = window.__velvix; actions.addToTimeline(store.getState().project.media.find((m) => m.id === id)); }, id);
  await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, OUT);
  await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
  const sel = (label) => `.export label:has(> span:text-is("${label}")) select`;
  await page.selectOption(sel('Resolución'), '480');
  await page.selectOption(sel('Rango'), 'custom');
  await page.fill('.range label:has-text("Desde") input', '0');
  await page.fill('.range label:has-text("Hasta") input', '1.5');
  await page.click('.multi-fmt button:text-is("9:16")');
  await page.click('.multi-fmt button:text-is("1:1")');
  await page.click('.export .modal-actions .btn.primary');
  let t = '';
  for (let i = 0; i < 180; i++) { await page.waitForTimeout(1000); t = await ev(() => document.querySelector('.export')?.innerText || ''); if (/completa|fall/.test(t)) break; }
  check('exportación múltiple completa', /completa/.test(t), t.replace(/\s+/g, ' ').slice(0, 200));
  check('principal 16:9', wh(OUT) === '854,480', wh(OUT));
  check('extra 9:16 junto al principal', wh(O916) === '480,854', wh(O916));
  check('extra 1:1 junto al principal', wh(O11) === '480,480', wh(O11));
  // 9:16 follows the face: in the source the face pans left→right, so the reframed copy keyframes x.
  const p = await ev(() => { const { store } = window.__velvix, d = store.getState().project, c = d.clips[0]; return { aspect: d.aspect, kfx: !!(c.kf && c.kf.x), fit: c.fit }; });
  check('el proyecto queda en 16:9 sin tocar', p.aspect === '16:9' && !p.kfx, JSON.stringify(p));
  const copy = await ev(async () => { const { store, vision } = window.__velvix, d = await vision.reframedCopy(store.getState().project, '9:16'); const c = d.clips[0]; return { w: d.width, h: d.height, fit: c.fit, xs: (c.kf.x || []).map((k) => k.v) }; });
  check('copia 9:16 reencuadrada siguiendo la cara', copy.w === 1080 && copy.h === 1920 && copy.fit === 'fill' && copy.xs.length > 2 && Math.max(...copy.xs) - Math.min(...copy.xs) > 0.1, JSON.stringify({ ...copy, xs: copy.xs.length }));
  check('sin errores de página', !errors.length, errors.join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})();
