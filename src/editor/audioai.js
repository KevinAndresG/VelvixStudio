// Audio AI: vocal separation (MDX-Net), beat detection + cut to the beat, neural TTS (MMS-TTS).
// Models run in the Whisper worker; ducking and "Mejorar voz" live in the ffmpeg chain (main.cjs) and sources.js.
import { getState, update, toast, setJob } from '../store.js';
import { uid, clipEnd, mediaOf, newClip, mediaUrl, subClip } from '../engine/model.js';
import { audioSegments } from '../engine/sources.js';
import { makeFFT, hann } from '../engine/fft.js';
import { getWorker, exclusive } from './captions.js';
import { importPaths, ensureTrack, mainTrack, addToTimeline } from './actions.js';

const api = window.api;
const f32 = (raw) => new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };

function workerTask(msg, transfer, doneType, onProgress) {
  return exclusive(() => new Promise((resolve, reject) => {
    const w = getWorker();
    w.onmessage = ({ data }) => {
      if (data.type === 'download') onProgress('Descargando modelo (solo la primera vez)…', data.progress);
      if (data.type === 'status') onProgress(data.msg, data.progress ?? null);
      if (data.type === 'error') reject(new Error(data.msg));
      if (data.type === doneType) resolve(data);
    };
    w.postMessage(msg, transfer);
  }));
}

// ---------- #15 isolate voice / remove music ----------
// Voice and music WAVs of a whole media file (cached by path).
export async function stemsOf(media) {
  const key = 'stem-' + hash(media.path);
  const [voice, music] = await Promise.all([api.cachePath(key + '-voz'), api.cachePath(key + '-musica')]);
  if ((await api.fileExists(voice)) && (await api.fileExists(music))) return { voice, music };
  const jobId = uid();
  setJob(jobId, { label: 'Descargando modelo de separación (solo la primera vez)…', progress: 0 });
  const off = api.onJobProgress((d) => d.jobId === jobId && setJob(jobId, { progress: d.progress }));
  try {
    const model = await api.getModel('mdx', jobId);
    off();
    setJob(jobId, { label: 'Leyendo audio…', progress: null });
    const all = f32(await api.decodeAudio(media.proxy || media.path, 44100, 2)), n = all.length / 2;
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }
    const r = await workerTask({ task: 'stems', L, R, url: mediaUrl(model) }, [L.buffer, R.buffer], 'stems', (label, progress) => setJob(jobId, { label, progress }));
    await api.saveWav(key + '-voz', r.vocals, 44100);
    await api.saveWav(key + '-musica', r.inst, 44100);
    return { voice, music };
  } finally { off(); setJob(jobId, null); }
}

// keep: 'voice' (remove music) | 'music' (remove voice) | 'both' (two tracks). The source clip goes silent.
export async function isolateVoice(clipId, keep = 'voice') {
  const p = getState().project, c = p.clips.find((x) => x.id === clipId);
  if (!c || (c.type !== 'audio' && c.type !== 'video')) return toast('Selecciona un clip con audio'), null;
  const media = mediaOf(p, c);
  if (c.type === 'video' && !media.hasAudio) return toast('Este video no tiene audio'), null;
  if (c.reverse) return toast('Quita «Invertir» antes de separar la voz'), null;
  let stems;
  try { stems = await stemsOf(media); } catch (e) { toast('No se pudo separar la voz: ' + e.message, 'error'); return null; }
  const want = keep === 'both' ? ['voice', 'music'] : [keep];
  const added = await importPaths(want.map((k) => stems[k]));
  const label = { voice: 'voz', music: 'música' }, ids = [];
  update((d) => {
    const src = d.clips.find((x) => x.id === clipId);
    want.forEach((k, i) => {
      const m = d.media.find((x) => x.id === added[i].id);
      m.name = `${media.name} · ${label[k]}`;
      const a = newClip('audio', {
        mediaId: m.id, name: `${src.name} (${label[k]})`, start: src.start, duration: src.duration, in: src.in, speed: src.speed,
        curve: src.curve ? structuredClone(src.curve) : null, volume: src.volume, kf: src.kf && src.kf.volume ? { volume: structuredClone(src.kf.volume) } : {},
        fadeIn: src.fadeIn, fadeOut: src.fadeOut,
      });
      a.trackId = ensureTrack(d, 'audio', a.start, clipEnd(a));
      d.clips.push(a); ids.push(a.id);
    });
    if (src.type === 'video') src.detached = true;
    else d.clips = d.clips.filter((x) => x.id !== clipId);
  });
  toast({ voice: 'Voz aislada (música quitada)', music: 'Voz quitada (solo música)', both: 'Voz y música en pistas separadas' }[keep]);
  return ids;
}

