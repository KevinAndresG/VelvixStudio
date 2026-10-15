const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const S = process.argv[2] || __dirname, APP = require('path').resolve(__dirname, '..');
(async () => {
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 400)); });
  await page.waitForSelector('.new-card'); await page.click('.new-card'); await page.waitForSelector('.editor');
  await page.evaluate(async (f) => { const { actions } = window.__velvix; const m = await actions.importPaths(f); actions.addToTimeline(m[0]); actions.addToTimeline(m[1], { at: 0 }); }, [path.join(S, 'media', 'clip1.mp4'), path.join(S, 'media', 'voz.wav')]);
  await page.click('.left-tabs button[title="Subtítulos"]');
  await page.selectOption('.panel select >> nth=0', 'en');
  await page.selectOption('.panel select >> nth=1', 'onnx-community/whisper-base');
  const t0 = Date.now();
  await page.click('.panel .btn.primary');
  let last = '';
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(2000);
    const j = await page.evaluate(() => { const s = window.__velvix.store.getState(); return { jobs: Object.values(s.jobs).map((j) => j.label + ' ' + (j.progress != null ? Math.round(j.progress * 100) : '')), caps: s.project.clips.filter((c) => c.caption).length, toast: s.toast && s.toast.msg }; });
    const line = JSON.stringify(j); if (line !== last) { console.log(Math.round((Date.now() - t0) / 1000) + 's', line); last = line; }
    if (j.caps > 0 && !j.jobs.length) break;
    if (j.toast && /Error/.test(j.toast)) break;
  }
  const caps = await page.evaluate(() => window.__velvix.store.getState().project.clips.filter((c) => c.caption).map((c) => `${c.start.toFixed(2)}-${(c.start + c.duration).toFixed(2)} ${c.text.content}`));
  console.log(caps.join('\n'));
  await page.evaluate(() => window.__velvix.store.setState({ time: 3, selection: [] }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: S + '/06-captions.png' });
  await app.close();
})();
