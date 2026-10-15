import React, { useEffect, useRef, useState } from 'react';
import { getState, setState, toast } from '../store.js';
import { projectDuration, fmtTime } from '../engine/model.js';
import { renderFrame } from '../engine/render.js';
import { ExportPool, audioSegments } from '../engine/sources.js';
import { Icon, Select, Toggle, Modal } from '../ui.jsx';

const RES = { 480: '480p', 720: '720p', 1080: '1080p (Full HD)', 1440: '2K', 2160: '4K' };
const FORMATS = { mp4: 'MP4 (H.264)', webm: 'WebM (VP9)', gif: 'GIF animado', mp3: 'Solo audio MP3', wav: 'Solo audio WAV' };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
// Hardware H.264 encoder in the renderer; only small encoded chunks cross IPC.
async function makeEncoder(W, H, fps, quality, onChunk, onError) {
  if (!window.VideoEncoder) return null;
  const bpp = { low: 0.05, med: 0.09, high: 0.15 }[quality];
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
    const cfg = { codec: 'avc1.640033', width: W, height: H, bitrate: Math.round(W * H * fps * bpp), framerate: fps, hardwareAcceleration, bitrateMode: 'variable', latencyMode: 'quality', avc: { format: 'annexb' } };
    const sup = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported) continue;
    const enc = new VideoEncoder({ output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); onChunk(b); }, error: onError });
    enc.configure(cfg);
    return enc;
  }
  return null;
}
const concat = (parts) => { const n = parts.reduce((a, p) => a + p.byteLength, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.byteLength; } return out.buffer; };

const safeName = (s) => s.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'video';

