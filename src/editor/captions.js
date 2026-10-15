import { getState, update, setState, toast, setJob } from '../store.js';
import { newClip, newTrack, uid, projectDuration, DEFAULT_TEXT, TEXT_PRESETS } from '../engine/model.js';
import { audioSegments } from '../engine/sources.js';

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

function placeCaptions(lines, styleIndex = 14) {
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
      for (const k of ['stroke', 'shadow', 'bg', 'glow', 'gradient', 'highlight']) c.text[k] = { ...DEFAULT_TEXT[k], ...(preset[k] || {}) };
      c.transform.y = portrait ? 0.18 : 0.36;
      c.words = line.map((w) => ({ s: w.s - start, e: w.e - start }));
      d.clips.push(c);
    }
  });
}

let worker = null;
export function generateCaptions({ model, language, style }) {
  const p = getState().project;
  const segs = audioSegments(p);
  if (!segs.length) return toast('No hay audio en la línea de tiempo', 'error');
  const jobId = uid();
  setJob(jobId, { label: 'Extrayendo audio…', progress: 0 });
  return new Promise(async (resolve) => {
    try {
      const raw = await window.api.captionsAudio(segs, projectDuration(p));
      const audio = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      worker = worker || new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (data.type === 'download') setJob(jobId, { label: 'Descargando modelo de voz (solo la primera vez)…', progress: data.progress });
        if (data.type === 'status') setJob(jobId, { label: data.msg, progress: null });
        if (data.type === 'error') { setJob(jobId, null); toast('Error de subtítulos: ' + data.msg, 'error'); resolve(false); }
        if (data.type === 'done') {
          setJob(jobId, null);
          const words = toWords(data.chunks);
          if (!words.length) { toast('No se detectó voz'); return resolve(false); }
          placeCaptions(groupWords(words, p.height > p.width ? 22 : 38), style);
          toast(`${words.length} palabras transcritas`);
          resolve(true);
        }
      };
      setJob(jobId, { label: 'Cargando modelo…', progress: null });
      worker.postMessage({ audio, model, language }, [audio.buffer]);
    } catch (e) { setJob(jobId, null); toast('Error: ' + e.message, 'error'); resolve(false); }
  });
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
      for (const k of ['stroke', 'shadow', 'bg', 'glow', 'gradient', 'highlight']) c.text[k] = { ...DEFAULT_TEXT[k], ...(preset[k] || {}) };
    }
  });
}
export const selectCaptionTrack = () => {
  const ids = getState().project.clips.filter((c) => c.caption).map((c) => c.id);
  setState({ selection: ids });
};
