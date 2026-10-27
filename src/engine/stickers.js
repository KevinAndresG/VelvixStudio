// Animated call-to-action stickers (subscribe, follow, like, comment, share…) drawn with vector paths, so they stay
// sharp at any export size and every frame is a pure function of time (preview = export). A sticker is a text clip
// with `text.badge = { kind, theme, label2 }`; the label is the clip's text content (editable like any text).

export const BADGE_THEMES = {
  youtube: { name: 'YouTube', bg: '#ff0033', fg: '#ffffff', done: '#3d3d3d' },
  instagram: { name: 'Instagram', grad: ['#feda75', '#fa7e1e', '#d62976', '#962fbf', '#4f5bd5'], fg: '#ffffff', done: '#efefef', doneFg: '#262626' },
  tiktok: { name: 'TikTok', bg: '#fe2c55', fg: '#ffffff', done: '#2f2f2f', glitch: ['#25f4ee', '#fe2c55'] },
  facebook: { name: 'Facebook', bg: '#1877f2', fg: '#ffffff', done: '#e4e6eb', doneFg: '#050505' },
  light: { name: 'Claro', bg: '#ffffff', fg: '#111111', done: '#d9d9d9' },
  dark: { name: 'Oscuro', bg: '#141414', fg: '#ffffff', done: '#3d3d3d' },
};

// label / label2 (state after the click) are defaults; `click`: a cursor taps the button every loop.
export const BADGES = {
  subscribe: { name: 'Suscríbete', icon: 'bell', label: 'SUSCRÍBETE', label2: 'SUSCRITO', click: true, theme: 'youtube' },
  follow: { name: 'Sígueme', icon: 'plus', label: 'SEGUIR', label2: 'SIGUIENDO', click: true, theme: 'instagram' },
  like: { name: 'Me gusta', icon: 'thumb', label: 'ME GUSTA', click: true, theme: 'facebook' },
  heart: { name: 'Corazón', icon: 'heart', label: '', theme: 'instagram' },
  comment: { name: 'Comenta', icon: 'bubble', label: 'COMENTA', theme: 'tiktok' },
  share: { name: 'Comparte', icon: 'share', label: 'COMPARTE', theme: 'tiktok' },
  bell: { name: 'Campanita', icon: 'bell', label: 'ACTIVA LA CAMPANITA', theme: 'youtube' },
  save: { name: 'Guárdalo', icon: 'bookmark', label: 'GUÁRDALO', theme: 'dark' },
  link: { name: 'Link en la bio', icon: 'down', label: 'LINK EN LA BIO', theme: 'light' },
  // Special stickers drawn by SPECIAL below; `place` = default position (x, y) and duration ('rest' = to the end).
  reactions: { name: 'Reacciones', label: '❤️😍👏🔥😂', theme: 'instagram', place: { x: 0.36, y: 0.1, dur: 6 } },
  progress: { name: 'Barra de progreso', label: '', theme: 'youtube', place: { x: 0, y: 0.46, dur: 'rest' } },
  countdown: { name: 'Cuenta regresiva', label: '', theme: 'dark', place: { x: 0, y: 0, dur: 3 } },
  // `badge.who` / `badge.handle`: author shown on the card / bubble.
  tweet: { name: 'Tarjeta tweet', label: 'Nadie habla de este truco y cambia todo 🔥', theme: 'light', place: { x: 0, y: -0.15, dur: 5 } },
  bubble: { name: 'Burbuja de comentario', label: '¿Cómo hiciste eso? 😮', theme: 'light', place: { x: -0.22, y: -0.28, dur: 4 } },
};

const P = 3; // loop period (s)
const ease = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

