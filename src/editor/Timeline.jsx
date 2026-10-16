import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, getState, setState, update, toast } from '../store.js';
import { projectDuration, clipEnd, mediaOf, fmtTime, mediaUrl, EFFECTS, TRANSITIONS, clamp, sourceTime, subClip, speedAt } from '../engine/model.js';
import { Icon, IconBtn } from '../ui.jsx';
import {
  splitAtPlayhead, deleteSelected, duplicateSelected, freezeFrame, toggleReverse, detachAudio, addMarker,
  packMain, ensureTrack, cleanupTracks, addToTimeline, importPaths,
} from './actions.js';

const ROW_H = { main: 66, video: 54, text: 34, effect: 34, audio: 48 };
const rowH = (t) => (t.main ? ROW_H.main : ROW_H[t.kind]);
const HEAD_W = 132;
const kindFor = (c) => (c.type === 'image' ? 'video' : c.type);

const peaksCache = new Map();
function usePeaks(path) {
  const [p, setP] = useState(() => peaksCache.get(path));
  useEffect(() => {
    if (!path || peaksCache.has(path)) { setP(peaksCache.get(path)); return; }
    let live = true;
    window.api.peaks(path).then((pk) => { peaksCache.set(path, pk); if (live) setP(pk); }).catch(() => {});
    return () => { live = false; };
  }, [path]);
  return p;
}

function Waveform({ clip, media, width, height, color }) {
  const ref = useRef(null);
  const peaks = usePeaks(media && media.path);
  useEffect(() => {
    const c = ref.current; if (!c || !peaks) return;
    const w = Math.min(Math.max(1, Math.round(width)), 8000), h = height;
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.clearRect(0, 0, w, h); x.fillStyle = color;
    const sx = width / w;
    for (let i = 0; i < w; i++) {
      const local = (i * sx) / getState().zoom;
      let t = sourceTime(clip, clip.start + local, null);
      if (clip.reverse) t = 2 * clip.in + clip.duration * clip.speed - t;
      const v = (peaks[Math.floor(t * 50)] || 0) * clip.volume * (clip.muted ? 0 : 1);
      const bh = Math.max(1, Math.min(1, v) * h * 0.95);
      x.fillRect(i, h - bh, 1, bh);
    }
  }, [peaks, width, height, clip.in, clip.speed, clip.curve, clip.volume, clip.muted, clip.reverse, clip.duration, color]);
  return <canvas ref={ref} className="wave" style={{ width, height }} />;
}

function FilmStrip({ clip, media, width, height }) {
  if (!media || !media.strip) return null;
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const tileW = Math.max(24, height * aspect), count = Math.min(300, Math.ceil(width / tileW));
  const zoom = getState().zoom;
  if (media.type === 'image') return <div className="strip" style={{ backgroundImage: `url("${mediaUrl(media.thumb)}")`, backgroundSize: `${tileW}px ${height}px`, height }} />;
  const tiles = [];
  for (let i = 0; i < count; i++) {
    const local = (i * tileW) / zoom;
    const t = clamp(sourceTime(clip, clip.start + local, null), 0, media.duration);
    const idx = Math.min(15, Math.floor((t / Math.max(0.01, media.duration)) * 16));
    tiles.push(<i key={i} style={{ left: i * tileW, width: tileW, height, backgroundImage: `url("${mediaUrl(media.strip)}")`, backgroundSize: `${tileW * 16}px ${height}px`, backgroundPosition: `${-idx * tileW}px 0` }} />);
  }
  return <div className="strip" style={{ height }}>{tiles}</div>;
}

