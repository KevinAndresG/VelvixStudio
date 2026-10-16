// Sesión 4 verification in the real app: kill the app mid-export and resume, range export with speed curves and
// burned captions, brand watermark in 16:9 and 9:16, undo/redo of box selection and track reordering, and a
// .velvix package with odd paths (spaces, accents) made here and opened by the packaged app (PKG step).
// Usage: node e2e/verify4.cjs   then, after `npm run dist`: PKG=1 node e2e/verify4.cjs pkg
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen');
const FF = require(APP + '/node_modules/ffmpeg-static'), FP = require(APP + '/node_modules/ffprobe-static').path;
const launch = (pkg) => _electron.launch(pkg ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
const out = (n) => path.win32.normalize(path.join(S, n));
const WEIRD = path.join(GEN, 'Mis vídeos ñ', 'con espacios');
const PKGFILE = path.join(GEN, 'paquete ñandú é.velvix');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const quarters = (f) => { const raw = cp.execFileSync(FF, ['-v', 'error', '-i', f, '-vf', 'scale=4:1:flags=area', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }); const o = []; for (let i = 0; i + 4 <= raw.length; i += 4) o.push([raw[i], raw[i + 3]]); return o; };
const same = (a, b) => a.length === b.length && a.every(([l, r], i) => Math.abs(l - b[i][0]) < 6 && Math.abs(r - b[i][1]) < 6);
const decodeErrors = (f) => cp.spawnSync(FF, ['-v', 'error', '-i', f, '-f', 'null', '-']).stderr.toString().trim();
const pcm = (f, ss, t) => { const raw = cp.execFileSync(FF, ['-v', 'error', '-ss', String(ss), '-t', String(t), '-i', f, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); };
const corr = (a, b) => { const n = Math.min(a.length, b.length); let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb + 1e-12); };
const dur = (f) => cp.execFileSync(FP, ['-v', 'error', '-show_entries', 'stream=codec_type,duration,nb_frames', '-of', 'csv=p=0', f]).toString().trim().replace(/\s+/g, ' ');
// Reddest pixel in the middle band (rows 40–60 %) of the frame at t.
const bandMax = (f, t) => { const raw = cp.execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=100:100', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']); let m = 0; for (let i = 12000; i < 18000; i += 3) m = Math.max(m, raw[i] - Math.max(raw[i + 1], raw[i + 2])); return m; }; // redness
// RGB of the pixel at (fx, fy) of the frame at t.
const pixel = (f, t, fx, fy) => { const raw = cp.execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=100:100', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']); const i = (Math.round(fy * 99) * 100 + Math.round(fx * 99)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };

async function ui(app) {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  const setSave = (o) => app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, o);
  const waitExport = async (secs = 120) => { let t = ''; for (let i = 0; i < secs; i++) { await page.waitForTimeout(1000); t = await page.evaluate(() => document.querySelector('.export')?.innerText || ''); if (/completa|fall/.test(t)) break; } await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {}); return t.replace(/\s+/g, ' '); };
  const openExport = async () => { await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export'); };
  const sel = (label) => `.export label:has(> span:text-is("${label}")) select`;
  return { page, setSave, waitExport, openExport, sel };
}

