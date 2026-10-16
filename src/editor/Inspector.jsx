import React, { useEffect, useRef, useState } from 'react';
import { useStore, getState, update, toast } from '../store.js';
import {
  FILTER_PRESETS, ANIM_IN, ANIM_OUT, ANIM_LOOP, BLEND_MODES, VOICES, TEXT_PRESETS, EFFECTS, TRANSITIONS, FONTS,
  DEFAULT_TEXT, DEFAULT_FILTER, mediaOf, propAt, setProp, toggleKeyframe, kfsAt, fmtTime, clipEnd, WORD_ANIMS,
  KF_PROPS, SPEED_CURVES, MAX_SPEED, EASES, EASE_NAMES, bezier, clamp, curveSpeed,
} from '../engine/model.js';
import { Icon, IconBtn, Slider, Toggle, Select, Color, Section, Tabs } from '../ui.jsx';
import { setSpeed, setCurve, toggleReverse, detachAudio, applyToAll, patchSilently, addTTS } from './actions.js';
import { presetStyle } from './MediaPanel.jsx';
import { isolateVoice, detectBeats, cutToBeat } from './audioai.js';
import ColorTab from './ColorTab.jsx';

// Applies fn to every selected clip of the primary clip's type (batch editing, e.g. all captions).
function useEditor(clip) {
  const selection = useStore((s) => s.selection);
  return (fn, key) => update((p) => {
    for (const c of p.clips) if (selection.includes(c.id) && c.type === clip.type) fn(c, p);
  }, key && `${key}-${clip.id}`);
}

export default function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const clip = project.clips.find((c) => c.id === selection[0]);
  return (
    <aside className="right">
      {!clip && <ProjectPanel project={project} />}
      {clip && <ClipPanel key={clip.id} clip={clip} project={project} count={selection.length} />}
    </aside>
  );
}

function ProjectPanel({ project }) {
  const bg = project.background;
  const set = (k, v) => update((p) => { p.background[k] = v; }, 'bg-' + k);
  return (
    <div className="insp">
      <h3 className="insp-title">Proyecto</h3>
      <Section title="Fondo del lienzo">
        <div className="seg">
          {[['black', 'Negro'], ['color', 'Color'], ['blur', 'Desenfoque']].map(([k, v]) => (
            <button key={k} className={bg.type === k ? 'active' : ''} onClick={() => set('type', k)}>{v}</button>
          ))}
        </div>
        {bg.type === 'color' && <Color label="Color" value={bg.color} onChange={(v) => set('color', v)} />}
        {bg.type === 'blur' && <Slider label="Desenfoque" value={bg.blur ?? 40} min={5} max={100} onChange={(v) => set('blur', v)} />}
        <p className="hint">El fondo se ve cuando un clip de la pista principal no llena el formato.</p>
      </Section>
      <Section title="Información">
        <dl className="info">
          <dt>Resolución</dt><dd>{project.width}×{project.height}</dd>
          <dt>Cuadros/s</dt><dd>{project.fps}</dd>
          <dt>Clips</dt><dd>{project.clips.length}</dd>
          <dt>Medios</dt><dd>{project.media.length}</dd>
        </dl>
      </Section>
      <p className="hint center">Selecciona un clip en la línea de tiempo para editarlo.</p>
    </div>
  );
}

function ClipPanel({ clip, project, count }) {
  const media = mediaOf(project, clip);
  const visual = clip.type === 'video' || clip.type === 'image';
  const tabs = {};
  if (clip.type === 'text') Object.assign(tabs, { text: 'Texto', style: 'Estilo', anim: 'Animación', basic: 'Posición' });
  if (visual) Object.assign(tabs, { basic: 'Básico', adjust: 'Ajustes', color: 'Color', anim: 'Animación', speed: 'Velocidad' });
  if (clip.type === 'video' && media && (media.hasAudio || clip.fxPath)) tabs.audio = 'Audio';
  if (clip.type === 'audio') Object.assign(tabs, { audio: 'Audio', speed: 'Velocidad' });
  if (clip.type === 'effect') tabs.effect = clip.filter ? 'Filtro' : 'Efecto';
  if (visual && clip.transition) tabs.trans = 'Transición';
  const [tab, setTab] = useState(Object.keys(tabs)[0]);
  const cur = tabs[tab] ? tab : Object.keys(tabs)[0];
  const edit = useEditor(clip);
  return (
    <div className="insp">
      <h3 className="insp-title">
        {count > 1 ? `${count} clips seleccionados` : clip.type === 'text' ? (clip.caption ? 'Subtítulo' : clip.sticker ? 'Sticker' : 'Texto') : clip.name || clip.type}
        <small>{fmtTime(clip.start)} – {fmtTime(clipEnd(clip))}</small>
      </h3>
      <Tabs tabs={tabs} value={cur} onChange={setTab} />
      <div className="insp-body">
        <EaseSection clip={clip} />
        {cur === 'text' && <TextTab clip={clip} edit={edit} />}
        {cur === 'style' && <StyleTab clip={clip} edit={edit} />}
        {cur === 'basic' && <BasicTab clip={clip} edit={edit} project={project} visual={visual} />}
        {cur === 'adjust' && <AdjustTab clip={clip} edit={edit} />}
        {cur === 'color' && <ColorTab clip={clip} edit={edit} />}
        {cur === 'anim' && <AnimTab clip={clip} edit={edit} />}
        {cur === 'speed' && <SpeedTab clip={clip} media={media} />}
        {cur === 'audio' && <AudioTab clip={clip} edit={edit} media={media} />}
        {cur === 'effect' && <EffectTab clip={clip} edit={edit} />}
        {cur === 'trans' && <TransTab clip={clip} edit={edit} />}
      </div>
    </div>
  );
}

