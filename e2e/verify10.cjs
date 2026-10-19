// v1.9.0 in the real app: effects linked to one clip / one track (on-off switch keeps the link), keyframe diamonds in the
// timeline (click parks the playhead on them, drag moves, Supr deletes), arrow cursor on clips, fullscreen button.
// Usage: node e2e/verify10.cjs   (PKG=1 for the packaged app).
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
  const fx = await ev(({ red, green }) => {
    const { actions, store } = window.__velvix, m = (id) => store.getState().project.media.find((x) => x.id === id);
    actions.addToTimeline(m(red));
    actions.addToTimeline(m(green), { at: 0 });
    store.update((d) => { for (const c of d.clips) c.duration = 6; d.clips.find((c) => c.mediaId === green).transform.scale = 0.5; });
    store.setState({ time: 0 }); actions.addEffect('bw');
    store.setState({ time: 0.1 }); // 'bw' is gray while floor(t*3) is even
    const s = store.getState().project;
    return { fx: s.clips.find((c) => c.type === 'effect').id, green: s.clips.find((c) => c.mediaId === green).id, main: s.tracks.find((t) => t.main).id };
  }, { red: ids[0], green: ids[1] });
  await page.waitForTimeout(500);
  const sat = () => ev(() => {
    const c = document.querySelector('.stage canvas'), x = c.getContext('2d');
    const at = (fx, fy) => { const d = x.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return Math.max(d[0], d[1], d[2]) - Math.min(d[0], d[1], d[2]); };
    return { center: at(0.5, 0.5), corner: at(0.08, 0.1) };
  });
  const setLink = (link) => ev(({ id, link }) => window.__velvix.store.update((d) => { d.clips.find((c) => c.id === id).link = link; }), { id: fx.fx, link });

  let s = await sat();
  check('sin enlace: el efecto grisa todo (como antes)', s.center < 8 && s.corner < 8, JSON.stringify(s));

  // Through the inspector: pick the green clip in «Aplicar a».
  await ev((id) => window.__velvix.store.setState({ selection: [id] }), fx.fx);
  await page.waitForSelector('.insp select');
  await page.locator('.insp select').first().selectOption('clip:' + fx.green);
  await page.waitForTimeout(500);
  s = await sat();
  check('enlazado al clip verde: solo ese se vuelve gris, el fondo conserva el rojo', s.center < 8 && s.corner > 150, JSON.stringify(s));

  await page.locator('.insp .switch').first().click();
  await page.waitForTimeout(400);
  s = await sat();
  check('desactivar el enlace: vuelve a afectar a todo (el enlace se conserva)', s.center < 8 && s.corner < 8 && (await ev((id) => window.__velvix.store.getState().project.clips.find((c) => c.id === id).link.id, fx.fx)) === fx.green, JSON.stringify(s));
  await page.locator('.insp .switch').first().click();
  await page.waitForTimeout(400);
  s = await sat();
  check('reactivar el enlace', s.center < 8 && s.corner > 150, JSON.stringify(s));

  await setLink({ kind: 'track', id: fx.main, on: true });
  await page.waitForTimeout(400);
  s = await sat();
  check('enlazado a la pista principal: el fondo se vuelve gris, la superposición conserva el verde', s.corner < 8 && s.center > 150, JSON.stringify(s));

  await ev((id) => window.__velvix.store.update((d) => { d.clips = d.clips.filter((c) => c.id !== id); }), fx.green);
  await setLink({ kind: 'clip', id: fx.green, on: true });
  await page.waitForTimeout(300);
  s = await sat();
  check('si el clip enlazado se borra, el efecto vuelve a afectar a todo', s.corner < 8, JSON.stringify(s));

  // ---------- fotogramas clave ----------
  const kfClip = await ev(() => {
    const { store, model } = window.__velvix, p = store.getState().project, c = p.clips.find((x) => x.type === 'image');
    store.update((d) => { const x = d.clips.find((y) => y.id === c.id); model.toggleKeyframe(x, 'x', x.start + 1, d.fps); model.toggleKeyframe(x, 'x', x.start + 3, d.fps); model.toggleKeyframe(x, 'scale', x.start + 3, d.fps); });
    store.setState({ selection: [c.id], time: 0 });
    return c.id;
  });
  await page.waitForSelector('.kf-dot');
  const kfs = () => ev((id) => { const c = window.__velvix.store.getState().project.clips.find((x) => x.id === id); return { x: c.kf.x.map((k) => +k.t.toFixed(3)), scale: (c.kf.scale || []).map((k) => +k.t.toFixed(3)), time: window.__velvix.store.getState().time }; }, kfClip);
  const dots = page.locator('.kf-dot');
  check('hay un rombo por instante con fotograma clave', (await dots.count()) === 2);
  await dots.nth(0).click();
  let k = await kfs();
  check('clic en el rombo deja el cursor exactamente en ese fotograma', Math.abs(k.time - 1) < 1e-6, JSON.stringify(k));
  const box = await dots.nth(1).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x - 40, box.y + 3, { steps: 6 }); await page.mouse.up();
  k = await kfs();
  check('arrastrar el rombo mueve todos los fotogramas de ese instante', k.x.length === 2 && k.x[1] < 2.8 && k.x[1] > 1 && k.x[1] === k.scale[0] && Math.abs(k.time - k.x[1]) < 1e-6, JSON.stringify(k));
  await page.keyboard.press('Delete');
  k = await kfs();
  check('Supr borra el fotograma clave seleccionado (y no el clip)', k.x.length === 1 && k.scale.length === 0 && (await ev((id) => !!window.__velvix.store.getState().project.clips.find((x) => x.id === id), kfClip)), JSON.stringify(k));
  await page.keyboard.press('Control+z');
  k = await kfs();
  check('deshacer devuelve el fotograma', k.x.length === 2, JSON.stringify(k));

  const cur = await ev(() => getComputedStyle(document.querySelector('.clip')).cursor);
  const dcur = await ev(() => getComputedStyle(document.querySelector('.kf-dot')).cursor);
  check('cursor: flecha sobre los clips, mano solo en los rombos', cur === 'default' && dcur === 'grab', `${cur} / ${dcur}`);

  // ---------- pantalla completa ----------
  await page.click('button[title="Pantalla completa"]');
  await page.waitForTimeout(800);
  const fs1 = await ev(() => ({ el: document.fullscreenElement && document.fullscreenElement.className, w: window.innerWidth }));
  check('el botón de pantalla completa pone la vista previa en pantalla completa', fs1.el && /stage-wrap/.test(fs1.el), JSON.stringify(fs1));
  await ev(() => document.exitFullscreen());
  await page.waitForTimeout(500);
  check('se sale de pantalla completa', !(await ev(() => document.fullscreenElement)));

  check('sin errores de página', errors.length === 0, errors.join(' | ').slice(0, 300));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