function Clip({ clip, track, project, zoom, selected, ghost, onDown, onTrim, onContext }) {
  const media = mediaOf(project, clip);
  const left = (ghost ? ghost.start : clip.start) * zoom, width = Math.max(4, clip.duration * zoom);
  const h = rowH(track) - 6;
  const kfTimes = [...new Set(Object.values(clip.kf || {}).flat().map((k) => k.t))];
  const label = clip.type === 'text' ? clip.text.content : clip.type === 'effect' ? (clip.filter ? 'Filtro' : EFFECTS[clip.effect.type]) : clip.name;
  return (
    <div className={`clip c-${clip.type} ${selected ? 'sel' : ''} ${ghost ? 'dragging' : ''} ${media && media.missing ? 'missing' : ''}`}
      style={{ left, width, height: h }}
      onPointerDown={(e) => onDown(e, clip)} onContextMenu={(e) => onContext(e, clip)} title={label}>
      {(clip.type === 'video' || clip.type === 'image') && <FilmStrip clip={clip} media={media} width={width} height={h} />}
      {clip.type === 'video' && media && media.hasAudio && !clip.detached && track.main && (
        <div className="clip-wave"><Waveform clip={clip} media={media} width={width} height={14} color="rgba(255,255,255,.55)" /></div>
      )}
      {clip.type === 'audio' && <Waveform clip={clip} media={media} width={width} height={h - 14} color="rgba(120,255,210,.75)" />}
      <div className="clip-label">
        {(clip.speed !== 1 || clip.curve) && <b className="badge">{clip.curve ? '〰 ' : ''}{+clip.speed.toFixed(2)}×</b>}
        {clip.reverse && <b className="badge">⟲</b>}
        {clip.detached && <b className="badge" title="Audio separado">🔇</b>}
        {clip.fxPath && <b className="badge" title="Efecto de voz">FX</b>}
        {clip.filter && clip.filter.preset !== 'none' && clip.type !== 'effect' && <b className="badge">◐</b>}
        <span>{label}</span>
        {clip.type !== 'text' && clip.type !== 'effect' && <em>{fmtTime(clip.duration)}</em>}
      </div>
      {clip.transition && <span className="trans-mark" title={`Transición: ${TRANSITIONS[clip.transition.type]}`} style={{ width: Math.max(10, (clip.transition.duration / 2) * zoom) }}>⧓</span>}
      {(clip.fadeIn > 0 || clip.fadeOut > 0) && (
        <svg className="fades" width={width} height={h} preserveAspectRatio="none">
          {clip.fadeIn > 0 && <polygon points={`0,${h} ${clip.fadeIn * zoom},0 0,0`} />}
          {clip.fadeOut > 0 && <polygon points={`${width},${h} ${width - clip.fadeOut * zoom},0 ${width},0`} />}
        </svg>
      )}
      {selected && kfTimes.map((t) => <span key={t} className="kf-dot" style={{ left: t * zoom }}>◆</span>)}
      {!track.locked && <>
        <i className="trim l" onPointerDown={(e) => onTrim(e, clip, 'l')} />
        <i className="trim r" onPointerDown={(e) => onTrim(e, clip, 'r')} />
      </>}
    </div>
  );
}

function Ruler({ zoom, width, fps, onSeek }) {
  const steps = [1 / fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => s * zoom >= 80) || 600;
  const minor = step / 5, ticks = [];
  for (let i = 0; i * minor * zoom < width && i < 4000; i++) {
    const t = Math.round(i * minor * 1000) / 1000, major = i % 5 === 0;
    ticks.push(<i key={i} className={major ? 'mj' : ''} style={{ left: t * zoom }}>{major && <span>{step < 1 ? fmtTime(t, fps) : fmtTime(t).slice(0, 5)}</span>}</i>);
  }
  return <div className="ruler" style={{ width }} onPointerDown={onSeek}>{ticks}</div>;
}

