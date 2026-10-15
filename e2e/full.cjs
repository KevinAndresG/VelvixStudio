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
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
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

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
