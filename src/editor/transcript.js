// Transcript-driven editing: words with timeline times live in project.transcript.words.
// Deleting words, fillers or pauses ripple-cuts that time out of every track.
import { getState, update, toast } from '../store.js';
import { clipEnd, projectDuration } from '../engine/model.js';
import { audioSegments } from '../engine/sources.js';
import { splitClip, packMain, cleanupTracks } from './actions.js';

export const norm = (w) => String(w).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '');

// Merges overlapping [a, b] ranges, ascending.
export function mergeRanges(ranges) {
  const out = [];
  for (const [a, b] of [...ranges].filter(([a, b]) => b - a > 0.01).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.01) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}

// Caption clip keeps only words outside [a, b]; returns false when nothing is left.
function trimCaption(c, a, b) {
  const len = b - a, tokens = c.text.content.split(/\s+/).filter(Boolean);
  const words = c.words.map((w, i) => ({ text: tokens.length === c.words.length ? tokens[i] : w.text, s: c.start + w.s, e: c.start + w.e, i }))
    .filter((w) => { const m = (w.s + w.e) / 2; return m < a || m >= b; })
    .map((w) => (w.s >= b - 1e-4 ? { ...w, s: w.s - len, e: w.e - len } : { ...w, e: Math.min(w.e, a) }));
  if (!words.length) return false;
  c.start = words[0].s;
  c.duration = Math.max(0.3, words[words.length - 1].e - c.start);
  c.text.content = words.map((w) => w.text).join(' ');
  c.words = words.map((w) => ({ text: w.text, s: w.s - c.start, e: Math.max(w.s, w.e) - c.start }));
  // Per-word styles follow their word (indices shift when words before them are cut).
  const ws = c.text.wordStyles;
  if (ws && Object.keys(ws).length) c.text.wordStyles = Object.fromEntries(words.map((w, j) => [j, ws[w.i]]).filter(([, s]) => s));
  return true;
}

// Removes [a, b] ranges from the whole timeline and closes the gaps (ripple delete).
export function rippleDelete(p, ranges) {
  for (const [a, b] of mergeRanges(ranges).reverse()) {
    const len = b - a, out = [];
    for (const c of p.clips) {
      if (clipEnd(c) <= a + 1e-4) { out.push(c); continue; }
      if (c.start >= b - 1e-4) { c.start -= len; out.push(c); continue; }
      if (c.caption && c.words && c.words.length) { if (trimCaption(c, a, b)) out.push(c); continue; }
      if (c.type === 'text' || c.type === 'effect') {
        // Overlays shrink instead of splitting in two.
        const cut = Math.min(b, clipEnd(c)) - Math.max(a, c.start);
        c.duration -= cut; c.start = Math.min(c.start, a);
        if (c.duration > 0.05) out.push(c);
        continue;
      }
      let rest = c;
      if (c.start < a) { rest = splitClip(c, a); out.push(c); }
      if (clipEnd(rest) > b + 1e-4) { const right = splitClip(rest, b); right.start = a; out.push(right); }
    }
    p.clips = out;
    p.markers = (p.markers || []).filter((m) => m.t < a || m.t >= b).map((m) => (m.t >= b ? { ...m, t: m.t - len } : m));
    if (p.transcript) {
      p.transcript.words = p.transcript.words
        .filter((w) => { const m = (w.s + w.e) / 2; return m < a || m >= b; })
        .map((w) => (w.s >= b - 1e-4 ? { ...w, s: w.s - len, e: w.e - len } : { ...w, e: Math.min(w.e, a) }));
    }
  }
  packMain(p);
  cleanupTracks(p);
}

export function cutRanges(ranges, label = 'Recortado') {
  const merged = mergeRanges(ranges);
  if (!merged.length) return 0;
  const total = merged.reduce((s, [a, b]) => s + b - a, 0);
  update((p) => rippleDelete(p, merged));
  toast(`${label}: ${total.toFixed(1)} s eliminados`);
  return total;
}

