const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const S = process.argv[2] || __dirname, APP = require('path').resolve(__dirname, '..');
(async () => {
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 400)); });
  await page.waitForSelector('.new-card'); await page.click('.new-card'); await page.waitForSelector('.editor');
  await page.evaluate(async (f) => { const { actions } = window.__velvix; const m = await actions.importPaths(f); actions.addToTimeline(m[0]); actions.addToTimeline(m[1], { at: 0 }); }, [path.join(S, 'media', 'clip1.mp4'), path.join(S, 'media', 'voz.wav')]);
  // Vocabulary is applied inside transcribe(): "test" (spoken in voz.wav) must come back as "PRUEBA".
  await page.evaluate(() => localStorage.setItem('vocab', 'test = PRUEBA'));
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
  const fails = [];
  const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
  const words = await page.evaluate(() => (window.__velvix.store.getState().project.transcript?.words || []).map((w) => w.text).join(' '));
  check('#20 vocabulario corregido al transcribir', /PRUEBA/.test(words) && /PRUEBA/.test(caps.join(' ')) && !/\btest\b/i.test(words), words);
  // Translation runs in the same worker right after Whisper used it.
  const tr = await page.evaluate(async () => { const ok = await window.__velvix.captions.translateCaptions('en', 'es'); return { ok, caps: window.__velvix.store.getState().project.clips.filter((c) => c.caption).map((c) => c.text.content).join(' | ') }; });
  check('#9a traducir tras transcribir (mismo worker)', tr.ok && /vídeo|video/i.test(tr.caps), tr.caps);
  await page.evaluate(() => localStorage.removeItem('vocab'));
  await app.close();
  if (fails.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
