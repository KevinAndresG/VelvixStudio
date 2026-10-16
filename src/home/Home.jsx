import React, { useEffect, useMemo, useState } from 'react';
import { setState, toast } from '../store.js';
import { newProject, ASPECTS, mediaUrl, uid, fmtTime } from '../engine/model.js';
import { Icon, IconBtn, Modal } from '../ui.jsx';
import { importPaths, addToTimeline, reprobeMedia } from '../editor/actions.js';

const api = window.api;

export async function openProject(project) {
  // Flag media whose file moved or was deleted so the editor can offer relinking.
  for (const m of project.media) m.missing = !(await api.fileExists(m.path));
  setState({ project, view: 'editor', past: [], future: [], selection: [], time: 0, playing: false });
  api.sessionSet(project.id); // still set on next start = unexpected close → offer recovery
  api.snapshotProject(project.id); // version as it was when opened
  reprobeMedia();
}

const ago = (ts) => {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'hace un momento';
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`;
  return new Date(ts).toLocaleDateString();
};

export default function Home() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [aspect, setAspect] = useState('16:9');
  const [drag, setDrag] = useState(false);
  const [crashed, setCrashed] = useState(null);
  const [versions, setVersions] = useState(null); // { p, list }

  const refresh = () => api.listProjects().then(setList);
  useEffect(() => { refresh(); api.sessionCrashed().then((c) => c && setCrashed(c.projectId)); }, []);
  const crashedProj = crashed && list && list.find((p) => p.id === crashed);

  const showVersions = async (p) => setVersions({ p, list: await api.projectVersions(p.id) });
  const restore = async (v) => {
    await api.restoreVersion(versions.p.id, v.at);
    setVersions(null); refresh();
    toast(`Versión del ${new Date(v.at).toLocaleString()} restaurada`);
  };
  const exportPackage = async (p) => {
    const { videos } = await api.paths();
    const out = await api.saveDialog({ defaultPath: `${videos}\\${p.name.replace(/[<>:"/\\|?*]+/g, '_')}.velvix`, filters: [{ name: 'Paquete de Velvix Studio', extensions: ['velvix'] }] });
    if (!out) return;
    toast('Creando paquete…');
    try { const r = await api.exportPackage(p.id, out); toast(`Paquete creado: ${r.files} archivos, ${Math.round(r.bytes / 1048576)} MB`); } catch (e) { toast(`No se pudo crear el paquete: ${e.message}`, 'error'); }
  };
  const importPackage = async (file) => {
    file = file || await api.openFile([{ name: 'Paquete de Velvix Studio', extensions: ['velvix'] }]);
    if (!file) return;
    toast('Importando paquete…');
    try { await api.importPackage(file); await refresh(); toast('Proyecto importado'); } catch (e) { toast(`No se pudo importar: ${e.message}`, 'error'); }
  };

  const create = async (files = []) => {
    const p = newProject(`Proyecto ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, aspect);
    await api.saveProject(p);
    await openProject(p);
    if (files.length) {
      const media = await importPaths(files);
      for (const m of media) addToTimeline(m);
    }
  };
  const open = async (id) => {
    try { await openProject(await api.loadProject(id)); } catch { toast('No se pudo abrir el proyecto', 'error'); }
  };
  const duplicate = async (id) => {
    const p = await api.loadProject(id);
    await api.saveProject({ ...p, id: uid(), name: p.name + ' (copia)', createdAt: Date.now(), updatedAt: Date.now() });
    refresh();
  };
  const rename = async (id, name) => {
    const p = await api.loadProject(id);
    await api.saveProject({ ...p, name: name.trim() || p.name, updatedAt: Date.now() });
    setRenaming(null); refresh();
  };
  const del = async (id) => { await api.deleteProject(id); setConfirm(null); refresh(); };

  const filtered = useMemo(() => (list || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase())), [list, q]);

  return (
    <div className={`home ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const files = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
        const pkgs = files.filter((f) => /\.velvix$/i.test(f)), media = files.filter((f) => !/\.velvix$/i.test(f));
        (async () => { for (const f of pkgs) await importPackage(f); if (media.length) create(media); })();
      }}>
      <header className="home-top">
        <div className="brand"><span className="logo">V</span><b>Velvix</b> Studio</div>
        <div className="home-actions">
          <button className="btn import-pkg" onClick={() => importPackage()} title="Abrir un proyecto .velvix con sus medios"><Icon name="upload" size={15} /> Importar paquete</button>
          <div className="search"><Icon name="search" size={16} /><input placeholder="Buscar proyectos" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
      </header>
      {crashedProj && (
        <div className="banner crash">
          <Icon name="reverse" size={18} />
          <p>Velvix Studio se cerró de forma inesperada. <b>{crashedProj.name}</b> se guardó automáticamente.</p>
          <button className="btn primary" onClick={() => { setCrashed(null); open(crashedProj.id); }}>Recuperar</button>
          <button className="btn" onClick={() => { setCrashed(null); showVersions(crashedProj); }}>Versiones</button>
          <IconBtn icon="x" title="Descartar" onClick={() => setCrashed(null)} />
        </div>
      )}
      <section className="hero">
        <div className="new-card" onClick={() => create()}>
          <div className="plus"><Icon name="plus" size={30} /></div>
          <div><h2>Nuevo proyecto</h2><p>Arrastra videos, fotos o música aquí para empezar al instante</p></div>
        </div>
        <div className="aspects">
          <span>Formato</span>
          {Object.keys(ASPECTS).slice(0, 6).map((a) => {
            const [w, h] = ASPECTS[a], k = 26 / Math.max(w, h);
            return (
              <button key={a} className={aspect === a ? 'active' : ''} onClick={() => setAspect(a)} title={a}>
                <i style={{ width: w * k, height: h * k }} />{a}
              </button>
            );
          })}
        </div>
      </section>
      <section className="projects">
        <h3>Proyectos <em>{list ? list.length : ''}</em></h3>
        {list && !list.length && <p className="empty">Aún no tienes proyectos. Crea uno para empezar.</p>}
        <div className="grid">
          {filtered.map((p) => (
            <div key={p.id} className="proj" onDoubleClick={() => open(p.id)}>
              <div className="thumb" onClick={() => open(p.id)} style={{ aspectRatio: '16/10' }}>
                {p.thumb ? <img src={mediaUrl(p.thumb)} alt="" /> : <Icon name="film" size={34} />}
                <span className="dur">{fmtTime(p.duration)}</span>
              </div>
              <div className="meta">
                {renaming === p.id
                  ? <input autoFocus defaultValue={p.name} onBlur={(e) => rename(p.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                  : <b title={p.name} onClick={() => open(p.id)}>{p.name}</b>}
                <small>{ago(p.updatedAt)} · {p.width}×{p.height}</small>
              </div>
              <div className="proj-actions">
                <IconBtn icon="edit" title="Renombrar" size={15} onClick={() => setRenaming(p.id)} />
                <IconBtn icon="copy" title="Duplicar" size={15} onClick={() => duplicate(p.id)} />
                <IconBtn icon="reverse" title="Versiones anteriores" size={15} onClick={() => showVersions(p)} />
                <IconBtn icon="download" title="Exportar paquete (.velvix con medios)" size={15} onClick={() => exportPackage(p)} />
                <IconBtn icon="trash" title="Eliminar" size={15} onClick={() => setConfirm(p)} />
              </div>
            </div>
          ))}
        </div>
      </section>
      {confirm && (
        <Modal title="Eliminar proyecto" onClose={() => setConfirm(null)} width={420}>
          <p className="modal-text">¿Eliminar <b>{confirm.name}</b>? Esta acción no se puede deshacer. Tus archivos originales no se borran.</p>
          <div className="modal-actions"><button className="btn" onClick={() => setConfirm(null)}>Cancelar</button><button className="btn danger" onClick={() => del(confirm.id)}>Eliminar</button></div>
        </Modal>
      )}
      {versions && (
        <Modal title={`Versiones de ${versions.p.name}`} onClose={() => setVersions(null)} width={480}>
          <p className="modal-text">Se guarda una copia al abrir el proyecto y cada 5 minutos de edición (las 30 más recientes). Al restaurar, la versión actual también se guarda como copia.</p>
          <div className="versions">
            {!versions.list.length && <p className="empty">Aún no hay versiones guardadas.</p>}
            {versions.list.map((v) => (
              <div key={v.at}>
                <span>{new Date(v.at).toLocaleString()}</span>
                <small>{v.clips} clips · {fmtTime(v.duration)}</small>
                {versions.ask === v.at
                  ? <button className="btn sm danger confirm-restore" onClick={() => restore(v)}>¿Reemplazar la actual?</button>
                  : <button className="btn sm" onClick={() => setVersions({ ...versions, ask: v.at })}>Restaurar</button>}
              </div>
            ))}
          </div>
        </Modal>
      )}
      {drag && <div className="drop-hint"><Icon name="upload" size={40} /><p>Suelta para crear un proyecto</p></div>}
    </div>
  );
}
