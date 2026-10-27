import React, { useState } from 'react';

const P = {
  play: 'M7 4.5v15l12-7.5z', pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11', redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  chevron: 'm6 9 6 6 6-6',
  trimLeft: 'M13 3v18M13 7h7v10h-7M3.5 9.5l5 5M8.5 9.5l-5 5', trimRight: 'M11 3v18M11 7H4v10h7M15.5 9.5l5 5M20.5 9.5l-5 5',
  split: 'M6 3v18M18 3v18M6 12h12M10 8l-4 4 4 4M14 8l4 4-4 4', trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1', snow: 'M12 2v20M4.9 7l14.2 10M4.9 17 19.1 7M9 4l3 2 3-2M9 20l3-2 3 2',
  reverse: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  magnet: 'M6 15a6 6 0 0 0 12 0V4h-4v11a2 2 0 0 1-4 0V4H6zM6 8h4M14 8h4', link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M11 8v6M8 11h6', zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6',
  plus: 'M12 5v14M5 12h14', film: 'M3 3h18v18H3zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18',
  type: 'M4 7V4h16v3M9 20h6M12 4v16', smile: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  sparkles: 'M12 3l1.9 5.8L20 10.7l-6.1 1.9L12 18l-1.9-5.4L4 10.7l6.1-1.9zM19 3v4M17 5h4M5 17v4M3 19h4',
  transition: 'M3 7h13l-3-3M21 17H8l3 3', sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  cc: 'M3 5h18v14H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3', download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.3 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14', mute: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  min: 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5', max: 'M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5', camera: 'M3 7h4l2-3h6l2 3h4v13H3zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  diamond: 'M12 2 22 12 12 22 2 12z', mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  back: 'M15 18l-6-6 6-6', x: 'M18 6 6 18M6 6l12 12', check: 'M5 12l5 5L20 7', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14', marker: 'M6 3h12v18l-6-5-6 5z', crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21', wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
  speed: 'M12 14l4-4M3.3 19A10 10 0 1 1 20.7 19', more: 'M5 12h.01M12 12h.01M19 12h.01', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  keyboard: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10', layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  stepBack: 'M19 20 9 12l10-8zM5 19V5', stepFwd: 'M5 4l10 8-10 8zM19 5v14',
};

export function Icon({ name, size = 18, stroke = 1.8, fill = false, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d={P[name] || ''} />
    </svg>
  );
}

// Error boundary: a panel that throws while rendering shows a retry box instead of blanking the whole app.
export class Safe extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error(`[${this.props.name}]`, error, info && info.componentStack); window.api && window.api.logError && window.api.logError(`${this.props.name}: ${error && error.stack}`); }
  // A new project (an undo, any edit) retries on its own.
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className={`safe-err ${this.props.className || ''}`} role="alert">
        <b>{this.props.name} tuvo un error</b>
        <span>{String(this.state.error.message || this.state.error).slice(0, 160)}</span>
        <span>Deshaz el último cambio (Ctrl+Z) o reintenta.</span>
        <button className="btn" onClick={() => this.setState({ error: null })}>Reintentar</button>
      </div>
    );
  }
}

export function IconBtn({ icon, title, onClick, active, disabled, size = 18, className = '' }) {
  return (
    <button className={`icon-btn ${active ? 'active' : ''} ${className}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={size} />
    </button>
  );
}

// Slider + numeric field. onChange gets numbers.
export function Slider({ label, value, min, max, step = 1, onChange, unit = '', fmt, reset }) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <div className="field slider">
      <div className="field-head">
        <label onDoubleClick={() => reset != null && onChange(reset)} title={reset != null ? 'Doble clic para restablecer' : undefined}>{label}</label>
        <span className="num">
          <input type="number" value={fmt ? fmt(v) : Math.round(v * 100) / 100} step={step} min={min} max={max}
            onChange={(e) => e.target.value !== '' && onChange(Math.min(max, Math.max(min, +e.target.value)))} />
          {unit && <em>{unit}</em>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => onChange(+e.target.value)}
        style={{ '--p': `${((v - min) / (max - min)) * 100}%` }} />
    </div>
  );
}

export function Toggle({ label, value, onChange }) {
  return (
    <label className="field toggle">
      <span>{label}</span>
      <button role="switch" aria-checked={!!value} className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)}><i /></button>
    </label>
  );
}

export function Select({ label, value, options, onChange }) {
  return (
    <label className="field select">
      {label && <span>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}

export function Color({ label, value, onChange }) {
  const hex = (value || '#000000').slice(0, 7);
  return (
    <label className="field color">
      <span>{label}</span>
      <span className="color-wrap"><input type="color" value={hex} onChange={(e) => onChange(e.target.value + (value && value.length === 9 ? value.slice(7) : ''))} /><code>{hex}</code></span>
    </label>
  );
}

export function Section({ title, children, defaultOpen = true, right }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header onClick={() => setOpen(!open)}>
        <span className="chev">›</span><h4>{title}</h4>
        {right && <span className="sec-right" onClick={(e) => e.stopPropagation()}>{right}</span>}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {Object.entries(tabs).map(([k, v]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{v}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        <header><h3>{title}</h3><IconBtn icon="x" title="Cerrar" onClick={onClose} /></header>
        {children}
      </div>
    </div>
  );
}
