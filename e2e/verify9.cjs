// v1.8.1 in the real app (also run at the end of full.cjs): media cards are selected with a click (Ctrl / Shift for several) and Supr removes them like
// the trash button, the Medios grid shows several columns, and both side panels can be resized by dragging their edge.
// Usage: node e2e/verify9.cjs   (PKG=1 for the packaged app).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const APP = path.resolve(__dirname, '..'), S = __dirname, MEDIA = path.join(S, 'media');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };

(async () => {
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const st = () => ev(() => { const s = window.__velvix.store.getState(); return { media: s.project.media.length, clips: s.project.clips.length, mediaSel: s.mediaSel, selection: s.selection }; });

  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  const ids = await ev(async (files) => {
    const { actions } = window.__velvix;
    const m = await actions.importPaths(files);
    actions.addToTimeline(m[0]);
    return m.map((x) => x.id);
  }, ['clip1.mp4', 'clip2.mp4', 'gray.png', 'ramp.mp4'].map((f) => path.join(MEDIA, f)));
  await page.waitForSelector('.media-card');

  // ---------- grid ----------
  const tops = await ev(() => [...document.querySelectorAll('.media-card')].map((e) => Math.round(e.getBoundingClientRect().top)));
  const perRow = tops.filter((t) => t === tops[0]).length;
  check('la cuadrícula de Medios muestra 3 o más columnas', perRow >= 3, `${perRow} por fila`);

  // ---------- select + Supr ----------
  const cards = page.locator('.media-card');
  await cards.nth(2).click(); // gray.png, unused
  let s = await st();
  check('clic selecciona el archivo', s.mediaSel.length === 1 && s.mediaSel[0] === ids[2] && (await cards.nth(2).getAttribute('class')).includes('selected'), JSON.stringify(s.mediaSel));
  await page.keyboard.press('Delete');
  s = await st();
  check('Supr elimina el archivo no usado sin preguntar', s.media === 3 && !s.mediaSel.length, JSON.stringify(s));
  await page.keyboard.press('Control+z');
  check('Ctrl+Z lo restaura', (await st()).media === 4);

  await cards.nth(1).click();
  await cards.nth(3).click({ modifiers: ['Shift'] });
  s = await st();
  check('Shift+clic selecciona un rango', s.mediaSel.length === 3, JSON.stringify(s.mediaSel));
  await cards.nth(2).click({ modifiers: ['Control'] });
  s = await st();
  check('Ctrl+clic quita uno de la selección', s.mediaSel.length === 2 && !s.mediaSel.includes(ids[2]), JSON.stringify(s.mediaSel));
  await page.keyboard.press('Escape');
  check('Esc limpia la selección', !(await st()).mediaSel.length);

  // Used media: Supr asks first, like the trash button.
  await cards.nth(0).click();
  await page.keyboard.press('Delete');
  await page.waitForSelector('.confirm-remove-media');
  check('Supr en un archivo usado pide confirmación', (await st()).media === 4);
  await page.click('.confirm-remove-media');
  s = await st();
  check('al confirmar se eliminan el archivo y sus clips', s.media === 3 && s.clips === 0, JSON.stringify(s));
  await page.keyboard.press('Control+z');

  // Selecting a clip moves Supr back to the timeline.
  await cards.nth(1).click();
  const clipId = await ev(() => window.__velvix.store.getState().project.clips[0].id);
  await ev((id) => window.__velvix.store.setState({ selection: [id] }), clipId);
  s = await st();
  check('seleccionar un clip limpia la selección de medios', !s.mediaSel.length);
  await page.keyboard.press('Delete');
  s = await st();
  check('Supr con un clip seleccionado borra el clip, no el archivo', s.clips === 0 && s.media === 4, JSON.stringify(s));

  // ---------- side panels ----------
  const w = (sel) => ev((sel) => document.querySelector(sel).offsetWidth, sel);
  const drag = async (sel, dx) => {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + 1, b.y + 200); await page.mouse.down();
    await page.mouse.move(b.x + 1 + dx, b.y + 200, { steps: 6 }); await page.mouse.up();
  };
  const l0 = await w('.left'), r0 = await w('.right');
  await drag('.side-resize.sr-left', 150);
  const l1 = await w('.left');
  check('arrastrar el borde agranda el panel izquierdo', Math.abs(l1 - l0 - 150) <= 3, `${l0} → ${l1}`);
  const perRow2 = await ev(() => { const t = [...document.querySelectorAll('.media-card')].map((e) => Math.round(e.getBoundingClientRect().top)); return t.filter((x) => x === t[0]).length; });
  check('con el panel más ancho caben más columnas', perRow2 > perRow, `${perRow} → ${perRow2}`);
  await drag('.side-resize.sr-right', -120);
  const r1 = await w('.right');
  check('arrastrar el borde agranda el panel derecho', Math.abs(r1 - r0 - 120) <= 3, `${r0} → ${r1}`);
  const saved = await ev(() => [localStorage.getItem('leftWidth'), localStorage.getItem('rightWidth')]);
  check('los anchos se guardan', +saved[0] === l1 && +saved[1] === r1, JSON.stringify(saved));
  await page.locator('.side-resize.sr-left').dblclick({ position: { x: 0, y: 200 }, force: true });
  await page.locator('.side-resize.sr-right').dblclick({ position: { x: 0, y: 200 }, force: true });
  check('doble clic restablece el ancho', (await w('.left')) === l0 && (await w('.right')) === r0);
  await drag('.side-resize.sr-left', 2000);
  check('el panel no se come la vista previa', (await w('.preview')) >= 300, `preview ${await w('.preview')}px`);
  await page.screenshot({ path: path.join(S, '11-media-grid.png') });
  await page.locator('.side-resize.sr-left').dblclick({ position: { x: 0, y: 200 }, force: true });

  console.log('ERRORS: ' + errors.filter((e) => !/Electron Security Warning|content-length|onnxruntime/i.test(e)).join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLOS` : '\nTodo OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