// ---------- #5a beat detection ----------
// Spectral-flux onsets (100 frames/s) → tempo by autocorrelation (weighted around 120 BPM) →
// dynamic-programming beat tracking (Ellis 2007). Returns beat times in seconds of `a`.
export function beatTimes(a, sr, t0 = 0, t1 = a.length / sr) {
  const N = 512, H = Math.round(sr / 100), fps = sr / H, fft = makeFFT(N), w = hann(N);
  const re = new Float64Array(N), im = new Float64Array(N), or = new Float64Array(N), oi = new Float64Array(N), prev = new Float64Array(N / 2);
  const i0 = Math.max(0, Math.floor(t0 * fps)), i1 = Math.floor((Math.min(t1, a.length / sr) * sr - N) / H);
  const on = [];
  for (let i = i0; i <= i1; i++) {
    for (let k = 0; k < N; k++) { re[k] = (a[i * H + k] || 0) * w[k]; im[k] = 0; }
    fft(re, im, or, oi);
    let flux = 0;
    for (let b = 1; b < N / 2; b++) { const m = Math.log1p(100 * Math.hypot(or[b], oi[b])), d = m - prev[b]; if (d > 0) flux += d; prev[b] = m; }
    on.push(on.length ? flux : 0);
  }
  const n = on.length;
  if (n < 2 * fps) return [];
  // Remove the local mean (±0.25 s) and normalize.
  const o = new Float64Array(n), R = Math.round(fps / 4);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { s += on[j]; c++; } o[i] = Math.max(0, on[i] - s / c); }
  const sd = Math.sqrt(o.reduce((s, x) => s + x * x, 0) / n) || 1;
  for (let i = 0; i < n; i++) o[i] /= sd;
  let P = 50, best = -1;
  for (let lag = Math.round(fps * 0.3); lag <= Math.round(fps * 1.0); lag++) {
    let r = 0;
    for (let i = lag; i < n; i++) r += o[i] * o[i - lag];
    r = (r / (n - lag)) * Math.exp(-0.5 * Math.log2(lag / (fps / 2)) ** 2);
    if (r > best) { best = r; P = lag; }
  }
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1), alpha = 100;
  for (let i = 0; i < n; i++) {
    let b = 0, bi = -1;
    for (let j = Math.max(0, i - 2 * P); j <= i - Math.round(P / 2); j++) { const v = score[j] - alpha * Math.log((i - j) / P) ** 2; if (v > b) { b = v; bi = j; } }
    score[i] = o[i] + b; back[i] = bi;
  }
  let end = n - 1;
  for (let i = Math.max(0, n - P); i < n; i++) if (score[i] > score[end]) end = i;
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) beats.unshift(((i0 + i) * H + N / 2) / sr);
  return beats;
}

// Beat markers for an audio clip (replaces that clip's previous beat markers).
export async function detectBeats(clipId) {
  const p = getState().project, c = p.clips.find((x) => x.id === clipId);
  const seg = audioSegments(p).find((s) => s.id === clipId);
  if (!c || !seg) return toast('Selecciona un clip con audio'), [];
  const jobId = uid();
  setJob(jobId, { label: 'Detectando ritmo…', progress: null });
  try {
    const a = f32(await api.captionsAudio([seg], clipEnd(c)));
    const beats = beatTimes(a, 16000, c.start, clipEnd(c));
    update((d) => {
      d.markers = [...(d.markers || []).filter((m) => !(m.beat && m.clip === clipId)), ...beats.map((t) => ({ id: uid(), t, color: '#4ee6a8', beat: true, clip: clipId }))];
    });
    const bpm = beats.length > 1 ? Math.round((60 * (beats.length - 1)) / (beats[beats.length - 1] - beats[0])) : 0;
    toast(beats.length ? `${beats.length} beats · ${bpm} BPM` : 'No se detectó ritmo');
    return beats;
  } catch (e) { toast('No se pudo detectar el ritmo: ' + e.message, 'error'); return []; }
  finally { setJob(jobId, null); }
}

// Main-track clips end on beats: each clip is shortened to the last beat (every `every` beats) it reaches.
export function cutToBeat(every = 1) {
  const beats = (getState().project.markers || []).filter((m) => m.beat).map((m) => m.t).sort((a, b) => a - b).filter((_, i) => i % every === 0);
  if (!beats.length) return toast('Primero detecta el ritmo de una canción'), 0;
  let n = 0;
  update((d) => {
    const m = mainTrack(d);
    const main = d.clips.filter((c) => c.trackId === m.id).sort((a, b) => a.start - b.start);
    let t = main.length ? main[0].start : 0;
    for (const c of main) {
      c.start = t;
      const end = beats.filter((b) => b > t + 0.3 && b <= t + c.duration + 1e-6).pop();
      if (end != null && end < t + c.duration - 1e-3) {
        const k = subClip(c, 0, end - t);
        c.duration = end - t;
        if (c.curve) { c.curve = k.curve; c.speed = k.speed; }
        if (c.fadeIn) c.fadeIn = Math.min(c.fadeIn, c.duration);
        if (c.fadeOut) c.fadeOut = Math.min(c.fadeOut, c.duration);
        n++;
      }
      t = c.start + c.duration;
    }
  });
  toast(n ? `${n} clips cortados al compás` : 'Los clips ya terminan en un beat');
  return n;
}

// ---------- #9b neural TTS ----------
export const NEURAL_LANGS = { spa: 'Español', eng: 'Inglés', por: 'Portugués', fra: 'Francés', deu: 'Alemán' };
export async function neuralTTS(text, lang = 'spa') {
  const jobId = uid();
  setJob(jobId, { label: 'Cargando voz neuronal…', progress: null });
  try {
    const r = await workerTask({ task: 'tts', text, lang }, [], 'speech', (label, progress) => setJob(jobId, { label, progress }));
    const path = await api.saveWav('tts-neural-' + uid(), [r.audio], r.rate);
    const [m] = await importPaths([path]);
    const name = `Voz neuronal · ${text.trim().slice(0, 24)}`;
    update((d) => { d.media.find((x) => x.id === m.id).name = name; });
    const id = addToTimeline({ ...m, name }, { at: getState().time });
    toast('Voz neuronal agregada');
    return id;
  } catch (e) { toast('Error de voz neuronal: ' + e.message, 'error'); return null; }
  finally { setJob(jobId, null); }
}
