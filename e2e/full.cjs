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
  console.log('ERRORS:', errors.join('\n'));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