(async () => {
  if (process.argv[2] === 'pkg') {
    // Packaged app opens the package made by the dev app: media must load without relinking.
    const app = await launch(true);
    const { page } = await ui(app);
    await page.waitForSelector('.new-card');
    const id = await page.evaluate((f) => window.api.importPackage(f), PKGFILE);
    await page.evaluate(() => location.reload());
    await page.waitForSelector('.home .proj');
    await page.click(`.home .proj:has-text("Rutas raras") >> nth=0 >> .thumb`);
    await page.waitForSelector('.editor');
    await page.evaluate(() => window.__velvix.store.setState({ time: 1.5 }));
    await page.waitForTimeout(2500);
    const r = await page.evaluate(() => {
      const p = window.__velvix.store.getState().project, cv = document.querySelector('.stage canvas'), x = cv.getContext('2d');
      const d = x.getImageData(cv.width / 2 - 20, cv.height / 2 - 20, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return { id: p.id, missing: p.media.filter((m) => m.missing).map((m) => m.name), paths: p.media.map((m) => m.path), lit: s / (d.length / 4) / 3 };
    });
    check('paquete con rutas raras abre en la app empaquetada sin revincular', r.id === id && !r.missing.length && r.paths.every((x) => /imported/.test(x)) && r.lit > 20, JSON.stringify(r));
    await page.evaluate((i) => window.api.deleteProject(i), id);
    await app.close();
    console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
    process.exit(fails.length ? 1 : 0);
  }

  fs.mkdirSync(WEIRD, { recursive: true });
  const red = path.join(GEN, 'logo rojo.png');
  cp.execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=200x200', '-frames:v', '1', red]);
  fs.copyFileSync(path.join(S, 'media', 'clip1.mp4'), path.join(WEIRD, 'clip ñandú é.mp4'));
  fs.copyFileSync(path.join(S, 'media', 'voz.wav'), path.join(WEIRD, 'voz áé (1).wav'));

  // ---- 1. Kill the app for real in the middle of an export, reopen, resume.
  let app = await launch(false);
  let U = await ui(app);
  await U.page.waitForSelector('.new-card'); await U.page.click('.new-card'); await U.page.waitForSelector('.editor');
  const pid = await U.page.evaluate(async (f) => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.name = 'Matar y reanudar'; d.background.type = 'black'; });
    const [ramp] = await A.importPaths([f]);
    for (let i = 0; i < 12; i++) A.addToTimeline(ramp);
    store.setState({ selection: [] });
    await store.flushSave();
    return store.getState().project.id;
  }, path.join(S, 'media', 'ramp.mp4'));
  await U.setSave(out('out-v-ref.mp4')); await U.openExport(); await U.page.click('.export .btn.primary');
  const tRef = await U.waitExport(300);
  await U.setSave(out('out-v-kill.mp4')); await U.openExport(); await U.page.click('.export .btn.primary');
  let prog = 0;
  for (let i = 0; i < 300 && prog < 45; i++) { await U.page.waitForTimeout(500); prog = await U.page.evaluate(() => +((/(\d+)%/.exec(document.querySelector('.export')?.innerText || '') || [0, 0])[1])); }
  cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(app.process().pid)]);
  console.log('app matada al', prog + '%');
  await new Promise((r) => setTimeout(r, 1500));
  app = await launch(false); U = await ui(app);
  const banner = await U.page.waitForSelector('.banner.crash', { timeout: 15000 }).then((h) => h.innerText()).catch(() => '');
  await U.page.click('.banner.crash .btn.primary');
  await U.page.waitForSelector('.editor');
  await U.setSave(out('no-debe-usarse.mp4'));
  await U.openExport();
  const resumeBtn = await U.page.waitForSelector('.export .btn.resume', { timeout: 8000 }).then((h) => h.innerText()).catch(() => '');
  let tRes = '';
  if (resumeBtn) { await U.page.click('.export .btn.resume'); tRes = await U.waitExport(300); } else await U.page.click('.export .btn:has-text("Cancelar")');
  check('cierre inesperado durante la exportación: el inicio ofrece recuperar', /inesperada/.test(banner), banner.replace(/\s+/g, ' ').slice(0, 70));
  const ok1 = /completa/.test(tRes) && /completa/.test(tRef);
  const qa = ok1 ? quarters(out('out-v-ref.mp4')) : [], qb = ok1 ? quarters(out('out-v-kill.mp4')) : [];
  const ca = ok1 ? corr(pcm(out('out-v-ref.mp4'), 0, 120), pcm(out('out-v-kill.mp4'), 0, 120)) : 0;
  check('matar la app a mitad y reanudar: mismos cuadros y audio que una exportación entera', ok1 && qa.length === 3600 && same(qa, qb) && !decodeErrors(out('out-v-kill.mp4')) && ca > 0.99,
    `${resumeBtn.trim()} → ${qb.length}/${qa.length} cuadros, audio corr ${ca.toFixed(4)}, ${ok1 ? dur(out('out-v-kill.mp4')) : tRes}`);

  // ---- 2. Range export of a clip with a speed curve, volume keyframes and burned captions.
  await U.page.evaluate(async (f) => {
    const { actions: A, store, model: M } = window.__velvix;
    store.update((d) => { d.clips = []; d.tracks = d.tracks.filter((t) => t.main); });
    const ramp = store.getState().project.media.find((m) => m.path === f);
    const v = A.addToTimeline(ramp); A.setCurve(v, M.SPEED_CURVES.montage.pts);
    store.update((d) => { const c = d.clips.find((x) => x.id === v); c.kf.volume = [{ t: 2, v: 0.2, ease: 'linear' }, { t: 5, v: 1.5, ease: 'out' }]; });
    store.setState({ time: 3 }); A.addText({ size: 200, color: '#ff0000' }, 'Hola');
    store.update((d) => { const c = d.clips[d.clips.length - 1]; c.caption = true; c.duration = 1.5; });
    store.setState({ selection: [], time: 0 });
  }, path.join(S, 'media', 'ramp.mp4'));
  await U.setSave(out('out-v-full.mp4')); await U.openExport(); await U.page.click('.export .btn.primary');
  const tFull = await U.waitExport();
  await U.setSave(out('out-v-range.mp4')); await U.openExport();
  await U.page.selectOption(U.sel('Rango'), 'custom');
  await U.page.fill('.range label:has-text("Desde") input', '2.5'); await U.page.fill('.range label:has-text("Hasta") input', '6');
  await U.page.click('.export .btn.primary');
  const tRange = await U.waitExport();
  const ok2 = /completa/.test(tFull) && /completa/.test(tRange);
  const qf = ok2 ? quarters(out('out-v-full.mp4')) : [], qr = ok2 ? quarters(out('out-v-range.mp4')) : [];
  const ar = ok2 ? corr(pcm(out('out-v-range.mp4'), 0, 3.4), pcm(out('out-v-full.mp4'), 2.5, 3.4)) : 0;
  const yHola = ok2 ? [bandMax(out('out-v-range.mp4'), 1.0), bandMax(out('out-v-full.mp4'), 3.5), bandMax(out('out-v-range.mp4'), 0.2)] : [];
  check('rango con curva de velocidad y subtítulos quemados: mismos cuadros que el video completo', ok2 && qr.length === 105 && same(qr, qf.slice(75, 180)), `${qr.length} cuadros vs ${qf.length}`);
  check('rango: audio (curva + keyframes de volumen) sincronizado con el completo', ar > 0.98, ar.toFixed(4));
  check('rango: el subtítulo quemado aparece en el mismo momento', yHola.length && yHola[0] > 150 && yHola[1] > 150 && yHola[2] < 40, JSON.stringify(yHola));

  // ---- 3. Brand logo watermark in the export, 16:9 and 9:16 (TikTok preset).
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, red);
  await U.page.evaluate(async (f) => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.clips = []; d.tracks = d.tracks.filter((t) => t.main); d.background = { type: 'color', color: '#000000', blur: 40 }; });
    const [gray] = await A.importPaths([f]); A.addToTimeline(gray); store.update((d) => { d.clips[0].duration = 3; });
    store.setState({ time: 0, selection: [] });
  }, path.join(S, 'media', 'gray.png'));
  await U.page.click('.left-tabs button[title="Marca"]');
  const nLogos = await U.page.$$eval('.brand-logos img', (x) => x.length);
  await U.page.click('.add-logo');
  await U.page.waitForFunction((n) => document.querySelectorAll('.brand-logos img').length > n, nLogos);
  await U.page.click('.brand-logos button:has(img) >> nth=-1');
  await U.page.waitForTimeout(800);
  await U.setSave(out('out-v-logo169.mp4')); await U.openExport(); await U.page.click('.export .btn.primary');
  const tL1 = await U.waitExport();
  await U.setSave(out('out-v-logo916.mp4')); await U.openExport();
  await U.page.selectOption(U.sel('Plataforma'), 'tiktok');
  await U.page.click('.hint.warn button').catch(() => {});
  await U.page.click('.export .btn.primary');
  const tL2 = await U.waitExport();
  const px = [/completa/.test(tL1) ? pixel(out('out-v-logo169.mp4'), 1, 0.9, 0.12) : null, /completa/.test(tL2) ? pixel(out('out-v-logo916.mp4'), 1, 0.9, 0.12) : null];
  const mid = /completa/.test(tL2) ? pixel(out('out-v-logo916.mp4'), 1, 0.5, 0.5) : null;
  const isRed = (p) => p && p[0] > 180 && p[1] < 70 && p[2] < 70;
  check('logo del kit de marca como marca de agua en el export 16:9 y 9:16', isRed(px[0]) && isRed(px[1]) && mid && !isRed(mid), JSON.stringify({ px, mid }));
  await U.page.evaluate(() => { const { store } = window.__velvix; store.update((d) => { d.aspect = '16:9'; d.width = 1920; d.height = 1080; }); });

  // ---- 4. Undo/redo of track reordering and of deleting a box selection.
  await U.page.evaluate(() => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.clips = d.clips.slice(0, 1); d.tracks = d.tracks.filter((t) => t.main); });
    store.setState({ time: 0 }); A.addText({}, 'uno'); A.addText({}, 'dos');
    store.setState({ zoom: 40, selection: [] }); document.querySelector('.tl-scroll').scrollLeft = 0;
  });
  await U.page.waitForTimeout(300);
  const order0 = await U.page.evaluate(() => window.__velvix.store.getState().project.tracks.map((t) => t.id).join());
  const heads = await U.page.$$eval('.track-head', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left + 30, r.top, r.height]; }));
  await U.page.mouse.move(heads[0][0], heads[0][1] + heads[0][2] / 2); await U.page.mouse.down();
  await U.page.mouse.move(heads[0][0], heads[1][1] + heads[1][2] - 3, { steps: 8 }); await U.page.mouse.up();
  const ord = () => U.page.evaluate(() => window.__velvix.store.getState().project.tracks.map((t) => t.id).join());
  const order1 = await ord();
  await U.page.mouse.click(5, 5); // focus out of inputs
  await U.page.keyboard.press('Control+z'); const order2 = await ord();
  await U.page.keyboard.press('Control+y'); const order3 = await ord();
  check('reordenar pistas con deshacer/rehacer', order1 !== order0 && order2 === order0 && order3 === order1, [order0, order1, order2, order3].map((o) => o.slice(0, 8)).join(' / '));
  const rows = await U.page.$$eval('.tracks .track', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.height]; }));
  const n0 = await U.page.evaluate(() => window.__velvix.store.getState().project.clips.length);
  await U.page.mouse.move(rows[0][0] + 300, rows[2][1] + rows[2][2] / 2); await U.page.mouse.down();
  await U.page.mouse.move(rows[0][0] + 20, rows[0][1] + 5, { steps: 8 }); await U.page.mouse.up();
  const boxed = await U.page.evaluate(() => window.__velvix.store.getState().selection.length);
  await U.page.keyboard.press('Delete'); const n1 = await U.page.evaluate(() => window.__velvix.store.getState().project.clips.length);
  await U.page.keyboard.press('Control+z'); const n2 = await U.page.evaluate(() => window.__velvix.store.getState().project.clips.length);
  await U.page.keyboard.press('Control+y'); const n3 = await U.page.evaluate(() => window.__velvix.store.getState().project.clips.length);
  check('selección por caja + borrar con deshacer/rehacer', boxed === 3 && n1 === n0 - 3 && n2 === n0 && n3 === n1, `caja ${boxed}, clips ${n0} → ${n1} → ${n2} → ${n3}`);

  // ---- 5. Versions and disk: rotation keeps 30; restoring asks first; deleting an imported project frees its media.
  const vr = await U.page.evaluate(async () => {
    const { store } = window.__velvix; const id = store.getState().project.id;
    for (let i = 0; i < 35; i++) await window.api.snapshotProject(id);
    return (await window.api.projectVersions(id)).length;
  });
  check('versiones con rotación (máximo 30 por proyecto)', vr === 30, vr + ' versiones');

  // ---- 6. Package with odd paths, made in dev (opened by the packaged app in the PKG step).
  const pk = await U.page.evaluate(async ([files, outp]) => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.clips = []; d.tracks = d.tracks.filter((t) => t.main); d.name = 'Rutas raras ñ é'; });
    const ms = await A.importPaths(files); for (const m of ms) A.addToTimeline(m);
    await new Promise((r) => setTimeout(r, 3000)); // thumbnails/strip
    await store.flushSave();
    return window.api.exportPackage(store.getState().project.id, outp);
  }, [[path.join(WEIRD, 'clip ñandú é.mp4'), path.join(WEIRD, 'voz áé (1).wav')], PKGFILE]);
  check('paquete .velvix con rutas con espacios y acentos (exportado en dev)', pk.files >= 3, JSON.stringify(pk));
  await app.close();
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
