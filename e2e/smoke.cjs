// Smoke test: launch app, create project, import, edit, screenshot.
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const S = process.argv[2] || __dirname, APP = require('path').resolve(__dirname, '..');
(async () => {
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card', { timeout: 20000 });
  await page.setViewportSize({ width: 1600, height: 950 }).catch(() => {});
  await page.screenshot({ path: S + '/01-home.png' });
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const files = ['clip1.mp4', 'clip2.mp4', 'greenscreen_mpeg4.avi', 'voz.wav'].map((f) => path.join(S, 'media', f));
  await page.evaluate(async (files) => {
    const { actions } = window.__velvix;
    const media = await actions.importPaths(files);
    actions.addToTimeline(media[0]);
    actions.addToTimeline(media[1]);
    actions.addToTimeline(media[3], { at: 1 });
    window.__velvix.store.setState({ time: 2 });
    actions.addText({}, 'Hola Velvix');
  }, files);
  await page.waitForTimeout(6000); // thumbnails, proxy
  await page.screenshot({ path: S + '/02-editor.png' });
  const st = await page.evaluate(() => { const s = window.__velvix.store.getState(); return { clips: s.project.clips.length, media: s.project.media.map((m) => [m.name, m.type, m.vcodec, !!m.proxy, !!m.strip]), tracks: s.project.tracks.map((t) => t.kind), jobs: s.jobs }; });
  console.log(JSON.stringify(st));
  console.log('ERRORS:\n' + errors.join('\n'));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
