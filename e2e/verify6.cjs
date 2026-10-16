// Sesión 6 in the real app: background removal (MODNet), reframing that follows the face (UltraFace),
// stabilization (vidstab), motion tracking, scene detection, long video → shorts and AI upscaling (Real-ESRGAN),
// plus how they work with earlier sessions (export, split, reverse, packages, undo).
// Usage: node e2e/verify6.cjs   (PKG=1 for the packaged app). Downloads a test portrait and the models once.
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
// Gray (or rgb) frames of a file: [Uint8Array per frame].
const grab = (f, { ss = 0, n = 1, w = 320, h = 180, pix = 'gray', vf = '' } = {}) => {
  const raw = ff('-ss', String(ss), '-i', f, '-frames:v', String(n), '-vf', `${vf}scale=${w}:${h}:flags=area`, '-pix_fmt', pix, '-f', 'rawvideo', '-');
  const fb = w * h * (pix === 'gray' ? 1 : 3), out = [];
  for (let i = 0; i + fb <= raw.length; i += fb) out.push(raw.subarray(i, i + fb));
  return out;
};
const probe = (f) => { const o = cp.spawnSync(FF, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr; const m = /(\d{2,5})x(\d{2,5})/.exec(o.split('Video:')[1] || ''); const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(o); return { w: m ? +m[1] : 0, h: m ? +m[2] : 0, dur: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, audio: /Audio:/.test(o) }; };
const frameCount = (f) => grab(f, { n: 100000, w: 16, h: 16 }).length;

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  // ---------- test media ----------
  const FACE = gen('retrato.jpg', (f) => cp.execFileSync('curl', ['-sL', '-o', f, 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/portrait-of-woman_small.jpg']));
  // Portrait photo (540×675) sliding over a blue background: x = 40 + 110·t (a person filling the height, like a vlog).
  const PAN = gen('cara-paneo.mp4', (f) => ff('-f', 'lavfi', '-i', 'color=c=0x2850c8:s=1280x720:r=30:d=6', '-loop', '1', '-i', FACE,
    '-filter_complex', '[1:v]scale=540:675[p];[0:v][p]overlay=x=40+110*t:y=45:shortest=1,format=yuv420p', '-t', '6', '-c:v', 'libx264', '-g', '30', f));
  // Still photo with random hand-held jitter (and a 440 Hz tone, to check the audio stays).
  const SHAKY = gen('temblor.mp4', (f) => ff('-loop', '1', '-i', FACE, '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-filter_complex',
    '[0:v]scale=1400:800,crop=1280:720:60+40*sin(n*2.1)+18*sin(n*0.77):40+30*cos(n*1.73)+12*sin(n*0.91),fps=30,format=yuv420p[v]', '-map', '[v]', '-map', '1:a', '-t', '4', '-c:v', 'libx264', '-c:a', 'aac', f));
  // Patterned square moving on a circle over a static picture: center (640 + 300·cos 1.5t, 360 + 180·sin 1.5t).
  const TRACK = gen('seguimiento.mp4', (f) => ff('-loop', '1', '-i', FACE, '-f', 'lavfi', '-i', 'color=c=white:s=60x60:r=30:d=4', '-filter_complex',
    '[0:v]scale=1280:720,boxblur=4,fps=30[bg];[1:v]drawbox=x=15:y=15:w=30:h=30:c=black:t=fill,drawbox=x=0:y=0:w=15:h=15:c=red:t=fill[sq];[bg][sq]overlay=x=610+300*cos(1.5*t):y=330+180*sin(1.5*t):shortest=1,format=yuv420p', '-t', '4', '-c:v', 'libx264', f));
  // Three shots of 2 s: cuts at 2.0 s and 4.0 s.
  const SCENES = gen('escenas.mp4', (f) => ff('-i', path.join(MEDIA, 'clip1.mp4'), '-i', PAN, '-i', path.join(MEDIA, 'clip2.mp4'), '-filter_complex',
    [0, 1, 2].map((i) => `[${i}:v]trim=0:2,setpts=PTS-STARTPTS,scale=1280:720,fps=30,format=yuv420p[v${i}]`).join(';') + ';[v0][v1][v2]concat=n=3:v=1:a=0', '-c:v', 'libx264', f));
  // Low resolution copy (320×180) of the pan and the 640×360 reference it should get close to.
  const LOW = gen('baja.mp4', (f) => ff('-i', PAN, '-t', '1', '-vf', 'scale=320:180:flags=area', '-c:v', 'libx264', '-crf', '12', f));
  const REF = gen('ref640.mp4', (f) => ff('-i', PAN, '-t', '1', '-vf', 'scale=640:360:flags=area', '-c:v', 'libx264', '-crf', '12', f));
  const LOWPNG = gen('baja.png', (f) => ff('-i', FACE, '-vf', 'scale=180:225:flags=area', f));
  // 100 s "long video": quiet except two loud talking stretches (20–40 s, 60–80 s).
  const LONG = gen('largo.mp4', (f) => ff('-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=100', '-i', path.join(MEDIA, 'voz.wav'), '-f', 'lavfi', '-i', 'anoisesrc=a=0.003:d=100:r=44100', '-filter_complex',
    '[1:a]aresample=44100,asplit=4[a1][a2][a3][a4];[a1][a2]concat=n=2:v=0:a=1,atrim=0:20,adelay=20000:all=1[s1];[a3][a4]concat=n=2:v=0:a=1,atrim=0:20,adelay=60000:all=1[s2];[2:a][s1][s2]amix=inputs=3:normalize=0:duration=first[a]',
    '-map', '0:v', '-map', '[a]', '-t', '100', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', f));

  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // Every toast, to explain failures.
  await ev(() => { const { store } = window.__velvix; window.__toasts = []; store.subscribe(() => { const t = store.getState().toast; if (t && window.__toasts[window.__toasts.length - 1] !== t.msg) window.__toasts.push(t.msg); }); });
  const toasts = () => ev(() => window.__toasts.splice(0).join(' | '));
  const exportUI = async (out) => {
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
    await page.click('.export .btn.primary');
    let t = ''; for (let i = 0; i < 300 && !/completa|fall/.test(t); i++) { await page.waitForTimeout(1000); t = await ev(() => document.querySelector('.export')?.innerText || ''); }
    await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {});
    return /completa/.test(t);
  };
  // Fresh timeline with one file on the main track; returns the clip id.
  const only = (f) => ev(async (f) => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.clips = []; d.markers = []; d.transcript = null; d.tracks = d.tracks.filter((t) => t.main); });
    const [m] = await A.importPaths([f]);
    const id = A.addToTimeline(m);
    store.setState({ time: 0, selection: [id] });
    return id;
  }, f);
  // Alpha of the clip drawn alone at time t on a transparent w×h canvas, at points [[x, y] in 0..1].
  const alphaAt = (id, t, pts, w = 320, h = 180) => ev(async ({ id, t, pts, w, h }) => {
    const { store, render: R, model: M, sources: SRC } = window.__velvix, p = store.getState().project, c = p.clips.find((x) => x.id === id), media = M.mediaOf(p, c);
    const pool = new SRC.ExportPool();
    await pool.prepare(p, t);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    R.drawVisual(x, c, t, pool.getDrawable(c, media), w, h, { media });
    pool.destroy();
    const d = x.getImageData(0, 0, w, h).data;
    return pts.map(([u, v]) => d[(Math.floor(v * h) * w + Math.floor(u * w)) * 4 + 3]);
  }, { id, t, pts, w, h });

  // ---------- #4 background removal ----------
  let id = await only(PAN);
  await page.click('.insp .tabs button:has-text("IA")');
  let t0 = Date.now();
  await page.click('.ai-bg');
  await page.waitForFunction(() => { const s = window.__velvix.store.getState(); const c = s.project.clips[0]; return c.matte && c.matte.on; }, null, { timeout: 300000 });
  const mt = await ev(() => window.__velvix.store.getState().project.clips[0].matte), tBg = (Date.now() - t0) / 1000;
  // Photo at t: x 40+110t … +540, y 45…720 (of 1280×720). The nose is at its middle; the blue right side is background.
  const at = (t) => [(310 + 110 * t) / 1280, 0.455];
  const a1 = await alphaAt(id, 1, [at(1), [0.92, 0.12], [0.92, 0.85]]);
  const a4 = await alphaAt(id, 4, [at(4), at(1)]);
  check('#4 quitar fondo: persona opaca, fondo transparente', a1[0] > 200 && a1[1] < 25 && a1[2] < 25, `${a1.join(',')} · ${mt.n} mattes ${mt.w}×${mt.h} en ${tBg.toFixed(1)} s`);
  check('#4 quitar fondo sigue a la persona en el tiempo', a4[0] > 200 && a4[1] < 25, a4.join(','));
  // Edge softness: hard edge leaves almost no half-transparent pixels.
  const soft = async (edge) => { await ev((e) => window.__velvix.store.update((d) => { d.clips[0].matte.edge = e; }), edge); return ev(async () => {
    const { store, render: R, model: M, sources: SRC } = window.__velvix, p = store.getState().project, c = p.clips[0], pool = new SRC.ExportPool(); await pool.prepare(p, 2);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const x = cv.getContext('2d'); R.drawVisual(x, c, 2, pool.getDrawable(c, M.mediaOf(p, c)), 320, 180, { media: M.mediaOf(p, c) }); pool.destroy();
    const d = x.getImageData(0, 0, 320, 180).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20 && d[i] < 235) n++; return n; }); };
  const hard = await soft(0), smooth = await soft(100);
  await ev(() => window.__velvix.store.update((d) => { d.clips[0].matte.edge = 60; }));
  check('#4 suavidad del borde', smooth > hard * 1.5, `${hard} → ${smooth} px semitransparentes`);
  // Export over a green canvas: green where the blue background was, the person stays.
  await ev(() => window.__velvix.store.update((d) => { d.background = { type: 'color', color: '#00ff00', blur: 40 }; }));
  const OUTBG = path.win32.normalize(path.join(S, 'out-fondo.mp4'));
  const okBg = await exportUI(OUTBG);
  const fr = grab(OUTBG, { ss: 1, w: 64, h: 36, pix: 'rgb24' })[0], pix = (u, v) => { const i = (Math.floor(v * 36) * 64 + Math.floor(u * 64)) * 3; return [fr[i], fr[i + 1], fr[i + 2]]; };
  const g = pix(0.92, 0.12), person = pix(...at(1));
  check('#4 exportación con el fondo quitado (fondo del lienzo detrás)', okBg && g[1] > 200 && g[0] < 60 && g[2] < 60 && !(person[1] > 200 && person[0] < 60), `fondo ${g} · persona ${person}`);
  // Split keeps the matte in sync; undo removes it.
  const split = await ev(async () => {
    const { actions: A, store } = window.__velvix; store.setState({ time: 3, selection: [store.getState().project.clips[0].id] }); A.splitAtPlayhead();
    return store.getState().project.clips.map((c) => c.id);
  });
  const a5 = await alphaAt(split[1], 5, [at(5), at(1)]);
  check('integración: dividir un clip con fondo quitado conserva la sincronía', split.length === 2 && a5[0] > 200 && a5[1] < 25, a5.join(','));
  // Undo back to before the matte (split, background, edge edits come after it), then redo everything.
  const und = await ev(() => { const { store } = window.__velvix; let n = 0; while (store.getState().project.clips[0].matte && n < 20) { store.undo(); n++; } const r = [n, store.getState().project.clips.length, !!store.getState().project.clips[0].matte]; for (let i = 0; i < n; i++) store.redo(); return [...r, store.getState().project.clips.length]; });
  check('integración: deshacer quitar fondo (y rehacer)', und[1] === 1 && !und[2] && und[3] === 2, JSON.stringify(und));
  await ev(() => { window.__velvix.store.update((d) => { d.background = { type: 'blur', color: '#000000', blur: 40 }; }); });

  // ---------- #4 auto-reframe 16:9 → 9:16 following the face ----------
  // Face found by the face model itself on rendered frames of the vertical project.
  const faceX = (ts) => ev(async (ts) => {
    const { store, render: R, sources: SRC, audioai } = window.__velvix, p = store.getState().project, W = 270, H = 480;
    const url = window.api.mediaBase + encodeURIComponent(await window.api.getModel('ultraface'));
    const out = [];
    for (const t of ts) {
      const pool = new SRC.ExportPool(); await pool.prepare(p, t);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; R.renderFrame(cv.getContext('2d'), p, t, pool.getDrawable, W, H); pool.destroy();
      const box = document.createElement('canvas'); box.width = 320; box.height = 240; const bx = box.getContext('2d'); bx.fillStyle = '#000'; bx.fillRect(0, 0, 320, 240);
      bx.drawImage(cv, (320 - 135) / 2, 0, 135, 240);
      const d = bx.getImageData(0, 0, 320, 240).data, rgb = new Uint8Array(320 * 240 * 3);
      for (let i = 0; i < 320 * 240; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = d[i * 4 + k];
      const f = (await audioai.workerTask({ task: 'faces', url, frames: rgb }, [rgb.buffer], 'faces')).faces[0][0];
      out.push(f ? +((((f[1] + f[3]) / 2) * 320 - 92.5) / 135).toFixed(3) : null);
    }
    return out;
  }, ts);
  id = await only(PAN);
  const before = await faceX([0.5, 3, 5.5]);
  await page.click('.left-tabs button:has-text("IA")');
  await page.selectOption('.vision select >> nth=0', '9:16');
  await page.click('.ai-reframe');
  await page.waitForFunction(() => { const p = window.__velvix.store.getState().project; return p.aspect === '9:16' && p.clips[0].kf.x; }, null, { timeout: 120000 });
  const rf = await ev(() => { const p = window.__velvix.store.getState().project, c = p.clips[0]; return { w: p.width, h: p.height, fit: c.fit, n: c.kf.x.length, x0: c.kf.x[0].v, x1: c.kf.x[c.kf.x.length - 1].v }; });
  const after = await faceX([0.5, 3, 5.5]);
  check('#4 reencuadre automático 16:9 → 9:16 (formato, llenar, keyframes)', rf.w === 1080 && rf.h === 1920 && rf.fit === 'fill' && rf.n > 10 && rf.x0 > rf.x1, JSON.stringify(rf));
  check('#4 la cara queda centrada en el 9:16 durante todo el paneo', after.every((x) => x != null && Math.abs(x - 0.5) < 0.12), `antes (sin reencuadre) ${before} → ${after}`);
  // Per-clip button from the IA tab (same result: keyframes present).
  await ev(() => { const { store } = window.__velvix; store.update((d) => { d.clips[0].kf = {}; d.clips[0].transform.x = 0; }); store.setState({ selection: [store.getState().project.clips[0].id] }); });
  await page.click('.left-tabs button:has-text("Medios")');
  await page.click('.insp .tabs button:has-text("IA")');
  await page.click('.ai-face');
  await page.waitForFunction(() => !!window.__velvix.store.getState().project.clips[0].kf.x, null, { timeout: 60000 }).catch(() => {});
  check('#4 «Seguir la cara» desde el inspector', await ev(() => (window.__velvix.store.getState().project.clips[0].kf.x || []).length > 10));
  // Captions keep working on the vertical project (Sesión 1): placed and drawn.
  await ev(() => { const { captions, store } = window.__velvix; captions.placeCaptions([[{ text: 'hola', s: 0.5, e: 1 }, { text: 'mundo', s: 1, e: 1.6 }]]); store.setState({ selection: [] }); });
  check('integración: subtítulos en el proyecto reencuadrado', await ev(() => window.__velvix.store.getState().project.clips.filter((c) => c.caption).length === 1));
  await ev(() => { const { store, model: M } = window.__velvix; store.update((d) => { const [w, h] = M.ASPECTS['16:9']; Object.assign(d, { aspect: '16:9', width: w, height: h }); }); });

  // ---------- #6 stabilization ----------
  id = await only(SHAKY);
  await page.click('.insp .tabs button:has-text("IA")');
  await page.click('.ai-stab');
  await page.waitForFunction(() => { const c = window.__velvix.store.getState().project.clips[0]; return c.alt && c.alt.stab; }, null, { timeout: 180000 });
  const alt = await ev(() => window.__velvix.store.getState().project.clips[0].alt);
  // Jitter = mean change between consecutive frames (the picture itself is still).
  const jitter = (f) => { const fr = grab(f, { n: 90, w: 160, h: 90, vf: 'crop=iw*0.7:ih*0.7,' }); let s = 0; for (let i = 1; i < fr.length; i++) { let d = 0; for (let k = 0; k < fr[i].length; k++) d += Math.abs(fr[i][k] - fr[i - 1][k]); s += d / fr[i].length; } return s / (fr.length - 1); };
  const j0 = jitter(SHAKY), j1 = jitter(alt.path), ap = probe(alt.path);
  check('#6 estabilización (vidstab): mucho menos temblor', j1 < j0 * 0.5, `${j0.toFixed(1)} → ${j1.toFixed(1)} · ${ap.w}×${ap.h} ${ap.dur.toFixed(2)} s`);
  await page.waitForTimeout(800);
  const ui = await ev(() => document.querySelector('.insp-body').innerText);
  check('#6 el inspector muestra la estabilización y se puede quitar', /Quitar estabilización/.test(ui));
  const OUTST = path.win32.normalize(path.join(S, 'out-estable.mp4'));
  const okSt = await exportUI(OUTST), es = probe(OUTST);
  const eJ = jitter(OUTST);
  const vol = cp.spawnSync(FF, ['-hide_banner', '-i', OUTST, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr, mean = +(/mean_volume: ([-\d.]+)/.exec(vol) || [0, -99])[1];
  check('#6 exportación usa el video estable y conserva el audio', okSt && eJ < j0 * 0.5 && es.audio && mean > -30 && Math.abs(es.dur - 4) < 0.1, `temblor ${eJ.toFixed(1)}, audio ${mean} dB, ${es.dur} s`);
  // Reverse (Sesión 1 base): the stabilized copy no longer matches → original used (no stale picture).
  const rev = await ev(async () => { const { actions: A, store, model: M } = window.__velvix; await A.toggleReverse(); const p = store.getState().project, c = p.clips[0]; const r = M.vidSrc(c, M.mediaOf(p, c)).alt; await A.toggleReverse(); const q = store.getState().project; return [r, M.vidSrc(q.clips[0], M.mediaOf(q, q.clips[0])).alt]; });
  check('integración: invertir desactiva la copia estabilizada y al volver se recupera', rev[0] === false && rev[1] === true, JSON.stringify(rev));

  // ---------- #6 motion tracking ----------
  id = await only(TRACK);
  const sq = (t) => [(640 + 300 * Math.cos(1.5 * t)) / 1280 - 0.5, (360 + 180 * Math.sin(1.5 * t)) / 720 - 0.5];
  await ev((p0) => { const { actions: A, store } = window.__velvix; store.setState({ time: 0.2 }); A.addSticker('⭐'); store.update((d) => { const s = d.clips[d.clips.length - 1]; s.duration = 3.6; s.transform.x = p0[0]; s.transform.y = p0[1]; }); store.setState({ time: 1 }); }, sq(0.2));
  // Playhead at 1 s: put it on the square there, then track from the inspector.
  await ev((p1) => window.__velvix.store.update((d) => { const s = d.clips[d.clips.length - 1]; s.transform.x = p1[0]; s.transform.y = p1[1]; }), sq(1));
  await page.click('.insp .tabs button:has-text("Posición")');
  await page.click('.ai-track');
  await page.waitForFunction(() => { const p = window.__velvix.store.getState().project; return !!p.clips[p.clips.length - 1].tracked; }, null, { timeout: 60000 });
  const terr = await ev((exp) => {
    const { store, model: M } = window.__velvix, p = store.getState().project, s = p.clips[p.clips.length - 1];
    return exp.map(([t, ex, ey]) => { const tr = M.transformAt(s, t); return +Math.hypot((tr.x - ex) * 1280, (tr.y - ey) * 720).toFixed(1); });
  }, [0.3, 1, 2, 3, 3.7].map((t) => [t, ...sq(t)]));
  check('#6 seguimiento de movimiento: el sticker sigue al objeto', terr.every((e) => e < 16), `error px (1280×720): ${terr.join(', ')}`);
  const unt = await ev(() => { const { vision, store } = window.__velvix, p = store.getState().project; vision.untrack(p.clips[p.clips.length - 1].id); const s = store.getState().project.clips.at(-1); return !s.kf.x && !s.tracked; });
  check('#6 quitar seguimiento', unt);

  // ---------- #21 scene detection + split ----------
  id = await only(SCENES);
  await page.click('.insp .tabs button:has-text("IA")');
  await page.click('.insp section:has(h4:text-is("Escenas")) h4').catch(() => {});
  await page.click('.ai-scenes-clip');
  await page.waitForFunction(() => window.__velvix.store.getState().project.clips.length >= 3, null, { timeout: 60000 }).catch(() => {});
  const sc = await ev(() => window.__velvix.store.getState().project.clips.filter((c) => c.type === 'video').sort((a, b) => a.start - b.start).map((c) => [+c.start.toFixed(3), +c.in.toFixed(3), +c.duration.toFixed(3)]));
  check('#21 detectar escenas y dividir (cortes en 2.0 s y 4.0 s)', sc.length === 3 && Math.abs(sc[1][0] - 2) < 0.034 && Math.abs(sc[2][0] - 4) < 0.034 && Math.abs(sc[1][1] - sc[1][0]) < 0.001, JSON.stringify(sc));
  // Whole main track from the left panel, on a clip with speed 2× (scene times map through the speed).
  await only(SCENES);
  await ev(() => { const { actions: A, store } = window.__velvix; A.setSpeed(store.getState().project.clips[0].id, 2); });
  await page.click('.left-tabs button:has-text("IA")');
  await page.click('.ai-scenes');
  await page.waitForFunction(() => window.__velvix.store.getState().project.clips.length >= 3, null, { timeout: 60000 }).catch(() => {});
  const sc2 = await ev(() => window.__velvix.store.getState().project.clips.sort((a, b) => a.start - b.start).map((c) => +c.start.toFixed(3)));
  check('#21 escenas en toda la pista principal con velocidad 2×', sc2.length === 3 && Math.abs(sc2[1] - 1) < 0.034 && Math.abs(sc2[2] - 2) < 0.034, JSON.stringify(sc2));

  // ---------- #26 long video → shorts ----------
  await only(LONG);
  // Known transcript (Whisper is tested in Sesión 1): sentences only in the two loud stretches.
  await ev(() => {
    const words = [], add = (a, b, text) => text.split(' ').forEach((w, i, all) => { const s = a + ((b - a) * i) / all.length; words.push({ text: w, s, e: s + ((b - a) / all.length) * 0.85 }); });
    for (const base of [20, 60]) for (let k = 0; k < 4; k++) add(base + 0.5 + k * 4.8, base + 4.8 + k * 4.8, k === 0 ? '¿Sabías que esto cambia todo para 2026?' : 'Velvix edita videos increíbles sin conexión.');
    add(5, 8, 'eh bueno'); add(90, 93, 'gracias por ver');
    window.__velvix.store.update((d) => { d.transcript = { words, lang: 'es' }; });
  });
  await page.fill('.vision .field.slider:has(label:text-is("Cantidad")) input[type=number]', '2');
  await page.fill('.vision .field.slider:has(label:text-is("Duración mínima")) input[type=number]', '12');
  await page.fill('.vision .field.slider:has(label:text-is("Duración máxima")) input[type=number]', '20');
  await page.click('.ai-shorts');
  await page.waitForSelector('.short-row', { timeout: 120000 }).catch(() => {});
  const shorts = await page.$$eval('.short-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
  // The rows show start · length; recompute the ranges from the engine for exact numbers.
  const found = await ev(() => window.__velvix.vision.findShorts({ count: 2, min: 12, max: 20 }));
  check('#26 video largo → clips cortos: elige los tramos con voz y energía', found.length === 2 && found[0].a >= 19.9 && found[0].b <= 40.1 && found[1].a >= 59.9 && found[1].b <= 80.1 && found.every((s) => s.b - s.a >= 12 && s.b - s.a <= 20),
    JSON.stringify(found.map((s) => [s.a, s.b, s.score])) + ' | ' + shorts.join(' / '));
  await toasts();
  t0 = Date.now();
  const since = await ev(() => Date.now());
  await page.click('.ai-create');
  await page.waitForFunction(() => /clips cortos creados|Crear clips cortos/.test(window.__toasts.join('|')), null, { timeout: 180000 }).catch(() => {});
  const made = await ev(async (since) => {
    const list = (await window.api.listProjects()).filter((p) => / · Corto \d$/.test(p.name) && p.createdAt >= since);
    const out = [];
    for (const it of list) { const p = await window.api.loadProject(it.id); const c = p.clips.find((x) => x.type === 'video'); out.push({ name: p.name, aspect: p.aspect, dur: +Math.max(...p.clips.map((x) => x.start + x.duration)).toFixed(2), in: +c.in.toFixed(2), words: p.transcript.words.length, w0: +p.transcript.words[0].s.toFixed(2) }); await window.api.deleteProject(it.id); }
    return out.sort((a, b) => a.in - b.in);
  }, since);
  check('#26 cada momento es un proyecto nuevo vertical, recortado, con su transcripción', made.length === 2 && made.every((m, i) => m.aspect === '9:16' && Math.abs(m.dur - (found[i].b - found[i].a)) < 0.05 && Math.abs(m.in - found[i].a) < 0.05 && m.words > 5 && m.w0 >= 0 && m.w0 < 1),
    JSON.stringify(made) + ` en ${((Date.now() - t0) / 1000).toFixed(1)} s · ${await toasts()}`);

  // ---------- #27b AI upscaling ----------
  id = await only(LOW);
  await page.click('.left-tabs button:has-text("Medios")');
  await page.click('.insp .tabs button:has-text("IA")');
  t0 = Date.now();
  await page.click('.ai-up');
  await page.waitForFunction(() => { const c = window.__velvix.store.getState().project.clips[0]; return c.alt && c.alt.up; }, null, { timeout: 600000 });
  const tUp = (Date.now() - t0) / 1000;
  const up = await ev(() => window.__velvix.store.getState().project.clips[0].alt);
  const upp = probe(up.path), nUp = frameCount(up.path), nLow = frameCount(LOW);
  // Quality against the 640×360 reference: PSNR and edge energy, vs. plain bicubic.
  const BIC = path.join(GEN, 'bicubica.mp4'); ff('-i', LOW, '-vf', 'scale=640:360:flags=bicubic', '-c:v', 'libx264', '-crf', '12', BIC);
  const psnr = (f) => +(/average:([\d.inf]+)/.exec(cp.spawnSync(FF, ['-hide_banner', '-i', f, '-i', REF, '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' }).stderr) || [0, 0])[1];
  const edges = (f) => { const [x] = grab(f, { ss: 0.5, w: 640, h: 360 }); let s = 0; for (let y = 1; y < 359; y++) for (let i = 1; i < 639; i++) { const k = y * 640 + i; s += Math.abs(4 * x[k] - x[k - 1] - x[k + 1] - x[k - 640] - x[k + 640]); } return s / (638 * 358); };
  const [pU, pB, eU, eB, eR] = [psnr(up.path), psnr(BIC), edges(up.path), edges(BIC), edges(REF)];
  check('#27b mejorar resolución con IA: 320×180 → 640×360, mismos cuadros', upp.w === 640 && upp.h === 360 && nUp === nLow, `${upp.w}×${upp.h}, ${nUp}/${nLow} cuadros en ${tUp.toFixed(1)} s`);
  check('#27b más nítido que el escalado bicúbico y fiel al original', eU > eB * 1.15 && pU > 24, `PSNR IA ${pU} / bicúbico ${pB} dB · bordes IA ${eU.toFixed(2)} / bicúbico ${eB.toFixed(2)} / original ${eR.toFixed(2)}`);
  // Stabilize on top of the upscaled copy, then reset to the original.
  const chain = await ev(async () => { const { vision, store } = window.__velvix; const id = store.getState().project.clips[0].id; await vision.stabilizeClip(id, 'low'); const a = store.getState().project.clips[0].alt; vision.resetVideo(id); return [!!a.up, !!a.stab, a.path === a.stab.path, store.getState().project.clips[0].alt]; });
  check('integración: estabilizar sobre la copia mejorada y restablecer el original', chain[0] && chain[1] && chain[2] && chain[3] === null, JSON.stringify(chain));
  // Photo: new media at twice the size.
  await only(LOWPNG);
  await page.click('.insp .tabs button:has-text("IA")');
  await page.click('.ai-up');
  await page.waitForFunction(() => { const p = window.__velvix.store.getState().project; const m = p.media.find((x) => x.id === p.clips[0].mediaId); return /×2/.test(m.name); }, null, { timeout: 120000 }).catch(() => {});
  const img = await ev(() => { const p = window.__velvix.store.getState().project; const m = p.media.find((x) => x.id === p.clips[0].mediaId); return [m.width, m.height, m.name]; });
  check('#27b mejorar resolución de una foto', img[0] === 360 && img[1] === 450, img.join(' '));
  // Background removal on the upscaled photo (two AI tools on one clip).
  await ev(() => window.__velvix.vision.removeBackground(window.__velvix.store.getState().project.clips[0].id));
  const ia = await alphaAt(await ev(() => window.__velvix.store.getState().project.clips[0].id), 1, [[0.5, 0.45], [0.04, 0.3], [0.96, 0.3]]);
  check('integración: quitar fondo de la foto mejorada', ia[0] > 200 && ia[1] < 30 && ia[2] < 30, ia.join(','));

  // ---------- package (Sesión 4): matte and processed copies travel and stay valid ----------
  id = await only(SHAKY);
  await ev(async () => { const { vision, store } = window.__velvix; const id = store.getState().project.clips[0].id; await vision.stabilizeClip(id, 'med'); await vision.removeBackground(id); });
  const pk = await ev(async (out) => {
    const { store, model: M } = window.__velvix; await store.flushSave();
    const p = store.getState().project;
    await window.api.exportPackage(p.id, out);
    const nid = await window.api.importPackage(out), q = await window.api.loadProject(nid), c = q.clips[0], m = M.mediaOf(q, c);
    const r = { alt: M.vidSrc(c, m).alt, matte: M.matteOn(c, m), files: (await window.api.fileExists(c.alt.path)) && (await window.api.fileExists(c.matte.path)), moved: c.alt.path !== p.clips[0].alt.path && /imported/.test(c.matte.path) };
    await window.api.deleteProject(nid);
    return r;
  }, path.win32.normalize(path.join(GEN, 'ia.velvix')));
  check('integración: el paquete .velvix lleva el fondo quitado y el video estabilizado', pk.alt && pk.matte && pk.files && pk.moved, JSON.stringify(pk));
  await page.screenshot({ path: S + '/11-ia.png' });

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
