import { getState, setState, update, toast, setJob } from '../store.js';
import { newClip, newTrack, uid, clipEnd, mediaOf, projectDuration, DEFAULT_TEXT, clamp, subClip, sourceTime, MAX_SPEED } from '../engine/model.js';

const api = window.api;
const PLAYABLE = ['h264', 'vp8', 'vp9', 'av1', 'hevc', 'theora'];
const sel = () => getState().selection;
const proj = () => getState().project;

// Mutates project without an undo step (async metadata like thumbnails).
export function patchSilently(fn) {
  const p = structuredClone(getState().project);
  fn(p);
  setState({ project: p });
}

// ---------- tracks ----------
const overlaps = (p, trackId, start, end, ignore = []) =>
  p.clips.some((c) => c.trackId === trackId && !ignore.includes(c.id) && c.start < end - 1e-4 && clipEnd(c) > start + 1e-4);

// Finds a track of `kind` free over [start, end) or creates one (visual tracks go on top, audio at bottom).
export function ensureTrack(p, kind, start, end, ignore = []) {
  const candidates = p.tracks.filter((t) => t.kind === kind && !t.main && !t.locked);
  for (const t of kind === 'audio' ? candidates : [...candidates].reverse()) if (!overlaps(p, t.id, start, end, ignore)) return t.id;
  const t = newTrack(kind, `${{ video: 'Superposición', audio: 'Audio', text: 'Texto', effect: 'Efectos' }[kind]} ${candidates.length + 1}`);
  if (kind === 'audio') p.tracks.push(t);
  else {
    // Keep text/effects above overlay video: effects top, then text, then overlay video above main.
    const order = { effect: 0, text: 1, video: 2 };
    let i = p.tracks.findIndex((x) => x.kind !== 'audio' && (order[x.kind] ?? 3) >= order[kind]);
    if (i < 0) i = p.tracks.findIndex((x) => x.main);
    p.tracks.splice(Math.max(0, i), 0, t);
  }
  return t.id;
}
export const mainTrack = (p) => p.tracks.find((t) => t.main);

// Magnetic main track: clips sit back to back with no gaps.
export function packMain(p) {
  if (!getState().magnet) return;
  const m = mainTrack(p);
  let t = 0;
  p.clips.filter((c) => c.trackId === m.id).sort((a, b) => a.start - b.start).forEach((c) => { c.start = t; t += c.duration; });
}
export function cleanupTracks(p) {
  p.tracks = p.tracks.filter((t) => t.main || p.clips.some((c) => c.trackId === t.id));
}

// ---------- import ----------
export async function importPaths(paths) {
  const added = [];
  for (const path of paths) {
    const existing = proj().media.find((m) => m.path === path);
    if (existing) { added.push(existing); continue; }
    const jobId = uid();
    setJob(jobId, { label: `Importando ${path.split(/[\\/]/).pop()}`, progress: 0 });
    try {
      const info = await api.probe(path);
      const media = { id: uid(), path, name: path.split(/[\\/]/).pop(), ...info, thumb: null, strip: null, proxy: null, reversed: null };
      update((p) => { p.media.push(media); });
      added.push(media);
      prepareMedia(media, jobId);
    } catch (e) {
      setJob(jobId, null);
      toast(`No se pudo importar ${path.split(/[\\/]/).pop()}`, 'error');
    }
  }
  return added;
}

