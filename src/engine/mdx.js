// MDX-Net vocal separation (UVR "Voc_FT"): STFT → ONNX model predicts the vocal spectrogram → iSTFT.
// Same chunking as UVR: windows of chunk samples with n_fft/2 trimmed at each side, instrumental = mix − vocals.
import { makeFFT, hann } from './fft.js';

export const MDX = { nfft: 7680, hop: 1024, dimF: 3072, dimT: 256, compensate: 1.021, rate: 44100 };

// L, R: Float32Array at 44.1 kHz. run(Float32Array [1,4,dimF,dimT]) → Promise<Float32Array> same shape.
export async function separate(L, R, run, onProgress = () => {}) {
  const { nfft, hop, dimF, dimT, compensate } = MDX;
  const chunk = hop * (dimT - 1), trim = nfft / 2, gen = chunk - 2 * trim, n = L.length;
  const fft = makeFFT(nfft), win = hann(nfft), half = nfft / 2;
  const re = new Float64Array(nfft), im = new Float64Array(nfft), or = new Float64Array(nfft), oi = new Float64Array(nfft);
  const vocals = [new Float32Array(n), new Float32Array(n)];
  const pad = gen - (n % gen), total = n + pad, chunks = total / gen;
  const spec = new Float32Array(4 * dimF * dimT);
  const seg = new Float64Array(chunk), ola = new Float64Array(chunk + nfft), wsum = new Float64Array(chunk + nfft);
  for (let k = 0; k < dimT; k++) for (let i = 0; i < nfft; i++) wsum[k * hop + i] += win[i] * win[i];
  for (let ci = 0; ci < chunks; ci++) {
    const at = ci * gen - trim; // chunk start in the (zero-padded) mix
    spec.fill(0);
    for (let ch = 0; ch < 2; ch++) {
      const src = ch ? R : L;
      for (let i = 0; i < chunk; i++) { const j = at + i; seg[i] = j >= 0 && j < n ? src[j] : 0; }
      for (let t = 0; t < dimT; t++) {
        // center=True: frame t is centered on sample t·hop, reflect padding at the chunk edges.
        for (let i = 0; i < nfft; i++) {
          let j = t * hop + i - half;
          if (j < 0) j = -j; else if (j >= chunk) j = 2 * chunk - 2 - j;
          re[i] = seg[j] * win[i]; im[i] = 0;
        }
        fft(re, im, or, oi);
        for (let f = 0; f < dimF; f++) {
          spec[((ch * 2) * dimF + f) * dimT + t] = or[f];
          spec[((ch * 2 + 1) * dimF + f) * dimT + t] = oi[f];
        }
      }
    }
    const out = await run(spec);
    for (let ch = 0; ch < 2; ch++) {
      ola.fill(0);
      for (let t = 0; t < dimT; t++) {
        // Onesided spectrum (bins ≥ dimF are zero) → full Hermitian spectrum → inverse via swapped re/im.
        re.fill(0); im.fill(0);
        for (let f = 0; f < dimF; f++) {
          const a = out[((ch * 2) * dimF + f) * dimT + t], b = out[((ch * 2 + 1) * dimF + f) * dimT + t];
          re[f] = a; im[f] = b;
          if (f > 0) { re[nfft - f] = a; im[nfft - f] = -b; }
        }
        fft(im, re, oi, or); // swapped in and out: the real part of the inverse lands in `or`
        for (let i = 0; i < nfft; i++) ola[t * hop + i] += (or[i] / nfft) * win[i];
      }
      const dst = vocals[ch];
      for (let i = trim; i < chunk - trim; i++) {
        const j = at + i;
        if (j >= 0 && j < n) dst[j] = (ola[i + half] / Math.max(wsum[i + half], 1e-8)) * compensate;
      }
    }
    onProgress((ci + 1) / chunks);
  }
  const inst = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { inst[0][i] = L[i] - vocals[0][i]; inst[1][i] = R[i] - vocals[1][i]; }
  return { vocals, inst };
}
