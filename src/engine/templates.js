// Project templates: built-in starting points (titles, call-to-action stickers, effects already timed) and the
// user's own (a project saved as a template, media included). Creating from one copies it with fresh ids.
import { newProject, newClip, newTrack, uid, DEFAULT_TEXT, TEXT_PRESETS, TEXT_GROUPS } from './model.js';
import { BADGES } from './stickers.js';

const preset = (name) => (TEXT_PRESETS.find((p) => p.name === name) || TEXT_PRESETS[0]).t;
function text(content, style, start, duration, o = {}) {
  const t = preset(style), c = newClip('text', { name: 'Texto', start, duration });
  c.text = { ...structuredClone(DEFAULT_TEXT), ...structuredClone(t), content, ...(o.text || {}) };
  for (const k of TEXT_GROUPS) c.text[k] = { ...DEFAULT_TEXT[k], ...(t[k] || {}), ...((o.text || {})[k] || {}) };
  Object.assign(c.transform, o.tr || {});
  if (o.in) c.anim.in = { type: o.in, dur: o.inDur || 0.5 };
  if (o.out) c.anim.out = { type: o.out, dur: 0.4 };
  if (o.loop) c.anim.loop = { type: o.loop, speed: 1 };
  return c;
}
function badge(kind, theme, start, duration, o = {}) {
  const def = BADGES[kind], c = newClip('text', { name: `Sticker ${def.name}`, start, duration, sticker: true });
  c.text = { ...structuredClone(DEFAULT_TEXT), content: o.label ?? def.label, size: o.size || 80, badge: { kind, theme: theme || def.theme }, shadow: { ...DEFAULT_TEXT.shadow, on: false } };
  Object.assign(c.transform, { y: 0.3, ...(o.tr || {}) });
  c.anim.in = { type: 'pop', dur: 0.4 }; c.anim.out = { type: 'fade', dur: 0.3 };
  return c;
}
const effect = (type, start, duration, intensity = 50) => newClip('effect', { name: type, start, duration, effect: { type, intensity } });

// layers: [kind, clips] from top to bottom (kind: 'text' | 'effect').
function build(name, aspect, color, layers) {
  const p = newProject(name, aspect);
  p.background = { type: 'color', color, blur: 40 };
  const main = p.tracks[0];
  p.tracks = [];
  for (const [kind, clips] of layers) {
    const tk = newTrack(kind, kind === 'effect' ? 'Efectos' : 'Texto');
    p.tracks.push(tk);
    for (const c of clips) { c.trackId = tk.id; p.clips.push(c); }
  }
  p.tracks.push(main);
  return p;
}

