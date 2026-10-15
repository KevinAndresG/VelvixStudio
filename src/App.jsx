import React from 'react';
import { useStore } from './store.js';
import Home from './home/Home.jsx';
import Editor from './editor/Editor.jsx';
import { Icon } from './ui.jsx';

export default function App() {
  const view = useStore((s) => s.view);
  const t = useStore((s) => s.toast);
  return (
    <>
      {view === 'home' ? <Home /> : <Editor />}
      {t && <div key={t.id} className={`toast ${t.kind}`} role="status"><Icon name={t.kind === 'error' ? 'x' : 'check'} size={16} />{t.msg}</div>}
    </>
  );
}
