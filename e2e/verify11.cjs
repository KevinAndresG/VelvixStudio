// v1.15.0 in the real app: entry transitions start AT the cut (nothing before it, previous clip held on its last frame),
// exit transitions, transitions on a clip that doesn't fill the frame end clean, Emojis tab separated from Stickers.
// Usage: node e2e/verify11.cjs   (PKG=1 for the packaged app).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), GEN = path.join(__dirname, 'gen');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const ff = (...a) => cp.execFileSync(FF, ['-y', '-v', 'error', ...a]);

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  const RED = path.join(GEN, 'mfx-red.png'), GREEN = path.join(GEN, 'mfx-green.png');
  if (!fs.existsSync(RED)) ff('-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', RED);
  if (!fs.existsSync(GREEN)) ff('-f', 'lavfi', '-i', 'color=c=0x00c000:s=640x360', '-frames:v', '1', GREEN);
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const ids = await ev((f) => window.__velvix.actions.importPaths(f).then((l) => l.map((m) => m.id)), [RED, GREEN]);
  await page.waitForTimeout(800);
  const green = await ev(({ red, green }) => {
    const { actions, store } = window.__velvix, m = (id) => store.getState().project.media.find((x) => x.id === id);
    actions.addToTimeline(m(red));
    actions.addToTimeline(m(green));
    store.update((d) => { let t = 0; for (const c of d.clips) { c.duration = 4; c.start = t; t += 4; } });
    const g = store.getState().project.clips.find((c) => c.mediaId === green);
    store.update((d) => { d.clips.find((c) => c.id === g.id).transition = { type: 'slideLeft', duration: 2 }; });
    return g.id;
  }, { red: ids[0], green: ids[1] });
  const px = async (time, fx, fy) => {
    await ev((t) => window.__velvix.store.setState({ time: t }), time);
    await page.waitForTimeout(250);
    return ev(({ fx, fy }) => {
      const c = document.querySelector('.stage canvas'), d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
      return [d[0], d[1], d[2]];
    }, { fx, fy });
  };
  const isRed = (c) => c[0] > 180 && c[1] < 60, isGreen = (c) => c[1] > 150 && c[0] < 60, isBlack = (c) => Math.max(...c) < 40;

  let a = await px(3.9, 0.9, 0.5);
  check('entrada 2 s: antes del corte no aparece nada del clip siguiente', isRed(a), JSON.stringify(a));
  a = await px(5, 0.1, 0.5); const b = await px(5, 0.9, 0.5);
  check('a mitad de la entrada: izquierda clip anterior congelado, derecha el nuevo', isRed(a) && isGreen(b), JSON.stringify([a, b]));
  a = await px(6.1, 0.1, 0.5);
  check('entrada terminada a los 2 s del corte', isGreen(a), JSON.stringify(a));

  // B a la mitad de tamaño (no llena el cuadro): al final del fundido no queda el rojo alrededor.
  await ev((id) => window.__velvix.store.update((d) => { const c = d.clips.find((x) => x.id === id); c.transform.scale = 0.5; c.transition = { type: 'fade', duration: 2 }; }), green);
  a = await px(5.96, 0.05, 0.05);
  check('fundido con clip pequeño: el anterior se desvanece del todo', a[0] < 30, JSON.stringify(a));
  await ev((id) => window.__velvix.store.update((d) => { const c = d.clips.find((x) => x.id === id); c.transition = { type: 'wipeLeft', duration: 2 }; }), green);
  a = await px(5.98, 0.05, 0.05);
  check('barrido con clip pequeño: no queda el anterior al final', a[0] < 30, JSON.stringify(a));

  // Salida: deslizar ← en el último segundo del verde.
  await ev((id) => window.__velvix.store.update((d) => { const c = d.clips.find((x) => x.id === id); c.transform.scale = 1; c.transitionOut = { type: 'slideLeft', duration: 1 }; }), green);
  a = await px(7.5, 0.1, 0.5); const r = await px(7.5, 0.9, 0.5);
  check('salida deslizar ←: a la mitad se ha ido a la izquierda', isGreen(a) && isBlack(r), JSON.stringify([a, r]));
  a = await px(6.9, 0.9, 0.5);
  check('salida: antes de su último segundo el clip está entero', isGreen(a), JSON.stringify(a));

  // Inspector: pestaña Transición con entrada y salida y miniaturas.
  await ev((id) => window.__velvix.store.setState({ selection: [id] }), green);
  await page.locator('.insp .tabs button', { hasText: 'Transición' }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const thumbs = await ev(() => document.querySelectorAll('.insp canvas.tr-thumb').length);
  check('inspector: cuadrícula de transiciones de entrada y salida', thumbs >= 40, String(thumbs));

  // Emojis aparte de Stickers.
  await page.locator('.left-tabs button[title="Stickers"]').click();
  const inStickers = await ev(() => document.querySelectorAll('.left-body .sticker-grid').length);
  await page.locator('.left-tabs button[title="Emojis"]').click();
  const nEmojis = await ev(() => document.querySelectorAll('.left-body .sticker-grid button').length);
  check('Stickers ya no mezcla emojis; pestaña Emojis con muchos', inStickers === 0 && nEmojis > 600, `${inStickers} / ${nEmojis}`);
  await page.locator('.left-body .sticker-grid button', { hasText: '💰' }).first().click();
  const emo = await ev(() => { const s = window.__velvix.store.getState(); return s.project.clips.find((c) => c.id === s.selection[0]); });
  check('agregar emoji 💰 crea un sticker', emo && emo.sticker && emo.text.content === '💰');
  const tabs = await ev(() => [...document.querySelectorAll('.insp .tabs button')].map((b) => b.textContent));
  check('inspector del emoji sin pestañas de texto', tabs.includes('Emoji') && !tabs.includes('Estilo'), tabs.join(','));

  check('sin errores de página', !errors.length, errors.join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})();
