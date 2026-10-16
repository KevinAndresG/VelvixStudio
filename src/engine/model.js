// Project data model: factories, time math, keyframes and preset catalogs.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const ASPECTS = {
  '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350],
  '4:3': [1440, 1080], '3:4': [1080, 1440], '21:9': [2560, 1080], '2:1': [2160, 1080],
};

export function newProject(name = 'Proyecto sin título', aspect = '16:9') {
  const [width, height] = ASPECTS[aspect];
  const now = Date.now();
  return {
    id: uid(), name, version: 1, createdAt: now, updatedAt: now,
    width, height, aspect, fps: 30,
    background: { type: 'blur', color: '#000000', blur: 40 },
    media: [], tracks: [newTrack('video', 'Principal', true)], clips: [], markers: [],
  };
}

export const newTrack = (kind, name, main = false) => ({ id: uid(), kind, name: name || TRACK_NAMES[kind], main, muted: false, hidden: false, locked: false });
const TRACK_NAMES = { video: 'Video', audio: 'Audio', text: 'Texto', effect: 'Efectos' };

export const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
export const DEFAULT_FILTER = {
  preset: 'none', intensity: 100, exposure: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  hue: 0, fade: 0, vignette: 0, grain: 0, blur: 0, sharpen: 0,
  // Color pro (gl.js): skin smoothing, lift/gamma/gain wheels (puck X/Y + level), RGB curves, HSL per color, LUT.
  skin: 0, liftX: 0, liftY: 0, lift: 0, gammaX: 0, gammaY: 0, gamma: 0, gainX: 0, gainY: 0, gain: 0,
  curves: null, hsl: null, lut: null, lutName: '', lutMix: 100,
};
export const DEFAULT_ANIM = { in: { type: 'none', dur: 0.5 }, out: { type: 'none', dur: 0.5 }, loop: { type: 'none', speed: 1 } };
export const DEFAULT_TEXT = {
  content: 'Texto', font: 'Segoe UI', size: 90, color: '#ffffff', bold: true, italic: false, underline: false,
  align: 'center', lineHeight: 1.15, letterSpacing: 0, uppercase: false,
  stroke: { on: false, color: '#000000', width: 6 },
  shadow: { on: true, color: '#000000aa', blur: 12, x: 0, y: 4 },
  bg: { on: false, color: '#000000', opacity: 70, radius: 16, pad: 18 },
  glow: { on: false, color: '#00e5ff', size: 25 },
  gradient: { on: false, from: '#ff4ecd', to: '#ffd36e' },
  highlight: { on: false, color: '#ffe14d' }, // karaoke word highlight for captions
  keyword: { on: false, color: '#ffe14d' }, // auto-colored key words
  wordAnim: 'none', // per-word entrance timed to speech: pop | bounce | slide | fade
  maxWidth: 0.85,
};
export const DEFAULT_AUDIO_FX = { voice: 'none', pitch: 0, denoise: false, normalize: false, bass: 0, treble: 0, enhance: false };

export function newClip(type, props = {}) {
  const base = {
    id: uid(), type, trackId: null, start: 0, duration: 5, in: 0, speed: 1, name: '',
    transform: { ...DEFAULT_TRANSFORM }, kf: {}, anim: structuredClone(DEFAULT_ANIM), blend: 'source-over',
  };
  if (type === 'video' || type === 'image') {
    Object.assign(base, {
      fit: 'fit', crop: { l: 0, t: 0, r: 0, b: 0 }, filter: { ...DEFAULT_FILTER }, transition: null,
      mask: { type: 'none', x: 0, y: 0, w: 0.6, h: 0.6, feather: 10, invert: false, angle: 0 },
      chroma: { on: false, color: '#00ff00', similarity: 30, smooth: 10 },
      reverse: false, effects: [],
    });
  }
  if (type === 'video' || type === 'audio') {
    Object.assign(base, { volume: 1, muted: false, fadeIn: 0, fadeOut: 0, audioFx: { ...DEFAULT_AUDIO_FX }, detached: false });
  }
  if (type === 'text') base.text = structuredClone(DEFAULT_TEXT);
  if (type === 'effect') Object.assign(base, { effect: { type: 'shake', intensity: 50 }, filter: null });
  return Object.assign(base, props);
}

