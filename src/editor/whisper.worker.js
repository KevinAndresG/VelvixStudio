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

self.onmessage = async ({ data }) => {
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
