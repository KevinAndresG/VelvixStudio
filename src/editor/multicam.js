// Multicam: takes of the same moment synced by audio (cross-correlation of loudness onsets) and cut between
// them — automatically (the camera whose audio is loudest relative to itself, rotating when none stands out)
// or by hand (each cut keeps the group, so its angle can be switched in the inspector).
import { getState, update, toast, setJob } from '../store.js';
import { uid, newClip, clipEnd } from '../engine/model.js';
import { makeFFT } from '../engine/fft.js';
import { mainTrack, packMain, ensureTrack, cleanupTracks } from './actions.js';

const RATE = 8000, FPS = 100, HOP = RATE / FPS;
const f32 = (raw) => new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

// Loudness in dB per 10 ms.
export function loudness(a) {
  const out = new Float64Array(Math.floor(a.length / HOP));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = i * HOP; k < (i + 1) * HOP; k++) s += a[k] * a[k];
    out[i] = 10 * Math.log10(1e-8 + s / HOP);
  }
  return out;
}
// Onsets (rises in loudness), zero mean: insensitive to each camera's gain and room tone.
function onsets(db) {
  const o = new Float64Array(db.length);
  for (let i = 1; i < db.length; i++) o[i] = Math.max(0, db[i] - db[i - 1]);
  const m = o.reduce((s, x) => s + x, 0) / (o.length || 1);
  return o.map((x) => x - m);
}
// Seconds by which `cam` started after `ref` (negative: before). Cross-correlation by FFT, ±maxLag s,
// refined to sub-frame with a parabola through the peak.
export function syncOffset(refDb, camDb, maxLag = 60) {
  const a = onsets(refDb), b = onsets(camDb);
  let n = 1;
  while (n < a.length + b.length) n *= 2;
  const fft = makeFFT(n);
  const spec = (x) => { const re = new Float64Array(n), im = new Float64Array(n), or = new Float64Array(n), oi = new Float64Array(n); re.set(x); fft(re, im, or, oi); return [or, oi]; };
  const [ar, ai] = spec(a), [br, bi] = spec(b);
  // R = ifft(A · conj(B)) = conj(fft(conj(A · conj(B)))) / n → R[k] = Σ a[i + k] · b[i].
  const re = new Float64Array(n), im = new Float64Array(n), r = new Float64Array(n), ri = new Float64Array(n);
  for (let i = 0; i < n; i++) { re[i] = ar[i] * br[i] + ai[i] * bi[i]; im[i] = -(ai[i] * br[i] - ar[i] * bi[i]); }
  fft(re, im, r, ri);
  const L = Math.min(n / 2 - 1, Math.round(maxLag * FPS)), at = (k) => r[(k + n) % n];
  let best = 0;
  for (let k = -L; k <= L; k++) if (at(k) > at(best)) best = k;
  const y0 = at(best - 1), y1 = at(best), y2 = at(best + 1), den = y0 - 2 * y1 + y2;
  return (best + (den < 0 ? (0.5 * (y0 - y2)) / den : 0)) / FPS;
}

// Cut list over the shared span [0, len): [{ cam, a, b }]. `levels[i](t)` = camera i's dB around t (relative).
export function autoCuts(levels, len, every = 4) {
  const cuts = [];
  let prev = -1;
  for (let a = 0; a < len - 1e-3; a += every) {
    const b = Math.min(len, a + every), sc = levels.map((f) => f(a, b));
    const order = sc.map((s, i) => i).sort((x, y) => sc[y] - sc[x]);
    // A camera wins only when clearly louder (its own talker); otherwise rotate for variety.
    const cam = sc[order[0]] - sc[order[1]] > 1.5 ? order[0] : (prev + 1) % levels.length;
    if (cuts.length && cuts[cuts.length - 1].cam === cam) cuts[cuts.length - 1].b = b;
    else cuts.push({ cam, a, b });
    if (b - a > 0.5 * every || !cuts.length) prev = cam; // a short last piece doesn't change the rotation
  }
  return cuts;
}

