// Edit responsiveness: a big project (150 clips) and 60 edits in a row, like dragging a slider.
// Prints ms per edit including React's re-render (measured to the next painted frame).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const APP = path.resolve(process.argv[2] || path.join(__dirname, '..'));
(async () => {
  const app = await _electron.launch({ executablePath: require(path.join(__dirname, '..', 'node_modules/electron')), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('.new-card', { timeout: 20000 });
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const files = ['clip1.mp4', 'clip2.mp4', 'voz.wav'].map((f) => path.join(__dirname, 'media', f));
  await page.evaluate(async (files) => {
    const { actions: A } = window.__velvix;
    const m = await A.importPaths(files);
    for (let i = 0; i < 50; i++) { A.addToTimeline(m[i % 2]); A.addToTimeline(m[2], { at: i * 3 }); A.addText({}, 'Texto ' + i); }
  }, files);
  await page.waitForTimeout(4000);
  const r = await page.evaluate(async () => {
    const { store } = window.__velvix, s = store.getState(), id = s.project.clips.find((c) => c.type === 'video').id;
    store.setState({ selection: [id] });
    const frame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    await frame();
    // Work per edit: the update plus React's synchronous re-render (flushed in a microtask), frames excluded.
    let work = 0;
    for (let i = 0; i < 60; i++) {
      const a = performance.now();
      store.update((p) => { p.clips.find((c) => c.id === id).transform.x = i / 100; }, 'drag');
      await Promise.resolve(); await Promise.resolve();
      work += performance.now() - a;
      await frame();
    }
    const per = work / 60;
    return { clips: store.getState().project.clips.length, msPerEdit: +per.toFixed(1), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
  });
  console.log(JSON.stringify({ ...r, errors }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
