// Visual AI and video analysis (Sesión 6): background removal (MODNet matte), reframing that follows the face
// (UltraFace), stabilization (ffmpeg vidstab), motion tracking for text/stickers (template matching), scene
// detection (ffmpeg scdet), long video → short clips, and AI upscaling (Real-ESRGAN).
// Models run in the shared AI worker; frames come from ffmpeg in the main process (api.framesOpen/Read).
import { getState, update, toast, setJob } from '../store.js';
import { uid, clamp, clipEnd, mediaOf, trackOf, sourceTime, timeAtSource, vidSrc, basePath, transformAt, ASPECTS, projectDuration, mediaUrl, isKeyword } from '../engine/model.js';
import { srcToCanvas, canvasToSrc, activeVisual, fitSize } from '../engine/render.js';
import { loadMatte } from '../engine/gl.js';
import { workerTask, cancelAI } from './audioai.js';
import { splitClip, mainTrack, importPaths } from './actions.js';
import { rippleDelete, timelineAudio } from './transcript.js';
import { transcribe } from './captions.js';

const api = window.api;
const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h.toString(36); };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const own = (b) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b : b.slice()); // transferable copy
const CANCEL = 'Cancelado';

// Background job with a taskbar entry (label, progress, ✕). fn(report, cancelled, jobId).
async function job(label, fn, { cancel = true } = {}) {
  const id = uid();
  let stop = false;
  setJob(id, { label, progress: null, ...(cancel ? { cancel: () => { stop = true; cancelAI(); } } : {}) });
  const report = (l, progress) => setJob(id, { label: l || label, progress });
  const cancelled = () => { if (stop) throw new Error(CANCEL); };
  try { return await fn(report, cancelled, id); } finally { setJob(id, null); }
}
const failed = (what) => (e) => { toast(e.message === CANCEL ? `${what}: cancelado` : `${what}: ${e.message}`, e.message === CANCEL ? 'info' : 'error'); return null; };

async function modelUrl(name, id, report) {
  const off = api.onJobProgress((d) => d.jobId === id && report('Descargando modelo (solo la primera vez)…', d.progress));
  try { return mediaUrl(await api.getModel(name, id)); } finally { off(); }
}

// Frames from ffmpeg in batches of `batch` (Uint8Array of whole frames).
async function* frames(opts, frameBytes, batch = 8) {
  const id = await api.framesOpen(opts);
  try {
    for (;;) {
      const b = await api.framesRead(id, frameBytes, batch);
      if (!b || !b.byteLength) return;
      yield own(b);
    }
  } finally { api.framesClose(id); }
}

// Range of the file the clip plays (vidSrc) covering what the clip shows (± margin), at `fps`. ss seeks a
// quarter frame before frame k0 so ffmpeg starts exactly on it: frame j shows file second t0 + j / fps.
function range(clip, media, fps, margin = 0, from = clip.start, to = clipEnd(clip)) {
  const v = vidSrc(clip, media);
  const a = Math.max(0, sourceTime(clip, from, media) - v.off - margin), b = Math.min(v.dur, sourceTime(clip, to, media) - v.off + margin);
  const k0 = Math.floor(a * fps + 1e-6), n = Math.max(1, Math.ceil(b * fps - 1e-6) - k0);
  return { ...v, k0, n, fps, t0: k0 / fps, ss: Math.max(0, (k0 - 0.25) / fps) };
}
// "fps=…," only when sampling below the source rate (the same rate would only add rounding).
const fpsVf = (fps, media) => (fps < (media.fps || 30) - 0.01 ? `fps=${fps},` : '');
// Size with the long side ≈ `long`, both multiples of `mult`.
const dims = (w, h, long, mult) => { const k = long / Math.max(w, h); return [Math.max(mult, Math.round((w * k) / mult) * mult), Math.max(mult, Math.round((h * k) / mult) * mult)]; };
const clipById = (id) => getState().project.clips.find((c) => c.id === id);

// ---------- #4 background removal ----------
const INFER = 512, STORE = 320, MATTE_MAX = 250e6;
function resize(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh), kx = sw / dw, ky = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
      const a = src[y0 * sw + x0] + (src[y0 * sw + x1] - src[y0 * sw + x0]) * wx, b = src[y1 * sw + x0] + (src[y1 * sw + x1] - src[y1 * sw + x0]) * wx;
      out[y * dw + x] = a + (b - a) * wy;
    }
  }
  return out;
}

