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
import './styles.css';

// Automation hook used by the end-to-end test script.
window.__velvix = { store, actions, captions, transcript, model, sources, render, audioai, gl };

createRoot(document.getElementById('root')).render(<App />);
