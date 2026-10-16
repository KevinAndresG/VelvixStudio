import React, { useState } from 'react';
import { useStore, setState } from '../store.js';
import { fmtTime } from '../engine/model.js';
import { Icon, IconBtn, Select, Slider, Toggle } from '../ui.jsx';
import { autoReframe, findShorts, createShorts, splitScenes } from './vision.js';

// Left panel "IA": whole-project tools (reframe to another format, long video → shorts, split by scenes).
export default function VisionTab() {
  const aspect = useStore((s) => s.project.aspect);
  const [to, setTo] = useState(aspect === '9:16' ? '1:1' : '9:16');
  const [count, setCount] = useState(3);
  const [min, setMin] = useState(15);
  const [max, setMax] = useState(60);
  const [vertical, setVertical] = useState(true);
  const [found, setFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [thr, setThr] = useState(10);
  const find = async () => { setBusy(true); setFound(null); setFound(await findShorts({ count, min, max: Math.max(min + 1, max) })); setBusy(false); };
  return (
    <div className="panel vision">
      <h5>Reencuadre automático</h5>
      <p className="hint">Cambia el formato del proyecto y mueve cada clip de la pista principal para que la cara quede siempre en el centro.</p>
      <Select value={to} options={{ '9:16': '9:16 (TikTok, Reels, Shorts)', '1:1': '1:1 (cuadrado)', '4:5': '4:5 (Instagram)', '16:9': '16:9 (YouTube)' }} onChange={setTo} />
      <button className="btn primary wide ai-reframe" onClick={() => autoReframe(to)}><Icon name="wand" size={16} /> Reencuadrar siguiendo la cara</button>

      <h5>Video largo → clips cortos</h5>
      <p className="hint">Busca los mejores momentos por lo que se dice (transcripción), la energía del audio y los cambios de escena. Cada clip se crea como un proyecto nuevo.</p>
      <Slider label="Cantidad" value={count} min={1} max={10} onChange={setCount} />
      <Slider label="Duración mínima" value={min} min={5} max={90} unit="s" onChange={setMin} />
      <Slider label="Duración máxima" value={max} min={10} max={180} unit="s" onChange={setMax} />
      <Toggle label="Vertical 9:16 siguiendo la cara" value={vertical} onChange={setVertical} />
      <button className="btn wide ai-shorts" disabled={busy} onClick={find}><Icon name="search" size={15} /> {busy ? 'Buscando…' : 'Buscar los mejores momentos'}</button>
      {found && !found.length && <p className="hint">No se encontraron momentos con esa duración.</p>}
      {found && found.length > 0 && <>
        <div className="audio-list shorts-list">
          {found.map((s, i) => (
            <div key={i} className="audio-row short-row" onClick={() => setState({ time: s.a, playing: false })} title="Ir a este momento">
              <Icon name="film" size={15} /><span>{s.title}</span><em>{fmtTime(s.a)} · {Math.round(s.b - s.a)} s</em>
              <IconBtn icon="x" title="Descartar" size={13} onClick={(e) => { e.stopPropagation(); setFound(found.filter((_, j) => j !== i)); }} />
            </div>
          ))}
        </div>
        <button className="btn primary wide ai-create" onClick={() => createShorts(found, { vertical })}><Icon name="plus" size={15} /> Crear {found.length} {found.length === 1 ? 'proyecto' : 'proyectos'}</button>
      </>}

      <h5>Detectar escenas</h5>
      <p className="hint">Divide los videos de la pista principal en cada cambio de plano.</p>
      <Slider label="Umbral (menos = más sensible)" value={thr} min={3} max={40} onChange={setThr} reset={10} />
      <button className="btn wide ai-scenes" onClick={() => splitScenes(null, thr)}><Icon name="split" size={15} /> Dividir por escenas</button>
    </div>
  );
}