// Person matte for the clip (portrait matting, no green screen). Stored in the cache as n frames of w×h bytes.
export async function removeBackground(clipId) {
  const p = getState().project, c = clipById(clipId), media = c && mediaOf(p, c);
  if (!c || (c.type !== 'video' && c.type !== 'image')) return toast('Selecciona un video o una imagen'), null;
  const image = c.type === 'image', [iw, ih] = dims(media.width, media.height, INFER, 32), [sw, sh] = dims(media.width, media.height, STORE, 2);
  let fps = image ? 1 : Math.min(30, media.fps || 30);
  // ±0.5 s so small trims keep the matte (it only applies while the clip shows its range).
  let r = image ? { path: media.path, k0: 0, n: 1, fps: 1, t0: 0, ss: 0 } : range(c, media, fps, 0.5);
  // ponytail: whole matte in memory (~57 KB/frame); long clips drop to fewer mattes per second to stay under 250 MB.
  if (!image && r.n * sw * sh > MATTE_MAX) { fps = Math.max(5, Math.floor((MATTE_MAX / (sw * sh)) / (r.n / fps))); r = range(c, media, fps, 0.5); }
  const file = await api.cacheFile(`matte-${hash([r.path, await api.fileTag(r.path), r.k0, r.n, r.fps, iw, ih, sw, sh].join('|'))}.bin`);
  const ok = (await api.fileExists(file)) || await job('Quitando el fondo…', async (report, cancelled, id) => {
    const url = await modelUrl('modnet', id, report);
    const out = new Uint8Array(r.n * sw * sh), P = iw * ih;
    let done = 0;
    report('Quitando el fondo…', 0);
    for await (const b of frames({ file: r.path, ss: r.ss, frames: r.n, vf: `${image ? '' : fpsVf(fps, media)}scale=${iw}:${ih}:flags=bicubic` }, P * 3, 6)) {
      cancelled();
      const { mattes } = await workerTask({ task: 'matte', url, frames: b, w: iw, h: ih }, [b.buffer], 'matte');
      for (let f = 0; f < mattes.length / P && done < r.n; f++, done++) {
        const m = resize(mattes.subarray(f * P, (f + 1) * P), iw, ih, sw, sh), o = done * sw * sh;
        // Light temporal smoothing against flicker (exponential, 1/5 of the previous matte).
        if (done) for (let i = 0; i < m.length; i++) m[i] = (m[i] * 4 + out[o - sw * sh + i] + 2) / 5;
        out.set(m, o);
      }
      report('Quitando el fondo…', done / r.n);
    }
    if (!done) throw new Error('No se pudieron leer los cuadros del video');
    for (; done < r.n; done++) out.copyWithin(done * sw * sh, (done - 1) * sw * sh, done * sw * sh); // stream ended a frame early
    await api.writeFile(file, out.buffer);
    return true;
  }).catch(failed('Quitar fondo'));
  if (!ok) return null;
  await loadMatte(file); // loaded before it applies: no frame of the clip drawn without it
  update((d) => {
    const x = d.clips.find((k) => k.id === clipId);
    if (x) x.matte = { on: true, path: file, src: r.path, t0: r.t0, fps: r.fps, n: r.n, w: sw, h: sh, edge: (x.matte && x.matte.edge) ?? 60 };
  });
  toast('Fondo quitado');
  return file;
}

