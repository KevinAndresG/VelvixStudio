// v1.8 in the real app: Q / W delete left / right of the cursor, clicking elements in the preview selects the one
// drawn on top (also inside the box of the current selection) and drags it, the visual format picker, files dropped
// anywhere on the left panel, and captions that follow the voice (word timestamps + onsets from the audio energy,
// spoken language detection).
// Usage: node e2e/verify8.cjs   (PKG=1 for the packaged app). Uses the Windows voices (es-MX, en-US) and Whisper base.
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen'), MEDIA = path.join(S, 'media');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;

// Windows TTS sentence with a pause after the first phrase.
function say(voice, text, out) {
  if (fs.existsSync(out)) return;
  const ps = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${voice}'); $s.SetOutputToWaveFile('${out}'); $s.Speak('${text}'); $s.Dispose()`;
  cp.execFileSync('powershell.exe', ['-NoProfile', '-Command', ps]);
}
// Times (s) where the voice starts after at least 0.25 s of silence (10 ms frames, 16 kHz mono).
function onsets(file) {
  const raw = cp.execFileSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  const a = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), db = [];
  for (let i = 0; i + 160 <= a.length; i += 160) { let s = 0; for (let j = i; j < i + 160; j++) s += a[j] * a[j]; db.push(10 * Math.log10(s / 160 + 1e-10)); }
  const out = []; let quiet = 25;
  db.forEach((d, f) => { if (d > -40) { if (quiet >= 25) out.push(f / 100); quiet = 0; } else quiet++; });
  return out;
}

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  const ES = path.join(GEN, 'tts-es.wav'), EN = path.join(GEN, 'tts-en.wav');
  say('Microsoft Sabina Desktop', 'Buenos días a todos. Hoy vamos a editar un video corto juntos.', ES);
  say('Microsoft Zira Desktop', 'Good morning everyone. Today we are going to edit a short video together.', EN);

  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const clip = (id) => ev((id) => { const c = window.__velvix.store.getState().project.clips.find((x) => x.id === id); return c && { start: c.start, duration: c.duration, in: c.in, x: c.transform.x, y: c.transform.y }; }, id);
  const state = () => ev(() => { const s = window.__velvix.store.getState(); return { time: s.time, selection: s.selection, n: s.project.clips.length, aspect: s.project.aspect, w: s.project.width, h: s.project.height }; });

  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  await page.mouse.click(5, 300); // focus the page, not an input

  // ---------- Q / W ----------
  const [a, b] = await ev(async (files) => {
    const { actions } = window.__velvix;
    const m = await actions.importPaths(files);
    return [actions.addToTimeline(m[0]), actions.addToTimeline(m[1])];
  }, [path.join(MEDIA, 'clip1.mp4'), path.join(MEDIA, 'clip2.mp4')]);
  await ev(() => window.__velvix.store.setState({ time: 2, selection: [] }));
  await page.keyboard.press('q');
  let ca = await clip(a), cb = await clip(b), st = await state();
  check('Q borra a la izquierda del cursor en la pista principal y cierra el hueco', near(ca.start, 0) && near(ca.duration, 6) && near(ca.in, 2) && near(cb.start, 6) && near(st.time, 0), JSON.stringify({ ca, cb, time: st.time }));
  await ev(() => window.__velvix.store.setState({ time: 7.5, selection: [] }));
  await page.keyboard.press('w');
  cb = await clip(b);
  check('W borra a la derecha del cursor (clip bajo el cursor)', near(cb.start, 6) && near(cb.duration, 1.5) && near(cb.in, 0) && near((await state()).time, 7.5), JSON.stringify(cb));
  await page.keyboard.press('Control+z');
  cb = await clip(b);
  check('deshacer W restaura el clip', near(cb.duration, 6), JSON.stringify(cb));
  // Overlay text, selected: only it is trimmed and it stays in place (no ripple off the main track).
  await ev(() => { const { actions, store } = window.__velvix; store.setState({ time: 1 }); actions.addText({}, 'Prueba'); store.setState({ time: 2.5 }); });
  const txt = await ev(() => window.__velvix.store.getState().selection[0]);
  await page.keyboard.press('q');
  const ct = await clip(txt);
  ca = await clip(a);
  check('Q en un texto seleccionado lo recorta solo a él y no lo mueve', near(ct.start, 2.5) && near(ct.duration, 1.5) && near(ca.duration, 6) && (await state()).selection[0] === txt, JSON.stringify({ ct, ca }));
  await ev(() => window.__velvix.store.setState({ time: 3 }));
  await page.click('.tl-tools [title^="Borrar a la derecha"]');
  check('botón de la barra: borrar a la derecha', near((await clip(txt)).duration, 0.5), JSON.stringify(await clip(txt)));
  await page.keyboard.press('Control+z');

  // ---------- clic en la vista previa ----------
  const ov = await ev(async (f) => {
    const { actions, store } = window.__velvix;
    const [m] = await actions.importPaths([f]);
    const id = actions.addToTimeline(m, { at: 0 });
    store.update((p) => {
      const c = p.clips.find((x) => x.id === id); c.transform.scale = 0.35; c.transform.x = 0.25; c.transform.y = -0.2;
      const t = p.clips.find((x) => x.type === 'text'); t.transform.x = -0.25; t.transform.y = 0.3;
    });
    store.setState({ time: 2.7, selection: [] });
    return id;
  }, path.join(MEDIA, 'gray.png'));
  await page.waitForTimeout(600);
  const r = await page.locator('.stage').boundingBox();
  const at = (x, y) => [r.x + r.width / 2 + x * r.width, r.y + r.height / 2 + y * r.height];
  // Main video selected (as from the timeline): its box covers the whole frame.
  await ev((id) => window.__velvix.store.setState({ selection: [id] }), a);
  await page.waitForSelector('.sel-box');
  await page.mouse.click(...at(0.25, -0.2));
  check('clic sobre la superposición con el video de fondo seleccionado la selecciona a ella', (await state()).selection[0] === ov, JSON.stringify((await state()).selection));
  await page.mouse.click(...at(-0.25, 0.3));
  check('clic sobre el texto lo selecciona', (await state()).selection[0] === txt, JSON.stringify((await state()).selection));
  await page.mouse.click(...at(-0.35, -0.35));
  check('clic donde solo está el video principal lo selecciona', (await state()).selection[0] === a, JSON.stringify((await state()).selection));
  const x0 = (await clip(ov)).x;
  await page.mouse.click(...at(0.25, -0.2));
  check('un clic simple no mueve el elemento', near((await clip(ov)).x, x0), `${x0} → ${(await clip(ov)).x}`);
  // Press on the overlay while the main video is selected and drag at once.
  await ev((id) => window.__velvix.store.setState({ selection: [id] }), a);
  const [px, py] = at(0.25, -0.2);
  await page.mouse.move(px, py); await page.mouse.down();
  await page.mouse.move(px + 30, py, { steps: 3 }); await page.mouse.move(px + 60, py + 20, { steps: 3 }); await page.mouse.up();
  const co = await clip(ov);
  check('presionar y arrastrar mueve el elemento de arriba (no el fondo)', near(co.x, 0.25 + 60 / r.width, 0.01) && near((await clip(a)).x, 0) && (await state()).selection[0] === ov, JSON.stringify({ co, w: r.width }));
  await page.keyboard.press('Escape');

  // ---------- selector de formato ----------
  await page.click('.ap-trigger');
  await page.waitForSelector('.ap-menu');
  const opts = await ev(() => [...document.querySelectorAll('.ap-menu button')].map((b) => { const i = b.querySelector('i').getBoundingClientRect(); return { a: b.dataset.aspect, text: b.innerText.trim(), w: i.width, h: i.height }; }));
  const shapeOk = opts.length === 8 && opts.every((o) => o.text === o.a && near(o.w / o.h, eval(o.a.replace(':', '/')), 0.08));
  check('el menú de formato dibuja cada formato con su proporción y el texto dentro', shapeOk, JSON.stringify(opts));
  await page.click('.ap-menu button[data-aspect="9:16"]');
  st = await state();
  const trig = await page.locator('.ap-trigger').innerText();
  check('elegir 9:16 cambia el proyecto y cierra el menú', st.aspect === '9:16' && st.w === 1080 && st.h === 1920 && !(await page.$('.ap-menu')) && trig.includes('9:16'), JSON.stringify({ st, trig }));
  await page.click('.ap-trigger');
  await page.keyboard.press('Escape');
  check('Escape cierra el menú de formato', !(await page.$('.ap-menu')));
  await page.keyboard.press('Control+z');
  check('deshacer el formato', (await state()).aspect === '16:9');

  // ---------- soltar archivos en el panel izquierdo ----------
  // A real file from disk (through a file input) so the app can resolve its path, as with a drag from Explorer.
  await page.click('.left-tabs button[title="Texto"]');
  await ev(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'e2e-file'; i.style.display = 'none'; document.body.appendChild(i); });
  const PNG = path.join(GEN, 'drop-foto.png');
  if (!fs.existsSync(PNG)) cp.execFileSync(FF, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=320x180', '-frames:v', '1', PNG]);
  await page.setInputFiles('#e2e-file', PNG);
  const fire = (type) => ev((type) => {
    const left = document.querySelector('aside.left').getBoundingClientRect(), x = left.left + left.width * 0.6, y = left.bottom - 30;
    const dt = new DataTransfer(); dt.items.add(document.getElementById('e2e-file').files[0]);
    const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y });
    document.elementFromPoint(x, y).dispatchEvent(e);
    return e.defaultPrevented;
  }, type);
  const accepted = await fire('dragover');
  await page.waitForTimeout(100);
  const shown = !!(await page.$('.left-drop'));
  check('arrastrar archivos sobre la parte baja del panel se acepta (no sale bloqueado) y se resalta', accepted && shown, JSON.stringify({ accepted, shown }));
  await fire('drop');
  await page.waitForFunction(() => window.__velvix.store.getState().project.media.some((m) => m.name === 'drop-foto.png'), null, { timeout: 15000 }).catch(() => {});
  const tabNow = await ev(() => document.querySelector('.left-tabs button.active').title);
  const imported = await ev(() => window.__velvix.store.getState().project.media.some((m) => m.name === 'drop-foto.png'));
  check('al soltar se importa, se quita el resaltado y se abre Medios', imported && !(await page.$('.left-drop')) && tabNow === 'Medios', JSON.stringify({ imported, tabNow }));
  const internal = await ev(() => {
    const el = document.querySelector('.left-body');
    const dt = new DataTransfer(); dt.setData('velvix/media', 'x');
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }); el.dispatchEvent(over);
    return over.defaultPrevented;
  });
  check('arrastrar una tarjeta de medios propia no muestra la zona de importar', !internal && !(await page.$('.left-drop')));

  // ---------- subtítulos sincronizados con la voz ----------
  const runCaps = (f, language) => ev(async ({ f, language }) => {
    const { actions, captions: C, store } = window.__velvix;
    store.update((p) => { p.clips = []; p.transcript = null; });
    const [m] = await actions.importPaths([f]);
    actions.addToTimeline(m, { at: 0 });
    const ok = await C.generateCaptions({ model: 'onnx-community/whisper-base', language, style: 14 });
    const p = store.getState().project;
    return { ok, words: p.transcript.words, lines: p.clips.filter((c) => c.caption).map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text.content, w0: c.words[0].s })) };
  }, { f, language });
  const capES = await runCaps(ES, 'es');
  const on = onsets(ES);
  const text = capES.lines.map((l) => l.text).join(' ');
  const starts = capES.words.map((w) => w.s), steps = starts.slice(1).map((s, i) => +(s - starts[i]).toFixed(2));
  check('tiempos por palabra reales (no repartidos por frase)', capES.ok && capES.words.length >= 10 && new Set(steps).size > 4 && /vamos/i.test(text), JSON.stringify(capES.words.map((w) => [w.text, +w.s.toFixed(2)])));
  // Each phrase after a pause: its first word starts with the voice (±80 ms) and its line shows up to 0.15 s before.
  const phrases = on.map((t) => {
    const w = capES.words.find((x) => Math.abs(x.s - t) < 0.4), l = w && capES.lines.find((x) => Math.abs(x.start + x.w0 - w.s) < 1e-3);
    return { onset: t, word: w && +w.s.toFixed(2), line: l && +l.start.toFixed(2) };
  });
  check('cada frase empieza con la voz y su línea aparece justo antes', phrases.length >= 2 && phrases.every((x) => x.word != null && Math.abs(x.word - x.onset) <= 0.08 && x.line != null && x.line <= x.word + 1e-3 && x.word - x.line <= 0.15), JSON.stringify(phrases));
  check('las líneas no se solapan', capES.lines.every((l, i) => !i || l.start >= capES.lines[i - 1].end - 1e-3), JSON.stringify(capES.lines.map((l) => [+l.start.toFixed(2), +l.end.toFixed(2)])));
  const capAuto = await runCaps(ES, 'auto'), capEN = await runCaps(EN, 'auto');
  const tAuto = capAuto.lines.map((l) => l.text).join(' '), tEN = capEN.lines.map((l) => l.text).join(' ');
  check('«Detectar» reconoce el español (antes lo pasaba a inglés)', /vamos|días|todos/i.test(tAuto), tAuto);
  check('«Detectar» reconoce el inglés', /morning|today/i.test(tEN), tEN);

  console.log('ERRORS: ' + errors.filter((e) => !/Electron Security Warning|content-length|onnxruntime/i.test(e)).join(' | '));
  await app.close();
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  if (fails.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
