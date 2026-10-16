import React, { useEffect, useRef, useState } from 'react';
import { useStore, getState, update, toast } from '../store.js';
import { fmtTime, mediaUrl, TEXT_PRESETS, STICKERS, EFFECTS, TRANSITIONS, FILTER_PRESETS, effectiveFilter, DEFAULT_FILTER } from '../engine/model.js';
import { cssFilter } from '../engine/render.js';
import { Icon, IconBtn, Select, Slider, Toggle } from '../ui.jsx';
import { importDialog, importPaths, addToTimeline, addText, addSticker, addEffect, applyTransition, addFilterLayer, addTTS, patchSilently, reprobeMedia } from './actions.js';
import { generateCaptions, WHISPER_MODELS, LANGS, toSRT, fromSRT, restyleCaptions, selectCaptionTrack, translateCaptions, TRANSLATE_LANGS } from './captions.js';
import { findReplace, getVocab, setVocab, addCaptionEmojis } from './transcript.js';
import { neuralTTS, NEURAL_LANGS } from './audioai.js';
import TranscriptTab from './TranscriptPanel.jsx';
import BrandTab from './BrandTab.jsx';
import VisionTab from './VisionTab.jsx';

const TABS = [
  ['media', 'film', 'Medios'], ['audio', 'music', 'Audio'], ['text', 'type', 'Texto'], ['stickers', 'smile', 'Stickers'],
  ['effects', 'sparkles', 'Efectos'], ['transitions', 'transition', 'Transiciones'], ['filters', 'sliders', 'Filtros'], ['captions', 'cc', 'Subtítulos'], ['transcript', 'edit', 'Transcripción'], ['ai', 'wand', 'IA'], ['brand', 'diamond', 'Marca'],
];