// ---------- #4 face reframing ----------
const faceCache = new Map();
// Face center over the clip, 5 times per second: [{ t: timeline time, u, v }] in source coordinates (0..1),
// gaps filled, median-filtered and smoothed both ways (no lag). null when no face is found.
async function faceTrack(clip, media, report, cancelled, id) {
  const image = clip.type === 'image', fps = image ? 1 : Math.min(5, media.fps || 30);
  const r = image ? { path: media.path, n: 1, ss: 0, t0: 0, fps: 1, off: 0 } : range(clip, media, fps);
  const sw = media.width, sh = media.height, k = Math.min(320 / sw, 240 / sh), iw = Math.round(sw * k), ih = Math.round(sh * k), ox = Math.floor((320 - iw) / 2), oy = Math.floor((240 - ih) / 2);
  const key = [r.path, await api.fileTag(r.path), r.k0, r.n, r.fps].join('|');
  let dets = faceCache.get(key);
  if (!dets) {
    const url = await modelUrl('ultraface', id, report);
    dets = [];
    for await (const b of frames({ file: r.path, ss: r.ss, frames: r.n, vf: `${image ? '' : fpsVf(fps, media)}scale=${iw}:${ih},pad=320:240:${ox}:${oy}` }, 320 * 240 * 3, 16)) {
      cancelled();
      dets.push(...(await workerTask({ task: 'faces', url, frames: b }, [b.buffer], 'faces')).faces);
      report('Buscando la cara…', dets.length / r.n);
    }
    faceCache.set(key, dets);
  }
  // One face per frame: confident and big, preferring the one nearest to the previous pick.
  let last = null;
  const pick = dets.map((fs) => {
    let best = null, bs = -1;
    for (const [sc, x0, y0, x1, y1] of fs) {
      const u = (((x0 + x1) / 2) * 320 - ox) / iw, v = (((y0 + y1) / 2) * 240 - oy) / ih;
      const s = (sc * Math.sqrt((x1 - x0) * (y1 - y0))) / (1 + 4 * (last ? Math.hypot(u - last.u, v - last.v) : 0));
      if (s > bs) { bs = s; best = { u, v }; }
    }
    if (best) last = best;
    return best;
  });
  const idx = pick.map((x, j) => (x ? j : -1)).filter((j) => j >= 0);
  if (!idx.length) return null;
  const smooth = (key2) => {
    const a = pick.map((x, j) => {
      if (x) return x[key2];
      const pj = idx.filter((i) => i < j).pop(), nj = idx.find((i) => i > j);
      if (pj == null) return pick[nj][key2];
      if (nj == null) return pick[pj][key2];
      return pick[pj][key2] + ((pick[nj][key2] - pick[pj][key2]) * (j - pj)) / (nj - pj);
    });
    const m = a.map((_, j) => { const win = a.slice(Math.max(0, j - 2), j + 3).sort((x, y) => x - y); return win[win.length >> 1]; });
    for (let j = 1; j < m.length; j++) m[j] = m[j - 1] + (m[j] - m[j - 1]) * 0.35;
    for (let j = m.length - 2; j >= 0; j--) m[j] = m[j + 1] + (m[j] - m[j + 1]) * 0.35;
    return m;
  };
  const us = smooth('u'), vs = smooth('v');
  return us.map((u, j) => ({ t: image ? clip.start : timeAtSource(clip, r.t0 + j / r.fps + r.off, media), u, v: vs[j] }));
}
const trackAt = (tr, t) => {
  if (t <= tr[0].t) return tr[0];
  for (let i = 1; i < tr.length; i++) if (t <= tr[i].t) { const a = tr[i - 1], b = tr[i], k = (t - a.t) / Math.max(1e-6, b.t - a.t); return { u: a.u + (b.u - a.u) * k, v: a.v + (b.v - a.v) * k }; }
  return tr[tr.length - 1];
};
// Fills the frame with the clip and keyframes its position so the face stays centered (clamped: never shows
// the background). Without a track the clip is just centered.
export function applyReframe(d, clipId, track) {
  const c = d.clips.find((x) => x.id === clipId), media = mediaOf(d, c), W = d.width, H = d.height;
  c.fit = 'fill';
  Object.assign(c.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  for (const k of ['x', 'y', 'scale', 'rotation']) delete c.kf[k];
  if (!track) return;
  const crop = c.crop || { l: 0, t: 0, r: 0, b: 0 };
  const [dw, dh] = fitSize('fill', media.width * (1 - crop.l - crop.r), media.height * (1 - crop.t - crop.b), W, H);
  const mx = Math.max(0, (dw - W) / (2 * W)), my = Math.max(0, (dh - H) / (2 * H)), kx = [], ky = [];
  for (let t = c.start; t < clipEnd(c) + 0.125; t += 0.25) {
    const tt = Math.min(t, clipEnd(c)), f = trackAt(track, tt), [X, Y] = srcToCanvas(c, tt, media.width, media.height, W, H, f.u, f.v);
    kx.push({ t: tt - c.start, v: +clamp((W / 2 - X) / W, -mx, mx).toFixed(5), ease: 'linear' });
    ky.push({ t: tt - c.start, v: +clamp((H / 2 - Y) / H, -my, my).toFixed(5), ease: 'linear' });
  }
  for (const [k, keys] of [['x', kx], ['y', ky]]) {
    if (keys.every((f) => Math.abs(f.v - keys[0].v) < 1e-4)) c.transform[k] = keys[0].v; else c.kf[k] = keys;
  }
}
const reframable = (p, c) => (c.type === 'video' || c.type === 'image') && trackOf(p, c) && trackOf(p, c).main;

// Selected clip follows the face in the current format.
export async function reframeClip(clipId) {
  const p = getState().project, c = clipById(clipId);
  if (!c || (c.type !== 'video' && c.type !== 'image')) return toast('Selecciona un video o una imagen'), false;
  const tr = await job('Reencuadrando (siguiendo la cara)…', (report, cancelled, id) => faceTrack(c, mediaOf(p, c), report, cancelled, id)).catch((e) => failed('Reencuadre')(e) ?? false);
  if (tr === false || !clipById(clipId)) return false;
  update((d) => applyReframe(d, clipId, tr));
  toast(tr ? 'El encuadre sigue la cara' : 'No se detectó ninguna cara: encuadre centrado');
  return !!tr;
}

// Whole project to another format (16:9 → 9:16…): every main-track clip follows its face. One undo step.
export async function autoReframe(aspect = '9:16') {
  const p = getState().project, ids = p.clips.filter((c) => reframable(p, c)).map((c) => c.id);
  if (!ids.length) return toast('No hay clips en la pista principal'), 0;
  const tracks = await job(`Reencuadre automático a ${aspect}…`, async (report, cancelled, id) => {
    const out = {};
    for (const [i, cid] of ids.entries()) {
      const c = p.clips.find((x) => x.id === cid);
      out[cid] = await faceTrack(c, mediaOf(p, c), (l, pr) => report(`Reencuadre: clip ${i + 1} de ${ids.length}…`, pr), cancelled, id);
    }
    return out;
  }).catch((e) => failed('Reencuadre automático')(e) ?? false);
  if (tracks === false) return 0;
  update((d) => {
    const [w, h] = ASPECTS[aspect];
    Object.assign(d, { aspect, width: w, height: h });
    for (const cid of ids) if (d.clips.find((x) => x.id === cid)) applyReframe(d, cid, tracks[cid]);
  });
  const faces = ids.filter((cid) => tracks[cid]).length;
  toast(`Formato ${aspect}: ${faces} de ${ids.length} clips siguen la cara`);
  return faces;
}

// ---------- #6 stabilization ----------
export const STAB_LEVELS = { low: ['Suave', 10], med: ['Media', 30], high: ['Fuerte', 60] };
// Range of the processed copy: the existing one while valid, else what the clip shows ± 0.5 s.
function altRange(c, media) {
  const base = basePath(c, media), a = vidSrc(c, media).alt ? c.alt : null, fps = media.fps || 30;
  if (a) return { base, a, k0: a.k0, n: a.n, fps: a.fps };
  const r = range({ ...c, alt: null }, media, fps, 0.5);
  return { base, a: null, k0: r.k0, n: r.n, fps };
}
const altOf = (r, up, stab) => ({ base: r.base, k0: r.k0, n: r.n, fps: r.fps, t0: r.k0 / r.fps, dur: r.n / r.fps, up, stab, path: (stab || up).path });
async function stabFile(r, input, level, report, id) {
  const off = api.onJobProgress((d) => d.jobId === id && report(null, d.progress));
  try { return await api.stabilize({ ...input, frames: r.n, fps: r.fps, smoothing: STAB_LEVELS[level][1], jobId: id }); } finally { off(); }
}
export async function stabilizeClip(clipId, level = 'med') {
  const p = getState().project, c = clipById(clipId), media = c && mediaOf(p, c);
  if (!c || c.type !== 'video') return toast('Selecciona un clip de video'), null;
  const r = altRange(c, media), up = r.a && r.a.up;
  // Over the upscaled copy when there is one (it starts exactly at frame k0), else over the source.
  const input = up ? { file: up.path, ss: 0 } : { file: r.base, ss: Math.max(0, (r.k0 - 0.25) / r.fps) };
  const out = await job('Estabilizando video…', (report, _c, id) => stabFile(r, input, level, report, id), { cancel: false }).catch(failed('Estabilizar'));
  if (!out) return null;
  update((d) => { const x = d.clips.find((k) => k.id === clipId); if (x) x.alt = altOf(r, up || null, { path: out, level }); });
  toast(`Video estabilizado (${STAB_LEVELS[level][0].toLowerCase()})`);
  return out;
}
export function unstabilize(clipId) {
  update((d) => { const x = d.clips.find((k) => k.id === clipId); if (x && x.alt) x.alt = x.alt.up ? { ...x.alt, stab: null, path: x.alt.up.path } : null; });
}

// ---------- #27b AI upscaling ----------
export async function upscaleClip(clipId) {
  const p = getState().project, c = clipById(clipId), media = c && mediaOf(p, c);
  if (!c || (c.type !== 'video' && c.type !== 'image')) return toast('Selecciona un video o una imagen'), null;
  if (Math.min(media.width, media.height) >= 1080) return toast('Este clip ya está en alta resolución (1080p o más)'), null;
  if (c.type === 'video' && vidSrc(c, media).alt && c.alt.up) return toast('Este clip ya está mejorado'), null;
  // Video needs even sizes (yuv420p); a photo keeps its exact size.
  const w = c.type === 'image' ? media.width : even(media.width), h = c.type === 'image' ? media.height : even(media.height), ow = w * 2, oh = h * 2;
  const upFrame = (url, frame) => workerTask({ task: 'upscale', url, frame, w, h, outW: ow, outH: oh }, [frame.buffer], 'upscaled').then((r) => r.rgba);
  if (c.type === 'image') {
    const file = await api.cacheFile(`up-${hash([media.path, await api.fileTag(media.path), ow].join('|'))}.png`);
    const ok = (await api.fileExists(file)) || await job('Mejorando resolución…', async (report, cancelled, id) => {
      const url = await modelUrl('esrgan', id, report);
      report('Mejorando resolución…', null);
      let px = null;
      for await (const b of frames({ file: media.path, ss: 0, frames: 1, vf: `scale=${w}:${h}` }, w * h * 3, 1)) px = await upFrame(url, b);
      cancelled();
      const cv = new OffscreenCanvas(ow, oh);
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), ow, oh), 0, 0);
      await api.writeFile(file, await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
      return true;
    }).catch(failed('Mejorar resolución'));
    if (!ok) return null;
    const [m] = await importPaths([file]);
    if (!m) return null;
    update((d) => {
      d.media.find((x) => x.id === m.id).name = `${media.name} (×2)`;
      const x = d.clips.find((k) => k.id === clipId); if (x) x.mediaId = m.id;
    });
    toast(`Resolución mejorada: ${ow}×${oh}`);
    return file;
  }
  const r = altRange(c, media), file = await api.cacheFile(`up-${hash([r.base, await api.fileTag(r.base), r.k0, r.n, ow].join('|'))}.mp4`), old = r.a && r.a.stab;
  const alt = await job('Mejorando resolución con IA…', async (report, cancelled, id) => {
    if (!(await api.fileExists(file))) {
      const url = await modelUrl('esrgan', id, report);
      const enc = await api.encOpen({ out: file, w: ow, h: oh, fps: r.fps });
      let done = 0;
      try {
        report('Mejorando resolución con IA…', 0);
        for await (const b of frames({ file: r.base, ss: Math.max(0, (r.k0 - 0.25) / r.fps), frames: r.n, vf: `scale=${w}:${h}` }, w * h * 3, 2)) {
          for (let f = 0; f < b.length / (w * h * 3) && done < r.n; f++, done++) {
            cancelled();
            if (!(await api.encWrite(enc, await upFrame(url, b.slice(f * w * h * 3, (f + 1) * w * h * 3))))) throw new Error('No se pudo escribir el video');
            report(`Mejorando resolución con IA… (${done + 1}/${r.n})`, (done + 1) / r.n);
          }
        }
        if (!done) throw new Error('No se pudieron leer los cuadros del video');
        await api.encClose(enc);
      } catch (e) { await api.encClose(enc, true); throw e; }
    }
    // A stabilized clip stays stabilized: redo it over the upscaled copy.
    const stab = old ? { path: await stabFile(r, { file, ss: 0 }, old.level, report, id), level: old.level } : null;
    return altOf(r, { path: file, w: ow, h: oh }, stab);
  }).catch(failed('Mejorar resolución'));
  if (!alt) return null;
  update((d) => { const x = d.clips.find((k) => k.id === clipId); if (x) x.alt = alt; });
  toast(`Resolución mejorada: ${ow}×${oh}`);
  return file;
}
// Back to the original picture (no stabilization, no upscaling).
export function resetVideo(clipId) { update((d) => { const x = d.clips.find((k) => k.id === clipId); if (x) x.alt = null; }); }

