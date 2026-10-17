import { useSyncExternalStore } from 'react';

// Tiny global store. Project edits go through update() so undo/redo and autosave see them.
let state = {
  view: 'home', // 'home' | 'editor'
  project: null,
  selection: [], // clip ids
  mediaSel: [], // media ids selected in the Medios panel (Supr removes them)
  time: 0,
  playing: false,
  zoom: 80, // px per second
  snap: true,
  magnet: true,
  past: [],
  future: [],
  toast: null,
  jobs: {}, // id → { label, progress }
};
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export const getState = () => state;
export function setState(patch) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  // Selecting clips takes the focus away from the media panel, so Supr deletes clips again.
  state = { ...state, ...(p.selection && p.selection.length && !('mediaSel' in p) ? { mediaSel: [] } : null), ...p };
  emit();
}
export const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const useStore = (sel) => useSyncExternalStore(subscribe, () => sel(state));

let lastKey = null, lastAt = 0;
// fn mutates a draft copy. `key` coalesces rapid edits (slider drags) into one undo step.
export function update(fn, key = null) {
  if (!state.project) return;
  const draft = structuredClone(state.project);
  fn(draft);
  const now = performance.now();
  const coalesce = key && key === lastKey && now - lastAt < 800;
  lastKey = key; lastAt = now;
  draft.updatedAt = Date.now();
  state = {
    ...state,
    project: draft,
    past: coalesce ? state.past : [...state.past.slice(-99), state.project],
    future: [],
  };
  emit();
}
export function undo() {
  if (!state.past.length) return;
  const prev = state.past[state.past.length - 1];
  state = { ...state, project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] };
  lastKey = null; emit();
}
export function redo() {
  if (!state.future.length) return;
  const [next, ...rest] = state.future;
  state = { ...state, project: next, past: [...state.past, state.project], future: rest };
  lastKey = null; emit();
}

export function toast(msg, kind = 'info') {
  setState({ toast: { msg, kind, id: Math.random() } });
  setTimeout(() => { if (state.toast && state.toast.msg === msg) setState({ toast: null }); }, 3500);
}

export function setJob(id, job) {
  const jobs = { ...state.jobs };
  if (job) jobs[id] = { ...(jobs[id] || {}), ...job }; else delete jobs[id];
  setState({ jobs });
}

// Autosave: debounce after any project change.
let saveTimer = null, lastSaved = null;
subscribe(() => {
  const p = state.project;
  if (!p || p === lastSaved) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { lastSaved = p; window.api.saveProject(p); }, 700);
});
export async function flushSave() {
  clearTimeout(saveTimer);
  if (state.project && state.project !== lastSaved) { lastSaved = state.project; await window.api.saveProject(state.project); }
}
window.addEventListener('beforeunload', () => { if (state.project && state.project !== lastSaved) window.api.saveProject(state.project); });
