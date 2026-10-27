import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, setState, update, toast } from '../store.js';
import { projectDuration, fmtTime, ASPECTS, clipEnd } from '../engine/model.js';
import { renderFrame } from '../engine/render.js';
import { preloadLuts, preloadMattes } from '../engine/gl.js';
import { ExportPool, audioSegments } from '../engine/sources.js';
import { toSRT } from './captions.js';
import { reframedCopy } from './vision.js';
import { Icon, Select, Toggle, Modal } from '../ui.jsx';

const RES = { 480: '480p', 720: '720p', 1080: '1080p (Full HD)', 1440: '2K', 2160: '4K' };
const FORMATS = { mp4: 'MP4 (H.264)', webm: 'WebM (VP9)', gif: 'GIF animado', mp3: 'Solo audio MP3', wav: 'Solo audio WAV' };
// Platform presets: vertical 1080×1920 for short-form apps, 16:9 1080p for YouTube.
const PRESETS = {
  custom: { label: 'Personalizado' },
  tiktok: { label: 'TikTok', aspect: '9:16', res: '1080', format: 'mp4', quality: 'high' },
  reels: { label: 'Instagram Reels', aspect: '9:16', res: '1080', format: 'mp4', quality: 'high' },
  shorts: { label: 'YouTube Shorts', aspect: '9:16', res: '1080', format: 'mp4', quality: 'high' },
  youtube: { label: 'YouTube', aspect: '16:9', res: '1080', format: 'mp4', quality: 'high' },
};
const SUBS = { burn: 'Quemados en el video', srt: 'Archivo SRT aparte', both: 'Quemados + archivo SRT' };
const RETRIES = 3;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
// Hardware H.264 encoder in the renderer; only small encoded chunks cross IPC.
async function makeEncoder(W, H, fps, quality, onChunk, onError) {
  if (!window.VideoEncoder) return null;
  const bpp = { low: 0.05, med: 0.09, high: 0.15 }[quality];
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
    const cfg = { codec: 'avc1.640033', width: W, height: H, bitrate: Math.round(W * H * fps * bpp), framerate: fps, hardwareAcceleration, bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'annexb' } };
    const sup = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported) continue;
    const enc = new VideoEncoder({ output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); onChunk(b, chunk); }, error: onError });
    enc.configure(cfg);
    return enc;
  }
  return null;
}
const concat = (parts) => { const n = parts.reduce((a, p) => a + p.byteLength, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; } return out.buffer; };
const safeName = (s) => s.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'video';
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const MULTI = ['16:9', '9:16', '1:1'];
const sigOf = (rp, W, H, fps, quality, a, b) => JSON.stringify([{ ...rp, updatedAt: 0, thumb: null, name: '', transcript: null, media: rp.media.map(({ missing, thumb, strip, ...m }) => m) }, W, H, fps, quality, a, b]);

