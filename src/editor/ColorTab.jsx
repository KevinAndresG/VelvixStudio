// Color pro: scopes, LUT (.cube), lift/gamma/gain wheels, RGB curves, HSL per color and skin smoothing.
// Everything lives in clip.filter, so it is graded by gl.js in preview and export alike.
import React, { useEffect, useRef, useState } from 'react';
import { useStore, toast } from '../store.js';
import { propAt, setProp, clamp } from '../engine/model.js';
import { curveFn, parseCube } from '../engine/gl.js';
import { Slider, Section } from '../ui.jsx';
import { KfSlider } from './Inspector.jsx';
import { getPreviewCanvas } from './Preview.jsx';

export default function ColorTab({ clip, edit }) {
  return (
    <>
      <Scopes />
      <LutSection clip={clip} edit={edit} />
      <WheelsSection clip={clip} edit={edit} />
      <CurvesSection clip={clip} edit={edit} />
      <HslSection clip={clip} edit={edit} />
      <Section title="Retoque facial">
        <KfSlider clip={clip} edit={edit} prop="filter.skin" label="Suavizar piel" min={0} max={100} reset={0} />
        <p className="hint">Suaviza solo los tonos de piel y conserva los bordes (ojos, pelo, contorno).</p>
      </Section>
    </>
  );
}

// ---------- scopes ----------
// Histogram / luma waveform of the preview frame, sampled a few times per second.
function Scopes() {
  const [mode, setMode] = useState('hist');
  const ref = useRef(null);
  useEffect(() => {
    const W = 256, H = 100, sw = 256, sh = 144;
    const small = document.createElement('canvas'); small.width = sw; small.height = sh;
    const sx = small.getContext('2d', { willReadFrequently: true });
    const id = setInterval(() => {
      const src = getPreviewCanvas(), out = ref.current;
      if (!src || !out || !src.width) return;
      sx.drawImage(src, 0, 0, sw, sh);
      const d = sx.getImageData(0, 0, sw, sh).data, x = out.getContext('2d'), img = x.createImageData(W, H), o = img.data;
      for (let i = 0; i < o.length; i += 4) { o[i] = 11; o[i + 1] = 11; o[i + 2] = 15; o[i + 3] = 255; }
      if (mode === 'hist') {
        const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
        for (let i = 0; i < d.length; i += 4) { bins[0][d[i]]++; bins[1][d[i + 1]]++; bins[2][d[i + 2]]++; }
        let max = 1;
        for (const b of bins) for (let i = 1; i < 255; i++) max = Math.max(max, b[i]); // ends clip: ignore for scale
        for (let c = 0; c < 3; c++) for (let v = 0; v < 256; v++) {
          const h = Math.min(H, Math.round((Math.sqrt(bins[c][v] / max)) * H));
          for (let y = H - h; y < H; y++) { const k = (y * W + v) * 4; o[k + c] = 220; }
        }
      } else {
        const acc = new Uint16Array(W * H);
        for (let y = 0; y < sh; y++) for (let px = 0; px < sw; px++) {
          const i = (y * sw + px) * 4, l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          acc[Math.round((1 - l / 255) * (H - 1)) * W + px]++;
        }
        for (let i = 0; i < acc.length; i++) if (acc[i]) { const v = Math.min(255, 60 + acc[i] * 25); o[i * 4] = v * 0.6; o[i * 4 + 1] = v; o[i * 4 + 2] = v * 0.6; }
      }
      x.putImageData(img, 0, 0);
      x.strokeStyle = 'rgba(255,255,255,.12)';
      for (const g of [0.25, 0.5, 0.75]) { x.beginPath(); if (mode === 'hist') { x.moveTo(g * W, 0); x.lineTo(g * W, H); } else { x.moveTo(0, g * H); x.lineTo(W, g * H); } x.stroke(); }
    }, 200);
    return () => clearInterval(id);
  }, [mode]);
  return (
    <Section title="Scopes">
      <div className="seg">
        <button className={mode === 'hist' ? 'active' : ''} onClick={() => setMode('hist')}>Histograma</button>
        <button className={mode === 'wave' ? 'active' : ''} onClick={() => setMode('wave')}>Forma de onda</button>
      </div>
      <canvas ref={ref} className="scope" data-scope={mode} width={256} height={100} />
    </Section>
  );
}

