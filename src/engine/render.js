// Frame compositor shared by preview and export, so the exported video matches the preview exactly.
import { clamp, lerp, clipEnd, transformAt, groupAt, effectiveFilter, mediaOf, isKeyword, sourceTime, vidSrc, matteOn } from './model.js';
import { grade, needsGrade, matteFrame } from './gl.js';
import { drawBadge, badgeSize } from './stickers.js';

// ---------- scratch canvases ----------
const pool = new Map();
function scratch(key, w, h) {
  let c = pool.get(key);
  if (!c) { c = document.createElement('canvas'); pool.set(key, c); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext('2d');
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, w, h); // transparent layers must not show the previous frame
  return [c, x];
}
const rand = (n) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

let noiseCanvas = null;
function noise(seed) {
  if (!noiseCanvas) { noiseCanvas = document.createElement('canvas'); noiseCanvas.width = noiseCanvas.height = 256; }
  const x = noiseCanvas.getContext('2d'), img = x.createImageData(256, 256), d = img.data;
  let s = (seed * 9301 + 49297) % 233280;
  for (let i = 0; i < d.length; i += 4) { s = (s * 9301 + 49297) % 233280; const v = (s / 233280) * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  return noiseCanvas;
}

// ---------- animations ----------
// Returns transform modifiers for clip in/out/loop animations at local time.
export function animState(anim, local, dur) {
  const s = { dx: 0, dy: 0, scale: 1, rot: 0, opacity: 1, blur: 0, reveal: 1, units: null, unitAnim: null, unitP: 1, loopT: local };
  if (!anim) return s;
  const apply = (type, p, dir) => {
    // p: 0 → hidden, 1 → fully shown
    const q = easeOut(p), inv = 1 - q;
    switch (type) {
      case 'fade': s.opacity *= p; break;
      case 'zoomIn': s.scale *= lerp(0.3, 1, q); s.opacity *= p; break;
      case 'zoomOut': s.scale *= lerp(1.8, 1, q); s.opacity *= p; break;
      case 'slideLeft': s.dx += inv * 0.6 * dir; s.opacity *= p; break;
      case 'slideRight': s.dx -= inv * 0.6 * dir; s.opacity *= p; break;
      case 'slideUp': s.dy += inv * 0.5 * dir; s.opacity *= p; break;
      case 'slideDown': s.dy -= inv * 0.5 * dir; s.opacity *= p; break;
      case 'rotate': s.rot += inv * 180; s.opacity *= p; break;
      case 'spin': s.rot += inv * 720; s.scale *= q; break;
      case 'bounce': { const b = p < 1 ? Math.abs(Math.sin(p * Math.PI * 2.5)) * (1 - p) : 0; s.dy -= b * 0.25 * dir; s.opacity *= Math.min(1, p * 3); break; }
      case 'blur': s.blur += inv * 30; s.opacity *= p; break;
      case 'pop': { const o = p < 0.7 ? lerp(0, 1.15, p / 0.7) : lerp(1.15, 1, (p - 0.7) / 0.3); s.scale *= o; break; }
      case 'swing': s.rot += Math.sin(p * Math.PI * 3) * (1 - p) * 30; s.opacity *= Math.min(1, p * 2); break;
      case 'typewriter': s.reveal = Math.min(s.reveal, p); break;
      case 'letters': case 'wordsUp': s.unitAnim = type; s.unitP = Math.min(s.unitP, p); break;
      default: break;
    }
  };
  const ai = anim.in, ao = anim.out;
  if (ai && ai.type !== 'none' && ai.dur > 0 && local < ai.dur) apply(ai.type, clamp(local / ai.dur, 0, 1), 1);
  if (ao && ao.type !== 'none' && ao.dur > 0 && local > dur - ao.dur) apply(ao.type, clamp((dur - local) / ao.dur, 0, 1), -1);
  const lp = anim.loop;
  if (lp && lp.type !== 'none') {
    const t = local * (lp.speed || 1);
    switch (lp.type) {
      case 'pulse': s.scale *= 1 + 0.06 * Math.sin(t * Math.PI * 2); break;
      case 'shake': s.dx += (rand(Math.floor(t * 20)) - 0.5) * 0.02; s.dy += (rand(Math.floor(t * 20) + 7) - 0.5) * 0.02; break;
      case 'float': s.dy += Math.sin(t * Math.PI) * 0.02; break;
      case 'swing': s.rot += Math.sin(t * Math.PI * 1.5) * 8; break;
      case 'spin': s.rot += t * 120; break;
      case 'flicker': s.opacity *= rand(Math.floor(t * 12)) > 0.15 ? 1 : 0.3; break;
      case 'heartbeat': { const f = t % 1; s.scale *= 1 + (f < 0.12 ? Math.sin(f / 0.12 * Math.PI) * 0.1 : f > 0.2 && f < 0.32 ? Math.sin((f - 0.2) / 0.12 * Math.PI) * 0.07 : 0); break; }
      case 'wave': s.units = 'wave'; break;
      default: break;
    }
  }
  return s;
}

// ---------- filters ----------
export function cssFilter(f, W) {
  if (!f) return 'none';
  const parts = [];
  const b = 1 + (f.exposure + f.brightness * 0.6) / 100;
  if (b !== 1) parts.push(`brightness(${b.toFixed(3)})`);
  const c = 1 + f.contrast / 100 + f.sharpen / 400; // ponytail: sharpen approximated as micro-contrast; WebGL unsharp if needed
  if (c !== 1) parts.push(`contrast(${c.toFixed(3)})`);
  if (f.saturation) parts.push(`saturate(${Math.max(0, 1 + f.saturation / 100).toFixed(3)})`);
  if (f.hue) parts.push(`hue-rotate(${(f.hue * 1.8).toFixed(1)}deg)`);
  if (f.sepia) parts.push(`sepia(${(f.sepia / 100).toFixed(3)})`);
  if (f.invert) parts.push(`invert(${(f.invert / 100).toFixed(3)})`);
  if (f.blur > 0) parts.push(`blur(${((f.blur * W) / 1920).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}
const blurCss = (b, W) => (b > 0 ? `blur(${((b * W) / 1920).toFixed(2)}px)` : 'none');
// ---------- visual clip ----------
function maskPath(x, m, dw, dh) {
  const cx = m.x * dw, cy = m.y * dh, w = m.w * dw, h = m.h * dh;
  x.beginPath();
  switch (m.type) {
    case 'circle': x.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'rect': x.roundRect(cx - w / 2, cy - h / 2, w, h, Math.min(w, h) * 0.08); break;
    case 'linear': x.rect(-dw * 3, cy, dw * 6, dh * 6); break;
    case 'mirror': x.rect(-dw * 3, cy - h / 2, dw * 6, h); break;
    case 'heart': {
      const s = Math.min(w, h) / 2;
      x.moveTo(cx, cy + s * 0.9);
      x.bezierCurveTo(cx - s * 1.6, cy - s * 0.1, cx - s * 0.6, cy - s * 1.3, cx, cy - s * 0.45);
      x.bezierCurveTo(cx + s * 0.6, cy - s * 1.3, cx + s * 1.6, cy - s * 0.1, cx, cy + s * 0.9);
      break;
    }
    case 'star': {
      const R = Math.min(w, h) / 2, r = R * 0.45;
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r : R; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.closePath(); break;
    }
    default: break;
  }
}

// Size the (cropped) source is drawn at before the clip's scale: fit / fill / stretch.
export function fitSize(fit, cw, ch, W, H) {
  if (fit === 'stretch') return [W, H];
  const k = fit === 'fill' ? Math.max(W / cw, H / ch) : Math.min(W / cw, H / ch);
  return [cw * k, ch * k];
}
function drawMedia(x, clip, el, sw, sh, W, H, tr, st, crop) {
  const cw = sw * (1 - crop.l - crop.r), ch = sh * (1 - crop.t - crop.b);
  if (cw <= 0 || ch <= 0) return null;
  const [dw, dh] = fitSize(clip.fit, cw, ch, W, H);
  x.translate(W / 2 + (tr.x + st.dx) * W, H / 2 + (tr.y + st.dy) * H);
  x.rotate(((tr.rotation + st.rot) * Math.PI) / 180);
  const s = tr.scale * st.scale;
  x.scale(s * (tr.flipH ? -1 : 1), s * (tr.flipV ? -1 : 1));
  x.drawImage(el, sw * crop.l, sh * crop.t, cw, ch, -dw / 2, -dh / 2, dw, dh);
  return { dw, dh };
}

// Draws one video/image clip. `drawable` = { el, w, h }.
export function drawVisual(ctx, clip, t, drawable, W, H, opts = {}) {
  if (!drawable) return;
  const local = t - clip.start;
  const tr = transformAt(clip, t), st = animState(clip.anim, clamp(local, 0, clip.duration), clip.duration);
  const opacity = clamp(tr.opacity * st.opacity, 0, 1) * (opts.alpha ?? 1);
  if (opacity <= 0) return;
  let { el, w: sw, h: sh } = drawable;
  const f = effectiveFilter(groupAt(clip, 'filter', t));
  let crop = clip.crop || { l: 0, t: 0, r: 0, b: 0 };
  // Background removal: matte frame of the source time shown (in the file the clip plays, see vidSrc).
  const media = opts.media, m = matteOn(clip, media) ? clip.matte : null;
  const matte = m && matteFrame(m, clip.type === 'image' ? 0 : (sourceTime(clip, clamp(t, clip.start, clipEnd(clip) - 1e-4), media) - vidSrc(clip, media).off - m.t0) * m.fps);
  if (needsGrade(f, clip.chroma, matte)) {
    // Graded at the size it will be drawn (capped at the source size), then drawn like the source.
    const cw = sw * (1 - crop.l - crop.r), ch = sh * (1 - crop.t - crop.b);
    if (cw <= 0 || ch <= 0) return;
    const k = Math.min(1, Math.max(W / cw, H / ch) * Math.max(1, Math.abs(tr.scale * st.scale)));
    ({ el, w: sw, h: sh, crop } = grade(el, sw, sh, crop, f, clip.chroma, cw * k, ch * k, Math.floor(t * 24), matte));
  }
  const css = blurCss((f ? f.blur : 0) + st.blur, W);
  const mask = clip.mask && clip.mask.type !== 'none' ? groupAt(clip, 'mask', t) : null;
  const layered = mask || opts.layer;

  if (!layered) {
    ctx.save();
    ctx.globalAlpha = opacity; ctx.filter = css;
    ctx.globalCompositeOperation = clip.blend || 'source-over';
    drawMedia(ctx, clip, el, sw, sh, W, H, tr, st, crop);
    ctx.restore();
    return;
  }
  const [lc, lx] = scratch(opts.layerKey || 'layer', W, H);
  lx.clearRect(0, 0, W, H);
  lx.save(); lx.filter = css;
  const d = drawMedia(lx, clip, el, sw, sh, W, H, tr, st, crop);
  lx.filter = 'none';
  if (mask && d) {
    // Mask follows the clip's transform; feather via blur on the mask shape.
    lx.globalCompositeOperation = mask.invert ? 'destination-out' : 'destination-in';
    lx.rotate(((mask.angle || 0) * Math.PI) / 180);
    lx.filter = mask.feather > 0 ? `blur(${((mask.feather / 100) * Math.min(d.dw, d.dh) * 0.25).toFixed(1)}px)` : 'none';
    lx.fillStyle = '#fff';
    maskPath(lx, mask, d.dw, d.dh); lx.fill();
  }
  lx.restore();
  if (opts.layer) return lc; // caller composites (transitions)
  ctx.save();
  ctx.globalAlpha = opacity; ctx.globalCompositeOperation = clip.blend || 'source-over';
  ctx.drawImage(lc, 0, 0);
  ctx.restore();
}

// Blurred, zoomed copy behind main-track clips that don't fill the frame.
function drawBackground(ctx, bg, drawable, W, H) {
  if (!bg || bg.type !== 'blur' || !drawable) return;
  const { el, w, h } = drawable, k = Math.max(W / w, H / h) * 1.1;
  ctx.save();
  ctx.filter = `blur(${(((bg.blur ?? 40) * W) / 1920).toFixed(1)}px) brightness(0.85)`;
  ctx.drawImage(el, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k);
  ctx.restore();
}

// ---------- text ----------
function wrapLines(x, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (x.measureText(test).width > maxW && line) { out.push(line); line = w; } else line = test;
    }
    out.push(line);
  }
  return out;
}

const hasKeys = (o) => !!o && Object.keys(o).length > 0;
export const fontOf = (tx, size, st) => `${(st && st.italic != null ? st.italic : tx.italic) ? 'italic ' : ''}${(st && st.bold != null ? st.bold : tx.bold) ? '700' : '400'} ${size * ((st && st.scale) || 1)}px "${(st && st.font) || tx.font}", "Segoe UI Emoji", sans-serif`;

// Lines of a text clip. Plain text wraps whole lines; with per-word styles each word is measured in its own font.
// line = { str, w, h, words: [{ text, wi, x, w, st }] } (x from the line start), wi = index among all words.
function layoutText(x, tx, content, maxW, size, lh) {
  const ws = hasKeys(tx.wordStyles) ? tx.wordStyles : null, base = fontOf(tx, size);
  x.font = base;
  const space = x.measureText(' ').width, lines = [];
  let wi = 0;
  const finish = (words) => {
    let cx = 0;
    for (const w of words) { w.x = cx; cx += w.w + space; }
    const sc = Math.max(1, ...words.map((w) => (w.st && w.st.scale) || 1));
    lines.push({ words, w: Math.max(0, cx - space), h: lh * sc, str: words.map((w) => w.text).join(' ') });
  };
  const measure = (text, st) => { if (!st) return x.measureText(text).width; x.font = fontOf(tx, size, st); const m = x.measureText(text).width; x.font = base; return m; };
  if (!ws) {
    for (const str of wrapLines(x, content, maxW)) {
      const words = str.split(' ').filter(Boolean).map((text) => ({ text, wi: wi++, w: x.measureText(text).width, st: null }));
      finish(words);
      lines[lines.length - 1].w = x.measureText(str).width; lines[lines.length - 1].str = str;
    }
    return lines;
  }
  for (const para of String(content).split('\n')) {
    let cur = [], cw = 0;
    for (const text of para.split(' ').filter(Boolean)) {
      const st = ws[wi] || null, w = measure(text, st), item = { text, wi: wi++, w, st };
      if (cur.length && cw + space + w > maxW) { finish(cur); cur = []; cw = 0; }
      cw += (cur.length ? space : 0) + w; cur.push(item);
    }
    finish(cur);
  }
  return lines;
}

// Curved text: flat point (fx along the line, fy offset from the center line) → point on a circle and its tangent angle.
// curve > 0 arches up (∩), < 0 bends down (∪); ±100 wraps the widest line around a full circle.
function arcMap(curve, width) {
  if (!curve) return null;
  const R = Math.max(1, width) / ((Math.abs(curve) / 100) * Math.PI * 2), up = curve > 0;
  return (fx, fy) => {
    const a = fx / R;
    return up ? [(R - fy) * Math.sin(a), R - (R - fy) * Math.cos(a), a] : [(R + fy) * Math.sin(a), (R + fy) * Math.cos(a) - R, -a];
  };
}

function textModel(x, clip, t, W, H, scale) {
  const tx = clip.text, k = Math.min(W, H) / 1080, size = tx.size * k;
  const content = tx.uppercase ? tx.content.toUpperCase() : tx.content;
  x.font = fontOf(tx, size);
  x.letterSpacing = `${(tx.letterSpacing || 0) * k}px`;
  const lh = size * (tx.lineHeight || 1.15);
  const lines = layoutText(x, tx, content, ((tx.maxWidth || 0.85) * W) / Math.max(0.05, scale), size, lh);
  const bw = Math.max(0, ...lines.map((l) => l.w)), bh = lines.reduce((a, l) => a + l.h, 0);
  let y = -bh / 2;
  for (const l of lines) { l.y = y + l.h / 2; y += l.h; l.x0 = tx.align === 'left' ? -bw / 2 : tx.align === 'right' ? bw / 2 - l.w : -l.w / 2; }
  return { tx, k, size, content, lh, lines, bw, bh, arc: arcMap(tx.curve || 0, bw) };
}

export function drawText(ctx, clip, t, W, H) {
  const tx = clip.text, local = t - clip.start;
  const tr = transformAt(clip, t), st = animState(clip.anim, clamp(local, 0, clip.duration), clip.duration);
  const opacity = clamp(tr.opacity * st.opacity, 0, 1);
  if (opacity <= 0 || (!tx.content && !tx.badge)) return;
  const x = ctx;
  x.save();
  x.translate(W / 2 + (tr.x + st.dx) * W, H / 2 + (tr.y + st.dy) * H);
  x.rotate(((tr.rotation + st.rot) * Math.PI) / 180);
  const s = tr.scale * st.scale;
  x.scale(s * (tr.flipH ? -1 : 1), s * (tr.flipV ? -1 : 1));
  x.globalAlpha = opacity;
  if (st.blur > 0) x.filter = `blur(${((st.blur * W) / 1920).toFixed(1)}px)`;
  if (tx.badge) { drawBadge(x, tx, local, tx.size * (Math.min(W, H) / 1080)); x.restore(); return; }
  const M = textModel(x, clip, t, W, H, tr.scale * st.scale), { k, size, content, lh, lines, bw, bh, arc } = M;
  x.textBaseline = 'middle';

  if (tx.bg && tx.bg.on && !arc) {
    const pad = (tx.bg.pad ?? 18) * k;
    x.save();
    x.globalAlpha = opacity * ((tx.bg.opacity ?? 100) / 100);
    x.fillStyle = tx.bg.color;
    x.beginPath(); x.roundRect(-bw / 2 - pad, -bh / 2 - pad * 0.6, bw + pad * 2, bh + pad * 1.2, (tx.bg.radius ?? 12) * k); x.fill();
    x.restore();
  }

  // Unit list: each unit draws independently so per-letter/word animations, karaoke, word styles and curves work.
  const totalChars = content.replace(/\n/g, '').length;
  const wordAnim = tx.wordAnim && tx.wordAnim !== 'none' ? tx.wordAnim : null, kw = tx.keyword && tx.keyword.on;
  const styled = hasKeys(tx.wordStyles);
  const byWord = st.unitAnim === 'wordsUp' || (tx.highlight && tx.highlight.on) || wordAnim || kw || styled;
  const perUnit = byWord || st.unitAnim || st.units === 'wave' || st.reveal < 1 || arc;
  const perChar = arc || (!byWord && perUnit); // curves bend each letter; letter animations stagger letters
  const words = clip.words; // [{ s, e }] seconds relative to clip, for karaoke
  const rawWords = tx.content.split(/\s+/).filter(Boolean), totalWords = rawWords.length;
  // Speech-timed word start (falls back to an even spread when there are no word timings).
  const wordStart = (i) => (words && words[i] ? words[i].s : (i / Math.max(1, totalWords)) * clip.duration * 0.8);
  let activeWord = -1;
  if (tx.highlight && tx.highlight.on) {
    if (words && words.length) activeWord = words.findIndex((w) => local >= w.s && local < w.e);
    else activeWord = Math.floor((local / clip.duration) * totalWords);
  }
  const dep = tx.depth && tx.depth.on && tx.depth.size > 0 ? tx.depth : null;
  const fillFor = (h) => {
    if (tx.gradient && tx.gradient.on) {
      const g = x.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, tx.gradient.from); g.addColorStop(1, tx.gradient.to); return g;
    }
    return tx.color;
  };
  // ang: rotation of the glyph frame (curves), so the 3D extrusion keeps one direction on screen.
  const paint = (str, px, py, color, sz, ang = 0, underline = tx.underline) => {
    if (tx.glow && tx.glow.on) {
      x.save(); x.shadowColor = tx.glow.color; x.shadowBlur = tx.glow.size * k; x.fillStyle = tx.glow.color;
      x.fillText(str, px, py); x.fillText(str, px, py); x.restore();
    }
    if (tx.shadow && tx.shadow.on) {
      x.save(); x.shadowColor = tx.shadow.color; x.shadowBlur = tx.shadow.blur * k; x.shadowOffsetX = tx.shadow.x * k; x.shadowOffsetY = tx.shadow.y * k;
      x.fillStyle = tx.shadow.color; if (tx.shadow.blur === 0) x.fillText(str, px + tx.shadow.x * k, py + tx.shadow.y * k); else x.fillText(str, px, py);
      x.restore();
    }
    const sw = tx.stroke && tx.stroke.on && tx.stroke.width > 0 ? tx.stroke.width * k * 2 : 0;
    if (dep) {
      // 3D: the text extruded backwards as stacked copies (darkening towards the back), then the face on top.
      const n = dep.size * k, a = ((dep.angle ?? 45) * Math.PI) / 180 - ang, step = Math.max(1, n / 36);
      x.save(); x.lineJoin = 'round'; x.lineWidth = sw;
      for (let d = n; d > 0; d -= step) {
        const ox = Math.cos(a) * d, oy = Math.sin(a) * d;
        x.fillStyle = x.strokeStyle = shade(dep.color, dep.shade === false ? 0 : (d / n) * 0.45);
        if (sw) x.strokeText(str, px + ox, py + oy);
        x.fillText(str, px + ox, py + oy);
      }
      x.restore();
    }
    if (sw) { x.save(); x.lineJoin = 'round'; x.miterLimit = 2; x.strokeStyle = tx.stroke.color; x.lineWidth = sw; x.strokeText(str, px, py); x.restore(); }
    x.fillStyle = color; x.fillText(str, px, py);
    if (underline) { const m = x.measureText(str).width; x.fillRect(px, py + sz * 0.42, m, Math.max(2, sz * 0.06)); }
  };
  // One glyph run centered at flat (fx, fy), scaled sc around its own center.
  const glyph = (str, fx, fy, color, sz, sc, ul) => {
    x.save();
    const [px, py, ang] = arc ? arc(fx, fy) : [fx, fy, 0];
    x.translate(px, py); if (ang) x.rotate(ang); if (sc !== 1) x.scale(sc, sc);
    const m = x.measureText(str).width;
    paint(str, -m / 2, 0, color === null ? fillFor(sz * (tx.lineHeight || 1.15)) : color, sz, ang, ul);
    x.restore();
  };

  let charIndex = 0, letter = 0;
  const base = fontOf(tx, size);
  x.textAlign = 'left';
  for (const line of lines) {
    const y = line.y;
    if (!perUnit) { x.font = base; paint(line.str, line.x0, y, fillFor(lh), size); charIndex += line.str.length; continue; }
    for (const w of line.words) {
      const wst = w.st, idx = w.wi, sz = size * ((wst && wst.scale) || 1);
      x.font = wst ? fontOf(tx, size, wst) : base;
      const wordEnd = charIndex + w.text.length;
      let wy = y, wx = 0, ua = 1, sc = 1;
      if (st.unitAnim === 'wordsUp' || (st.unitAnim && byWord)) {
        const stagger = 0.6, p = clamp(st.unitP * (1 + stagger) - (idx / Math.max(1, totalWords)) * stagger, 0, 1);
        ua = p; wy += st.unitAnim === 'wordsUp' ? (1 - easeOut(p)) * size * 0.8 : -(1 - easeOut(p)) * size * 0.4;
      }
      if (st.units === 'wave' && byWord) wy += Math.sin(st.loopT * 6 - idx * 0.5) * size * 0.12;
      if (wordAnim) {
        const wp = clamp((local - wordStart(idx)) / 0.25, 0, 1);
        if (wp <= 0) { charIndex = wordEnd + 1; letter += w.text.length; continue; }
        const q = easeOut(wp);
        if (wordAnim === 'pop') { sc = wp < 0.6 ? lerp(0.4, 1.18, wp / 0.6) : lerp(1.18, 1, (wp - 0.6) / 0.4); ua *= Math.min(1, wp * 3); }
        else if (wordAnim === 'bounce') { wy -= Math.abs(Math.sin(wp * Math.PI * 2)) * (1 - wp) * size * 0.5; ua *= Math.min(1, wp * 3); }
        else if (wordAnim === 'slide') { wx -= (1 - q) * size * 0.7; ua *= q; }
        else ua *= q;
      }
      let color = wst && wst.color ? wst.color : null;
      if (kw && isKeyword(rawWords[idx] || w.text)) color = tx.keyword.color;
      if (activeWord >= 0 && idx === activeWord) { color = tx.highlight.color; sc *= 1.08; }
      const ul = wst && wst.underline != null ? wst.underline : tx.underline;
      const cx = line.x0 + w.x + w.w / 2 + wx;
      if (!perChar) {
        if (st.reveal < 1 && wordEnd > Math.ceil(st.reveal * totalChars)) { charIndex = wordEnd + 1; continue; }
        x.globalAlpha = opacity * ua;
        glyph(w.text, cx, wy, color, sz, sc, ul);
      } else {
        let prefix = '';
        for (const ch of Array.from(w.text)) {
          const off = x.measureText(prefix).width, cw = x.measureText(ch).width;
          prefix += ch; charIndex += ch.length;
          const li = letter++;
          if (st.reveal < 1 && charIndex > Math.ceil(st.reveal * totalChars)) continue;
          let cy = wy, ca = ua;
          if (st.unitAnim && !byWord) {
            const stagger = 0.6, p = clamp(st.unitP * (1 + stagger) - (li / Math.max(1, totalChars)) * stagger, 0, 1);
            ca = p; cy += st.unitAnim === 'wordsUp' ? (1 - easeOut(p)) * size * 0.8 : -(1 - easeOut(p)) * size * 0.4;
          }
          if (st.units === 'wave' && !byWord) cy += Math.sin(st.loopT * 6 - li * 0.5) * size * 0.12;
          x.globalAlpha = opacity * ca;
          // Letters keep their place inside the (scaled) word.
          const fx = cx + (line.x0 + w.x + wx + off + cw / 2 - cx) * sc;
          glyph(ch, fx, cy, color, sz, sc, ul);
        }
        charIndex = wordEnd;
      }
      charIndex = wordEnd + 1;
    }
  }
  x.restore();
}
// Mixes a hex color towards black by amount 0..1.
function shade(hex, amt) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(hex || '#000000');
  if (!m) return hex;
  const f = (h) => Math.round(parseInt(h, 16) * (1 - amt));
  return `rgb(${f(m[1])},${f(m[2])},${f(m[3])})`;
}

// Bounding box of a text clip in canvas pixels (for on-canvas selection handles).
export function textBounds(ctx, clip, t, W, H) {
  const tx = clip.text, tr = transformAt(clip, t);
  ctx.save();
  let w, h, ox = 0, oy = 0;
  if (tx.badge) ({ w, h } = badgeSize(ctx, tx, tx.size * (Math.min(W, H) / 1080)));
  else {
    const M = textModel(ctx, clip, t, W, H, tr.scale);
    w = Math.max(1, M.bw); h = M.bh;
    if (M.arc) {
      // Curved: box around the ends and middle of every line, a line height above and below.
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const l of M.lines) for (const f of [0, 0.25, 0.5, 0.75, 1]) for (const d of [-l.h / 2, l.h / 2]) {
        const [px, py] = M.arc(l.x0 + l.w * f, l.y + d);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      w = x1 - x0; h = y1 - y0; ox = (x0 + x1) / 2; oy = (y0 + y1) / 2;
    }
    if (tx.depth && tx.depth.on) { const n = tx.depth.size * M.k, a = ((tx.depth.angle ?? 45) * Math.PI) / 180; w += Math.abs(Math.cos(a)) * n; h += Math.abs(Math.sin(a)) * n; ox += (Math.cos(a) * n) / 2; oy += (Math.sin(a) * n) / 2; }
  }
  ctx.restore();
  const r = (tr.rotation * Math.PI) / 180, s = tr.scale;
  return { cx: W / 2 + tr.x * W + (ox * Math.cos(r) - oy * Math.sin(r)) * s, cy: H / 2 + tr.y * H + (ox * Math.sin(r) + oy * Math.cos(r)) * s, w: w * s, h: h * s, rotation: tr.rotation };
}

export function visualBounds(clip, t, drawable, W, H) {
  if (!drawable) return null;
  const tr = transformAt(clip, t), crop = clip.crop || { l: 0, t: 0, r: 0, b: 0 };
  const [dw, dh] = fitSize(clip.fit, drawable.w * (1 - crop.l - crop.r), drawable.h * (1 - crop.t - crop.b), W, H);
  return { cx: W / 2 + tr.x * W, cy: H / 2 + tr.y * H, w: dw * tr.scale, h: dh * tr.scale, rotation: tr.rotation };
}

// Point (u, v in 0..1 of the whole source frame, sw×sh) ↔ canvas pixels, placed as drawMedia does at time t
// (transform keyframes included, in/out animations not). Used by face reframing and motion tracking.
function placement(clip, t, sw, sh, W, H) {
  const tr = transformAt(clip, t), crop = clip.crop || { l: 0, t: 0, r: 0, b: 0 };
  const cw = 1 - crop.l - crop.r, ch = 1 - crop.t - crop.b, [dw, dh] = fitSize(clip.fit, sw * cw, sh * ch, W, H), a = (tr.rotation * Math.PI) / 180;
  return { tr, crop, cw, ch, dw, dh, sx: tr.scale * (tr.flipH ? -1 : 1), sy: tr.scale * (tr.flipV ? -1 : 1), cos: Math.cos(a), sin: Math.sin(a) };
}
export function srcToCanvas(clip, t, sw, sh, W, H, u, v) {
  const p = placement(clip, t, sw, sh, W, H);
  const x = ((u - p.crop.l) / p.cw - 0.5) * p.dw * p.sx, y = ((v - p.crop.t) / p.ch - 0.5) * p.dh * p.sy;
  return [W / 2 + p.tr.x * W + x * p.cos - y * p.sin, H / 2 + p.tr.y * H + x * p.sin + y * p.cos];
}
export function canvasToSrc(clip, t, sw, sh, W, H, X, Y) {
  const p = placement(clip, t, sw, sh, W, H), dx = X - W / 2 - p.tr.x * W, dy = Y - H / 2 - p.tr.y * H;
  const x = (dx * p.cos + dy * p.sin) / p.sx, y = (-dx * p.sin + dy * p.cos) / p.sy;
  return [p.crop.l + (x / p.dw + 0.5) * p.cw, p.crop.t + (y / p.dh + 0.5) * p.ch];
}

// ---------- transitions ----------
// A clip's entry transition (`transition`) plays over its first seconds, from the clip just before it on the track
// (held on its last frame) or, with none, from what's underneath; its exit transition (`transitionOut`) plays over
// its last seconds, to what's underneath. Never outside the clip, so nothing shows before the cut.
export const transIn = (c) => (c.transition ? Math.min(c.transition.duration, c.duration) : 0);
export const transOut = (c) => (c.transitionOut ? Math.min(c.transitionOut.duration, c.duration - transIn(c)) : 0);
// An exit plays an entry backwards: mirror directional ones so «Deslizar ←» also leaves towards the left.
export const EXIT_AS = { slideLeft: 'slideRight', slideRight: 'slideLeft', slideUp: 'slideDown', slideDown: 'slideUp', wipeLeft: 'wipeRight', wipeRight: 'wipeLeft', wipeUp: 'wipeDown', wipeDown: 'wipeUp', push: 'pushBack' };

// A, B: full-frame layer canvases, either may be null (to/from what's underneath). p: 0 = all A, 1 = all B.
// A is only drawn where B's frame doesn't cover it yet, so a B that doesn't fill the frame never ends on a stale A.
export function drawTransition(ctx, type, p, A, B, W, H) {
  const draw = (c, alpha = 1, fn) => { if (!c) return; ctx.save(); ctx.globalAlpha = alpha; fn && fn(); ctx.drawImage(c, 0, 0); ctx.restore(); };
  const q = easeInOut(p);
  // Crossfade on a layer: A·(1−k) + B·k added, exact where both are opaque and a clean fade where only one is.
  const mix = (k, fa, fb) => {
    const [mc, mx] = scratch(`tMix${W}x${H}`, W, H); // per size: catalog thumbnails don't resize the frame's layer
    mx.clearRect(0, 0, W, H);
    if (A) { mx.save(); mx.globalAlpha = 1 - k; fa && fa(mx); mx.drawImage(A, 0, 0); mx.restore(); }
    if (B) { mx.save(); mx.globalCompositeOperation = 'lighter'; mx.globalAlpha = k; fb && fb(mx); mx.drawImage(B, 0, 0); mx.restore(); }
    ctx.drawImage(mc, 0, 0);
  };
  const zoom = (s) => (x) => { x.translate(W / 2, H / 2); x.scale(s, s); x.translate(-W / 2, -H / 2); };
  // B inside the shape, A outside it.
  const reveal = (shape) => {
    if (A) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); shape(); ctx.clip('evenodd'); ctx.drawImage(A, 0, 0); ctx.restore(); }
    if (B) { ctx.save(); ctx.beginPath(); shape(); ctx.clip(); ctx.drawImage(B, 0, 0); ctx.restore(); }
  };
  switch (type) {
    case 'fadeBlack': case 'fadeWhite': {
      draw(p < 0.5 ? A : B);
      ctx.save(); ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2; ctx.fillStyle = type === 'fadeBlack' ? '#000' : '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore();
      break;
    }
    case 'flash': mix(q); ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.abs(p - 0.5) * 3); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.restore(); break;
    case 'slideLeft': case 'slideRight': case 'slideUp': case 'slideDown': {
      const [dx, dy] = { slideLeft: [W, 0], slideRight: [-W, 0], slideUp: [0, H], slideDown: [0, -H] }[type], ox = dx * (1 - q), oy = dy * (1 - q);
      if (A) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(ox, oy, W, H); ctx.clip('evenodd'); ctx.drawImage(A, 0, 0); ctx.restore(); }
      draw(B, 1, () => ctx.translate(ox, oy));
      break;
    }
    case 'push': draw(A, 1, () => ctx.translate(-W * q, 0)); draw(B, 1, () => ctx.translate(W * (1 - q), 0)); break;
    case 'pushBack': draw(A, 1, () => ctx.translate(W * q, 0)); draw(B, 1, () => ctx.translate(-W * (1 - q), 0)); break;
    case 'wipeLeft': reveal(() => ctx.rect(W * (1 - q), 0, W * q, H)); break;
    case 'wipeRight': reveal(() => ctx.rect(0, 0, W * q, H)); break;
    case 'wipeDown': reveal(() => ctx.rect(0, 0, W, H * q)); break;
    case 'wipeUp': reveal(() => ctx.rect(0, H * (1 - q), W, H * q)); break;
    case 'circle': reveal(() => { const r = (q * Math.hypot(W, H)) / 2; ctx.moveTo(W / 2 + r, H / 2); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); }); break;
    case 'diamond': reveal(() => { const r = q * (W + H) * 0.55; ctx.moveTo(W / 2, H / 2 - r); ctx.lineTo(W / 2 + r, H / 2); ctx.lineTo(W / 2, H / 2 + r); ctx.lineTo(W / 2 - r, H / 2); ctx.closePath(); }); break;
    case 'zoomIn': mix(q, zoom(1 + q)); break;
    case 'zoomOut': mix(q, null, zoom(lerp(1.6, 1, q))); break;
    case 'spin': {
      const c = p < 0.5 ? A : B, k = p < 0.5 ? p * 2 : (1 - p) * 2;
      draw(c, 1, () => { ctx.translate(W / 2, H / 2); ctx.rotate(k * Math.PI * (p < 0.5 ? 1 : -1)); ctx.scale(1 - k * 0.5, 1 - k * 0.5); ctx.translate(-W / 2, -H / 2); });
      break;
    }
    case 'blur': { const k = 1 - Math.abs(p - 0.5) * 2; draw(p < 0.5 ? A : B, 1, () => { ctx.filter = `blur(${(k * W) / 60}px)`; }); break; }
    case 'glitch': {
      const c = p < 0.5 ? A : B, k = 1 - Math.abs(p - 0.5) * 2;
      if (!c) break;
      const strips = 14, sh = H / strips, seed = Math.floor(p * 30);
      for (let i = 0; i < strips; i++) {
        const off = (rand(seed * 31 + i) - 0.5) * W * 0.25 * k;
        ctx.drawImage(c, 0, i * sh, W, sh, off, i * sh, W, sh);
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 * k; ctx.drawImage(c, W * 0.02 * k, 0); ctx.restore();
      break;
    }
    case 'shake': { const k = 1 - Math.abs(p - 0.5) * 2, dx = (rand(Math.floor(p * 40)) - 0.5) * W * 0.06 * k, sh = (x) => x.translate(dx, 0); mix(q, sh, sh); break; }
    case 'split': {
      draw(B);
      if (A) { ctx.drawImage(A, 0, 0, W / 2, H, -q * W / 2, 0, W / 2, H); ctx.drawImage(A, W / 2, 0, W / 2, H, W / 2 + q * W / 2, 0, W / 2, H); }
      break;
    }
    default: mix(q); // fade
  }
}

// ---------- effects (apply to everything below on the canvas) ----------
function applyEffect(ctx, eff, local, dur, W, H) {
  const k = (eff.intensity ?? 50) / 50;
  const snap = () => { const [c, x] = scratch('fx-snap', W, H); x.drawImage(ctx.canvas, 0, 0); return c; };
  const redraw = (c, fn) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); fn ? fn(c) : ctx.drawImage(c, 0, 0); ctx.restore(); };
  const zoom = (c, s, dx = 0, dy = 0) => redraw(c, () => { ctx.translate(W / 2 + dx, H / 2 + dy); ctx.scale(s, s); ctx.drawImage(c, -W / 2, -H / 2); });
  const over = (fill, alpha, mode = 'source-over') => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = clamp(alpha, 0, 1); ctx.globalCompositeOperation = mode; ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H); ctx.restore(); };
  const rgb = (c, off) => {
    // Splits channels by multiplying copies with pure R/G/B and adding them back with offsets.
    const chans = [['#ff0000', -off], ['#00ff00', 0], ['#0000ff', off]].map(([col, o], i) => {
      const [cc, cx] = scratch('fx-rgb' + i, W, H);
      cx.drawImage(c, 0, 0); cx.globalCompositeOperation = 'multiply'; cx.fillStyle = col; cx.fillRect(0, 0, W, H);
      return [cc, o];
    });
    redraw(null, () => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter'; for (const [cc, o] of chans) ctx.drawImage(cc, o, 0); });
  };
  const particles = (n, fn) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); for (let i = 0; i < n; i++) fn(i); ctx.restore(); };
  switch (eff.type) {
    case 'shake': { const f = Math.floor(local * 24); zoom(snap(), 1 + 0.05 * k, (rand(f) - 0.5) * W * 0.04 * k, (rand(f + 99) - 0.5) * H * 0.04 * k); break; }
    case 'zoomPulse': zoom(snap(), 1 + 0.08 * k * Math.abs(Math.sin(local * Math.PI * 2))); break;
    case 'heartbeat': { const f = local % 1, b = f < 0.12 ? Math.sin((f / 0.12) * Math.PI) : f > 0.2 && f < 0.32 ? Math.sin(((f - 0.2) / 0.12) * Math.PI) * 0.7 : 0; zoom(snap(), 1 + 0.07 * k * b); break; }
    case 'fisheye': zoom(snap(), 1 + 0.25 * k * Math.min(1, local / Math.max(0.1, dur * 0.5))); break;
    case 'flash': over('#fff', Math.pow(1 - ((local * 1.5) % 1), 3) * k); break;
    case 'strobe': if (Math.floor(local * 10) % 2 === 0) over('#fff', 0.85 * Math.min(1, k)); break;
    case 'bw': if (Math.floor(local * 3) % 2 === 0) redraw(snap(), (c) => { ctx.filter = 'grayscale(1) contrast(1.3)'; ctx.drawImage(c, 0, 0); }); break;
    case 'rgbSplit': rgb(snap(), W * 0.008 * k * (1 + Math.sin(local * 5) * 0.5)); break;
    case 'glitch': {
      const f = Math.floor(local * 12), active = rand(f) < 0.55 * Math.min(1, k);
      if (!active) break;
      const c = snap();
      rgb(c, W * 0.012 * k);
      const c2 = snap();
      redraw(c2, () => {
        ctx.drawImage(c2, 0, 0);
        for (let i = 0; i < 6; i++) { const y = rand(f * 7 + i) * H, h = rand(f * 13 + i) * H * 0.08, off = (rand(f * 17 + i) - 0.5) * W * 0.15 * k; ctx.drawImage(c2, 0, y, W, h, off, y, W, h); }
      });
      break;
    }
    case 'vhs': {
      rgb(snap(), W * 0.004 * k);
      particles(1, () => { ctx.globalAlpha = 0.18 * k; ctx.fillStyle = '#000'; for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1.5); });
      const band = ((local * 0.3) % 1) * H;
      over(ctx.createPattern(noise(Math.floor(local * 24)), 'repeat'), 0.12 * k, 'overlay');
      particles(1, () => { ctx.globalAlpha = 0.15; ctx.fillStyle = '#fff'; ctx.fillRect(0, band, W, H * 0.02); });
      break;
    }
    case 'oldFilm': {
      const f = Math.floor(local * 18);
      redraw(snap(), (c) => { ctx.filter = `sepia(0.8) contrast(1.1) brightness(${0.92 + rand(f) * 0.12})`; ctx.drawImage(c, 0, 0); });
      over(ctx.createPattern(noise(f), 'repeat'), 0.25 * k, 'overlay');
      particles(3, (i) => { if (rand(f * 3 + i) < 0.5) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#e8e0d0'; ctx.fillRect(rand(f * 5 + i) * W, 0, Math.max(1, W / 900), H); } });
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)'); over(g, 1);
      break;
    }
    case 'grain': over(ctx.createPattern(noise(Math.floor(local * 24)), 'repeat'), 0.3 * k, 'overlay'); break;
    case 'scanlines': particles(1, () => { ctx.globalAlpha = 0.25 * k; ctx.fillStyle = '#000'; for (let y = 0; y < H; y += Math.max(3, H / 270)) ctx.fillRect(0, y, W, Math.max(1, H / 900)); }); break;
    case 'lightLeak': {
      const a = local * 0.6;
      particles(1, () => {
        ctx.globalCompositeOperation = 'screen';
        [[0.2 + Math.sin(a) * 0.2, 0.3, '#ff7a1a'], [0.8, 0.7 + Math.cos(a * 1.3) * 0.2, '#ff2d6f']].forEach(([px, py, col]) => {
          const g = ctx.createRadialGradient(px * W, py * H, 0, px * W, py * H, Math.max(W, H) * 0.6);
          g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.45 * k; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        });
      });
      break;
    }
    case 'letterbox': { const b = H * 0.12 * Math.min(1.5, k) * Math.min(1, local / 0.4); particles(1, () => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, b); ctx.fillRect(0, H - b, W, b); }); break; }
    case 'mirror': { const c = snap(); redraw(c, () => { ctx.drawImage(c, 0, 0, W / 2, H, 0, 0, W / 2, H); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(c, 0, 0, W / 2, H, 0, 0, W / 2, H); }); break; }
    case 'kaleido': {
      const c = snap();
      redraw(c, () => {
        for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(sx, sy); ctx.drawImage(c, W / 4, H / 4, W / 2, H / 2, -W / 2, -H / 2, W / 2, H / 2); ctx.restore();
        }
      });
      break;
    }
    case 'split3': { const c = snap(); redraw(c, () => { for (let i = 0; i < 3; i++) ctx.drawImage(c, 0, H / 3, W, H / 3, 0, (i * H) / 3, W, H / 3); }); break; }
    case 'blurIn': redraw(snap(), (c) => { ctx.filter = `blur(${((W / 60) * k * Math.max(0, 1 - local / Math.max(0.1, dur))).toFixed(1)}px)`; ctx.drawImage(c, 0, 0); }); break;
    case 'vignettePulse': {
      const v = 0.5 + 0.3 * Math.sin(local * Math.PI * 2);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${clamp(v * k, 0, 1)})`); over(g, 1);
      break;
    }
    case 'pixelate': {
      const c = snap(), bs = Math.max(2, Math.round((W / 80) * k)), [sc, sx] = scratch('fx-pix', Math.ceil(W / bs), Math.ceil(H / bs));
      sx.drawImage(c, 0, 0, sc.width, sc.height);
      redraw(null, () => { ctx.imageSmoothingEnabled = false; ctx.drawImage(sc, 0, 0, W, H); });
      break;
    }
    case 'duotone': {
      redraw(snap(), (c) => { ctx.filter = 'grayscale(1) contrast(1.2)'; ctx.drawImage(c, 0, 0); });
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#7b2ff7'); g.addColorStop(1, '#ff6a3d');
      over(g, 0.85 * Math.min(1, k), 'color');
      break;
    }
    case 'neonEdge': { const c = snap(); particles(1, () => { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * Math.min(1, k); ctx.filter = `blur(${W / 120}px) saturate(2)`; ctx.drawImage(c, 0, 0); }); break; }
    case 'rain': particles(Math.round(160 * k), (i) => {
      const x0 = rand(i) * W, sp = 0.6 + rand(i + 3) * 0.6, y0 = ((rand(i + 7) + local * sp * 1.6) % 1) * H * 1.2 - H * 0.1;
      ctx.strokeStyle = 'rgba(200,220,255,0.55)'; ctx.lineWidth = Math.max(1, W / 1200); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 - W * 0.004, y0 + H * 0.04); ctx.stroke();
    }); break;
    case 'snow': particles(Math.round(140 * k), (i) => {
      const sp = 0.1 + rand(i + 3) * 0.15, y0 = ((rand(i + 7) + local * sp) % 1) * H, x0 = (rand(i) * W + Math.sin(local + i) * W * 0.01);
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x0, y0, (1 + rand(i + 1) * 3) * (W / 1920) * 2, 0, Math.PI * 2); ctx.fill();
    }); break;
    case 'sparkles': particles(Math.round(40 * k), (i) => {
      const tw = Math.max(0, Math.sin(local * 3 + i * 1.7)), x0 = rand(i) * W, y0 = rand(i + 9) * H, r = (6 + rand(i + 2) * 14) * (W / 1920) * tw;
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff6c2'; ctx.shadowBlur = r * 2; ctx.globalAlpha = tw;
      ctx.beginPath(); for (let j = 0; j < 8; j++) { const a = (j * Math.PI) / 4, rr = j % 2 ? r * 0.25 : r; ctx.lineTo(x0 + Math.cos(a) * rr, y0 + Math.sin(a) * rr); } ctx.fill();
    }); break;
    default: break;
  }
}