// Ranges for word indices: each contiguous run plus the gap up to the next kept word.
export function wordRanges(words, indices) {
  const set = new Set(indices), ranges = [];
  for (let i = 0; i < words.length; i++) {
    if (!set.has(i)) continue;
    let j = i;
    while (set.has(j + 1)) j++;
    ranges.push([words[i].s, j + 1 < words.length ? words[j + 1].s : words[j].e]);
    i = j;
  }
  return ranges;
}

// ---------- fillers & silences ----------
const FILLER_RE = /^(e+h*|e+m+|m+|u+m+|u+h+|a+h+|h+m+|e+r+m*|este+|eto+|ehm+)$/;
export const isFiller = (w) => FILLER_RE.test(norm(w));
export const fillerIndices = (words) => words.map((w, i) => (isFiller(w.text) ? i : -1)).filter((i) => i >= 0);

// Silent stretches from the mixed timeline audio (16 kHz mono): RMS per 20 ms window below `db`.
export function silenceRanges(samples, { db = -40, min = 0.6, pad = 0.12, rate = 16000 } = {}) {
  const win = Math.round(rate * 0.02), thr = Math.pow(10, db / 20), out = [];
  let start = -1;
  const n = Math.floor(samples.length / win);
  for (let w = 0; w <= n; w++) {
    let silent = false;
    if (w < n) { let sum = 0; for (let i = w * win; i < (w + 1) * win; i++) sum += samples[i] * samples[i]; silent = Math.sqrt(sum / win) < thr; }
    if (silent && start < 0) start = w;
    if (!silent && start >= 0) {
      const a = (start * win) / rate, b = (w * win) / rate;
      const ca = a === 0 ? 0 : a + pad, cb = w === n ? b : b - pad; // pad = margin of silence kept around speech
      if (b - a >= min && cb - ca > 0.02) out.push([ca, cb]);
      start = -1;
    }
  }
  return out;
}

export async function timelineAudio(p = getState().project) {
  const segs = audioSegments(p);
  if (!segs.length) return null;
  const raw = await window.api.captionsAudio(segs, projectDuration(p));
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}

// ---------- find & replace / vocabulary ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Rewrites caption content; word timings stay put when the word count matches, otherwise spread evenly.
export function setCaptionContent(c, content) {
  const tokens = content.split(/\s+/).filter(Boolean);
  c.text.content = tokens.join(' ');
  if (!c.words || !c.words.length) return;
  if (tokens.length === c.words.length) { c.words.forEach((w, i) => { w.text = tokens[i]; }); return; }
  const s0 = c.words[0].s, e0 = c.words[c.words.length - 1].e, step = (e0 - s0) / Math.max(1, tokens.length);
  c.words = tokens.map((text, i) => ({ text, s: s0 + i * step, e: s0 + (i + 1) * step }));
}

