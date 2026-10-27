import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import * as store from './store.js';
import * as actions from './editor/actions.js';
import * as captions from './editor/captions.js';
import * as transcript from './editor/transcript.js';
import * as model from './engine/model.js';
import * as sources from './engine/sources.js';
import * as render from './engine/render.js';
import * as audioai from './editor/audioai.js';
import * as gl from './engine/gl.js';
import * as vision from './editor/vision.js';
import * as animated from './engine/animated.js';
import * as library from './editor/library.js';
import * as multicam from './editor/multicam.js';
import './styles.css';

// Automation hook used by the end-to-end test script.
window.__velvix = { store, actions, captions, transcript, model, sources, render, audioai, gl, vision, animated, library, multicam };

// Uncaught errors and rejected promises: logged to error.log and shown once as a toast instead of failing silently.
let lastErr = '', lastErrAt = 0;
function reportError(e) {
  const msg = (e && (e.message || e.reason && e.reason.message)) || String(e || 'Error');
  if (/ResizeObserver loop|AbortError|play\(\) request was interrupted/.test(msg)) return; // benign browser noise
  window.api && window.api.logError && window.api.logError((e && e.stack) || msg);
  const now = Date.now();
  if (msg === lastErr && now - lastErrAt < 10000) return;
  lastErr = msg; lastErrAt = now;
  store.toast(`Algo falló: ${msg.slice(0, 120)}`, 'error');
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

createRoot(document.getElementById('root')).render(<App />);