// Background work: compatibility proxy (codecs Chromium can't play, or non-square pixels), then thumbnails from
// what the clip shows. `reverse` remakes the reversed copy from the new proxy.
async function prepareMedia(media, jobId = uid(), reverse = false) {
  const { path, duration, type } = media, patch = (o) => patchSilently((p) => { const m = p.media.find((x) => x.id === media.id); if (m) Object.assign(m, o); });
  setJob(jobId, { label: `Importando ${media.name}`, progress: 0 });
  try {
    let src = media.proxy || path;
    if (type === 'video' && !media.proxy && (!PLAYABLE.includes(media.vcodec) || media.sar !== 1)) {
      setJob(jobId, { label: `Optimizando ${media.name}`, progress: 0 });
      const off = api.onJobProgress((d) => d.jobId === jobId && setJob(jobId, { progress: d.progress }));
      src = await api.transcode(path, 'proxy', duration, jobId).finally(off);
      patch({ proxy: src });
      if (reverse) patch({ reversed: await api.transcode(src, 'reverse', duration, jobId) });
    }
    if (type !== 'audio') {
      const thumb = await api.thumb(src, type === 'image' ? 0 : Math.min(1, duration / 3), 160); // a still has no frame at 1 s
      const strip = type === 'video' ? await api.strip(src, duration, 16) : thumb;
      patch({ thumb, strip });
    }
  } catch (e) { toast(`Error procesando ${media.name}: ${e.message}`, 'error'); }
  setJob(jobId, null);
}

// Videos without `sar` (projects saved before 1.6.1, relinked files): probe again. Anamorphic ones had their coded
// size and no square-pixel proxy: redo size, proxy, thumbnails and reversed copy.
export async function reprobeMedia() {
  for (const m of proj().media.filter((x) => x.type === 'video' && x.sar == null && !x.missing)) {
    const info = await api.probe(m.path).catch(() => null);
    if (!info) continue;
    const fixed = info.sar === 1 ? { ...m, sar: 1 } : { ...m, width: info.width, height: info.height, sar: info.sar, proxy: null, reversed: null };
    patchSilently((p) => { const x = p.media.find((k) => k.id === m.id); if (x) Object.assign(x, fixed); });
    if (!fixed.proxy && (fixed.sar !== 1 || !PLAYABLE.includes(fixed.vcodec))) prepareMedia(fixed, uid(), !!m.reversed);
  }
}

export async function importDialog() {
  const paths = await api.openMedia();
  if (paths.length) return importPaths(paths);
  return [];
}

// Adds media to the timeline. Video/image → main track end (or overlay at time); audio → audio track.
export function addToTimeline(media, { at = null, trackId = null } = {}) {
  let id;
  update((p) => {
    const type = media.type === 'image' ? 'image' : media.type;
    const c = newClip(type, { mediaId: media.id, name: media.name, duration: media.duration });
    if (type === 'audio') {
      c.start = at ?? getState().time;
      c.trackId = trackId || ensureTrack(p, 'audio', c.start, c.start + c.duration);
    } else if (trackId || at != null) {
      c.start = at ?? getState().time;
      const tk = trackId && p.tracks.find((t) => t.id === trackId);
      if (tk && tk.main) {
        // Insert into main track at the nearest cut.
        const main = p.clips.filter((x) => x.trackId === tk.id).sort((a, b) => a.start - b.start);
        let insertAt = 0;
        for (const x of main) if (x.start + x.duration / 2 < c.start) insertAt = clipEnd(x);
        main.filter((x) => x.start >= insertAt - 1e-4).forEach((x) => { x.start += c.duration; });
        c.start = insertAt;
      }
      c.trackId = tk ? tk.id : ensureTrack(p, 'video', c.start, c.start + c.duration);
      if (tk && !tk.main && overlaps(p, tk.id, c.start, c.start + c.duration)) c.trackId = ensureTrack(p, 'video', c.start, c.start + c.duration);
    } else {
      const m = mainTrack(p);
      c.trackId = m.id;
      c.start = p.clips.filter((x) => x.trackId === m.id).reduce((e, x) => Math.max(e, clipEnd(x)), 0);
    }
    if (media.type === 'video' && !media.hasAudio) c.volume = 0;
    p.clips.push(c);
    packMain(p);
    id = c.id;
  });
  setState({ selection: [id] });
  return id;
}

