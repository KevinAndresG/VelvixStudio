import React, { useEffect, useState } from 'react';
import { useStore, getState, setState, undo, redo, update, flushSave, toast } from '../store.js';
import { projectDuration, ASPECTS, uid, clipEnd } from '../engine/model.js';
import { Icon, IconBtn, Select } from '../ui.jsx';
import MediaPanel from './MediaPanel.jsx';
import Preview, { snapshotCanvas } from './Preview.jsx';
import Timeline from './Timeline.jsx';
import Inspector from './Inspector.jsx';
import ExportDialog from './ExportDialog.jsx';
import { splitAtPlayhead, deleteSelected, duplicateSelected, addMarker, packMain, ensureTrack } from './actions.js';

let clipboard = [];

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  const s = getState(), ctrl = e.ctrlKey || e.metaKey, fps = s.project.fps;
  const seek = (t) => setState({ time: Math.max(0, Math.min(projectDuration(s.project), t)), playing: false });
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); setState({ playing: !s.playing }); }
  else if (ctrl && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if ((k === 's' && !ctrl) || (ctrl && k === 'b')) { e.preventDefault(); splitAtPlayhead(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
  else if (ctrl && k === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (ctrl && k === 'c') { clipboard = s.project.clips.filter((c) => s.selection.includes(c.id)).map((c) => structuredClone(c)); }
  else if (ctrl && k === 'x') { clipboard = s.project.clips.filter((c) => s.selection.includes(c.id)).map((c) => structuredClone(c)); deleteSelected(); }
  else if (ctrl && k === 'v' && clipboard.length) {
    e.preventDefault();
    const base = Math.min(...clipboard.map((c) => c.start)), ids = [];
    update((p) => {
      for (const src of clipboard) {
        const c = structuredClone(src); c.id = uid(); c.start = s.time + (src.start - base);
        const tk = p.tracks.find((t) => t.id === c.trackId);
        const kind = c.type === 'image' ? 'video' : c.type;
        if (!tk || tk.main) {
          if (tk && tk.main) p.clips.filter((x) => x.trackId === tk.id && x.start >= c.start - 1e-4).forEach((x) => { x.start += c.duration; });
          else c.trackId = ensureTrack(p, kind, c.start, c.start + c.duration);
        } else c.trackId = ensureTrack(p, tk.kind, c.start, clipEnd(c));
        p.clips.push(c); ids.push(c.id);
      }
      packMain(p);
    });
    setState({ selection: ids });
  }
  else if (ctrl && k === 'a') { e.preventDefault(); setState({ selection: s.project.clips.map((c) => c.id) }); }
  else if (k === 'escape') setState({ selection: [] });
  else if (k === 'arrowleft') { e.preventDefault(); seek(s.time - (e.shiftKey ? 1 : 1 / fps)); }
  else if (k === 'arrowright') { e.preventDefault(); seek(s.time + (e.shiftKey ? 1 : 1 / fps)); }
  else if (k === 'home') seek(0);
  else if (k === 'end') seek(projectDuration(s.project));
  else if (k === 'm') addMarker();
  else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); setState({ zoom: Math.min(800, s.zoom * 1.25) }); }
  else if (ctrl && k === '-') { e.preventDefault(); setState({ zoom: Math.max(4, s.zoom / 1.25) }); }
  else if (ctrl && k === 'e') { e.preventDefault(); window.dispatchEvent(new Event('velvix:export')); }
  else if (k === 'j') seek(s.time - 5);
  else if (k === 'l') seek(s.time + 5);
}

export default function Editor() {
  const project = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const jobs = useStore((s) => s.jobs);
  const [exporting, setExporting] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    const ex = () => setExporting(true);
    window.addEventListener('velvix:export', ex);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('velvix:export', ex); };
  }, []);

  const goHome = async () => {
    setState({ playing: false });
    try {
      const blob = await snapshotCanvas(360);
      if (blob) {
        const thumb = await window.api.saveProjectThumb(project.id, await blob.arrayBuffer());
        setState({ project: { ...getState().project, thumb } });
      }
    } catch { /* thumbnail is optional */ }
    await flushSave();
    setState({ view: 'home', project: null, past: [], future: [], selection: [] });
  };

  const setAspect = (a) => update((p) => { const [w, h] = ASPECTS[a]; p.aspect = a; p.width = w; p.height = h; });
  const jobList = Object.entries(jobs);

  return (
    <div className="editor">
      <header className="topbar">
        <div className="tb-left">
          <IconBtn icon="back" title="Volver a proyectos" onClick={goHome} />
          <span className="logo sm">V</span>
          <input className="proj-name" value={project.name} onChange={(e) => update((p) => { p.name = e.target.value; }, 'name')} aria-label="Nombre del proyecto" />
          <span className="saved" title="Guardado automático"><Icon name="check" size={13} /> Guardado</span>
        </div>
        <div className="tb-center">
          <IconBtn icon="undo" title="Deshacer (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
          <IconBtn icon="redo" title="Rehacer (Ctrl+Y)" onClick={redo} disabled={!canRedo} />
          <Select value={project.aspect} options={Object.fromEntries(Object.keys(ASPECTS).map((a) => [a, `Formato ${a}`]))} onChange={setAspect} />
          <Select value={String(project.fps)} options={{ 24: '24 fps', 25: '25 fps', 30: '30 fps', 50: '50 fps', 60: '60 fps' }} onChange={(v) => update((p) => { p.fps = +v; })} />
        </div>
        <div className="tb-right">
          {jobList.length > 0 && (
            <div className="jobs" title={jobList.map(([, j]) => j.label).join('\n')}>
              <span className="spinner" />
              <span>{jobList[0][1].label}{jobList[0][1].progress != null ? ` ${Math.round(jobList[0][1].progress * 100)}%` : ''}</span>
            </div>
          )}
          <IconBtn icon="keyboard" title="Atajos de teclado" onClick={() => setHelp(true)} />
          <button className="btn primary" onClick={() => setExporting(true)}><Icon name="download" size={16} /> Exportar</button>
        </div>
      </header>
      <div className="workspace">
        <MediaPanel />
        <Preview />
        <Inspector />
      </div>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}

function ShortcutHelp({ onClose }) {
  const rows = [
    ['Espacio', 'Reproducir / pausar'], ['S  o  Ctrl+B', 'Dividir en el cursor'], ['Supr', 'Eliminar selección'],
    ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'], ['Ctrl+C / X / V', 'Copiar / cortar / pegar'], ['Ctrl+D', 'Duplicar'],
    ['← / →', 'Fotograma anterior / siguiente'], ['Shift+← / →', '±1 segundo'], ['J / L', '±5 segundos'], ['Inicio / Fin', 'Ir al inicio / final'],
    ['Ctrl + / Ctrl −', 'Zoom de la línea de tiempo'], ['M', 'Agregar marcador'], ['Ctrl+A', 'Seleccionar todo'], ['Ctrl+E', 'Exportar'],
    ['Alt + arrastrar', 'Mover sin ajuste magnético'], ['Rueda + Ctrl', 'Zoom en la línea de tiempo'],
  ];
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 480 }}>
        <header><h3>Atajos de teclado</h3><IconBtn icon="x" title="Cerrar" onClick={onClose} /></header>
        <table className="keys"><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