export const TEMPLATES = [
  { id: 'yt-intro', name: 'Intro de YouTube', desc: 'Título 3D, subtítulo y botón de suscribirse', at: 1.4, make: () => build('Intro de YouTube', '16:9', '#14161f', [
    ['effect', [effect('lightLeak', 0, 2.5, 60)]],
    ['text', [badge('subscribe', 'youtube', 3, 4.5)]],
    ['text', [text('TU CANAL', '3D bloque', 0, 7, { in: 'zoomIn', out: 'fade', tr: { y: -0.08 }, text: { size: 150 } }), text('Nuevo video cada semana', 'Minimal', 0.6, 6.4, { in: 'fade', tr: { y: 0.12 }, text: { size: 52 } })]],
  ]) },
  { id: 'hook-916', name: 'Reel / TikTok con gancho', desc: 'Gancho arriba, corazón y botón de seguir al final', at: 1, make: () => build('Reel con gancho', '9:16', '#101010', [
    ['text', [badge('heart', 'instagram', 4, 2.5, { tr: { y: 0.05 }, size: 120 }), badge('follow', 'tiktok', 7, 3, { label: 'SÍGUEME' })]],
    ['text', [text('ESPERA AL FINAL 😱', 'Amarillo TikTok', 0, 3.5, { in: 'pop', loop: 'pulse', tr: { y: -0.32 }, text: { size: 95 } }), text('Pon aquí tu video ↓', 'Caja negra', 0, 10, { in: 'fade', tr: { y: 0.42 }, text: { size: 44 } })]],
  ]) },
  { id: 'product', name: 'Promo de producto', desc: 'Etiqueta NUEVO, nombre del producto y link en la bio', at: 1.6, make: () => build('Promo de producto', '4:5', '#f2efe9', [
    ['effect', [effect('sparkles', 0, 6, 45)]],
    ['text', [badge('link', 'dark', 2.5, 3.5, { tr: { y: 0.36 } })]],
    ['text', [text('NUEVO', 'Rojo impacto', 0.2, 5.8, { in: 'pop', tr: { y: -0.36 }, text: { size: 60 } }), text('Nombre del producto', '3D metal', 0.5, 5.5, { in: 'slideUp', tr: { y: -0.2 }, text: { size: 96, gradient: { on: true, from: '#2b2b2b', to: '#5d6470' }, depth: { color: '#c8c2b8' } } })]],
  ]) },
  { id: 'quote', name: 'Frase o cita', desc: 'Cita con máquina de escribir y autor en arco', at: 3.5, make: () => build('Frase del día', '9:16', '#1b1033', [
    ['effect', [effect('grain', 0, 8, 35)]],
    ['text', [text('— Autor', 'Arco', 2.5, 5.5, { in: 'fade', tr: { y: 0.2 }, text: { size: 60, color: '#ffd36e', curve: -18 } })]],
    ['text', [text('«La creatividad es la inteligencia divirtiéndose»', 'Suave', 0, 8, { in: 'typewriter', inDur: 2.5, tr: { y: -0.05 }, text: { size: 78, maxWidth: 0.8 } })]],
  ]) },
  { id: 'top3', name: 'Top 3', desc: 'Lista con números que entran uno a uno y botón de comentar', at: 4.5, make: () => build('Top 3', '9:16', '#0f2a3d', [
    ['text', [badge('comment', 'tiktok', 7, 3, { label: '¿CUÁL ES EL TUYO?' })]],
    ['text', [text('3. Primer lugar', 'Contorno', 1.5, 8.5, { in: 'slideLeft', tr: { y: -0.08 } }), text('2. Segundo lugar', 'Contorno', 3, 7, { in: 'slideLeft', tr: { y: 0.04 } }), text('1. El mejor', 'Amarillo TikTok', 4.5, 5.5, { in: 'pop', tr: { y: 0.16 }, text: { size: 100 } })]],
    ['text', [text('TOP 3', '3D bloque', 0, 10, { in: 'zoomOut', tr: { y: -0.3 }, text: { size: 170 } })]],
  ]) },
  { id: 'tutorial', name: 'Tutorial paso a paso', desc: 'Título, pasos numerados y botón de guardar', at: 2, make: () => build('Tutorial', '16:9', '#101820', [
    ['text', [badge('save', 'dark', 9, 3, { tr: { x: 0.33, y: 0.36 } })]],
    ['text', [text('PASO 1', 'Rojo impacto', 3, 3, { in: 'slideRight', tr: { x: -0.33, y: -0.36 }, text: { size: 56 } }), text('PASO 2', 'Rojo impacto', 6, 3, { in: 'slideRight', tr: { x: -0.33, y: -0.36 }, text: { size: 56 } }), text('PASO 3', 'Rojo impacto', 9, 3, { in: 'slideRight', tr: { x: -0.33, y: -0.36 }, text: { size: 56 } })]],
    ['text', [text('Cómo hacer…', 'Degradado', 0, 3, { in: 'wordsUp', out: 'fade', text: { size: 130 } })]],
  ]) },
  { id: 'event', name: 'Anuncio de evento', desc: 'Fecha en 3D, lugar y campanita para recordarlo', at: 1.6, make: () => build('Anuncio de evento', '1:1', '#2a0a3d', [
    ['effect', [effect('vignettePulse', 0, 6, 40)]],
    ['text', [badge('bell', 'youtube', 2.5, 3.5, { label: 'NO TE LO PIERDAS' })]],
    ['text', [text('SÁBADO 25', '3D neón', 0, 6, { in: 'pop', tr: { y: -0.15 }, text: { size: 140 } }), text('Lugar · 20:00 h', 'Minimal', 0.8, 5.2, { in: 'fade', tr: { y: 0.05 }, text: { size: 54 } })]],
  ]) },
  { id: 'outro', name: 'Despedida / outro', desc: 'Gracias por ver, me gusta, suscríbete y campanita', at: 3.3, make: () => build('Despedida', '16:9', '#0c0d12', [
    ['text', [badge('like', 'facebook', 1.5, 6.5, { tr: { x: -0.3, y: 0.28 }, size: 70 }), badge('bell', 'youtube', 2.5, 5.5, { tr: { x: 0.3, y: 0.28 }, size: 70 })]],
    ['text', [badge('subscribe', 'youtube', 1, 7, { tr: { y: 0.08 }, size: 95 })]],
    ['text', [text('¡Gracias por ver!', 'Arco', 0, 8, { in: 'letters', inDur: 1, tr: { y: -0.22 }, text: { size: 120, curve: 22 } })]],
  ]) },
];

// New project from a template (built-in `make()` or a saved project): fresh ids, its own name and dates.
export function fromTemplate(tpl, name) {
  const src = tpl.make ? tpl.make() : structuredClone(tpl.project);
  const p = newProject(name || tpl.name, src.aspect);
  const ids = new Map(), id = (old) => { if (!ids.has(old)) ids.set(old, uid()); return ids.get(old); };
  Object.assign(p, { width: src.width, height: src.height, fps: src.fps, background: structuredClone(src.background) });
  p.media = (src.media || []).map((m) => ({ ...m, id: id(m.id) }));
  p.tracks = src.tracks.map((t) => ({ ...t, id: id(t.id) }));
  p.clips = src.clips.map((c) => ({ ...c, id: uid(), trackId: id(c.trackId), mediaId: c.mediaId ? id(c.mediaId) : c.mediaId }));
  p.markers = (src.markers || []).map((m) => ({ ...m, id: uid() }));
  return p;
}