export const clipEnd = (c) => c.start + c.duration;
export const projectDuration = (p) => p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
export const mediaOf = (p, c) => p.media.find((m) => m.id === c.mediaId);
export const trackOf = (p, c) => p.tracks.find((t) => t.id === c.trackId);

// ---------- speed ----------
export const MAX_SPEED = 100;
// Speed curves: points {x: 0..1 position in the clip, y: relative speed}, linear in between.
// The curve is normalized by its mean, so clip.speed stays the average speed and the clip keeps its
// source span and duration; only how the span is spread over time changes.
const P = (...a) => a.map(([x, y]) => ({ x, y }));
export const SPEED_CURVES = {
  montage: { name: 'Montaje', pts: P([0, 1.4], [0.3, 1.4], [0.42, 0.35], [0.58, 0.35], [0.7, 1.4], [1, 1.4]) },
  hero: { name: 'Héroe', pts: P([0, 2], [0.38, 2], [0.5, 0.2], [0.62, 2], [1, 2]) },
  bullet: { name: 'Bala', pts: P([0, 3], [0.3, 3], [0.42, 0.15], [0.58, 0.15], [0.7, 3], [1, 3]) },
  flashIn: { name: 'Destello entrada', pts: P([0, 5], [0.2, 5], [0.4, 0.8], [1, 0.8]) },
  flashOut: { name: 'Destello salida', pts: P([0, 0.8], [0.6, 0.8], [0.8, 5], [1, 5]) },
  custom: { name: 'Personalizada', pts: P([0, 1], [0.33, 1], [0.66, 1], [1, 1]) },
};
export function curveSpeed(pts, u) {
  if (u <= pts[0].x) return pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (u <= b.x) return b.x === a.x ? b.y : lerp(a.y, b.y, (u - a.x) / (b.x - a.x));
  }
  return pts[pts.length - 1].y;
}
// ∫0^u curve (exact for the piecewise-linear curve).
export function curveArea(pts, u) {
  let s = Math.min(u, pts[0].x) * pts[0].y;
  for (let i = 0; i < pts.length - 1 && u > pts[i].x; i++) {
    const a = pts[i], b = pts[i + 1], w = b.x - a.x;
    if (w <= 0) continue;
    const k = Math.min(1, (u - a.x) / w);
    s += w * (a.y * k + (b.y - a.y) * k * k / 2);
  }
  const last = pts[pts.length - 1];
  return s + Math.max(0, u - last.x) * last.y;
}
// Part [a, b] of a curve rescaled to 0..1 (used by split: each half keeps the exact same mapping).
export function subCurve(pts, a, b) {
  const out = [{ x: 0, y: curveSpeed(pts, a) }];
  for (const p of pts) if (p.x > a && p.x < b) out.push({ x: (p.x - a) / (b - a), y: p.y });
  out.push({ x: 1, y: curveSpeed(pts, b) });
  return out;
}
const hasCurve = (c) => c.curve && c.curve.length > 1;
// Source seconds advanced after `local` timeline seconds into the clip (past the edges: edge speed).
export function srcOffset(clip, local) {
  if (!hasCurve(clip)) return local * clip.speed;
  return (clip.duration * clip.speed * curveArea(clip.curve, local / clip.duration)) / curveArea(clip.curve, 1);
}
// Source offset, average speed and curve of the part [a, b] of clip c (clip-local seconds, may go past
// the edges). Split and trim use it so the kept part plays exactly the same frames as before.
export function subClip(c, a, b) {
  const off = srcOffset(c, a), span = srcOffset(c, b) - off;
  return { off, span, speed: span / (b - a), curve: hasCurve(c) ? subCurve(c.curve, a / c.duration, b / c.duration) : c.curve };
}
// Instantaneous playback rate at timeline time t.
export function speedAt(clip, t) {
  if (!hasCurve(clip)) return clip.speed;
  return (clip.speed * curveSpeed(clip.curve, clamp((t - clip.start) / clip.duration, 0, 1))) / curveArea(clip.curve, 1);
}

