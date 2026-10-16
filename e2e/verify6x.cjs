// Verificación extra de la Sesión 6 en la app real (lo que verify6 no cubre): preview reproduciendo con el fondo
// quitado y con la copia estabilizada (audio), reabrir el proyecto, cancelar, video sin caras, deshacer el
// reencuadre, exportación reanudable con matte + copia, seguimiento con velocidad 2×, escenas con el clip invertido,
// clips cortos con Whisper de verdad y tiempos en 1080p. Usa los medios que genera verify6 (correrlo antes).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen'), MEDIA = path.join(S, 'media');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const ff = (...a) => cp.execFileSync(FF, ['-y', '-v', 'error', ...a], { maxBuffer: 1 << 28 });
const gen = (name, fn) => { const f = path.join(GEN, name); if (!fs.existsSync(f)) fn(f); return f; };
const rgbAt = (f, t, w = 64, h = 36) => ff('-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');
const G = (n) => path.join(GEN, n);

(async () => {
  // V4 needs a matte that is not cached yet.
  const CACHE = path.join(process.env.APPDATA, 'Velvix Studio', 'cache');
  for (const f of fs.readdirSync(CACHE)) if (/^matte-/.test(f)) fs.rmSync(path.join(CACHE, f), { force: true });
  const FACE = G('retrato.jpg'), PAN = G('cara-paneo.mp4'), SHAKY = G('temblor.mp4'), TRACK = G('seguimiento.mp4'), SCENES = G('escenas.mp4'), LONG = G('largo.mp4');
  for (const f of [FACE, PAN, SHAKY, TRACK, SCENES, LONG]) if (!fs.existsSync(f)) throw new Error('Falta ' + f + ': corre verify6 antes');
  // 30 s 1080p vlog-like pan for timings.
  const BIG = gen('cara-1080-30s.mp4', (f) => ff('-f', 'lavfi', '-i', 'color=c=0x2850c8:s=1920x1080:r=30:d=30', '-loop', '1', '-i', FACE, '-filter_complex',
    '[1:v]scale=810:1012[p];[0:v][p]overlay=x=60+30*t:y=68:shortest=1,format=yuv420p', '-t', '30', '-c:v', 'libx264', '-preset', 'veryfast', f));
  const app = await _electron.launch({ executablePath: process.env.PKG ? APP + '/release/win-unpacked/Velvix Studio.exe' : require(APP + '/node_modules/electron'), args: process.env.PKG ? [] : [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card'); await page.click('.new-card'); await page.waitForSelector('.editor');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => { const { store } = window.__velvix; window.__toasts = []; store.subscribe(() => { const t = store.getState().toast; if (t && window.__toasts[window.__toasts.length - 1] !== t.msg) window.__toasts.push(t.msg); }); });
  const toasts = () => ev(() => window.__toasts.splice(0).join(' | '));
  const only = (f) => ev(async (f) => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.clips = []; d.markers = []; d.transcript = null; d.tracks = d.tracks.filter((t) => t.main); });
    const [m] = await A.importPaths([f]); const id = A.addToTimeline(m); store.setState({ time: 0, selection: [id], playing: false }); return id;
  }, f);
  // Preview canvas color at (u, v).
  const previewAt = (pts) => ev((pts) => { const c = document.querySelector('.stage canvas'), x = c.getContext('2d'); return pts.map(([u, v]) => Array.from(x.getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data.slice(0, 3))); }, pts);
  const green = (p) => p[1] > 180 && p[0] < 80 && p[2] < 80;
  const exportUI = async (out) => {
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
    await page.click('.export .btn.primary');
    let t = ''; for (let i = 0; i < 400 && !/completa|fall/.test(t); i++) { await page.waitForTimeout(1000); t = await ev(() => document.querySelector('.export')?.innerText || ''); }
    await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {});
    return t;
  };

  // V1 preview playing with the background removed (real <video> path, not the export decoder).
  let id = await only(PAN);
  await ev(async (id) => { const { vision, store } = window.__velvix; await vision.removeBackground(id); store.update((d) => { d.background = { type: 'color', color: '#00ff00', blur: 40 }; }); }, id);
  await ev(() => window.__velvix.store.setState({ time: 1, playing: true }));
  const samples = [];
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(300); const t = await ev(() => window.__velvix.store.getState().time); const [bg, person] = await previewAt([[0.95, 0.5], [(310 + 110 * t) / 1280, 0.455]]); samples.push([+t.toFixed(2), green(bg), !green(person)]); }
  await ev(() => window.__velvix.store.setState({ playing: false }));
  check('V1 preview reproduciendo: fondo quitado y la persona sincronizada', samples.every((s) => s[1] && s[2]), JSON.stringify(samples));

  // V2 preview with the stabilized copy: picture from the copy, audio from an <audio> element.
  id = await only(SHAKY);
  await ev((id) => window.__velvix.vision.stabilizeClip(id, 'med'), id);
  // The pool's elements are not in the DOM: record what play() is called on.
  await ev(() => { window.__plays = []; const orig = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__plays.push(this.tagName + ' ' + decodeURIComponent(this.src).split(/[\\/]/).pop()); return orig.call(this); }; });
  await ev(() => window.__velvix.store.setState({ time: 0.5, playing: true }));
  await page.waitForTimeout(1500);
  await ev(() => window.__velvix.store.setState({ playing: false }));
  const plays = await ev(() => [...new Set(window.__plays)]);
  // Paused frame: closer to the stabilized copy than to the shaky source.
  await ev(() => window.__velvix.store.setState({ time: 2, selection: [] })); await page.waitForTimeout(2500);
  const pv = await ev(() => { const c = document.querySelector('.stage canvas'), s = document.createElement('canvas'); s.width = 64; s.height = 36; const x = s.getContext('2d'); x.drawImage(c, 0, 0, 64, 36); return Array.from(x.getImageData(0, 0, 64, 36).data); });
  const altPath = await ev(() => window.__velvix.store.getState().project.clips[0].alt.path);
  const dist = (raw) => { let d = 0; for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) for (let k = 0; k < 3; k++) d += Math.abs(raw[i + k] - pv[j + k]); return +(d / (raw.length)).toFixed(1); };
  const dAlt = dist(rgbAt(altPath, 2)), dSrc = dist(rgbAt(SHAKY, 2));
  check('V2 preview con video estabilizado: imagen de la copia y audio por <audio>', plays.some((p) => /^VIDEO stab-/.test(p)) && plays.some((p) => /^AUDIO temblor/.test(p)) && dAlt < dSrc, `${plays.join(', ')} · dif. copia ${dAlt} / original ${dSrc} · media preview ${Math.round(pv.reduce((a, v, i) => a + (i % 4 < 3 ? v : 0), 0) / (pv.length * 0.75))}`);

  // V3 reopen the project (reload the window): matte and processed copy come back from the cache.
  id = await only(PAN);
  await ev(async (id) => { const { vision, store } = window.__velvix; await vision.removeBackground(id); store.update((d) => { d.background = { type: 'color', color: '#00ff00', blur: 40 }; }); await store.flushSave(); }, id);
  const pid = await ev(() => window.__velvix.store.getState().project.id);
  await page.reload(); await page.waitForSelector('.new-card');
  await page.click(`.home .proj:has-text("${await ev((pid) => window.api.loadProject(pid).then((p) => p.name), pid)}") >> nth=0 >> .thumb`);
  await page.waitForSelector('.editor');
  await ev(() => { const { store } = window.__velvix; window.__toasts = []; store.subscribe(() => { const t = store.getState().toast; if (t && window.__toasts[window.__toasts.length - 1] !== t.msg) window.__toasts.push(t.msg); }); store.setState({ time: 2 }); });
  await page.waitForTimeout(1500);
  const [bg3, p3] = await previewAt([[0.95, 0.5], [(310 + 220) / 1280, 0.455]]);
  check('V3 al reabrir el proyecto el fondo sigue quitado', green(bg3) && !green(p3), `${bg3} / ${p3}`);

  // V4 cancel from the taskbar ✕, then run again.
  id = await only(BIG);
  await ev((id) => { window.__p = window.__velvix.vision.removeBackground(id); }, id);
  await page.waitForSelector('.job-cancel', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.click('.job-cancel');
  await ev(() => window.__p);
  const t4 = await toasts(), m4 = await ev(() => !!window.__velvix.store.getState().project.clips[0].matte);
  let t0 = Date.now();
  const again = await ev((id) => window.__velvix.vision.removeBackground(id), id);
  const tBig = (Date.now() - t0) / 1000;
  check('V4 cancelar quitar fondo y volver a lanzarlo', /cancelado/.test(t4) && !m4 && !!again, `${t4} · 30 s 1080p en ${tBig.toFixed(1)} s`);
  const mem = await app.evaluate(({ app }) => app.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024);
  console.log('INFO memoria total tras 30 s 1080p:', Math.round(mem), 'MB');

  // V5 video without faces: centered, toast.
  id = await only(LONG);
  await ev(() => { const { store } = window.__velvix; store.update((d) => { d.clips[0].duration = 6; }); });
  await ev(async (id) => { const { vision, store, model: M } = window.__velvix; store.update((d) => { const [w, h] = M.ASPECTS['9:16']; Object.assign(d, { aspect: '9:16', width: w, height: h }); }); await vision.reframeClip(id); }, id);
  const c5 = await ev(() => { const c = window.__velvix.store.getState().project.clips[0]; return { fit: c.fit, x: c.transform.x, kf: Object.keys(c.kf) }; });
  check('V5 sin caras: encuadre centrado y aviso', /ninguna cara/.test(await toasts()) && c5.fit === 'fill' && c5.x === 0 && !c5.kf.length, JSON.stringify(c5));

  // V6 undo the whole-project reframe in one step.
  await ev(() => { const { store, model: M } = window.__velvix; store.update((d) => { const [w, h] = M.ASPECTS['16:9']; Object.assign(d, { aspect: '16:9', width: w, height: h }); }); });
  id = await only(PAN);
  await ev(() => window.__velvix.vision.autoReframe('9:16'));
  const u6 = await ev(() => { const { store } = window.__velvix; const a = store.getState().project.aspect; store.undo(); const p = store.getState().project; return [a, p.aspect, p.width, p.clips[0].fit, Object.keys(p.clips[0].kf).length]; });
  check('V6 deshacer el reencuadre automático (un paso)', u6[0] === '9:16' && u6[1] === '16:9' && u6[2] === 1920 && u6[3] === 'fit' && u6[4] === 0, JSON.stringify(u6));

  // V7 resumable export (Sesión 4) with matte + stabilized copy: a failure mid-way = the whole export.
  id = await only(SHAKY);
  await ev(async (id) => { const { vision } = window.__velvix; await vision.stabilizeClip(id, 'med'); await vision.removeBackground(id); }, id);
  const O1 = path.win32.normalize(path.join(S, 'out-v6-entera.mp4')), O2 = path.win32.normalize(path.join(S, 'out-v6-reintento.mp4'));
  const e1 = await exportUI(O1);
  await ev(() => { window.__velvixFail = { at: 50, n: 1 }; });
  const e2 = await exportUI(O2);
  let dr = 0; for (const t of [0.5, 1.8, 3.2]) { const a = rgbAt(O1, t), b = rgbAt(O2, t); for (let i = 0; i < a.length; i++) dr += Math.abs(a[i] - b[i]) / a.length / 3; }
  check('V7 exportación reanudable con fondo quitado + estabilizado = exportación entera', /completa/.test(e1) && /completa/.test(e2) && dr < 2, `diferencia ${dr.toFixed(2)}`);

  // V8 tracking over a clip at 2× (time mapping through speed).
  id = await only(TRACK);
  await ev((id) => window.__velvix.actions.setSpeed(id, 2), id);
  const sq = (src) => [(640 + 300 * Math.cos(1.5 * src)) / 1280 - 0.5, (360 + 180 * Math.sin(1.5 * src)) / 720 - 0.5];
  await ev((p0) => { const { actions: A, store } = window.__velvix; store.setState({ time: 0.5 }); A.addSticker('⭐'); store.update((d) => { const s = d.clips.at(-1); s.start = 0; s.duration = 1.9; s.transform.x = p0[0]; s.transform.y = p0[1]; }); }, sq(1));
  await ev(() => window.__velvix.vision.trackObject(window.__velvix.store.getState().project.clips.at(-1).id));
  const e8 = await ev((exp) => { const { store, model: M } = window.__velvix, s = store.getState().project.clips.at(-1); return exp.map(([t, x, y]) => { const tr = M.transformAt(s, t); return +Math.hypot((tr.x - x) * 1280, (tr.y - y) * 720).toFixed(1); }); }, [0.1, 0.5, 1, 1.5, 1.85].map((t) => [t, ...sq(2 * t)]));
  check('V8 seguimiento sobre un clip a 2×', e8.every((e) => e < 20), `error px: ${e8}`);

  // V9 scenes on a reversed clip: cuts still at 2 s and 4 s of the timeline.
  id = await only(SCENES);
  await ev(async () => { const { actions: A } = window.__velvix; await A.toggleReverse(); });
  await ev((id) => window.__velvix.vision.splitScenes(id, 10), id);
  const s9 = await ev(() => window.__velvix.store.getState().project.clips.sort((a, b) => a.start - b.start).map((c) => +c.start.toFixed(3)));
  check('V9 escenas con el clip invertido', s9.length === 3 && Math.abs(s9[1] - 2) < 0.034 && Math.abs(s9[2] - 4) < 0.034, JSON.stringify(s9));

  // V10 shorts with real Whisper (tiny) on the long video: the voice stretches are 20–40 s and 60–80 s.
  await only(LONG);
  await ev(() => localStorage.setItem('whisperModel', 'onnx-community/whisper-tiny'));
  t0 = Date.now();
  const f10 = await ev(() => window.__velvix.vision.findShorts({ count: 2, min: 8, max: 20, language: 'es' }));
  const words = await ev(() => (window.__velvix.store.getState().project.transcript || { words: [] }).words.length);
  check('V10 clips cortos con transcripción real (Whisper)', words > 10 && f10.length === 2 && f10.every((s) => (s.a >= 19 && s.b <= 41) || (s.a >= 59 && s.b <= 81)), `${words} palabras, ${JSON.stringify(f10.map((s) => [s.a, s.b, s.title]))} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await ev(() => localStorage.setItem('whisperModel', 'onnx-community/whisper-base'));

  // V11 upscaling speed on 480p.
  const L480 = gen('baja-480.mp4', (f) => ff('-i', PAN, '-t', '2', '-vf', 'scale=854:480:flags=area', '-c:v', 'libx264', '-crf', '14', f));
  id = await only(L480);
  t0 = Date.now();
  await ev((id) => window.__velvix.vision.upscaleClip(id), id);
  const n11 = await ev(() => { const c = window.__velvix.store.getState().project.clips[0]; return c.alt && c.alt.up ? c.alt.n : 0; });
  console.log(`INFO mejorar resolución 854×480 → 1708×960: ${n11} cuadros en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  check('V11 mejorar resolución de 480p', n11 === 60);

  await page.click('.insp .tabs button:has-text("IA")'); await page.waitForTimeout(500);
  await page.screenshot({ path: S + '/12-ia-inspector.png' });
  await page.click('.left-tabs button:has-text("IA")'); await page.waitForTimeout(300);
  await page.screenshot({ path: S + '/13-ia-panel.png' });
  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
