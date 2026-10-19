import React, { useEffect, useState } from 'react';
import { useStore, getState, setState, undo, redo, update, flushSave, toast } from '../store.js';
import { projectDuration, ASPECTS, uid, clipEnd } from '../engine/model.js';
import { Icon, IconBtn, Select, Modal } from '../ui.jsx';
import MediaPanel, { askRemove } from './MediaPanel.jsx';
import Preview, { snapshotCanvas } from './Preview.jsx';
import Timeline from './Timeline.jsx';
import Inspector from './Inspector.jsx';
import ExportDialog from './ExportDialog.jsx';
import { splitAtPlayhead, trimAtPlayhead, deleteSelected, duplicateSelected, addMarker, packMain, ensureTrack } from './actions.js';

let clipboard = [];

// Supr on a selected keyframe diamond removes the keyframes (every property) at that time.
function deleteKeyframe() {
  const k = getState().selKf; if (!k) return false;
  update((p) => {
    const c = p.clips.find((x) => x.id === k.clipId); if (!c) return;
    for (const key of Object.keys(c.kf || {})) { c.kf[key] = c.kf[key].filter((f) => Math.abs(f.t - k.t) >= 1e-4); if (!c.kf[key].length) delete c.kf[key]; }
  });
  setState({ selKf: null });
  return true;
}

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
  else if (k === 'q' && !ctrl && !e.altKey) { e.preventDefault(); trimAtPlayhead('left'); }
  else if (k === 'w' && !ctrl && !e.altKey) { e.preventDefault(); trimAtPlayhead('right'); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (s.mediaSel.length) askRemove(s.mediaSel); else if (!deleteKeyframe()) deleteSelected(); }
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
  else if (k === 'escape') setState({ selection: [], mediaSel: [] });
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
  const [tpl, setTpl] = useState(null); // name being typed for "save as template"
  const [widths, setWidths] = useState(() => ({ left: +localStorage.getItem('leftWidth') || 0, right: +localStorage.getItem('rightWidth') || 0 }));
  // The project (media, tracks, clips, look) as a reusable template, with the current frame as its picture.
  const saveTemplate = async () => {
    const p = getState().project, blob = await snapshotCanvas(160).catch(() => null);
    const { id, name, createdAt, updatedAt, thumb, transcript, ...rest } = structuredClone(p);
    await window.api.templateSave({ id: uid(), name: tpl.trim() || p.name, createdAt: Date.now(), project: rest }, blob ? await blob.arrayBuffer() : null);
    setTpl(null);
    toast('Plantilla guardada: aparece en el inicio');
  };

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
    window.api.sessionSet(null);
    setState({ view: 'home', project: null, past: [], future: [], selection: [], mediaSel: [] });
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
          <AspectPicker value={project.aspect} onChange={setAspect} />
          <Select value={String(project.fps)} options={{ 24: '24 fps', 25: '25 fps', 30: '30 fps', 50: '50 fps', 60: '60 fps' }} onChange={(v) => update((p) => { p.fps = +v; })} />
        </div>
        <div className="tb-right">
          {jobList.length > 0 && (
            <div className="jobs" title={jobList.map(([, j]) => j.label).join('\n')}>
              <span className="spinner" />
              <span>{jobList[0][1].label}{jobList[0][1].progress != null ? ` ${Math.round(jobList[0][1].progress * 100)}%` : ''}</span>
              {jobList[0][1].cancel && <button className="job-cancel" title="Cancelar" onClick={jobList[0][1].cancel}>✕</button>}
            </div>
          )}
          <IconBtn icon="layers" title="Guardar como plantilla" className="save-tpl" onClick={() => setTpl(project.name)} />
          <IconBtn icon="keyboard" title="Atajos de teclado" onClick={() => setHelp(true)} />
          <button className="btn primary" onClick={() => setExporting(true)}><Icon name="download" size={16} /> Exportar</button>
        </div>
      </header>
      <div className="workspace" style={{ ...(widths.left && { '--left-w': `${widths.left}px` }), ...(widths.right && { '--right-w': `${widths.right}px` }) }}>
        <MediaPanel />
        <Splitter side="left" widths={widths} setWidths={setWidths} />
        <Preview />
        <Splitter side="right" widths={widths} setWidths={setWidths} />
        <Inspector />
      </div>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {tpl != null && (
        <Modal title="Guardar como plantilla" onClose={() => setTpl(null)} width={420}>
          <p className="modal-text">Guarda el formato, las pistas, los textos, stickers, efectos y medios de este proyecto para empezar otros iguales desde el inicio.</p>
          <input className="input tpl-name" autoFocus value={tpl} onChange={(e) => setTpl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveTemplate()} />
          <div className="modal-actions"><button className="btn" onClick={() => setTpl(null)}>Cancelar</button><button className="btn primary" onClick={saveTemplate}>Guardar</button></div>
        </Modal>
      )}
    </div>
  );
}