// ---------- editing ----------
// Splits clip c (mutated into the left half) at timeline time t; returns the new right half.
export function splitClip(c, t) {
  const leftDur = t - c.start;
  const right = structuredClone(c);
  right.id = uid();
  right.start = t; right.duration = c.duration - leftDur;
  const L = subClip(c, 0, leftDur), R = subClip(c, leftDur, c.duration);
  if (c.type === 'video' || c.type === 'audio' || c.type === 'image') right.in = c.reverse ? c.in : c.in + R.off;
  if (c.reverse) c.in = c.in + R.span;
  // Each half keeps its part of the curve; speed = that part's average, so the mapping is unchanged.
  if (c.curve) { right.curve = R.curve; c.curve = L.curve; right.speed = R.speed; c.speed = L.speed; }
  right.transition = null;
  if (c.words) { right.words = c.words.filter((w) => w.e > leftDur).map((w) => ({ ...w, s: w.s - leftDur, e: w.e - leftDur })); c.words = c.words.filter((w) => w.s < leftDur); }
  // Split keyframes between halves.
  for (const k of Object.keys(c.kf || {})) { right.kf[k] = c.kf[k].filter((f) => f.t >= leftDur).map((f) => ({ ...f, t: f.t - leftDur })); c.kf[k] = c.kf[k].filter((f) => f.t < leftDur); }
  c.duration = leftDur;
  if (c.fadeOut) c.fadeOut = 0;
  if (right.fadeIn) right.fadeIn = 0;
  return right;
}

export function splitAtPlayhead() {
  const t = getState().time, p = proj();
  let targets = p.clips.filter((c) => sel().includes(c.id) && t > c.start + 0.03 && t < clipEnd(c) - 0.03);
  if (!targets.length) {
    const m = mainTrack(p);
    targets = p.clips.filter((c) => c.trackId === m.id && t > c.start + 0.03 && t < clipEnd(c) - 0.03);
  }
  if (!targets.length) return toast('Coloca el cursor sobre un clip para dividir');
  const newIds = [];
  update((d) => {
    for (const tc of targets) {
      const right = splitClip(d.clips.find((x) => x.id === tc.id), t);
      d.clips.push(right);
      newIds.push(right.id);
    }
  });
  setState({ selection: newIds });
}

export function deleteSelected() {
  const ids = sel();
  if (!ids.length) return;
  update((p) => { p.clips = p.clips.filter((c) => !ids.includes(c.id)); packMain(p); cleanupTracks(p); });
  setState({ selection: [] });
}

export function duplicateSelected() {
  const ids = sel();
  if (!ids.length) return;
  const newIds = [];
  update((p) => {
    for (const id of ids) {
      const c = p.clips.find((x) => x.id === id);
      const d = structuredClone(c); d.id = uid(); d.start = clipEnd(c);
      const tk = p.tracks.find((t) => t.id === c.trackId);
      if (tk.main) {
        p.clips.filter((x) => x.trackId === tk.id && x.start >= clipEnd(c) - 1e-4).forEach((x) => { x.start += c.duration; });
      } else if (overlaps(p, c.trackId, d.start, d.start + d.duration)) d.trackId = ensureTrack(p, tk.kind, d.start, d.start + d.duration);
      p.clips.push(d); newIds.push(d.id);
    }
    packMain(p);
  });
  setState({ selection: newIds });
}

export function detachAudio() {
  const p = proj();
  const c = p.clips.find((x) => sel().includes(x.id) && x.type === 'video');
  if (!c) return toast('Selecciona un clip de video');
  const media = mediaOf(p, c);
  if (!media.hasAudio) return toast('Este video no tiene audio');
  if (c.detached) return toast('El audio ya está separado');
  let aid;
  update((d) => {
    const v = d.clips.find((x) => x.id === c.id);
    v.detached = true;
    const a = newClip('audio', {
      mediaId: v.mediaId, name: `${v.name} (audio)`, start: v.start, duration: v.duration, in: v.in, speed: v.speed, curve: v.curve ? structuredClone(v.curve) : null,
      volume: v.volume || 1, kf: v.kf && v.kf.volume ? { volume: structuredClone(v.kf.volume) } : {}, fadeIn: v.fadeIn, fadeOut: v.fadeOut, audioFx: structuredClone(v.audioFx), fxPath: v.fxPath, reverse: v.reverse,
    });
    a.trackId = ensureTrack(d, 'audio', a.start, a.start + a.duration);
    d.clips.push(a); aid = a.id;
  });
  setState({ selection: [aid] });
  toast('Audio separado en una pista nueva');
}