// ---------- #6 motion tracking ----------
// Follows the point (x0, y0) of frame j0 through gray frames (w×h) forward and backward: normalized
// cross-correlation of a (2·half+1)² template in a ±radius window, sub-pixel peak, template slowly refreshed.
export function trackPoint(frames, w, h, j0, x0, y0, { half = 12, radius = 14 } = {}) {
  const S = 2 * half + 1, N = S * S, pos = new Array(frames.length);
  const patch = (img, cx, cy) => {
    const out = new Float32Array(N);
    let k = 0, s = 0, s2 = 0;
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const v = img[clamp(Math.round(cy) + dy, 0, h - 1) * w + clamp(Math.round(cx) + dx, 0, w - 1)];
      out[k++] = v; s += v; s2 += v * v;
    }
    const m = s / N, sd = Math.sqrt(Math.max(1e-6, s2 / N - m * m));
    for (let i = 0; i < N; i++) out[i] = (out[i] - m) / sd;
    return out;
  };
  const search = (img, tpl, cx, cy, R) => {
    const bx = Math.round(cx), by = Math.round(cy), G = 2 * R + 1, sc = new Float32Array(G * G).fill(-1);
    let best = -2, bi = 0;
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const x = bx + ox, y = by + oy;
      if (x - half < 0 || y - half < 0 || x + half >= w || y + half >= h) continue;
      let k = 0, s = 0, s2 = 0, s12 = 0;
      for (let dy = -half; dy <= half; dy++) {
        const row = (y + dy) * w + x;
        for (let dx = -half; dx <= half; dx++) { const v = img[row + dx]; s += v; s2 += v * v; s12 += v * tpl[k++]; }
      }
      const sd = Math.sqrt(Math.max(1e-6, s2 / N - (s / N) ** 2)), ncc = s12 / (N * sd), i = (oy + R) * G + ox + R;
      sc[i] = ncc;
      if (ncc > best) { best = ncc; bi = i; }
    }
    const gx = bi % G, gy = Math.floor(bi / G);
    const sub = (a, b, c) => { const d = a - 2 * b + c; return d < 0 ? clamp((a - c) / (2 * d), -0.5, 0.5) : 0; };
    const fx = gx > 0 && gx < G - 1 ? sub(sc[bi - 1], sc[bi], sc[bi + 1]) : 0, fy = gy > 0 && gy < G - 1 ? sub(sc[bi - G], sc[bi], sc[bi + G]) : 0;
    return { x: bx + gx - R + fx, y: by + gy - R + fy, score: best };
  };
  pos[j0] = [x0, y0];
  for (const dir of [1, -1]) {
    let tpl = patch(frames[j0], x0, y0), x = x0, y = y0, R = radius;
    for (let j = j0 + dir; j >= 0 && j < frames.length; j += dir) {
      const m = search(frames[j], tpl, x, y, R);
      if (m.score > 0.5) {
        x = m.x; y = m.y; R = radius;
        if (m.score > 0.75) { const q = patch(frames[j], x, y); for (let i = 0; i < N; i++) tpl[i] = tpl[i] * 0.85 + q[i] * 0.15; }
      } else R = Math.min(radius * 3, R + radius); // lost: hold still and look wider
      pos[j] = [x, y];
    }
  }
  return pos;
}