// Icon paths in a box of radius r centered at (0, 0).
function iconPath(x, name, r, done) {
  x.beginPath();
  switch (name) {
    case 'bell':
      x.moveTo(-0.7 * r, 0.45 * r);
      x.quadraticCurveTo(-0.55 * r, 0.25 * r, -0.55 * r, -0.1 * r);
      x.bezierCurveTo(-0.55 * r, -0.65 * r, 0.55 * r, -0.65 * r, 0.55 * r, -0.1 * r);
      x.quadraticCurveTo(0.55 * r, 0.25 * r, 0.7 * r, 0.45 * r);
      x.closePath();
      x.moveTo(0.2 * r, 0.58 * r); x.arc(0, 0.58 * r, 0.2 * r, 0, Math.PI); x.closePath();
      x.moveTo(0.1 * r, -0.66 * r); x.arc(0, -0.66 * r, 0.1 * r, 0, Math.PI * 2);
      break;
    case 'heart': {
      const s = r * 0.95;
      x.moveTo(0, s * 0.85);
      x.bezierCurveTo(-s * 1.5, -s * 0.05, -s * 0.6, -s * 1.25, 0, -s * 0.42);
      x.bezierCurveTo(s * 0.6, -s * 1.25, s * 1.5, -s * 0.05, 0, s * 0.85);
      break;
    }
    case 'thumb':
      x.roundRect(-0.85 * r, -0.12 * r, 0.38 * r, 0.95 * r, 0.08 * r);
      x.moveTo(-0.38 * r, -0.12 * r); x.lineTo(-0.05 * r, -0.85 * r);
      x.quadraticCurveTo(0.2 * r, -0.95 * r, 0.22 * r, -0.6 * r); x.lineTo(0.15 * r, -0.2 * r);
      x.lineTo(0.7 * r, -0.2 * r); x.quadraticCurveTo(0.92 * r, -0.18 * r, 0.85 * r, 0.05 * r);
      x.lineTo(0.7 * r, 0.7 * r); x.quadraticCurveTo(0.65 * r, 0.83 * r, 0.5 * r, 0.83 * r);
      x.lineTo(-0.38 * r, 0.83 * r); x.closePath();
      break;
    case 'bubble':
      x.roundRect(-0.85 * r, -0.7 * r, 1.7 * r, 1.2 * r, 0.35 * r);
      x.moveTo(-0.45 * r, 0.45 * r); x.lineTo(-0.6 * r, 0.9 * r); x.lineTo(-0.05 * r, 0.48 * r); x.closePath();
      break;
    case 'share':
      x.moveTo(0.85 * r, -0.1 * r); x.lineTo(0.15 * r, -0.75 * r); x.lineTo(0.15 * r, -0.4 * r);
      x.quadraticCurveTo(-0.8 * r, -0.35 * r, -0.85 * r, 0.7 * r);
      x.quadraticCurveTo(-0.45 * r, 0.12 * r, 0.15 * r, 0.18 * r); x.lineTo(0.15 * r, 0.55 * r); x.closePath();
      break;
    case 'bookmark':
      x.moveTo(-0.55 * r, -0.85 * r); x.lineTo(0.55 * r, -0.85 * r); x.lineTo(0.55 * r, 0.85 * r);
      x.lineTo(0, 0.4 * r); x.lineTo(-0.55 * r, 0.85 * r); x.closePath();
      break;
    case 'down':
      x.moveTo(-0.2 * r, -0.85 * r); x.lineTo(0.2 * r, -0.85 * r); x.lineTo(0.2 * r, 0.05 * r); x.lineTo(0.62 * r, 0.05 * r);
      x.lineTo(0, 0.85 * r); x.lineTo(-0.62 * r, 0.05 * r); x.lineTo(-0.2 * r, 0.05 * r); x.closePath();
      break;
    case 'plus':
      if (done) { x.moveTo(-0.55 * r, 0); x.lineTo(-0.15 * r, 0.42 * r); x.lineTo(0.6 * r, -0.45 * r); }
      else { x.moveTo(0, -0.6 * r); x.lineTo(0, 0.6 * r); x.moveTo(-0.6 * r, 0); x.lineTo(0.6 * r, 0); }
      break;
    default: break;
  }
}
const stroked = (name) => name === 'plus';

// Mouse pointer (white arrow, dark outline), tip at (0, 0).
function cursor(x, s, press) {
  x.save(); x.scale(s * (press ? 0.88 : 1), s * (press ? 0.88 : 1));
  x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 1.15); x.lineTo(0.3, 0.88); x.lineTo(0.52, 1.35); x.lineTo(0.68, 1.27); x.lineTo(0.47, 0.82); x.lineTo(0.85, 0.82); x.closePath();
  x.fillStyle = '#ffffff'; x.strokeStyle = '#111111'; x.lineWidth = 0.08; x.lineJoin = 'round';
  x.shadowColor = "#00000066"; x.shadowBlur = s * 0.2; x.fill(); x.shadowBlur = 0; x.stroke();
  x.restore();
}