// ---------- keyframe-aware slider (transform, filter.*, mask.*, volume) ----------
export function KfSlider({ clip, prop, label, min, max, step, unit, scale = 1, reset, edit }) {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project.fps);
  const list = (clip.kf && clip.kf[prop]) || [];
  const local = time - clip.start;
  const onKf = list.some((f) => Math.abs(f.t - local) < 0.5 / fps);
  const inside = time >= clip.start && time <= clipEnd(clip);
  const set = (v) => {
    const fn = (c, p) => setProp(c, prop, v / scale, time, p.fps);
    if (edit) edit(fn, 'kf-' + prop);
    else update((p) => fn(p.clips.find((x) => x.id === clip.id), p), `kf-${prop}-${clip.id}`);
  };
  return (
    <div className="kf-row">
      <Slider label={label} value={propAt(clip, prop, time) * scale} min={min} max={max} step={step} unit={unit} reset={reset} onChange={set} />
      <button className={`kf-btn ${onKf ? 'on' : list.length ? 'has' : ''}`} disabled={!inside} data-kf={prop}
        title={onKf ? 'Quitar fotograma clave' : 'Agregar fotograma clave en el cursor'}
        onClick={() => update((p) => toggleKeyframe(p.clips.find((x) => x.id === clip.id), prop, time, p.fps))}>
        <Icon name="diamond" size={12} fill={onKf} />
      </button>
    </div>
  );
}

