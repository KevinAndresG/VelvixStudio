import React, { useEffect, useRef, useState } from 'react';
import { useStore, getState, setState, update, toast } from '../store.js';
import { projectDuration, fmtTime, mediaOf, clipEnd, setProp, transformAt } from '../engine/model.js';
import { renderFrame, activeVisual, textBounds, visualBounds } from '../engine/render.js';
import { SourcePool, frame } from '../engine/sources.js';
import { Icon, IconBtn } from '../ui.jsx';
import { importPaths, addToTimeline } from './actions.js';

let previewPool = null, previewCanvas = null;
export const getPreviewCanvas = () => previewCanvas; // scopes read the frame from here

// Renders the current frame at a given height (thumbnails / snapshots).
export async function snapshotCanvas(height, type = 'image/jpeg') {
  const s = getState(), p = s.project;
  if (!p || !previewPool) return null;
  const h = height || p.height, w = Math.round((p.width / p.height) * h);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  renderFrame(c.getContext('2d'), p, s.time, previewPool.getDrawable, w, h);
  return new Promise((r) => c.toBlob(r, type, 0.9));
}

function Timecode({ fps, duration }) {
  const time = useStore((s) => s.time);
  return <span className="tc"><b>{fmtTime(time, fps)}</b> / {fmtTime(duration, fps)}</span>;
}

