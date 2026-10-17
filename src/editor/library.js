// Free music and sound effects library (#25). Only CC0 / public-domain material, never copyrighted music:
// - recorded music and effects from Wikimedia Commons, each file checked as "CC0" there (author and page shown);
//   downloaded once on demand to %APPDATA%/Velvix Studio/library, then usable offline;
// - effects synthesized here (whoosh, pop, riser…): our own, so CC0 too, generated offline in a moment.
import { getState, setJob, toast } from '../store.js';
import { uid } from '../engine/model.js';
import { importPaths, addToTimeline } from './actions.js';

const api = window.api;
export const LIB_CATS = {
  music: { happy: 'Alegre', chill: 'Relajada', epic: 'Épica / acción', emotional: 'Emotiva', dark: 'Suspenso', fun: 'Divertida' },
  sfx: { synth: 'Transiciones y UI', people: 'Personas', ui: 'Pitidos y clics', objects: 'Objetos', music: 'Golpes musicales' },
};
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';
// [kind, category, name, author, seconds, KB, path on upload.wikimedia.org] — all CC0 on Commons (checked oct 2026).
const ROWS = [
  ["music", "happy", "Sunglasses", "Loyalty Freak Music", 170, 3881, "c/cc/Loyalty_Freak_Music_-_01_-_Sunglasses.ogg"],
  ["music", "happy", "Can't Stop My Feet", "Loyalty Freak Music", 186, 3894, "2/22/Loyalty_Freak_Music_-_04_-_Cant_Stop_My_Feet_.ogg"],
  ["music", "happy", "Yippee", "Loyalty Freak Music", 130, 3051, "1/17/Loyalty_Freak_Music_-_08_-_Yippee_.ogg"],
  ["music", "happy", "Go to the Picnic", "Loyalty Freak Music", 187, 3741, "0/0c/Loyalty_Freak_Music_-_01_-_Go_to_the_Picnic.ogg"],
  ["music", "happy", "Grab a Partner", "Loyalty Freak Music", 192, 3983, "8/8c/Loyalty_Freak_Music_-_05_-_Grab_A_Partner.ogg"],
  ["music", "happy", "Skate", "Komiku", 48, 925, "6/6e/Komiku_-_04_-_Skate.opus"],
  ["music", "happy", "Surfing", "Komiku", 99, 2365, "f/f6/Komiku_-_08_-_Surfing.ogg"],
  ["music", "happy", "Beach", "Komiku", 64, 635, "0/0b/Komiku_-_05_-_Beach.ogg"],
  ["music", "chill", "Chillin' at the Club", "Loyalty Freak Music", 223, 4695, "c/c2/Loyalty_Freak_Music_-_03_-_Chillin_with_a_drink_at_the_club.ogg"],
  ["music", "chill", "Take a Break", "Loyalty Freak Music", 126, 2428, "d/dc/Loyalty_Freak_Music_-_06_-_Take_A_Break.ogg"],
  ["music", "chill", "Softly", "Loyalty Freak Music", 262, 4381, "0/0b/Loyalty_Freak_Music_-_06_-_Softly.ogg"],
  ["music", "chill", "Chillin Poupi", "Komiku", 40, 948, "b/bf/Komiku_-_50_-_Chillin_Poupi.ogg"],
  ["music", "chill", "Tea with Granma", "Komiku", 79, 1402, "3/33/Komiku_-_56_-_Tea_with_Granma.ogg"],
  ["music", "chill", "Home", "Komiku", 66, 1234, "3/3c/Komiku_-_02_-_Home.ogg"],
  ["music", "epic", "Battle Theme", "Komiku", 165, 3372, "1/14/Komiku_-_13_-_Battle_Theme.ogg"],
  ["music", "epic", "Ultimate Power", "Komiku", 145, 3332, "8/82/Komiku_-_25_-_Ultimate_Power.ogg"],
  ["music", "epic", "Action Hit", "Komiku", 26, 452, "0/03/Komiku_-_07_-_Action_Hit.ogg"],
  ["music", "epic", "Action Discovery", "Komiku", 100, 1529, "b/be/Komiku_-_12_-_Action_Discovery.ogg"],
  ["music", "epic", "I'm on Fire", "Loyalty Freak Music", 185, 4050, "b/bc/Loyalty_Freak_Music_-_03_-_IM_ON_FIRE.ogg"],
  ["music", "emotional", "Ambiant Hope", "Komiku", 289, 4824, "e/ef/Komiku_-_10_-_Ambiant_Hope.ogg"],
  ["music", "emotional", "Childhood Scene", "Komiku", 140, 2227, "b/bc/Komiku_-_01_-_Childhood_scene.ogg"],
  ["music", "emotional", "Hope and Love", "Loyalty Freak Music", 262, 5222, "9/97/Loyalty_Freak_Music_-_16_-_Hope_and_Love.ogg"],
  ["music", "emotional", "Once More with You", "Loyalty Freak Music", 183, 3446, "4/4f/Loyalty_Freak_Music_-_01_-_Once_more_with_you.ogg"],
  ["music", "dark", "Tension", "Komiku", 201, 3805, "d/df/Komiku_-_12_-_Tension.ogg"],
  ["music", "dark", "Ambiant Shock", "Komiku", 164, 2729, "c/c7/Komiku_-_05_-_Ambiant_Shock.ogg"],
  ["music", "dark", "A Really Dark Alley", "Loyalty Freak Music", 255, 4785, "d/d2/Loyalty_Freak_Music_-_07_-_A_really_dark_alley.ogg"],
  ["music", "dark", "The Graveyard", "Loyalty Freak Music", 220, 4009, "0/07/Loyalty_Freak_Music_-_06_-_The_graveyard.ogg"],
  ["music", "fun", "Monster Parade", "Loyalty Freak Music", 110, 2395, "1/1b/Loyalty_Freak_Music_-_01_-_Monster_Parade.ogg"],
  ["music", "fun", "Glouglou", "Komiku", 74, 1272, "5/5a/Komiku_-_09_-_Glouglou.ogg"],
  ["music", "fun", "Mushrooms", "Komiku", 62, 1097, "5/59/Komiku_-_03_-_Mushrooms.ogg"],
  ["sfx", "people", "Aplausos", "Sandermotions", 6, 1185, "6/6d/277021_sandermotions_applause-2.wav"],
  ["sfx", "people", "Risa de caricatura", "JohnsonBrandEditing", 19, 316, "c/cb/Cartoon_Laugh.ogg"],
  ["sfx", "people", "Risa malvada", "freesound", 11, 230, "4/48/Evil_laugh.ogg"],
  ["sfx", "people", "Risa de payaso", "scotcampbell", 6, 226, "0/02/Scotcampbell_-_clown_laugh_(cc0)_(freesound).mp3"],
  ["sfx", "ui", "Clic de ratón", "Darklanlan", 1, 13, "2/26/Computer_mouse_single_click.ogg"],
  ["sfx", "ui", "Bip alegre", "waveplaySFX", 1, 21, "0/08/Simple_Happy_Beep.ogg"],
  ["sfx", "ui", "Monitor cardíaco", "samfk360", 28, 158, "8/81/Heart_Monitor_Beep--freesound.org.oga"],
  ["sfx", "objects", "Cámara de fotos", "Polecatz", 5, 1312, "4/49/261007_polecatz_camera-canon-5d-iii.wav"],
  ["sfx", "objects", "Teclado escribiendo", "Raymangold22", 12, 165, "0/0a/Typing_-_Model_M_1986.ogg"],
  ["sfx", "objects", "Campanilla de máquina de escribir", "_stubb", 1, 151, "9/9f/406243_stubb_typewriter-ding-near-mono.wav"],
  ["sfx", "objects", "Timbre de bicicleta", "marcolo91", 1, 95, "9/97/156064_marcolo91_bicycle-bell.wav"],
  ["sfx", "objects", "Crujir de nudillos", "pwausc1", 7, 111, "a/a8/Knuckle_crack.ogg"],
  ["sfx", "music", "Ba dum tss (chiste)", "eggsandwichent", 16, 240, "d/df/Ba_dum_bum_stings.ogg"],
  ["sfx", "music", "Redoble de tambor", "Iwan Sounds and DIY", 4, 74, "c/c4/Drum_Roll_Intro.ogg"],
  ["sfx", "music", "Braam (tráiler)", "Unfa", 10, 440, "1/1c/647712_unfa_braam.flac"],
  ["sfx", "music", "Golpe de metales", "rrreed", 1, 9, "7/7b/Horn_stab.mp3"],
  ["sfx", "music", "Victoria (jingle)", "Komiku", 2, 45, "3/35/Komiku_-_11_-_WIN.ogg"],
  ["sfx", "music", "Gong", "the_very_Real_Horst", 29, 5020, "1/16/240382_the-very-real-horst_chinese-gong-finish-session-2014-06-10-29-143.wav"],
];
export const LIBRARY = ROWS.map(([kind, cat, name, author, dur, kb, file]) => ({
  id: 'c-' + file.split('/').pop().replace(/\.[^.]+$/, '').replace(/[^\w]+/g, '_').slice(0, 60).toLowerCase(),
  kind, cat, name, author, dur, kb, license: 'CC0',
  url: COMMONS + file.split('/').map(encodeURIComponent).join('/'), page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.split('/').pop()),
  ext: file.split('.').pop().toLowerCase(),
}));