// Easing of the keyframes under the playhead: presets + draggable cubic-bezier handles.
function EaseSection({ clip }) {
  const time = useStore((s) => s.time);
  const fps = useStore((s) => s.project.fps);
  const svg = useRef(null);
  const ks = kfsAt(clip, time, fps);
  if (!ks.length) return null;
  const e = ks[0].ease;
  const b = [...(Array.isArray(e) ? e : EASES[e || 'inOut'] || EASES.inOut)];
  const setEase = (v, coalesce) => update((p) => { for (const k of kfsAt(p.clips.find((x) => x.id === clip.id), time, p.fps)) k.ease = v; }, coalesce ? `ease-${clip.id}` : null);
  const S = 120, Y = (y) => S * 0.8 - y * S * 0.6, X = (x) => x * S; // y from -0.33 to 1.33
  const path = 'M' + Array.from({ length: 41 }, (_, i) => `${X(i / 40)},${Y(bezier(b, i / 40))}`).join('L');
  const drag = (i) => (ev) => {
    ev.preventDefault();
    const move = (m) => {
      const r = svg.current.getBoundingClientRect();
      const x = clamp((m.clientX - r.left) / r.width, 0, 1), y = clamp((S * 0.8 - ((m.clientY - r.top) / r.height) * S) / (S * 0.6), -0.5, 1.5);
      const nb = [...b]; nb[i * 2] = +x.toFixed(3); nb[i * 2 + 1] = +y.toFixed(3);
      b.splice(0, 4, ...nb);
      setEase(nb, true);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const named = Array.isArray(e) ? null : e || 'inOut';
  return (
    <Section title={`Curva del fotograma clave (${ks.length})`}>
      <div className="ease-row">
        <svg ref={svg} className="ease-svg" viewBox={`0 0 ${S} ${S}`}>
          <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="ease-diag" />
          <line x1={X(0)} y1={Y(0)} x2={X(b[0])} y2={Y(b[1])} className="ease-arm" />
          <line x1={X(1)} y1={Y(1)} x2={X(b[2])} y2={Y(b[3])} className="ease-arm" />
          <path d={path} className="ease-curve" />
          {[0, 1].map((i) => <circle key={i} cx={X(b[i * 2])} cy={Y(b[i * 2 + 1])} r={6} className="ease-handle" onPointerDown={drag(i)} />)}
        </svg>
        <div className="ease-presets">
          {Object.entries(EASE_NAMES).map(([k, v]) => <button key={k} className={named === k ? 'active' : ''} onClick={() => setEase(k === 'inOut' ? undefined : k)}>{v}</button>)}
        </div>
      </div>
      <p className="hint">Cómo se llega al siguiente fotograma clave. Arrastra los puntos para una curva propia.</p>
    </Section>
  );
}

function BasicTab({ clip, edit, project, visual }) {
  const tr = clip.transform;
  const hasKf = KF_PROPS.some((k) => clip.kf && clip.kf[k] && clip.kf[k].length);
  return (
    <>
      <Section title="Transformar" right={hasKf && <button className="link" onClick={() => edit((c) => { for (const k of KF_PROPS) delete c.kf[k]; })}>Quitar keyframes</button>}>
        <KfSlider clip={clip} prop="scale" label="Escala" min={1} max={500} step={1} unit="%" scale={100} reset={100} />
        <KfSlider clip={clip} prop="x" label="Posición X" min={-150} max={150} step={0.5} scale={100} reset={0} />
        <KfSlider clip={clip} prop="y" label="Posición Y" min={-150} max={150} step={0.5} scale={100} reset={0} />
        <KfSlider clip={clip} prop="rotation" label="Rotación" min={-360} max={360} step={1} unit="°" reset={0} />
        <KfSlider clip={clip} prop="opacity" label="Opacidad" min={0} max={100} step={1} unit="%" scale={100} reset={100} />
        <div className="row-btns">
          <button className={`btn sm ${tr.flipH ? 'active' : ''}`} onClick={() => edit((c) => { c.transform.flipH = !c.transform.flipH; })}>⇋ Voltear H</button>
          <button className={`btn sm ${tr.flipV ? 'active' : ''}`} onClick={() => edit((c) => { c.transform.flipV = !c.transform.flipV; })}>⇅ Voltear V</button>
          <button className="btn sm" onClick={() => edit((c) => { c.transform.rotation = ((c.transform.rotation || 0) + 90) % 360; })}>⟳ 90°</button>
          <button className="btn sm" onClick={() => edit((c) => { c.transform = { ...c.transform, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }; for (const k of KF_PROPS) delete c.kf[k]; })}>Restablecer</button>
        </div>
      </Section>
      {visual && (
        <>
          <Section title="Encuadre">
            <div className="seg">
              {[['fit', 'Ajustar'], ['fill', 'Llenar'], ['stretch', 'Estirar']].map(([k, v]) => (
                <button key={k} className={clip.fit === k ? 'active' : ''} onClick={() => edit((c) => { c.fit = k; })}>{v}</button>
              ))}
            </div>
          </Section>
          <Section title="Recortar" defaultOpen={false}>
            {[['l', 'Izquierda'], ['r', 'Derecha'], ['t', 'Arriba'], ['b', 'Abajo']].map(([k, v]) => (
              <Slider key={k} label={v} value={(clip.crop[k] || 0) * 100} min={0} max={90} unit="%" reset={0}
                onChange={(x) => edit((c) => { c.crop[k] = x / 100; }, 'crop-' + k)} />
            ))}
          </Section>
          <Section title="Mezcla" defaultOpen={false}>
            <Select label="Modo de fusión" value={clip.blend || 'source-over'} options={BLEND_MODES} onChange={(v) => edit((c) => { c.blend = v; })} />
          </Section>
          <MaskSection clip={clip} edit={edit} />
          <ChromaSection clip={clip} edit={edit} />
        </>
      )}
    </>
  );
}

function MaskSection({ clip, edit }) {
  const m = clip.mask;
  const set = (k, v, key) => edit((c) => { c.mask[k] = v; }, key);
  const types = { none: 'Ninguna', circle: 'Círculo', rect: 'Rectángulo', linear: 'Lineal', mirror: 'Espejo', heart: 'Corazón', star: 'Estrella' };
  return (
    <Section title="Máscara" defaultOpen={m.type !== 'none'}>
      <div className="mask-grid">
        {Object.entries(types).map(([k, v]) => <button key={k} className={m.type === k ? 'active' : ''} onClick={() => set('type', k)}>{v}</button>)}
      </div>
      {m.type !== 'none' && (
        <>
          <KfSlider clip={clip} edit={edit} prop="mask.x" label="Posición X" min={-60} max={60} scale={100} reset={0} />
          <KfSlider clip={clip} edit={edit} prop="mask.y" label="Posición Y" min={-60} max={60} scale={100} reset={0} />
          {m.type !== 'linear' && <KfSlider clip={clip} edit={edit} prop="mask.w" label="Ancho" min={2} max={200} scale={100} />}
          {m.type !== 'linear' && <KfSlider clip={clip} edit={edit} prop="mask.h" label={m.type === 'mirror' ? 'Grosor' : 'Alto'} min={2} max={200} scale={100} />}
          <KfSlider clip={clip} edit={edit} prop="mask.angle" label="Rotación" min={-180} max={180} unit="°" reset={0} />
          <KfSlider clip={clip} edit={edit} prop="mask.feather" label="Difuminado" min={0} max={100} />
          <Toggle label="Invertir" value={m.invert} onChange={(v) => set('invert', v)} />
        </>
      )}
    </Section>
  );
}

function ChromaSection({ clip, edit }) {
  const ck = clip.chroma;
  const set = (k, v, key) => edit((c) => { c.chroma[k] = v; }, key);
  const pick = async () => {
    if (!window.EyeDropper) return toast('Cuentagotas no disponible');
    try { const r = await new window.EyeDropper().open(); set('color', r.sRGBHex); set('on', true); } catch { /* cancelled */ }
  };
  return (
    <Section title="Croma (pantalla verde)" defaultOpen={ck.on}>
      <Toggle label="Activar" value={ck.on} onChange={(v) => set('on', v)} />
      <div className="row-btns">
        <Color label="Color clave" value={ck.color} onChange={(v) => set('color', v)} />
        <button className="btn sm" onClick={pick} title="Elegir color del visor">💧 Cuentagotas</button>
      </div>
      <Slider label="Intensidad" value={ck.similarity} min={0} max={100} onChange={(v) => set('similarity', v, 'cs')} />
      <Slider label="Suavizado" value={ck.smooth} min={0} max={100} onChange={(v) => set('smooth', v, 'cm')} />
    </Section>
  );
}

function FilterControls({ f, set, onAll, clip, edit }) {
  const adj = [
    ['exposure', 'Exposición'], ['brightness', 'Brillo'], ['contrast', 'Contraste'], ['saturation', 'Saturación'],
    ['temperature', 'Temperatura'], ['tint', 'Matiz'], ['hue', 'Tono'], ['fade', 'Desvanecer'],
    ['sharpen', 'Nitidez', 0, 100], ['vignette', 'Viñeta', 0, 100], ['grain', 'Grano', 0, 100], ['blur', 'Desenfoque', 0, 50],
  ];
  return (
    <>
      <Section title="Filtro" right={onAll && <button className="link" onClick={onAll}>Aplicar a todos</button>}>
        <Select value={f.preset} options={Object.fromEntries(Object.entries(FILTER_PRESETS).map(([k, v]) => [k, v.name]))} onChange={(v) => set('preset', v)} />
        {f.preset !== 'none' && <KfSlider clip={clip} edit={edit} prop="filter.intensity" label="Intensidad" min={0} max={100} unit="%" reset={100} />}
      </Section>
      <Section title="Ajustes" right={<button className="link" onClick={() => adj.forEach(([k]) => set(k, 0))}>Restablecer</button>}>
        {adj.map(([k, label, min = -100, max = 100]) => (
          <KfSlider key={k} clip={clip} edit={edit} prop={'filter.' + k} label={label} min={min} max={max} reset={0} />
        ))}
      </Section>
    </>
  );
}

function AdjustTab({ clip, edit }) {
  const set = (k, v, key) => edit((c) => { c.filter[k] = v; }, key);
  return <FilterControls f={clip.filter} set={set} clip={clip} edit={edit} onAll={() => applyToAll(clip.id, 'filter')} />;
}

function AnimTab({ clip, edit }) {
  const a = clip.anim;
  const isText = clip.type === 'text';
  const filt = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => isText || !v.includes('(texto)')));
  const set = (slot, k, v, key) => edit((c) => { c.anim[slot] = { ...c.anim[slot], [k]: v }; }, key);
  const maxD = Math.max(0.1, clip.duration);
  return (
    <>
      <Section title="Entrada">
        <Select value={a.in.type} options={filt(ANIM_IN)} onChange={(v) => set('in', 'type', v)} />
        {a.in.type !== 'none' && <Slider label="Duración" value={Math.min(a.in.dur, maxD)} min={0.1} max={Math.min(5, maxD)} step={0.1} unit="s" onChange={(v) => set('in', 'dur', v, 'ai')} />}
      </Section>
      <Section title="Salida">
        <Select value={a.out.type} options={filt(ANIM_OUT)} onChange={(v) => set('out', 'type', v)} />
        {a.out.type !== 'none' && <Slider label="Duración" value={Math.min(a.out.dur, maxD)} min={0.1} max={Math.min(5, maxD)} step={0.1} unit="s" onChange={(v) => set('out', 'dur', v, 'ao')} />}
      </Section>
      <Section title="Combo (en bucle)">
        <Select value={a.loop.type} options={filt(ANIM_LOOP)} onChange={(v) => set('loop', 'type', v)} />
        {a.loop.type !== 'none' && <Slider label="Velocidad" value={a.loop.speed} min={0.2} max={4} step={0.1} unit="×" onChange={(v) => set('loop', 'speed', v, 'al')} />}
      </Section>
      {clip.type === 'video' && (
        <Section title="Fundido de audio" defaultOpen={false}>
          <Slider label="Entrada" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration)} step={0.1} unit="s" onChange={(v) => edit((c) => { c.fadeIn = v; }, 'fin')} />
          <Slider label="Salida" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration)} step={0.1} unit="s" onChange={(v) => edit((c) => { c.fadeOut = v; }, 'fout')} />
        </Section>
      )}
    </>
  );
}

