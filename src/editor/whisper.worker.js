// Speech-to-text off the UI thread. Model files download once from Hugging Face and stay cached.
import { pipeline, env } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web';
import { separate, MDX } from '../engine/mdx.js';

env.allowLocalModels = false;
ort.env.logLevel = 'error'; // models with initializers listed as inputs (UltraFace) log hundreds of warnings
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

// ---------- vision (Sesión 6): person matte, faces, super-resolution ----------
// Model files come from the main process (models folder, served over the media server).
const visions = new Map();
function vision(url, useGpu = true) {
  if (!visions.has(url)) {
    visions.set(url, (async () => {
      const gpu = useGpu && !!(await navigator.gpu?.requestAdapter?.());
      const opts = (ep) => ({ executionProviders: ep, logSeverityLevel: 3 });
      try { return await ort.InferenceSession.create(url, opts(gpu ? ['webgpu', 'wasm'] : ['wasm'])); }
      catch (e) { if (!gpu) throw e; return ort.InferenceSession.create(url, opts(['wasm'])); }
    })().catch((e) => { visions.delete(url); throw e; }));
  }
  return visions.get(url);
}
const runOne = async (s, data, dims) => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', data, dims) }));
// RGB24 frames → planar float tensor input.
function planar(src, off, P, out, f) { for (let i = 0; i < P; i++) for (let c = 0; c < 3; c++) out[c * P + i] = f(src[off + i * 3 + c]); }

// MODNet: frames (rgb24, w×h multiples of 32) → alpha 0..255 per pixel.
async function matte({ url, frames, w, h }) {
  const s = await vision(url), P = w * h, n = frames.length / (P * 3), out = new Uint8Array(n * P), inp = new Float32Array(3 * P);
  for (let f = 0; f < n; f++) {
    planar(frames, f * P * 3, P, inp, (v) => v / 127.5 - 1);
    const r = (await runOne(s, inp, [1, 3, h, w]))[s.outputNames[0]].data;
    for (let i = 0; i < P; i++) out[f * P + i] = Math.max(0, Math.min(255, Math.round(r[i] * 255)));
  }
  self.postMessage({ type: 'matte', mattes: out }, [out.buffer]);
}

// UltraFace RFB-320: frames (rgb24 320×240) → per frame [[score, x0, y0, x1, y1], …] (0..1), after NMS.
// WASM only: tiny model (a few ms per frame) and the WebGPU kernel for its output fails.
async function faces({ url, frames }) {
  const s = await vision(url, false), P = 320 * 240, n = frames.length / (P * 3), inp = new Float32Array(3 * P), out = [];
  const iou = (a, b) => { const w = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), h = Math.max(0, Math.min(a[4], b[4]) - Math.max(a[2], b[2])), i = w * h; return i / ((a[3] - a[1]) * (a[4] - a[2]) + (b[3] - b[1]) * (b[4] - b[2]) - i); };
  for (let f = 0; f < n; f++) {
    planar(frames, f * P * 3, P, inp, (v) => (v - 127) / 128);
    const r = await runOne(s, inp, [1, 3, 240, 320]), sc = r.scores.data, bx = r.boxes.data, cand = [];
    for (let i = 0; i < sc.length / 2; i++) if (sc[i * 2 + 1] > 0.7) cand.push([sc[i * 2 + 1], bx[i * 4], bx[i * 4 + 1], bx[i * 4 + 2], bx[i * 4 + 3]]);
    cand.sort((a, b) => b[0] - a[0]);
    const keep = [];
    for (const c of cand) if (keep.length < 8 && keep.every((k) => iou(k, c) < 0.3)) keep.push(c);
    out.push(keep);
  }
  self.postMessage({ type: 'faces', faces: out });
}

// Real-ESRGAN (4×) of one rgb24 frame, in 192 px tiles with 12 px of context (bounded memory at any size),
// then resized to outW×outH. Returns RGBA.
async function upscale({ url, frame, w, h, outW, outH }) {
  const s = await vision(url), T = 192, M = 12, W4 = w * 4, H4 = h * 4, big = new Uint8ClampedArray(W4 * H4 * 4);
  for (let y0 = 0; y0 < h; y0 += T) for (let x0 = 0; x0 < w; x0 += T) {
    const ax = Math.max(0, x0 - M), ay = Math.max(0, y0 - M), bx = Math.min(w, x0 + T + M), by = Math.min(h, y0 + T + M), tw = bx - ax, th = by - ay, P = tw * th;
    const inp = new Float32Array(3 * P);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) for (let c = 0; c < 3; c++) inp[c * P + y * tw + x] = frame[((ay + y) * w + ax + x) * 3 + c] / 255;
    const o = (await runOne(s, inp, [1, 3, th, tw]))[s.outputNames[0]].data, OW = tw * 4, OP = OW * th * 4;
    // Copy only the tile's own area (the context margin is discarded).
    for (let y = (y0 - ay) * 4; y < (Math.min(h, y0 + T) - ay) * 4; y++) for (let x = (x0 - ax) * 4; x < (Math.min(w, x0 + T) - ax) * 4; x++) {
      const d = ((ay * 4 + y) * W4 + ax * 4 + x) * 4;
      for (let c = 0; c < 3; c++) big[d + c] = o[c * OP + y * OW + x] * 255;
      big[d + 3] = 255;
    }
  }
  let px = big;
  if (outW !== W4 || outH !== H4) {
    const a = new OffscreenCanvas(W4, H4), b = new OffscreenCanvas(outW, outH), bx = b.getContext('2d');
    a.getContext('2d').putImageData(new ImageData(big, W4, H4), 0, 0);
    bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, outW, outH);
    px = bx.getImageData(0, 0, outW, outH).data;
  }
  self.postMessage({ type: 'upscaled', rgba: px }, [px.buffer]);
}

self.onmessage = async ({ data }) => {
  const fail = (e) => self.postMessage({ type: 'error', msg: String(e && e.message || e) });
  if (data.task === 'matte') return matte(data).catch(fail);
  if (data.task === 'faces') return faces(data).catch(fail);
  if (data.task === 'upscale') return upscale(data).catch(fail);
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
