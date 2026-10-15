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
    // #12 ripple cut of the fillers: duration shrinks by exactly the removed time
    const p0 = getState().project, dur0 = Math.max(...p0.clips.map((c) => c.start + c.duration));
    o.removed = T.cutRanges(T.wordRanges(p0.transcript.words, T.fillerIndices(p0.transcript.words)), 'Muletillas');
    const p1 = getState().project, dur1 = Math.max(...p1.clips.map((c) => c.start + c.duration));
    o.dur = [dur0, dur1];
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
  const prev = await page.evaluate(() => ({ rows: document.querySelectorAll('.cut-row').length, btn: document.querySelector('.panel.transcript .btn.primary')?.innerText || '' }));
  check('#13 vista previa de lo que se borra', prev.rows > 0 && /Quitar \d+ tramos/.test(prev.btn), JSON.stringify(prev));
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

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'SESSION1 FAILS: ' + fails.join(', ') : 'SESSION1 ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