// ---------- LUT ----------
function LutSection({ clip, edit }) {
  const f = clip.filter;
  const load = async () => {
    const file = await window.api.openFile([{ name: 'LUT 3D', extensions: ['cube'] }]);
    if (!file) return;
    try { parseCube(await window.api.readFile(file)); } catch (e) { return toast(e.message, 'error'); }
    const lut = await window.api.lutImport(file), name = file.split(/[\\/]/).pop().replace(/\.cube$/i, '');
    edit((c) => { Object.assign(c.filter, { lut, lutName: name, lutMix: 100 }); });
  };
  return (
    <Section title="LUT" right={f.lut && <button className="link" onClick={() => edit((c) => { c.filter.lut = null; c.filter.lutName = ''; })}>Quitar</button>}>
      <div className="row-btns">
        <button className="btn sm" onClick={load} data-lut>Cargar LUT (.cube)</button>
        {f.lut && <span className="lut-name" title={f.lutName}>{f.lutName}</span>}
      </div>
      {f.lut && <KfSlider clip={clip} edit={edit} prop="filter.lutMix" label="Intensidad" min={0} max={100} unit="%" reset={100} />}
    </Section>
  );
}

// ---------- wheels ----------
function WheelsSection({ clip, edit }) {
  return (
    <Section title="Ruedas de color" right={<button className="link" onClick={() => edit((c) => { for (const w of ['lift', 'gamma', 'gain']) for (const s of ['X', 'Y', '']) { c.filter[w + s] = 0; if (c.kf) delete c.kf[`filter.${w}${s}`]; } })}>Restablecer</button>}>
      <div className="wheels">
        {[['lift', 'Sombras'], ['gamma', 'Medios'], ['gain', 'Luces']].map(([k, l]) => <Wheel key={k} clip={clip} edit={edit} k={k} label={l} />)}
      </div>
      <KfSlider clip={clip} edit={edit} prop="filter.lift" label="Nivel sombras" min={-100} max={100} reset={0} />
      <KfSlider clip={clip} edit={edit} prop="filter.gamma" label="Nivel medios" min={-100} max={100} reset={0} />
      <KfSlider clip={clip} edit={edit} prop="filter.gain" label="Nivel luces" min={-100} max={100} reset={0} />
    </Section>
  );
}
function Wheel({ clip, edit, k, label }) {
  const time = useStore((s) => s.time);
  const ref = useRef(null);
  const x = propAt(clip, `filter.${k}X`, time), y = propAt(clip, `filter.${k}Y`, time);
  const put = (nx, ny, key) => edit((c, p) => { setProp(c, `filter.${k}X`, nx, time, p.fps); setProp(c, `filter.${k}Y`, ny, time, p.fps); }, key);
  const down = (e) => {
    e.preventDefault();
    const key = `wheel-${k}-${Date.now()}`;
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      let nx = ((ev.clientX - r.left) / r.width - 0.5) * 200, ny = -((ev.clientY - r.top) / r.height - 0.5) * 200;
      const m = Math.hypot(nx, ny);
      if (m > 100) { nx *= 100 / m; ny *= 100 / m; }
      put(Math.round(nx), Math.round(ny), key);
    };
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="wheel-box">
      <div className="wheel" ref={ref} data-wheel={k} onPointerDown={down} onDoubleClick={() => put(0, 0)} title="Arrastra para teñir · doble clic restablece">
        <i style={{ left: `${50 + x / 2}%`, top: `${50 - y / 2}%` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

// ---------- curves ----------
const ID = () => [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const CH = { m: ['RGB', '#e8e8f0'], r: ['R', '#ff5a5a'], g: ['G', '#4cd964'], b: ['B', '#4a9dff'] };
function CurvesSection({ clip, edit }) {
  const [ch, setCh] = useState('m');
  const ref = useRef(null);
  const cv = clip.filter.curves || {}, pts = cv[ch] || ID();
  const S = 200;
  const setPts = (next, key) => edit((c) => { c.filter.curves = { m: ID(), r: ID(), g: ID(), b: ID(), ...(c.filter.curves || {}), [ch]: next }; }, key);
  const at = (ev) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clamp((ev.clientX - r.left) / r.width, 0, 1), y: clamp(1 - (ev.clientY - r.top) / r.height, 0, 1) };
  };
  const drag = (i, start) => {
    const key = `curve-${ch}-${Date.now()}`;
    let cur = start;
    const move = (ev) => {
      const q = at(ev), next = cur.map((p) => ({ ...p }));
      const lo = i > 0 ? cur[i - 1].x + 0.01 : 0, hi = i < cur.length - 1 ? cur[i + 1].x - 0.01 : 1;
      next[i] = { x: +clamp(q.x, lo, hi).toFixed(3), y: +q.y.toFixed(3) };
      setPts((cur = next), key);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const add = (ev) => {
    if (ev.target.tagName === 'circle') return;
    const q = at(ev), fn = curveFn(pts);
    const next = [...pts, { x: +q.x.toFixed(3), y: +clamp(fn(q.x), 0, 1).toFixed(3) }].sort((a, b) => a.x - b.x);
    setPts(next);
    drag(next.findIndex((p) => p.x === +q.x.toFixed(3)), next);
  };
  const fn = curveFn(pts);
  const line = Array.from({ length: 65 }, (_, i) => `${(i / 64) * S},${(1 - clamp(fn(i / 64), 0, 1)) * S}`).join(' ');
  return (
    <Section title="Curvas" right={<button className="link" onClick={() => edit((c) => { c.filter.curves = null; })}>Restablecer</button>}>
      <div className="seg">
        {Object.entries(CH).map(([k, [l]]) => <button key={k} className={ch === k ? 'active' : ''} onClick={() => setCh(k)}>{l}</button>)}
      </div>
      <svg ref={ref} className="rgb-curve" data-curve={ch} viewBox={`0 0 ${S} ${S}`} onPointerDown={add}>
        {[0.25, 0.5, 0.75].map((g) => <g key={g}><line x1={g * S} x2={g * S} y1={0} y2={S} /><line y1={g * S} y2={g * S} x1={0} x2={S} /></g>)}
        <line x1={0} y1={S} x2={S} y2={0} className="diag" />
        <polyline points={line} style={{ stroke: CH[ch][1] }} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x * S} cy={(1 - p.y) * S} r={5} style={{ fill: CH[ch][1] }}
            onPointerDown={(e) => { e.stopPropagation(); drag(i, pts); }}
            onDoubleClick={() => pts.length > 2 && setPts(pts.filter((_, j) => j !== i))} />
        ))}
      </svg>
      <p className="hint">Clic agrega un punto, arrastra para moverlo, doble clic lo quita.</p>
    </Section>
  );
}