// ---------- synthesized effects (mono 44.1 kHz, deterministic) ----------
const RATE = 44100;
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
// Resonant band-pass (RBJ biquad) whose center frequency can change every sample.
function bandpass(input, freqAt, q) {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const w = (2 * Math.PI * Math.min(freqAt(i / RATE), RATE * 0.45)) / RATE, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - al) / a0, x = input[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
  }
  return out;
}
const buf = (sec, fn) => { const n = Math.round(sec * RATE), b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = fn(i / RATE, i); return b; };
const noise = (sec, seed = 1) => { const r = rng(seed); return buf(sec, () => r()); };
const tone = (f, t) => Math.sin(2 * Math.PI * f * t);
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
function normalize(b, peak = 0.89) { let m = 0; for (const v of b) m = Math.max(m, Math.abs(v)); if (m) for (let i = 0; i < b.length; i++) b[i] *= peak / m; return b; }
// Notes [freq, start, length]: soft attack, exponential release (wave: sine | square | triangle).
function notes(list, wave = 'sine', decay = 0.15) {
  const total = Math.max(...list.map(([, s, l]) => s + l)) + decay * 4;
  const w = { sine: (p) => Math.sin(p), square: (p) => (Math.sin(p) >= 0 ? 0.6 : -0.6), triangle: (p) => (2 / Math.PI) * Math.asin(Math.sin(p)) }[wave];
  return buf(total, (t) => list.reduce((a, [f, s, l]) => (t < s ? a : a + w(2 * Math.PI * f * (t - s)) * (t < s + l ? Math.min(1, (t - s) / 0.004) : Math.exp(-(t - s - l) / decay))), 0));
}
const SYNTH = {
  whoosh: ['Whoosh', () => { const d = 0.8, b = bandpass(noise(d, 7), (t) => 250 * Math.pow(14, Math.sin((Math.PI * t) / d)), 1.6); return b.map((v, i) => v * Math.pow(Math.sin((Math.PI * i) / RATE / d), 2)); }],
  swoosh: ['Swoosh rápido', () => { const d = 0.35, b = bandpass(noise(d, 9), (t) => 900 + 5000 * (t / d), 2.2); return b.map((v, i) => v * Math.sin((Math.PI * i) / RATE / d)); }],
  riser: ['Subida (riser)', () => { const d = 2.6, b = bandpass(noise(d, 3), (t) => 200 * Math.pow(30, t / d), 3); return b.map((v, i) => { const t = i / RATE; return (v * 0.7 + tone(110 * Math.pow(8, t / d), t) * 0.25) * Math.pow(t / d, 1.6) * Math.min(1, (d - t) / 0.02); }); }],
  impact: ['Impacto (boom)', () => { const r = rng(5); return buf(1.6, (t) => tone(70 * Math.exp(-t * 2) + 38, t) * Math.exp(-t / 0.45) + r() * Math.exp(-t / 0.05) * 0.6); }],
  pop: ['Pop', () => buf(0.18, (t) => tone(900 * Math.exp(-t * 28) + 180, t) * env(t, 0.002, 0.04))],
  bubble: ['Burbuja', () => buf(0.16, (t) => tone(300 + 104000 * t * t, t) * env(t, 0.003, 0.05))],
  click: ['Clic suave', () => { const r = rng(2); return buf(0.05, (t) => (r() * 0.5 + tone(2400, t)) * Math.exp(-t / 0.006)); }],
  ding: ['Ding', () => buf(1.8, (t) => (tone(1320, t) + 0.35 * tone(2640, t) + 0.15 * tone(3960, t)) * env(t, 0.003, 0.45))],
  notify: ['Notificación', () => notes([[880, 0, 0.09], [1320, 0.12, 0.12]], 'sine', 0.12)],
  coin: ['Moneda', () => notes([[988, 0, 0.07], [1319, 0.07, 0.3]], 'square', 0.08)],
  levelup: ['Subir de nivel', () => notes([[523, 0, 0.08], [659, 0.09, 0.08], [784, 0.18, 0.08], [1047, 0.27, 0.25]], 'triangle', 0.12)],
  error: ['Error', () => notes([[233, 0, 0.14], [185, 0.17, 0.25]], 'square', 0.06)],
  beep: ['Pitido de censura', () => buf(0.7, (t) => tone(1000, t) * Math.min(1, t / 0.005, (0.7 - t) / 0.005))],
  glitch: ['Glitch', () => { const r = rng(11); let hold = 0, v = 0; return buf(0.6, (t, i) => { if (i >= hold) { hold = i + Math.floor(40 + (r() + 1) * 600); v = r() > -0.6 ? Math.round(r() * 3) / 3 : 0; } return v * (Math.floor(i / (8 + Math.abs(v) * 30)) % 2 ? 1 : -1) * 0.8; }); }],
  ticktock: ['Tic tac (reloj)', () => { const r = rng(4); return buf(4, (t) => { const k = t % 0.5; return (r() * 0.4 + tone(Math.floor(t * 2) % 2 ? 1800 : 2600, k)) * Math.exp(-k / 0.008); }); }],
  heartbeat: ['Latido', () => buf(2.4, (t) => { const k = t % 1.2; return tone(55, k) * (Math.exp(-Math.pow((k - 0.05) / 0.035, 2)) + 0.7 * Math.exp(-Math.pow((k - 0.32) / 0.035, 2))); })],
};
export const SYNTH_LIST = Object.entries(SYNTH).map(([k, [name]]) => ({ id: 's-' + k, kind: 'sfx', cat: 'synth', name, author: 'Velvix Studio (generado)', license: 'CC0', synth: k }));
export const ALL = [...SYNTH_LIST, ...LIBRARY];
export const libSize = (kind) => LIBRARY.filter((x) => !kind || x.kind === kind).reduce((a, x) => a + x.kb, 0) / 1024; // MB