// Drag handle between a side panel and the preview. Widths persist; double-click restores the default.
const SIDE = { left: ['.left', 'leftWidth', 250, 760], right: ['.right', 'rightWidth', 260, 720] };
function Splitter({ side, widths, setWidths }) {
  const [sel, key, min, max] = SIDE[side];
  const start = (e) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = document.querySelector(sel).offsetWidth;
    // Keep at least ~320px for the preview between both panels.
    const other = document.querySelector(SIDE[side === 'left' ? 'right' : 'left'][0]).offsetWidth;
    const top = Math.max(min, Math.min(max, window.innerWidth - other - 320));
    let w = w0;
    const move = (ev) => { w = Math.round(Math.max(min, Math.min(top, w0 + (side === 'left' ? 1 : -1) * (ev.clientX - x0)))); setWidths((s) => ({ ...s, [side]: w })); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('col-resizing'); localStorage.setItem(key, String(w)); };
    document.body.classList.add('col-resizing');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const reset = () => { localStorage.removeItem(key); setWidths((s) => ({ ...s, [side]: 0 })); };
  return <div className={`side-resize sr-${side}`} onPointerDown={start} onDoubleClick={reset} title="Arrastra para cambiar el ancho (doble clic: restablecer)" />;
}

const ASPECT_USES = {
  '16:9': 'YouTube, pantallas', '9:16': 'TikTok, Reels, Shorts', '1:1': 'Publicación cuadrada', '4:5': 'Feed de Instagram',
  '4:3': 'Clásico', '3:4': 'Vertical clásico', '21:9': 'Cine panorámico', '2:1': 'Panorámico',
};
// Shape of `a` fitted inside a w×h box (CSS px).
const shape = (a, w, h) => { const [x, y] = ASPECTS[a], k = Math.min(w / x, h / y); return { width: Math.round(x * k), height: Math.round(y * k) }; };

// Project format picker: each option is drawn as the frame it gives, with its ratio inside.
function AspectPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!e.target.closest('.aspect-pick')) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div className="aspect-pick">
      <button className={`btn ap-trigger ${open ? 'open' : ''}`} title={`Formato del proyecto: ${value}`} onClick={() => setOpen(!open)}>
        <span className="ap-icon"><i style={shape(value, 22, 16)} /></span>{value}<Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="ap-menu" role="listbox">
          {Object.keys(ASPECTS).map((a) => (
            <button key={a} role="option" aria-selected={a === value} className={a === value ? 'active' : ''} data-aspect={a}
              title={`${ASPECTS[a].join(' × ')} · ${ASPECT_USES[a]}`} onClick={() => { onChange(a); setOpen(false); }}>
              <span className="ap-frame"><i style={shape(a, 50, 42)}>{a}</i></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShortcutHelp({ onClose }) {
  const rows = [
    ['Espacio', 'Reproducir / pausar'], ['S  o  Ctrl+B', 'Dividir en el cursor'], ['Q / W', 'Borrar a la izquierda / derecha del cursor'], ['Supr', 'Eliminar selección (clips o medios)'],
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