// Text, sticker or overlay follows what is under it at the playhead in the video below.
export async function trackObject(clipId) {
  const s = getState(), p = s.project, t = s.time, c = clipById(clipId);
  if (!c || (c.type !== 'text' && !((c.type === 'image' || c.type === 'video') && !trackOf(p, c).main))) return toast('Selecciona un texto, sticker o superposición'), 0;
  if (t < c.start || t >= clipEnd(c)) return toast('Coloca el cursor sobre el clip y encima del objeto a seguir'), 0;
  const W = p.width, H = p.height, tr = transformAt(c, t), X = W / 2 + tr.x * W, Y = H / 2 + tr.y * H;
  let target = null, uv = null;
  for (const v of activeVisual(p, t).map((i) => i.clip).filter((v) => v.id !== c.id && v.type === 'video' && t >= v.start && t < clipEnd(v)).reverse()) {
    const m = mediaOf(p, v), q = canvasToSrc(v, t, m.width, m.height, W, H, X, Y);
    if (q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1) { target = v; uv = q; break; }
  }
  if (!target) return toast('No hay un video debajo para seguir'), 0;
  const media = mediaOf(p, target), fps = Math.min(15, media.fps || 30), a = Math.max(c.start, target.start), b = Math.min(clipEnd(c), clipEnd(target));
  const r = range(target, media, fps, 0, a, b), gw = 320, gh = even((320 * media.height) / media.width);
  const keys = await job('Siguiendo el objeto…', async (report, cancelled) => {
    const fr = [];
    for await (const buf of frames({ file: r.path, ss: r.ss, frames: r.n, vf: `${fpsVf(fps, media)}scale=${gw}:${gh}:flags=area`, pix: 'gray' }, gw * gh, 32)) {
      cancelled();
      for (let i = 0; i < buf.length / (gw * gh); i++) fr.push(buf.subarray(i * gw * gh, (i + 1) * gw * gh));
      report('Siguiendo el objeto…', fr.length / r.n);
    }
    if (!fr.length) throw new Error('No se pudieron leer los cuadros del video');
    const j0 = clamp(Math.round((sourceTime(target, t, media) - r.off - r.t0) * fps), 0, fr.length - 1);
    const pos = trackPoint(fr, gw, gh, j0, uv[0] * gw, uv[1] * gh);
    const [X0, Y0] = srcToCanvas(target, t, media.width, media.height, W, H, uv[0], uv[1]), kx = [], ky = [];
    pos.forEach(([px, py], j) => {
      const tt = timeAtSource(target, r.t0 + j / fps + r.off, media);
      if (tt < c.start - 1e-3 || tt > clipEnd(c) + 1e-3) return;
      const [Xj, Yj] = srcToCanvas(target, tt, media.width, media.height, W, H, px / gw, py / gh), lt = clamp(tt - c.start, 0, c.duration);
      kx.push({ t: lt, v: +(tr.x + (Xj - X0) / W).toFixed(5), ease: 'linear' });
      ky.push({ t: lt, v: +(tr.y + (Yj - Y0) / H).toFixed(5), ease: 'linear' });
    });
    return { kx, ky };
  }).catch(failed('Seguimiento'));
  if (!keys || !keys.kx.length) return 0;
  update((d) => { const x = d.clips.find((k) => k.id === clipId); if (x) { x.kf = { ...x.kf, x: keys.kx, y: keys.ky }; x.tracked = target.id; } });
  toast(`Sigue al objeto (${keys.kx.length} puntos)`);
  return keys.kx.length;
}
export function untrack(clipId) {
  update((d) => { const x = d.clips.find((k) => k.id === clipId); if (x) { delete x.kf.x; delete x.kf.y; delete x.tracked; } });
}