// Syncs the selected video clips' takes and replaces them with one multicam sequence at the end of the
// main track, plus the first camera's audio on its own track. One undo step.
export async function multicam(clipIds, { every = 4 } = {}) {
  const p = getState().project;
  const cams = [...new Set(clipIds.map((id) => p.clips.find((c) => c.id === id)).filter((c) => c && c.type === 'video').map((c) => c.mediaId))].map((id) => p.media.find((m) => m.id === id));
  if (cams.length < 2) return toast('Selecciona 2 o más clips de video (una toma por cámara)'), null;
  if (cams.some((m) => !m.hasAudio)) return toast('Cada toma necesita audio para sincronizar'), null;
  const jobId = uid();
  setJob(jobId, { label: 'Multicámara: sincronizando por audio…', progress: null });
  let dbs;
  try { dbs = await Promise.all(cams.map(async (m) => loudness(f32(await window.api.decodeAudio(m.path, RATE, 1))))); }
  catch (e) { toast('No se pudo leer el audio: ' + e.message, 'error'); return null; }
  finally { setJob(jobId, null); }
  // d[i]: camera i started d[i] s after camera 0. Shared span in camera-0 time: [S, E).
  const d = dbs.map((db, i) => (i ? syncOffset(dbs[0], db) : 0));
  const S = Math.max(...d.map((x) => Math.max(0, x))), E = Math.min(...cams.map((m, i) => d[i] + m.duration));
  if (E - S < 1) return toast('Las tomas no se superponen en el tiempo'), null;
  const raw = dbs.map((db, i) => (a, b) => {
    const i0 = Math.max(0, Math.round((S + a - d[i]) * FPS)), i1 = Math.min(db.length, Math.round((S + b - d[i]) * FPS));
    let s = 0; for (let k = i0; k < i1; k++) s += db[k];
    return i1 > i0 ? s / (i1 - i0) : -99;
  });
  // Relative to each camera's own average over the shared span (gain and anything outside it don't count).
  const levels = raw.map((f) => { const m = f(0, E - S); return (a, b) => f(a, b) - m; });
  const cuts = autoCuts(levels, E - S, every);
  const group = { id: uid(), angles: cams.map((m, i) => ({ mediaId: m.id, offset: S - d[i] })) }; // source time = offset + local
  let ids = [];
  update((q) => {
    q.clips = q.clips.filter((c) => !clipIds.includes(c.id));
    packMain(q);
    const m = mainTrack(q), t0 = q.clips.filter((c) => c.trackId === m.id).reduce((e, c) => Math.max(e, clipEnd(c)), 0);
    for (const k of cuts) {
      const md = cams[k.cam], c = newClip('video', { mediaId: md.id, name: `Cámara ${k.cam + 1}`, trackId: m.id, start: t0 + k.a, duration: k.b - k.a, in: group.angles[k.cam].offset + k.a, detached: true, multicam: { ...group, angle: k.cam } });
      q.clips.push(c); ids.push(c.id);
    }
    const au = newClip('audio', { mediaId: cams[0].id, name: `Audio · ${cams[0].name}`, start: t0, duration: E - S, in: S });
    au.trackId = ensureTrack(q, 'audio', t0, t0 + E - S);
    q.clips.push(au);
    cleanupTracks(q);
  });
  toast(`Multicámara: ${cams.length} tomas sincronizadas, ${cuts.length} cortes`);
  return { offsets: d, cuts, ids };
}

// Switches a multicam cut to another camera (same moment; works after splits and trims).
export function setAngle(clipId, angle) {
  update((q) => {
    const c = q.clips.find((x) => x.id === clipId), g = c && c.multicam, ang = g && g.angles[angle];
    if (!ang || !q.media.some((m) => m.id === ang.mediaId)) return;
    Object.assign(c, { mediaId: ang.mediaId, in: c.in - g.angles[g.angle].offset + ang.offset, name: `Cámara ${angle + 1}` });
    c.multicam = { ...g, angle };
  });
}
