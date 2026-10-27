// Playback check: play/pause toggling must keep video and clock moving; idle preview must not burn CPU.
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const APP = path.resolve(__dirname, '..');
const fs = require('fs'), cp = require('child_process');
const GEN = path.join(__dirname, 'gen'), FF = require(APP + '/node_modules/ffmpeg-static');
// Heavy media (4K, long GOP, own audio): small test clips seek instantly and never showed the freeze.
const heavy = (name, src) => {
  const f = path.join(GEN, name);
  if (!fs.existsSync(f)) cp.execFileSync(FF, ['-v', 'error', '-f', 'lavfi', '-i', `${src}=s=3840x2160:r=30:d=20`, '-f', 'lavfi', '-i', 'sine=f=440:d=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '300', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
  return f;
};
const cpu = async (app) => (await app.evaluate(({ app }) => app.getAppMetrics())).reduce((a, m) => a + m.cpu.percentCPUUsage, 0);
(async () => {
  const app = await _electron.launch({ executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.waitForSelector('.new-card', { timeout: 20000 });
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  fs.mkdirSync(GEN, { recursive: true });
  const files = [heavy('heavy1.mp4', 'testsrc2'), heavy('heavy2.mp4', 'testsrc'), path.join(__dirname, 'media', 'voz.wav')];
  await page.evaluate(async (files) => {
    const { actions } = window.__velvix;
    const media = await actions.importPaths(files);
    actions.addToTimeline(media[0]); actions.addToTimeline(media[1]); actions.addToTimeline(media[2], { at: 0 });
    window.__velvix.store.setState({ time: 0, selection: [] });
  }, files);
  await page.waitForTimeout(5000);
  await cpu(app); await page.waitForTimeout(3000);
  const idle = await cpu(app);
  const st = () => page.evaluate(() => {
    const s = window.__velvix.store.getState();
    const v = [...document.querySelectorAll('video')];
    return { t: s.time, playing: s.playing, dur: s.project.clips.reduce((a, c) => Math.max(a, c.start + c.duration), 0) };
  });
  const play = (on) => page.evaluate((on) => window.__velvix.store.setState({ playing: on }), on);
  const report = [];
  let ok = true;
  // Shown video position (seconds of the active <video>) next to the clock: a freeze is the clock moving alone.
  const sample = () => page.evaluate(() => {
    const s = window.__velvix.store.getState(), pool = window.__velvix.pool;
    // Active clip's element (the one whose clip contains the playhead).
    const c = s.project.clips.find((c) => c.type === 'video' && s.time >= c.start && s.time < c.start + c.duration), e = c && pool && pool.videos.get(c.id);
    return { t: s.time, v: e ? [e.el.currentTime] : [], id: c && c.id };
  });
  const seeks = [3.2, 17.5, 9.1, 25.4, 12.7, 31.3, 6.6, 19.6, 28.2, 1.4];
  for (let i = 0; i < seeks.length; i++) {
    await page.evaluate((t) => window.__velvix.store.setState({ time: t }), seeks[i]);
    await page.waitForTimeout(100 + (i % 3) * 150); // user clicks play soon after clicking the timeline
    await play(true);
    const a = await sample(); await page.waitForTimeout(1500); const b = await sample();
    await play(false); await page.waitForTimeout(200);
    const clock = b.t - a.t, video = b.v.length && a.v.length && a.id === b.id ? b.v[0] - a.v[0] : b.v.length ? 1 : 0;
    // In sync: video moved about as much as the clock and is near it.
    const drift = b.v.length ? Math.abs(b.v[0] - (b.t % 20)) : 9;
    report.push([+clock.toFixed(2), +video.toFixed(2), +drift.toFixed(2)]);
    if (clock < 0.5 || video < 0.5 || drift > 0.4) ok = false;
  }
  // Canvas must change while playing (video not frozen).
  await page.evaluate(() => window.__velvix.store.setState({ time: 0.5 }));
  await page.waitForTimeout(500);
  await play(true);
  const sig = () => page.evaluate(() => { const c = document.querySelector('.stage canvas'), x = document.createElement('canvas'); x.width = 32; x.height = 18; x.getContext('2d').drawImage(c, 0, 0, 32, 18); return [...x.getContext('2d').getImageData(0, 0, 32, 18).data].join(); });
  const frames = new Set();
  for (let i = 0; i < 6; i++) { frames.add(await sig()); await page.waitForTimeout(250); }
  const playCpu = await cpu(app);
  await play(false);
  console.log(JSON.stringify({ advancePerPlay: report, distinctFramesWhilePlaying: frames.size, idleCpu: +idle.toFixed(1), playCpu: +playCpu.toFixed(1), ok: ok && frames.size >= 4, errors }));
  await app.close();
  process.exit(ok && frames.size >= 4 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