// Local file of an item (downloaded or synthesized the first time).
export async function libFile(item, jobId) {
  if (item.synth) {
    const cached = await api.cachePath(`lib-${item.synth}`);
    return (await api.fileExists(cached)) ? cached : api.saveWav(`lib-${item.synth}`, [normalize(SYNTH[item.synth][1]())], RATE);
  }
  return api.libraryGet({ id: item.id, url: item.url, ext: item.ext }, jobId);
}
// Ids of the downloadable items already on disk (synthesized ones are always available).
export const libDownloaded = (items) => api.libraryHas(items.filter((x) => !x.synth).map((x) => ({ id: x.id, ext: x.ext })));

export async function addFromLibrary(item) {
  const jobId = uid();
  setJob(jobId, { label: `${item.synth ? 'Generando' : 'Descargando'} ${item.name}`, progress: item.synth ? null : 0 });
  const off = api.onJobProgress((d) => d.jobId === jobId && setJob(jobId, { progress: d.progress }));
  try {
    const path = await libFile(item, jobId);
    const [m] = await importPaths([path]);
    if (!m) return null;
    const id = addToTimeline(m, { at: getState().time });
    toast(`«${item.name}» agregado (${item.license}, ${item.author})`);
    return id;
  } catch (e) { toast(`No se pudo descargar «${item.name}»: ${e.message}`, 'error'); return null; }
  finally { off(); setJob(jobId, null); }
}

// Whole pack for offline use (music, effects or both).
export async function downloadAll(kind) {
  const items = LIBRARY.filter((x) => !kind || x.kind === kind), have = new Set(await libDownloaded(items)), todo = items.filter((x) => !have.has(x.id));
  const jobId = uid();
  let failed = 0;
  for (const [i, it] of todo.entries()) {
    setJob(jobId, { label: `Descargando biblioteca ${i + 1}/${todo.length}`, progress: i / todo.length });
    await libFile(it).catch(() => { failed++; });
  }
  setJob(jobId, null);
  toast(failed ? `${failed} archivos no se pudieron descargar` : `Biblioteca descargada (${todo.length} archivos)`, failed ? 'error' : 'info');
  return todo.length - failed;
}
