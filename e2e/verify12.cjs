// v1.20.0 in the real app: auto zoom while talking (transcript words → scale keyframes on the main-track clips).
// Usage: node e2e/verify12.cjs   (PKG=1 for the packaged app).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const APP = path.resolve(__dirname, '..');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };

(async () => {
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const [id] = await ev((f) => window.__velvix.actions.importPaths(f).then((l) => l.map((m) => m.id)), [path.join(__dirname, 'media', 'clip1.mp4')]);
  await page.waitForTimeout(800);
  // Fake transcript: "hola a todos. hoy hablamos de PRESUPUESTOS y 2026" — keyword at 3.0 s, phrase change at 1.6 s.
  await ev((id) => {
    const { actions, store } = window.__velvix;
    actions.addToTimeline(store.getState().project.media.find((m) => m.id === id));
    store.update((d) => {
      d.clips[0].duration = 6;
      d.transcript = { lang: 'es', words: [['hola', 0.2, 0.5], ['a', 0.5, 0.6], ['todos.', 0.6, 1.0], ['hoy', 1.6, 1.9], ['hablamos', 1.9, 2.4], ['de', 2.4, 2.6], ['PRESUPUESTOS', 3.0, 3.7], ['y', 3.8, 3.9], ['más', 3.9, 4.4]].map(([text, s, e]) => ({ text, s, e })) };
    });
  }, id);
  await page.click('.left-tabs button[title="Transcripción"]');
  await page.waitForTimeout(300);
  const btn = page.locator('button', { hasText: 'Aplicar zoom' });
  check('panel transcripción: botón de zoom automático', await btn.count() > 0);
  await btn.first().click();
  await page.waitForTimeout(300);
  const s = await ev(() => { const { store, model } = window.__velvix, c = store.getState().project.clips[0]; return { kf: c.kf.scale, at: [0.1, 1.0, 1.75, 3.2, 3.75, 4.3, 5.5].map((t) => +model.transformAt(c, t).scale.toFixed(3)) }; });
  check('keyframes de escala creados', s.kf && s.kf.length >= 4, JSON.stringify(s.kf));
  const [t01, t10, t17, t32, , , t55] = s.at;
  check('al inicio sin zoom', t01 === 1, String(t01));
  check('cambio de frase: acercamiento leve', t17 > 1.05 && t17 < 1.1, String(t17));
  check('palabra clave: acercamiento completo', Math.abs(t32 - 1.15) < 1e-3, String(t32));
  check('vuelve a bajar tras la palabra clave', s.at[5] < t32, JSON.stringify(s.at));
  check('al final sin zoom', t55 === 1 && t10 === 1, JSON.stringify(s.at));
  check('sin errores de página', !errors.length, errors.join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})();
