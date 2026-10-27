import React, { useMemo, useState } from 'react';
import { useStore, useUiTime, setState, toast } from '../store.js';
import { fmtTime } from '../engine/model.js';
import { Icon, Select, Slider, Toggle } from '../ui.jsx';
import { transcribe, captionsFromTranscript, WHISPER_MODELS, LANGS } from './captions.js';
import { cutRanges, wordRanges, fillerIndices, silenceRanges, timelineAudio, mergeRanges, autoZoom } from './transcript.js';

// Transcript-based editing: delete words to cut the video; one click to drop fillers and pauses.
export default function TranscriptTab() {
  const words = useStore((s) => (s.project.transcript ? s.project.transcript.words : null));
  const time = useUiTime();
  const [model, setModel] = useState(() => localStorage.getItem('whisperModel') || 'onnx-community/whisper-base');
  const [lang, setLang] = useState('es');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState([]);
  const [anchor, setAnchor] = useState(null);
  const [db, setDb] = useState(-40);
  const [minPause, setMinPause] = useState(0.6);
  const [pad, setPad] = useState(0.12);
  const [cands, setCands] = useState(null); // [{ a, b, kind, on }]
  const [zoom, setZoom] = useState(15);
  const [zoomPhr, setZoomPhr] = useState(true);

  const run = async () => { localStorage.setItem('whisperModel', model); setBusy(true); await transcribe({ model, language: lang }); setBusy(false); setSel([]); setCands(null); };
  const del = () => {
    if (!sel.length) return;
    cutRanges(wordRanges(words, sel), 'Palabras borradas');
    setSel([]); setCands(null);
  };
  const click = (i, e) => {
    if (e.shiftKey && anchor != null) { const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)]; setSel(Array.from({ length: b - a + 1 }, (_, k) => a + k)); }
    else if (e.ctrlKey || e.metaKey) setSel(sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]);
    else { setSel([i]); setAnchor(i); }
    setState({ time: words[i].s, playing: false });
  };
  const detect = async () => {
    setBusy(true);
    try {
      const fill = wordRanges(words || [], fillerIndices(words || [])).map(([a, b]) => ({ a, b, kind: 'filler' }));
      const audio = await timelineAudio();
      const sil = audio ? silenceRanges(audio, { db, min: minPause, pad }).map(([a, b]) => ({ a, b, kind: 'pause' })) : [];
      const all = [...fill, ...sil].sort((x, y) => x.a - y.a).map((c) => ({ ...c, on: true }));
      setCands(all);
      if (!all.length) toast('No se encontraron muletillas ni pausas');
    } catch (e) { toast('Error al analizar: ' + e.message, 'error'); }
    setBusy(false);
  };
  const chosen = cands ? mergeRanges(cands.filter((c) => c.on).map((c) => [c.a, c.b])) : [];
  const saved = chosen.reduce((s, [a, b]) => s + b - a, 0);
  const apply = () => { cutRanges(chosen, 'Muletillas y pausas'); setCands(null); setSel([]); };
  const struck = useMemo(() => new Set((words || []).map((w, i) => (chosen.some(([a, b]) => (w.s + w.e) / 2 >= a && (w.s + w.e) / 2 < b) ? i : -1)).filter((i) => i >= 0)), [words, cands]);

  return (
    <div className="panel transcript"
      onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); del(); } }}>
      <h5>Edición por transcripción</h5>
      {!words && <p className="hint">Transcribe el audio y edita el video borrando texto: cada palabra borrada se corta de la línea de tiempo.</p>}
      <div className="row2">
        <Select value={lang} options={LANGS} onChange={setLang} />
        <Select value={model} options={WHISPER_MODELS} onChange={setModel} />
      </div>
      <button className={`btn ${words ? '' : 'primary'} wide`} disabled={busy} onClick={run}><Icon name="wand" size={16} /> {busy ? 'Procesando…' : words ? 'Volver a transcribir' : 'Transcribir'}</button>
      {words && (
        <>
          <div className="tr-words" tabIndex={0}>
            {words.map((w, i) => (
              <span key={i} data-i={i}
                className={`tr-w ${sel.includes(i) ? 'sel' : ''} ${struck.has(i) ? 'cut' : ''} ${time >= w.s && time < w.e ? 'now' : ''}`}
                onClick={(e) => click(i, e)} title={fmtTime(w.s)}>{w.text}</span>
            ))}
          </div>
          <div className="row2">
            <button className="btn danger" disabled={!sel.length} onClick={del}><Icon name="trash" size={15} /> Borrar ({sel.length})</button>
            <button className="btn" onClick={() => { const n = captionsFromTranscript(14); toast(`${n} subtítulos creados`); }}><Icon name="cc" size={15} /> Subtítulos</button>
          </div>
          <p className="hint">Clic para ir a la palabra, Mayús+clic para un tramo, Supr para cortarlo.</p>
        </>
      )}
      {words && (
        <>
          <h5>Zoom automático al hablar</h5>
          <Slider label="Acercamiento" value={zoom} min={5} max={40} unit="%" onChange={setZoom} reset={15} />
          <Toggle label="Alternar en cada frase" value={zoomPhr} onChange={setZoomPhr} />
          <button className="btn wide" onClick={() => autoZoom({ amount: zoom / 100, phrases: zoomPhr })}><Icon name="search" size={15} /> Aplicar zoom</button>
          <p className="hint">Acerca en palabras clave y cambios de frase (keyframes de escala en los clips de la pista principal).</p>
        </>
      )}
      <h5>Quitar muletillas y pausas</h5>
      <Slider label="Umbral de silencio" value={db} min={-60} max={-20} unit=" dB" onChange={setDb} reset={-40} />
      <Slider label="Pausa mínima" value={minPause} min={0.2} max={3} step={0.1} unit=" s" onChange={setMinPause} reset={0.6} />
      <Slider label="Margen antes/después" value={pad} min={0} max={0.5} step={0.02} unit=" s" onChange={setPad} reset={0.12} />
      <button className="btn wide" disabled={busy} onClick={detect}><Icon name="search" size={15} /> Detectar</button>
      {cands && cands.length > 0 && (
        <>
          <div className="cut-list">
            {cands.map((c, i) => (
              <label key={i} className="cut-row">
                <input type="checkbox" checked={c.on} onChange={() => setCands(cands.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))} />
                <span className={`tag ${c.kind}`}>{c.kind === 'filler' ? 'Muletilla' : 'Pausa'}</span>
                <button className="link" onClick={() => setState({ time: c.a, playing: false })}>{fmtTime(c.a)}</button>
                <em>{(c.b - c.a).toFixed(1)} s</em>
                {c.kind === 'filler' && <small>{(words || []).filter((w) => w.s >= c.a - 1e-3 && w.s < c.b).map((w) => w.text).join(' ')}</small>}
              </label>
            ))}
          </div>
          <button className="btn primary wide" disabled={!chosen.length} onClick={apply}><Icon name="split" size={15} /> Quitar {chosen.length} tramos ({saved.toFixed(1)} s)</button>
        </>
      )}
    </div>
  );
}