function layout(x, tx, u) {
  const b = tx.badge, def = BADGES[b.kind] || BADGES.subscribe;
  const label = tx.uppercase ? (tx.content || '').toUpperCase() : tx.content || '';
  x.font = `${tx.italic ? 'italic ' : ''}${tx.bold === false ? '600' : '800'} ${u * 0.5}px "${tx.font}", "Segoe UI", sans-serif`;
  const label2 = b.label2 != null ? b.label2 : def.label2 || '';
  const lw = label ? Math.max(x.measureText(label).width, label2 ? x.measureText(label2).width : 0) : 0;
  const h = u * 1.05, icon = h * 0.62;
  const w = label ? h * 0.3 + icon + h * 0.22 + lw + h * 0.42 : h * 1.6;
  return { def, label, label2, lw, h, w: label ? w : h * 1.6, icon };
}
const fillOf = (x, th, x0, y0, x1, y1) => {
  if (!th.grad) return th.bg;
  const g = x.createLinearGradient(x0, y0, x1, y1); th.grad.forEach((c, i) => g.addColorStop(i / (th.grad.length - 1), c)); return g;
};
// Greedy word wrap to maxW with the current font.
function wrap(x, text, maxW) {
  const lines = [];
  for (const para of String(text).split(/\n/)) {
    let line = '';
    for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (line && x.measureText(t).width > maxW) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
  }
  return lines;
}
const font = (tx, weight, px) => `${tx.italic ? 'italic ' : ''}${weight} ${px}px "${tx.font}", "Segoe UI", "Segoe UI Emoji", sans-serif`;
const who = (tx) => tx.badge.who || 'Tu nombre', handle = (tx) => '@' + String(tx.badge.handle || 'usuario').replace(/^@/, '');
// Tweet card / comment bubble geometry (shared by size and draw).
function cardLayout(x, tx, u, kind) {
  x.font = font(tx, kind === 'tweet' ? 500 : 700, u * (kind === 'tweet' ? 0.55 : 0.5));
  if (kind === 'tweet') {
    const w = u * 13, lines = wrap(x, tx.content || '', w - u * 1.2);
    return { w, h: u * (0.6 + 1.2 + 0.35 + 0.6) + lines.length * u * 0.72 + u * 0.5, lines };
  }
  const lines = wrap(x, tx.content || '', u * 10), tw = Math.max(...lines.map((l) => x.measureText(l).width));
  x.font = font(tx, 500, u * 0.36); const hw = x.measureText('Respuesta a ' + handle(tx)).width;
  return { w: Math.max(tw, hw) + u * 0.9, h: u * (0.45 + 0.5) + lines.length * u * 0.65 + u * 0.35, lines };
}
function avatar(x, tx, cx, cy, r) {
  const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r); g.addColorStop(0, '#8a5cff'); g.addColorStop(1, '#ff6ab0');
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  x.fillStyle = '#fff'; x.font = font(tx, 800, r); x.textAlign = 'center'; x.fillText(who(tx).trim().charAt(0).toUpperCase() || '?', cx, cy + r * 0.05); x.textAlign = 'left';
}