// ---------- full frame ----------
// getDrawable(clip, media, t) → { el, w, h } | null. Returns list of clips drawn (for selection handles).
export function activeVisual(project, t) {
  const out = [];
  const tracks = project.tracks.filter((tk) => tk.kind !== 'audio' && !tk.hidden);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tk = tracks[i];
    const clips = project.clips.filter((c) => c.trackId === tk.id).sort((a, b) => a.start - b.start);
    for (let j = 0; j < clips.length; j++) {
      const c = clips[j], prev = clips[j - 1], next = clips[j + 1];
      const touch = (a, b) => a && b && Math.abs(clipEnd(a) - b.start) < 0.05;
      // `held`: past its end, still needed on its last frame by the next clip's entry transition.
      const hold = touch(c, next) && !c.transitionOut ? transIn(next) : 0;
      if (t >= c.start && t < clipEnd(c) + hold) out.push({ clip: c, track: tk, prev: touch(prev, c) && !prev.transitionOut ? prev : null, held: t >= clipEnd(c) });
    }
  }
  return out;
}

// Effects that move/rescale the picture: they are not clipped to the linked clip's original shape.
const MOTION_FX = new Set(['shake', 'zoomPulse', 'heartbeat', 'fisheye', 'mirror', 'kaleido', 'split3', 'pixelate', 'blurIn', 'bw']);