// ---------- #21 scene detection ----------
// Cuts inside what a video clip shows, as timeline times (first frame of each new shot).
async function sceneTimes(c, media, threshold) {
  const fps = media.fps || 30, r = range(c, media, fps);
  const cuts = await api.scenes({ file: r.path, ss: r.ss, dur: r.n / fps, threshold });
  const out = [];
  for (const { t } of cuts) {
    const tt = timeAtSource(c, Math.round(t * fps) / fps + r.off, media);
    if (tt > c.start + 0.1 && tt < clipEnd(c) - 0.1 && !out.some((x) => Math.abs(x - tt) < 0.2)) out.push(tt);
  }
  return out.sort((x, y) => x - y);
}
function splitAt(d, clipId, times) {
  let cur = d.clips.find((x) => x.id === clipId);
  for (const t of times) { const right = splitClip(cur, t); d.clips.push(right); cur = right; }
}
// Splits the selected video clip (or every main-track video when clipId is null) at each scene cut.
export async function splitScenes(clipId = null, threshold = 10) {
  const p = getState().project, m = mainTrack(p);
  const clips = clipId ? p.clips.filter((c) => c.id === clipId && c.type === 'video') : p.clips.filter((c) => c.trackId === m.id && c.type === 'video');
  if (!clips.length) return toast(clipId ? 'Selecciona un clip de video' : 'No hay videos en la pista principal'), 0;
  const found = await job('Detectando escenas…', async (report, cancelled) => {
    const out = {};
    for (const [i, c] of clips.entries()) { cancelled(); report(`Detectando escenas… (${i + 1}/${clips.length})`, i / clips.length); out[c.id] = await sceneTimes(c, mediaOf(p, c), threshold); }
    return out;
  }).catch(failed('Detectar escenas'));
  if (!found) return 0;
  const n = Object.values(found).reduce((s, x) => s + x.length, 0);
  if (n) update((d) => { for (const [id, times] of Object.entries(found)) if (times.length) splitAt(d, id, times); });
  toast(n ? `${n} cambios de escena: ${n + clips.length} clips` : 'No se detectaron cambios de escena');
  return n;
}

