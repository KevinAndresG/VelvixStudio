// Screenshots for the website with real footage: node e2e/showcase.cjs <clipsDir> [outDir]
// clipsDir needs mar.webm, ciudad.webm, ave.webm, rio.webm (CC0 clips from Wikimedia Commons).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const APP = path.resolve(__dirname, '..');
const C = process.argv[2], OUT = process.argv[3] || path.join(__dirname, 'showcase');
require('fs').mkdirSync(OUT, { recursive: true });
const VOZ = 'Este verano me fui a la costa. El mar, la ciudad de noche y hasta un pajarito curioso. Todo editado gratis con Velvix Studio.';

(async () => {
  const app = await _electron.launch({ executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
  await page.waitForSelector('.new-card'); await page.click('.new-card'); await page.waitForSelector('.editor');
  const shot = async (name, t, sel = []) => {
    await page.evaluate(([t, sel]) => window.__velvix.store.setState({ time: t, selection: sel, playing: false }), [t, sel]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('shot', name);
  };
  const tab = (t) => page.click(`.left-tabs button[title="${t}"]`);

  // Four shots of ~4 s on the main track, a title and transitions.
  const ids = await page.evaluate(async (files) => {
    const { actions, store } = window.__velvix;
    const media = await actions.importPaths(files);
    await new Promise((r) => setTimeout(r, 1500));
    const ins = { mar: 1, ciudad: 4, ave: 2, rio: 1 };
    for (const m of media) actions.addToTimeline(m);
    store.update((p) => {
      let t = 0;
      for (const c of p.clips) {
        const k = Object.keys(ins).find((k) => c.name.startsWith(k));
        c.in = ins[k] || 0; c.duration = 4; c.start = t; t += 4;
      }
      p.name = 'Mi viaje a la costa';
    });
    return store.getState().project.clips.map((c) => c.id);
  }, ['mar', 'ciudad', 'ave', 'rio'].map((f) => path.join(C, f + '.webm')));
  await page.evaluate((ids) => {
    const { actions, store, model } = window.__velvix;
    for (const id of ids.slice(1)) { store.setState({ selection: [id] }); actions.applyTransition('fade', 0.6); }
    store.setState({ time: 0.3 });
    actions.addText(model.TEXT_PRESETS.find((p) => p.name === 'Sombra 3D') || {}, 'Mi viaje a la costa');
    const tx = store.getState().project.clips.find((c) => c.type === 'text');
    store.update((p) => { const c = p.clips.find((c) => c.id === tx.id); c.duration = 3.2; });
    // Color: warm sunset look on the city shot.
    store.update((p) => { const c = p.clips.find((c) => c.id === ids[1]); c.filter = { ...model.DEFAULT_FILTER, preset: 'tealorange', intensity: 80, gammaX: 0.25, gammaY: -0.15, gamma: 4, vignette: 25 }; });
  }, ids);

  // Neural voice-over from the Audio panel, then Spanish captions from it.
  await page.evaluate((v) => { window.__velvix.store.setState({ time: 0.5 }); return window.__velvix.audioai.neuralTTS(v, 'spa'); }, VOZ);
  await page.evaluate(() => localStorage.setItem('vocab', 'pararito = pajarito, evitado = editado, Bratis = gratis, Benvic = Velvix, Noche = noche, Curioso = curioso'));
  await page.evaluate(() => window.__velvix.captions.generateCaptions({ model: 'onnx-community/whisper-base', language: 'es', style: 16, emojis: true }));
  console.log(await page.evaluate(() => window.__velvix.store.getState().project.clips.filter((c) => c.caption).map((c) => c.text.content).join(' | ')));

  await tab('Medios'); await shot('editor', 1.6);
  await tab('Subtítulos'); await shot('subtitulos', 2.4);
  await tab('Transcripción'); await shot('transcripcion', 9.3);
  const voice = await page.evaluate(() => window.__velvix.store.getState().project.clips.find((c) => c.type === 'audio').id);
  await tab('Audio'); await shot('audio', 1.2, [voice]);
  await tab('Filtros'); await page.evaluate(() => {}); await shot('color-pre', 6, [ids[1]]);
  await page.click('.insp >> text="Color"').catch(() => console.log('no Color tab'));
  await shot('color', 6, [ids[1]]);
  await page.evaluate(() => localStorage.removeItem('vocab'));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
