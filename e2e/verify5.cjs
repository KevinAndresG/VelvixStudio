// Sesión 5 in the real app: WebGL grading (same math as the old CSS filters), chroma, LUT .cube, RGB curves,
// HSL per color, lift/gamma/gain wheels, skin smoothing, scopes, adjustment layers, the Color tab UI, a real
// export compared with the preview and a .velvix package with a LUT (4K speed: e2e/bench4k.cjs).
// Usage: node e2e/verify5.cjs   (PKG=1 for the packaged app)
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
// Mean RGB of the frame at t, scaled to w×h.
const frameRgb = (f, t, w, h) => { const raw = cp.execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 }); return raw; };

// LUT that swaps red and blue (size 2, red index fastest).
function writeLut(file) {
  const rows = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${b} ${g} ${r}`);
  fs.writeFileSync(file, `# swap R/B\nTITLE "swap"\nLUT_3D_SIZE 2\n${rows.join('\n')}\n`);
}

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  const LUT = path.join(GEN, 'swap rb.cube'); writeLut(LUT);
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');

  // ---------- shader math on synthetic sources ----------
  const px = await page.evaluate(async (lutFile) => {
    const { render: R, model: M } = window.__velvix;
    const solid = (rgb, w = 64, h = 36) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, w, h); return c; };
    const noisy = (rgb, amp = 30, w = 160, h = 90) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'), im = x.createImageData(w, h); let s = 7; for (let i = 0; i < im.data.length; i += 4) { s = (s * 9301 + 49297) % 233280; const n = (s / 233280 - 0.5) * 2 * amp; for (let k = 0; k < 3; k++) im.data[i + k] = rgb[k] + n; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return c; };
    const out = document.createElement('canvas'); out.width = 160; out.height = 90; const ox = out.getContext('2d');
    const draw = (src, filter, extra = {}) => {
      const clip = M.newClip('video', { start: 0, duration: 5, fit: 'stretch', filter: { ...M.DEFAULT_FILTER, ...filter }, ...extra });
      ox.clearRect(0, 0, 160, 90); R.drawVisual(ox, clip, 1, { el: src, w: src.width, h: src.height }, 160, 90);
      return ox.getImageData(0, 0, 160, 90).data;
    };
    const mean = (d, x0 = 0, y0 = 0, x1 = 160, y1 = 90) => { const m = [0, 0, 0, 0]; let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 160 + x) * 4; for (let k = 0; k < 4; k++) m[k] += d[i + k]; n++; } return m.map((v) => Math.round(v / n)); };
    const sd = (d) => { let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { s += d[i]; s2 += d[i] * d[i]; n++; } return +Math.sqrt(s2 / n - (s / n) ** 2).toFixed(2); };
    const o = {};
    const g = solid('128,128,128');
    o.none = mean(draw(g, {}));
    o.bright = mean(draw(g, { brightness: 50 }))[0]; // CSS: 128·1.3 = 166
    o.contrast = mean(draw(solid('64,64,64'), { contrast: 50 }))[0]; // (0.251−0.5)·1.5+0.5 → 32
    o.desat = mean(draw(solid('255,0,0'), { saturation: -100 })); // 0.213·255 = 54
    o.preset = mean(draw(g, { preset: 'bw' }));
    o.chroma = [mean(draw(solid('0,255,0'), {}, { chroma: { on: true, color: '#00ff00', similarity: 30, smooth: 10 } }))[3], mean(draw(solid('255,0,0'), {}, { chroma: { on: true, color: '#00ff00', similarity: 30, smooth: 10 } }))[3]];
    o.curve = mean(draw(g, { curves: { m: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] } }))[0];
    o.curveR = mean(draw(g, { curves: { r: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] } }));
    o.hslRed = mean(draw(solid('220,30,30'), { hsl: { red: [0, -100, 0] } }));
    o.hslBlueKeep = mean(draw(solid('30,30,220'), { hsl: { red: [0, -100, 0] } }));
    o.hslHue = mean(draw(solid('220,30,30'), { hsl: { red: [100, 0, 0] } }));
    o.gainRed = mean(draw(g, { gainX: 100 }));
    o.liftUp = mean(draw(solid('10,10,10'), { lift: 100 }))[0];
    o.gammaUp = mean(draw(g, { gamma: 100 }))[0];
    const vg = draw(g, { vignette: 100 }); o.vignette = [mean(vg, 0, 0, 10, 10)[0], mean(vg, 75, 40, 85, 50)[0]];
    o.grain = sd(draw(g, { grain: 100 }));
    const skinSrc = noisy([205, 150, 120], 20), blueSrc = noisy([60, 90, 200], 20);
    o.skin = [sd(draw(skinSrc, {})), sd(draw(skinSrc, { skin: 100 })), sd(draw(blueSrc, {})), sd(draw(blueSrc, { skin: 100 }))];
    // LUT .cube copied into the app data and loaded (swaps R and B).
    const lut = await window.api.lutImport(lutFile);
    for (let i = 0; i < 50; i++) { draw(solid('200,50,10'), { lut }); await new Promise((r) => setTimeout(r, 20)); if (mean(draw(solid('200,50,10'), { lut }))[2] > 150) break; }
    o.lut = mean(draw(solid('200,50,10'), { lut }));
    o.lutHalf = mean(draw(solid('200,50,10'), { lut, lutMix: 50 }));
    o.lutPath = lut;
    // Adjustment layer (effect clip with a filter) grades everything below it.
    const p = { width: 160, height: 90, background: { type: 'black' }, media: [{ id: 'm', type: 'image' }], tracks: [{ id: 'fx', kind: 'effect' }, { id: 'v', kind: 'video', main: true }], clips: [
      M.newClip('image', { id: 'a', trackId: 'v', mediaId: 'm', start: 0, duration: 5, fit: 'stretch' }),
      M.newClip('effect', { id: 'e', trackId: 'fx', start: 0, duration: 5, effect: { type: 'none' }, filter: { ...M.DEFAULT_FILTER, curves: { m: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } } }),
    ] };
    R.renderFrame(ox, p, 1, () => ({ el: solid('200,50,10'), w: 64, h: 36 }), 160, 90);
    o.adjust = mean(ox.getImageData(0, 0, 160, 90).data);
    // Keyframed skin smoothing / LUT intensity go through the generic keyframes.
    const k = M.newClip('video', { start: 0, duration: 4, filter: { ...M.DEFAULT_FILTER, lut }, kf: { 'filter.lutMix': [{ t: 0, v: 0 }, { t: 4, v: 100 }] } });
    o.kfLut = [0, 4].map((t) => M.effectiveFilter(M.groupAt(k, 'filter', t)).lutMix);
    return o;
  }, LUT);
  console.log(JSON.stringify(px));
  const near = (a, b, d = 3) => Math.abs(a - b) <= d;
  check('#7 sin filtro el clip se dibuja igual', px.none.slice(0, 3).every((v) => near(v, 128, 1)), px.none.join());
  check('#7 brillo/contraste/saturación = mismas fórmulas que CSS', near(px.bright, 166) && near(px.contrast, 32) && near(px.desat[0], 54) && near(px.desat[1], 54), `${px.bright} ${px.contrast} ${px.desat}`);
  check('#7 croma en shader', px.chroma[0] < 5 && px.chroma[1] > 250, px.chroma.join());
  check('#7 LUT .cube 3D (cambia R↔B, intensidad 50 %)', px.lut[0] < 20 && px.lut[2] > 190 && near(px.lutHalf[0], 105, 6) && near(px.lutHalf[2], 105, 6) && /luts/.test(px.lutPath), `${px.lut} / ${px.lutHalf}`);
  check('#18 curvas RGB (maestra y por canal)', near(px.curve, 191, 4) && px.curveR[0] > 150 && near(px.curveR[1], 128, 2), `${px.curve} ${px.curveR}`);
  check('#18 HSL por color (solo afecta al rojo)', Math.max(...px.hslRed.slice(0, 3)) - Math.min(...px.hslRed.slice(0, 3)) < 10 && px.hslBlueKeep[2] > 210 && px.hslHue[1] > 80, `${px.hslRed} | ${px.hslBlueKeep} | ${px.hslHue}`);
  check('#18 ruedas lift/gamma/gain', px.gainRed[0] > px.gainRed[1] + 30 && px.liftUp > 60 && px.gammaUp > 160, `gain ${px.gainRed} lift ${px.liftUp} gamma ${px.gammaUp}`);
  check('#7 viñeta y grano en shader', px.vignette[0] < px.vignette[1] - 40 && px.grain > 5, `${px.vignette} ${px.grain}`);
  check('#27a suavizar piel solo en tonos de piel', px.skin[1] < px.skin[0] * 0.6 && px.skin[3] > px.skin[2] * 0.9, px.skin.join(' '));
  check('#7 capa de ajuste (efecto con filtro) gradúa lo de abajo', near(px.adjust[0], 55, 4) && near(px.adjust[2], 245, 4), px.adjust.join());
  check('#18 keyframes de intensidad del LUT', px.kfLut[0] === 0 && px.kfLut[1] === 100, px.kfLut.join());

  // ---------- Color tab UI on a real clip ----------
  await page.evaluate(async (f) => {
    const { actions: A, store } = window.__velvix;
    const [m] = await A.importPaths([f]);
    const id = A.addToTimeline(m);
    store.setState({ time: 1.5, selection: [id] });
  }, path.join(S, 'media', 'clip1.mp4'));
  await page.click('.insp .tabs button:has-text("Color")');
  await page.waitForSelector('canvas.scope');
  await page.waitForTimeout(800);
  const scopeInk = () => page.$eval('canvas.scope', (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n; });
  const hist = await scopeInk();
  await page.click('.insp button:has-text("Forma de onda")'); await page.waitForTimeout(600);
  const wave = await scopeInk();
  check('#18 scopes: histograma y forma de onda del cuadro', hist > 300 && wave > 300, `${hist} / ${wave} px`);
  const sel = () => page.evaluate(() => { const s = window.__velvix.store.getState(); return s.project.clips.find((c) => c.id === s.selection[0]).filter; });
  await page.locator('[data-wheel="gain"]').scrollIntoViewIfNeeded();
  const wb = await page.locator('[data-wheel="gain"]').boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2); await page.mouse.down();
  await page.mouse.move(wb.x + wb.width * 0.9, wb.y + wb.height / 2, { steps: 4 }); await page.mouse.up();
  await page.locator('svg.rgb-curve').scrollIntoViewIfNeeded();
  const cb = await page.locator('svg.rgb-curve').boundingBox();
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5); await page.mouse.down(); // adds a point on the curve, then drags it
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.25, { steps: 4 }); await page.mouse.up();
  await page.click('[data-hsl="blue"]');
  await page.fill('.insp .field.slider:has(label:text-is("Saturación")) input[type=number]', '-80');
  await page.fill('.insp .field.slider:has(label:text-is("Suavizar piel")) input[type=number]', '40');
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, LUT);
  await page.click('[data-lut]');
  await page.waitForFunction(() => { const s = window.__velvix.store.getState(); return s.project.clips.find((c) => c.id === s.selection[0]).filter.lut; }, null, { timeout: 5000 }).catch(() => {});
  const f1 = await sel();
  check('#18 UI: rueda, curva, HSL, piel y LUT editan el clip', f1.gainX > 50 && Math.abs(f1.gainY) < 10 && f1.curves.m.length === 3 && Math.abs(f1.curves.m[1].y - 0.75) < 0.03 && f1.hsl.blue[1] === -80 && f1.skin === 40 && /luts/.test(f1.lut) && f1.lutName === 'swap rb',
    JSON.stringify({ gx: f1.gainX, gy: f1.gainY, m: f1.curves.m, hsl: f1.hsl, skin: f1.skin, lut: f1.lutName }));
  await page.screenshot({ path: S + '/10-color.png' });
  const undo = await page.evaluate(() => { const { store } = window.__velvix; store.undo(); const s = store.getState(); return s.project.clips.find((c) => c.id === s.selection[0]).filter.lut; });
  check('#18 deshacer la carga del LUT', !undo, String(undo));
  await page.evaluate(() => window.__velvix.store.redo());

  // ---------- export = preview: only the LUT (R↔B) + skin on a smooth clip, so the expected frame is known ----------
  const GRAD = path.join(GEN, 'grad.mp4');
  if (!fs.existsSync(GRAD)) cp.execFileSync(FF, ['-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=1280x720:r=30:d=3:speed=0.02:c0=0xd09070:c1=0x2060ff:c2=0x30c040', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', GRAD]);
  await page.evaluate(async (f) => {
    const { actions: A, store } = window.__velvix;
    const lut = store.getState().project.clips[0].filter.lut;
    store.update((d) => { d.clips = []; });
    const [m] = await A.importPaths([f]); const id = A.addToTimeline(m);
    store.update((d) => { Object.assign(d.clips[0].filter, { lut, skin: 40, lutMix: 100 }); });
    store.setState({ time: 1.5, playing: false, selection: [id] });
  }, GRAD);
  await page.waitForTimeout(1500);
  // Preview frame averaged over 32×18 blocks (like ffmpeg's area scaling below).
  const prev = await page.evaluate(() => {
    const c = document.querySelector('.stage canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Array(32 * 18 * 4).fill(0), n = new Array(32 * 18).fill(0);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const b = Math.floor((y * 18) / c.height) * 32 + Math.floor((x * 32) / c.width), i = (y * c.width + x) * 4; for (let k = 0; k < 3; k++) o[b * 4 + k] += d[i + k]; n[b]++; }
    return o.map((v, i) => v / n[i >> 2]);
  });
  const OUT = path.win32.normalize(path.join(S, 'out-color.mp4'));
  await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, OUT);
  await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
  await page.click('.export .btn.primary');
  let t = ''; for (let i = 0; i < 120 && !/completa|fall/.test(t); i++) { await page.waitForTimeout(1000); t = await page.evaluate(() => document.querySelector('.export')?.innerText || ''); }
  await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {});
  const exp = frameRgb(OUT, 1.5, 32, 18), src = frameRgb(GRAD, 1.5, 32, 18);
  let dSwap = 0, dPrev = 0, dSrc = 0;
  for (let i = 0, j = 0; i < exp.length; i += 3, j += 4) {
    dSwap += Math.abs(exp[i] - src[i + 2]) + Math.abs(exp[i + 2] - src[i]);
    dSrc += Math.abs(exp[i] - src[i]) + Math.abs(exp[i + 2] - src[i + 2]);
    dPrev += Math.abs(exp[i] - prev[j]) + Math.abs(exp[i + 1] - prev[j + 1]) + Math.abs(exp[i + 2] - prev[j + 2]);
  }
  const n = exp.length / 3; [dSwap, dSrc, dPrev] = [dSwap / n / 2, dSrc / n / 2, dPrev / n / 3].map((v) => +v.toFixed(1));
  check('#7 exportación con LUT = vista previa (WebGL en los dos)', /completa/.test(t) && dSwap < 10 && dSrc > dSwap * 4 && dPrev < 8, `export vs R↔B ${dSwap}, vs original ${dSrc}, vs preview ${dPrev}`);

  // ---------- .velvix package carries the LUT ----------
  const pk = await page.evaluate(async (out) => {
    const { store } = window.__velvix; await store.flushSave();
    const p = store.getState().project;
    await window.api.exportPackage(p.id, out);
    const id = await window.api.importPackage(out), q = await window.api.loadProject(id);
    const lut = q.clips[0].filter.lut, ok = lut !== p.clips[0].filter.lut && /imported/.test(lut) && await window.api.fileExists(lut);
    await window.api.deleteProject(id);
    return { ok, lut };
  }, path.win32.normalize(path.join(GEN, 'color.velvix')));
  check('#7 el paquete .velvix incluye el LUT', pk.ok, pk.lut);

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