export default function ExportDialog({ onClose }) {
  const project = getState().project;
  const duration = projectDuration(project);
  const short = Math.min(project.width, project.height);
  const [name, setName] = useState(safeName(project.name));
  const [res, setRes] = useState(String(Math.min(1080, short >= 1080 ? 1080 : 720)));
  const [fps, setFps] = useState(String(project.fps));
  const [quality, setQuality] = useState('high');
  const [format, setFormat] = useState('mp4');
  const [hw, setHw] = useState(true);
  const [hwName, setHwName] = useState(null);
  const [state, setStateL] = useState({ phase: 'setup' }); // setup | running | done | error
  const cancelRef = useRef(false);
  const previewRef = useRef(null);

  useEffect(() => { window.api.exportHw().then(setHwName); }, []);

  const audioOnly = format === 'mp3' || format === 'wav';
  const k = +res / short;
  const W = even(project.width * k), H = even(project.height * k);
  const outFps = format === 'gif' ? Math.min(15, +fps) : +fps;
  const sizeMB = audioOnly ? (duration * (format === 'mp3' ? 320 : 1411)) / 8 / 1024 : (duration * (W * H * outFps * { low: 0.04, med: 0.08, high: 0.14 }[quality] + 192000)) / 8 / 1048576;

  const start = async () => {
    if (!duration) return toast('La línea de tiempo está vacía', 'error');
    const { videos } = await window.api.paths();
    const ext = format;
    const out = await window.api.saveDialog({ defaultPath: `${videos}\\${name}.${ext}`, filters: [{ name: FORMATS[format], extensions: [ext] }] });
    if (!out) return;
    setState({ playing: false });
    cancelRef.current = false;
    const t0 = performance.now();
    setStateL({ phase: 'running', progress: 0, out, eta: null });
    const segs = audioSegments(project);
    let chunks = [], encError = null;
    const encoder = format === 'mp4' && !audioOnly ? await makeEncoder(W, H, outFps, quality, (b) => chunks.push(b), (e) => { encError = e; }) : null;
    const res0 = await window.api.exportStart({ out, format, width: W, height: H, fps: outFps, quality, hw, segs, total: duration, audioOnly, videoInput: encoder ? 'h264' : 'raw' });
    if (audioOnly) {
      setStateL(res0.ok ? { phase: 'done', out, secs: (performance.now() - t0) / 1000 } : { phase: 'error', error: res0.error });
      return;
    }
    const pool = new ExportPool();
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    setState({ exporting: true }); // pauses the preview loop so export gets the GPU/main thread
    const frames = Math.max(1, Math.ceil(duration * outFps));
    const pctx = previewRef.current && previewRef.current.getContext('2d');
    let pending = null; // overlap JPEG encode + IPC of frame N with seeking frame N+1
    try {
      for (let f = 0; f < frames; f++) {
        if (cancelRef.current) throw new Error('cancel');
        const t = Math.min(duration - 0.0001, f / outFps);
        await pool.prepare(project, t);
        renderFrame(ctx, project, t, pool.getDrawable, W, H);
        if (encoder) {
          if (encError) throw encError;
          const vf = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / outFps), duration: Math.round(1e6 / outFps) });
          encoder.encode(vf, { keyFrame: f % (outFps * 2) === 0 });
          vf.close();
          while (encoder.encodeQueueSize > 6) await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
          if (chunks.length >= 8) {
            const data = concat(chunks); chunks = [];
            if (pending && !(await pending)) throw new Error('ffmpeg');
            pending = window.api.exportFrame(data);
          }
        } else {
          // Raw RGBA readback: canvas.toBlob runs as an idle task and stalls ~1 s/frame under load.
          const px = ctx.getImageData(0, 0, W, H).data.buffer;
          if (pending && !(await pending)) throw new Error('ffmpeg');
          pending = window.api.exportFrame(px);
        }
        if (f % 8 === 0) {
          if (pctx) pctx.drawImage(canvas, 0, 0, pctx.canvas.width, pctx.canvas.height);
          const el = (performance.now() - t0) / 1000, p = (f + 1) / frames;
          setStateL((s) => ({ ...s, progress: p, eta: el / p - el }));
        }
      }
      if (encoder) {
        await encoder.flush(); encoder.close();
        if (pending && !(await pending)) throw new Error('ffmpeg');
        pending = chunks.length ? window.api.exportFrame(concat(chunks)) : null;
        chunks = [];
      }
      if (pending && !(await pending)) throw new Error('ffmpeg');
      const r = await window.api.exportFinish();
      setStateL(r.ok ? { phase: 'done', out, secs: (performance.now() - t0) / 1000 } : { phase: 'error', error: r.error });
    } catch (e) {
      if (e.message === 'ffmpeg') { const r = await window.api.exportFinish(); setStateL({ phase: 'error', error: r.error }); return; }
      await window.api.exportCancel(out);
      setStateL(e.message === 'cancel' ? { phase: 'setup' } : { phase: 'error', error: e.message });
    } finally {
      pool.destroy(); setState({ exporting: false });
      if (encoder && encoder.state !== 'closed') encoder.close();
    }
  };

  const busy = state.phase === 'running';
  return (
    <Modal title="Exportar" onClose={() => !busy && onClose()} width={560}>
      {state.phase === 'setup' && (
        <div className="export">
          <label className="field"><span>Nombre</span><input value={name} onChange={(e) => setName(safeName(e.target.value))} /></label>
          <Select label="Formato" value={format} options={FORMATS} onChange={setFormat} />
          {!audioOnly && <>
            <Select label="Resolución" value={res} options={RES} onChange={setRes} />
            {format !== 'gif' && <Select label="Cuadros por segundo" value={fps} options={{ 24: '24', 25: '25', 30: '30', 50: '50', 60: '60' }} onChange={setFps} />}
            <Select label="Calidad" value={quality} options={{ low: 'Baja (archivo pequeño)', med: 'Recomendada', high: 'Alta' }} onChange={setQuality} />
            {format === 'mp4' && <Toggle label={`Aceleración por GPU ${hwName ? `(${hwName.replace('h264_', '').toUpperCase()})` : hwName === '' ? '(no disponible)' : ''}`} value={hw && !!hwName} onChange={setHw} />}
          </>}
          <dl className="info">
            {!audioOnly && <><dt>Tamaño de salida</dt><dd>{W}×{H}</dd></>}
            <dt>Duración</dt><dd>{fmtTime(duration)}</dd>
            <dt>Tamaño estimado</dt><dd>~{sizeMB < 1 ? sizeMB.toFixed(1) : Math.round(sizeMB)} MB</dd>
          </dl>
          <div className="modal-actions"><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={start}><Icon name="download" size={16} /> Exportar</button></div>
        </div>
      )}
      {busy && (
        <div className="export running">
          {!audioOnly && <canvas ref={previewRef} width={320} height={Math.round((320 * H) / W)} className="exp-preview" />}
          <div className="progress"><i style={{ width: `${(state.progress || 0) * 100}%` }} /></div>
          <p>{Math.round((state.progress || 0) * 100)}% {state.eta != null && `· quedan ~${fmtTime(state.eta).slice(0, 5)}`}</p>
          <div className="modal-actions"><button className="btn danger" onClick={() => { cancelRef.current = true; if (audioOnly) window.api.exportCancel(state.out).then(() => setStateL({ phase: 'setup' })); }}>Cancelar</button></div>
        </div>
      )}
      {state.phase === 'done' && (
        <div className="export done">
          <div className="ok-ico"><Icon name="check" size={34} /></div>
          <h4>¡Exportación completa!</h4>
          <p className="hint">{state.out}<br />Tiempo: {fmtTime(state.secs)}</p>
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
          <div className="modal-actions"><button className="btn" onClick={() => setStateL({ phase: 'setup' })}>Volver</button></div>
        </div>
      )}
    </Modal>
  );
}
