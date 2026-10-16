// Anamorphic video (sample aspect ratio ≠ 1:1): preview, export, thumbnails, film strip, background removal,
// reframing and tracking must all use the display aspect, and old projects get fixed when reopened.
// Usage: node e2e/sar.cjs   (PKG=1 for the packaged app). Needs e2e/gen/retrato.jpg (node e2e/verify6.cjs downloads it).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const ff = (...a) => cp.execFileSync(FF, ['-y', '-v', 'error', ...a], { maxBuffer: 1 << 28 });
const dimsOf = (f) => { const m = /(\d{2,5})x(\d{2,5})/.exec(cp.spawnSync(FF, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr.split('Video:')[1] || ''); return m ? [+m[1], +m[2]] : [0, 0]; };
const rgbAt = (f, t, w = 32, h = 18) => ff('-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');

// Display picture is 800×1000 (4:5), squeezed into 1280×720 (SAR 9:20): blue background, the portrait at x 80–560,
// y 400–1000 (nose at u 0.4, v 0.652) and a patterned square moving on an ellipse in the top right.
const sq = (t) => [(640 + 110 * Math.cos(1.5 * t)) / 800, (220 + 140 * Math.sin(1.5 * t)) / 1000];
const NOSE = [0.4, 0.652], BG = [0.06, 0.06];

(async () => {
  const FACE = path.join(GEN, 'retrato.jpg');
  const ANA = path.join(GEN, 'anamorfico.mp4');
  if (!fs.existsSync(ANA)) ff('-f', 'lavfi', '-i', 'color=c=0x2850c8:s=800x1000:r=30:d=4', '-loop', '1', '-i', FACE, '-f', 'lavfi', '-i', 'color=c=white:s=60x60:r=30:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4',
    '-filter_complex', '[1:v]scale=480:600,setsar=1[p];[2:v]drawbox=x=15:y=15:w=30:h=30:c=black:t=fill,drawbox=x=0:y=0:w=15:h=15:c=red:t=fill[s];[0:v][p]overlay=80:400:shortest=1[a];[a][s]overlay=x=610+110*cos(1.5*t):y=190+140*sin(1.5*t):shortest=1,scale=1280:720,format=yuv420p[v]',
    '-map', '[v]', '-map', '3:a', '-t', '4', '-c:v', 'libx264', '-g', '30', '-c:a', 'aac', ANA);
  const sar = /SAR (\d+:\d+)/.exec(cp.spawnSync(FF, ['-hide_banner', '-i', ANA], { encoding: 'utf8' }).stderr);
  check('video de prueba anamórfico (1280×720, SAR 9:20)', sar && sar[1] === '9:20', sar && sar[1]);

  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const exportUI = async (out) => {
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
    await page.click('.export .btn.primary');
    let t = ''; for (let i = 0; i < 300 && !/completa|fall/.test(t); i++) { await page.waitForTimeout(1000); t = await ev(() => document.querySelector('.export')?.innerText || ''); }
    await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {});
    return /completa/.test(t);
  };
  // Imported (or reopened) media is ready once its thumbnails are there (they come after the proxy).
  const ready = () => page.waitForFunction(() => { const m = window.__velvix.store.getState().project.media[0]; return m && m.strip; }, null, { timeout: 120000 });
  const only = async (f) => {
    const id = await ev(async (f) => {
      const { actions: A, store } = window.__velvix;
      store.update((d) => { d.clips = []; d.media = []; d.tracks = d.tracks.filter((t) => t.main); d.background = { type: 'color', color: '#000000', blur: 40 }; });
      const [m] = await A.importPaths([f]);
      const id = A.addToTimeline(m);
      store.setState({ time: 0, selection: [id] });
      return id;
    }, f);
    await ready();
    return id;
  };
  // Preview canvas averaged over 32×18 blocks (like ffmpeg's area scaling).
  const previewAt = async (t) => {
    await ev((t) => window.__velvix.store.setState({ time: t, playing: false }), t);
    await page.waitForTimeout(700);
    return ev(() => {
      const c = document.querySelector('.stage canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Array(32 * 18 * 3).fill(0), n = new Array(32 * 18).fill(0);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const b = Math.floor((y * 18) / c.height) * 32 + Math.floor((x * 32) / c.width), i = (y * c.width + x) * 4; for (let k = 0; k < 3; k++) o[b * 3 + k] += d[i + k]; n[b]++; }
      return o.map((v, i) => v / n[Math.floor(i / 3)]);
    });
  };
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return +(d / a.length).toFixed(1); };
  // Mean brightness of the left/right pillars (4:5 in 16:9 leaves 5 of 32 columns black on each side).
  const pillars = (b) => { let s = 0, n = 0; for (let y = 0; y < 18; y++) for (const x of [0, 1, 2, 3, 28, 29, 30, 31]) { for (let k = 0; k < 3; k++) s += b[(y * 32 + x) * 3 + k]; n += 3; } return +(s / n).toFixed(1); };
  // Display (u, v) of the 4:5 picture → canvas (0..1) when fitted into the 16:9 project.
  const fitUV = ([u, v]) => [(1 - 0.8 * (9 / 16)) / 2 + u * 0.8 * (9 / 16), v];

  // ---------- probe, proxy, thumbnails ----------
  let id = await only(ANA);
  const m = await ev(() => window.__velvix.store.getState().project.media[0]);
  check('importar: tamaño de pantalla 4:5 y proxy con píxeles cuadrados', Math.abs(m.width / m.height - 0.8) < 0.01 && !!m.proxy && Math.abs(dimsOf(m.proxy)[0] / dimsOf(m.proxy)[1] - 0.8) < 0.01, `${m.width}×${m.height} · proxy ${m.proxy && dimsOf(m.proxy).join('×')}`);
  const th = dimsOf(m.thumb), st = dimsOf(m.strip);
  check('miniatura y filmstrip con el aspecto real', Math.abs(th[0] / th[1] - 0.8) < 0.03 && Math.abs(st[0] / 16 / st[1] - 0.8) < 0.03, `miniatura ${th.join('×')} · filmstrip ${st.join('×')} (16 cuadros)`);

  // ---------- preview vs export, frame by frame ----------
  const OUT = path.win32.normalize(path.join(S, 'out-sar.mp4'));
  const ts = [0.2, 0.9, 1.6, 2.3, 3.0, 3.7], prev = [];
  for (const t of ts) prev.push(await previewAt(t));
  const okExp = await exportUI(OUT);
  const ds = ts.map((t, i) => diff(prev[i], rgbAt(OUT, t)));
  check('preview = exportación cuadro a cuadro con video anamórfico', okExp && ds.every((d) => d < 8), `dif. media ${ds.join(', ')}`);
  const pp = pillars(prev[2]), pe = pillars(rgbAt(OUT, ts[2]));
  check('preview y exportación muestran el 4:5 con bandas negras en el 16:9', pp < 6 && pe < 6, `bandas preview ${pp} · exportación ${pe}`);

  // ---------- background removal ----------
  const alphaAt = (t, pts, w = 320, h = 180) => ev(async ({ t, pts, w, h }) => {
    const { store, render: R, model: M, sources: SRC } = window.__velvix, p = store.getState().project, c = p.clips[0], media = M.mediaOf(p, c);
    const pool = new SRC.ExportPool(); await pool.prepare(p, t);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d');
    R.drawVisual(x, c, t, pool.getDrawable(c, media), w, h, { media }); pool.destroy();
    const d = x.getImageData(0, 0, w, h).data;
    return pts.map(([u, v]) => d[(Math.floor(v * h) * w + Math.floor(u * w)) * 4 + 3]);
  }, { t, pts, w, h });
  await ev((id) => window.__velvix.vision.removeBackground(id), id);
  const mt = await ev(() => window.__velvix.store.getState().project.clips[0].matte);
  const al = await alphaAt(2, [fitUV(NOSE), fitUV(BG), fitUV([0.06, 0.94])]);
  check('quitar fondo: matte 4:5 alineado con la persona', mt && Math.abs(mt.w / mt.h - 0.8) < 0.02 && al[0] > 200 && al[1] < 25 && al[2] < 25, `matte ${mt && mt.w}×${mt && mt.h} · alfa nariz ${al[0]}, fondo ${al[1]}, ${al[2]}`);
  await ev(() => window.__velvix.store.update((d) => { d.clips[0].matte = null; }));

  // ---------- tracking ----------
  const toT = ([u, v]) => { const [x, y] = fitUV([u, v]); return [x - 0.5, y - 0.5]; };
  await ev((p0) => { const { actions: A, store } = window.__velvix; store.setState({ time: 0.2 }); A.addSticker('⭐'); store.update((d) => { const s = d.clips[d.clips.length - 1]; s.duration = 3.6; s.transform.x = p0[0]; s.transform.y = p0[1]; }); store.setState({ time: 1 }); }, toT(sq(0.2)));
  await ev((p1) => window.__velvix.store.update((d) => { const s = d.clips[d.clips.length - 1]; s.transform.x = p1[0]; s.transform.y = p1[1]; }), toT(sq(1)));
  await ev(() => { const { vision, store } = window.__velvix, p = store.getState().project; return vision.trackObject(p.clips[p.clips.length - 1].id); });
  const terr = await ev((exp) => {
    const { store, model: M } = window.__velvix, p = store.getState().project, s = p.clips[p.clips.length - 1];
    return s.tracked ? exp.map(([t, ex, ey]) => { const tr = M.transformAt(s, t); return +Math.hypot((tr.x - ex) * p.width, (tr.y - ey) * p.height).toFixed(1); }) : null;
  }, [0.3, 1, 2, 3, 3.7].map((t) => [t, ...toT(sq(t))]));
  check('seguimiento sigue al objeto en el aspecto real', terr && terr.every((e) => e < 24), `error px (${'1920×1080'}): ${terr}`);
  await ev(() => window.__velvix.store.update((d) => { d.clips = d.clips.slice(0, 1); }));

  // ---------- reframe to 9:16 ----------
  // Face found by the face model itself on frames rendered by the export path.
  // preview: the same from the preview canvas.
  const faceX = (ts, preview) => ev(async ({ ts, preview }) => {
    const { store, render: R, sources: SRC, audioai } = window.__velvix, p = store.getState().project, W = 270, H = 480;
    const url = window.api.mediaBase + encodeURIComponent(await window.api.getModel('ultraface'));
    const out = [];
    for (const t of ts) {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      if (preview) { store.setState({ time: t, playing: false }); await new Promise((r) => setTimeout(r, 700)); cv.getContext('2d').drawImage(document.querySelector('.stage canvas'), 0, 0, W, H); }
      else { const pool = new SRC.ExportPool(); await pool.prepare(p, t); R.renderFrame(cv.getContext('2d'), p, t, pool.getDrawable, W, H); pool.destroy(); }
      const box = document.createElement('canvas'); box.width = 320; box.height = 240; const bx = box.getContext('2d'); bx.fillStyle = '#000'; bx.fillRect(0, 0, 320, 240);
      bx.drawImage(cv, (320 - 135) / 2, 0, 135, 240);
      const d = bx.getImageData(0, 0, 320, 240).data, rgb = new Uint8Array(320 * 240 * 3);
      for (let i = 0; i < 320 * 240; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = d[i * 4 + k];
      const f = (await audioai.workerTask({ task: 'faces', url, frames: rgb }, [rgb.buffer], 'faces')).faces[0][0];
      out.push(f ? +((((f[1] + f[3]) / 2) * 320 - 92.5) / 135).toFixed(3) : null);
    }
    return out;
  }, { ts, preview });
  await ev(() => window.__velvix.vision.autoReframe('9:16'));
  await page.waitForTimeout(500);
  const fx = await faceX([0.5, 2, 3.5]), fp = await faceX([0.5, 2, 3.5], true);
  check('reencuadre 9:16: la cara queda centrada (exportación y preview)', [...fx, ...fp].every((x) => x != null && Math.abs(x - 0.5) < 0.08), `x de la cara: exportación ${fx} · preview ${fp}`);

  // ---------- old project with the anamorphic file imported before the fix ----------
  await ev(() => { const { store } = window.__velvix; store.update((d) => { const [w, h] = [1920, 1080]; d.aspect = '16:9'; d.width = w; d.height = h; Object.assign(d.clips[0], { fit: 'fit', kf: {} }); Object.assign(d.clips[0].transform, { x: 0, y: 0, scale: 1 }); }); });
  await ev(async () => { const { store } = window.__velvix; store.update((d) => { const m = d.media[0]; Object.assign(m, { width: 1280, height: 720, proxy: null, thumb: null, strip: null }); delete m.sar; }); await store.flushSave(); });
  const pid = await ev(() => window.__velvix.store.getState().project.id);
  await page.reload(); await page.waitForSelector('.new-card');
  await page.click(`.home .proj:has-text("${await ev((pid) => window.api.loadProject(pid).then((p) => p.name), pid)}") >> nth=0 >> .thumb`);
  await page.waitForSelector('.editor');
  await ready();
  const m2 = await ev(() => window.__velvix.store.getState().project.media[0]);
  const OUT2 = path.win32.normalize(path.join(S, 'out-sar-viejo.mp4'));
  const pv2 = await previewAt(1.6), ok2 = await exportUI(OUT2), d2 = diff(pv2, rgbAt(OUT2, 1.6));
  check('proyecto viejo se arregla al reabrir (proxy, tamaño, preview = exportación)', !!m2.proxy && Math.abs(m2.width / m2.height - 0.8) < 0.01 && ok2 && d2 < 8 && pillars(rgbAt(OUT2, 1.6)) < 6, `${m2.width}×${m2.height} · dif. ${d2}`);

  check('sin errores en consola', errors.length === 0, errors.slice(0, 3).join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