// ---------- #26 long video → short clips ----------
// Best moments by speech (transcript), loudness and scene cuts. Returns [{ a, b, score, title }] (timeline s).
export async function findShorts({ count = 3, min = 15, max = 60, language = 'auto' } = {}) {
  let p = getState().project;
  const total = projectDuration(p);
  if (total < min + 1) return toast('El video es demasiado corto para sacar clips'), [];
  let words = (p.transcript && p.transcript.words) || [];
  if (!words.length) {
    words = (await transcribe({ model: localStorage.getItem('whisperModel') || 'onnx-community/whisper-base', language })) || [];
    p = getState().project;
  }
  const res = await job('Buscando los mejores momentos…', async (report, cancelled) => {
    report('Analizando audio y escenas…', null);
    const audio = await timelineAudio(p), step = 0.5, nb = Math.ceil(total / step), db = new Float32Array(nb).fill(-90);
    if (audio) for (let i = 0; i < nb; i++) {
      let s = 0, n = 0;
      for (let j = i * 8000; j < Math.min(audio.length, (i + 1) * 8000); j++) { s += audio[j] * audio[j]; n++; }
      db[i] = n ? Math.max(-90, 10 * Math.log10(s / n + 1e-12)) : -90;
    }
    const sorted = [...db].sort((x, y) => x - y), lo = sorted[Math.floor(nb * 0.1)], hi = sorted[Math.floor(nb * 0.9)];
    const loud = (a, b) => { let s = 0, n = 0; for (let i = Math.floor(a / step); i < Math.min(nb, Math.ceil(b / step)); i++) { s += db[i]; n++; } return clamp(((n ? s / n : -90) - lo) / Math.max(3, hi - lo), 0, 1); };
    const cuts = [0];
    const m = mainTrack(p);
    for (const c of p.clips.filter((x) => x.trackId === m.id)) {
      cancelled();
      cuts.push(c.start);
      if (c.type === 'video') cuts.push(...(await sceneTimes(c, mediaOf(p, c), 10)));
    }
    // Sentences: punctuation or a pause > 0.6 s ends one.
    const sents = [];
    words.forEach((w, i) => {
      const cur = sents[sents.length - 1];
      if (!cur || cur.end) sents.push({ a: w.s, b: w.e, words: [w] }); else { cur.b = w.e; cur.words.push(w); }
      const nx = words[i + 1], last = sents[sents.length - 1];
      last.end = /[.!?…]$/.test(w.text) || !nx || nx.s - w.e > 0.6 || last.words.length >= 30;
    });
    const near = (t, list, d) => list.some((x) => Math.abs(x - t) <= d);
    const target = clamp(30, min, max), cand = [];
    if (sents.length) {
      for (let i = 0; i < sents.length; i++) for (let j = i; j < sents.length && sents[j].b - sents[i].a <= max; j++) if (sents[j].b - sents[i].a >= min) cand.push({ a: sents[i].a, b: sents[j].b, ss: sents.slice(i, j + 1) });
    }
    if (!cand.length) {
      // No speech: windows starting on scene cuts (or every 2 s).
      const starts = [...new Set([...cuts, ...Array.from({ length: Math.floor(total / 2) }, (_, i) => i * 2)])];
      for (const a of starts) for (const len of [min, target, max]) if (a + len <= total + 0.01) cand.push({ a, b: Math.min(total, a + len), ss: [] });
    }
    for (const x of cand) {
      const len = x.b - x.a, ws = x.ss.flatMap((s) => s.words), first = x.ss[0], last = x.ss[x.ss.length - 1];
      const speech = Math.min(1, ws.reduce((s, w) => s + (w.e - w.s), 0) / len), kw = Math.min(1, ws.filter((w) => isKeyword(w.text)).length / Math.max(1, ws.length) / 0.3);
      const hook = first && /[?!¿¡]|\d/.test(first.words.map((w) => w.text).join(' ')) ? 1 : 0, end = last && /[.!?…]$/.test(last.words[last.words.length - 1].text) ? 1 : 0;
      const align = near(x.a, cuts, 0.4) || (first && words.indexOf(first.words[0]) > 0 && first.a - words[words.indexOf(first.words[0]) - 1].e >= 0.5) ? 1 : 0;
      x.score = 0.3 * loud(x.a, x.b) + 0.25 * speech + 0.15 * kw + 0.1 * hook + 0.05 * end + 0.05 * align + 0.1 * (1 - Math.abs(len - target) / target);
      x.title = ws.slice(0, 7).map((w) => w.text).join(' ').replace(/[.,;:]+$/, '');
    }
    const picked = [];
    for (const x of cand.sort((u, v) => v.score - u.score)) {
      if (picked.length >= count) break;
      if (picked.every((y) => x.b <= y.a - 1 || x.a >= y.b + 1)) picked.push(x);
    }
    return picked.sort((u, v) => u.a - v.a).map((x, i) => ({ a: +x.a.toFixed(3), b: +x.b.toFixed(3), score: +x.score.toFixed(3), title: x.title || `Momento ${i + 1}` }));
  }).catch(failed('Clips cortos'));
  return res || [];
}