export function findReplace(find, repl, { matchCase = false, wholeWord = true } = {}) {
  if (!find) return 0;
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${esc(find)}(?![\\p{L}\\p{N}])` : esc(find), matchCase ? 'gu' : 'giu');
  let count = 0;
  update((p) => {
    for (const c of p.clips) if (c.caption || (c.type === 'text' && !c.sticker)) {
      const m = c.text.content.match(re);
      if (m) { count += m.length; setCaptionContent(c, c.text.content.replace(re, repl)); }
    }
    if (p.transcript) for (const w of p.transcript.words) w.text = w.text.replace(re, repl);
  });
  return count;
}

// "Velvix" fuzzy-matches mis-heard words (Belbix, velbis…); "mal = Bien" lines are exact fixes.
const sound = (w) => norm(w).replace(/h/g, '').replace(/v/g, 'b').replace(/z|c(?=[ei])/g, 's').replace(/qu|k/g, 'c').replace(/ll/g, 'y');
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
export function parseVocab(text) {
  return String(text || '').split(/\n|,/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [from, to] = l.split(/\s*(?:=|→|->)\s*/);
    return to ? { from, to } : { to: from };
  });
}
// Returns a new word list with vocabulary fixes applied (multi-word terms merge their words).
export function applyVocab(words, vocab) {
  let out = words.map((w) => ({ ...w }));
  for (const { from, to } of vocab) {
    const n = (from || to).split(/\s+/).length, target = sound(from || to);
    const next = [];
    for (let i = 0; i < out.length; i++) {
      const grp = out.slice(i, i + n);
      if (grp.length === n) {
        const got = sound(grp.map((w) => w.text).join(''));
        const ok = from ? got === target : got === target || (target.length >= 4 && lev(got, target) <= Math.max(1, Math.floor(target.length / 4)));
        if (ok) {
          const tail = (grp[n - 1].text.match(/[^\p{L}\p{N}]+$/u) || [''])[0];
          next.push({ ...grp[0], text: to + tail, e: grp[n - 1].e });
          i += n - 1; continue;
        }
      }
      next.push(out[i]);
    }
    out = next;
  }
  return out;
}
export const getVocab = () => { try { return localStorage.getItem('vocab') || ''; } catch { return ''; } };
export const setVocab = (v) => { try { localStorage.setItem('vocab', v); } catch { /* private mode */ } };

// ---------- auto emojis ----------
const EMOJI = {
  amor: '❤️', love: '❤️', corazon: '❤️', heart: '❤️', dinero: '💰', money: '💰', plata: '💰', fuego: '🔥', fire: '🔥',
  feliz: '😀', happy: '😀', triste: '😢', sad: '😢', idea: '💡', musica: '🎵', music: '🎵', comida: '🍕', food: '🍕',
  cafe: '☕', coffee: '☕', tiempo: '⏰', time: '⏰', casa: '🏠', home: '🏠', mundo: '🌍', world: '🌍', gracias: '🙏',
  thanks: '🙏', exito: '🏆', success: '🏆', ganar: '🏆', win: '🏆', rapido: '⚡', fast: '⚡', trabajo: '💼', work: '💼',
  carro: '🚗', coche: '🚗', car: '🚗', viaje: '✈️', travel: '✈️', sol: '☀️', sun: '☀️', perro: '🐶', dog: '🐶',
  gato: '🐱', cat: '🐱', jaja: '😂', haha: '😂', wow: '🤯', increible: '🤩', amazing: '🤩', cuidado: '⚠️', warning: '⚠️',
  pregunta: '❓', question: '❓', crecer: '📈', growth: '📈', video: '🎬', foto: '📸', photo: '📸', juego: '🎮', game: '🎮',
  estrella: '⭐', star: '⭐', fiesta: '🎉', party: '🎉', cerebro: '🧠', brain: '🧠', telefono: '📱', phone: '📱',
  libro: '📚', book: '📚', agua: '💧', water: '💧', mira: '👀', look: '👀', secreto: '🤫', secret: '🤫', nuevo: '✨', new: '✨',
};
export function emojiFor(text) {
  const w = norm(text);
  if (EMOJI[w]) return EMOJI[w];
  for (const k in EMOJI) if (k.length >= 4 && w.startsWith(k)) return EMOJI[k];
  return null;
}
const isEmoji = (t) => /\p{Extended_Pictographic}/u.test(t) && !/[\p{L}\p{N}]/u.test(t);
// Adds one emoji per caption line after its first matching word (idempotent).
export function addCaptionEmojis(p) {
  let n = 0;
  for (const c of p.clips) {
    if (!c.caption || !c.words || !c.words.length || c.words.some((w) => isEmoji(w.text || ''))) continue;
    const tokens = c.text.content.split(/\s+/).filter(Boolean);
    const words = c.words.map((w, i) => ({ ...w, text: tokens.length === c.words.length ? tokens[i] : w.text }));
    const hit = words.find((w) => emojiFor(w.text));
    if (!hit) continue;
    words.push({ text: emojiFor(hit.text), s: hit.s, e: words[words.length - 1].e });
    c.words = words; c.text.content = words.map((w) => w.text).join(' ');
    n++;
  }
  return n;
}
export { isEmoji };