export default function Preview() {
  const project = useStore((s) => s.project);
  const playing = useStore((s) => s.playing);
  // Not every frame of playback: the whole stage re-rendering 60 times a second was most of the play cost.
  const pausedTime = useStore((s) => (s.playing ? null : s.time));
  const time = pausedTime ?? getState().time;
  const selection = useStore((s) => s.selection);
  const mainRef = useRef(null), wrapRef = useRef(null), canvasRef = useRef(null), stageRef = useRef(null), boxPending = useRef(false);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const [guides, setGuides] = useState({ v: false, h: false });
  const [, force] = useState(0);
  const [full, setFull] = useState(false);
  // Preview resolution (as CapCut's preview quality): fewer pixels to composite on slow PCs; export is unaffected.
  const [quality, setQuality] = useState(() => { try { return +localStorage.getItem('previewQuality') || 1; } catch { return 1; } });
  const pickQuality = (q) => { setQuality(q); try { localStorage.setItem('previewQuality', String(q)); } catch { /* ignore */ } };
  useEffect(() => { const f = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', f); return () => document.removeEventListener('fullscreenchange', f); }, []);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : mainRef.current.requestFullscreen());
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
    if (window.__velvix) window.__velvix.pool = pool; // E2E hook
    let raf, clock = null, last = {};
    // One bad frame (a clip whose data is broken) must not stop the loop or flood the log: report each message once.
    const failed = new Set();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      try { frameStep(); } catch (e) {
        const m = String(e && e.message);
        if (!failed.has(m)) { failed.add(m); console.error(e); window.api.logError && window.api.logError('preview: ' + (e && e.stack)); toast(`Error en la vista previa: ${m.slice(0, 100)}`, 'error'); }
      }
    };
    const frameStep = () => {
      const s = getState(), p = s.project;
      if (!p || s.exporting) return;
      const canvas = (previewCanvas = canvasRef.current); if (!canvas) return;
      const now = performance.now();
      let t = s.time;
      if (s.playing) {
        // Clock: the audio output's own clock once it runs (what is heard never drifts from the picture, so the
        // elements' rates aren't nudged all the time), the wall clock until then.
        const a = pool.actx && pool.actx.state === 'running' ? pool.actx.currentTime * 1000 : null;
        const clockNow = a ?? now;
        if (!clock) clock = { wall: clockNow, t: s.time, held: 0, audio: a != null };
        else if (!clock.audio && a != null) clock = { ...clock, wall: a, t: clock.t + (now - clock.wall) / 1000, audio: true };
        else if (clock.audio && a == null) clock = { ...clock, wall: now, t: s.time, audio: false }; // audio device lost
        // Buffering: hold the clock (up to 2.5 s, then play on regardless) until the media now on screen can play.
        if (!pool.ready() && (clock.held || (clock.held = now)) && now - clock.held < 2500) {
          clock.wall = clockNow; clock.t = s.time;
          pool.sync(p, t, true, true);
        } else {
          if (pool.ready()) clock.held = 0;
          t = clock.t + (clockNow - clock.wall) / 1000;
          const end = projectDuration(p);
          if (t >= end) { t = end; clock = null; setState({ time: end, playing: false }); }
          else setState({ time: t });
          pool.sync(p, t, true);
        }
      } else {
        clock = null;
        // Paused: render only when something changed (idle used to cost a full composite 60 times a second).
        // ponytail: 4 Hz fallback catches async loads without their own event (LUTs, mattes, animated stickers).
        if (!frame.dirty && p === last.p && t === last.t && canvas.width === last.w && canvas.height === last.h && now - last.at < 250) return;
        pool.sync(p, t, false);
      }
      frame.dirty = false;
      last = { p, t, w: canvas.width, h: canvas.height, at: now };
      renderFrame(canvas.getContext('2d'), p, t, pool.getDrawable, canvas.width, canvas.height);
      // Until the selection box can be measured (a paused video whose frame was not decoded yet when it was selected).
      if (!s.playing && boxPending.current) force((n) => n + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); pool.destroy(); previewPool = null; };
  }, []);

  useEffect(() => { if (playing && previewPool) previewPool.resume(); if (playing && time >= duration - 0.01) setState({ time: 0 }); }, [playing]);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(2, Math.round(Math.min(project.width, box.w * dpr) * quality)), ch = Math.round(cw * (project.height / project.width));

  // ---------- on-canvas selection ----------
  // Bounds of a visual clip at the current time, in stage (CSS) pixels.
  const boundsOf = (clip) => {
    if (!canvasRef.current || !(time >= clip.start && time < clipEnd(clip))) return null;
    const k = box.w / cw;
    const b = clip.type === 'text'
      ? textBounds(canvasRef.current.getContext('2d'), clip, time, cw, ch)
      : previewPool && visualBounds(clip, time, previewPool.getDrawable(clip, mediaOf(project, clip)), cw, ch);
    return b && { cx: b.cx * k, cy: b.cy * k, w: b.w * k, h: b.h * k, rotation: b.rotation };
  };
  const selClip = project.clips.find((c) => c.id === selection[0] && (c.type === 'video' || c.type === 'image' || c.type === 'text'));
  const bounds = selClip && pausedTime !== null ? boundsOf(selClip) : null; // hidden while playing
  boxPending.current = !!selClip && pausedTime !== null && !bounds && time >= selClip.start && time < clipEnd(selClip);

  // Topmost visible element under the pointer (as drawn: top track first), skipping locked tracks.
  const hitAt = (e) => {
    const rect = stageRef.current.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    const items = activeVisual(project, time).filter((i) => i.clip.type !== 'effect' && !i.track.locked && time >= i.clip.start && time < clipEnd(i.clip)).reverse();
    for (const { clip } of items) {
      const b = boundsOf(clip);
      if (!b) continue;
      const a = (-b.rotation * Math.PI) / 180, dx = px - b.cx, dy = py - b.cy;
      const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) <= b.w / 2 && Math.abs(ry) <= b.h / 2) return { clip, b };
    }
    return null;
  };

  const startDrag = (e, mode, clip = selClip, b = bounds) => {
    e.preventDefault(); e.stopPropagation();
    const rect = stageRef.current.getBoundingClientRect();
    const tr0 = transformAt(clip, time), x0 = e.clientX, y0 = e.clientY;
    const cx = rect.left + b.cx, cy = rect.top + b.cy;
    const d0 = Math.hypot(x0 - cx, y0 - cy), a0 = Math.atan2(y0 - cy, x0 - cx);
    const key = `${mode}-${clip.id}-${Date.now()}`;
    let moved = mode !== 'move'; // a plain click selects without nudging the clip
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
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

  // Click selects (and starts moving) the topmost element under the cursor, as a click on its timeline clip does,
  // also inside the box of the current selection when something else is drawn above it there.
  const pick = (e) => {
    if (e.button !== 0) return;
    const hit = hitAt(e);
    if (!hit) { setState({ selection: [] }); return; }
    if (selection.length !== 1 || selection[0] !== hit.clip.id) setState({ selection: [hit.clip.id] });
    if (e.detail === 2 && hit.clip.type === 'text') { window.dispatchEvent(new Event('velvix:focus-text')); return; }
    startDrag(e, 'move', hit.clip, hit.b);
  };

  const snapshot = async () => {
    const blob = await snapshotCanvas(project.height, 'image/png');
    const out = await window.api.saveDialog({ defaultPath: `${project.name} ${fmtTime(time).replace(/[:.]/g, '-')}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (out && blob) { await window.api.writeFile(out, await blob.arrayBuffer()); toast('Fotograma guardado'); }
  };
  const step = (d) => setState({ time: Math.max(0, Math.min(duration, getState().time + d)), playing: false });

  return (
    <main className="preview" ref={mainRef}>
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
              onPointerDown={pick}>
              {['nw', 'ne', 'sw', 'se'].map((h) => <i key={h} className={`h ${h}`} onPointerDown={(e) => startDrag(e, 'scale')} />)}
              <b className="rot" title="Rotar (Shift: libre)" onPointerDown={(e) => startDrag(e, 'rotate')}>⟳</b>
            </div>
          )}
        </div>
      </div>
      <div className="player-bar">
        <Timecode fps={project.fps} duration={duration} />
        <div className="pb-center">
          <IconBtn icon="stepBack" title="Fotograma anterior (←)" onClick={() => step(-1 / project.fps)} size={16} />
          <button className="play-btn" onClick={() => setState({ playing: !playing })} title="Reproducir (Espacio)" aria-label="Reproducir">
            <Icon name={playing ? 'pause' : 'play'} fill size={20} />
          </button>
          <IconBtn icon="stepFwd" title="Fotograma siguiente (→)" onClick={() => step(1 / project.fps)} size={16} />
        </div>
        <div className="pb-right">
          <select className="pq" value={quality} onChange={(e) => pickQuality(+e.target.value)} title="Calidad de la vista previa (no cambia la exportación)">
            <option value={1}>Completa</option><option value={0.5}>Media</option><option value={0.25}>Baja</option>
          </select>
          <IconBtn icon="camera" title="Guardar fotograma como imagen" onClick={snapshot} size={16} />
          <IconBtn icon={full ? 'min' : 'max'} title={full ? 'Salir de pantalla completa (Esc)' : 'Pantalla completa'} onClick={toggleFull} size={16} />
        </div>
      </div>
    </main>
  );
}