export default function MediaPanel() {
  const [tab, setTab] = useState('media');
  return (
    <aside className="left">
      <nav className="left-tabs">
        {TABS.map(([k, icon, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} title={label}>
            <Icon name={icon} size={20} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="left-body">
        {tab === 'media' && <MediaTab />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'stickers' && <StickersTab />}
        {tab === 'effects' && <EffectsTab />}
        {tab === 'transitions' && <TransitionsTab />}
        {tab === 'filters' && <FiltersTab />}
        {tab === 'captions' && <CaptionsTab />}
        {tab === 'transcript' && <TranscriptTab />}
        {tab === 'ai' && <VisionTab />}
        {tab === 'brand' && <BrandTab />}
      </div>
    </aside>
  );
}

function MediaCard({ m }) {
  const used = useStore((s) => s.project.clips.some((c) => c.mediaId === m.id));
  const relink = async () => {
    const paths = await window.api.openMedia();
    if (!paths[0]) return;
    update((p) => { const x = p.media.find((k) => k.id === m.id); x.path = paths[0]; x.missing = false; x.proxy = null; x.reversed = null; delete x.sar; });
    reprobeMedia();
    toast('Archivo vuelto a vincular');
  };
  return (
    <div className={`media-card ${m.missing ? 'missing' : ''}`} draggable={!m.missing}
      onDragStart={(e) => { e.dataTransfer.setData('velvix/media', m.id); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => !m.missing && addToTimeline(m)} title={m.path}>
      <div className="mc-thumb">
        {m.type === 'audio' ? <Icon name="music" size={28} /> : m.thumb ? <img src={mediaUrl(m.thumb)} alt="" draggable={false} /> : <span className="spinner" />}
        {m.type !== 'image' && <span className="dur">{fmtTime(m.duration)}</span>}
        {used && <span className="used" title="En la línea de tiempo">●</span>}
        {m.missing
          ? <button className="mc-add relink" onClick={relink} title="Archivo no encontrado: volver a vincular"><Icon name="link" size={14} /></button>
          : <button className="mc-add" onClick={() => addToTimeline(m)} title="Agregar a la línea de tiempo"><Icon name="plus" size={14} /></button>}
      </div>
      <span className="mc-name">{m.name}</span>
    </div>
  );
}

function MediaTab() {
  const media = useStore((s) => s.project.media);
  const [filter, setFilter] = useState('all');
  const shown = media.filter((m) => filter === 'all' || m.type === filter);
  return (
    <div className="panel">
      <button className="btn primary wide" onClick={importDialog}><Icon name="upload" size={16} /> Importar</button>
      <div className="chips">
        {[['all', 'Todo'], ['video', 'Video'], ['image', 'Fotos'], ['audio', 'Audio']].map(([k, v]) => (
          <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{v}</button>
        ))}
      </div>
      {!shown.length && (
        <div className="drop-zone" onClick={importDialog}><Icon name="upload" size={28} /><p>Arrastra archivos aquí<br /><small>MP4, MOV, MKV, WEBM, MP3, WAV, PNG, JPG…</small></p></div>
      )}
      <div className="media-grid"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = [...e.dataTransfer.files].map((x) => window.api.pathForFile(x)).filter(Boolean); if (f.length) importPaths(f); }}>
        {shown.map((m) => <MediaCard key={m.id} m={m} />)}
      </div>
    </div>
  );
}

function AudioTab() {
  const allMedia = useStore((s) => s.project.media);
  const media = allMedia.filter((m) => m.type === 'audio');
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(0);
  const [text, setText] = useState('');
  const [engine, setEngine] = useState('windows');
  const [nlang, setNlang] = useState('spa');
  const [rec, setRec] = useState(null);
  const [secs, setSecs] = useState(0);
  useEffect(() => { window.api.ttsVoices().then((v) => { setVoices(v); const es = v.find((x) => x.culture.startsWith('es')); setVoice((es || v[0] || {}).name || ''); }); }, []);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      const startAt = getState().time;
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const { data } = await window.api.paths();
        const path = `${data}\\recordings\\voz-${Date.now()}.webm`;
        await window.api.writeFile(path, await new Blob(chunks).arrayBuffer());
        const [m] = await importPaths([path]);
        if (m) addToTimeline(m, { at: startAt });
        toast('Grabación agregada');
      };
      mr.start();
      const t0 = Date.now(), iv = setInterval(() => setSecs((Date.now() - t0) / 1000), 200);
      setRec({ mr, iv });
    } catch { toast('No se pudo acceder al micrófono', 'error'); }
  };
  const stopRec = () => { rec.mr.stop(); clearInterval(rec.iv); setRec(null); setSecs(0); };

  return (
    <div className="panel">
      <button className="btn primary wide" onClick={importDialog}><Icon name="upload" size={16} /> Importar música o sonido</button>
      <h5>Grabar voz en off</h5>
      {rec
        ? <button className="btn danger wide" onClick={stopRec}><span className="rec-dot" /> Detener · {fmtTime(secs)}</button>
        : <button className="btn wide" onClick={startRec}><Icon name="mic" size={16} /> Grabar desde el cursor</button>}
      <h5>Texto a voz</h5>
      <textarea rows={3} placeholder="Escribe lo que quieres que diga la voz…" value={text} onChange={(e) => setText(e.target.value)} />
      <Select value={engine} options={{ windows: 'Voces de Windows', neural: 'Voz neuronal (IA, offline)' }} onChange={setEngine} />
      {engine === 'neural' ? <>
        <Select value={nlang} options={NEURAL_LANGS} onChange={setNlang} />
        <button className="btn wide tts-neural" disabled={!text.trim()} onClick={() => neuralTTS(text, nlang)}><Icon name="wand" size={16} /> Generar voz neuronal</button>
      </> : <>
      {voices.length > 0
        ? <Select value={voice} options={Object.fromEntries(voices.map((v) => [v.name, `${v.name.replace('Microsoft ', '')} (${v.culture})`]))} onChange={setVoice} />
        : <p className="hint">No hay voces del sistema instaladas. Agrégalas en Configuración de Windows › Hora e idioma › Voz.</p>}
      <Slider label="Velocidad" value={rate} min={-10} max={10} onChange={setRate} reset={0} />
      <button className="btn wide" disabled={!text.trim()} onClick={() => addTTS(text, voice, rate)}><Icon name="wand" size={16} /> Generar voz</button>
      </>}
      {media.length > 0 && <h5>Audio del proyecto</h5>}
      <div className="audio-list">
        {media.map((m) => (
          <div key={m.id} className="audio-row" draggable onDragStart={(e) => e.dataTransfer.setData('velvix/media', m.id)} onDoubleClick={() => addToTimeline(m)}>
            <Icon name="music" size={16} /><span>{m.name}</span><em>{fmtTime(m.duration)}</em>
            <IconBtn icon="plus" title="Agregar" size={14} onClick={() => addToTimeline(m)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// CSS approximation of a text preset for the catalog preview.
export function presetStyle(t) {
  const s = { color: t.color || '#fff', fontWeight: t.bold === false ? 400 : 800, letterSpacing: (t.letterSpacing || 0) / 3, textTransform: t.uppercase ? 'uppercase' : 'none' };
  const shadows = [];
  if (t.glow && t.glow.on) shadows.push(`0 0 8px ${t.glow.color}`, `0 0 14px ${t.glow.color}`);
  if (t.shadow && t.shadow.on) shadows.push(`${(t.shadow.x || 0) / 3}px ${(t.shadow.y || 0) / 3}px ${(t.shadow.blur || 0) / 3}px ${t.shadow.color}`);
  if (shadows.length) s.textShadow = shadows.join(',');
  if (t.stroke && t.stroke.on) { s.WebkitTextStroke = `${Math.max(1, t.stroke.width / 3)}px ${t.stroke.color}`; s.paintOrder = 'stroke fill'; }
  if (t.bg && t.bg.on) { s.background = t.bg.color; s.padding = '2px 8px'; s.borderRadius = 5; }
  if (t.gradient && t.gradient.on) { s.backgroundImage = `linear-gradient(${t.gradient.from}, ${t.gradient.to})`; s.WebkitBackgroundClip = 'text'; s.color = 'transparent'; }
  return s;
}

function TextTab() {
  return (
    <div className="panel">
      <button className="btn primary wide" onClick={() => addText()}><Icon name="plus" size={16} /> Agregar texto</button>
      <h5>Estilos de texto</h5>
      <div className="preset-grid">
        {TEXT_PRESETS.map((p, i) => (
          <button key={i} className="preset" onClick={() => addText(p.t, p.name === 'Karaoke' ? 'Texto estilo karaoke' : 'Escribe aquí')} title={p.name}>
            <span style={presetStyle(p.t)}>Aa</span><small>{p.name}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function StickersTab() {
  return (
    <div className="panel">
      <h5>Stickers y emojis</h5>
      <div className="sticker-grid">
        {STICKERS.map((s) => <button key={s} onClick={() => addSticker(s)} title="Agregar sticker">{s}</button>)}
      </div>
      <p className="hint">También puedes importar PNG transparentes como stickers desde Medios.</p>
    </div>
  );
}

const FX_ICON = { shake: '〰', zoomPulse: '⊕', flash: '✦', strobe: '◐', glitch: '▚', rgbSplit: '◫', vhs: '▤', oldFilm: '🎞', grain: '░', lightLeak: '☀', letterbox: '▭', mirror: '⇋', kaleido: '✳', blurIn: '◌', vignettePulse: '◉', pixelate: '▦', bw: '◑', heartbeat: '♥', rain: '☂', snow: '❄', sparkles: '✨', scanlines: '≡', split3: '☰', fisheye: '◎', duotone: '◧', neonEdge: '✺' };
function EffectsTab() {
  return (
    <div className="panel">
      <h5>Efectos de video</h5>
      <p className="hint">Se agregan en el cursor y afectan todo lo que está debajo. Ajusta duración e intensidad en la línea de tiempo.</p>
      <div className="fx-grid">
        {Object.entries(EFFECTS).map(([k, v]) => (
          <button key={k} className="fx" onClick={() => addEffect(k)}><span>{FX_ICON[k] || '✦'}</span><small>{v}</small></button>
        ))}
      </div>
    </div>
  );
}

function TransitionsTab() {
  const [dur, setDur] = useState(0.6);
  return (
    <div className="panel">
      <h5>Transiciones</h5>
      <p className="hint">Selecciona un clip (o deja el cursor cerca de un corte) y elige una transición.</p>
      <Slider label="Duración" value={dur} min={0.1} max={2} step={0.1} unit="s" onChange={setDur} />
      <div className="fx-grid">
        {Object.entries(TRANSITIONS).map(([k, v]) => (
          <button key={k} className="fx trans" onClick={() => applyTransition(k, dur)}><span className={`tr-ico tr-${k}`} /><small>{v}</small></button>
        ))}
        <button className="fx" onClick={() => applyTransition(null)}><span>⊘</span><small>Quitar</small></button>
      </div>
    </div>
  );
}

function FiltersTab() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const sel = project.clips.find((c) => selection.includes(c.id) && (c.type === 'video' || c.type === 'image'));
  const thumbMedia = (sel && project.media.find((m) => m.id === sel.mediaId)) || project.media.find((m) => m.thumb);
  const apply = (preset) => {
    if (!sel) return addFilterLayer(preset);
    update((p) => {
      for (const c of p.clips) if (selection.includes(c.id) && c.filter) c.filter = { ...c.filter, preset, intensity: c.filter.intensity || 100 };
    });
  };
  return (
    <div className="panel">
      <h5>Filtros</h5>
      <p className="hint">{sel ? 'Se aplicará al clip seleccionado.' : 'Sin clip seleccionado: se agrega como capa de filtro sobre todo el video.'}</p>
      <div className="filter-grid">
        {Object.entries(FILTER_PRESETS).map(([k, v]) => (
          <button key={k} className={`filter ${sel && sel.filter && sel.filter.preset === k ? 'active' : ''}`} onClick={() => apply(k)}>
            <span className="ft-thumb" style={{ filter: cssFilter(effectiveFilter({ ...DEFAULT_FILTER, preset: k }), 320) }}>
              {thumbMedia && thumbMedia.thumb ? <img src={mediaUrl(thumbMedia.thumb)} alt="" /> : <i />}
            </span>
            <small>{v.name}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function CaptionsTab() {
  const hasCaptions = useStore((s) => s.project.clips.some((c) => c.caption));
  const [model, setModel] = useState(() => localStorage.getItem('whisperModel') || 'onnx-community/whisper-base');
  const [lang, setLang] = useState('es');
  const [style, setStyle] = useState(14);
  const [emojis, setEmojis] = useState(false);
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [vocab, setVocabText] = useState(getVocab);
  const [src, setSrc] = useState('es');
  const [tgt, setTgt] = useState('en');
  const run = async () => { localStorage.setItem('whisperModel', model); setBusy(true); await generateCaptions({ model, language: lang, style, emojis }); setBusy(false); };
  const exportSrt = async () => {
    const out = await window.api.saveDialog({ defaultPath: `${getState().project.name}.srt`, filters: [{ name: 'Subtítulos SRT', extensions: ['srt'] }] });
    if (out) { await window.api.writeFile(out, new TextEncoder().encode(toSRT(getState().project))); toast('SRT exportado'); }
  };
  const importSrt = async () => {
    const f = await window.api.openFile([{ name: 'Subtítulos', extensions: ['srt', 'vtt'] }]);
    if (f) toast(`${fromSRT(await window.api.readFile(f), style)} subtítulos importados`);
  };
  const translate = async () => { setBusy(true); await translateCaptions(src, tgt); setBusy(false); };
  return (
    <div className="panel">
      <h5>Subtítulos automáticos</h5>
      <p className="hint">Reconocimiento de voz 100% local con IA. El modelo se descarga una sola vez; después funciona sin internet.</p>
      <Select label="Idioma hablado" value={lang} options={LANGS} onChange={setLang} />
      <Select label="Modelo" value={model} options={WHISPER_MODELS} onChange={setModel} />
      <label className="field select"><span>Estilo</span>
        <select value={style} onChange={(e) => { setStyle(+e.target.value); if (hasCaptions) restyleCaptions(+e.target.value); }}>
          {TEXT_PRESETS.map((p, i) => <option key={i} value={i}>{p.name}{p.t.wordAnim ? ' ✦' : ''}</option>)}
        </select>
      </label>
      <Toggle label="Emojis automáticos" value={emojis} onChange={setEmojis} />
      <button className="btn primary wide" disabled={busy} onClick={run}><Icon name="wand" size={16} /> {busy ? 'Generando…' : hasCaptions ? 'Volver a generar' : 'Generar subtítulos'}</button>
      {hasCaptions && <button className="btn wide" onClick={selectCaptionTrack}><Icon name="layers" size={16} /> Seleccionar todos (editar estilo en lote)</button>}
      {hasCaptions && <button className="btn wide" onClick={() => { let n = 0; update((d) => { n = addCaptionEmojis(d); }); toast(`${n} emojis agregados`); }}><Icon name="smile" size={16} /> Agregar emojis a los subtítulos</button>}
      <p className="hint">Los estilos con ✦ son dinámicos: cada palabra entra al hablarse y las palabras clave se resaltan.</p>
      <h5>Buscar y reemplazar</h5>
      <input className="input" placeholder="Buscar…" value={find} onChange={(e) => setFind(e.target.value)} />
      <input className="input" placeholder="Reemplazar con…" value={repl} onChange={(e) => setRepl(e.target.value)} />
      <button className="btn wide" disabled={!find} onClick={() => toast(`${findReplace(find, repl)} reemplazos`)}><Icon name="search" size={15} /> Reemplazar todo</button>
      <h5>Vocabulario propio</h5>
      <p className="hint">Marcas y nombres, uno por línea. Se corrigen solos al transcribir. Usa «mal = Bien» para una corrección exacta.</p>
      <textarea rows={3} placeholder={'Velvix, CapCut, tic toc = TikTok'} value={vocab} onChange={(e) => { setVocabText(e.target.value); setVocab(e.target.value); }} />
      <h5>Traducir subtítulos</h5>
      <p className="hint">Traducción local con IA (el modelo se descarga una vez, ~80 MB por idioma).</p>
      <div className="row2">
        <Select value={src} options={TRANSLATE_LANGS} onChange={setSrc} />
        <Select value={tgt} options={Object.fromEntries(Object.entries(TRANSLATE_LANGS).filter(([k]) => k !== 'ja' && k !== 'ko'))} onChange={setTgt} />
      </div>
      <button className="btn wide" disabled={busy || !hasCaptions} onClick={translate}><Icon name="transition" size={15} /> Traducir</button>
      <h5>Archivos SRT</h5>
      <div className="row2">
        <button className="btn" onClick={importSrt}><Icon name="upload" size={15} /> Importar</button>
        <button className="btn" onClick={exportSrt}><Icon name="download" size={15} /> Exportar</button>
      </div>
    </div>
  );
}
