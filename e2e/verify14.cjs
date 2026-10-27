// v1.22.0 in the real app: beat templates — photos fill slots cut on the song's beats (detected on the fly).
// Usage: node e2e/verify14.cjs   (PKG=1 for the packaged app).
const { _electron } = require('../node_modules/playwright-core');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const APP = path.resolve(__dirname, '..'), GEN = path.join(__dirname, 'gen');
const FF = require(APP + '/node_modules/ffmpeg-static');
const fails = [];
const check = (name, ok, info = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (info ? ' — ' + info : '')); if (!ok) fails.push(name); };
const gen = (name, ...a) => { const f = path.join(GEN, name); if (!fs.existsSync(f)) cp.execFileSync(FF, ['-y', '-v', 'error', ...a, f]); return f; };

(async () => {
  fs.mkdirSync(GEN, { recursive: true });
  const RED = gen('mfx-red.png', '-f', 'lavfi', '-i', 'color=c=red:s=640x360', '-frames:v', '1');
  const GREEN = gen('mfx-green.png', '-f', 'lavfi', '-i', 'color=c=0x00c000:s=640x360', '-frames:v', '1');
  // 120 BPM clicks: beats at 0.25 + 0.5 k.
  const BEAT = gen('beat120.wav', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t-0.25,0.5),0.03),0.8*sin(2*PI*1000*t),0)':s=44100:d=8");
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  await ev((f) => window.__velvix.actions.importPaths(f), [RED, GREEN, BEAT]);
  await page.waitForTimeout(800);
  const song = await ev((f) => { const { actions, store } = window.__velvix, id = actions.addToTimeline(store.getState().project.media.find((m) => m.path === f), { at: 0 }); store.setState({ selection: [id] }); return id; }, BEAT);
  await page.click('.tabs button:has-text("Audio")').catch(() => {});
  await page.click('.beat-template');
  await page.waitForFunction(() => { const { store } = window.__velvix, p = store.getState().project, m = p.tracks.find((t) => t.main); return p.clips.filter((c) => c.trackId === m.id).length > 5; }, null, { timeout: 30000 }).catch(() => {});
  const r = await ev(() => {
    const { store } = window.__velvix, p = store.getState().project, m = p.tracks.find((t) => t.main);
    const cl = p.clips.filter((c) => c.trackId === m.id).sort((a, b) => a.start - b.start);
    const name = (c) => p.media.find((x) => x.id === c.mediaId).name;
    return { n: cl.length, starts: cl.map((c) => +c.start.toFixed(3)), names: cl.slice(0, 4).map(name), kf: cl.every((c) => c.kf.scale && c.kf.scale.length === 2), beats: (p.markers || []).filter((x) => x.beat).length };
  });
  check('ritmo detectado al vuelo', r.beats >= 14, String(r.beats));
  check('huecos llenados: uno por beat', r.n >= 14 && r.n <= 17, String(r.n));
  const off = r.starts.slice(1).map((s) => Math.abs(((s - 0.25) / 0.5) - Math.round((s - 0.25) / 0.5)) * 0.5);
  check('cada corte cae en un beat (±40 ms)', r.starts[0] === 0 && Math.max(...off) < 0.04, JSON.stringify(r.starts.slice(0, 6)));
  check('fotos en orden y repetidas', /red/.test(r.names[0]) && /green/.test(r.names[1]) && /red/.test(r.names[2]), JSON.stringify(r.names));
  check('golpe de zoom en cada hueco', r.kf);
  // "Lento a rápido": 4,4,2,2,2,2,1… beats per slot.
  const b = await ev((id) => window.__velvix.audioai.fillBeatTemplate('build', id).then(() => {
    const { store } = window.__velvix, p = store.getState().project, m = p.tracks.find((t) => t.main);
    return p.clips.filter((c) => c.trackId === m.id).sort((a, b) => a.start - b.start).map((c) => ({ d: +c.duration.toFixed(2), tr: c.transition && c.transition.type }));
  }), song);
  const ds = b.map((x) => x.d);
  check('plantilla lento a rápido: huecos que se aceleran', Math.abs(ds[1] - 2) < 0.05 && Math.abs(ds[2] - 1) < 0.05 && Math.abs(ds[4] - 1) < 0.05 && ds[0] > ds[2], JSON.stringify(ds));
  check('transición en los huecos (no en el primero)', !b[0].tr && b.slice(1).every((x) => x.tr === 'zoomIn'), JSON.stringify(b.slice(0, 3)));
  check('sin errores de página', !errors.length, errors.join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})();