// Source media time shown at timeline time t (reverse clips play a reversed proxy).
export function sourceTime(clip, t, media) {
  const off = srcOffset(clip, t - clip.start);
  if (clip.reverse && media) return media.duration - (clip.in + clip.duration * clip.speed) + off;
  return clip.in + off;
}

// ---------- keyframes ----------
// Keys: transform props ('x', 'scale'…), 'volume', or 'group.prop' ('filter.contrast', 'mask.feather').
export const KF_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];
// Easing per keyframe (applies to the segment that starts at it): named or cubic-bezier [x1, y1, x2, y2].
export const EASES = { inOut: [0.65, 0, 0.35, 1], linear: [0, 0, 1, 1], in: [0.55, 0, 1, 0.45], out: [0, 0.55, 0.45, 1], back: [0.34, 1.56, 0.64, 1] };
export const EASE_NAMES = { inOut: 'Suave', linear: 'Lineal', in: 'Acelerar', out: 'Frenar', back: 'Rebote' };
export function bezier([x1, y1, x2, y2], x) {
  const f = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 30; i++) { if (f(x1, x2, t) < x) lo = t; else hi = t; t = (lo + hi) / 2; }
  return f(y1, y2, t);
}
const cubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeFn = (e) => (k) => (!e ? cubic(k) : e === 'linear' ? k : bezier(Array.isArray(e) ? e : EASES[e] || EASES.inOut, k));
export function kfValue(list, local, fallback) {
  if (!list || !list.length) return fallback;
  if (local <= list[0].t) return list[0].v;
  const last = list[list.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    if (local >= a.t && local <= b.t) {
      const k = b.t === a.t ? 1 : (local - a.t) / (b.t - a.t);
      return lerp(a.v, b.v, easeFn(a.ease)(k));
    }
  }
  return fallback;
}
export function baseValue(clip, key) {
  const [g, k] = key.split('.');
  if (k) return clip[g] ? clip[g][k] || 0 : 0;
  return key in clip.transform ? clip.transform[key] : clip[key];
}
function setBase(clip, key, v) {
  const [g, k] = key.split('.');
  if (k) clip[g][k] = v; else if (key in clip.transform) clip.transform[key] = v; else clip[key] = v;
}
export const propAt = (clip, key, t) => kfValue(clip.kf && clip.kf[key], t - clip.start, baseValue(clip, key));
export function transformAt(clip, t) {
  const local = t - clip.start, tr = clip.transform, out = { ...tr };
  for (const p of KF_PROPS) out[p] = kfValue(clip.kf && clip.kf[p], local, tr[p]);
  return out;
}
// Copy of clip[group] with its keyframed props resolved at t (same object when nothing is keyframed).
export function groupAt(clip, group, t) {
  const src = clip[group];
  if (!src || !clip.kf) return src;
  let out = src;
  for (const key in clip.kf) {
    if (!key.startsWith(group + '.') || !clip.kf[key].length) continue;
    if (out === src) out = { ...src };
    out[key.slice(group.length + 1)] = kfValue(clip.kf[key], t - clip.start, 0);
  }
  return out;
}
export const volumeAt = (clip, t) => propAt(clip, 'volume', t);

