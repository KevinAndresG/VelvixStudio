// Mixed-radix complex FFT (any n made of 2, 3, 4, 5 factors; other primes fall back to a plain DFT step).
// MDX-Net needs n = 7680 (not a power of two), beat detection uses 512.
export function makeFFT(n) {
  const factors = [];
  let m = n;
  for (const p of [4, 2, 3, 5]) while (m % p === 0) { factors.push(p); m /= p; }
  if (m > 1) factors.push(m);
  const wr = new Float64Array(n), wi = new Float64Array(n);
  for (let i = 0; i < n; i++) { wr[i] = Math.cos((-2 * Math.PI * i) / n); wi[i] = Math.sin((-2 * Math.PI * i) / n); }
  const xr = new Float64Array(16), xi = new Float64Array(16);
  // out[oo + q·m + k] = DFT (size len) of in[io + j·stride]; decimation in time, one factor per level.
  function rec(ir, ii, or, oi, io, stride, oo, len, fi) {
    if (len === 1) { or[oo] = ir[io]; oi[oo] = ii[io]; return; }
    const p = factors[fi], ms = len / p, step = n / len;
    for (let j = 0; j < p; j++) rec(ir, ii, or, oi, io + j * stride, stride * p, oo + j * ms, ms, fi + 1);
    for (let k = 0; k < ms; k++) {
      for (let j = 0; j < p; j++) {
        const a = oo + j * ms + k, w = (j * k * step) % n, r = or[a], i = oi[a];
        xr[j] = r * wr[w] - i * wi[w]; xi[j] = r * wi[w] + i * wr[w];
      }
      for (let q = 0; q < p; q++) {
        let sr = 0, si = 0;
        for (let j = 0; j < p; j++) { const w = ((j * q * n) / p) % n; sr += xr[j] * wr[w] - xi[j] * wi[w]; si += xr[j] * wi[w] + xi[j] * wr[w]; }
        or[oo + q * ms + k] = sr; oi[oo + q * ms + k] = si;
      }
    }
  }
  // Forward transform of (re, im) into (outRe, outIm). Inverse: swap re/im on input and output, divide by n.
  return (re, im, outRe, outIm) => rec(re, im, outRe, outIm, 0, 1, 0, n, 0);
}

export const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); // periodic, like torch.hann_window

// FFT check: a pure cosine at bin 3 of 7680 lands on bins 3 and n−3 with magnitude n/2.
export function selfTest() {
  const n = 7680, f = makeFFT(n), re = new Float64Array(n), im = new Float64Array(n), or = new Float64Array(n), oi = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 3 * i) / n);
  f(re, im, or, oi);
  return Math.abs(or[3] - n / 2) < 1e-6 && Math.abs(or[n - 3] - n / 2) < 1e-6 && Math.abs(or[4]) < 1e-6;
}
