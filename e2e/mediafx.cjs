// v1.7.1 in the real app: deleting media from the project (unused right away, used ones ask and take their clips,
// "remove unused", audio list, undo) and dragging one effect to its own track between other tracks with the mouse
// (the rest of the effects row stays; the effect then only changes what is below it).
// Usage: node e2e/mediafx.cjs   (PKG=1 for the packaged app).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen'), MEDIA = path.join(S, 'media');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const ff = (...a) => cp.execFileSync(FF, ['-y', '-v', 'error', ...a], { maxBuffer: 1 << 28 });

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  const RED = path.join(GEN, 'mfx-red.png'), GREEN = path.join(GEN, 'mfx-green.png');
  if (!fs.existsSync(RED)) ff('-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1', RED);
  if (!fs.existsSync(GREEN)) ff('-f', 'lavfi', '-i', 'color=c=0x00c000:s=640x360', '-frames:v', '1', GREEN);

  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const proj = () => ev(() => { const p = window.__velvix.store.getState().project; return { media: p.media.map((m) => m.name), clips: p.clips.map((c) => ({ id: c.id, type: c.type, name: c.name, trackId: c.trackId, start: c.start })), tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, main: t.main })) }; });
  const card = (name) => page.locator('.media-card', { has: page.locator('.mc-name', { hasText: name }) });
  const importAll = (files) => ev((f) => window.__velvix.actions.importPaths(f).then((l) => l.map((m) => m.id)), files);

  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');

  // ---------- eliminar multimedia ----------
  const [id1] = await importAll([path.join(MEDIA, 'clip1.mp4'), path.join(MEDIA, 'clip2.mp4'), path.join(MEDIA, 'voz.wav')]);
  await ev((id) => window.__velvix.actions.addToTimeline(window.__velvix.store.getState().project.media.find((m) => m.id === id)), id1);
  await page.waitForTimeout(400);

  await card('clip2.mp4').hover();
  await card('clip2.mp4').locator('.mc-del').click();
  await page.waitForTimeout(300);
  let p = await proj();
  check('eliminar un medio no usado (sin preguntar)', !p.media.includes('clip2.mp4') && p.media.length === 2 && !(await page.$('.modal')), JSON.stringify(p.media));

  await card('clip1.mp4').hover();
  await card('clip1.mp4').locator('.mc-del').click();
  await page.waitForSelector('.modal');
  const msg = await ev(() => document.querySelector('.modal').innerText);
  await page.click('.modal .btn:has-text("Cancelar")');
  p = await proj();
  check('un medio usado pide confirmación y Cancelar no cambia nada', /1 clip/.test(msg) && p.media.includes('clip1.mp4') && p.clips.length === 1, msg.replace(/\s+/g, ' ').slice(0, 120));

  await card('clip1.mp4').hover();
  await card('clip1.mp4').locator('.mc-del').click();
  await page.click('.modal .confirm-remove-media');
  await page.waitForTimeout(300);
  p = await proj();
  check('confirmar elimina el medio y sus clips de la línea de tiempo', !p.media.includes('clip1.mp4') && p.clips.length === 0 && p.tracks.length === 1, JSON.stringify(p));

  await page.click('.preview, .stage').catch(() => {});
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  p = await proj();
  check('Ctrl+Z recupera el medio y su clip', p.media.includes('clip1.mp4') && p.clips.length === 1, JSON.stringify(p.media));

  // Text-to-speech style leftovers: two unused files → "Eliminar los no usados".
  await importAll([path.join(MEDIA, 'clip2.mp4')]);
  await page.waitForSelector('.remove-unused');
  const label = await ev(() => document.querySelector('.remove-unused').innerText);
  await page.click('.remove-unused');
  await page.waitForTimeout(300);
  p = await proj();
  check('«Eliminar los no usados» quita solo los que no están en la línea de tiempo', /\(2\)/.test(label) && JSON.stringify(p.media) === '["clip1.mp4"]' && p.clips.length === 1 && !(await page.$('.remove-unused')), `${label} · ${JSON.stringify(p.media)}`);

  await importAll([path.join(MEDIA, 'voz.wav')]);
  await page.click('.left-tabs button[title="Audio"]');
  await page.waitForSelector('.audio-row');
  await page.click('.audio-row .ar-del');
  await page.waitForTimeout(300);
  p = await proj();
  check('eliminar audio desde la pestaña Audio', !p.media.includes('voz.wav') && !(await page.$('.audio-row')), JSON.stringify(p.media));
  await page.click('.left-tabs button[title="Medios"]');

  // ---------- mover un efecto a su propia pista ----------
  // Main: red photo. Overlay: green photo at half size in the middle. Two B&W effects back to back on one effects row.
  await ev(() => window.__velvix.store.update((d) => { d.clips = []; d.tracks = d.tracks.filter((t) => t.main); }));
  const [red, green] = await importAll([RED, GREEN]);
  await page.waitForTimeout(800);
  await ev(({ red, green }) => {
    const { actions, store } = window.__velvix, m = (id) => store.getState().project.media.find((x) => x.id === id);
    actions.addToTimeline(m(red));
    actions.addToTimeline(m(green), { at: 0 });
    store.update((d) => { for (const c of d.clips) c.duration = 6; const g = d.clips.find((c) => c.mediaId === green); g.transform.scale = 0.5; });
    store.setState({ time: 0 }); actions.addEffect('bw');
    store.setState({ time: 3 }); actions.addEffect('bw');
    store.setState({ time: 0.1, selection: [], zoom: 80 }); // 'bw' blinks: gray while floor(t·3) is even
  }, { red, green });
  await page.waitForTimeout(600);
  p = await proj();
  const fxTrack = p.clips.find((c) => c.type === 'effect').trackId;
  check('dos efectos en la misma fila de efectos, arriba de todo', p.tracks.length === 3 && p.tracks[0].kind === 'effect' && p.clips.filter((c) => c.trackId === fxTrack).length === 2, JSON.stringify(p.tracks.map((t) => t.kind)));

  // Saturation of the preview at the center (overlay) and a corner (main), 0 = gray.
  const sat = () => ev(() => {
    const c = document.querySelector('.stage canvas'), x = c.getContext('2d');
    const at = (fx, fy) => { const d = x.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return Math.max(d[0], d[1], d[2]) - Math.min(d[0], d[1], d[2]); };
    return { center: at(0.5, 0.5), corner: at(0.08, 0.1) };
  });
  const s0 = await sat();
  check('el efecto arriba de todo pone en blanco y negro la foto principal y la superposición', s0.center < 20 && s0.corner < 20, JSON.stringify(s0));

  // Drag the first effect down onto the lower half of the overlay row: a new effects row between overlay and main.
  const fx = page.locator('.track .clip.c-effect').first();
  const b = await fx.boundingBox();
  const rows = await page.locator('.tracks > .track').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: r.y, h: r.height }; }));
  const ov = rows[1];
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + ((ov.y + ov.h * 0.75) - (b.y + b.height / 2)) * (i / 10));
  const hint = !!(await page.$('.new-track-hint'));
  await page.mouse.up();
  await page.waitForTimeout(500);
  p = await proj();
  const kinds = p.tracks.map((t) => t.kind).join(',');
  const moved = p.clips.find((c) => c.type === 'effect' && Math.abs(c.start) < 0.05), stayed = p.clips.find((c) => c.type === 'effect' && Math.abs(c.start - 3) < 0.05);
  check('arrastrar un solo efecto crea una fila nueva entre la superposición y la principal (el otro efecto no se mueve)',
    hint && kinds === 'effect,video,effect,video' && moved && moved.trackId === p.tracks[2].id && stayed && stayed.trackId === p.tracks[0].id, `${kinds} · guía ${hint}`);

  await ev(() => window.__velvix.store.setState({ time: 0.1, selection: [] }));
  await page.waitForTimeout(500);
  const s1 = await sat();
  check('ahora el efecto solo cambia lo que está debajo: la principal en gris, la superposición conserva su color', s1.center > 100 && s1.corner < 20, JSON.stringify(s1));

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  p = await proj();
  check('deshacer devuelve el efecto a su fila', p.tracks.map((t) => t.kind).join(',') === 'effect,video,video' && p.clips.filter((c) => c.type === 'effect').every((c) => c.trackId === p.tracks[0].id));
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(300);

  // Drag it back up into the middle of the first effects row: it joins that row and the empty row disappears.
  const rows2 = await page.locator('.tracks > .track').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: r.y, h: r.height }; }));
  const fx2 = page.locator('.tracks > .track').nth(2).locator('.clip.c-effect');
  const b2 = await fx2.boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2 + ((rows2[0].y + rows2[0].h / 2) - (b2.y + b2.height / 2)) * (i / 10));
  await page.mouse.up();
  await page.waitForTimeout(500);
  p = await proj();
  check('arrastrarlo al centro de otra fila de efectos lo une a ella y la fila vacía se quita', p.tracks.map((t) => t.kind).join(',') === 'effect,video,video' && p.clips.filter((c) => c.type === 'effect').every((c) => c.trackId === p.tracks[0].id), p.tracks.map((t) => t.kind).join(','));

  // A text clip dropped above everything gets its own new row at the top.
  await ev(() => { window.__velvix.store.setState({ time: 0 }); window.__velvix.actions.addText(); });
  await page.waitForTimeout(400);
  const rows3 = await page.locator('.tracks > .track').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { y: r.y, h: r.height }; }));
  const tx = await page.locator('.clip.c-text').boundingBox();
  await page.mouse.move(tx.x + tx.width / 2, tx.y + tx.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(tx.x + tx.width / 2, tx.y + tx.height / 2 + ((rows3[0].y + 3) - (tx.y + tx.height / 2)) * (i / 10));
  await page.mouse.up();
  await page.waitForTimeout(400);
  p = await proj();
  check('un texto arrastrado al borde superior de la fila de efectos queda en una fila nueva arriba (los efectos ya no le afectan)', p.tracks.map((t) => t.kind).join(',') === 'text,effect,video,video', p.tracks.map((t) => t.kind).join(','));

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
