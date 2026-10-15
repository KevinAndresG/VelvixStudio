// Media element pool: keeps <video>/<audio>/<img> per clip in sync with the timeline clock.
import { clamp, clipEnd, mediaOf, sourceTime, speedAt, volumeAt, mediaUrl, trackOf } from './model.js';
import { activeVisual } from './render.js';
import { FrameReader } from './decoder.js';

const images = new Map(); // path → HTMLImageElement (shared, images are stateless)
export function imageFor(path) {
  let img = images.get(path);
  if (!img) { img = new Image(); img.decoding = 'async'; img.src = mediaUrl(path); images.set(path, img); }
  return img;
}

// Path the visual element should play (reversed proxy / compatibility proxy / original).
export const videoPath = (clip, media) => (clip.reverse && media.reversed) || media.proxy || media.path;
// Path audio should come from (effects-rendered WAV wins).
export const audioPath = (clip, media) => (clip.fxPath) || (clip.reverse && media.reversed) || media.proxy || media.path;

export function fadeGain(clip, t) {
  const local = t - clip.start;
  let g = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) g *= clamp(local / clip.fadeIn, 0, 1);
  if (clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) g *= clamp((clip.duration - local) / clip.fadeOut, 0, 1);
  return g;
}

function seekTo(el, time) {
  return new Promise((resolve) => {
    if (Math.abs(el.currentTime - time) < 0.0005 && el.readyState >= 2) return resolve();
    let done = false;
    const finish = () => { if (done) return; done = true; el.removeEventListener('seeked', finish); clearTimeout(to); resolve(); };
    const to = setTimeout(finish, 4000);
    el.addEventListener('seeked', finish);
    el.currentTime = time;
  });
}
function whenReady(el) {
  return el.readyState >= 2 ? Promise.resolve() : new Promise((r) => {
    const f = () => { el.removeEventListener('loadeddata', f); el.removeEventListener('error', f); r(); };
    el.addEventListener('loadeddata', f); el.addEventListener('error', f); setTimeout(f, 8000);
  });
}

export class SourcePool {
  constructor(mode = 'preview') {
    this.mode = mode;
    this.videos = new Map(); // clipId → { el, path, gain }
    this.audios = new Map(); // clipId → { el, path, gain }
    this.actx = null;
    this.onError = null;
  }

  _ctx() {
    if (!this.actx) this.actx = new AudioContext({ latencyHint: 'interactive' });
    return this.actx;
  }

  _el(map, clip, path, kind) {
    let e = map.get(clip.id);
    if (e && e.path !== path) { this._drop(map, clip.id); e = null; }
    if (!e) {
      const el = document.createElement(kind);
      el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.playsInline = true; el.preservesPitch = true;
      el.src = mediaUrl(path);
      e = { el, path, gain: null };
      if (this.mode === 'preview') {
        // Route through WebAudio so volume can exceed 100% and fades are sample-accurate.
        const ctx = this._ctx(), src = ctx.createMediaElementSource(el), gain = ctx.createGain();
        src.connect(gain).connect(ctx.destination); e.gain = gain;
      } else el.muted = true;
      el.addEventListener('error', () => this.onError && this.onError(clip, el.error));
      map.set(clip.id, e);
    }
    e.used = performance.now();
    return e;
  }
  _drop(map, id) {
    const e = map.get(id);
    if (!e) return;
    e.el.pause(); e.el.removeAttribute('src'); e.el.load();
    if (e.gain) e.gain.disconnect();
    map.delete(id);
  }

  getDrawable = (clip, media) => {
    if (!media) return null;
    if (clip.type === 'image' || media.type === 'image') {
      const img = imageFor(media.path);
      return img.complete && img.naturalWidth ? { el: img, w: img.naturalWidth, h: img.naturalHeight } : null;
    }
    const e = this.videos.get(clip.id);
    if (!e || e.el.readyState < 2 || !e.el.videoWidth) return null;
    return { el: e.el, w: e.el.videoWidth, h: e.el.videoHeight };
  };