// ---------- HSL ----------
const HSL = [['red', '#ff3b30', 'Rojo'], ['orange', '#ff9500', 'Naranja'], ['yellow', '#ffcc00', 'Amarillo'], ['green', '#34c759', 'Verde'],
  ['aqua', '#32d4de', 'Aguamarina'], ['blue', '#2f7bff', 'Azul'], ['purple', '#8e5cf7', 'Morado'], ['magenta', '#ff2dc0', 'Magenta']];
function HslSection({ clip, edit }) {
  const [sel, setSel] = useState('red');
  const v = (clip.filter.hsl && clip.filter.hsl[sel]) || [0, 0, 0];
  const set = (i, val, key) => edit((c) => {
    const h = (c.filter.hsl = { ...(c.filter.hsl || {}) });
    h[sel] = [...(h[sel] || [0, 0, 0])]; h[sel][i] = val;
  }, key);
  return (
    <Section title="HSL" right={<button className="link" onClick={() => edit((c) => { c.filter.hsl = null; })}>Restablecer</button>}>
      <div className="hsl-chips">
        {HSL.map(([k, col, name]) => {
          const used = clip.filter.hsl && clip.filter.hsl[k] && clip.filter.hsl[k].some((x) => x);
          return <button key={k} title={name} data-hsl={k} className={`${sel === k ? 'active' : ''} ${used ? 'used' : ''}`} style={{ background: col }} onClick={() => setSel(k)} />;
        })}
      </div>
      <Slider label={`Tono · ${HSL.find((h) => h[0] === sel)[2]}`} value={v[0]} min={-100} max={100} reset={0} onChange={(x) => set(0, x, 'hsl-h-' + sel)} />
      <Slider label="Saturación" value={v[1]} min={-100} max={100} reset={0} onChange={(x) => set(1, x, 'hsl-s-' + sel)} />
      <Slider label="Luminancia" value={v[2]} min={-100} max={100} reset={0} onChange={(x) => set(2, x, 'hsl-l-' + sel)} />
    </Section>
  );
}
