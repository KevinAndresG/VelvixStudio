// Speech-to-text off the UI thread. Model files download once from Hugging Face and stay cached.
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('../../ort/', self.location.href.replace(/assets\/.*$/, '')).href;

let asr = null, loaded = null;

async function load(model, onProgress) {
  if (asr && loaded === model) return asr;
  const device = (await navigator.gpu?.requestAdapter?.()) ? 'webgpu' : 'wasm';
  const opts = { device, progress_callback: onProgress, dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8' };
  asr = await pipeline('automatic-speech-recognition', model, opts);
  loaded = model;
  return asr;
}

// Subtitle translation with opus-mt (Marian). Pairs without a direct model pivot through English.
const translators = new Map();
const TO_EN = { es: 'es-en', fr: 'fr-en', de: 'de-en', it: 'it-en', pt: 'ROMANCE-en', ru: 'ru-en', zh: 'zh-en', ja: 'ja-en', ko: 'ko-en', ar: 'ar-en', hi: 'hi-en' };
const FROM_EN = { es: 'en-es', fr: 'en-fr', de: 'en-de', it: 'en-it', pt: 'en-ROMANCE', ru: 'en-ru', zh: 'en-zh', ar: 'en-ar', hi: 'en-hi' };
export function route(src, tgt) {
  if (src === tgt) return [];
  const hops = [];
  if (src !== 'en') { if (!TO_EN[src]) throw new Error('Idioma de origen no soportado: ' + src); hops.push([TO_EN[src], '']); }
  if (tgt !== 'en') { if (!FROM_EN[tgt]) throw new Error('Idioma de destino no soportado: ' + tgt); hops.push([FROM_EN[tgt], tgt === 'pt' ? '>>pt_br<< ' : '']); }
  return hops;
}
async function translate({ texts, src, tgt }) {
  let cur = texts;
  for (const [m, prefix] of route(src, tgt)) {
    if (!translators.has(m)) {
      const files = {};
      translators.set(m, await pipeline('translation', 'Xenova/opus-mt-' + m, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (e) => {
          if (e.status !== 'progress' || !e.total) return;
          files[e.file] = [e.loaded, e.total];
          const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
          self.postMessage({ type: 'download', progress: l / t });
        },
      }));
    }
    const tr = translators.get(m), next = [];
    for (let i = 0; i < cur.length; i++) {
      self.postMessage({ type: 'status', msg: 'Traduciendo…', progress: i / cur.length });
      next.push(cur[i].trim() ? (await tr(prefix + cur[i]))[0].translation_text : '');
    }
    cur = next;
  }
  self.postMessage({ type: 'translated', texts: cur });
}

self.onmessage = async ({ data }) => {
  if (data.task === 'translate') return translate(data).catch((e) => self.postMessage({ type: 'error', msg: String(e && e.message || e) }));
  const { audio, model, language } = data;
  try {
    const files = {};
    const p = await load(model, (e) => {
      if (e.status === 'progress' && e.total) {
        files[e.file] = [e.loaded, e.total];
        const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
        self.postMessage({ type: 'download', progress: l / t });
      }
    });
    self.postMessage({ type: 'status', msg: 'Transcribiendo…' });
    const opts = { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', language: language === 'auto' ? null : language };
    let out;
    try { out = await p(audio, { ...opts, return_timestamps: 'word' }); }
    catch { out = await p(audio, { ...opts, return_timestamps: true }); }
    self.postMessage({ type: 'done', chunks: out.chunks || [{ text: out.text, timestamp: [0, audio.length / 16000] }] });
  } catch (e) {
    self.postMessage({ type: 'error', msg: String(e && e.message || e) });
  }
};
