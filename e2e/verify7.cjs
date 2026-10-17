// Sesión 7 in the real app: project templates (built-in and saved by the user), animated call-to-action stickers,
// GIF / Lottie stickers with transparency, curved and 3D text, per-word styles and the CC0 music & sound library,
// plus how they work with earlier sessions (export = preview, transcript cuts, undo, .velvix packages).
// Usage: node e2e/verify7.cjs   (PKG=1 for the packaged app). Downloads one small CC0 sound from Wikimedia Commons.
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), S = __dirname, GEN = path.join(S, 'gen');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const ff = (...a) => cp.execFileSync(FF, ['-y', '-v', 'error', ...a], { maxBuffer: 1 << 28 });
const rgbAt = (f, t) => ff('-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'scale=32:18:flags=area', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');
const durOf = (f) => { const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(cp.spawnSync(FF, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr); return d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0; };
const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return +(d / a.length).toFixed(1); };
// Mean RGB of 32×18 blocks [x0, x1) × [y0, y1).
const region = (b, x0, x1, y0, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { for (let k = 0; k < 3; k++) s[k] += b[(y * 32 + x) * 3 + k]; n++; } return s.map((v) => +(v / n).toFixed(1)); };

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  // GIF with a transparent background: a 40 px red square moving right (x = 20 + 100·t), 10 frames of 0.1 s.
  const GIF = path.join(GEN, 'sticker.gif');
  if (!fs.existsSync(GIF)) ff('-f', 'lavfi', '-i', 'color=c=black@0.0:s=200x200:r=10:d=1,format=rgba', '-f', 'lavfi', '-i', 'color=c=red:s=40x40:r=10:d=1',
    '-filter_complex', "[0:v][1:v]overlay=x='20+t*100':y=80:format=auto,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128", '-gifflags', '-transdiff', GIF);
  // Lottie: 512×512, 30 fps, 1 s, green 100 px square moving linearly from x 56 to 456.
  const LOT = path.join(GEN, 'sticker-lottie.json');
  fs.writeFileSync(LOT, JSON.stringify({ v: '5.7.4', fr: 30, ip: 0, op: 30, w: 512, h: 512, nm: 'prueba', ddd: 0, assets: [], layers: [{ ddd: 0, ind: 1, ty: 4, nm: 'sq', sr: 1, ao: 0, ip: 0, op: 30, st: 0, bm: 0,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }, p: { a: 1, k: [{ t: 0, s: [56, 256, 0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } }, { t: 30, s: [456, 256, 0] }] } },
    shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [100, 100] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [0, 1, 0, 1] }, o: { a: 0, k: 100 } }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }] }] }));

  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const openDialog = (f) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, f);
  const exportUI = async (out) => {
    await app.evaluate(({ dialog }, o) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: o }); }, out);
    await page.click('button.btn.primary:has-text("Exportar")'); await page.waitForSelector('.export');
    await page.click('.export .btn.primary');
    let t = ''; for (let i = 0; i < 300 && !/completa|fall/.test(t); i++) { await page.waitForTimeout(1000); t = await ev(() => document.querySelector('.export')?.innerText || ''); }
    await page.click('.export .btn:has-text("Listo"), .export .btn:has-text("Volver")').catch(() => {});
    return /completa/.test(t);
  };
  const previewAt = async (t) => {
    await ev((t) => window.__velvix.store.setState({ time: t, playing: false }), t);
    await page.waitForTimeout(600);
    return ev(() => {
      const c = document.querySelector('.stage canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, o = new Array(32 * 18 * 3).fill(0), n = new Array(32 * 18).fill(0);
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const b = Math.floor((y * 18) / c.height) * 32 + Math.floor((x * 32) / c.width), i = (y * c.width + x) * 4; for (let k = 0; k < 3; k++) o[b * 3 + k] += d[i + k]; n[b]++; }
      return o.map((v, i) => v / n[Math.floor(i / 3)]);
    });
  };
  const leftTab = (name) => page.click(`.left-tabs button[title="${name}"]`);

  // ---------- #8 plantillas integradas en el inicio ----------
  await page.waitForSelector('.tpl[data-tpl="yt-intro"]');
  const thumbs = await ev(() => [...document.querySelectorAll('.tpl:not(.mine) canvas')].map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let v = 0; for (let i = 0; i < d.length; i += 4) v += Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]); return v / (d.length / 4); }));
  check('#8 plantillas: 8 integradas con su miniatura dibujada por el motor', thumbs.length === 8 && thumbs.every((v) => v > 2), thumbs.map((v) => v.toFixed(0)).join(' '));
  await page.click('.tpl[data-tpl="outro"]');
  await page.waitForSelector('.editor');
  const tp = await ev(() => { const p = window.__velvix.store.getState().project; return { aspect: p.aspect, n: p.clips.length, badges: p.clips.filter((c) => c.text && c.text.badge).length, curved: p.clips.filter((c) => c.text && c.text.curve).length, name: p.name }; });
  check('#8 nuevo proyecto desde plantilla (Despedida: 16:9, stickers y texto en arco)', tp.aspect === '16:9' && tp.badges === 3 && tp.curved === 1 && tp.n === 4, JSON.stringify(tp));
  // Edit it, save it as my template from the top bar, go home and create a project from it.
  await ev(() => window.__velvix.store.update((p) => { p.clips.find((c) => c.text && c.text.curve).text.content = 'Hasta pronto'; }));
  await page.click('.save-tpl'); await page.fill('.tpl-name', 'Mi despedida'); await page.click('.modal .btn.primary');
  await page.waitForTimeout(500);
  await page.click('.topbar .icon-btn[title="Volver a proyectos"]');
  await page.waitForSelector('.tpl.mine');
  const mine = await ev(() => [...document.querySelectorAll('.tpl.mine')].map((e) => e.innerText.replace(/\s+/g, ' ')));
  await page.click('.tpl.mine');
  await page.waitForSelector('.editor');
  const tp2 = await ev(() => { const p = window.__velvix.store.getState().project; return { n: p.clips.length, txt: p.clips.map((c) => c.text && c.text.content).filter(Boolean), tracksOk: p.clips.every((c) => p.tracks.some((t) => t.id === c.trackId)) }; });
  check('#8 guardar como plantilla y crear un proyecto con ella', mine.some((m) => /Mi despedida/.test(m)) && tp2.n === 4 && tp2.txt.includes('Hasta pronto') && tp2.tracksOk, JSON.stringify({ mine, tp2 }));
  await page.click('.topbar .icon-btn[title="Volver a proyectos"]');
  await page.waitForSelector('.tpl.mine');
  await ev(() => document.querySelector('.tpl.mine .tpl-del button').click());
  await page.waitForTimeout(400);
  check('#8 eliminar una plantilla propia', await ev(() => !document.querySelector('.tpl.mine')));

  // ---------- empty project for the rest ----------
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  await ev(() => window.__velvix.store.update((d) => { d.background = { type: 'color', color: '#2040c0', blur: 40 }; }));

  // ---------- #8 stickers animados (vectoriales) ----------
  await leftTab('Stickers');
  await page.waitForSelector('.badge-grid button[data-badge="subscribe"]');
  const thumbMove = await ev(async () => { const c = document.querySelector('.badge-grid button[data-badge="subscribe"] canvas'), a = c.toDataURL(); await new Promise((r) => setTimeout(r, 900)); return a !== c.toDataURL(); });
  check('#8 catálogo de stickers animados con vista previa en movimiento', (await ev(() => document.querySelectorAll('.badge-grid button').length)) === 9 && thumbMove);
  await ev(() => window.__velvix.store.setState({ time: 0 }));
  await page.click('.badge-grid button[data-badge="subscribe"]');
  const bid = await ev(() => window.__velvix.store.getState().selection[0]);
  // Badge sits in the lower third (y 0.3 → rows ~12–14), red YouTube button until the click at 1.0 s, gray after.
  const red = (b) => { const [r, g, bl] = region(b, 14, 19, 14, 15); return r - (g + bl) / 2; };
  const p06 = await previewAt(0.6), p16 = await previewAt(1.6);
  check('#8 sticker «Suscríbete»: rojo antes del clic y gris (SUSCRITO) después', red(p06) > 40 && red(p16) < 15, `rojo ${red(p06).toFixed(0)} → ${red(p16).toFixed(0)}`);
  const insp = await ev(() => [...document.querySelectorAll('.insp .tabs button, .insp [role=tab]')].map((b) => b.innerText).join(','));
  await page.click('.badge-themes button[data-theme="instagram"]');
  const theme = await ev((id) => window.__velvix.store.getState().project.clips.find((c) => c.id === id).text.badge.theme, bid);
  check('#8 inspector del sticker: pestaña Sticker y cambio de plataforma', /Sticker/.test(insp) && theme === 'instagram', insp + ' · ' + theme);
  await ev(() => window.__velvix.store.undo());
  // Bounds follow the button (selection box) and the sticker moves with motion keyframes like any text.
  const bb = await ev((id) => { const { store, render } = window.__velvix, p = store.getState().project, c = p.clips.find((x) => x.id === id), cv = document.createElement('canvas'); return render.textBounds(cv.getContext('2d'), c, 1, 1920, 1080); }, bid);
  check('#8 caja de selección del sticker con su tamaño real', bb.w > 300 && bb.w < 900 && bb.h > 60 && bb.h < 140 && Math.abs(bb.cy - 1080 * 0.8) < 5, JSON.stringify(bb));

  // ---------- #8 GIF y Lottie animados con transparencia ----------
  await openDialog(GIF);
  await page.click('.import-sticker');
  await page.waitForFunction(() => window.__velvix.store.getState().project.media.some((m) => m.anim && m.thumb), null, { timeout: 30000 });
  await openDialog(LOT);
  await ev(() => window.__velvix.store.setState({ time: 0 }));
  await page.click('.import-sticker');
  await page.waitForFunction(() => window.__velvix.store.getState().project.media.some((m) => m.lottie && m.thumb), null, { timeout: 30000 });
  const md = await ev(() => window.__velvix.store.getState().project.media.map((m) => ({ type: m.type, anim: !!m.anim, lottie: !!m.lottie, dur: +m.duration.toFixed(2), w: m.width, h: m.height })));
  check('#8 importar GIF transparente y Lottie como stickers animados', md.length === 2 && md[0].anim && md[0].type === 'image' && Math.abs(md[0].dur - 1) < 0.05 && md[1].lottie && md[1].dur === 1 && md[1].w === 512, JSON.stringify(md));
  // Both overlays at t 0 (placed at the playhead on overlay tracks); move them apart and shrink them.
  await ev(() => window.__velvix.store.update((p) => {
    const g = p.clips.find((c) => p.media.find((m) => m.id === c.mediaId && m.anim)), l = p.clips.find((c) => p.media.find((m) => m.id === c.mediaId && m.lottie));
    Object.assign(g, { start: 0, duration: 4 }); Object.assign(g.transform, { x: -0.3, y: -0.2, scale: 0.5 });
    Object.assign(l, { start: 0, duration: 4 }); Object.assign(l.transform, { x: 0.3, y: -0.2, scale: 0.5 });
  }));
  // Red square of the GIF (left half) and green square of the Lottie (right half), rows above the button sticker: centroid x moves with time.
  const cx = (b, ch, x0, x1) => { let s = 0, w = 0; for (let y = 0; y < 11; y++) for (let x = x0; x < x1; x++) { const i = (y * 32 + x) * 3, v = Math.max(0, b[i + ch] - (b[i] + b[i + 1] + b[i + 2] - b[i + ch]) / 2 - 20); s += v * x; w += v; } return w ? s / w : -1; };
  const a1 = await previewAt(0.05), a2 = await previewAt(0.75);
  const gif = [cx(a1, 0, 0, 16), cx(a2, 0, 0, 16)], lot = [cx(a1, 1, 16, 32), cx(a2, 1, 16, 32)];
  const bgKept = region(a1, 1, 3, 1, 3);
  check('#8 GIF: avanza con el tiempo y su fondo transparente deja ver el lienzo', gif[0] > 0 && gif[1] - gif[0] > 1 && bgKept[2] > 150 && bgKept[0] < 60, `x ${gif.map((v) => v.toFixed(1)).join(' → ')} · fondo ${bgKept}`);
  check('#8 Lottie: el cuadrado se mueve como en la animación', lot[0] > 0 && lot[1] - lot[0] > 1.5, `x ${lot.map((v) => v.toFixed(1)).join(' → ')}`);
  const loop = await previewAt(1.05);
  check('#8 GIF y Lottie se repiten en bucle', Math.abs(cx(loop, 0, 0, 16) - gif[0]) < 0.6 && Math.abs(cx(loop, 1, 16, 32) - lot[0]) < 0.6, `${cx(loop, 0, 0, 16).toFixed(1)} ${cx(loop, 1, 16, 32).toFixed(1)}`);

  // ---------- #8 texto curvo y 3D (render directo) ----------
  const tx = await ev(() => {
    const { render: R, model: M } = window.__velvix, cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const x = cv.getContext('2d', { willReadFrequently: true });
    const mk = (t) => { const c = M.newClip('text', { start: 0, duration: 3 }); c.text = { ...structuredClone(M.DEFAULT_TEXT), content: 'CURVA DE PRUEBA', shadow: { on: false }, ...t }; return c; };
    // Ink rows per third of the width: mean y of the ink in the left, middle and right thirds; bounding box.
    const ink = (c) => {
      x.clearRect(0, 0, 1920, 1080); R.drawText(x, c, 1, 1920, 1080);
      const d = x.getImageData(0, 0, 1920, 1080).data, th = [[0, 0], [0, 0], [0, 0]]; let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, sx = 0, sy = 0;
      for (let y = 0; y < 1080; y += 2) for (let X = 0; X < 1920; X += 2) if (d[(y * 1920 + X) * 4 + 3] > 128) { n++; sx += X; sy += y; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (let y = 0; y < 1080; y += 2) for (let X = 0; X < 1920; X += 2) if (d[(y * 1920 + X) * 4 + 3] > 128) { const k = Math.min(2, Math.floor(((X - x0) / (x1 - x0 + 1)) * 3)); th[k][0] += y; th[k][1]++; }
      return { n, w: x1 - x0, h: y1 - y0, cx: sx / n, cy: sy / n, rows: th.map(([s, m]) => s / m), b: R.textBounds(x, c, 1, 1920, 1080) };
    };
    return { flat: ink(mk({})), up: ink(mk({ curve: 60 })), down: ink(mk({ curve: -60 })), d3: ink(mk({ depth: { on: true, size: 20, angle: 45, color: '#ff0000', shade: true } })), d3c: ink(mk({ curve: 40, depth: { on: true, size: 20, angle: 90, color: '#ff0000' } })) };
  });
  const { flat, up, down, d3 } = tx;
  check('#8 texto curvo ∩: los extremos bajan y el centro sube', up.rows[0] - up.rows[1] > 40 && up.rows[2] - up.rows[1] > 40 && up.h > flat.h * 1.5, `filas ${up.rows.map((v) => v.toFixed(0))} · alto ${flat.h}→${up.h}`);
  check('#8 texto curvo ∪: los extremos suben', down.rows[1] - down.rows[0] > 40 && down.rows[1] - down.rows[2] > 40, `filas ${down.rows.map((v) => v.toFixed(0))}`);
  check('#8 caja de selección del texto curvo lo contiene', up.b.h >= up.h * 0.9 && up.b.w >= up.w * 0.9, `${up.b.w.toFixed(0)}×${up.b.h.toFixed(0)} vs tinta ${up.w}×${up.h}`);
  check('#8 texto 3D: volumen hacia abajo a la derecha (20 px a 45°)', d3.n > flat.n * 1.15 && d3.cx - flat.cx > 2 && d3.cy - flat.cy > 2 && Math.abs(d3.w - flat.w - 14) < 6, `tinta ${flat.n}→${d3.n}, centro +${(d3.cx - flat.cx).toFixed(1)},+${(d3.cy - flat.cy).toFixed(1)}, ancho +${d3.w - flat.w}`);
  check('#8 texto 3D sobre curva', tx.d3c.n > up.n && tx.d3c.h > 0, `${tx.d3c.n}`);

  // ---------- #8 estilos por palabra (UI) ----------
  await leftTab('Texto');
  await ev(() => window.__velvix.store.setState({ time: 0 }));
  await page.click('.left-body .btn.primary:has-text("Agregar texto")');
  const tid = await ev(() => window.__velvix.store.getState().selection[0]);
  await ev((id) => window.__velvix.store.update((p) => { const c = p.clips.find((x) => x.id === id); c.text.content = 'uno dos tres'; c.text.color = '#ffffff'; c.text.shadow = { on: false }; c.start = 5; c.duration = 3; }), tid);
  await ev(() => window.__velvix.store.setState({ time: 6 }));
  await page.waitForSelector('.word-chips button[data-word="1"]');
  await page.click('.word-chips button[data-word="1"]');
  await page.click('.word-chips + .row-btns .fmt:has-text("I")');
  await ev((id) => { const inp = document.querySelector('.word-chips + .row-btns input[type=color]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(inp, '#ff0000'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); }, tid);
  await page.waitForTimeout(300);
  const ws = await ev((id) => window.__velvix.store.getState().project.clips.find((c) => c.id === id).text.wordStyles, tid);
  // The clip as the renderer draws it: red ink only in the middle third («dos»), white ink on both sides.
  const wr = await ev((id) => { const { store, render: R } = window.__velvix, c = store.getState().project.clips.find((x) => x.id === id), cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; const x = cv.getContext('2d', { willReadFrequently: true }); R.drawText(x, c, 6, 1920, 1080); const d = x.getImageData(0, 0, 1920, 1080).data; let rs = 0, rn = 0, wx = []; for (let i = 0; i < d.length; i += 8) { if (d[i + 3] < 200) continue; const X = (i / 4) % 1920; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { rs += X; rn++; } else if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) wx.push(X); } return { red: rn, rcx: rn && rs / rn, wmin: Math.min(...wx), wmax: Math.max(...wx) }; }, tid);
  check('#8 estilo por palabra desde el inspector (color e itálica en «dos»)', ws && ws[1] && ws[1].italic === true && /^#ff0000$/i.test(ws[1].color || '') && wr.red > 500 && Math.abs(wr.rcx - 960) < 40 && wr.wmin < wr.rcx - 80 && wr.wmax > wr.rcx + 80, JSON.stringify({ ws, wr }));
  await ev(() => window.__velvix.store.undo());
  const wsUndo = await ev((id) => window.__velvix.store.getState().project.clips.find((c) => c.id === id).text.wordStyles, tid);
  check('#8 deshacer un estilo por palabra', wsUndo && wsUndo[1] && !wsUndo[1].color && wsUndo[1].italic, JSON.stringify(wsUndo));
  // Transcript cut before a styled word: the style stays on the same word (Sesión 1 integration).
  const cut = await ev(() => {
    const { transcript: T, model: M } = window.__velvix;
    const p = { clips: [], tracks: [{ id: 'm', kind: 'video', main: true }, { id: 't', kind: 'text' }], media: [], markers: [] };
    const c = M.newClip('text', { start: 10, duration: 3, trackId: 't', caption: true });
    c.text = { ...structuredClone(M.DEFAULT_TEXT), content: 'hola a todos amigos', wordStyles: { 2: { color: '#ff0000' }, 3: { bold: false } } };
    c.words = [{ text: 'hola', s: 0, e: 0.5 }, { text: 'a', s: 0.6, e: 0.8 }, { text: 'todos', s: 0.9, e: 1.5 }, { text: 'amigos', s: 1.6, e: 2.2 }];
    p.clips.push(c);
    T.rippleDelete(p, [[10.55, 10.85]]);
    return p.clips[0].text;
  });
  check('#8 + #12 cortar por transcripción conserva el estilo en su palabra', cut.content === 'hola todos amigos' && cut.wordStyles[1] && cut.wordStyles[1].color === '#ff0000' && cut.wordStyles[2] && cut.wordStyles[2].bold === false && !cut.wordStyles[3], JSON.stringify(cut.wordStyles));

  // ---------- #25 biblioteca CC0 ----------
  await leftTab('Biblioteca');
  await page.waitForSelector('.lib-row');
  const libInfo = await ev(() => ({ music: document.querySelectorAll('.lib-row').length, all: document.querySelector('.lib-all')?.innerText }));
  await page.click('.library .seg button:has-text("Efectos")');
  await ev(() => window.__velvix.store.setState({ time: 0 }));
  await page.click('.lib-row[data-lib="s-whoosh"] .icon-btn[title="Agregar en el cursor"]');
  await page.waitForFunction(() => window.__velvix.store.getState().project.media.some((m) => /lib-whoosh/.test(m.path)), null, { timeout: 20000 });
  await page.click('.lib-row[data-lib="c-computer_mouse_single_click"] .icon-btn[title="Agregar en el cursor"]');
  await page.waitForFunction(() => window.__velvix.store.getState().project.media.some((m) => /computer_mouse/.test(m.path)), null, { timeout: 60000 }).catch(() => {});
  const lib = await ev(() => window.__velvix.store.getState().project.media.filter((m) => m.type === 'audio').map((m) => ({ path: m.path, dur: +m.duration.toFixed(2) })));
  const libClips = await ev(() => window.__velvix.store.getState().project.clips.filter((c) => c.type === 'audio').length);
  check('#25 biblioteca: música por categorías y descarga completa disponible', libInfo.music === 30 && /84 MB/.test(libInfo.all || ''), JSON.stringify(libInfo));
  check('#25 efecto generado (whoosh, CC0 propio) agregado al cursor', lib.some((m) => /lib-whoosh/.test(m.path) && Math.abs(m.dur - 0.8) < 0.05), JSON.stringify(lib));
  check('#25 sonido CC0 descargado de Wikimedia Commons y agregado', lib.some((m) => /library[\\/]c-computer_mouse_single_click\.ogg$/.test(m.path) && m.dur > 0.1) && libClips === 2, JSON.stringify(lib));
  const okMark = await ev(() => !!document.querySelector('.lib-row[data-lib="c-computer_mouse_single_click"] .lib-ok'));
  const blocked = await ev(() => window.api.libraryGet({ id: 'x', url: 'https://example.com/a.mp3', ext: 'mp3' }).then(() => 'descargó', (e) => e.message));
  check('#25 marca de disponible sin internet; solo descarga de Wikimedia Commons', okMark && /no permitido/.test(blocked), blocked);
  const peaks = await ev(async () => { const m = window.__velvix.store.getState().project.media.find((x) => /lib-whoosh/.test(x.path)); const p = await window.api.peaks(m.path); return Math.max(...p); });
  check("#25 el whoosh generado tiene sonido", peaks > 0.1, String(peaks));

  // ---------- export = preview with everything (stickers, GIF, Lottie, 3D/curved text, library audio) ----------
  await ev(() => window.__velvix.store.update((p) => {
    const t = p.clips.find((c) => c.type === 'text' && !c.text.badge);
    Object.assign(t, { start: 0, duration: 4 }); t.text.content = 'TEXTO 3D CURVO'; t.text.curve = 35; t.text.depth = { on: true, size: 16, angle: 60, color: '#ffd000', shade: true }; t.transform.y = -0.38;
  }));
  const OUT = path.join(S, 'out-s7.mp4');
  const okExp = await exportUI(OUT);
  const ex = [0.6, 1.6, 2.75].map((t) => [...rgbAt(OUT, t)]);
  const pv = [];
  for (const t of [0.6, 1.6, 2.75]) pv.push(await previewAt(t));
  const ds = ex.map((e, i) => diff(e, pv[i]));
  check('exportación con stickers, GIF, Lottie, texto 3D curvo y audio de la biblioteca = vista previa', okExp && ds.every((d) => d < 8) && durOf(OUT) > 3.9 && /Audio:/.test(cp.spawnSync(FF, ['-hide_banner', '-i', OUT], { encoding: 'utf8' }).stderr), `dif ${ds.join(' ')} · ${durOf(OUT).toFixed(2)} s`);

  // ---------- .velvix package keeps GIF, Lottie and library files ----------
  const pid = await ev(async () => { await window.__velvix.store.flushSave?.(); return window.__velvix.store.getState().project.id; });
  await page.waitForTimeout(1200);
  const PKGF = path.join(GEN, 's7.velvix');
  const pk = await ev(async ({ pid, PKGF }) => { await window.api.exportPackage(pid, PKGF); const id = await window.api.importPackage(PKGF); const p = await window.api.loadProject(id); return Promise.all(p.media.map(async (m) => ({ name: m.name, ok: await window.api.fileExists(m.path), anim: !!(m.anim || m.lottie) }))); }, { pid, PKGF });
  check('paquete .velvix con GIF, Lottie y sonidos de la biblioteca', pk.length === 4 && pk.every((m) => m.ok) && pk.filter((m) => m.anim).length === 2, JSON.stringify(pk));

  console.log('ERRORS:', errors.join('\n'));
  console.log(fails.length ? 'FAILS: ' + fails.join(', ') : 'ALL OK');
  await app.close();
  if (fails.length || errors.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
