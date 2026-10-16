// Brand kit: colors, fonts, logos and text styles saved once (brand.json in the app data) for every project.
import React, { useEffect, useState } from 'react';
import { useStore, getState, update, toast } from '../store.js';
import { mediaUrl, projectDuration } from '../engine/model.js';
import { Icon, IconBtn } from '../ui.jsx';
import { addText, importPaths, addToTimeline } from './actions.js';
import { presetStyle } from './MediaPanel.jsx';

const EMPTY = { colors: [], fonts: [], logos: [], styles: [] };
let cache = null;
const loadBrand = async () => (cache = cache || { ...EMPTY, ...(await window.api.brandGet()) });

export async function addLogo(file) {
  const media = await importPaths([file]);
  if (!media[0]) return null;
  const at = getState().time, end = projectDuration(getState().project);
  const id = addToTimeline(media[0], { at });
  // Watermark: small, top-right corner, until the end of the video.
  update((p) => { const c = p.clips.find((x) => x.id === id); Object.assign(c.transform, { scale: 0.18, x: 0.4, y: -0.38 }); c.duration = end - at > 0.5 ? end - at : 5; });
  return id;
}

export default function BrandTab() {
  const [brand, setBrand] = useState(cache);
  const [color, setColor] = useState('#7c5cff');
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  useEffect(() => { loadBrand().then(setBrand); }, []);
  if (!brand) return <div className="panel" />;
  const save = (b) => { cache = b; setBrand(b); window.api.brandSet(b); };
  const texts = project.clips.filter((c) => selection.includes(c.id) && c.type === 'text');
  const applyText = (fn) => {
    if (!texts.length) return toast('Selecciona un texto en la línea de tiempo', 'error');
    update((p) => { for (const c of p.clips) if (selection.includes(c.id) && c.type === 'text') fn(c.text); });
  };
  const remove = (key, i) => save({ ...brand, [key]: brand[key].filter((_, k) => k !== i) });
  const addLogoFile = async () => {
    const f = await window.api.openFile([{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'] }]);
    if (!f) return;
    const path = await window.api.brandLogo(f);
    save({ ...brand, logos: [...brand.logos, { path, name: f.split(/[\\/]/).pop() }] });
  };
  const saveStyle = () => {
    if (texts.length !== 1) return toast('Selecciona un texto para guardar su estilo', 'error');
    const { content, words, ...t } = structuredClone(texts[0].text);
    save({ ...brand, styles: [...brand.styles, { name: `Estilo ${brand.styles.length + 1}`, t }] });
    toast('Estilo guardado en tu kit de marca');
  };
  const saveFont = () => {
    const f = texts[0] && texts[0].text.font;
    if (!f) return toast('Selecciona un texto para guardar su fuente', 'error');
    if (!brand.fonts.includes(f)) save({ ...brand, fonts: [...brand.fonts, f] });
  };

  return (
    <div className="panel brand-kit">
      <h5>Kit de marca</h5>
      <p className="hint">Se guarda para todos tus proyectos. Selecciona un texto y toca un color, una fuente o un estilo para aplicarlo.</p>
      <h5>Colores</h5>
      <div className="brand-colors">
        {brand.colors.map((c, i) => (
          <button key={c + i} className="sw" style={{ background: c }} title={`${c} (clic derecho para quitar)`}
            onClick={() => applyText((t) => { t.color = c; })} onContextMenu={(e) => { e.preventDefault(); remove('colors', i); }} />
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color nuevo" />
        <button className="btn sm add-color" onClick={() => !brand.colors.includes(color) && save({ ...brand, colors: [...brand.colors, color] })}><Icon name="plus" size={13} /> Agregar</button>
      </div>
      <h5>Fuentes</h5>
      <div className="brand-list">
        {brand.fonts.map((f, i) => (
          <div key={f}>
            <button className="btn sm" style={{ fontFamily: f }} onClick={() => applyText((t) => { t.font = f; })}>{f}</button>
            <IconBtn icon="x" size={13} title="Quitar" onClick={() => remove('fonts', i)} />
          </div>
        ))}
        <button className="btn sm save-font" onClick={saveFont}><Icon name="plus" size={13} /> Guardar fuente del texto seleccionado</button>
      </div>
      <h5>Logos</h5>
      <div className="brand-logos">
        {brand.logos.map((l, i) => (
          <button key={l.path} title={`${l.name}: agregar como marca de agua (clic derecho para quitar)`} onClick={() => addLogo(l.path)} onContextMenu={(e) => { e.preventDefault(); remove('logos', i); }}>
            <img src={mediaUrl(l.path)} alt={l.name} />
          </button>
        ))}
        <button className="add-logo" onClick={addLogoFile} title="Agregar logo"><Icon name="plus" size={20} /></button>
      </div>
      <h5>Estilos de texto</h5>
      <div className="preset-grid">
        {brand.styles.map((s, i) => (
          <button key={i} className="preset brand-style" title={`${s.name} (clic derecho para quitar)`} onClick={() => addText(s.t, 'Escribe aquí')} onContextMenu={(e) => { e.preventDefault(); remove('styles', i); }}>
            <span style={{ ...presetStyle(s.t), fontFamily: s.t.font }}>Aa</span><small>{s.name}</small>
          </button>
        ))}
      </div>
      <button className="btn wide save-style" onClick={saveStyle}><Icon name="plus" size={15} /> Guardar estilo del texto seleccionado</button>
    </div>
  );
}
