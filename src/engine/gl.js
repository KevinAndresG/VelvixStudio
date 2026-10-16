// WebGL2 color pipeline shared by preview and export: one shader does chroma key, skin smoothing, sharpen,
// the basic adjustments (same math as the old CSS filters), lift/gamma/gain wheels, RGB curves, HSL per
// color, 3D LUTs (.cube), fade, vignette and grain. Canvas 2D still composites the graded result
// (transform, masks, blend modes, transitions), which Chromium also runs on the GPU.
import { clamp } from './model.js';

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o;
uniform sampler2D src, curves, matte; uniform sampler3D lut;
uniform vec4 crop; uniform vec2 px, res;
uniform float bright, contrast, sat, hue, sepia, invert, temp, tint, fade, vignette, grain, seed, sharpen, skin, lutMix, lutN;
uniform vec3 lift, gamma, gain;
uniform vec3 hsl[8];
uniform bool useCurves, useLut, useHsl, useChroma, useWheels;
uniform vec4 chroma; uniform bool spill;
uniform bool useMatte; uniform vec2 matteEdge;

vec4 tap(vec2 d) { return texture(src, crop.xy + (vec2(uv.x, 1.0 - uv.y) + d) * crop.zw); }
float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 1e-5) return vec3(0.0, 0.0, l);
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn), h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
vec3 hsl2rgb(vec3 h) {
  vec3 k = clamp(abs(mod(h.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return h.z + h.y * (k - 0.5) * (1.0 - abs(2.0 * h.z - 1.0));
}
const float HUES[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0);
const float WIDTH[8] = float[8](30.0, 30.0, 45.0, 60.0, 60.0, 45.0, 30.0, 45.0);

void main() {
  vec4 s = tap(vec2(0.0));
  vec3 c = s.rgb; float a = s.a;
  if (useChroma) {
    float cb = -0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, cr = 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b;
    float d = distance(vec2(cb, cr), chroma.xy);
    if (d < chroma.z) a = 0.0;
    else if (d < chroma.z + chroma.w) { a *= (d - chroma.z) / chroma.w; if (spill) c.g = min(c.g, (c.r + c.b) * 0.5 + 0.078); }
  }
  // Background removal: the person matte (full source frame, same coordinates as the source) becomes alpha.
  if (useMatte) a *= smoothstep(matteEdge.x, matteEdge.y, texture(matte, crop.xy + vec2(uv.x, 1.0 - uv.y) * crop.zw).r);
  if (skin > 0.0) {
    // Bilateral blur (edge-preserving) blended in only where the pixel looks like skin (YCbCr range).
    float r = skin * 8.0 * min(res.x, res.y) / 1080.0;
    vec3 acc = c; float wsum = 1.0;
    for (int i = 0; i < 16; i++) {
      float ang = float(i) * 0.3927 + (i < 8 ? 0.0 : 0.196), rr = i < 8 ? r : r * 0.5;
      vec3 q = tap(vec2(cos(ang), sin(ang)) * rr * px).rgb, e = q - c;
      float w = exp(-dot(e, e) * 20.0) * (i < 8 ? 0.6 : 1.0);
      acc += q * w; wsum += w;
    }
    float y = dot(c, vec3(0.299, 0.587, 0.114)), cb = 0.5 + (c.b - y) * 0.564, cr = 0.5 + (c.r - y) * 0.713;
    float m = smoothstep(0.27, 0.32, cb) * (1.0 - smoothstep(0.50, 0.55, cb)) * smoothstep(0.50, 0.54, cr) * (1.0 - smoothstep(0.68, 0.72, cr));
    c = mix(c, acc / wsum, min(1.0, skin * 1.5) * m);
  }
  if (sharpen > 0.0) {
    vec3 n = tap(vec2(px.x, 0.0)).rgb + tap(vec2(-px.x, 0.0)).rgb + tap(vec2(0.0, px.y)).rgb + tap(vec2(0.0, -px.y)).rgb;
    c += (c - n * 0.25) * sharpen;
  }
  // Same order and matrices as CSS brightness/contrast/saturate/hue-rotate.
  c *= bright;
  c = (c - 0.5) * contrast + 0.5;
  c = mix(vec3(dot(c, vec3(0.213, 0.715, 0.072))), c, sat);
  if (hue != 0.0) {
    float cs = cos(hue), sn = sin(hue);
    c = mat3(0.213 + cs * 0.787 - sn * 0.213, 0.213 - cs * 0.213 + sn * 0.143, 0.213 - cs * 0.213 - sn * 0.787,
             0.715 - cs * 0.715 - sn * 0.715, 0.715 + cs * 0.285 + sn * 0.140, 0.715 - cs * 0.715 + sn * 0.715,
             0.072 - cs * 0.072 + sn * 0.928, 0.072 - cs * 0.072 - sn * 0.283, 0.072 + cs * 0.928 + sn * 0.072) * c;
  }
  c = clamp(c, 0.0, 1.0);
  if (temp != 0.0) c = mix(c, temp > 0.0 ? vec3(1.0, 0.541, 0.0) : vec3(0.0, 0.467, 1.0), abs(temp));
  if (tint != 0.0) c = mix(c, tint > 0.0 ? vec3(1.0, 0.0, 0.784) : vec3(0.0, 1.0, 0.333), abs(tint));
  if (useWheels) {
    c = c + lift * (1.0 - c);
    c = pow(max(c, 0.0), 1.0 / max(gamma, vec3(0.05)));
    c = clamp(c * gain, 0.0, 1.0);
  }
  if (useCurves) c = vec3(texture(curves, vec2(c.r * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).r, texture(curves, vec2(c.g * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).g, texture(curves, vec2(c.b * 255.0 / 256.0 + 0.5 / 256.0, 0.5)).b);
  if (useHsl) {
    vec3 h = rgb2hsl(c); float dh = 0.0, ds = 0.0, dl = 0.0, hd = h.x * 360.0;
    for (int i = 0; i < 8; i++) {
      float d = abs(hd - HUES[i]); d = min(d, 360.0 - d);
      float w = clamp(1.0 - d / WIDTH[i], 0.0, 1.0);
      dh += w * hsl[i].x; ds += w * hsl[i].y; dl += w * hsl[i].z;
    }
    float k = smoothstep(0.02, 0.2, h.y); // grays have no hue: leave them alone
    h.x = fract(h.x + dh * k * 30.0 / 360.0 + 1.0);
    h.y = clamp(h.y * (1.0 + ds * k), 0.0, 1.0);
    h.z = clamp(h.z + dl * k * 0.25 * h.y, 0.0, 1.0);
    c = hsl2rgb(h);
  }
  if (useLut) c = mix(c, texture(lut, c * (lutN - 1.0) / lutN + 0.5 / lutN).rgb, lutMix);
  if (sepia > 0.0) c = mix(c, clamp(mat3(0.393, 0.349, 0.272, 0.769, 0.686, 0.534, 0.189, 0.168, 0.131) * c, 0.0, 1.0), sepia);
  if (invert > 0.0) c = mix(c, 1.0 - c, invert);
  if (fade != 0.0) c = mix(c, fade > 0.0 ? vec3(0.353) : vec3(0.0), abs(fade));
  if (vignette > 0.0) {
    vec2 q = (uv - 0.5) * res; float r0 = min(res.x, res.y) * 0.3, r1 = length(res) * 0.55;
    c *= 1.0 - clamp((length(q) - r0) / (r1 - r0), 0.0, 1.0) * vignette;
  }
  if (grain > 0.0) {
    float n = h3(vec3(floor(uv * res), seed));
    vec3 ov = mix(2.0 * c * n, 1.0 - 2.0 * (1.0 - c) * (1.0 - n), step(0.5, c));
    c = mix(c, ov, grain);
  }
  c = clamp(c, 0.0, 1.0);
  o = vec4(c * a, a);
}`;

let gl = null, prog, U = {}, tex = {}, size = [0, 0], curveKey = '', lutPath = '', matteKey = '';

function init() {
  const canvas = document.createElement('canvas');
  gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) throw new Error('WebGL2 no disponible');
  canvas.addEventListener('webglcontextlost', () => { gl = null; size = [0, 0]; curveKey = lutPath = matteKey = ''; }); // GPU reset: next frame makes a new context
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(prog, i).name.replace('[0]', ''); U[name] = gl.getUniformLocation(prog, name); }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const mk = (unit, target) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(target, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  tex.src = mk(0, gl.TEXTURE_2D); tex.curves = mk(1, gl.TEXTURE_2D); tex.lut = mk(2, gl.TEXTURE_3D); tex.matte = mk(3, gl.TEXTURE_2D);
  gl.uniform1i(U.src, 0); gl.uniform1i(U.curves, 1); gl.uniform1i(U.lut, 2); gl.uniform1i(U.matte, 3);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

// ---------- curves ----------
// Monotone cubic (Fritsch–Carlson) through the points: no overshoot, so curves never fold back.
export function curveFn(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x), n = p.length;
  if (n < 2) return (x) => x;
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / Math.max(1e-6, p[i + 1].x - p[i].x));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= p[0].x) return p[0].y;
    if (x >= p[n - 1].x) return p[n - 1].y;
    let i = 0; while (x > p[i + 1].x) i++;
    const h = p[i + 1].x - p[i].x, t = (x - p[i].x) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1];
  };
}
const isIdentity = (pts) => !pts || (pts.length === 2 && pts[0].x === 0 && pts[0].y === 0 && pts[1].x === 1 && pts[1].y === 1);
export const hasCurves = (cv) => !!cv && ['m', 'r', 'g', 'b'].some((k) => !isIdentity(cv[k]));
function bakeCurves(cv) {
  const fm = curveFn(cv.m || []), f = ['r', 'g', 'b'].map((k) => curveFn(cv[k] || []));
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = fm(i / 255);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(clamp(f[c](clamp(v, 0, 1)), 0, 1) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---------- LUTs (.cube) ----------
const luts = new Map(); // path → { n, data } | Promise | null (failed)
export function parseCube(text) {
  let n = 0, min = [0, 0, 0], max = [1, 1, 1], vals = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const w = line.split(/\s+/);
    if (w[0] === 'LUT_3D_SIZE') n = +w[1];
    else if (w[0] === 'LUT_1D_SIZE') throw new Error('Solo se admiten LUT 3D');
    else if (w[0] === 'DOMAIN_MIN') min = w.slice(1, 4).map(Number);
    else if (w[0] === 'DOMAIN_MAX') max = w.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(w[0]) && w.length >= 3) vals.push(+w[0], +w[1], +w[2]);
  }
  if (!(n >= 2 && n <= 256) || vals.length !== n * n * n * 3) throw new Error('Archivo .cube no válido');
  const data = new Float32Array(vals.length);
  for (let i = 0; i < vals.length; i++) { const c = i % 3; data[i] = (vals[i] - min[c]) / (max[c] - min[c] || 1); }
  return { n, data };
}
export function loadLut(path) {
  if (!luts.has(path)) {
    luts.set(path, window.api.readFile(path).then(parseCube).then((l) => { luts.set(path, l); return l; }, () => { luts.set(path, null); return null; }));
  }
  const v = luts.get(path);
  return v instanceof Promise ? v : Promise.resolve(v);
}
export const lutState = (path) => { const l = luts.get(path); return l === undefined ? 'none' : l instanceof Promise ? 'loading' : l ? 'ok' : 'error'; };
// Export waits for every LUT so no frame is rendered without its grade.
export const preloadLuts = (project) => Promise.all(project.clips.filter((c) => c.filter && c.filter.lut).map((c) => loadLut(c.filter.lut)));

// ---------- person mattes (background removal) ----------
// File = n frames of w×h bytes back to back (clip.matte has the layout). Loaded whole; export waits for them.
const mattes = new Map(); // path → Uint8Array | Promise | null
export function loadMatte(path) {
  if (!mattes.has(path)) {
    mattes.set(path, fetch(window.api.mediaBase + encodeURIComponent(path)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((b) => { const a = new Uint8Array(b); mattes.set(path, a); return a; }, () => { mattes.set(path, null); return null; }));
  }
  const v = mattes.get(path);
  return v instanceof Promise ? v : Promise.resolve(v);
}
// Frame i of a matte (null while it loads: the preview draws the clip whole until then).
export function matteFrame(m, i) {
  if (!mattes.has(m.path)) loadMatte(m.path);
  const a = mattes.get(m.path);
  if (!a || a instanceof Promise) return null;
  const k = clamp(Math.round(i), 0, m.n - 1), sz = m.w * m.h;
  return { key: m.path + '#' + k, data: a.subarray(k * sz, (k + 1) * sz), w: m.w, h: m.h, edge: m.edge };
}
export const preloadMattes = (project) => Promise.all(project.clips.filter((c) => c.matte && c.matte.on).map((c) => loadMatte(c.matte.path)));

// ---------- grading ----------
// Wheel puck (x, y in −100…100) → RGB offset that keeps luma (hue angle around the color circle).
function wheel(x, y) {
  const m = Math.min(1, Math.hypot(x, y) / 100), a = Math.atan2(y, x);
  return [0, 1, 2].map((i) => Math.cos(a - (i * 2 * Math.PI) / 3) * m);
}
const HSL_KEYS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
export const hasHsl = (h) => !!h && HSL_KEYS.some((k) => h[k] && h[k].some((v) => v));
const WHEEL_KEYS = ['liftX', 'liftY', 'lift', 'gammaX', 'gammaY', 'gamma', 'gainX', 'gainY', 'gain'];

// True when the filter or chroma needs the shader (anything but blur, which canvas 2D still does).
export function needsGrade(f, ck, matte) {
  if (f && f.lut && !luts.has(f.lut)) loadLut(f.lut); // preview: drawn without it until it loads
  if ((ck && ck.on) || matte) return true;
  if (!f) return false;
  for (const k of ['exposure', 'brightness', 'contrast', 'saturation', 'temperature', 'tint', 'hue', 'fade', 'vignette', 'grain', 'sharpen', 'sepia', 'invert', 'skin', ...WHEEL_KEYS]) if (f[k]) return true;
  const l = f.lut && luts.get(f.lut);
  return (!!l && !(l instanceof Promise)) || hasCurves(f.curves) || hasHsl(f.hsl);
}

// Grades the crop of `el` into a w×h image. Returns { el, w, h, crop } to draw with drawImage (the shared
// WebGL canvas never shrinks, so the result is its bottom-left w×h region).
// matte: one frame of a person matte { key, data, w, h, edge } (background removal) or null.
export function grade(el, sw, sh, crop, f, ck, w, h, seed = 0, matte = null) {
  if (!gl) init();
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const cv = gl.canvas;
  if (w > size[0] || h > size[1]) { size = [Math.max(w, size[0]), Math.max(h, size[1])]; cv.width = size[0]; cv.height = size[1]; }
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex.src);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
  const cw = 1 - crop.l - crop.r, ch = 1 - crop.t - crop.b;
  gl.uniform4f(U.crop, crop.l, crop.t, cw, ch);
  gl.uniform2f(U.px, 1 / w, 1 / h); gl.uniform2f(U.res, w, h);
  f = f || {};
  const n = (k) => f[k] || 0;
  gl.uniform1f(U.bright, 1 + (n('exposure') + n('brightness') * 0.6) / 100);
  gl.uniform1f(U.contrast, 1 + n('contrast') / 100);
  gl.uniform1f(U.sat, Math.max(0, 1 + n('saturation') / 100));
  gl.uniform1f(U.hue, (n('hue') * 1.8 * Math.PI) / 180);
  gl.uniform1f(U.sepia, clamp(n('sepia') / 100, 0, 1));
  gl.uniform1f(U.invert, clamp(n('invert') / 100, 0, 1));
  gl.uniform1f(U.temp, clamp(n('temperature') / 260, -1, 1));
  gl.uniform1f(U.tint, clamp(n('tint') / 320, -1, 1));
  gl.uniform1f(U.fade, clamp((n('fade') / 100) * 0.55, -1, 1));
  gl.uniform1f(U.vignette, clamp(n('vignette') / 100, 0, 1));
  gl.uniform1f(U.grain, clamp(n('grain') / 120, 0, 1));
  gl.uniform1f(U.seed, seed % 1000);
  gl.uniform1f(U.sharpen, Math.max(0, n('sharpen') / 100) * 1.5);
  gl.uniform1f(U.skin, clamp(n('skin') / 100, 0, 1));
  const useWheels = WHEEL_KEYS.some((k) => f[k]);
  gl.uniform1i(U.useWheels, useWheels);
  if (useWheels) {
    const [l, g, gn] = [wheel(n('liftX'), n('liftY')), wheel(n('gammaX'), n('gammaY')), wheel(n('gainX'), n('gainY'))];
    gl.uniform3fv(U.lift, l.map((v) => (n('lift') / 100) * 0.3 + v * 0.15));
    gl.uniform3fv(U.gamma, g.map((v) => 1 + (n('gamma') / 100) * 0.6 + v * 0.25));
    gl.uniform3fv(U.gain, gn.map((v) => 1 + (n('gain') / 100) + v * 0.3));
  }
  const useCurves = hasCurves(f.curves);
  gl.uniform1i(U.useCurves, useCurves);
  if (useCurves) {
    const key = JSON.stringify(f.curves);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex.curves);
    if (key !== curveKey) { curveKey = key; gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeCurves(f.curves)); }
  }
  const useHsl = hasHsl(f.hsl);
  gl.uniform1i(U.useHsl, useHsl);
  if (useHsl) gl.uniform3fv(U.hsl, HSL_KEYS.flatMap((k) => (f.hsl[k] || [0, 0, 0]).map((v) => v / 100)));
  const lut = f.lut ? luts.get(f.lut) : null;
  const useLut = !!lut && !(lut instanceof Promise);
  gl.uniform1i(U.useLut, useLut);
  if (useLut) {
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, tex.lut);
    if (lutPath !== f.lut) { lutPath = f.lut; gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.n, lut.n, lut.n, 0, gl.RGB, gl.FLOAT, lut.data); }
    gl.uniform1f(U.lutN, lut.n); gl.uniform1f(U.lutMix, clamp((f.lutMix ?? 100) / 100, 0, 1));
  }
  const on = ck && ck.on;
  gl.uniform1i(U.useChroma, !!on);
  if (on) {
    const v = parseInt(ck.color.slice(1, 7), 16), r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
    gl.uniform4f(U.chroma, -0.1687 * r - 0.3313 * g + 0.5 * b, 0.5 * r - 0.4187 * g - 0.0813 * b, (ck.similarity / 100) * 1.2, Math.max(1 / 255, ck.smooth / 100));
    gl.uniform1i(U.spill, g > r && g > b);
  }
  gl.uniform1i(U.useMatte, !!matte);
  if (matte) {
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tex.matte);
    if (matte.key !== matteKey) { matteKey = matte.key; gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, matte.w, matte.h, 0, gl.RED, gl.UNSIGNED_BYTE, matte.data); }
    // edge 0 = hard cut at 50 %, 100 = the model's soft matte as is.
    const e = clamp((matte.edge ?? 60) / 100, 0, 1) * 0.5;
    gl.uniform2f(U.matteEdge, 0.5 - e, 0.5 + e + 1e-3);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return { el: cv, w: size[0], h: size[1], crop: { l: 0, t: (size[1] - h) / size[1], r: (size[0] - w) / size[0], b: 0 } };
}
