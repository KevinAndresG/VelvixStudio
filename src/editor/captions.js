import { getState, update, setState, toast, setJob } from '../store.js';
import { newClip, newTrack, uid, projectDuration, DEFAULT_TEXT, TEXT_PRESETS } from '../engine/model.js';
import { audioSegments } from '../engine/sources.js';
import { applyVocab, parseVocab, getVocab, addCaptionEmojis, setCaptionContent, isEmoji } from './transcript.js';

export const WHISPER_MODELS = {
  'onnx-community/whisper-tiny': 'Rápido (75 MB)',
  'onnx-community/whisper-base': 'Equilibrado (150 MB)',
  'onnx-community/whisper-small': 'Preciso (500 MB)',
};
export const LANGS = { auto: 'Detectar', es: 'Español', en: 'Inglés', pt: 'Portugués', fr: 'Francés', it: 'Italiano', de: 'Alemán', ja: 'Japonés', ko: 'Coreano', zh: 'Chino', ru: 'Ruso', ar: 'Árabe', hi: 'Hindi' };

// Groups word timings into readable caption lines.
export function groupWords(words, maxChars) {
  const lines = [];
  let cur = [];
  const flush = () => { if (cur.length) lines.push(cur); cur = []; };
  for (const w of words) {
    const text = cur.map((x) => x.text).join(' ');
    const gap = cur.length ? w.s - cur[cur.length - 1].e : 0;
    if (cur.length && (text.length + w.text.length + 1 > maxChars || gap > 0.7 || cur.length >= 7)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return lines;
}

function toWords(chunks) {
  const words = [];
  for (const ch of chunks) {
    const [s, e] = ch.timestamp;
    const parts = ch.text.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) { words.push({ text: parts[0], s, e: e ?? s + 0.4 }); continue; }
    // Chunk-level timestamps only: spread words by character length.
    const end = e ?? s + parts.length * 0.35, total = parts.reduce((a, w) => a + w.length + 1, 0);
    let t = s;
    for (const w of parts) { const d = ((w.length + 1) / total) * (end - s); words.push({ text: w, s: t, e: t + d }); t += d; }
  }
  return words;
}

export function placeCaptions(lines, styleIndex = 14, { emojis = false } = {}) {
  const p = getState().project;
  const portrait = p.height > p.width;
  const preset = TEXT_PRESETS[styleIndex].t;
  update((d) => {
    d.clips = d.clips.filter((c) => !c.caption);
    let tk = d.tracks.find((t) => t.caption);
    if (!tk) { tk = { ...newTrack('text', 'Subtítulos'), caption: true }; d.tracks.splice(0, 0, tk); }
    for (const line of lines) {
      const start = line[0].s, end = Math.max(line[line.length - 1].e, start + 0.3);
      const c = newClip('text', { name: 'Subtítulo', start, duration: end - start, trackId: tk.id, caption: true });
      c.text = { ...structuredClone(DEFAULT_TEXT), ...structuredClone(preset), content: line.map((w) => w.text).join(' '), size: portrait ? 70 : 60 };
      for (const k of ['stroke', 'shadow', 'bg', 'glow', 'gradient', 'highlight', 'keyword']) c.text[k] = { ...DEFAULT_TEXT[k], ...(preset[k] || {}) };
      c.transform.y = portrait ? 0.18 : 0.36;
      c.words = line.map((w) => ({ text: w.text, s: w.s - start, e: w.e - start }));
      d.clips.push(c);
    }
    if (emojis) addCaptionEmojis(d);
  });
}

let worker = null;
const getWorker = () => (worker = worker || new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' }));

// Speech → project.transcript.words (timeline seconds), with the user vocabulary applied.
export function transcribe({ model, language }) {
  const p = getState().project;
  const segs = audioSegments(p);
  if (!segs.length) { toast('No hay audio en la línea de tiempo', 'error'); return Promise.resolve(null); }
  const jobId = uid();
  setJob(jobId, { label: 'Extrayendo audio…', progress: 0 });
  return new Promise(async (resolve) => {
    try {
      const raw = await window.api.captionsAudio(segs, projectDuration(p));
      const audio = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const w = getWorker();
      w.onmessage = ({ data }) => {
        if (data.type === 'download') setJob(jobId, { label: 'Descargando modelo de voz (solo la primera vez)…', progress: data.progress });
        if (data.type === 'status') setJob(jobId, { label: data.msg, progress: null });
        if (data.type === 'error') { setJob(jobId, null); toast('Error de subtítulos: ' + data.msg, 'error'); resolve(null); }
        if (data.type === 'done') {
          setJob(jobId, null);
          const words = applyVocab(toWords(data.chunks), parseVocab(getVocab()));
          if (!words.length) { toast('No se detectó voz'); return resolve(null); }
          update((d) => { d.transcript = { words, lang: language }; });
          resolve(words);
        }
      };
      setJob(jobId, { label: 'Cargando modelo…', progress: null });
      w.postMessage({ audio, model, language }, [audio.buffer]);
    } catch (e) { setJob(jobId, null); toast('Error: ' + e.message, 'error'); resolve(null); }
  });
}

export function captionsFromTranscript(style = 14, opts = {}) {
  const p = getState().project, words = p.transcript && p.transcript.words;
  if (!words || !words.length) return 0;
  const lines = groupWords(words, p.height > p.width ? 22 : 38);
  placeCaptions(lines, style, opts);
  return lines.length;
}

export async function generateCaptions({ model, language, style, emojis = false }) {
  const words = await transcribe({ model, language });
  if (!words) return false;
  captionsFromTranscript(style, { emojis });
  toast(`${words.length} palabras transcritas`);
  return true;
}

// ---------- translation (opus-mt in the Whisper worker) ----------
export const TRANSLATE_LANGS = { es: 'Español', en: 'Inglés', fr: 'Francés', de: 'Alemán', it: 'Italiano', pt: 'Portugués', ru: 'Ruso', zh: 'Chino', ar: 'Árabe', hi: 'Hindi', ja: 'Japonés (solo origen)', ko: 'Coreano (solo origen)' };
export function translateTexts(texts, src, tgt, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    w.onmessage = ({ data }) => {
      if (data.type === 'download') onProgress('Descargando traductor (solo la primera vez)…', data.progress);
      if (data.type === 'status') onProgress(data.msg, data.progress ?? null);
      if (data.type === 'error') reject(new Error(data.msg));
      if (data.type === 'translated') resolve(data.texts);
    };
    w.postMessage({ task: 'translate', texts, src, tgt });
  });
}
export async function translateCaptions(src, tgt) {
  const caps = getState().project.clips.filter((c) => c.caption).sort((a, b) => a.start - b.start);
  if (!caps.length) return toast('Primero genera subtítulos'), false;
  if (src === tgt) return toast('Elige un idioma distinto'), false;
  const jobId = uid();
  setJob(jobId, { label: 'Cargando traductor…', progress: null });
  try {
    // Emojis stay out of the model and are re-appended.
    const split = caps.map((c) => { const t = c.text.content.split(/\s+/).filter(Boolean); return [t.filter((x) => !isEmoji(x)).join(' '), t.filter(isEmoji)]; });
    const out = await translateTexts(split.map((x) => x[0]), src, tgt, (label, progress) => setJob(jobId, { label, progress }));
    update((d) => {
      caps.forEach((c, i) => { const x = d.clips.find((k) => k.id === c.id); if (x) setCaptionContent(x, [out[i], ...split[i][1]].join(' ')); });
    });
    toast(`${caps.length} subtítulos traducidos`);
    return true;
  } catch (e) { toast('Error al traducir: ' + e.message, 'error'); return false; }
  finally { setJob(jobId, null); }
}