// ---------- catalogs ----------
// Filter presets expressed in the same adjustment space as manual controls.
export const FILTER_PRESETS = {
  none: { name: 'Ninguno' },
  vivid: { name: 'Vívido', saturation: 35, contrast: 12, exposure: 3 },
  pop: { name: 'Pop', saturation: 55, contrast: 20, temperature: 5 },
  bw: { name: 'B/N', saturation: -100, contrast: 18 },
  noir: { name: 'Noir', saturation: -100, contrast: 45, exposure: -8, vignette: 45 },
  sepia: { name: 'Sepia', sepia: 80, contrast: 5, fade: 10 },
  vintage: { name: 'Vintage', sepia: 30, saturation: -20, fade: 25, temperature: 18, vignette: 35, grain: 25 },
  retro: { name: 'Retro 80s', saturation: 25, temperature: 25, tint: 15, fade: 15, grain: 20 },
  film: { name: 'Película', contrast: 15, saturation: -12, temperature: 8, fade: 12, grain: 30, vignette: 25 },
  cinematic: { name: 'Cine', contrast: 22, saturation: -18, temperature: -12, tint: -6, vignette: 30 },
  tealorange: { name: 'Teal & Orange', contrast: 18, saturation: 15, temperature: 15, tint: -15, hue: -6 },
  warm: { name: 'Cálido', temperature: 35, saturation: 10 },
  golden: { name: 'Hora dorada', temperature: 45, exposure: 6, saturation: 15, fade: 8 },
  cool: { name: 'Frío', temperature: -35, saturation: 5 },
  arctic: { name: 'Ártico', temperature: -50, saturation: -20, exposure: 8, fade: 10 },
  moody: { name: 'Melancólico', exposure: -12, contrast: 20, saturation: -30, temperature: -10, vignette: 40 },
  dreamy: { name: 'Soñador', exposure: 10, contrast: -15, fade: 25, blur: 1, saturation: 10, tint: 10 },
  fresh: { name: 'Fresco', exposure: 8, saturation: 20, temperature: -8, tint: -5 },
  food: { name: 'Comida', saturation: 30, temperature: 15, contrast: 10, exposure: 5 },
  portrait: { name: 'Retrato', exposure: 6, contrast: -6, saturation: -5, temperature: 10, fade: 6 },
  landscape: { name: 'Paisaje', saturation: 40, contrast: 15, temperature: -5, hue: 4 },
  matte: { name: 'Mate', contrast: -10, fade: 35, saturation: -10 },
  faded: { name: 'Desvanecido', fade: 45, saturation: -25, contrast: -10 },
  cyber: { name: 'Cyberpunk', saturation: 40, tint: 35, temperature: -25, contrast: 20, hue: -10 },
  neon: { name: 'Neón', saturation: 70, contrast: 30, hue: 15, vignette: 30 },
  sunset: { name: 'Atardecer', temperature: 40, tint: 20, saturation: 25, vignette: 20 },
  horror: { name: 'Terror', saturation: -60, tint: -30, contrast: 35, exposure: -15, vignette: 60, grain: 30 },
  invert: { name: 'Invertir', invert: 100 },
};

export const FILTER_KEYS = ['exposure', 'brightness', 'contrast', 'saturation', 'temperature', 'tint', 'hue', 'fade', 'vignette', 'grain', 'blur', 'sharpen', 'sepia', 'invert',
  'skin', 'liftX', 'liftY', 'lift', 'gammaX', 'gammaY', 'gamma', 'gainX', 'gainY', 'gain'];

// Combines preset (scaled by intensity) and manual adjustments.
export function effectiveFilter(f) {
  if (!f) return null;
  const p = FILTER_PRESETS[f.preset] || {}, k = (f.intensity ?? 100) / 100, out = {};
  for (const key of FILTER_KEYS) out[key] = (p[key] || 0) * k + (f[key] || 0);
  Object.assign(out, { curves: f.curves, hsl: f.hsl, lut: f.lut, lutMix: f.lutMix ?? 100 });
  return out;
}