export async function freezeFrame() {
  const p = proj(), t = getState().time;
  const c = p.clips.find((x) => sel().includes(x.id) && x.type === 'video' && t >= x.start && t < clipEnd(x))
    || p.clips.find((x) => x.type === 'video' && x.trackId === mainTrack(p).id && t >= x.start && t < clipEnd(x));
  if (!c) return toast('Coloca el cursor sobre un video');
  const media = mediaOf(p, c);
  const src = sourceTime(c, t, null);
  const png = await api.frame(media.proxy || media.path, src);
  const info = await api.probe(png);
  const fm = { id: uid(), path: png, name: 'Congelado.png', ...info, type: 'image', thumb: png, strip: png };
  splitAtPlayhead();
  update((d) => {
    d.media.push(fm);
    const img = newClip('image', { mediaId: fm.id, name: 'Fotograma congelado', duration: 3, start: t, trackId: c.trackId, filter: structuredClone(c.filter), transform: structuredClone(c.transform), fit: c.fit, crop: structuredClone(c.crop) });
    const tk = d.tracks.find((x) => x.id === c.trackId);
    if (tk.main) d.clips.filter((x) => x.trackId === tk.id && x.start >= t - 1e-4).forEach((x) => { x.start += 3; });
    else img.trackId = ensureTrack(d, 'video', t, t + 3);
    d.clips.push(img);
    packMain(d);
  });
  toast('Fotograma congelado (3 s)');
}

export async function toggleReverse() {
  const p = proj();
  const c = p.clips.find((x) => sel().includes(x.id) && x.type === 'video');
  if (!c) return toast('Selecciona un clip de video');
  const media = mediaOf(p, c);
  if (!media.reversed) {
    const jobId = uid();
    setJob(jobId, { label: 'Invirtiendo video…', progress: 0 });
    const off = api.onJobProgress((d) => d.jobId === jobId && setJob(jobId, { progress: d.progress }));
    try {
      const rev = await api.transcode(media.proxy || media.path, 'reverse', media.duration, jobId);
      patchSilently((d) => { d.media.find((m) => m.id === media.id).reversed = rev; });
    } catch (e) { toast('No se pudo invertir: ' + e.message, 'error'); return; }
    finally { off(); setJob(jobId, null); }
  }
  update((d) => { const x = d.clips.find((k) => k.id === c.id); x.reverse = !x.reverse; x.fxPath = null; });
  toast(c.reverse ? 'Reproducción normal' : 'Video invertido');
}

export function setSpeed(clipId, speed, key) {
  update((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    const media = mediaOf(p, c);
    const srcLen = c.duration * c.speed;
    speed = clamp(speed, 0.1, MAX_SPEED);
    c.speed = speed;
    c.duration = Math.max(0.05, srcLen / speed);
    if (media && c.type !== 'image') c.duration = Math.min(c.duration, (media.duration - c.in) / speed);
    for (const k of Object.keys(c.kf || {})) c.kf[k].forEach((f) => { f.t = Math.min(f.t, c.duration); });
    packMain(p);
  }, key);
}

// Speed curve (null = constant speed). Duration stays: clip.speed is the curve's average.
export function setCurve(clipId, pts, key) {
  update((p) => { p.clips.find((x) => x.id === clipId).curve = pts ? structuredClone(pts) : null; }, key);
}

export function addText(preset = {}, content = 'Escribe aquí') {
  let id;
  update((p) => {
    const start = getState().time;
    const c = newClip('text', { name: 'Texto', start, duration: 3 });
    c.text = { ...structuredClone(DEFAULT_TEXT), ...structuredClone(preset), content };
    for (const k of ['stroke', 'shadow', 'bg', 'glow', 'gradient', 'highlight', 'keyword']) c.text[k] = { ...DEFAULT_TEXT[k], ...(preset[k] || {}) };
    c.trackId = ensureTrack(p, 'text', start, start + c.duration);
    p.clips.push(c); id = c.id;
  });
  setState({ selection: [id] });
}