// Each: [size(x, tx, u) → {w, h}, draw(x, tx, th, t, u, dur)], centered at (0, 0). dur = clip duration (s).
const SPECIAL = {
  tweet: [(x, tx, u) => cardLayout(x, tx, u, 'tweet'), (x, tx, th, t, u) => {
    const { w, h, lines } = cardLayout(x, tx, u, 'tweet'), L = -w / 2, T = -h / 2, pad = u * 0.6, sub = '#71767b';
    x.shadowColor = '#00000055'; x.shadowBlur = u * 0.5; x.shadowOffsetY = u * 0.1;
    x.beginPath(); x.roundRect(L, T, w, h, u * 0.45); x.fillStyle = th.bg || '#fff'; x.fill();
    x.shadowColor = 'transparent';
    x.textBaseline = 'middle';
    avatar(x, tx, L + pad + u * 0.6, T + pad + u * 0.6, u * 0.6);
    x.fillStyle = th.fg; x.font = font(tx, 800, u * 0.5); x.fillText(who(tx), L + pad + u * 1.45, T + pad + u * 0.35);
    const nw = x.measureText(who(tx)).width, vx = L + pad + u * 1.45 + nw + u * 0.32, vy = T + pad + u * 0.35;
    x.beginPath(); x.arc(vx, vy, u * 0.2, 0, Math.PI * 2); x.fillStyle = '#1d9bf0'; x.fill();
    x.beginPath(); x.moveTo(vx - u * 0.09, vy); x.lineTo(vx - u * 0.02, vy + u * 0.08); x.lineTo(vx + u * 0.1, vy - u * 0.07); x.strokeStyle = '#fff'; x.lineWidth = u * 0.05; x.stroke();
    x.fillStyle = sub; x.font = font(tx, 500, u * 0.42); x.fillText(handle(tx), L + pad + u * 1.45, T + pad + u * 0.88);
    x.fillStyle = th.fg; x.font = font(tx, 500, u * 0.55);
    lines.forEach((l, i) => x.fillText(l, L + pad, T + pad + u * 1.55 + u * 0.36 + i * u * 0.72));
    // Counters tick up while the card is on screen.
    const fy = T + h - pad - u * 0.15, n = (k) => { const v = Math.floor(k * Math.min(1, t / 2.5)); return v >= 1000 ? (v / 1000).toFixed(1) + ' mil' : String(v); };
    x.fillStyle = sub; x.font = font(tx, 500, u * 0.4);
    x.fillText('♡ ' + n(12400) + '    ⟲ ' + n(1830) + '    💬 ' + n(342), L + pad, fy);
  }],
  bubble: [(x, tx, u) => cardLayout(x, tx, u, 'bubble'), (x, tx, th, t, u) => {
    const { w, h, lines } = cardLayout(x, tx, u, 'bubble'), L = -w / 2, T = -h / 2, pad = u * 0.45;
    x.shadowColor = '#00000044'; x.shadowBlur = u * 0.35;
    x.beginPath(); x.roundRect(L, T, w, h, u * 0.3);
    x.moveTo(L + u * 0.4, T + h - 1); x.lineTo(L + u * 0.25, T + h + u * 0.4); x.lineTo(L + u * 0.95, T + h - 1);
    x.fillStyle = th.bg || '#fff'; x.fill(); x.shadowColor = 'transparent';
    x.textBaseline = 'middle';
    avatar(x, tx, L + pad + u * 0.17, T + pad + u * 0.2, u * 0.2);
    x.fillStyle = '#71767b'; x.font = font(tx, 500, u * 0.36); x.fillText('Respuesta a ' + handle(tx), L + pad + u * 0.5, T + pad + u * 0.2);
    x.fillStyle = th.fg; x.font = font(tx, 700, u * 0.5);
    lines.forEach((l, i) => x.fillText(l, L + pad, T + pad + u * 0.85 + i * u * 0.65));
  }],
  // Live-stream style reactions: the clip's emojis float up from the bottom, wobbling and fading, one every 0.22 s.
  reactions: [(x, tx, u) => ({ w: u * 3, h: u * 7 }), (x, tx, th, t, u) => {
    const list = [...new Intl.Segmenter().segment(tx.content || '❤️')].map((g) => g.segment).filter((g) => g.trim());
    const life = 2.4, every = 0.22, H = u * 7;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let i = Math.max(0, Math.floor((t - life) / every)); i * every <= t; i++) {
      const q = (t - i * every) / life, r = Math.sin(i * 12.9898) * 43758.5453 % 1; // per-particle pseudo-random
      if (q < 0 || q >= 1) continue;
      x.save();
      x.globalAlpha *= Math.min(1, q * 8) * (1 - q * q);
      x.translate(Math.sin(q * 5 + i) * u * 0.5 + r * u * 0.6, H / 2 - u * 0.5 - q * (H - u));
      const k = (0.7 + Math.abs(r) * 0.5) * Math.min(1, 0.4 + q * 4);
      x.font = `${u * k}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      x.fillText(list[i % list.length], 0, 0);
      x.restore();
    }
  }],
  // Video progress bar: fills across the clip's duration, with a glowing head.
  progress: [(x, tx, u) => ({ w: u * 16, h: u * 0.6 }), (x, tx, th, t, u, dur) => {
    const w = u * 16, h = u * 0.3, p = Math.min(1, Math.max(0, t / dur));
    x.beginPath(); x.roundRect(-w / 2, -h / 2, w, h, h / 2); x.fillStyle = '#ffffff40'; x.fill();
    if (p > 0) { x.beginPath(); x.roundRect(-w / 2, -h / 2, Math.max(h, w * p), h, h / 2); x.fillStyle = fillOf(x, th, -w / 2, 0, w / 2, 0); x.fill(); }
    x.shadowColor = '#00000088'; x.shadowBlur = h; x.beginPath(); x.arc(-w / 2 + Math.max(h / 2, w * p - h / 2), 0, h, 0, Math.PI * 2); x.fillStyle = '#ffffff'; x.fill();
  }],
  // Countdown: whole seconds left (dur → 1), each number pops in while a ring empties around it.
  countdown: [(x, tx, u) => ({ w: u * 3, h: u * 3 }), (x, tx, th, t, u, dur) => {
    const left = Math.max(0, dur - t), n = Math.max(1, Math.ceil(left - 1e-6)), f = left - (n - 1), R = u * 1.4; // f: 1 → 0 within each second
    x.shadowColor = '#00000066'; x.shadowBlur = u * 0.3;
    x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fillStyle = fillOf(x, th, -R, -R, R, R); x.fill(); x.shadowBlur = 0;
    x.beginPath(); x.arc(0, 0, R * 0.88, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); x.strokeStyle = th.fg; x.lineWidth = u * 0.14; x.lineCap = 'round'; x.stroke();
    const pop = 1 + 0.35 * Math.max(0, (f - 0.8) / 0.2);
    x.scale(pop, pop); x.fillStyle = th.fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `${tx.italic ? 'italic ' : ''}800 ${u * 1.5}px "${tx.font}", "Segoe UI", sans-serif`;
    x.fillText(String(n), 0, u * 0.08);
  }],
};

export function badgeSize(x, tx, u) {
  if (SPECIAL[tx.badge.kind]) { x.save(); const r = SPECIAL[tx.badge.kind][0](x, tx, u); x.restore(); return { w: r.w, h: r.h }; }
  x.save(); const l = layout(x, tx, u); x.restore(); return { w: l.w, h: l.label ? l.h : l.h * 1.6 }; }

// Draws the sticker centered at (0, 0) of the current transform; u = text size in canvas pixels; t = clip-local seconds;
// dur = clip duration (progress bar, countdown).
export function drawBadge(x, tx, t, u, dur = P) {
  const b = tx.badge;
  if (SPECIAL[b.kind]) { x.save(); SPECIAL[b.kind][1](x, tx, BADGE_THEMES[b.theme] || BADGE_THEMES[BADGES[b.kind].theme], t, u, dur); x.restore(); return; }
  const L = layout(x, tx, u), th = BADGE_THEMES[b.theme] || BADGE_THEMES[L.def.theme];
  const { h, w, icon, def } = L, ph = (t % P + P) % P;
  // Click cycle: the cursor glides in, presses at 1.0 s and leaves; the button stays "done" until the loop restarts.
  const press = def.click && ph > 0.95 && ph < 1.12, done = def.click && ph >= 1.05 && ph < P - 0.15;
  x.save();
  x.textBaseline = 'middle'; x.textAlign = 'left';
  if (!L.label) {
    // Heart: pops with overshoot, then small hearts float up and fade.
    const pop = ph < 0.35 ? ease(ph / 0.35) * 1.25 : ph < 0.55 ? 1.25 - 0.25 * ease((ph - 0.35) / 0.2) : 1;
    const r = h * 0.7;
    for (let i = 0; i < 5; i++) {
      const q = (ph - 0.4 - i * 0.18) / 1.4;
      if (q <= 0 || q >= 1) continue;
      x.save(); x.globalAlpha *= 1 - q; x.translate(Math.sin(q * 6 + i * 2) * r * 0.5 + (i - 2) * r * 0.35, -q * r * 2.4); x.scale(0.35, 0.35);
      iconPath(x, 'heart', r); x.fillStyle = i % 2 ? '#ff6b9a' : '#ff2d55'; x.fill(); x.restore();
    }
    x.save(); x.scale(pop, pop); iconPath(x, 'heart', r);
    const g = x.createLinearGradient(0, -r, 0, r); g.addColorStop(0, '#ff5f8f'); g.addColorStop(1, '#e8113d');
    x.shadowColor = '#00000055'; x.shadowBlur = r * 0.25; x.fillStyle = g; x.fill(); x.restore();
    x.restore();
    return;
  }
  const s = press ? 0.93 : 1;
  x.scale(s, s);
  const bx = -w / 2, by = -h / 2;
  let fill;
  if (done) fill = th.done;
  else if (th.grad) { fill = x.createLinearGradient(bx, by + h, bx + w, by); th.grad.forEach((c, i) => fill.addColorStop(i / (th.grad.length - 1), c)); }
  else fill = th.bg;
  x.save();
  x.shadowColor = '#00000066'; x.shadowBlur = h * 0.25; x.shadowOffsetY = h * 0.06;
  x.beginPath(); x.roundRect(bx, by, w, h, h / 2); x.fillStyle = fill; x.fill();
  x.restore();
  const fg = done && th.doneFg ? th.doneFg : th.fg;
  // Icon, with its own little motion per kind.
  const ix = bx + h * 0.3 + icon / 2, r = icon / 2;
  x.save(); x.translate(ix, 0);
  if (def.icon === 'bell') x.rotate(Math.sin(ph * 22) * Math.max(0, 1 - Math.abs(ph - (def.click ? 1.4 : 0.6)) * 2.5) * 0.45);
  if (def.icon === 'thumb') { const k = done ? 1 + 0.25 * Math.max(0, 1 - (ph - 1.05) * 4) : 1; x.rotate(done ? -0.2 * Math.max(0, 1 - (ph - 1.05) * 3) : 0); x.scale(k, k); }
  if (def.icon === 'share') x.translate(Math.max(0, Math.sin(ph * Math.PI * 2)) * r * 0.35, 0);
  if (def.icon === 'down') x.translate(0, Math.abs(Math.sin(ph * Math.PI * 1.5)) * r * 0.3);
  iconPath(x, def.icon, r, done);
  if (stroked(def.icon)) { x.strokeStyle = fg; x.lineWidth = r * 0.28; x.lineCap = 'round'; x.lineJoin = 'round'; x.stroke(); }
  else { x.fillStyle = def.icon === 'bookmark' && !(ph > 0.8 && ph < 2.6) ? 'transparent' : fg; x.fill(); x.strokeStyle = fg; x.lineWidth = r * 0.16; x.lineJoin = 'round'; if (def.icon === 'bookmark') x.stroke(); }
  if (def.icon === 'bubble') for (let i = 0; i < 3; i++) { // typing dots
    x.beginPath(); x.arc((i - 1) * r * 0.45, -0.1 * r - Math.max(0, Math.sin(ph * 8 - i)) * r * 0.15, r * 0.12, 0, Math.PI * 2);
    x.fillStyle = typeof fill === 'string' ? fill : th.grad ? th.grad[2] : '#000'; x.fill();
  }
  x.restore();
  // Label (state 2 after the click), TikTok-style colored double behind the text.
  const lx = ix + r + h * 0.22, label = done && L.label2 ? L.label2 : L.label;
  x.font = `${tx.italic ? 'italic ' : ''}${tx.bold === false ? '600' : '800'} ${u * 0.5}px "${tx.font}", "Segoe UI", sans-serif`;
  if (th.glitch && !done) { x.fillStyle = th.glitch[0]; x.fillText(label, lx - u * 0.025, -u * 0.02); }
  x.fillStyle = fg; x.fillText(label, lx, 0);
  // Like: burst of rays at the click.
  if (def.icon === 'thumb' && done && ph < 1.6) {
    const q = (ph - 1.05) / 0.55;
    x.save(); x.translate(ix, 0); x.strokeStyle = th.done === '#e4e6eb' ? '#1877f2' : fg; x.lineWidth = h * 0.06; x.lineCap = 'round'; x.globalAlpha *= 1 - q;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; x.beginPath(); x.moveTo(Math.cos(a) * r * (1 + q), Math.sin(a) * r * (1 + q)); x.lineTo(Math.cos(a) * r * (1.3 + q * 1.2), Math.sin(a) * r * (1.3 + q * 1.2)); x.stroke(); }
    x.restore();
  }
  // Click ripple + cursor.
  if (def.click && ph > 0.95 && ph < 1.5) {
    const q = (ph - 0.95) / 0.55;
    x.save(); x.globalAlpha *= 0.5 * (1 - q); x.fillStyle = '#ffffff';
    x.beginPath(); x.arc(bx + w * 0.62, h * 0.1, h * (0.2 + q * 0.9), 0, Math.PI * 2); x.fill(); x.restore();
  }
  if (def.click && ph > 0.3 && ph < 1.9) {
    const inP = ease((ph - 0.3) / 0.6), outP = ease((ph - 1.35) / 0.5);
    const cx = bx + w * 0.62 + (1 - inP) * w * 0.5 + outP * w * 0.45, cy = h * 0.1 + (1 - inP) * h * 1.4 + outP * h * 1.2;
    x.save(); x.globalAlpha *= Math.min(1, (ph - 0.3) * 6) * (1 - outP); x.translate(cx, cy); cursor(x, h * 0.75, press); x.restore();
  }
  x.restore();
}