// Runs one effect clip (preset effect or adjustment filter) over what is already drawn on ctx.
// `shape`: the layer is transparent outside the linked clip, so keep results inside its pixels.
function runEffectClip(ctx, c, t, W, H, shape) {
  const pre = shape && c.effect && !MOTION_FX.has(c.effect.type) ? cloneLayer(ctx.canvas, 'fx-pre', W, H) : null;
  if (c.effect && c.effect.type !== 'none') applyEffect(ctx, c.effect, t - c.start, c.duration, W, H);
  if (c.filter) {
    const f = effectiveFilter(groupAt(c, 'filter', t));
    const g = needsGrade(f) ? grade(ctx.canvas, W, H, { l: 0, t: 0, r: 0, b: 0 }, f, null, W, H, Math.floor(t * 24)) : null;
    const css = blurCss(f.blur, W);
    if (g || css !== 'none') {
      const [sc, sx] = scratch('fx-filter', W, H);
      if (g) sx.drawImage(g.el, 0, g.h - H, W, H, 0, 0, W, H); else sx.drawImage(ctx.canvas, 0, 0);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H); ctx.filter = css; ctx.drawImage(sc, 0, 0); ctx.restore();
    }
  }
  if (pre) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(pre, 0, 0); ctx.restore(); }
}