const speedToPos = (s) => Math.log(s / 0.1) / Math.log(MAX_SPEED / 0.1) * 100; // 0.1× … 100×
const posToSpeed = (p) => { const s = 0.1 * Math.pow(MAX_SPEED / 0.1, p / 100); return s < 10 ? Math.round(s * 100) / 100 : Math.round(s); };
function SpeedTab({ clip, media }) {
  const presets = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20, 30, 50, 75, 100];
  const srcLen = clip.duration * clip.speed;
  const curveKey = clip.curve && (Object.keys(SPEED_CURVES).find((k) => JSON.stringify(SPEED_CURVES[k].pts) === JSON.stringify(clip.curve)) || 'custom');
  return (
    <>
      <Section title={clip.curve ? 'Velocidad media' : 'Velocidad constante'}>
        <div className="field slider">
          <div className="field-head"><label>Velocidad</label><span className="num"><input type="number" min={0.1} max={MAX_SPEED} step={0.05} value={+clip.speed.toFixed(3)} onChange={(e) => +e.target.value > 0 && setSpeed(clip.id, +e.target.value)} /><em>×</em></span></div>
          <input type="range" min={0} max={100} step={0.25} value={speedToPos(clip.speed)} onChange={(e) => setSpeed(clip.id, posToSpeed(+e.target.value), 'speed-' + clip.id)} style={{ '--p': `${speedToPos(clip.speed)}%` }} />
        </div>
        <div className="speed-presets">{presets.map((s) => <button key={s} className={clip.speed === s ? 'active' : ''} onClick={() => setSpeed(clip.id, s)}>{s}×</button>)}</div>
        <dl className="info"><dt>Duración original</dt><dd>{fmtTime(srcLen)}</dd><dt>Nueva duración</dt><dd>{fmtTime(clip.duration)}</dd></dl>
        <p className="hint">El tono de la voz se conserva al cambiar la velocidad.</p>
      </Section>
      <Section title="Curva de velocidad" defaultOpen={!!clip.curve}>
        <div className="speed-curves">
          <button className={!clip.curve ? 'active' : ''} onClick={() => setCurve(clip.id, null)}>Ninguna</button>
          {Object.entries(SPEED_CURVES).map(([k, v]) => <button key={k} className={curveKey === k ? 'active' : ''} data-curve={k} onClick={() => setCurve(clip.id, v.pts)}>{v.name}</button>)}
        </div>
        {clip.curve && <CurveEditor clip={clip} />}
        {clip.curve && <p className="hint">Arrastra los puntos (arriba = más rápido). Doble clic agrega o quita un punto. La duración no cambia: la velocidad de arriba es la media.</p>}
      </Section>
      {clip.type === 'video' && (
        <Section title="Dirección">
          <button className={`btn wide ${clip.reverse ? 'active' : ''}`} onClick={toggleReverse}><Icon name="reverse" size={15} /> {clip.reverse ? 'Reproducción invertida (activa)' : 'Invertir reproducción'}</button>
        </Section>
      )}
    </>
  );
}