// ---------- SRT ----------
const srtTime = (s) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
export function toSRT(project) {
  return project.clips.filter((c) => c.type === 'text' && !c.sticker).sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.text.content}\n`).join('\n');
}
export function fromSRT(text, style = 14) {
  const parse = (t) => { const [h, m, rest] = t.trim().replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +rest; };
  const lines = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const rows = block.split('\n').filter(Boolean);
    const ti = rows.findIndex((r) => r.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = rows[ti].split('-->');
    const s = parse(a), e = parse(b), content = rows.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '');
    const parts = content.split(/\s+/).filter(Boolean), step = (e - s) / Math.max(1, parts.length);
    lines.push(parts.map((w, i) => ({ text: w, s: s + i * step, e: s + (i + 1) * step })));
  }
  if (lines.length) placeCaptions(lines, style);
  return lines.length;
}

export function restyleCaptions(styleIndex) {
  const preset = TEXT_PRESETS[styleIndex].t;
  update((d) => {
    for (const c of d.clips) if (c.caption) {
      const content = c.text.content, size = c.text.size;
      c.text = { ...c.text, ...structuredClone(preset), content, size: preset.size ? c.text.size : size };
      for (const k of ['stroke', 'shadow', 'bg', 'glow', 'gradient', 'highlight', 'keyword']) c.text[k] = { ...DEFAULT_TEXT[k], ...(preset[k] || {}) };
      c.text.wordAnim = preset.wordAnim || 'none';
    }
  });
}
export const selectCaptionTrack = () => {
  const ids = getState().project.clips.filter((c) => c.caption).map((c) => c.id);
  setState({ selection: ids });
};
