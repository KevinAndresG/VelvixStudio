// Speech-to-text off the UI thread. Model files download once from Hugging Face and stay cached.
import { pipeline, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';
import { separate, MDX } from '../engine/mdx.js';

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

// Vocal separation with MDX-Net (model file downloaded by the main process, served over the media server).
let mdx = null, mdxUrl = null;
async function stems({ L, R, url }) {
  if (!mdx || mdxUrl !== url) {
    self.postMessage({ type: 'status', msg: 'Cargando modelo de separación…', progress: null });
    const gpu = !!(await navigator.gpu?.requestAdapter?.());
    mdx = await ort.InferenceSession.create(url, { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] });
    mdxUrl = url;
  }
  const run = async (spec) => (await mdx.run({ [mdx.inputNames[0]]: new ort.Tensor('float32', spec, [1, 4, MDX.dimF, MDX.dimT]) }))[mdx.outputNames[0]].data;
  const r = await separate(L, R, run, (p) => self.postMessage({ type: 'status', msg: 'Separando voz y música…', progress: p }));
  const bufs = [...r.vocals, ...r.inst].map((a) => a.buffer);
  self.postMessage({ type: 'stems', vocals: r.vocals, inst: r.inst }, bufs);
}

// Neural text to speech (MMS-TTS / VITS, character based: no phonemizer needed).
const voices = new Map();
async function speak({ text, lang }) {
  const m = 'Xenova/mms-tts-' + lang;
  if (!voices.has(m)) {
    const files = {};
    voices.set(m, await pipeline('text-to-speech', m, {
      dtype: 'q8', device: 'wasm',
      progress_callback: (e) => {
        if (e.status !== 'progress' || !e.total) return;
        files[e.file] = [e.loaded, e.total];
        const [l, t] = Object.values(files).reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
        self.postMessage({ type: 'download', progress: l / t });
      },
    }));
  }
  self.postMessage({ type: 'status', msg: 'Generando voz…', progress: null });
  const out = await voices.get(m)(text);
  self.postMessage({ type: 'speech', audio: out.audio, rate: out.sampling_rate }, [out.audio.buffer]);
}

self.onmessage = async ({ data }) => {
  const fail = (e) => self.postMessage({ type: 'error', msg: String(e && e.message || e) });
  if (data.task === 'stems') return stems(data).catch(fail);
  if (data.task === 'tts') return speak(data).catch(fail);
  if (data.task === 'translate') return translate(data).catch(fail);
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