// An effect clip can be linked to one clip or one track ({ kind, id, on }): it then only touches that layer.
export const effectLink = (project, c) => {
  const l = c.type === 'effect' && c.link;
  if (!l || l.on === false) return null;
  return (l.kind === 'track' ? project.tracks.some((x) => x.id === l.id) : project.clips.some((x) => x.id === l.id && x.type !== 'effect')) ? l : null;
};

export function renderFrame(ctx, project, t, getDrawable, W, H) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = project.background.type === 'color' ? project.background.color : '#000';
  ctx.fillRect(0, 0, W, H);
  const items = activeVisual(project, t);
  const linked = items.map((i) => i.clip).filter((c) => c.type === 'effect' && t >= c.start && t < clipEnd(c) && effectLink(project, c));
  const fxFor = (kind, id) => linked.filter((c) => c.link.kind === kind && c.link.id === id);
  // Clips of a track with linked effects are drawn on their own layer, which gets the effects and is then laid over the frame.
  let layerTrack = null, cx = ctx;
  const flush = () => {
    if (!layerTrack) return;
    for (const e of fxFor('track', layerTrack)) runEffectClip(cx, e, t, W, H, true);
    ctx.drawImage(cx.canvas, 0, 0);
    layerTrack = null; cx = ctx;
  };
  for (const it of items) {
    const c = it.clip;
    if (it.track.id !== layerTrack) {
      flush();
      if (fxFor('track', it.track.id).length) { const [, lx] = scratch('fx-trk', W, H); lx.clearRect(0, 0, W, H); cx = lx; layerTrack = it.track.id; }
    }
    if (c.type === 'text') {
      if (t >= c.start && t < clipEnd(c)) {
        const own = fxFor('clip', c.id);
        if (own.length) {
          const [lc, lx] = scratch('fx-clip', W, H); lx.clearRect(0, 0, W, H);
          drawText(lx, c, t, W, H);
          for (const e of own) runEffectClip(lx, e, t, W, H, true);
          cx.drawImage(lc, 0, 0);
        } else drawText(cx, c, t, W, H);
      }
      continue;
    }
    if (c.type === 'effect') {
      if (t >= c.start && t < clipEnd(c) && !effectLink(project, c)) runEffectClip(cx, c, t, W, H, false);
      continue;
    }
    if (it.held) continue; // drawn by the next clip's entry transition
    const media = mediaOf(project, c);
    const d = getDrawable(c, media, t);
    const bgFor = (clip, dr) => { if (it.track.main && project.background.type === 'blur') drawBackground(cx, project.background, dr, W, H); };
    const tin = transIn(c), tout = transOut(c);
    if ((tin && t < c.start + tin) || (tout && t >= clipEnd(c) - tout)) {
      // Each side on its own full-frame layer (background, clip, its linked effects), then mixed.
      const layer = (clip, tc, key) => {
        const [lc, lx] = scratch(key, W, H), m = mediaOf(project, clip), dr = clip === c ? d : getDrawable(clip, m, tc);
        lx.clearRect(0, 0, W, H);
        if (it.track.main && project.background.type === 'blur') drawBackground(lx, project.background, dr, W, H);
        drawVisual(lx, clip, tc, dr, W, H, { media: m });
        for (const e of fxFor('clip', clip.id)) runEffectClip(lx, e, tc, W, H, true);
        return lc;
      };
      if (tin && t < c.start + tin) {
        const A = it.prev;
        const la = A ? layer(A, Math.min(t, clipEnd(A) - 1e-3), 'tA') : null;
        drawTransition(cx, c.transition.type, (t - c.start) / tin, la, layer(c, t, 'tB'), W, H);
      } else {
        const type = c.transitionOut.type;
        drawTransition(cx, EXIT_AS[type] || type, (clipEnd(c) - t) / tout, null, layer(c, t, 'tB'), W, H);
      }
      continue;
    }
    if (t < c.start || t >= clipEnd(c)) continue;
    bgFor(c, d);
    const own = fxFor('clip', c.id);
    if (own.length) {
      const [lc, lx] = scratch('fx-clip', W, H); lx.clearRect(0, 0, W, H);
      drawVisual(lx, { ...c, blend: 'source-over' }, t, d, W, H, { media });
      for (const e of own) runEffectClip(lx, e, t, W, H, true);
      cx.save(); cx.globalCompositeOperation = c.blend || 'source-over'; cx.drawImage(lc, 0, 0); cx.restore();
    } else drawVisual(cx, c, t, d, W, H, { media });
  }
  flush();
}
function cloneLayer(c, key, W, H) {
  if (!c) return null;
  const [cc, x] = scratch(key, W, H); x.clearRect(0, 0, W, H); x.drawImage(c, 0, 0); return cc;
}