export const ANIM_IN = {
  none: 'Ninguna', fade: 'Aparecer', zoomIn: 'Zoom in', zoomOut: 'Zoom out', slideLeft: 'Deslizar ←', slideRight: 'Deslizar →',
  slideUp: 'Deslizar ↑', slideDown: 'Deslizar ↓', rotate: 'Girar', spin: 'Torbellino', bounce: 'Rebote', blur: 'Desenfoque', pop: 'Pop', swing: 'Péndulo',
  typewriter: 'Máquina de escribir (texto)', letters: 'Letra a letra (texto)', wordsUp: 'Palabras ↑ (texto)',
};
export const ANIM_OUT = { ...ANIM_IN };
export const ANIM_LOOP = { none: 'Ninguna', pulse: 'Pulso', shake: 'Temblor', float: 'Flotar', swing: 'Balanceo', spin: 'Rotación', wave: 'Ola (texto)', flicker: 'Parpadeo', heartbeat: 'Latido' };

export const TRANSITIONS = {
  fade: 'Disolver', fadeBlack: 'Fundido negro', fadeWhite: 'Fundido blanco', flash: 'Destello',
  slideLeft: 'Deslizar ←', slideRight: 'Deslizar →', slideUp: 'Deslizar ↑', slideDown: 'Deslizar ↓',
  push: 'Empujar', wipeLeft: 'Barrido ←', wipeRight: 'Barrido →', wipeDown: 'Barrido ↓', circle: 'Círculo', diamond: 'Diamante',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', spin: 'Giro', blur: 'Desenfoque', glitch: 'Glitch', shake: 'Sacudida', split: 'Partir',
};

export const EFFECTS = {
  shake: 'Temblor de cámara', zoomPulse: 'Pulso de zoom', flash: 'Destello', strobe: 'Estroboscopio', glitch: 'Glitch',
  rgbSplit: 'Separación RGB', vhs: 'VHS', oldFilm: 'Película antigua', grain: 'Grano', lightLeak: 'Fuga de luz',
  letterbox: 'Barras cine', mirror: 'Espejo', kaleido: 'Caleidoscopio', blurIn: 'Desenfoque', vignettePulse: 'Viñeta pulsante',
  pixelate: 'Pixelado', bw: 'Destello B/N', heartbeat: 'Latido', rain: 'Lluvia', snow: 'Nieve', sparkles: 'Destellos',
  scanlines: 'Líneas de escaneo', split3: 'Pantalla triple', fisheye: 'Ojo de pez (zoom)', duotone: 'Duotono', neonEdge: 'Brillo neón',
};

export const BLEND_MODES = {
  'source-over': 'Normal', multiply: 'Multiplicar', screen: 'Trama', overlay: 'Superponer', darken: 'Oscurecer', lighten: 'Aclarar',
  'color-dodge': 'Sobreexponer', 'color-burn': 'Subexponer', 'hard-light': 'Luz fuerte', 'soft-light': 'Luz suave', difference: 'Diferencia',
  exclusion: 'Exclusión', hue: 'Tono', saturation: 'Saturación', color: 'Color', luminosity: 'Luminosidad', lighter: 'Añadir',
};

export const VOICES = {
  none: 'Ninguno', chipmunk: 'Ardilla', deep: 'Voz grave', robot: 'Robot', echo: 'Eco', hall: 'Sala', megaphone: 'Megáfono',
  telephone: 'Teléfono', radio: 'Radio', chorus: 'Coro', monster: 'Monstruo', vibrato: 'Vibrato',
};