function TrackHead({ track, onDown, dragging }) {
  const set = (k) => update((p) => { const t = p.tracks.find((x) => x.id === track.id); t[k] = !t[k]; });
  const icon = { video: 'film', audio: 'music', text: 'type', effect: 'sparkles' }[track.kind];
  return (
    <div className={`track-head ${track.main ? 'main' : ''} ${dragging ? 'dragging' : ''}`} style={{ height: rowH(track) }}
      onPointerDown={(e) => !e.target.closest('button') && onDown(e, track)} title="Arrastra para reordenar la pista">
      <Icon name={track.caption ? 'cc' : icon} size={14} />
      <span title={track.name}>{track.main ? 'Principal' : track.name}</span>
      <div className="th-btns">
        {(track.kind === 'video' || track.kind === 'audio') && <IconBtn icon={track.muted ? 'mute' : 'volume'} size={13} title={track.muted ? 'Activar sonido' : 'Silenciar pista'} active={track.muted} onClick={() => set('muted')} />}
        {track.kind !== 'audio' && <IconBtn icon={track.hidden ? 'eyeOff' : 'eye'} size={13} title={track.hidden ? 'Mostrar' : 'Ocultar'} active={track.hidden} onClick={() => set('hidden')} />}
        <IconBtn icon={track.locked ? 'lock' : 'unlock'} size={13} title={track.locked ? 'Desbloquear' : 'Bloquear'} active={track.locked} onClick={() => set('locked')} />
      </div>
    </div>
  );
}