// Speed curve editor: x = position in the clip, y = relative speed on a log scale (0.1× … 10×).
function CurveEditor({ clip }) {
  const time = useStore((s) => s.time);
  const svg = useRef(null);
  const W = 260, H = 120, pts = clip.curve;
  const X = (x) => x * W, Y = (y) => H / 2 - (Math.log10(y) * H) / 2;
  const fromEvent = (ev) => {
    const r = svg.current.getBoundingClientRect();
    return { x: clamp((ev.clientX - r.left) / r.width, 0, 1), y: +clamp(Math.pow(10, 1 - (2 * (ev.clientY - r.top)) / r.height), 0.1, 10).toFixed(2) };
  };
  const drag = (i) => (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    let cur = pts;
    const move = (m) => {
      const q = fromEvent(m), next = cur.map((p) => ({ ...p }));
      next[i].y = q.y;
      if (i > 0 && i < cur.length - 1) next[i].x = +clamp(q.x, cur[i - 1].x + 0.01, cur[i + 1].x - 0.01).toFixed(3);
      setCurve(clip.id, (cur = next), `curve-${clip.id}`);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const add = (ev) => {
    const q = fromEvent(ev);
    setCurve(clip.id, [...pts, { x: +q.x.toFixed(3), y: +curveSpeed(pts, q.x).toFixed(2) }].sort((a, b) => a.x - b.x));
  };
  const remove = (i) => (ev) => { ev.stopPropagation(); if (i > 0 && i < pts.length - 1) setCurve(clip.id, pts.filter((_, j) => j !== i)); };
  const u = (time - clip.start) / clip.duration;
  return (
    <svg ref={svg} className="curve-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onDoubleClick={add}>
      {[10, 1, 0.1].map((y) => <line key={y} x1={0} x2={W} y1={Y(y)} y2={Y(y)} className={y === 1 ? 'curve-one' : 'curve-grid'} />)}
      <text x={3} y={10} className="curve-lbl">10×</text><text x={3} y={H / 2 - 3} className="curve-lbl">1×</text><text x={3} y={H - 3} className="curve-lbl">0.1×</text>
      <polyline points={pts.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')} className="curve-line" />
      {u >= 0 && u <= 1 && <line x1={X(u)} x2={X(u)} y1={0} y2={H} className="curve-head" />}
      {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={5} className="curve-pt" onPointerDown={drag(i)} onDoubleClick={remove(i)} />)}
    </svg>
  );
}

function AudioTab({ clip, edit, media }) {
  const fx = clip.audioFx;
  // Effects render offline to a WAV via ffmpeg; preview and export both use that file.
  const setFx = async (k, v) => {
    const next = { ...fx, [k]: v };
    edit((c) => { c.audioFx = { ...c.audioFx, [k]: v }; });
    const src = (clip.reverse && media.reversed) || media.proxy || media.path;
    const active = next.voice !== 'none' || next.pitch || next.denoise || next.normalize || next.bass || next.treble || next.enhance;
    try {
      const fxPath = active ? await window.api.audioFx(src, next) : null;
      patchSilently((p) => { const c = p.clips.find((x) => x.id === clip.id); if (c) c.fxPath = fxPath; });
    } catch (e) { toast('No se pudo aplicar el efecto: ' + e.message, 'error'); }
  };
  const [every, setEvery] = useState('1');
  const beats = useStore((s) => (s.project.markers || []).filter((m) => m.beat && m.clip === clip.id).length);
  return (
    <>
      <Section title="Volumen">
        <KfSlider clip={clip} edit={edit} prop="volume" label="Volumen" min={0} max={300} unit="%" scale={100} reset={100} />
        <Toggle label="Silenciar clip" value={clip.muted} onChange={(v) => edit((c) => { c.muted = v; })} />
        <Slider label="Fundido de entrada" value={clip.fadeIn} min={0} max={Math.min(10, clip.duration)} step={0.1} unit="s" onChange={(v) => edit((c) => { c.fadeIn = v; }, 'fin')} reset={0} />
        <Slider label="Fundido de salida" value={clip.fadeOut} min={0} max={Math.min(10, clip.duration)} step={0.1} unit="s" onChange={(v) => edit((c) => { c.fadeOut = v; }, 'fout')} reset={0} />
        {clip.type === 'video' && !clip.detached && <button className="btn wide" onClick={detachAudio}><Icon name="music" size={15} /> Separar audio del video</button>}
      </Section>
      <Section title="Voz con IA">
        <Toggle label="Mejorar voz (sonido de estudio)" value={!!fx.enhance} onChange={(v) => setFx('enhance', v)} />
        <div className="voice-grid stems">
          <button data-stem="voice" onClick={() => isolateVoice(clip.id, 'voice')}>Aislar voz</button>
          <button data-stem="music" onClick={() => isolateVoice(clip.id, 'music')}>Quitar voz</button>
          <button data-stem="both" onClick={() => isolateVoice(clip.id, 'both')}>Separar en 2 pistas</button>
        </div>
      </Section>
      <Section title="Ducking automático">
        <Toggle label="Bajar este audio cuando hay voz" value={clip.duck > 0} onChange={(v) => edit((c) => { c.duck = v ? 12 : 0; })} />
        {clip.duck > 0 && <Slider label="Cuánto bajar" value={clip.duck} min={3} max={30} unit="dB" onChange={(v) => edit((c) => { c.duck = v; }, 'duck')} reset={12} />}
      </Section>
      <Section title="Ritmo">
        <button className="btn wide beat-detect" onClick={() => detectBeats(clip.id)}><Icon name="music" size={15} /> Detectar ritmo{beats ? ` (${beats} beats)` : ''}</button>
        <Select label="Cortar cada" value={every} options={{ 1: '1 beat', 2: '2 beats', 4: '4 beats (compás)' }} onChange={setEvery} />
        <button className="btn wide beat-cut" disabled={!beats} onClick={() => cutToBeat(+every)}>Cortar al compás</button>
      </Section>
      <Section title="Cambiador de voz">
        <div className="voice-grid">
          {Object.entries(VOICES).map(([k, v]) => <button key={k} className={fx.voice === k ? 'active' : ''} onClick={() => setFx('voice', k)}>{v}</button>)}
        </div>
        <Slider label="Tono" value={fx.pitch} min={-12} max={12} unit="st" onChange={(v) => setFx('pitch', v)} reset={0} />
      </Section>
      <Section title="Mejorar audio">
        <Toggle label="Reducir ruido" value={fx.denoise} onChange={(v) => setFx('denoise', v)} />
        <Toggle label="Normalizar volumen" value={fx.normalize} onChange={(v) => setFx('normalize', v)} />
        <Slider label="Graves" value={fx.bass} min={-15} max={15} unit="dB" onChange={(v) => setFx('bass', v)} reset={0} />
        <Slider label="Agudos" value={fx.treble} min={-15} max={15} unit="dB" onChange={(v) => setFx('treble', v)} reset={0} />
      </Section>
    </>
  );
}

let fontCache = null;
function useFonts() {
  const [fonts, setFonts] = useState(fontCache || FONTS);
  useEffect(() => {
    if (fontCache || !window.queryLocalFonts) return;
    window.queryLocalFonts().then((list) => {
      fontCache = [...new Set([...FONTS, ...list.map((f) => f.family)])].sort((a, b) => a.localeCompare(b));
      setFonts(fontCache);
    }).catch(() => {});
  }, []);
  return fonts;
}

function TextTab({ clip, edit }) {
  const t = clip.text;
  const ref = useRef(null);
  const fonts = useFonts();
  const set = (k, v, key) => edit((c) => { c.text[k] = v; }, key);
  useEffect(() => {
    const f = () => ref.current && (ref.current.focus(), ref.current.select());
    window.addEventListener('velvix:focus-text', f);
    return () => window.removeEventListener('velvix:focus-text', f);
  }, []);
  return (
    <>
      <Section title="Contenido">
        <textarea ref={ref} rows={3} value={t.content} onChange={(e) => update((p) => { p.clips.find((c) => c.id === clip.id).text.content = e.target.value; }, 'txt-' + clip.id)} />
        {!clip.sticker && <button className="btn sm" onClick={() => addTTS(t.content, '', 0)}><Icon name="mic" size={14} /> Convertir a voz</button>}
      </Section>
      <Section title="Fuente">
        <label className="field select"><span>Familia</span>
          <select value={t.font} onChange={(e) => set('font', e.target.value)} style={{ fontFamily: t.font }}>
            {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
        </label>
        <Slider label="Tamaño" value={t.size} min={10} max={400} onChange={(v) => set('size', v, 'size')} />
        <Color label="Color" value={t.color} onChange={(v) => set('color', v)} />
        <div className="row-btns">
          <button className={`btn sm fmt ${t.bold ? 'active' : ''}`} onClick={() => set('bold', !t.bold)}><b>B</b></button>
          <button className={`btn sm fmt ${t.italic ? 'active' : ''}`} onClick={() => set('italic', !t.italic)}><i>I</i></button>
          <button className={`btn sm fmt ${t.underline ? 'active' : ''}`} onClick={() => set('underline', !t.underline)}><u>U</u></button>
          <button className={`btn sm fmt ${t.uppercase ? 'active' : ''}`} onClick={() => set('uppercase', !t.uppercase)}>AA</button>
          <span className="sep" />
          {['left', 'center', 'right'].map((a) => <button key={a} className={`btn sm fmt ${t.align === a ? 'active' : ''}`} onClick={() => set('align', a)}>{{ left: '⇤', center: '≡', right: '⇥' }[a]}</button>)}
        </div>
        <Slider label="Espaciado" value={t.letterSpacing} min={-10} max={40} onChange={(v) => set('letterSpacing', v, 'ls')} reset={0} />
        <Slider label="Interlineado" value={t.lineHeight} min={0.7} max={3} step={0.05} onChange={(v) => set('lineHeight', v, 'lh')} reset={1.15} />
        <Slider label="Ancho máximo" value={Math.round(t.maxWidth * 100)} min={10} max={100} unit="%" onChange={(v) => set('maxWidth', v / 100, 'mw')} reset={85} />
      </Section>
      {clip.caption && <button className="btn wide" onClick={() => applyToAll(clip.id, 'text')}>Aplicar estilo a todos los subtítulos</button>}
    </>
  );
}

function StyleTab({ clip, edit }) {
  const t = clip.text;
  const sub = (group, k, v, key) => edit((c) => { c.text[group] = { ...c.text[group], [k]: v }; }, key);
  const applyPreset = (p) => edit((c) => {
    const keep = { content: c.text.content, font: c.text.font, size: p.t.size || c.text.size };
    c.text = { ...c.text, ...structuredClone(p.t), ...keep };
    for (const k of ['stroke', 'shadow', 'bg', 'glow', 'gradient', 'highlight', 'keyword']) c.text[k] = { ...DEFAULT_TEXT[k], ...(p.t[k] || {}) };
    c.text.wordAnim = p.t.wordAnim || 'none';
  });
  return (
    <>
      <Section title="Plantillas">
        <div className="preset-grid sm">
          {TEXT_PRESETS.map((p, i) => <button key={i} className="preset" onClick={() => applyPreset(p)} title={p.name}><span style={presetStyle(p.t)}>Aa</span></button>)}
        </div>
      </Section>
      <Section title="Contorno" defaultOpen={t.stroke.on}>
        <Toggle label="Activar" value={t.stroke.on} onChange={(v) => sub('stroke', 'on', v)} />
        {t.stroke.on && <><Color label="Color" value={t.stroke.color} onChange={(v) => sub('stroke', 'color', v)} /><Slider label="Grosor" value={t.stroke.width} min={1} max={30} onChange={(v) => sub('stroke', 'width', v, 'sw')} /></>}
      </Section>
      <Section title="Sombra" defaultOpen={t.shadow.on}>
        <Toggle label="Activar" value={t.shadow.on} onChange={(v) => sub('shadow', 'on', v)} />
        {t.shadow.on && <>
          <Color label="Color" value={t.shadow.color} onChange={(v) => sub('shadow', 'color', v)} />
          <Slider label="Desenfoque" value={t.shadow.blur} min={0} max={60} onChange={(v) => sub('shadow', 'blur', v, 'shb')} />
          <Slider label="Distancia X" value={t.shadow.x} min={-40} max={40} onChange={(v) => sub('shadow', 'x', v, 'shx')} />
          <Slider label="Distancia Y" value={t.shadow.y} min={-40} max={40} onChange={(v) => sub('shadow', 'y', v, 'shy')} />
        </>}
      </Section>
      <Section title="Fondo" defaultOpen={t.bg.on}>
        <Toggle label="Activar" value={t.bg.on} onChange={(v) => sub('bg', 'on', v)} />
        {t.bg.on && <>
          <Color label="Color" value={t.bg.color} onChange={(v) => sub('bg', 'color', v)} />
          <Slider label="Opacidad" value={t.bg.opacity} min={0} max={100} unit="%" onChange={(v) => sub('bg', 'opacity', v, 'bgo')} />
          <Slider label="Redondeo" value={t.bg.radius} min={0} max={80} onChange={(v) => sub('bg', 'radius', v, 'bgr')} />
          <Slider label="Relleno" value={t.bg.pad} min={0} max={80} onChange={(v) => sub('bg', 'pad', v, 'bgp')} />
        </>}
      </Section>
      <Section title="Brillo (neón)" defaultOpen={t.glow.on}>
        <Toggle label="Activar" value={t.glow.on} onChange={(v) => sub('glow', 'on', v)} />
        {t.glow.on && <><Color label="Color" value={t.glow.color} onChange={(v) => sub('glow', 'color', v)} /><Slider label="Tamaño" value={t.glow.size} min={2} max={80} onChange={(v) => sub('glow', 'size', v, 'gs')} /></>}
      </Section>
      <Section title="Degradado" defaultOpen={t.gradient.on}>
        <Toggle label="Activar" value={t.gradient.on} onChange={(v) => sub('gradient', 'on', v)} />
        {t.gradient.on && <><Color label="Arriba" value={t.gradient.from} onChange={(v) => sub('gradient', 'from', v)} /><Color label="Abajo" value={t.gradient.to} onChange={(v) => sub('gradient', 'to', v)} /></>}
      </Section>
      <Section title="Resaltado karaoke" defaultOpen={t.highlight.on}>
        <Toggle label="Resaltar palabra actual" value={t.highlight.on} onChange={(v) => sub('highlight', 'on', v)} />
        {t.highlight.on && <Color label="Color" value={t.highlight.color} onChange={(v) => sub('highlight', 'color', v)} />}
      </Section>
      <Section title="Subtítulos dinámicos" defaultOpen={(t.wordAnim || 'none') !== 'none' || !!(t.keyword && t.keyword.on)}>
        <Select label="Animación por palabra" value={t.wordAnim || 'none'} options={WORD_ANIMS} onChange={(v) => edit((c) => { c.text.wordAnim = v; })} />
        <Toggle label="Resaltar palabras clave" value={!!(t.keyword && t.keyword.on)} onChange={(v) => edit((c) => { c.text.keyword = { ...DEFAULT_TEXT.keyword, ...c.text.keyword, on: v }; })} />
        {t.keyword && t.keyword.on && <Color label="Color" value={t.keyword.color} onChange={(v) => sub('keyword', 'color', v)} />}
      </Section>
    </>
  );
}

function EffectTab({ clip, edit }) {
  if (clip.filter) {
    const set = (k, v, key) => edit((c) => { c.filter[k] = v; }, key);
    return <><FilterControls f={clip.filter} set={set} clip={clip} edit={edit} /><ColorTab clip={clip} edit={edit} /></>;
  }
  return (
    <Section title="Efecto">
      <Select value={clip.effect.type} options={EFFECTS} onChange={(v) => edit((c) => { c.effect.type = v; c.name = v; })} />
      <Slider label="Intensidad" value={clip.effect.intensity} min={0} max={100} onChange={(v) => edit((c) => { c.effect.intensity = v; }, 'ei')} reset={50} />
      <p className="hint">Afecta a todas las capas debajo de la pista de efectos durante su duración.</p>
    </Section>
  );
}

function TransTab({ clip, edit }) {
  const tr = clip.transition;
  return (
    <Section title="Transición de entrada">
      <Select value={tr.type} options={TRANSITIONS} onChange={(v) => edit((c) => { c.transition.type = v; })} />
      <Slider label="Duración" value={tr.duration} min={0.1} max={Math.min(3, clip.duration)} step={0.05} unit="s" onChange={(v) => edit((c) => { c.transition.duration = v; }, 'td')} />
      <div className="row-btns">
        <button className="btn sm" onClick={() => update((p) => { const t = clip.transition; const m = p.tracks.find((x) => x.main); for (const c of p.clips) if (c.trackId === m.id && c.start > 0.01) c.transition = { ...t }; })}>Aplicar a todos los cortes</button>
        <button className="btn sm danger" onClick={() => edit((c) => { c.transition = null; })}>Quitar</button>
      </div>
    </Section>
  );
}