// Text style presets (CapCut-style "Plantillas de texto").
export const TEXT_PRESETS = [
  { name: 'Clásico', t: { color: '#ffffff', stroke: { on: false }, shadow: { on: true, color: '#000000aa', blur: 12, x: 0, y: 4 }, bg: { on: false }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Contorno', t: { color: '#ffffff', stroke: { on: true, color: '#000000', width: 8 }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Amarillo TikTok', t: { color: '#ffe14d', stroke: { on: true, color: '#000000', width: 9 }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, bold: true } },
  { name: 'Caja negra', t: { color: '#ffffff', stroke: { on: false }, shadow: { on: false }, bg: { on: true, color: '#000000', opacity: 80, radius: 14, pad: 18 }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Caja blanca', t: { color: '#111111', stroke: { on: false }, shadow: { on: false }, bg: { on: true, color: '#ffffff', opacity: 100, radius: 14, pad: 18 }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Neón cian', t: { color: '#e9feff', stroke: { on: false }, shadow: { on: false }, bg: { on: false }, glow: { on: true, color: '#00e5ff', size: 30 }, gradient: { on: false } } },
  { name: 'Neón rosa', t: { color: '#fff0fb', stroke: { on: false }, shadow: { on: false }, bg: { on: false }, glow: { on: true, color: '#ff2fb3', size: 30 }, gradient: { on: false } } },
  { name: 'Degradado', t: { stroke: { on: false }, shadow: { on: true, color: '#00000088', blur: 10, x: 0, y: 4 }, bg: { on: false }, glow: { on: false }, gradient: { on: true, from: '#ff4ecd', to: '#ffd36e' } } },
  { name: 'Océano', t: { stroke: { on: true, color: '#002244', width: 5 }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: true, from: '#5ef2ff', to: '#3a6bff' } } },
  { name: 'Fuego', t: { stroke: { on: false }, shadow: { on: false }, bg: { on: false }, glow: { on: true, color: '#ff5a00', size: 22 }, gradient: { on: true, from: '#fff35c', to: '#ff3d00' } } },
  { name: 'Sombra 3D', t: { color: '#ffffff', stroke: { on: false }, shadow: { on: true, color: '#ff2f6d', blur: 0, x: 7, y: 7 }, bg: { on: false }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Retro', t: { color: '#ffd23f', stroke: { on: true, color: '#3b1f7a', width: 7 }, shadow: { on: true, color: '#ee4266', blur: 0, x: 8, y: 8 }, bg: { on: false }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Rojo impacto', t: { color: '#ffffff', stroke: { on: false }, shadow: { on: false }, bg: { on: true, color: '#e8112d', opacity: 100, radius: 6, pad: 16 }, glow: { on: false }, gradient: { on: false }, uppercase: true } },
  { name: 'Minimal', t: { color: '#ffffff', bold: false, stroke: { on: false }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, letterSpacing: 6, uppercase: true } },
  { name: 'Subtítulo', t: { color: '#ffffff', size: 64, stroke: { on: true, color: '#000000', width: 6 }, shadow: { on: true, color: '#000000aa', blur: 8, x: 0, y: 3 }, bg: { on: false }, glow: { on: false }, gradient: { on: false } } },
  { name: 'Karaoke', t: { color: '#ffffff', stroke: { on: true, color: '#000000', width: 7 }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, highlight: { on: true, color: '#ffe14d' } } },
  // Dynamic caption presets: words enter as they are spoken, key words colored.
  { name: 'Pop dinámico', t: { color: '#ffffff', uppercase: true, stroke: { on: true, color: '#000000', width: 9 }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, wordAnim: 'pop', keyword: { on: true, color: '#ffe14d' } } },
  { name: 'Rebote', t: { color: '#ffffff', stroke: { on: true, color: '#1a1a1a', width: 8 }, shadow: { on: true, color: '#00000099', blur: 0, x: 0, y: 6 }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, wordAnim: 'bounce', keyword: { on: true, color: '#3dff8b' } } },
  { name: 'Deslizar', t: { color: '#ffffff', stroke: { on: false }, shadow: { on: true, color: '#000000aa', blur: 10, x: 0, y: 4 }, bg: { on: true, color: '#000000', opacity: 60, radius: 12, pad: 14 }, glow: { on: false }, gradient: { on: false }, wordAnim: 'slide', keyword: { on: true, color: '#5ee7ff' } } },
  { name: 'Creador', t: { color: '#ffffff', font: 'Arial Black', uppercase: true, stroke: { on: true, color: '#000000', width: 10 }, shadow: { on: false }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, wordAnim: 'pop', keyword: { on: true, color: '#ff3d6e' }, highlight: { on: true, color: '#3dff8b' } } },
  { name: 'Suave', t: { color: '#ffffff', bold: false, stroke: { on: false }, shadow: { on: true, color: '#000000cc', blur: 14, x: 0, y: 3 }, bg: { on: false }, glow: { on: false }, gradient: { on: false }, wordAnim: 'fade', keyword: { on: false } } },
];
export const WORD_ANIMS = { none: 'Ninguna', pop: 'Pop', bounce: 'Rebote', slide: 'Deslizar', fade: 'Aparecer' };

// Words worth coloring in dynamic captions: numbers, shouting, long non-filler words.
const STOP = new Set('porque entonces tambien cuando despues siempre tenemos estamos ustedes nosotros todavia aunque mientras desde hasta about because before through there their these those would should could which really people something'.split(' '));
export function isKeyword(word) {
  const w = String(word).replace(/[^\p{L}\p{N}]/gu, '');
  if (!w) return false;
  if (/\p{N}/u.test(w)) return true;
  const plain = w.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  if (w.length >= 3 && w === w.toUpperCase() && w !== w.toLowerCase()) return true;
  return plain.length >= 7 && !STOP.has(plain);
}

export const STICKERS = ['😀', '😂', '🤣', '😍', '🥰', '😎', '🤩', '😱', '😭', '😡', '🤯', '🥳', '👍', '👏', '🙌', '🔥', '✨', '💯', '❤️', '💔', '⭐', '🌟', '⚡', '💥', '🎉', '🎊', '🎵', '🎶', '📍', '👉', '👈', '👆', '👇', '✅', '❌', '⚠️', '❓', '❗', '💡', '🚀', '🏆', '💰', '📈', '📉', '🍕', '☕', '🌈', '☀️', '🌙', '❄️', '🌊', '🐶', '🐱', '🦄', '👀', '💬', '🗯️', '💤', '🎬', '📸', '🎮'];

export const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Impact', 'Bahnschrift', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Comic Sans MS', 'Courier New', 'Consolas', 'Segoe Script', 'Segoe Print', 'Gabriola', 'Ink Free', 'Candara', 'Cambria', 'Constantia', 'Corbel', 'Franklin Gothic Medium', 'Lucida Console', 'Palatino Linotype', 'Sitka Text'];

export const fmtTime = (s, fps) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return fps ? `${base}:${String(Math.floor((s % 1) * fps)).padStart(2, '0')}` : `${base}.${Math.floor((s % 1) * 10)}`;
};
export const mediaUrl = (p) => window.api.mediaBase + encodeURIComponent(p);

// Sets a prop; if the prop is keyframed, upserts a keyframe at the playhead instead.
export function setProp(clip, key, value, t, fps = 30) {
  const list = clip.kf && clip.kf[key];
  if (list && list.length) {
    const local = clamp(t - clip.start, 0, clip.duration);
    const k = list.find((f) => Math.abs(f.t - local) < 0.5 / fps);
    if (k) k.v = value; else { list.push({ t: local, v: value }); list.sort((a, b) => a.t - b.t); }
  } else setBase(clip, key, value);
}
export function toggleKeyframe(clip, key, t, fps = 30) {
  clip.kf = clip.kf || {};
  const list = (clip.kf[key] = clip.kf[key] || []);
  const local = clamp(t - clip.start, 0, clip.duration);
  const i = list.findIndex((f) => Math.abs(f.t - local) < 0.5 / fps);
  if (i >= 0) list.splice(i, 1);
  else { list.push({ t: local, v: kfValue(list, local, baseValue(clip, key)) }); list.sort((a, b) => a.t - b.t); }
  if (!list.length) delete clip.kf[key];
}
// Keyframes of the clip sitting at the playhead (for the easing editor).
export const kfsAt = (clip, t, fps = 30) => Object.values(clip.kf || {}).flatMap((l) => l.filter((f) => Math.abs(f.t - (t - clip.start)) < 0.5 / fps));