export default function Timeline() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.zoom);
  const time = useStore((s) => s.time);
  const selection = useStore((s) => s.selection);
  const snap = useStore((s) => s.snap);
  const magnet = useStore((s) => s.magnet);
  const playing = useStore((s) => s.playing);
  const scrollRef = useRef(null);
  const [drag, setDrag] = useState(null); // { ids, dt, trackId }
  const [menu, setMenu] = useState(null);
  const [height, setHeight] = useState(() => +localStorage.getItem('tlHeight') || 300);
  const [snapLine, setSnapLine] = useState(null);
  const [box, setBox] = useState(null); // box selection rectangle in .tracks coordinates
  const [trackDrag, setTrackDrag] = useState(null); // { id, y }
  const duration = projectDuration(project);
  const [viewW, setViewW] = useState(1000);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => scrollRef.current && setViewW(scrollRef.current.clientWidth));
    ro.observe(scrollRef.current); return () => ro.disconnect();
  }, []);
  const contentW = Math.max(viewW, (duration + 20) * zoom);

  // Keep the playhead visible during playback.
  useEffect(() => {
    const el = scrollRef.current; if (!el || !playing) return;
    const x = time * zoom;
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = x - 80;
  }, [time, playing, zoom]);

  // Ctrl+wheel zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current;
    const wheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const z = getState().zoom, nz = clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 4, 800);
      const rect = el.getBoundingClientRect(), mx = e.clientX - rect.left, tAt = (el.scrollLeft + mx) / z;
      setState({ zoom: nz });
      requestAnimationFrame(() => { el.scrollLeft = tAt * nz - mx; });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const tracks = project.tracks;
  const trackY = useMemo(() => { let y = 0; return tracks.map((t) => { const r = y; y += rowH(t); return r; }); }, [tracks]);
  const totalH = tracks.reduce((a, t) => a + rowH(t), 0);

  const xToTime = (clientX) => { const el = scrollRef.current, r = el.getBoundingClientRect(); return Math.max(0, (clientX - r.left + el.scrollLeft) / getState().zoom); };
  const yToTrack = (clientY) => {
    const r = scrollRef.current.getBoundingClientRect(), y = clientY - r.top - 26 + scrollRef.current.scrollTop;
    for (let i = 0; i < tracks.length; i++) if (y >= trackY[i] && y < trackY[i] + rowH(tracks[i])) return tracks[i];
    return y < 0 ? 'above' : 'below';
  };

  // Snap candidates: clip edges, playhead, markers, zero.
  const snapPoints = (ignore) => {
    const pts = [0, getState().time, ...(project.markers || []).map((m) => m.t)];
    for (const c of project.clips) if (!ignore.includes(c.id)) pts.push(c.start, clipEnd(c));
    return pts;
  };
  const snapTo = (t, pts, alt) => {
    if (!getState().snap || alt) return [t, null];
    const thr = 8 / getState().zoom;
    let best = null;
    for (const p of pts) if (Math.abs(p - t) < thr && (best == null || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return best == null ? [t, null] : [best, best];
  };

  const seekFrom = (e) => {
    const go = (ev) => setState({ time: Math.min(xToTime(ev.clientX), Math.max(duration, 0)), playing: false });
    go(e);
    const up = () => { window.removeEventListener('pointermove', go); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', go); window.addEventListener('pointerup', up);
  };

  // Empty area: click seeks, drag draws a selection box (Shift/Ctrl adds to the selection).
  const onEmptyDown = (e) => {
    if (e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    const base = e.shiftKey || e.ctrlKey ? selection : [];
    let boxing = false;
    const move = (ev) => {
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      if (!boxing && Math.hypot(x1 - x0, y1 - y0) < 5) return;
      boxing = true;
      const bx = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      setBox(bx);
      const ids = project.clips.filter((c) => {
        const i = tracks.findIndex((t) => t.id === c.trackId);
        return i >= 0 && c.start * zoom < bx.x + bx.w && clipEnd(c) * zoom > bx.x && trackY[i] < bx.y + bx.h && trackY[i] + rowH(tracks[i]) > bx.y;
      }).map((c) => c.id);
      setState({ selection: [...new Set([...base, ...ids])] });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setBox(null);
      if (!boxing) setState({ selection: base, time: Math.min(xToTime(ev.clientX), Math.max(duration, 0)), playing: false });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  // Drag a track head to reorder it (visual tracks among visual tracks, audio among audio).
  const onTrackDown = (e, track) => {
    if (e.button !== 0) return;
    const heads = e.currentTarget.parentElement, y0 = e.clientY, audio = (t) => t.kind === 'audio';
    const from = tracks.indexOf(track), others = tracks.filter((t) => t !== track);
    const lo = others.findIndex((t) => audio(t) === audio(track)), hi = others.findLastIndex((t) => audio(t) === audio(track)) + 1;
    let to = null;
    const move = (ev) => {
      if (to == null && Math.abs(ev.clientY - y0) < 5) return;
      const y = ev.clientY - heads.getBoundingClientRect().top;
      let i = trackY.findIndex((ty, k) => y < ty + rowH(tracks[k]) / 2);
      if (i < 0) i = tracks.length;
      to = clamp(i > from ? i - 1 : i, lo < 0 ? 0 : lo, lo < 0 ? others.length : hi); // index among the other tracks
      setTrackDrag({ id: track.id, y: to < others.length ? trackY[tracks.indexOf(others[to])] : totalH });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setTrackDrag(null);
      if (to == null || to === from) return;
      update((p) => { const [t] = p.tracks.splice(from, 1); p.tracks.splice(to, 0, t); });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const onClipDown = (e, clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const track = tracks.find((t) => t.id === clip.trackId);
    let ids = selection;
    if (e.shiftKey || e.ctrlKey) ids = selection.includes(clip.id) ? selection.filter((x) => x !== clip.id) : [...selection, clip.id];
    else if (!selection.includes(clip.id)) ids = [clip.id];
    setState({ selection: ids });
    if (track.locked) return;
    const moving = project.clips.filter((c) => ids.includes(c.id));
    const x0 = e.clientX, t0 = xToTime(e.clientX), pts = snapPoints(ids);
    let started = false, last = null;
    const move = (ev) => {
      if (!started && Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - e.clientY) < 4) return;
      started = true;
      let dt = xToTime(ev.clientX) - t0;
      dt = Math.max(dt, -Math.min(...moving.map((c) => c.start)));
      // Snap either edge of the grabbed clip.
      const [s1, l1] = snapTo(clip.start + dt, pts, ev.altKey), [s2, l2] = snapTo(clipEnd(clip) + dt, pts, ev.altKey);
      if (l1 != null) dt = s1 - clip.start; else if (l2 != null) dt = s2 - clipEnd(clip);
      setSnapLine(l1 ?? l2);
      const over = yToTrack(ev.clientY);
      const target = moving.length === 1 && typeof over === 'object' && over.kind === kindFor(clip) ? over.id : moving.length === 1 && typeof over === 'string' ? over : null;
      last = { ids, dt, trackId: target };
      setDrag(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDrag(null); setSnapLine(null);
      if (!started || !last) return;
      const { dt, trackId } = last;
      update((p) => {
        const ms = p.clips.filter((c) => ids.includes(c.id));
        for (const c of ms) c.start = Math.max(0, c.start + dt);
        if (ms.length === 1) {
          const c = ms[0];
          let tk = p.tracks.find((t) => t.id === (typeof trackId === 'string' && trackId !== 'above' && trackId !== 'below' ? trackId : c.trackId));
          if (trackId === 'above' || trackId === 'below') { c.trackId = null; c.trackId = ensureTrack(p, kindFor(c), c.start, clipEnd(c), [c.id]); tk = p.tracks.find((t) => t.id === c.trackId); }
          else c.trackId = tk.id;
          if (tk.main && getState().magnet) {
            // Reorder within main track by drop position.
            const others = p.clips.filter((x) => x.trackId === tk.id && x.id !== c.id).sort((a, b) => a.start - b.start);
            let idx = others.findIndex((x) => c.start < x.start + x.duration / 2);
            if (idx < 0) idx = others.length;
            others.splice(idx, 0, c);
            let t = 0; for (const x of others) { x.start = t; t += x.duration; }
          } else if (!tk.main) {
            const clash = p.clips.some((x) => x.trackId === tk.id && x.id !== c.id && x.start < clipEnd(c) - 1e-4 && clipEnd(x) > c.start + 1e-4);
            if (clash) c.trackId = ensureTrack(p, kindFor(c), c.start, clipEnd(c), [c.id]);
          }
          if (c.transition) {
            const prev = p.clips.find((x) => x.trackId === c.trackId && Math.abs(clipEnd(x) - c.start) < 0.05);
            if (!prev) c.transition = null;
          }
        }
        packMain(p); cleanupTracks(p);
      });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const onTrim = (e, clip, side) => {
    e.stopPropagation(); e.preventDefault();
    setState({ selection: [clip.id] });
    const media = mediaOf(project, clip), pts = snapPoints([clip.id]);
    const key = `trim-${clip.id}-${Date.now()}`;
    const c0 = structuredClone(clip);
    const unbounded = clip.type === 'text' || clip.type === 'effect' || clip.type === 'image';
    const move = (ev) => {
      let [t, line] = snapTo(xToTime(ev.clientX), pts, ev.altKey);
      setSnapLine(line);
      update((p) => {
        const c = p.clips.find((x) => x.id === clip.id);
        if (side === 'r') {
          let end = Math.max(c0.start + 0.1, t);
          if (!unbounded && media) end = Math.min(end, clipEnd(c0) + (media.duration - c0.in - c0.duration * c0.speed) / speedAt(c0, clipEnd(c0)));
          c.duration = end - c0.start;
          if (c0.curve) { const k = subClip(c0, 0, c.duration); c.curve = k.curve; c.speed = k.speed; }
        } else {
          let start = Math.min(t, clipEnd(c0) - 0.1);
          if (!unbounded && media) start = Math.max(start, c0.start - c0.in / speedAt(c0, c0.start)); // past the edges a curve keeps its edge speed
          start = Math.max(0, start);
          const d = start - c0.start;
          c.start = start; c.duration = c0.duration - d;
          if (!unbounded) c.in = c0.in + d * c0.speed;
          if (c0.curve) { const k = subClip(c0, d, c0.duration); c.curve = k.curve; c.speed = k.speed; c.in = c0.in + k.off; }
          for (const k of Object.keys(c.kf || {})) c.kf[k] = c0.kf[k].map((f) => ({ ...f, t: f.t - d })).filter((f) => f.t >= 0);
          if (c.words) c.words = c0.words.map((w) => ({ s: w.s - d, e: w.e - d }));
        }
        if (c.fadeIn) c.fadeIn = Math.min(c.fadeIn, c.duration);
        if (c.fadeOut) c.fadeOut = Math.min(c.fadeOut, c.duration);
        packMain(p);
      }, key);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setSnapLine(null); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    const at = xToTime(e.clientX), over = yToTrack(e.clientY);
    const id = e.dataTransfer.getData('velvix/media');
    let list = [];
    if (id) list = [project.media.find((m) => m.id === id)].filter(Boolean);
    else list = await importPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean));
    let t = at;
    for (const m of list) {
      const kind = m.type === 'audio' ? 'audio' : 'video';
      const trackId = typeof over === 'object' && over.kind === kind ? over.id : null;
      addToTimeline(m, { at: t, trackId });
      t += m.duration;
    }
  };

  const onContext = (e, clip) => {
    e.preventDefault();
    if (!selection.includes(clip.id)) setState({ selection: [clip.id] });
    setMenu({ x: e.clientX, y: e.clientY, clip });
  };

  const tool = (icon, title, fn, disabled) => <IconBtn icon={icon} title={title} onClick={fn} disabled={disabled} />;
  const selClip = project.clips.find((c) => c.id === selection[0]);
  const hasSel = selection.length > 0;

  const startResize = (e) => {
    const y0 = e.clientY, h0 = height;
    const move = (ev) => setHeight(clamp(h0 - (ev.clientY - y0), 160, window.innerHeight - 300));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); localStorage.setItem('tlHeight', String(height)); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div className="timeline" style={{ height }} onClick={() => menu && setMenu(null)}>
      <div className="tl-resize" onPointerDown={startResize} />
      <div className="tl-tools">
        <div className="tools-left">
          {tool('split', 'Dividir (S)', splitAtPlayhead)}
          {tool('trash', 'Eliminar (Supr)', deleteSelected, !hasSel)}
          {tool('copy', 'Duplicar (Ctrl+D)', duplicateSelected, !hasSel)}
          <span className="sep" />
          {tool('snow', 'Congelar fotograma', freezeFrame)}
          {tool('reverse', 'Invertir reproducción', toggleReverse, !selClip || selClip.type !== 'video')}
          {tool('music', 'Separar audio', detachAudio, !selClip || selClip.type !== 'video')}
          {tool('marker', 'Agregar marcador (M)', addMarker)}
        </div>
        <div className="tools-right">
          <IconBtn icon="magnet" title={`Pista principal magnética: ${magnet ? 'activada' : 'desactivada'}`} active={magnet} onClick={() => setState({ magnet: !magnet })} />
          <IconBtn icon="link" title={`Ajuste a bordes: ${snap ? 'activado' : 'desactivado'}`} active={snap} onClick={() => setState({ snap: !snap })} />
          <span className="sep" />
          <IconBtn icon="zoomOut" title="Alejar (Ctrl −)" onClick={() => setState({ zoom: Math.max(4, zoom / 1.3) })} />
          <input type="range" className="zoom" min={0} max={100} value={Math.round((Math.log(zoom / 4) / Math.log(200)) * 100)}
            onChange={(e) => setState({ zoom: 4 * Math.pow(200, +e.target.value / 100) })} aria-label="Zoom" style={{ '--p': `${(Math.log(zoom / 4) / Math.log(200)) * 100}%` }} />
          <IconBtn icon="zoomIn" title="Acercar (Ctrl +)" onClick={() => setState({ zoom: Math.min(800, zoom * 1.3) })} />
          <button className="btn sm" onClick={() => setState({ zoom: clamp((viewW - 60) / Math.max(1, duration), 4, 800) })}>Ajustar</button>
        </div>
      </div>
      <div className="tl-body">
        <div className="tl-heads" style={{ paddingTop: 26 }}>
          <div className="heads-inner" style={{ transform: `translateY(${-(scrollRef.current ? scrollRef.current.scrollTop : 0)}px)` }}>
            {tracks.map((t) => <TrackHead key={t.id} track={t} onDown={onTrackDown} dragging={trackDrag && trackDrag.id === t.id} />)}
            {trackDrag && <div className="track-drop" style={{ top: trackDrag.y }} />}
          </div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}
          onScroll={(e) => { const h = e.currentTarget.parentElement.querySelector('.heads-inner'); if (h) h.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`; }}>
          <div className="tl-content" style={{ width: contentW }}>
            <Ruler zoom={zoom} width={contentW} fps={project.fps} onSeek={seekFrom} />
            <div className="tracks" style={{ height: Math.max(totalH + 60, 120) }} onPointerDown={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('track')) onEmptyDown(e); }}>
              {tracks.map((t, i) => (
                <div key={t.id} className={`track k-${t.kind} ${t.main ? 'main' : ''} ${t.hidden ? 'hidden' : ''} ${drag && drag.trackId === t.id ? 'drop' : ''}`} style={{ top: trackY[i], height: rowH(t) }}>
                  {project.clips.filter((c) => c.trackId === t.id).map((c) => (
                    <Clip key={c.id} clip={c} track={t} project={project} zoom={zoom} selected={selection.includes(c.id)}
                      ghost={drag && drag.ids.includes(c.id) ? { start: Math.max(0, c.start + drag.dt) } : null}
                      onDown={onClipDown} onTrim={onTrim} onContext={onContext} />
                  ))}
                </div>
              ))}
              {!project.clips.length && <div className="tl-empty" style={{ top: 8 }}>Arrastra aquí tus videos, fotos y audio</div>}
              {drag && (drag.trackId === 'above' || drag.trackId === 'below') && <div className="new-track-hint" style={{ top: drag.trackId === 'above' ? 0 : totalH }} />}
              {box && <div className="box-select" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
            </div>
            {(project.markers || []).map((m) => (
              <span key={m.id} className={`marker${m.beat ? " beat" : ""}`} style={{ left: m.t * zoom }} title={m.beat ? "Beat (clic derecho para quitar)" : "Marcador (clic derecho para quitar)"}
                onClick={() => setState({ time: m.t })}
                onContextMenu={(e) => { e.preventDefault(); update((p) => { p.markers = p.markers.filter((x) => x.id !== m.id); }); }} />
            ))}
            {snapLine != null && <div className="snap-line" style={{ left: snapLine * zoom }} />}
            <div className="playhead" style={{ left: time * zoom }} onPointerDown={(e) => { e.stopPropagation(); seekFrom(e); }}><i /></div>
          </div>
        </div>
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menu.x, top: Math.min(menu.y, window.innerHeight - 260) }} onClick={() => setMenu(null)}>
          <button onClick={splitAtPlayhead}>Dividir <kbd>S</kbd></button>
          <button onClick={duplicateSelected}>Duplicar <kbd>Ctrl+D</kbd></button>
          {menu.clip.type === 'video' && <button onClick={detachAudio}>Separar audio</button>}
          {menu.clip.type === 'video' && <button onClick={toggleReverse}>{menu.clip.reverse ? 'Quitar inversión' : 'Invertir'}</button>}
          {menu.clip.type === 'video' && <button onClick={freezeFrame}>Congelar fotograma</button>}
          {menu.clip.type === 'video' && menu.clip.detached && <button onClick={() => update((p) => { p.clips.find((c) => c.id === menu.clip.id).detached = false; })}>Restaurar audio original</button>}
          <button onClick={() => window.api.showItem(mediaOf(project, menu.clip)?.path || '')} disabled={!menu.clip.mediaId}>Mostrar archivo en carpeta</button>
          <button className="danger" onClick={deleteSelected}>Eliminar <kbd>Supr</kbd></button>
        </div>
      )}
    </div>
  );
}