// One new project per moment (the timeline cut to [a, b]), optionally vertical with face reframing.
export async function createShorts(list, { vertical = true } = {}) {
  const p = getState().project, total = projectDuration(p);
  const ids = await job('Creando clips cortos…', async (report, cancelled, id) => {
    const out = [];
    for (const [i, s] of list.entries()) {
      cancelled();
      const d = structuredClone(p);
      Object.assign(d, { id: uid(), name: `${p.name} · Corto ${i + 1}`, createdAt: Date.now(), updatedAt: Date.now(), thumb: null });
      rippleDelete(d, [[s.b, total + 1], [0, s.a]]);
      if (vertical && d.aspect !== '9:16') {
        const [w, h] = ASPECTS['9:16'];
        Object.assign(d, { aspect: '9:16', width: w, height: h });
        for (const c of d.clips.filter((x) => reframable(d, x))) applyReframe(d, c.id, await faceTrack(c, mediaOf(d, c), (l, pr) => report(`Corto ${i + 1}: reencuadre…`, pr), cancelled, id));
        for (const c of d.clips.filter((x) => x.caption)) { c.transform.y = 0.18; c.text.size = 70; }
      }
      await api.saveProject(d);
      out.push(d.id);
      report(null, (i + 1) / list.length);
    }
    return out;
  }).catch(failed('Crear clips cortos'));
  if (ids) toast(`${ids.length} clips cortos creados: están en Inicio`);
  return ids || [];
}