export default function ExportDialog({ onClose }) {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const duration = projectDuration(project);
  const short = Math.min(project.width, project.height);
  const hasCaptions = project.clips.some((c) => c.caption);
  const [preset, setPreset] = useState('custom');
  const [name, setName] = useState(safeName(project.name));
  const [res, setRes] = useState(String(Math.min(1080, short >= 1080 ? 1080 : 720)));
  const [fps, setFps] = useState(String(project.fps));
  const [quality, setQuality] = useState('high');
  const [format, setFormat] = useState('mp4');
  const [hw, setHw] = useState(true);
  const [hwName, setHwName] = useState(null);
  const [subs, setSubs] = useState('burn');
  const [range, setRange] = useState('all');
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(+duration.toFixed(2));
  const [resume, setResume] = useState(null);
  const [extra, setExtra] = useState([]); // more formats exported after the main one, each reframed
  const [state, setStateL] = useState({ phase: 'setup' }); // setup | running | mux | done | error
  const cancelRef = useRef(false);
  const previewRef = useRef(null);

  useEffect(() => { window.api.exportHw().then(setHwName); }, []);

  const audioOnly = format === 'mp3' || format === 'wav';
  const k = +res / short;
  const W = even(project.width * k), H = even(project.height * k);
  const outFps = format === 'gif' ? Math.min(15, +fps) : +fps;
  const selClips = project.clips.filter((c) => selection.includes(c.id));
  const [a, b] = range === 'sel' && selClips.length ? [Math.min(...selClips.map((c) => c.start)), Math.min(duration, Math.max(...selClips.map(clipEnd)))]
    : range === 'custom' ? [Math.max(0, Math.min(num(from, 0), duration)), Math.min(duration, num(to, duration))] : [0, duration];
  const span = Math.max(0, b - a);
  const sizeMB = audioOnly ? (span * (format === 'mp3' ? 320 : 1411)) / 8 / 1024 : (span * (W * H * outFps * { low: 0.04, med: 0.08, high: 0.14 }[quality] + 192000)) / 8 / 1048576;
  const burn = !hasCaptions || subs !== 'srt';
  const renderProject = useMemo(() => (burn ? project : { ...project, clips: project.clips.filter((c) => !c.caption) }), [project, burn]);
  // Identifies one export (content + settings): a checkpoint is only resumed for the very same export.
  // Only what changes the pixels: not name/dates/thumbnails or the `missing` flag openProject adds on reopen.
  const sig = useMemo(() => sigOf(renderProject, W, H, outFps, quality, a, b), [renderProject, W, H, outFps, quality, a, b]);
  const resumable = format === 'mp4' && !audioOnly;
  useEffect(() => { if (state.phase === 'setup' || state.phase === 'error') window.api.exportResumable(sig).then((r) => setResume(resumable ? r : null)); }, [sig, resumable, state.phase]);

  const pickPreset = (key) => {
    setPreset(key);
    const p = PRESETS[key];
    if (!p.res) return;
    setRes(p.res); setFormat(p.format); setQuality(p.quality);
    setFps(String(project.fps >= 50 ? 60 : 30));
  };
  const presetAspect = PRESETS[preset].aspect;

  const start = async (resumeFrom = null) => {
    if (!span) return toast(duration ? 'El rango está vacío' : 'La línea de tiempo está vacía', 'error');
    let out = resumeFrom && resumeFrom.out;
    if (!out) {
      const { videos } = await window.api.paths();
      out = await window.api.saveDialog({ defaultPath: `${videos}\\${name}.${format}`, filters: [{ name: FORMATS[format], extensions: [format] }] });
    }
    if (!out) return;
    setState({ playing: false });
    cancelRef.current = false;
    const t0 = performance.now();
    setStateL({ phase: 'running', progress: resumeFrom ? resumeFrom.f / Math.ceil(span * outFps) : 0, out, eta: null });
    if (hasCaptions && subs !== 'burn') {
      // Captions of the range, shifted so the SRT starts with the exported video.
      const clips = project.clips.filter((c) => c.caption && c.start < b && clipEnd(c) > a)
        .map((c) => ({ ...c, start: Math.max(0, c.start - a), duration: Math.min(clipEnd(c), b) - Math.max(c.start, a) }));
      await window.api.writeFile(out.replace(/\.[^.\\/]+$/, '') + '.srt', new TextEncoder().encode(toSRT({ clips })));
    }
    const segs = audioSegments(project);
    const job = { out, format, width: W, height: H, fps: outFps, quality, hw, segs, total: b, from: a, audioOnly };
    const offAudio = window.api.onAudioExportProgress((p) => setStateL((s) => ({ ...s, progress: p })));
    try {
      if (audioOnly) {
        const r = await window.api.exportStart(job);
        setStateL(r.ok ? { phase: 'done', out, secs: (performance.now() - t0) / 1000 } : cancelRef.current ? { phase: 'setup' } : { phase: 'error', error: r.error });
        return;
      }
      setState({ exporting: true }); // pauses the preview loop so export gets the GPU/main thread
      await Promise.all([preloadLuts(project), preloadMattes(project)]);
      const frames = Math.max(1, Math.ceil(span * outFps - 1e-6)); // float slack: 9.2000000001 s must stay 276 frames
      const ok = await encodeFrames(job, frames, resumeFrom, t0, { proj: renderProject, W, H, sig });
      if (!ok) return;
      setStateL((s) => ({ ...s, phase: 'mux', progress: 0 }));
      const r = await window.api.exportFinish();
      if (!r.ok) return setStateL({ phase: 'error', error: r.error });
      const outs = [out];
      // Same project in the other chosen formats: reframed copy (faces followed), same range/settings.
      for (const [i, asp] of extra.filter((x) => x !== project.aspect).entries()) {
        setStateL((s) => ({ ...s, phase: 'running', progress: 0, eta: null, label: `Formato ${asp} (${i + 2}/${extra.length + 1})` }));
        const vp = await reframedCopy(renderProject, asp);
        const k2 = +res / Math.min(vp.width, vp.height), W2 = even(vp.width * k2), H2 = even(vp.height * k2);
        const o2 = out.replace(/(\.[^.\\/]+)$/, `-${asp.replace(':', 'x')}$1`);
        const v = { proj: vp, W: W2, H: H2, sig: sigOf(vp, W2, H2, outFps, quality, a, b) };
        if (!(await encodeFrames({ ...job, out: o2, width: W2, height: H2 }, frames, null, performance.now(), v))) return;
        setStateL((s) => ({ ...s, phase: 'mux', progress: 0 }));
        const r2 = await window.api.exportFinish();
        if (!r2.ok) return setStateL({ phase: 'error', error: r2.error });
        outs.push(o2);
      }
      setStateL({ phase: 'done', out, outs, secs: (performance.now() - t0) / 1000 });
    } catch (e) {
      setStateL({ phase: 'error', error: e.message });
    } finally {
      offAudio(); setState({ exporting: false });
    }
  };

  // Renders and encodes frames [startF, frames). Returns false when cancelled or failed (state already set).
  const encodeFrames = async (job, frames, resumeFrom, t0, { proj, W, H, sig }) => {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    const pctx = previewRef.current && previewRef.current.getContext('2d');
    const tAt = (f) => Math.min(b - 0.0001, a + f / outFps);
    const show = (f) => {
      if (pctx) pctx.drawImage(canvas, 0, 0, pctx.canvas.width, pctx.canvas.height);
      const el = (performance.now() - t0) / 1000, p = (f + 1) / frames, p0 = resumeFrom ? resumeFrom.f / frames : 0;
      setStateL((s) => ({ ...s, progress: p, eta: p > p0 ? (el / (p - p0)) * (1 - p) : null }));
    };
    const fail = (f) => { const x = window.__velvixFail; if (x && f === x.at && x.n > 0) { x.n--; throw new Error('Fallo simulado'); } }; // E2E hook

    // MP4 with WebCodecs: resumable. Encoded H.264 goes to a temp file with a checkpoint at every keyframe
    // (each 2 s); on a failure the pass restarts from the last checkpoint with a fresh decoder and encoder.
    const last = resumeFrom ? { f: resumeFrom.f, off: resumeFrom.off } : { f: 0, off: 0 };
    const pass = async () => {
      let bytes = last.off, chunks = [], ckpt = null, encError = null;
      const encoder = format === 'mp4' ? await makeEncoder(W, H, outFps, quality, (buf, chunk) => {
        if (chunk.type === 'key') ckpt = { f: Math.round((chunk.timestamp * outFps) / 1e6), off: bytes };
        bytes += buf.byteLength; chunks.push(buf);
      }, (e) => { encError = e; }) : null;
      if (!encoder) return null;
      const r0 = await window.api.exportStart({ ...job, videoInput: 'h264', sig, resume: last.f ? last : null });
      if (!r0.ok) throw new Error(r0.error);
      const flush = async () => {
        const c = ckpt, data = concat(chunks); // taken before awaiting: the encoder keeps emitting meanwhile
        ckpt = null; chunks = [];
        if (!(await window.api.exportFrame(data, c))) throw new Error('No se pudo escribir el archivo temporal');
        if (c) Object.assign(last, c);
      };
      const pool = new ExportPool();
      try {
        for (let f = last.f; f < frames; f++) {
          if (cancelRef.current) throw new Error('cancel');
          fail(f);
          await pool.prepare(proj, tAt(f));
          renderFrame(ctx, proj, tAt(f), pool.getDrawable, W, H);
          if (encError) throw encError;
          const vf = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / outFps), duration: Math.round(1e6 / outFps) });
          encoder.encode(vf, { keyFrame: f === last.f || f % (outFps * 2) === 0 });
          vf.close();
          // Bounded wait: a broken encoder may never fire 'dequeue'.
          while (encoder.encodeQueueSize > 6 && !encError) await new Promise((r) => { encoder.addEventListener('dequeue', r, { once: true }); setTimeout(r, 50); });
          if (chunks.length >= 8) await flush();
          if (f % 8 === 0) show(f);
        }
        await encoder.flush();
        if (encError) throw encError;
        await flush();
        return true;
      } finally {
        pool.destroy();
        if (encoder.state !== 'closed') encoder.close();
      }
    };

    for (let tries = 0; ; tries++) {
      try {
        const r = await pass();
        if (r) return true;
        break; // no WebCodecs encoder: raw fallback below
      } catch (e) {
        const cancel = e.message === 'cancel';
        await window.api.exportCancel(null, !cancel);
        if (cancel) { setStateL({ phase: 'setup' }); return false; }
        console.warn('export pass failed', e);
        if (tries >= RETRIES) { setStateL({ phase: 'error', error: `${e.message}\nSe guardó el progreso: puedes reanudar la exportación.` }); return false; }
        setStateL((s) => ({ ...s, retry: tries + 1 }));
      }
    }

    // Fallback (WebM, GIF, no WebCodecs): raw RGBA piped to ffmpeg. ponytail: not resumable, it's the rare path.
    const r0 = await window.api.exportStart({ ...job, videoInput: 'raw' });
    if (!r0.ok) { setStateL({ phase: 'error', error: r0.error }); return false; }
    const pool = new ExportPool();
    let pending = null; // overlap IPC of frame N with seeking frame N+1
    try {
      for (let f = 0; f < frames; f++) {
        if (cancelRef.current) throw new Error('cancel');
        await pool.prepare(proj, tAt(f));
        renderFrame(ctx, proj, tAt(f), pool.getDrawable, W, H);
        // Raw RGBA readback: canvas.toBlob runs as an idle task and stalls ~1 s/frame under load.
        const px = ctx.getImageData(0, 0, W, H).data.buffer;
        if (pending && !(await pending)) throw new Error('ffmpeg');
        pending = window.api.exportFrame(px);
        if (f % 8 === 0) show(f);
      }
      if (pending && !(await pending)) throw new Error('ffmpeg');
      return true;
    } catch (e) {
      if (e.message === 'ffmpeg') { const r = await window.api.exportFinish(); setStateL({ phase: 'error', error: r.error }); return false; }
      await window.api.exportCancel(job.out);
      setStateL(e.message === 'cancel' ? { phase: 'setup' } : { phase: 'error', error: e.message });
      return false;
    } finally { pool.destroy(); }
  };

  const busy = state.phase === 'running' || state.phase === 'mux';
  const resumePct = resume ? Math.round((resume.f / Math.max(1, Math.ceil(span * outFps))) * 100) : 0;
  return (
    <Modal title="Exportar" onClose={() => !busy && onClose()} width={560}>
      {state.phase === 'setup' && (
        <div className="export">
          <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(safeName(e.target.value))} /></label>
          <Select label="Plataforma" value={preset} options={Object.fromEntries(Object.entries(PRESETS).map(([key, p]) => [key, p.label]))} onChange={pickPreset} />
          {presetAspect && presetAspect !== project.aspect && (
            <p className="hint warn">{PRESETS[preset].label} usa formato {presetAspect} y el proyecto es {project.aspect}.{' '}
              <button className="btn sm" onClick={() => update((p) => { const [w, h] = ASPECTS[presetAspect]; p.aspect = presetAspect; p.width = w; p.height = h; })}>Cambiar a {presetAspect}</button>
            </p>
          )}
          <Select label="Formato" value={format} options={FORMATS} onChange={(v) => { setFormat(v); setPreset('custom'); }} />
          {!audioOnly && <>
            <Select label="Resolución" value={res} options={RES} onChange={(v) => { setRes(v); setPreset('custom'); }} />
            {format !== 'gif' && <Select label="Cuadros por segundo" value={fps} options={{ 24: '24', 25: '25', 30: '30', 50: '50', 60: '60' }} onChange={setFps} />}
            <Select label="Calidad" value={quality} options={{ low: 'Baja (archivo pequeño)', med: 'Recomendada', high: 'Alta' }} onChange={setQuality} />
            {format === 'mp4' && <Toggle label={`Aceleración por GPU ${hwName ? `(${hwName.replace('h264_', '').toUpperCase()})` : hwName === '' ? '(no disponible)' : ''}`} value={hw && !!hwName} onChange={setHw} />}
            {hasCaptions && <Select label="Subtítulos" value={subs} options={SUBS} onChange={setSubs} />}
            <div className="field multi-fmt"><span>Exportar también en</span>
              <div className="row2">{MULTI.filter((x) => x !== project.aspect).map((x) => (
                <button key={x} className={`btn sm ${extra.includes(x) ? 'primary' : ''}`} onClick={() => setExtra(extra.includes(x) ? extra.filter((y) => y !== x) : [...extra, x])}>{x}</button>
              ))}</div>
            </div>
            {extra.length > 0 && <p className="hint">Cada formato extra se reencuadra siguiendo la cara y se guarda junto al principal (nombre-9x16…).</p>}
          </>}
          <Select label="Rango" value={range} options={{ all: 'Todo el video', ...(selClips.length ? { sel: 'Clips seleccionados' } : {}), custom: 'Personalizado' }} onChange={setRange} />
          {range === 'custom' && (
            <div className="row2 range">
              <label className="field"><span>Desde (s)</span><input type="number" min={0} step={0.1} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field"><span>Hasta (s)</span><input type="number" min={0} step={0.1} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          )}
          <dl className="info">
            {!audioOnly && <><dt>Tamaño de salida</dt><dd>{W}×{H}</dd></>}
            <dt>Duración</dt><dd>{fmtTime(span)}{range !== 'all' ? ` (${fmtTime(a)} – ${fmtTime(b)})` : ''}</dd>
            <dt>Tamaño estimado</dt><dd>~{sizeMB < 1 ? sizeMB.toFixed(1) : Math.round(sizeMB)} MB</dd>
          </dl>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>Cancelar</button>
            {resume && <button className="btn resume" onClick={() => start(resume)} title={resume.out}><Icon name="play" size={15} /> Reanudar ({resumePct}%)</button>}
            <button className="btn primary" onClick={() => start()}><Icon name="download" size={16} /> Exportar</button>
          </div>
        </div>
      )}
      {busy && (
        <div className="export running">
          {!audioOnly && <canvas ref={previewRef} width={320} height={Math.round((320 * H) / W)} className="exp-preview" />}
          <div className="progress"><i style={{ width: `${(state.progress || 0) * 100}%` }} /></div>
          <p>{state.label ? `${state.label} · ` : ''}{state.phase === 'mux' ? 'Uniendo audio y video… ' : ''}{Math.round((state.progress || 0) * 100)}% {state.phase === 'running' && state.eta != null && `· quedan ~${fmtTime(state.eta).slice(0, 5)}`}
            {state.retry ? ` · reintento ${state.retry}/${RETRIES}` : ''}</p>
          {state.phase === 'running' && <div className="modal-actions"><button className="btn danger" onClick={() => { cancelRef.current = true; if (audioOnly) window.api.exportCancel(state.out); }}>Cancelar</button></div>}
        </div>
      )}
      {state.phase === 'done' && (
        <div className="export done">
          <div className="ok-ico"><Icon name="check" size={34} /></div>
          <h4>¡Exportación completa!</h4>
          <p className="hint">{(state.outs || [state.out]).map((o) => <React.Fragment key={o}>{o}<br /></React.Fragment>)}Tiempo: {fmtTime(state.secs)}</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => window.api.showItem(state.out)}><Icon name="folder" size={15} /> Abrir carpeta</button>
            <button className="btn" onClick={() => window.api.openPath(state.out)}><Icon name="play" size={15} /> Reproducir</button>
            <button className="btn primary" onClick={onClose}>Listo</button>
          </div>
        </div>
      )}
      {state.phase === 'error' && (
        <div className="export">
          <p className="error-text">La exportación falló.</p>
          <pre className="log">{state.error}</pre>
          <div className="modal-actions">
            <button className="btn" onClick={() => setStateL({ phase: 'setup' })}>Volver</button>
            {resume && <button className="btn primary resume" onClick={() => start(resume)}>Reanudar ({resumePct}%)</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