  // Preview: drive elements from the timeline clock.
  sync(project, t, playing) {
    const needVideo = new Set(), needAudio = new Set();
    const lookahead = playing ? 1.5 : 0;
    const visual = activeVisual(project, t);
    if (lookahead) for (const it of activeVisual(project, t + lookahead)) if (!visual.find((v) => v.clip.id === it.clip.id)) visual.push({ ...it, upcoming: true });
    const now = this.actx ? this.actx.currentTime : 0;
    for (const it of visual) {
      const c = it.clip;
      if (c.type !== 'video') continue;
      const media = mediaOf(project, c);
      if (!media || media.missing) continue;
      needVideo.add(c.id);
      const e = this._el(this.videos, c, videoPath(c, media), 'video');
      const want = clamp(sourceTime(c, Math.max(t, c.start - (it.tin || 0)), media), 0, media.duration - 0.01);
      const ownsAudio = !c.detached && !c.fxPath;
      const tk = trackOf(project, c);
      const active = !it.upcoming && t >= c.start && t < clipEnd(c);
      const vol = ownsAudio && active && !c.muted && !(tk && tk.muted) ? volumeAt(c, t) * fadeGain(c, t) : 0;
      if (e.gain) e.gain.gain.setTargetAtTime(vol, now, 0.01);
      this._drive(e.el, want, speedAt(c, t), playing && !it.upcoming);
    }
    for (const c of project.clips) {
      const isAudio = c.type === 'audio' || (c.type === 'video' && c.fxPath && !c.detached);
      if (!isAudio) continue;
      if (!(t >= c.start - lookahead && t < clipEnd(c))) continue;
      const media = mediaOf(project, c);
      if (!media || media.missing) continue;
      needAudio.add(c.id);
      const e = this._el(this.audios, c, audioPath(c, media), 'audio');
      const active = t >= c.start;
      const tk = trackOf(project, c);
      const vol = active && !c.muted && !(tk && tk.muted) ? volumeAt(c, t) * fadeGain(c, t) : 0;
      if (e.gain) e.gain.gain.setTargetAtTime(vol, now, 0.01);
      const want = clamp(sourceTime(c, Math.max(t, c.start), media), 0, media.duration);
      this._drive(e.el, want, speedAt(c, t), playing && active);
    }
    for (const id of [...this.videos.keys()]) if (!needVideo.has(id)) this._park(this.videos, id);
    for (const id of [...this.audios.keys()]) if (!needAudio.has(id)) this._park(this.audios, id);
  }
  _drive(el, want, speed, playing) {
    // Above 16× the element can't play that fast: pause and seek every frame instead.
    if (playing && speed <= 16) {
      const rate = Math.max(0.0625, Math.round(speed * 100) / 100); // rounded: speed curves change it every frame
      if (el.playbackRate !== rate) el.playbackRate = rate;
      if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
      else if (Math.abs(el.currentTime - want) > 0.25 * Math.max(1, rate)) el.currentTime = want;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - want) > 0.02 && !el.seeking) el.currentTime = want;
    }
  }
  // Keep a few idle elements warm for quick scrubbing back; drop the oldest.
  _park(map, id) {
    const e = map.get(id);
    if (!e.el.paused) e.el.pause();
    if (e.gain) e.gain.gain.value = 0;
    if (map.size > 10) {
      const oldest = [...map.entries()].filter(([k]) => k !== id).sort((a, b) => a[1].used - b[1].used)[0];
      if (oldest) this._drop(map, oldest[0]);
    }
  }
  resume() { if (this.actx && this.actx.state === 'suspended') this.actx.resume(); }
  pauseAll() { for (const m of [this.videos, this.audios]) for (const e of m.values()) e.el.pause(); }

  // Export fallback: seek a <video> element to the exact source frame.
  _seekClip(c, media, t) {
    const e = this._el(this.videos, c, videoPath(c, media), 'video');
    const want = clamp(sourceTime(c, t, media), 0, Math.max(0, media.duration - 0.001));
    return whenReady(e.el).then(() => seekTo(e.el, want));
  }

  async prepare(project, t) {
    const jobs = [], keep = new Set();
    for (const it of activeVisual(project, t)) {
      const c = it.clip, media = mediaOf(project, c);
      if (!media) continue;
      if (c.type === 'image') { const img = imageFor(media.path); if (!img.complete) jobs.push(img.decode().catch(() => {})); continue; }
      if (c.type !== 'video') continue;
      keep.add(c.id);
      jobs.push(this._seekClip(c, media, t));
    }
    await Promise.all(jobs);
    for (const id of [...this.videos.keys()]) if (!keep.has(id)) this._drop(this.videos, id);
  }

  destroy() {
    for (const id of [...this.videos.keys()]) this._drop(this.videos, id);
    for (const id of [...this.audios.keys()]) this._drop(this.audios, id);
    if (this.actx) this.actx.close();
  }
}

