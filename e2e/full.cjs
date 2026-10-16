// Full feature pass + real export through the UI dialog.
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const S = process.argv[2] || __dirname, APP = require('path').resolve(__dirname, '..');
const OUT = path.win32.normalize(path.join(S, 'out.mp4'));
(async () => {
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  // Make the save dialog return our path without UI.
  await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, OUT);
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + ' @ ' + String(e.stack).split(String.fromCharCode(10)).slice(1, 3).join(' ')));
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const files = ['clip1.mp4', 'clip2.mp4', 'greenscreen_mpeg4.avi', 'voz.wav'].map((f) => path.join(S, 'media', f));
  const log = await page.evaluate(async (files) => {
    const { actions, store } = window.__velvix;
    const { getState, setState, update } = store;
    const out = [];
    const media = await actions.importPaths(files);
    const a = actions.addToTimeline(media[0]);
    const b = actions.addToTimeline(media[1]);
    // split clip1 at 4s
    setState({ time: 4, selection: [a] }); actions.splitAtPlayhead();
    out.push('afterSplit clips=' + getState().project.clips.length);
    // speed 2x on clip2
    actions.setSpeed(b, 2);
    out.push('clip2 dur=' + getState().project.clips.find((c) => c.id === b).duration);
    // filter + transition
    update((p) => { p.clips.find((c) => c.id === a).filter.preset = 'vintage'; });
    setState({ selection: [b] }); actions.applyTransition('circle', 0.8);
    // overlay greenscreen with chroma at 1s
    await new Promise((r) => setTimeout(r, 4000)); // wait proxy
    const g = actions.addToTimeline(getState().project.media[2], { at: 1 });
    update((p) => { const c = p.clips.find((x) => x.id === g); c.chroma.on = true; c.transform.scale = 0.5; c.transform.x = 0.25; c.anim.in = { type: 'zoomIn', dur: 0.5 }; });
    // detach audio from clip2 and add voice fx
    setState({ selection: [b] }); actions.detachAudio();
    // text with animation and effect
    setState({ time: 0.5 }); actions.addText({ glow: { on: true, color: '#00e5ff', size: 25 } }, 'Velvix Studio');
    update((p) => { const t = p.clips[p.clips.length - 1]; t.anim.in = { type: 'letters', dur: 1 }; t.anim.loop = { type: 'wave', speed: 1 }; });
    setState({ time: 6 }); actions.addEffect('glitch');
    actions.addSticker('🔥');
    const voz = actions.addToTimeline(getState().project.media[3], { at: 0 });
    update((p) => { const c = p.clips.find((x) => x.id === voz); c.volume = 1.5; c.fadeIn = 0.5; });
    const s = getState();
    out.push('tracks=' + s.project.tracks.map((t) => t.kind + (t.main ? '*' : '')).join(','));
    out.push('duration=' + Math.max(...s.project.clips.map((c) => c.start + c.duration)));
    // keyframes on text scale
    return out;
  }, files);
  console.log(log.join('\n'));
  // Voice effect through the inspector path
  const fx = await page.evaluate(async () => {
    const { store } = window.__velvix; const p = store.getState().project;
    const c = p.clips.find((x) => x.type === 'audio' && x.name.includes('(audio)'));
    const m = p.media.find((x) => x.id === c.mediaId);
    const t0 = performance.now();
    const fxPath = await window.api.audioFx(m.path, { voice: 'robot', pitch: 3, denoise: true, normalize: false, bass: 0, treble: 0 });
    store.update((d) => { d.clips.find((x) => x.id === c.id).fxPath = fxPath; });
    return [fxPath, Math.round(performance.now() - t0)];
  });
  console.log('fx', fx);
  await page.evaluate(() => window.__velvix.store.setState({ time: 1.3, selection: [] }));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: S + '/03-full.png' });
  // Export via the UI
  await page.click('button.btn.primary:has-text("Exportar")');
  await page.waitForSelector('.export');
  await page.screenshot({ path: S + '/04-export-dialog.png' });
  const t0 = Date.now();
  await page.click('.export .btn.primary');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(3000); const t = await page.evaluate(() => document.querySelector('.export')?.innerText.split(String.fromCharCode(10)).join(' | ')); console.log(i, t); if (/completa|fall/.test(t)) break; }
  console.log('export secs', (Date.now() - t0) / 1000);
  await page.screenshot({ path: S + '/05-export-done.png' });
  await page.click('.export .btn:has-text("Listo")').catch(() => {});

  // ---------- Sesión 1: transcripción y subtítulos inteligentes ----------
  const fails = [];
  const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
  const r = await page.evaluate(async () => {
    const { store, transcript: T, captions: C, model: M, render: R } = window.__velvix;
    const { getState, update } = store;
    const o = {};
    // Synthetic transcript over the 11 s timeline (word timings in timeline seconds).
    const texts = 'hola eh esto es Velvix um un editor increíble con fuego y 30 efectos'.split(' ');
    const words = texts.map((t, i) => ({ text: t, s: 0.3 + i * 0.6, e: 0.3 + i * 0.6 + 0.45 }));
    update((d) => { d.transcript = { words, lang: 'es' }; });
    // #14 captions from transcript with a dynamic preset + auto emojis
    const dyn = M.TEXT_PRESETS.findIndex((p) => p.name === 'Pop dinámico');
    o.lines = C.captionsFromTranscript(dyn, { emojis: true });
    const caps = () => getState().project.clips.filter((c) => c.caption).sort((a, b) => a.start - b.start);
    o.capText = caps().map((c) => c.text.content).join(' | ');
    o.wordAnim = caps()[0].text.wordAnim;
    o.kw = [M.isKeyword('increíble'), M.isKeyword('hola'), M.isKeyword('30')];
    // Word-timed animation: later words are hidden before they are spoken.
    const c0 = caps()[0], cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const ink = (t) => { const x = cv.getContext('2d'); x.clearRect(0, 0, 1920, 1080); R.drawText(x, c0, t, 1920, 1080); const d = x.getImageData(0, 0, 1920, 1080).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++; return n; };
    o.inkEarly = ink(c0.start + c0.words[1].s + 0.3); o.inkLate = ink(c0.start + c0.duration - 0.01);
    // #20 find & replace + vocabulary
    o.replaced = T.findReplace('esto', 'eso');
    o.afterReplace = getState().project.transcript.words.map((w) => w.text).join(' ');
    const fixed = T.applyVocab([{ text: 'belbix,', s: 0, e: 1 }, { text: 'tic', s: 1, e: 1.2 }, { text: 'toc', s: 1.2, e: 1.5 }, { text: 'casa', s: 2, e: 3 }], T.parseVocab('Velvix\ntic toc = TikTok'));
    o.vocab = fixed.map((w) => w.text + '@' + w.s + '-' + w.e).join(' ');
    // #13 fillers + silence detection
    o.fillers = T.fillerIndices(getState().project.transcript.words).map((i) => getState().project.transcript.words[i].text);
    const sig = new Float32Array(16000 * 3); for (let i = 0; i < sig.length; i++) sig[i] = i < 16000 || i >= 32000 ? Math.sin(i / 5) * 0.3 : 0.0005;
    o.silence = T.silenceRanges(sig, { db: -40, min: 0.6 }).map(([a, b]) => a.toFixed(2) + '-' + b.toFixed(2));
    const audio = await T.timelineAudio();
    o.audioSecs = audio ? audio.length / 16000 : 0;
    o.realSilences = audio ? T.silenceRanges(audio, { db: -40, min: 0.6 }).length : -1;
    // Threshold follows the real audio level: a higher dB threshold marks more of the timeline as silent.
    o.silentSecs = [-60, -30, -10].map((db) => +T.silenceRanges(audio, { db, min: 0.3 }).reduce((s, [a, b]) => s + b - a, 0).toFixed(2));
    // Preview/export sync: what plays after the cut at t−removed is what played before at t.
    const playing = (p, t) => p.clips.filter((c) => (c.type === 'video' || c.type === 'audio') && t >= c.start && t < c.start + c.duration)
      .map((c) => c.mediaId + '@' + M.sourceTime(c, t, p.media.find((m) => m.id === c.mediaId)).toFixed(2)).sort().join(',');
    const syncT = [7.2, 8.5, 10.4];
    // #12 ripple cut of the fillers: duration shrinks by exactly the removed time
    const p0 = getState().project, dur0 = Math.max(...p0.clips.map((c) => c.start + c.duration));
    o.removed = T.cutRanges(T.wordRanges(p0.transcript.words, T.fillerIndices(p0.transcript.words)), 'Muletillas');
    const p1 = getState().project, dur1 = Math.max(...p1.clips.map((c) => c.start + c.duration));
    o.dur = [dur0, dur1];
    o.sync = syncT.map((t) => [playing(p0, t), playing(p1, t - o.removed)]);
    o.wordsLeft = p1.transcript.words.map((w) => w.text).join(' ');
    o.capAfter = p1.clips.filter((c) => c.caption).sort((a, b) => a.start - b.start).map((c) => c.text.content).join(' | ');
    const main = p1.clips.filter((c) => p1.tracks.find((t) => t.id === c.trackId).main).sort((a, b) => a.start - b.start);
    o.mainGaps = main.slice(1).filter((c, i) => Math.abs(c.start - (main[i].start + main[i].duration)) > 1e-3).length;
    return o;
  });
  console.log(JSON.stringify(r, null, 1));
  check('#14 subtítulos desde transcripción con preset dinámico', r.lines > 0 && r.wordAnim === 'pop', r.capText);
  check('#14 emojis automáticos', /\p{Extended_Pictographic}/u.test(r.capText), r.capText);
  check('#14 palabras clave', r.kw.join() === 'true,false,true');
  check('#14 animación por palabra según el habla', r.inkLate > r.inkEarly * 1.2, r.inkEarly + ' → ' + r.inkLate);
  check('#20 buscar y reemplazar', r.replaced >= 1 && / eso /.test(r.afterReplace) && !/esto/.test(r.afterReplace));
  check('#20 vocabulario propio', r.vocab === 'Velvix,@0-1 TikTok@1-1.5 casa@2-3', r.vocab);
  check('#13 detectar muletillas', r.fillers.join() === 'eh,um', r.fillers.join());
  check('#13 detectar silencios por picos de audio', r.silence.join() === '1.12-1.88', r.silence.join());
  check('#13 audio de la línea de tiempo analizado', Math.abs(r.audioSecs - 11) < 0.2, r.audioSecs + ' s, ' + r.realSilences + ' pausas');
  check('#12 corte con ripple', Math.abs(r.dur[0] - r.dur[1] - r.removed) < 0.02 && r.mainGaps === 0, r.dur.join(' → ') + ' (−' + r.removed.toFixed(2) + ')');
  check('#13 umbral según el nivel del audio', r.silentSecs[0] <= r.silentSecs[1] && r.silentSecs[1] <= r.silentSecs[2] && r.silentSecs[2] > r.silentSecs[0], r.silentSecs.join(' / ') + ' s silenciosos');
  check('#12 lo que suena tras el corte coincide (preview y export usan sourceTime)', r.sync.every(([a, b]) => a && a === b), JSON.stringify(r.sync));
  check('#12 transcripción y subtítulos siguen al corte', !/(^| )(eh|um)( |$)/.test(r.wordsLeft) && !/(^| )(eh|um)( |$)/.test(r.capAfter), r.capAfter);

  // #12 through the UI: select a word in the transcript panel and press Supr.
  await page.click('.left-tabs button[title="Transcripción"]');
  await page.waitForSelector('.tr-w');
  const stat = () => page.evaluate(() => { const p = window.__velvix.store.getState().project; return { n: p.transcript.words.length, d: Math.max(...p.clips.map((c) => c.start + c.duration)), ui: document.querySelectorAll('.tr-w').length }; });
  const before = await stat();
  await page.click('.tr-w >> nth=1');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const after = await stat();
  check('#12 borrar palabra desde el panel corta el video', after.n === before.n - 1 && after.ui === after.n && after.d < before.d - 0.3, JSON.stringify([before, after]));
  // #13 through the UI: detect and preview the cut list (re-seed a filler, the earlier cut removed them).
  await page.evaluate(() => window.__velvix.store.update((d) => { d.transcript.words[2].text = 'mmm'; }));
  await page.click('.panel.transcript button:has-text("Detectar")');
  await page.waitForTimeout(3000);
  const prev = await page.evaluate(() => ({ rows: document.querySelectorAll('.cut-row').length, btn: document.querySelector('.panel.transcript .btn.primary')?.innerText || '', struck: document.querySelectorAll('.tr-w.cut').length }));
  check('#13 vista previa de lo que se borra', prev.rows > 0 && prev.struck > 0 && /Quitar \d+ tramos/.test(prev.btn), JSON.stringify(prev));
  await page.screenshot({ path: S + '/07-transcript.png' });

  // #9a translation with the local opus-mt model (downloads once).
  const tr = await page.evaluate(async () => {
    const { captions: C, store } = window.__velvix;
    const out = await C.translateTexts(['Hola mundo, esto es una prueba.'], 'es', 'en');
    const ok = await C.translateCaptions('es', 'en');
    return { out, ok, caps: store.getState().project.clips.filter((c) => c.caption).map((c) => c.text.content + ' [' + c.words.length + ']').join(' | ') };
  });
  check('#9a traducir texto es→en', /world/i.test(tr.out[0]), tr.out[0]);
  check('#9a traducir subtítulos', tr.ok, tr.caps);

  // #12 export after the ripple cuts: video and audio both match the new timeline length.
  const OUT2 = path.win32.normalize(path.join(S, 'out-cut.mp4'));
  await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, OUT2);
  const durCut = await page.evaluate(() => Math.max(...window.__velvix.store.getState().project.clips.map((c) => c.start + c.duration)));
  await page.click('button.btn.primary:has-text("Exportar")');
  await page.waitForSelector('.export');
  await page.click('.export .btn.primary');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(2000); const t = await page.evaluate(() => document.querySelector('.export')?.innerText || ''); if (/completa|fall/.test(t)) break; }
  const probe = (f) => require('child_process').execFileSync(require(APP + '/node_modules/ffprobe-static').path, ['-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'csv=p=0', f]).toString().trim().split(/\r?\n/);
  const streams = Object.fromEntries(probe(OUT2).map((l) => { const [k, d] = l.split(','); return [k, +d]; }));
  check('#12 export tras el corte: video y audio con la nueva duración', Math.abs(streams.video - durCut) < 0.02 && Math.abs(streams.audio - durCut) < 0.1, `timeline ${durCut.toFixed(2)} s, video ${streams.video} s, audio ${streams.audio} s`);

  await page.click('.export .btn:has-text("Listo")').catch(() => {});
  // ---------- Sesión 2: velocidad y keyframes ----------
  // Fresh timeline: clip1 (muted, bullet curve) on the main track + voz.wav (curve + volume keyframes).
  const s2 = await page.evaluate(() => {
    const { store, actions: A, model: M, sources: SR, render: R } = window.__velvix;
    const { getState, setState, update } = store;
    const o = {};
    update((d) => { d.clips = []; d.markers = []; d.transcript = null; d.tracks = d.tracks.filter((t) => t.main); });
    const media = getState().project.media;
    const v = A.addToTimeline(media.find((m) => m.name === 'clip1.mp4'));
    const a = A.addToTimeline(media.find((m) => m.name === 'voz.wav'), { at: 0 });
    const clip = (id) => getState().project.clips.find((c) => c.id === id);
    // #2 bullet curve: same duration and source span, slow in the middle, monotonic mapping.
    const dur0 = clip(v).duration;
    A.setCurve(v, M.SPEED_CURVES.bullet.pts);
    const c = clip(v), N = 200;
    const ts = Array.from({ length: N + 1 }, (_, i) => c.start + (c.duration * i) / N);
    const st = ts.map((t) => M.sourceTime(c, t, null));
    o.curve = { dur: [dur0, c.duration], end: st[N], span: c.in + c.duration * c.speed, mono: st.every((x, i) => !i || x > st[i - 1]),
      edge: M.speedAt(c, c.start + 0.05), mid: M.speedAt(c, c.start + c.duration / 2) };
    // #2 split in the middle of the curve: both halves reproduce the exact same mapping.
    setState({ time: 3.1, selection: [v] }); A.splitAtPlayhead();
    const halves = getState().project.clips.filter((x) => x.mediaId === c.mediaId).sort((x, y) => x.start - y.start);
    o.split = Math.max(...ts.map((t, i) => { const h = halves.find((x) => t >= x.start && t <= x.start + x.duration + 1e-9); return Math.abs(M.sourceTime(h, t, null) - st[i]); }));
    o.halves = halves.map((h) => +h.speed.toFixed(3) + '×' + h.curve.length);
    // #2 audio follows the curve: contiguous pieces covering the whole source span.
    A.setCurve(a, M.SPEED_CURVES.hero.pts);
    update((d) => { d.clips.forEach((x) => { if (x.type === 'video') x.muted = true; }); });
    const seg = SR.audioSegments(getState().project).find((s) => s.pieces);
    const ca = clip(a);
    o.pieces = { n: seg.pieces.length, src: seg.pieces.reduce((s, p) => s + p.srcDur, 0), span: ca.duration * ca.speed, dur: seg.pieces.reduce((s, p) => s + p.duration, 0), cd: ca.duration,
      gap: Math.max(...seg.pieces.slice(1).map((p, i) => Math.abs(p.in - (seg.pieces[i].in + seg.pieces[i].srcDur)))) };
    // #3 volume keyframes on the voice: silent until 2 s, full from 3 s (linear).
    setState({ selection: [a] });
    update((d) => { const x = d.clips.find((k) => k.id === a); x.kf = { volume: [{ t: 0, v: 0 }, { t: 2, v: 0, ease: 'linear' }, { t: 3, v: 1 }] }; });
    o.vol = [1, 2.5, 4].map((t) => +M.volumeAt(clip(a), t).toFixed(2));
    o.volSeg = JSON.stringify(SR.audioSegments(getState().project).find((s) => Array.isArray(s.volume)).volume.slice(0, 4));
    // #24 speeds up to 100×
    const t = A.addToTimeline(media.find((m) => m.name === 'clip2.mp4'), { at: 0, trackId: null });
    const span = clip(t).duration * clip(t).speed;
    A.setSpeed(t, 100); const d100 = clip(t).duration;
    A.setSpeed(t, 250); o.fast = { d100, expect: span / 100, clamped: clip(t).speed };
    update((d) => { d.clips = d.clips.filter((x) => x.id !== t); });
    // #3 filter keyframes: brightness −80 → +80 changes the rendered frame over time.
    const src = document.createElement('canvas'); src.width = 320; src.height = 180;
    const sx = src.getContext('2d'); sx.fillStyle = '#808080'; sx.fillRect(0, 0, 320, 180);
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180; const x = cv.getContext('2d');
    const k = M.newClip('video', { start: 0, duration: 4, filter: { ...M.DEFAULT_FILTER }, kf: { 'filter.brightness': [{ t: 0, v: -80 }, { t: 4, v: 80 }] } });
    const stats = (t) => { x.clearRect(0, 0, 320, 180); R.drawVisual(x, k, t, { el: src, w: 320, h: 180 }, 320, 180); const p = x.getImageData(0, 0, 320, 180).data; let s = 0, n = 0; for (let i = 0; i < p.length; i += 4) { s += p[i]; if (p[i + 3] > 128) n++; } return [Math.round(s / (p.length / 4)), n]; };
    o.filt = [stats(0)[0], stats(2)[0], stats(4)[0]];
    // #3 mask keyframes: circle mask width 20% → 100% grows the visible area.
    delete k.kf['filter.brightness'];
    k.mask = { ...k.mask, type: 'circle', w: 0.2, h: 0.6, feather: 0 };
    M.toggleKeyframe(k, 'mask.w', 0); M.setProp(k, 'mask.w', 0.2, 0); M.toggleKeyframe(k, 'mask.w', 4); M.setProp(k, 'mask.w', 1, 4);
    o.mask = [stats(0)[1], stats(4)[1], k.mask.w];
    // #3 easing curves: named presets and a custom cubic-bezier.
    const L = (ease) => +M.kfValue([{ t: 0, v: 0, ease }, { t: 1, v: 1 }], 0.5, 0).toFixed(3);
    o.ease = { linear: L('linear'), in: L('in'), out: L('out'), def: L(undefined), custom: L([0.9, 0, 0.9, 0.1]), back: +M.kfValue([{ t: 0, v: 0, ease: 'back' }, { t: 1, v: 1 }], 0.7, 0).toFixed(3) };
    setState({ time: 1, selection: [v] });
    return o;
  });
  console.log(JSON.stringify(s2, null, 1));
  check('#2 curva bala: misma duración y tramo de origen', Math.abs(s2.curve.dur[0] - s2.curve.dur[1]) < 1e-9 && Math.abs(s2.curve.end - s2.curve.span) < 1e-6, JSON.stringify(s2.curve));
  check('#2 curva bala: lenta en el centro, mapeo creciente', s2.curve.mono && s2.curve.mid < 0.2 * s2.curve.edge, s2.curve.mid.toFixed(2) + '× vs ' + s2.curve.edge.toFixed(2) + '×');
  check('#2 dividir un clip con curva conserva el mapeo', s2.split < 1e-6 && s2.halves.length === 2, s2.halves.join(' | ') + ' err ' + s2.split);
  check('#2 audio con curva: tramos contiguos que cubren todo', Math.abs(s2.pieces.src - s2.pieces.span) < 1e-6 && Math.abs(s2.pieces.dur - s2.pieces.cd) < 1e-6 && s2.pieces.gap < 1e-6, JSON.stringify(s2.pieces));
  check('#24 velocidad 100× (y tope en 100×)', Math.abs(s2.fast.d100 - s2.fast.expect) < 1e-6 && s2.fast.clamped === 100, JSON.stringify(s2.fast));
  check('#3 keyframes de volumen', s2.vol.join() === '0,0.5,1', s2.vol.join() + ' ' + s2.volSeg);
  check('#3 keyframes de filtro cambian el cuadro', s2.filt[0] < s2.filt[1] && s2.filt[1] < s2.filt[2], s2.filt.join(' → '));
  check('#3 keyframes de máscara', s2.mask[1] > s2.mask[0] * 3 && s2.mask[2] === 0.2, s2.mask.join(' / '));
  check('#3 curvas de easing', s2.ease.linear === 0.5 && s2.ease.in < 0.4 && s2.ease.out > 0.6 && s2.ease.def === 0.5 && s2.ease.custom < 0.2 && s2.ease.back > 1, JSON.stringify(s2.ease));

  // #2/#3 through the UI: curve preset button, curve editor, keyframe on a filter slider, easing editor.
  await page.click('.tabs button:has-text("Velocidad")');
  await page.click('.speed-curves button[data-curve="montage"]');
  await page.waitForSelector('.curve-svg');
  const ui1 = await page.evaluate(() => { const p = window.__velvix.store.getState().project; const c = p.clips.find((x) => x.id === window.__velvix.store.getState().selection[0]); return { pts: c.curve && c.curve.length, dots: document.querySelectorAll('.curve-pt').length }; });
  check('#2 curva desde el inspector', ui1.pts === 6 && ui1.dots === 6, JSON.stringify(ui1));
  await page.click('.tabs button:has-text("Ajustes")');
  await page.click('.kf-btn[data-kf="filter.contrast"]');
  await page.waitForSelector('.ease-svg');
  await page.click('.ease-presets button:has-text("Frenar")');
  const ui2 = await page.evaluate(() => { const s = window.__velvix.store.getState(); const c = s.project.clips.find((x) => x.id === s.selection[0]); return JSON.stringify(c.kf['filter.contrast']); });
  check('#3 keyframe de filtro y easing desde el inspector', /"ease":"out"/.test(ui2), ui2);
  await page.screenshot({ path: S + '/08-keyframes.png' });

  // Real export: curved video + curved voice with volume keyframes; audio and video match the timeline.
  const OUT3 = path.win32.normalize(path.join(S, 'out-speed.mp4'));
  await app.evaluate(({ dialog }, out) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: out }); }, OUT3);
  const durSp = await page.evaluate(() => Math.max(...window.__velvix.store.getState().project.clips.map((c) => c.start + c.duration)));
  await page.click('button.btn.primary:has-text("Exportar")');
  await page.waitForSelector('.export');
  await page.click('.export .btn.primary');
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(2000); const t = await page.evaluate(() => document.querySelector('.export')?.innerText || ''); if (/completa|fall/.test(t)) break; }
  await page.click('.export .btn:has-text("Listo")').catch(() => {});
  const sp = Object.fromEntries(probe(OUT3).map((l) => { const [k, d] = l.split(','); return [k, +d]; }));
  check('#2 export con curvas: video y audio con la duración del timeline', Math.abs(sp.video - Math.ceil(durSp * 30 - 1e-6) / 30) < 0.002 && Math.abs(sp.audio - durSp) < 0.05, `timeline ${durSp.toFixed(2)} s, video ${sp.video} s, audio ${sp.audio} s`);
  const meanDb = (ss, t) => +(/mean_volume: (-?[\d.]+)/.exec(require('child_process').spawnSync(require(APP + '/node_modules/ffmpeg-static'), ['-ss', String(ss), '-t', String(t), '-i', OUT3, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString()) || [0, -999])[1];
  const db = [meanDb(0.1, 1.7), meanDb(3.2, 2)];
  check('#3 export respeta los keyframes de volumen', db[0] < -60 && db[1] > -40, db.join(' dB → ') + ' dB');

  // Session 2 regressions with ramp.mp4: frame number coded in luma (left = n % 20, right = n / 20, 12·k+8)
  // and a chirp whose pitch gives the source time (300 Hz + 60 Hz/s).
  const FF = require(APP + '/node_modules/ffmpeg-static'), cp = require('child_process');
  const dec = (l, r) => { const y = (v) => (v * 219) / 255 + 16; return Math.round((y(r) - 13) / 12) * 20 + Math.round((y(l) - 13) / 12); };
  const exportTo = async (name) => {
    const out = path.win32.normalize(path.join(S, name));
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export'); await page.click('.export .btn.primary');
    let t = '';
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); t = await page.evaluate(() => document.querySelector('.export')?.innerText || ''); if (/completa|fall/.test(t)) break; }
    await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {});
    return /completa/.test(t) ? out : t.replace(/\s+/g, ' ');
  };
  const rv = await page.evaluate(async (files) => {
    const { actions: A, store, model: M } = window.__velvix;
    store.update((d) => { d.clips = []; d.tracks = d.tracks.filter((t) => t.main); d.background.type = 'black'; });
    const [ramp, gray] = await A.importPaths(files);
    const v = A.addToTimeline(ramp); A.setCurve(v, M.SPEED_CURVES.bullet.pts);
    return { v, gray: gray.id };
  }, ['ramp.mp4', 'gray.png'].map((f) => path.join(S, 'media', f)));
  const clipNow = () => page.evaluate((v) => window.__velvix.store.getState().project.clips.find((c) => c.id === v), rv.v);
  const srcAt = (c, t) => page.evaluate(([c, t]) => window.__velvix.model.sourceTime(c, t, null), [c, t]);
  // #2 slow-motion audio: in the 0.07× part the pitch still follows sourceTime (stretching per piece used to leave gaps).
  const c0 = await clipNow();
  const OUT4 = await exportTo('out-ramp.mp4');
  const pitch = (t) => {
    const raw = cp.execFileSync(FF, ['-v', 'error', '-ss', String(t - 0.1), '-t', '0.2', '-i', OUT4, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
    const a = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); let z = 0, f0 = -1, l = -1;
    for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) { z++; if (f0 < 0) f0 = i; l = i; }
    return z > 1 ? ((z - 1) * 48000) / (l - f0) : 0;
  };
  const au = [];
  for (const t of [1, 4, 4.6, 5.4, 7]) au.push([t, +((pitch(t) - 300) / 60).toFixed(3), +(await srcAt(c0, t)).toFixed(3)]);
  check('#2 audio en cámara lenta sigue la curva (sin huecos)', au.every(([, a, b]) => Math.abs(a - b) < 0.05), au.map(([t, a, b]) => `${t}s:${a}/${b}`).join(' '));
  // #24 preview above 16×: frames keep coming (seeking every animation frame used to leave the canvas black).
  await page.evaluate((v) => window.__velvix.actions.setCurve(v, null), rv.v);
  await page.evaluate((v) => window.__velvix.actions.setSpeed(v, 20), rv.v);
  await page.evaluate(() => window.__velvix.store.setState({ time: 0, playing: false }));
  await page.waitForTimeout(500);
  const fast = await page.evaluate(async () => {
    const { store } = window.__velvix, cv = document.querySelector('.stage canvas'), out = [];
    store.setState({ playing: true });
    await new Promise((res) => { const f = () => { const x = cv.getContext('2d'); out.push([x.getImageData(cv.width * 0.25, cv.height / 2, 1, 1).data[0], x.getImageData(cv.width * 0.75, cv.height / 2, 1, 1).data[0]]); if (store.getState().playing) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return out;
  });
  const shown = new Set(fast.slice(0, -1).map(([l, r]) => dec(l, r)));
  check('#24 preview a 20× muestra cuadros al reproducir', shown.size >= 5, [...shown].join(','));
  // #2 trimming a curved clip through the timeline handles cuts the curve: the kept frames don't change.
  await page.evaluate((v) => { window.__velvix.actions.setSpeed(v, 1); window.__velvix.actions.setCurve(v, window.__velvix.model.SPEED_CURVES.bullet.pts); window.__velvix.store.setState({ selection: [v] }); }, rv.v);
  const preTrim = await clipNow();
  const handle = async (side, dx) => { const h = await page.locator('.clip .trim.' + side).first().boundingBox(); await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2, { steps: 6 }); await page.mouse.up(); };
  const w = (await page.locator('.clip').first().boundingBox()).width;
  await page.keyboard.down('Alt'); await handle('r', -w * 0.3); await handle('l', w * 0.2); await page.keyboard.up('Alt');
  const postTrim = await clipNow();
  const trimErr = await page.evaluate(([b, a]) => {
    const M = window.__velvix.model; let lo = 0, hi = b.duration;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (M.sourceTime(b, b.start + m, null) < a.in) lo = m; else hi = m; } // left cut d: where the original reaches a.in
    return Math.max(...[0, 0.25, 0.5, 0.75, 1].map((u) => Math.abs(M.sourceTime(a, a.start + u * a.duration, null) - M.sourceTime(b, b.start + lo + u * a.duration, null))));
  }, [preTrim, postTrim]);
  check('#2 recortar bordes recorta la curva (mismos cuadros)', postTrim.duration < preTrim.duration * 0.6 && trimErr < 0.01, `${preTrim.duration.toFixed(2)} → ${postTrim.duration.toFixed(2)} s, err ${trimErr.toFixed(4)} s`);
  // #3 mask + filter keyframes on an image in the real export (images used to taint the canvas and fail the export).
  await page.evaluate((g) => {
    const { actions: A, store } = window.__velvix;
    store.update((d) => { d.clips = []; });
    const id = A.addToTimeline(store.getState().project.media.find((m) => m.id === g));
    store.update((d) => {
      const c = d.clips.find((x) => x.id === id); c.duration = 2; c.fit = 'stretch';
      c.mask = { ...c.mask, type: 'circle', w: 0.2, h: 0.4, feather: 0 };
      c.kf = { 'mask.w': [{ t: 0, v: 0.2, ease: 'linear' }, { t: 2, v: 1.6 }], 'filter.brightness': [{ t: 0, v: -60, ease: 'linear' }, { t: 2, v: 60 }] };
    });
  }, rv.gray);
  const OUT5 = await exportTo('out-mask.mp4');
  const lit = (t) => { const raw = cp.execFileSync(FF, ['-v', 'error', '-ss', String(t), '-i', OUT5, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']); let n = 0, s = 0; for (const v of raw) if (v > 20) { n++; s += v; } return [+(n / raw.length).toFixed(3), n ? Math.round(s / n) : 0]; };
  const mk = OUT5.endsWith('.mp4') ? [0.1, 1, 1.9].map(lit) : [];
  check('#3 export con imagen: keyframes de máscara y filtro', mk.length === 3 && mk[0][0] < mk[1][0] && mk[1][0] < mk[2][0] && mk[0][1] < mk[1][1] && mk[1][1] < mk[2][1], mk.length ? mk.map((x) => x.join('/')).join(' → ') : OUT5);

  // ---------- Sesión 3: audio con IA ----------
  // Generated test audio (e2e/gen): voice + synthetic music, noisy voice, 120 BPM click track, 50 Hz bed.
  const FF3 = require(APP + '/node_modules/ffmpeg-static'), cp3 = require('child_process'), GEN = path.join(S, 'gen');
  require('fs').mkdirSync(GEN, { recursive: true });
  const VOZ = path.join(S, 'media', 'voz.wav'), MUS = "0.12*sin(2*PI*110*t)+0.08*sin(2*PI*165*t)+0.06*sin(2*PI*220*t)+0.05*sin(2*PI*330*t)*(0.5+0.5*sin(2*PI*2*t))";
  const gen = (name, ...args) => { const f = path.join(GEN, name); cp3.execFileSync(FF3, ['-y', '-v', 'error', ...args, '-ar', '44100', f]); return f; };
  const musica = gen('musica.wav', '-f', 'lavfi', '-i', `aevalsrc=${MUS}:s=44100:d=11`, '-ac', '2');
  const mezcla = gen('mezcla.wav', '-i', VOZ, '-i', musica, '-filter_complex', '[0:a]aformat=sample_rates=44100:channel_layouts=stereo[v];[v][1:a]amix=inputs=2:normalize=0:duration=longest', '-ac', '2');
  const ruido = gen('voz-ruido.wav', '-i', VOZ, '-f', 'lavfi', '-i', 'anoisesrc=c=white:a=0.02:d=11:r=44100', '-filter_complex', '[0:a]aformat=sample_rates=44100:channel_layouts=mono[v];[v][1:a]amix=inputs=2:normalize=0:duration=first', '-ac', '1');
  const beat = gen('beat120.wav', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t-0.25,0.5),0.03),0.8*sin(2*PI*1000*t),0)':s=44100:d=8");
  const bed = gen('bed50.wav', '-f', 'lavfi', '-i', 'sine=f=50:d=11:r=44100,volume=0.5');
  const pcm = (f, ss, t) => { const raw = cp3.execFileSync(FF3, ['-v', 'error', '-ss', String(ss), '-t', String(t), '-i', f, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']); return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); };
  const corr = (a, b) => { const n = Math.min(a.length, b.length); let ab = 0, aa = 0, bb = 0; for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb || 1); };
  const rmsDb = (f, ss, t, af = 'anull') => +(/mean_volume: (-?[\d.]+)/.exec(cp3.spawnSync(FF3, ['-ss', String(ss), '-t', String(t), '-i', f, '-vn', '-af', af + ',volumedetect', '-f', 'null', '-']).stderr.toString()) || [0, -999])[1];

  const s3 = await page.evaluate(async (files) => {
    const { actions: A, store, audioai: AI, sources: SR } = window.__velvix;
    store.update((d) => { d.clips = []; d.markers = []; d.tracks = d.tracks.filter((t) => t.main); });
    const [mix, noisy, beat, bed, voz] = await A.importPaths(files);
    const o = {};
    // #15 isolate the voice of the mixed clip: two stems replace the original clip.
    const id = A.addToTimeline(mix, { at: 0 });
    const t0 = performance.now();
    const ids = await AI.isolateVoice(id, 'both');
    o.secs = Math.round((performance.now() - t0) / 100) / 10;
    const p = store.getState().project;
    o.stems = (ids || []).map((x) => { const c = p.clips.find((k) => k.id === x); return { name: c.name, path: p.media.find((m) => m.id === c.mediaId).path, start: c.start, dur: c.duration }; });
    o.origGone = !p.clips.some((c) => c.id === id);
    // #16 Mejorar voz: rendered through the same audio:fx path the inspector uses.
    o.enhanced = await window.api.audioFx(noisy.path, { voice: 'none', pitch: 0, denoise: false, normalize: false, bass: 0, treble: 0, enhance: true });
    // #5a beats on a 120 BPM click track (clicks at 0.25 + k·0.5 s).
    store.update((d) => { d.clips = []; d.markers = []; d.tracks = d.tracks.filter((t) => t.main); });
    const b = A.addToTimeline(beat, { at: 0 });
    o.beats = await AI.detectBeats(b);
    o.markers = store.getState().project.markers.filter((m) => m.beat).length;
    // Cut to the beat: two 3 s images on the main track end on beats.
    const img = store.getState().project.media.find((m) => m.type === 'image') || (await A.importPaths([files[5]]))[0];
    A.addToTimeline(img); A.addToTimeline(img);
    store.update((d) => { const m = d.tracks.find((t) => t.main); d.clips.filter((c) => c.trackId === m.id).forEach((c, i) => { c.duration = 2.9; c.start = i * 2.9; }); });
    o.cut = AI.cutToBeat(2);
    const main = store.getState().project.clips.filter((c) => store.getState().project.tracks.find((t) => t.id === c.trackId).main).sort((x, y) => x.start - y.start);
    o.mainEnds = main.map((c) => +(c.start + c.duration).toFixed(3));
    o.beatSet = store.getState().project.markers.filter((m) => m.beat).map((m) => m.t).sort((x, y) => x - y).filter((_, i) => i % 2 === 0);
    // #19 ducking: 50 Hz bed ducked by 15 dB under voz.wav.
    store.update((d) => { d.clips = []; d.markers = []; d.tracks = d.tracks.filter((t) => t.main); });
    A.addToTimeline(img); store.update((d) => { d.clips[0].duration = 11; });
    const bg = A.addToTimeline(bed, { at: 0 }), v = A.addToTimeline(voz, { at: 0 });
    store.update((d) => { d.clips.find((c) => c.id === bg).duck = 15; });
    o.duckSeg = SR.audioSegments(store.getState().project).map((s) => s.duck).join(',');
    for (let i = 0; i < 50 && !(SR.duckEnvelope(store.getState().project)[75] > 0); i++) await new Promise((r) => setTimeout(r, 100)); // peaks load async
    const pj = store.getState().project, bc = pj.clips.find((c) => c.id === bg);
    o.gain = [1.5, 6.6].map((t) => +SR.duckGain(pj, bc, t).toFixed(3));
    return o;
  }, [mezcla, ruido, beat, bed, VOZ, path.join(S, 'media', 'gray.png')]);
  console.log(JSON.stringify(s3, null, 1));
  const stem = Object.fromEntries((s3.stems || []).map((x) => [/voz/.test(x.name) ? 'voz' : 'musica', x.path]));
  const sep = stem.voz ? { vv: corr(pcm(stem.voz, 0, 11), pcm(VOZ, 0, 11)), vm: corr(pcm(stem.voz, 0, 11), pcm(musica, 0, 11)), mm: corr(pcm(stem.musica, 0, 11), pcm(musica, 0, 11)), mv: corr(pcm(stem.musica, 0, 11), pcm(VOZ, 0, 11)) } : {};
  check('#15 aislar voz: dos pistas (voz y música) en lugar del clip', s3.stems.length === 2 && s3.origGone && s3.stems.every((x) => x.start === 0 && Math.abs(x.dur - 11) < 0.05), s3.stems.map((x) => x.name).join(', ') + ` (${s3.secs} s)`);
  check('#15 la pista de voz es la voz y la de música es la música', sep.vv > 0.8 && sep.mm > 0.8 && sep.vm < 0.3 && sep.mv < 0.3, JSON.stringify(Object.fromEntries(Object.entries(sep).map(([k, x]) => [k, +x.toFixed(3)]))));
  const nz = [rmsDb(ruido, 2.65, 0.6), rmsDb(s3.enhanced, 2.65, 0.6), rmsDb(ruido, 0.3, 2), rmsDb(s3.enhanced, 0.3, 2)];
  check('#16 mejorar voz: quita el ruido en las pausas y conserva la voz', nz[1] < nz[0] - 15 && nz[3] > nz[2] - 6, `pausa ${nz[0]} → ${nz[1]} dB, voz ${nz[2]} → ${nz[3]} dB`);
  const offBeat = s3.beats.map((t) => Math.abs(((t - 0.25) / 0.5) - Math.round((t - 0.25) / 0.5)) * 0.5);
  check('#5a detectar ritmo: un marcador por beat (120 BPM)', s3.beats.length >= 14 && s3.beats.length <= 16 && s3.markers === s3.beats.length && Math.max(...offBeat) < 0.03, `${s3.beats.length} beats, error máx ${(Math.max(...offBeat) * 1000).toFixed(0)} ms`);
  check('#5a cortar al compás: los cortes caen en beats', s3.cut === 2 && s3.mainEnds.every((e) => s3.beatSet.some((b) => Math.abs(b - e) < 1e-3)), s3.mainEnds.join(', '));
  check('#19 ducking en preview: baja la música mientras hay voz', s3.duckSeg.includes('15') && s3.gain[0] < 0.25 && s3.gain[1] > 0.85, s3.gain.join(' / '));
  const OUT6 = await exportTo('out-duck.mp4');
  const low = 'bandpass=f=50:width_type=h:w=6,bandpass=f=50:width_type=h:w=6'; // only the bed (the voice has rumble/DC below 70 Hz)
  const dk = OUT6.endsWith('.mp4') ? [rmsDb(OUT6, 1.0, 1.2, low), rmsDb(OUT6, 6.35, 0.3, low)] : [];
  check('#19 ducking en export (sidechaincompress)', dk.length === 2 && dk[0] < dk[1] - 8, dk.length ? `con voz ${dk[0]} dB, sin voz ${dk[1]} dB` : OUT6);
  // #5a through the inspector's "Ritmo" section.
  await page.evaluate((f) => { const { actions: A, store } = window.__velvix; store.update((d) => { d.markers = []; }); const id = A.addToTimeline(store.getState().project.media.find((x) => x.path === f), { at: 0 }); store.setState({ selection: [id] }); }, beat);
  await page.click('.tabs button:has-text("Audio")').catch(() => {});
  await page.click('.beat-detect');
  await page.waitForFunction(() => document.querySelectorAll('.marker.beat').length > 0, null, { timeout: 30000 }).catch(() => {});
  const ui3 = await page.evaluate(() => ({ dom: document.querySelectorAll('.marker.beat').length, btn: document.querySelector('.beat-detect').innerText.trim() }));
  check('#5a detectar ritmo desde el inspector', ui3.dom >= 14 && /\(1[4-6] beats\)/.test(ui3.btn), JSON.stringify(ui3));
  // #9b neural TTS from the audio panel (MMS-TTS, downloads once).
  await page.click('.left-tabs button[title="Audio"]');
  await page.fill('.panel textarea', 'Hola, esto es una voz neuronal.');
  await page.selectOption('.panel select >> nth=0', 'neural');
  const nBefore = await page.evaluate(() => window.__velvix.store.getState().project.clips.length);
  await page.click('.tts-neural');
  const tts = await page.waitForFunction((n) => { const p = window.__velvix.store.getState().project; return p.clips.length > n && p.clips[p.clips.length - 1]; }, nBefore, { timeout: 180000 }).then((h) => h.jsonValue()).catch(() => null);
  const ttsPath = tts && await page.evaluate((c) => window.__velvix.store.getState().project.media.find((m) => m.id === c.mediaId).path, tts);
  const ttsDb = ttsPath ? rmsDb(ttsPath, 0, 1.5) : -999;
  check('#9b voz neuronal offline (MMS-TTS)', tts && tts.type === 'audio' && tts.duration > 1 && ttsDb > -35, tts ? `${tts.duration.toFixed(2)} s, ${ttsDb} dB` : 'sin clip');
  await page.screenshot({ path: S + '/09-audio-ai.png' });

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
