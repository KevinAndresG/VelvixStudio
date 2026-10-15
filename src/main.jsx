import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import * as store from './store.js';
import * as actions from './editor/actions.js';
import * as captions from './editor/captions.js';
import * as sources from './engine/sources.js';
import * as render from './engine/render.js';
import './styles.css';

// Automation hook used by the end-to-end test script.
window.__velvix = { store, actions, captions, sources, render };

createRoot(document.getElementById('root')).render(<App />);