// Audio segments for ffmpeg (export + captions): one per audible clip.
export function audioSegments(project, range = null) {
  const segs = [];
  for (const c of project.clips) {
    if (c.type !== 'audio' && c.type !== 'video') continue;
    if (c.muted) continue;
    if (c.type === 'video' && c.detached) continue;
    const tk = trackOf(project, c), media = mediaOf(project, c);
    if (!media || (tk && tk.muted) || (c.type === 'video' && !media.hasAudio && !c.fxPath)) continue;
    const path = audioPath(c, media);
    const srcIn = c.reverse && media.reversed ? media.duration - (c.in + c.duration * c.speed) : c.in;
    const seg = { path, in: Math.max(0, srcIn), srcDur: c.duration * c.speed, start: c.start, duration: c.duration, speed: c.speed, volume: c.volume, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0 };
    if (c.curve && c.curve.length > 1) {
      // ponytail: variable speed as n constant-speed pieces with exact boundaries; finer n if pitch steps are audible.
      const n = clamp(Math.ceil(c.duration / 0.1), 4, 80), rev = c.reverse && media.reversed ? media : null, d = c.duration / n;
      seg.pieces = [];
      for (let i = 0; i < n; i++) {
        const a = sourceTime(c, c.start + i * d, rev), b = sourceTime(c, c.start + (i + 1) * d, rev);
        seg.pieces.push({ in: Math.max(0, a), srcDur: b - a, speed: (b - a) / d, duration: d });
      }
    }
    const vk = c.kf && c.kf.volume;
    if (vk && vk.length) {
      // Volume keyframes → gain points in clip time (eased segments sampled), interpolated linearly by ffmpeg.
      const ts = new Set([0, c.duration]);
      vk.forEach((f, i) => {
        ts.add(clamp(f.t, 0, c.duration));
        const nx = vk[i + 1];
        if (nx && f.ease !== 'linear') for (let j = 1; j < 12; j++) ts.add(f.t + ((nx.t - f.t) * j) / 12);
      });
      seg.volume = [...ts].sort((a, b) => a - b).map((x) => [+x.toFixed(4), +volumeAt(c, c.start + x).toFixed(4)]);
    }
    segs.push(seg);
  }
  if (range) return segs.filter((s) => s.start < range[1] && s.start + s.duration > range[0]);
  return segs;
}

// Export pool: WebCodecs sequential decoding per clip, falling back to <video> seeking.
export class ExportPool extends SourcePool {
  constructor() {
    super('export');
    this.readers = new Map(); // clipId → FrameReader
    this.frames = new Map(); // clipId → drawable for the current frame
    this.failed = new Set();
    const base = this.getDrawable;
    this.getDrawable = (clip, media) => (clip.type === 'video' && this.frames.get(clip.id)) || base(clip, media);
  }

  async prepare(project, t) {
    const jobs = [], keep = new Set();
    this.frames.clear();
    for (const it of activeVisual(project, t)) {
      const c = it.clip, media = mediaOf(project, c);
      if (!media) continue;
      if (c.type === 'image') { const img = imageFor(media.path); if (!img.complete) jobs.push(img.decode().catch(() => {})); continue; }
      if (c.type !== 'video') continue;
      keep.add(c.id);
      jobs.push((async () => {
        const want = clamp(sourceTime(c, t, media), 0, Math.max(0, media.duration - 0.001));
        if (!this.failed.has(c.id)) {
          try {
            let r = this.readers.get(c.id);
            if (!r) { r = await FrameReader.open(videoPath(c, media)); this.readers.set(c.id, r); }
            const f = await r.frameAt(want);
            if (f) { this.frames.set(c.id, this._drawable(f, r.meta.rotation, c.id)); return; }
          } catch (e) {
            console.warn('WebCodecs fallback for', c.name, e);
            this.failed.add(c.id);
            const r = this.readers.get(c.id); if (r) { r.close(); this.readers.delete(c.id); }
          }
        }
        await this._seekClip(c, media, t);
      })());
    }
    await Promise.all(jobs);
    for (const [id, r] of [...this.readers]) if (!keep.has(id)) { r.close(); this.readers.delete(id); }
    for (const id of [...this.videos.keys()]) if (!keep.has(id)) this._drop(this.videos, id);
  }

  // Applies container rotation (phone videos) that <video> would apply automatically.
  _drawable(fr, rotation, key) {
    const frame = fr.bmp, w = frame.width, h = frame.height;
    if (!rotation) return { el: frame, w, h };
    const swap = rotation === 90 || rotation === 270;
    let c = this['rot' + key];
    if (!c) c = this['rot' + key] = document.createElement('canvas');
    c.width = swap ? h : w; c.height = swap ? w : h;
    const x = c.getContext('2d');
    x.translate(c.width / 2, c.height / 2); x.rotate((rotation * Math.PI) / 180); x.drawImage(frame, -w / 2, -h / 2);
    return { el: c, w: c.width, h: c.height };
  }

  destroy() {
    for (const r of this.readers.values()) r.close();
    this.readers.clear();
    super.destroy();
  }
}