export function addSticker(emoji) {
  let id;
  update((p) => {
    const start = getState().time;
    const c = newClip('text', { name: `Sticker ${emoji}`, start, duration: 3, sticker: true });
    c.text = { ...structuredClone(DEFAULT_TEXT), content: emoji, size: 220, shadow: { ...DEFAULT_TEXT.shadow, on: false } };
    c.anim.in = { type: 'pop', dur: 0.4 };
    c.trackId = ensureTrack(p, 'text', start, start + c.duration);
    p.clips.push(c); id = c.id;
  });
  setState({ selection: [id] });
}

export function addEffect(type) {
  let id;
  update((p) => {
    const start = getState().time;
    const c = newClip('effect', { name: type, start, duration: 3, effect: { type, intensity: 50 } });
    c.trackId = ensureTrack(p, 'effect', start, start + 3);
    p.clips.push(c); id = c.id;
  });
  setState({ selection: [id] });
}

export function addFilterLayer(preset) {
  let id;
  update((p) => {
    const start = getState().time;
    const c = newClip('effect', { name: `Filtro`, start, duration: Math.max(3, projectDuration(p) - start), effect: { type: 'none', intensity: 50 } });
    c.filter = { preset, intensity: 100, exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, hue: 0, fade: 0, vignette: 0, grain: 0, blur: 0, sharpen: 0 };
    c.trackId = ensureTrack(p, 'effect', start, start + c.duration);
    p.clips.push(c); id = c.id;
  });
  setState({ selection: [id] });
}

// Applies a transition at the start of the selected clip, or at the cut nearest the playhead.
export function applyTransition(type, duration = 0.6) {
  const p = proj(), t = getState().time;
  let target = p.clips.find((c) => sel().includes(c.id) && (c.type === 'video' || c.type === 'image'));
  if (!target) {
    const m = mainTrack(p);
    const cuts = p.clips.filter((c) => c.trackId === m.id && c.start > 0.01);
    target = cuts.sort((a, b) => Math.abs(a.start - t) - Math.abs(b.start - t))[0];
  }
  if (!target) return toast('Necesitas dos clips contiguos para una transición');
  const prev = p.clips.find((c) => c.trackId === target.trackId && Math.abs(clipEnd(c) - target.start) < 0.05);
  if (!prev) return toast('El clip debe tener otro clip justo antes');
  const d = Math.min(duration, target.duration, prev.duration);
  update((x) => { x.clips.find((c) => c.id === target.id).transition = type ? { type, duration: d } : null; });
  setState({ selection: [target.id] });
}

export function applyToAll(clipId, field) {
  const src = proj().clips.find((c) => c.id === clipId);
  update((p) => {
    for (const c of p.clips) if (c.id !== src.id && c.type === src.type && (field !== 'text' || !c.sticker)) {
      if (field === 'text') { const content = c.text.content; c.text = { ...structuredClone(src.text), content }; c.transform = { ...src.transform }; }
      else c[field] = structuredClone(src[field]);
    }
  });
  toast('Aplicado a todos');
}

export async function addTTS(text, voice, rate) {
  const jobId = uid();
  setJob(jobId, { label: 'Generando voz…', progress: 0.5 });
  try {
    const path = await api.tts({ text, voice, rate });
    const [m] = await importPaths([path]);
    addToTimeline(m, { at: getState().time });
    toast('Voz agregada a la línea de tiempo');
  } catch (e) { toast('Error de texto a voz: ' + e.message, 'error'); }
  setJob(jobId, null);
}

export function addMarker() {
  update((p) => { p.markers = [...(p.markers || []), { id: uid(), t: getState().time, color: '#ffd23f' }]; });
}
