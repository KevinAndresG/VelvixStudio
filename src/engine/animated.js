// Animated stickers with transparency: GIF / animated WebP / APNG (decoded once with WebCodecs' ImageDecoder) and
// Lottie JSON (lottie-web canvas renderer, seeked to the exact frame). Frames are a function of the clip's local time
// and loop, so preview and export show the same picture.
import { mediaUrl } from './model.js';

const MAX_PIXELS = 160e6; // decoded frames kept in memory (w·h·frames); bigger animations import as video
const anims = new Map(); // path → Promise<{ frames: [{ bmp, t }], dur }> (t: start second of each frame)
const ready = new Map(); // path → resolved value (sync access while drawing)
const mimeOf = (p) => (/\.webp$/i.test(p) ? 'image/webp' : /\.a?png$/i.test(p) ? 'image/png' : 'image/gif');

// Frame count, size and duration of an animated image, or null when it is a still (or too big to keep decoded).
export async function probeAnimated(path) {
  if (!window.ImageDecoder) return null;
  try {
    const dec = new ImageDecoder({ data: (await fetch(mediaUrl(path))).body, type: mimeOf(path) });
    await dec.tracks.ready; await dec.completed;
    const tr = dec.tracks.selectedTrack;
    if (!tr || !tr.animated || tr.frameCount < 2) { dec.close(); return null; }
    const first = await dec.decode({ frameIndex: 0 });
    const w = first.image.displayWidth, h = first.image.displayHeight;
    first.image.close(); dec.close();
    if (w * h * tr.frameCount > MAX_PIXELS) return null;
    return { frames: tr.frameCount, width: w, height: h };
  } catch { return null; }
}

export function loadAnimated(path) {
  if (!anims.has(path)) {
    anims.set(path, (async () => {
      const dec = new ImageDecoder({ data: (await fetch(mediaUrl(path))).body, type: mimeOf(path) });
      await dec.tracks.ready; await dec.completed;
      const n = dec.tracks.selectedTrack.frameCount, frames = [];
      let t = 0;
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        // GIFs with no delay play at 10 fps in browsers.
        const d = image.duration ? image.duration / 1e6 : 0.1;
        frames.push({ bmp: await createImageBitmap(image), t });
        t += d < 0.02 ? 0.1 : d;
        image.close();
      }
      dec.close();
      const v = { frames, dur: t };
      ready.set(path, v);
      return v;
    })());
  }
  return anims.get(path);
}

// Drawable of an animated image at clip-local second `local` (null until decoded).
export function animatedAt(path, local) {
  const a = ready.get(path);
  if (!a) { loadAnimated(path).catch(() => {}); return null; }
  const u = ((local % a.dur) + a.dur) % a.dur;
  let lo = 0, hi = a.frames.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a.frames[m].t <= u) lo = m; else hi = m - 1; }
  const b = a.frames[lo].bmp;
  return { el: b, w: b.width, h: b.height };
}

// ---------- Lottie ----------
let lottieLib = null;
const lotties = new Map(); // path → Promise<{ anim, canvas, fr, ip, op, w, h }>
const lottieReady = new Map();
export async function parseLottie(text) {
  const j = JSON.parse(text);
  if (!(j && j.v && j.fr > 0 && j.w > 0 && j.h > 0 && Array.isArray(j.layers) && j.op > j.ip)) throw new Error('No es una animación Lottie');
  return { width: j.w, height: j.h, fps: j.fr, duration: (j.op - j.ip) / j.fr, json: j };
}
export function loadLottie(path) {
  if (!lotties.has(path)) {
    lotties.set(path, (async () => {
      if (!lottieLib) lottieLib = (await import('lottie-web/build/player/lottie_light_canvas.js') /* no expressions: an imported file can't run code (eval) */).default;
      const { json, width, height, fps } = await parseLottie(await window.api.readFile(path));
      // Rendered at ≥1080 px on the short side so it stays sharp when scaled up in the video.
      const k = Math.max(1, Math.min(4, 1080 / Math.min(width, height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * k); canvas.height = Math.round(height * k);
      const ctx = canvas.getContext('2d');
      const anim = lottieLib.loadAnimation({ renderer: 'canvas', loop: false, autoplay: false, animationData: json, rendererSettings: { context: ctx, clearCanvas: false, preserveAspectRatio: 'xMidYMid meet' } });
      await new Promise((r) => { if (anim.isLoaded) r(); else { anim.addEventListener('DOMLoaded', r); setTimeout(r, 3000); } });
      const v = { anim, canvas, ctx, k: canvas.width / width, fps, ip: json.ip, op: json.op, frame: -1 };
      lottieReady.set(path, v);
      return v;
    })());
  }
  return lotties.get(path);
}
export function lottieAt(path, local) {
  const L = lottieReady.get(path);
  if (!L) { loadLottie(path).catch(() => {}); return null; }
  const n = L.op - L.ip, f = (((local * L.fps) % n) + n) % n;
  const q = Math.round(f * 100) / 100;
  if (q !== L.frame) { L.ctx.setTransform(1, 0, 0, 1, 0, 0); L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height); L.ctx.setTransform(L.k, 0, 0, L.k, 0, 0); L.anim.goToAndStop(q, true); L.frame = q; } // ponytail: lottie's clearCanvas mode paints fills black (5.13): we clear and scale ourselves
  return { el: L.canvas, w: L.canvas.width, h: L.canvas.height };
}

// Drawable for an animated media at clip-local second `local`, or undefined when the media isn't animated.
export function animDrawable(media, local) {
  if (media.lottie) return lottieAt(media.path, local);
  if (media.anim) return animatedAt(media.path, local);
  return undefined;
}
export const preloadAnim = (media) => (media.lottie ? loadLottie(media.path) : media.anim ? loadAnimated(media.path) : null);
