// v1.23.0 in the real app: multicam — three takes of the same scene, started at different moments, synced by
// audio cross-correlation and cut between; a cut switches camera by hand keeping the moment.
// Usage: node e2e/verify15.cjs   (PKG=1 for the packaged app).
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
  // Scene: pink noise with an irregular loudness pattern, 16 s.
  const SCENE = path.join(GEN, 'mc-escena.wav');
  if (!fs.existsSync(SCENE)) ff('-f', 'lavfi', '-i', 'anoisesrc=d=16:c=pink:seed=7:a=0.5', '-af', "volume='0.08+0.9*gt(sin(t*2.3)+sin(t*5.1+1)+sin(t*0.7),1)':eval=frame", '-ar', '44100', SCENE);
  // Cam 1 records 0–12 s, cam 2 starts 1.37 s later (quieter), cam 3 starts 0.6 s earlier (silence before).
  const cam = (name, color, af) => { const f = path.join(GEN, name); if (!fs.existsSync(f)) ff('-f', 'lavfi', '-i', `color=c=${color}:s=320x240:r=30:d=12`, '-i', SCENE, '-filter_complex', `[1:a]${af},atrim=0:12,asetpts=PTS-STARTPTS[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f); return f; };
  const A = cam('mc-cam1.mp4', 'red', 'anull'), B = cam('mc-cam2.mp4', 'green', 'atrim=start=1.37,asetpts=PTS-STARTPTS,volume=0.4'), C = cam('mc-cam3.mp4', 'blue', 'adelay=600,volume=1.5');
  const app = await _electron.launch(process.env.PKG ? { executablePath: APP + '/release/win-unpacked/Velvix Studio.exe', args: [] } : { executablePath: require(APP + '/node_modules/electron'), args: [APP], cwd: APP });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForSelector('.new-card');
  await page.click('.new-card');
  await page.waitForSelector('.editor');
  await ev((f) => window.__velvix.actions.importPaths(f), [A, B, C]);
  await page.waitForTimeout(1000);
  await ev(() => { const { actions, store } = window.__velvix, p = store.getState().project; const ids = p.media.map((m) => actions.addToTimeline(m)); store.setState({ selection: ids }); });
  await page.click('.insp .tabs button:has-text("IA")');
  await page.click('.mc-sync');
  await page.waitForFunction(() => window.__velvix.store.getState().project.clips.some((c) => c.multicam), null, { timeout: 30000 }).catch(() => {});
  const r = await ev(() => {
    const { store } = window.__velvix, p = store.getState().project, m = p.tracks.find((t) => t.main);
    const cuts = p.clips.filter((c) => c.trackId === m.id).sort((a, b) => a.start - b.start);
    const g = cuts[0] && cuts[0].multicam;
    return { n: cuts.length, cams: [...new Set(cuts.map((c) => c.multicam && c.multicam.angle))], offsets: g ? g.angles.map((a) => +a.offset.toFixed(3)) : [],
      // Scene time shown at each cut start: source time + camera's start in the scene (0, 1.37, -0.6).
      scene: cuts.map((c) => +(c.in + [0, 1.37, -0.6][c.multicam.angle] - (c.start - cuts[0].start)).toFixed(3)),
      audio: p.clips.filter((c) => c.type === 'audio').map((c) => ({ in: +c.in.toFixed(3), d: +c.duration.toFixed(2) })), det: cuts.every((c) => c.detached), first: cuts[0] && cuts[0].id };
  });
  // Shared span starts at scene 1.37 s (cam 2's start): offsets = source time of each cam there.
  check('tomas sincronizadas por audio (±20 ms)', Math.abs(r.offsets[0] - 1.37) < 0.02 && Math.abs(r.offsets[1] - 0) < 0.02 && Math.abs(r.offsets[2] - 1.97) < 0.02, JSON.stringify(r.offsets));
  check('cortes entre las 3 cámaras', r.n >= 3 && r.cams.length === 3, JSON.stringify(r));
  check('cada corte muestra el mismo momento de la escena', r.scene.every((s) => Math.abs(s - r.scene[0]) < 0.03), JSON.stringify(r.scene));
  check('queda una sola pista de audio continua (cámara 1)', r.audio.length === 1 && Math.abs(r.audio[0].in - 1.37) < 0.02 && r.det, JSON.stringify(r.audio));
  // Switch the first cut to camera 3 from the inspector.
  await ev((id) => window.__velvix.store.setState({ selection: [id] }), r.first);
  await page.waitForTimeout(200);
  await page.click('.insp .tabs button:has-text("IA")');
  await page.click('.mc-angles button:has-text("Cámara 3")');
  const s = await ev((id) => { const { store } = window.__velvix, p = store.getState().project, c = p.clips.find((x) => x.id === id); return { angle: c.multicam.angle, in: +c.in.toFixed(3), media: p.media.find((m) => m.id === c.mediaId).name }; }, r.first);
  check('cambiar la cámara de un corte a mano', s.angle === 2 && /cam3/.test(s.media) && Math.abs(s.in - r.offsets[2]) < 0.02, JSON.stringify(s));
  // Preview shows blue (cam 3) at the start of the sequence.
  await ev(() => window.__velvix.store.setState({ time: 0.5 }));
  await page.waitForTimeout(600);
  const px = await ev(() => { const c = document.querySelector('.stage canvas'), d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [d[0], d[1], d[2]]; });
  check('la vista previa muestra la cámara elegida', px[2] > 150 && px[0] < 80, JSON.stringify(px));
  check('sin errores de página', !errors.length, errors.join(' | '));
  await app.close();
  console.log(fails.length ? `\n${fails.length} FALLAS` : '\nTODO OK');
  process.exit(fails.length ? 1 : 0);
})();
