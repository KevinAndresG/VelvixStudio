import React, { useEffect, useRef, useState } from 'react';
import { useStore, getState, setState, update, toast } from '../store.js';
import { projectDuration, fmtTime, mediaOf, clipEnd, setProp, transformAt } from '../engine/model.js';
import { renderFrame, activeVisual, textBounds, visualBounds } from '../engine/render.js';
import { SourcePool } from '../engine/sources.js';
import { Icon, IconBtn } from '../ui.jsx';
import { importPaths, addToTimeline } from './actions.js';

let previewPool = null;

// Renders the current frame at a given height (thumbnails / snapshots).
export async function snapshotCanvas(height, type = 'image/jpeg') {
  const s = getState(), p = s.project;
  if (!p || !previewPool) return null;
  const h = height || p.height, w = Math.round((p.width / p.height) * h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  renderFrame(c.getContext('2d'), p, s.time, previewPool.getDrawable, w, h);
  return new Promise((r) => c.toBlob(r, type, 0.9));
}

export default function Preview() {
  const project = useStore((s) => s.project);
  const playing = useStore((s) => s.playing);
  const time = useStore((s) => s.time);
  const selection = useStore((s) => s.selection);
  const wrapRef = useRef(null), canvasRef = useRef(null), stageRef = useRef(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [guides, setGuides] = useState({ v: false, h: false });
  const [, force] = useState(0);
  const duration = projectDuration(project);

  // Fit the stage inside the available area keeping the project aspect ratio.
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const el = wrapRef.current; if (!el) return;
      const W = el.clientWidth - 24, H = el.clientHeight - 24, a = project.width / project.height;
      setBox(W / H > a ? { w: H * a, h: H } : { w: W, h: W / a });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  // Playback + render loop.
  useEffect(() => {
    const pool = (previewPool = new SourcePool('preview'));
    pool.onError = (clip) => toast(`No se puede reproducir "${clip.name}". Usa Importar de nuevo para crear una versión compatible.`, 'error');
    let raf, clock = null, lastSel = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = getState(), p = s.project;
      if (!p || s.exporting) return;
      const canvas = canvasRef.current; if (!canvas) return;
      let t = s.time;
      if (s.playing) {
        const now = performance.now();
        if (!clock) clock = { wall: now, t: s.time };
        t = clock.t + (now - clock.wall) / 1000;
        const end = projectDuration(p);
        if (t >= end) { t = end; clock = null; setState({ time: end, playing: false }); }
        else setState({ time: t });
      } else clock = null;
      pool.sync(p, t, s.playing);
      renderFrame(canvas.getContext('2d'), p, t, pool.getDrawable, canvas.width, canvas.height);
      // Refresh selection overlay when a clip under it moves (keyframes/animations).
      const key = s.selection.join() + Math.round(t * 30);
      if (key !== lastSel && s.selection.length) { lastSel = key; force((n) => n + 1); }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); pool.destroy(); previewPool = null; };
  }, []);

  useEffect(() => { if (playing && previewPool) previewPool.resume(); if (playing && time >= duration - 0.01) setState({ time: 0 }); }, [playing]);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(Math.min(project.width, box.w * dpr)), ch = Math.round(cw * (project.height / project.width));

  // ---------- on-canvas selection ----------
  const selClip = project.clips.find((c) => c.id === selection[0] && (c.type === 'video' || c.type === 'image' || c.type === 'text'));
  let bounds = null;
  if (selClip && time >= selClip.start && time < clipEnd(selClip) && canvasRef.current) {
    const k = box.w / cw;
    const b = selClip.type === 'text'
      ? textBounds(canvasRef.current.getContext('2d'), selClip, time, cw, ch)
      : previewPool && visualBounds(selClip, time, previewPool.getDrawable(selClip, mediaOf(project, selClip)), cw, ch);
    if (b) bounds = { cx: b.cx * k, cy: b.cy * k, w: b.w * k, h: b.h * k, rotation: b.rotation };
  }

  const startDrag = (e, mode) => {
    e.preventDefault(); e.stopPropagation();
    const clip = selClip, rect = stageRef.current.getBoundingClientRect();
    const tr0 = transformAt(clip, time), x0 = e.clientX, y0 = e.clientY;
    const cx = rect.left + bounds.cx, cy = rect.top + bounds.cy;
    const d0 = Math.hypot(x0 - cx, y0 - cy), a0 = Math.atan2(y0 - cy, x0 - cx);
    const key = `${mode}-${clip.id}-${Date.now()}`;
    const move = (ev) => {
      update((p) => {
        const c = p.clips.find((x) => x.id === clip.id);
        if (mode === 'move') {
          let nx = tr0.x + (ev.clientX - x0) / rect.width, ny = tr0.y + (ev.clientY - y0) / rect.height;
          const sv = Math.abs(nx) < 0.012 && !ev.altKey, sh = Math.abs(ny) < 0.012 && !ev.altKey;
          if (sv) nx = 0; if (sh) ny = 0;
          setGuides({ v: sv, h: sh });
          setProp(c, 'x', nx, time, p.fps); setProp(c, 'y', ny, time, p.fps);
        } else if (mode === 'scale') {
          const ns = Math.max(0.02, tr0.scale * (Math.hypot(ev.clientX - cx, ev.clientY - cy) / Math.max(1, d0)));
          setProp(c, 'scale', Math.round(ns * 1000) / 1000, time, p.fps);
        } else if (mode === 'rotate') {
          let r = tr0.rotation + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
          if (!ev.shiftKey) for (const snap of [-180, -90, 0, 90, 180]) if (Math.abs(r - snap) < 4) r = snap;
          setProp(c, 'rotation', Math.round(r * 10) / 10, time, p.fps);
        }
      }, key);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setGuides({ v: false, h: false }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // Click selects the topmost visual element under the cursor.
  const pick = (e) => {
    const rect = stageRef.current.getBoundingClientRect(), k = cw / box.w;
    const px = (e.clientX - rect.left) * k, py = (e.clientY - rect.top) * k;
    const items = activeVisual(project, time).filter((i) => i.clip.type !== 'effect' && time >= i.clip.start && time < clipEnd(i.clip)).reverse();
    for (const { clip } of items) {
      const b = clip.type === 'text' ? textBounds(canvasRef.current.getContext('2d'), clip, time, cw, ch) : visualBounds(clip, time, previewPool.getDrawable(clip, mediaOf(project, clip)), cw, ch);
      if (!b) continue;
      const a = (-b.rotation * Math.PI) / 180, dx = px - b.cx, dy = py - b.cy;
      const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) <= b.w / 2 && Math.abs(ry) <= b.h / 2) {
        setState({ selection: [clip.id] });
        if (e.detail === 2 && clip.type === 'text') window.dispatchEvent(new Event('velvix:focus-text'));
        return;
      }
    }
    setState({ selection: [] });
  };

  const snapshot = async () => {
    const blob = await snapshotCanvas(project.height, 'image/png');
    const out = await window.api.saveDialog({ defaultPath: `${project.name} ${fmtTime(time).replace(/[:.]/g, '-')}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (out && blob) { await window.api.writeFile(out, await blob.arrayBuffer()); toast('Fotograma guardado'); }
  };
  const step = (d) => setState({ time: Math.max(0, Math.min(duration, time + d)), playing: false });

  return (
    <main className="preview">
      <div className="stage-wrap" ref={wrapRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData('velvix/media');
          if (id) { const m = project.media.find((x) => x.id === id); if (m) addToTimeline(m); return; }
          const files = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
          for (const m of await importPaths(files)) addToTimeline(m);
        }}>
        <div className="stage" ref={stageRef} style={{ width: box.w, height: box.h }} onPointerDown={pick}>
          <canvas ref={canvasRef} width={cw} height={ch} style={{ width: box.w, height: box.h }} />
          {!project.clips.length && (
            <div className="stage-empty"><Icon name="film" size={40} /><p>Arrastra medios aquí o desde el panel de la izquierda</p></div>
          )}
          {guides.v && <div className="guide v" />}
          {guides.h && <div className="guide h" />}
          {bounds && (
            <div className="sel-box" style={{ left: bounds.cx, top: bounds.cy, width: bounds.w, height: bounds.h, transform: `translate(-50%,-50%) rotate(${bounds.rotation}deg)` }}
              onPointerDown={(e) => startDrag(e, 'move')}>
              {['nw', 'ne', 'sw', 'se'].map((h) => <i key={h} className={`h ${h}`} onPointerDown={(e) => startDrag(e, 'scale')} />)}
              <b className="rot" title="Rotar (Shift: libre)" onPointerDown={(e) => startDrag(e, 'rotate')}>⟳</b>
            </div>
          )}
        </div>
      </div>
      <div className="player-bar">
        <span className="tc"><b>{fmtTime(time, project.fps)}</b> / {fmtTime(duration, project.fps)}</span>
        <div className="pb-center">
          <IconBtn icon="stepBack" title="Fotograma anterior (←)" onClick={() => step(-1 / project.fps)} size={16} />
          <button className="play-btn" onClick={() => setState({ playing: !playing })} title="Reproducir (Espacio)" aria-label="Reproducir">
            <Icon name={playing ? 'pause' : 'play'} fill size={20} />
          </button>
          <IconBtn icon="stepFwd" title="Fotograma siguiente (→)" onClick={() => step(1 / project.fps)} size={16} />
        </div>
        <div className="pb-right">
          <IconBtn icon="camera" title="Guardar fotograma como imagen" onClick={snapshot} size={16} />
          <IconBtn icon="max" title="Pantalla completa" onClick={() => wrapRef.current.requestFullscreen()} size={16} />
        </div>
      </div>
    </main>
  );
}
