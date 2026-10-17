const { app, BrowserWindow, ipcMain, dialog, protocol, shell, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const { Readable } = require('stream');

const unpacked = (p) => p.replace('app.asar', 'app.asar.unpacked');
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);
const DEV = !!process.env.VITE_DEV;

const DATA = app.getPath('userData');
const PROJECTS = path.join(DATA, 'projects');
const CACHE = path.join(DATA, 'cache');
const MODELS = path.join(DATA, 'models');
const BACKUPS = path.join(PROJECTS, 'backups');
const BRAND = path.join(DATA, 'brand');
const LUTS = path.join(DATA, 'luts');
for (const d of [PROJECTS, CACHE, MODELS, BACKUPS, BRAND, LUTS]) fs.mkdirSync(d, { recursive: true });
// Open project of the running session: still there on start = the app didn't close cleanly.
const SESSION = path.join(DATA, 'session.json');
const readSession = () => { try { return JSON.parse(fs.readFileSync(SESSION, 'utf8')); } catch { return null; } };
let crashed = readSession();

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/webm', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};
const mimeOf = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

// Serves a local file with HTTP Range support so <video> can seek.
async function serveFile(file, req) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return new Response('not found', { status: 404 }); }
  const headers = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  const range = req.headers.get('range');
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? Math.min(+m[2], stat.size - 1) : stat.size - 1;
    if (start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
}

// Local media server: Chromium only seeks <video> reliably over real HTTP. Bound to loopback with a random token.
const TOKEN = crypto.randomBytes(16).toString('hex');
let mediaBase = '';
const mediaServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const prefix = `/${TOKEN}/`;
  if (!u.pathname.startsWith(prefix)) { res.writeHead(403); return res.end(); }
  const file = decodeURIComponent(u.pathname.slice(prefix.length));
  let stat;
  try { stat = await fsp.stat(file); } catch { res.writeHead(404); return res.end(); }
  const headers = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
  const m = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (m) {
    const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], stat.size - 1) : stat.size - 1;
    if (start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
});
ipcMain.on('media:base', (e) => { e.returnValue = mediaBase; });

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 680,
    backgroundColor: '#0e0f13', title: 'Velvix Studio', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL(DEV ? 'http://localhost:5173' : 'app://bundle/index.html');
  // Block navigation away from the app and open external links in the browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://') && !url.startsWith('http://localhost:5173')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // Renderer crash (GPU/out of memory): reload and offer the autosaved project.
  win.webContents.on('render-process-gone', (_e, d) => { if (d.reason !== 'clean-exit') { crashed = readSession(); win.reload(); } });
}
ipcMain.handle('session:crashed', () => { const c = crashed; crashed = null; return c; });
ipcMain.handle('session:set', (_e, id) => (id ? fsp.writeFile(SESSION, JSON.stringify({ projectId: id, at: Date.now() })) : fsp.rm(SESSION, { force: true })));
app.on('before-quit', () => { try { fs.rmSync(SESSION, { force: true }); } catch { /* ignore */ } });

app.whenReady().then(async () => {
  await new Promise((r) => mediaServer.listen(0, '127.0.0.1', r));
  mediaBase = `http://127.0.0.1:${mediaServer.address().port}/${TOKEN}/`;
  Menu.setApplicationMenu(null);
  const dist = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(dist, p));
    if (!file.startsWith(dist)) return new Response('forbidden', { status: 403 });
    return serveFile(file, req);
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['local-fonts', 'clipboard-sanitized-write', 'media'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['local-fonts', 'clipboard-sanitized-write'].includes(perm));
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- helpers ----------
function run(bin, args, { onStderr, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, cwd });
    const out = []; let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-10000); onStderr && onStderr(String(d)); });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.split('\n').slice(-6).join('\n'))));
  });
}
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const exists = (p) => fsp.access(p).then(() => true, () => false);
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const timeOf = (line) => { const m = /time=(\d+):(\d+):([\d.]+)/.exec(line); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null; };

// ---------- dialogs / shell ----------
const MEDIA_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'wmv', 'flv', '3gp', 'mts', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'json'];
ipcMain.handle('dialog:openMedia', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Multimedia', extensions: MEDIA_EXT }] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:save', async (_e, { defaultPath, filters }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath, filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('shell:show', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));
ipcMain.handle('file:write', async (_e, p, buf) => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.from(buf)); });
ipcMain.handle('file:read', (_e, p) => fsp.readFile(p, 'utf8'));
ipcMain.handle('dialog:openFile', async (_e, filters) => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('file:exists', (_e, p) => exists(p));
// Identity of a file's content for cache keys (same path, new content → new key).
const fileTag = async (p) => { const st = await fsp.stat(p); return `${st.size}-${Math.round(st.mtimeMs)}`; };
ipcMain.handle('file:tag', (_e, p) => fileTag(p));
ipcMain.handle('app:paths', () => ({ videos: app.getPath('videos'), data: DATA }));

// ---------- projects ----------
const projFile = (id) => path.join(PROJECTS, `${id.replace(/[^\w-]/g, '')}.json`);
ipcMain.handle('projects:list', async () => {
  const files = (await fsp.readdir(PROJECTS)).filter((f) => f.endsWith('.json'));
  const list = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await fsp.readFile(path.join(PROJECTS, f), 'utf8'));
      const dur = Math.max(0, ...p.clips.map((c) => c.start + c.duration));
      list.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, width: p.width, height: p.height, duration: dur, thumb: p.thumb || null });
    } catch { /* skip corrupt */ }
  }
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
});
ipcMain.handle('projects:load', async (_e, id) => JSON.parse(await fsp.readFile(projFile(id), 'utf8')));
ipcMain.handle('projects:save', async (_e, project) => {
  // Write to temp then rename so a crash never leaves a half-written project.
  const f = projFile(project.id);
  await fsp.writeFile(f + '.tmp', JSON.stringify(project));
  await fsp.rename(f + '.tmp', f);
  // Version history: at most one copy every 5 min while editing.
  if (Date.now() - (lastBackup.get(project.id) || 0) > 5 * 60e3) await snapshot(project.id);
  return true;
});
ipcMain.handle('projects:delete', async (_e, id) => {
  await fsp.rm(projFile(id), { force: true });
  await fsp.rm(backupDir(id), { recursive: true, force: true });
  await fsp.rm(path.join(DATA, 'imported', id.replace(/[^\w-]/g, '')), { recursive: true, force: true }); // media of an imported package
});

// ---------- version history ----------
const lastBackup = new Map();
const backupDir = (id) => path.join(BACKUPS, id.replace(/[^\w-]/g, ''));
async function snapshot(id) {
  if (!(await exists(projFile(id)))) return null;
  const dir = backupDir(id), now = Date.now();
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(projFile(id), path.join(dir, `${now}.json`));
  lastBackup.set(id, now);
  const old = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).sort((a, b) => parseInt(b) - parseInt(a)).slice(30);
  for (const f of old) await fsp.rm(path.join(dir, f), { force: true });
  return now;
}
ipcMain.handle('projects:snapshot', (_e, id) => snapshot(id));
ipcMain.handle('projects:versions', async (_e, id) => {
  const dir = backupDir(id), out = [];
  for (const f of (await fsp.readdir(dir).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    try {
      const p = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      out.push({ at: parseInt(f), clips: p.clips.length, duration: Math.max(0, ...p.clips.map((c) => c.start + c.duration)), name: p.name });
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.at - a.at);
});
// Restores a version as the current project (the current state is kept as a version first).
ipcMain.handle('projects:restore', async (_e, id, at) => {
  const src = path.join(backupDir(id), `${Math.floor(at)}.json`);
  const p = JSON.parse(await fsp.readFile(src, 'utf8'));
  await snapshot(id);
  p.updatedAt = Date.now();
  await fsp.writeFile(projFile(id) + '.tmp', JSON.stringify(p));
  await fsp.rename(projFile(id) + '.tmp', projFile(id));
  return p;
});

// ---------- portable package (.velvix): magic, header length, JSON header, then the files back to back ----------
const MAGIC = Buffer.from('VELVIXP1');
// Every stored file path (matte.src / alt.base name a media file: remapped too, so they stay valid after import).
const pathFields = (p) => [...p.media.flatMap((m) => ['path', 'proxy', 'reversed', 'thumb', 'strip'].map((k) => [m, k])), ...p.clips.map((c) => [c, 'fxPath']), ...p.clips.filter((c) => c.filter).map((c) => [c.filter, 'lut']),
  ...p.clips.filter((c) => c.matte).flatMap((c) => [[c.matte, 'path'], [c.matte, 'src']]),
  ...p.clips.filter((c) => c.alt).flatMap((c) => [[c.alt, 'path'], [c.alt, 'base'], ...(c.alt.up ? [[c.alt.up, 'path']] : []), ...(c.alt.stab ? [[c.alt.stab, 'path']] : [])]), [p, 'thumb']];
ipcMain.handle('package:export', async (_e, id, out) => {
  const p = JSON.parse(await fsp.readFile(projFile(id), 'utf8'));
  const files = [], index = new Map();
  for (const [o, k] of pathFields(p)) {
    const f = o[k];
    if (!f || index.has(f)) continue;
    const st = await fsp.stat(f).catch(() => null);
    if (!st || !st.isFile()) continue;
    index.set(f, files.length);
    files.push({ src: f, name: path.basename(f), size: st.size });
  }
  const header = Buffer.from(JSON.stringify({ project: p, files: files.map(({ src, name, size }) => ({ src, name, size })) }));
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(header.length));
  const fh = await fsp.open(out + '.part', 'w');
  try {
    await fh.write(Buffer.concat([MAGIC, len, header]));
    for (const f of files) for await (const chunk of fs.createReadStream(f.src)) await fh.write(chunk);
  } finally { await fh.close(); }
  await fsp.rename(out + '.part', out);
  return { files: files.length, bytes: files.reduce((a, f) => a + f.size, 0) };
});
ipcMain.handle('package:import', async (_e, file) => {
  const fh = await fsp.open(file, 'r');
  let header, pos;
  try {
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    if (!head.subarray(0, 8).equals(MAGIC)) throw new Error('No es un paquete de Velvix Studio');
    const n = Number(head.readBigUInt64LE(8)), hb = Buffer.alloc(n);
    await fh.read(hb, 0, n, 16);
    header = JSON.parse(hb.toString('utf8')); pos = 16 + n;
  } finally { await fh.close(); }
  const p = header.project, id = crypto.randomBytes(6).toString('hex'), dir = path.join(DATA, 'imported', id), map = new Map();
  await fsp.mkdir(dir, { recursive: true });
  for (const [i, f] of header.files.entries()) {
    if (!Number.isSafeInteger(f.size) || f.size < 0 || typeof f.name !== 'string') throw new Error('Paquete dañado');
    const dst = path.join(dir, `${i}-${f.name.replace(/[<>:"/\\|?*]+/g, '_')}`);
    if (f.size) await new Promise((res, rej) => fs.createReadStream(file, { start: pos, end: pos + f.size - 1 }).on('error', rej).pipe(fs.createWriteStream(dst)).on('finish', res).on('error', rej));
    else await fsp.writeFile(dst, '');
    pos += f.size; map.set(f.src, dst);
  }
  // Only paths extracted from the package are kept: a crafted package must not point at other local or network (UNC) files.
  for (const [o, k] of pathFields(p)) if (o[k]) o[k] = map.get(o[k]) || (k === 'path' ? '' : null);
  Object.assign(p, { id, createdAt: Date.now(), updatedAt: Date.now() });
  await fsp.writeFile(projFile(id), JSON.stringify(p));
  return id;
});

// ---------- project templates saved by the user (Sesión 7): { id, name, createdAt, thumb, project } ----------
const TEMPLATES = path.join(DATA, 'templates');
fs.mkdirSync(TEMPLATES, { recursive: true });
const tplFile = (id) => path.join(TEMPLATES, `${String(id).replace(/[^\w-]/g, '')}.json`);
ipcMain.handle('templates:list', async () => {
  const out = [];
  for (const f of (await fsp.readdir(TEMPLATES)).filter((x) => x.endsWith('.json'))) {
    try { const t = JSON.parse(await fsp.readFile(path.join(TEMPLATES, f), 'utf8')); out.push(t); } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
});
ipcMain.handle('templates:save', async (_e, t, thumb) => {
  if (thumb) { t.thumb = path.join(TEMPLATES, `${String(t.id).replace(/[^\w-]/g, '')}.jpg`); await fsp.writeFile(t.thumb, Buffer.from(thumb)); }
  await fsp.writeFile(tplFile(t.id) + '.tmp', JSON.stringify(t));
  await fsp.rename(tplFile(t.id) + '.tmp', tplFile(t.id));
  return t;
});
ipcMain.handle('templates:delete', async (_e, id) => {
  await fsp.rm(tplFile(id), { force: true });
  await fsp.rm(tplFile(id).replace(/\.json$/, '.jpg'), { force: true });
});

// ---------- brand kit (shared by every project) ----------
const BRAND_FILE = path.join(DATA, 'brand.json');
ipcMain.handle('brand:get', async () => { try { return JSON.parse(await fsp.readFile(BRAND_FILE, 'utf8')); } catch { return { colors: [], fonts: [], logos: [], styles: [] }; } });
ipcMain.handle('brand:set', (_e, b) => fsp.writeFile(BRAND_FILE, JSON.stringify(b)));
// Logos are copied in so they survive the original being moved or deleted.
ipcMain.handle('brand:logo', async (_e, file) => {
  const out = path.join(BRAND, `${hash(file + Date.now())}${path.extname(file).toLowerCase()}`);
  await fsp.copyFile(file, out);
  return out;
});
// LUTs are copied in (like logos) so projects and packages don't depend on where the .cube came from.
ipcMain.handle('lut:import', async (_e, file) => {
  const out = path.join(LUTS, `${hash(file + Date.now())}.cube`);
  await fsp.copyFile(file, out);
  return out;
});
ipcMain.handle('projects:thumb', async (_e, id, buf) => {
  const p = path.join(CACHE, `proj-${id}.jpg`);
  await fsp.writeFile(p, Buffer.from(buf));
  return p;
});

// ---------- media ----------
ipcMain.handle('media:probe', async (_e, file) => {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(out.toString());
  const v = j.streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const ext = path.extname(file).slice(1).toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext) || (ext === 'gif' && !(+j.format.duration > 0.2));
  let rotation = 0;
  if (v) {
    const sd = (v.side_data_list || []).find((s) => s.rotation != null);
    rotation = Math.abs(+(sd ? sd.rotation : (v.tags && v.tags.rotate) || 0)) % 180;
  }
  // Anamorphic video (non-square pixels): Chromium shows it stretched, ffprobe/WebCodecs/ffmpeg see the coded size.
  // Display size here, and the import makes a square-pixel proxy (same size) so every path sees the same picture.
  const [sn, sd] = ((v && v.sample_aspect_ratio) || '1:1').split(':').map(Number);
  const sar = !isImage && sn > 0 && sd > 0 && sn !== sd ? sn / sd : 1;
  let [w, h] = v ? [sar === 1 ? v.width : Math.trunc((v.width * sar) / 2) * 2, v.height] : [0, 0];
  if (rotation === 90) [w, h] = [h, w];
  const [fn, fd] = ((v && v.avg_frame_rate) || '30/1').split('/').map(Number);
  return {
    type: isImage ? 'image' : v ? 'video' : 'audio',
    duration: isImage ? 5 : +j.format.duration || 0,
    width: w, height: h, sar, fps: fd ? fn / fd : 30,
    hasAudio: !!a, vcodec: v && v.codec_name, acodec: a && a.codec_name,
  };
});

ipcMain.handle('media:thumb', async (_e, file, t = 0, height = 120) => {
  const out = path.join(CACHE, `th-${hash(file + t + height)}.jpg`);
  if (!(await exists(out))) {
    await run(FFMPEG, ['-y', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=-2:${height}`, '-q:v', '4', out]);
  }
  return out;
});

// Film strip: N frames tiled horizontally in one image.
ipcMain.handle('media:strip', async (_e, file, duration, count = 12) => {
  const out = path.join(CACHE, `strip-${hash(file + count)}.jpg`);
  if (!(await exists(out))) {
    const fps = Math.max(count / Math.max(duration, 0.1), 0.01);
    await run(FFMPEG, ['-y', '-i', file, '-vf', `fps=${fps},scale=-2:72,tile=${count}x1`, '-frames:v', '1', '-q:v', '5', out]);
  }
  return out;
});

// Audio peaks (max abs per bucket) at 50 buckets per second, for waveforms.
ipcMain.handle('media:peaks', async (_e, file) => {
  const out = path.join(CACHE, `pk-${hash(file)}.json`);
  if (await exists(out)) return JSON.parse(await fsp.readFile(out, 'utf8'));
  const RATE = 4000, PER = 50, step = RATE / PER;
  const raw = await run(FFMPEG, ['-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']);
  const n = Math.floor(raw.length / 2), peaks = [];
  for (let i = 0; i < n; i += step) {
    let m = 0;
    for (let j = i; j < Math.min(i + step, n); j++) m = Math.max(m, Math.abs(raw.readInt16LE(j * 2)));
    peaks.push(Math.round((m / 32768) * 100) / 100);
  }
  await fsp.writeFile(out, JSON.stringify(peaks));
  return peaks;
});

// Proxy for codecs Chromium can't decode, and reversed copies.
ipcMain.handle('media:transcode', async (_e, file, kind, duration, jobId) => {
  const out = path.join(CACHE, `${kind === 'proxy' ? 'proxy2' : kind}-${hash(file)}.mp4`); // proxy2: square pixels
  if (await exists(out)) return out;
  const vf = kind === 'reverse' ? ['-vf', 'reverse', '-af', 'areverse'] : ['-vf', 'scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1'];
  await run(FFMPEG, ['-y', '-i', file, ...vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', out + '.part.mp4'], {
    onStderr: (l) => { const t = timeOf(l); if (t != null) send('job:progress', { jobId, progress: Math.min(1, t / duration) }); },
  });
  await fsp.rename(out + '.part.mp4', out);
  return out;
});

// Freeze frame: exact frame to PNG.
ipcMain.handle('media:frame', async (_e, file, t) => {
  const out = path.join(CACHE, `frame-${hash(file + t)}.png`);
  await run(FFMPEG, ['-y', '-ss', String(t), '-i', file, '-frames:v', '1', out]);
  return out;
});

// ---------- AI model files (downloaded once, then offline) ----------
const MODEL_FILES = {
  // MDX-Net vocal model from Ultimate Vocal Remover (MIT).
  mdx: ['UVR-MDX-NET-Voc_FT.onnx', 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Voc_FT.onnx'],
  // RNNoise model for ffmpeg arnndn (speech denoise, "conjoined burgers").
  rnnoise: ['cb.rnnn', 'https://raw.githubusercontent.com/GregorR/rnnoise-models/master/conjoined-burgers-2018-08-28/cb.rnnn'],
  // Vision (Sesión 6), pinned revisions: MODNet portrait matting (Apache-2.0), UltraFace RFB-320 face detector (MIT),
  // Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact, BSD-3) re-exported to ONNX from the official weights.
  modnet: ['modnet.onnx', 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx'],
  ultraface: ['ultraface-rfb-320.onnx', 'https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx'],
  esrgan: ['realesr-general-x4v3-webgpu.onnx', 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/c6a971706797c7502945a2b4c4274fce4900d4ab/realesr-general-x4v3.onnx', (b) => fixPrelu(b)],
};

// onnxruntime-web has no WebGPU PRelu: each of Real-ESRGAN's 33 PRelu ran on the CPU (~15× slower). Rewritten once
// after download as Relu(x) − s·Relu(−x) (same output), editing the protobuf: ModelProto.graph = 7, GraphProto.node = 1.
const varint = (b, p) => { let v = 0, m = 1, c; do { c = b[p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return [v, p]; };
const uvar = (n) => { const o = []; do { let c = n % 128; n = Math.floor(n / 128); if (n) c |= 128; o.push(c); } while (n); return Buffer.from(o); };
function pbFields(b) {
  const out = [];
  for (let p = 0; p < b.length;) {
    const s = p; let k; [k, p] = varint(b, p); const t = k & 7; let v = null;
    if (t === 0) [, p] = varint(b, p); else if (t === 1) p += 8; else if (t === 5) p += 4;
    else if (t === 2) { let n; [n, p] = varint(b, p); v = b.subarray(p, p + n); p += n; } else throw new Error('Modelo ONNX no válido');
    out.push({ f: Math.floor(k / 8), t, v, raw: b.subarray(s, p) });
  }
  return out;
}
const pbLen = (f, buf) => Buffer.concat([uvar(f * 8 + 2), uvar(buf.length), buf]);
const pbNode = (op, ins, outs, name) => pbLen(1, Buffer.concat([...ins.map((x) => pbLen(1, Buffer.from(x))), ...outs.map((x) => pbLen(2, Buffer.from(x))), pbLen(3, Buffer.from(name)), pbLen(4, Buffer.from(op))]));
function fixPrelu(model) {
  let n = 0;
  return Buffer.concat(pbFields(model).map((F) => (F.f !== 7 || F.t !== 2 ? F.raw : pbLen(7, Buffer.concat(pbFields(F.v).map((G) => {
    if (G.f !== 1 || G.t !== 2) return G.raw;
    const nf = pbFields(G.v);
    if (String(nf.find((x) => x.f === 4).v) !== 'PRelu') return G.raw;
    const [x, s] = nf.filter((q) => q.f === 1).map((q) => String(q.v)), y = String(nf.find((q) => q.f === 2).v), id = `prelu${n++}_`;
    return Buffer.concat([pbNode('Relu', [x], [id + 'p'], id + 'a'), pbNode('Neg', [x], [id + 'n'], id + 'b'), pbNode('Relu', [id + 'n'], [id + 'r'], id + 'c'),
      pbNode('Mul', [id + 'r', s], [id + 'm'], id + 'd'), pbNode('Sub', [id + 'p', id + 'm'], [y], id + 'e')]);
  }))))));
}
const downloads = new Map();
function getModel(name, jobId) {
  const [file, url, fix] = MODEL_FILES[name];
  const out = path.join(MODELS, file);
  if (!downloads.has(name)) {
    downloads.set(name, (async () => {
      if (await exists(out)) return out;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`No se pudo descargar el modelo (${res.status})`);
      const total = +res.headers.get('content-length') || 0, part = out + '.part';
      const ws = fs.createWriteStream(part);
      let got = 0;
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
        if (jobId && total) send('job:progress', { jobId, progress: got / total });
      }
      await new Promise((r, j) => ws.end((e) => (e ? j(e) : r())));
      if (fix) await fsp.writeFile(part, fix(await fsp.readFile(part)));
      await fsp.rename(part, out);
      return out;
    })().finally(() => downloads.delete(name)));
  }
  return downloads.get(name);
}
ipcMain.handle('models:get', (_e, name, jobId) => getModel(name, jobId));

// ---------- CC0 music & sound library (Sesión 7): files from Wikimedia Commons, downloaded once ----------
const LIBRARY = path.join(DATA, 'library');
fs.mkdirSync(LIBRARY, { recursive: true });
const libFile = ({ id, ext }) => path.join(LIBRARY, `${String(id).replace(/[^\w-]/g, '')}.${String(ext).replace(/[^\w]/g, '')}`);
const libDownloads = new Map();
ipcMain.handle('library:has', async (_e, items) => (await Promise.all(items.map(async (it) => ((await exists(libFile(it))) ? it.id : null)))).filter(Boolean));
ipcMain.handle('library:get', (_e, item, jobId) => {
  const out = libFile(item);
  if (!/^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(item.url)) throw new Error('Origen no permitido');
  if (!libDownloads.has(out)) {
    libDownloads.set(out, (async () => {
      if (await exists(out)) return out;
      // Wikimedia asks for an identifying User-Agent.
      const res = await fetch(item.url, { headers: { 'User-Agent': `VelvixStudio/${app.getVersion()} (offline video editor; CC0 library)` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = +res.headers.get('content-length') || 0, part = out + '.part', ws = fs.createWriteStream(part);
      let got = 0;
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
        if (jobId && total) send('job:progress', { jobId, progress: got / total });
      }
      await new Promise((r, j) => ws.end((e) => (e ? j(e) : r())));
      await fsp.rename(part, out);
      return out;
    })().finally(() => libDownloads.delete(out)));
  }
  return libDownloads.get(out);
});

// Whole file as float32 PCM (interleaved), for the separation model and beat detection.
ipcMain.handle('audio:decode', async (_e, file, rate, channels) => {
  const raw = await run(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', '-']);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
});
// Float32 channels → 16-bit WAV in the cache (stems, neural TTS).
ipcMain.handle('audio:saveWav', async (_e, name, chans, rate) => {
  const n = chans[0].length, ch = chans.length, buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * ch * 2, 40);
  const views = chans.map((c) => new Float32Array(c.buffer, c.byteOffset, n));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, views[c][i])) * 32767), o);
  const out = path.join(CACHE, `${String(name).replace(/[^\w-]/g, '')}.wav`);
  await fsp.writeFile(out, buf);
  return out;
});
ipcMain.handle('cache:path', (_e, name) => path.join(CACHE, `${String(name).replace(/[^\w-]/g, '')}.wav`));
ipcMain.handle('cache:file', (_e, name) => path.join(CACHE, String(name).replace(/[^\w.-]/g, '').replace(/^\.+/, '')));

// ---------- video analysis (Sesión 6) ----------
// Raw frames of a video for the vision models: one ffmpeg process per job, read in batches.
// ss: input seek (frame-exact), frames: how many, vf: filters that produce the frame size the caller expects.
const streams = new Map();
ipcMain.handle('frames:open', (_e, { file, ss, frames, vf, pix = 'rgb24' }) => {
  const id = crypto.randomBytes(6).toString('hex');
  const p = spawn(FFMPEG, ['-v', 'error', '-ss', String(Math.max(0, ss)), '-i', file, '-frames:v', String(frames), '-vf', vf, '-f', 'rawvideo', '-pix_fmt', pix, '-'], { windowsHide: true });
  const s = { p, bufs: [], len: 0, ended: false, wake: null, err: '' };
  p.stdout.on('data', (d) => { s.bufs.push(d); s.len += d.length; if (s.len > 96 << 20) p.stdout.pause(); if (s.wake) s.wake(); });
  p.stderr.on('data', (d) => { s.err = (s.err + d).slice(-2000); });
  p.on('close', () => { s.ended = true; if (s.wake) s.wake(); });
  p.on('error', (e) => { s.err = e.message; s.ended = true; if (s.wake) s.wake(); });
  streams.set(id, s);
  return id;
});
// Next whole frames (up to n), empty at the end of the stream.
ipcMain.handle('frames:read', async (_e, id, frameBytes, n) => {
  const s = streams.get(id);
  if (!s) return new Uint8Array(0);
  while (s.len < frameBytes * n && !s.ended) { s.p.stdout.resume(); await new Promise((r) => { s.wake = r; }); s.wake = null; }
  const all = Buffer.concat(s.bufs), take = Math.min(all.length - (all.length % frameBytes), frameBytes * n);
  s.bufs = [all.subarray(take)]; s.len = all.length - take;
  if (!take && s.ended && s.err) throw new Error(s.err.split('\n').filter(Boolean).slice(-2).join(' '));
  return new Uint8Array(all.buffer, all.byteOffset, take);
});
ipcMain.handle('frames:close', (_e, id) => { const s = streams.get(id); if (s) { s.p.kill(); streams.delete(id); } });

// RGBA frames → H.264 video-only file (upscaled copies). Written to .part and renamed when complete.
const encoders = new Map();
ipcMain.handle('enc:open', (_e, { out, w, h, fps }) => {
  const id = crypto.randomBytes(6).toString('hex');
  const p = spawn(FFMPEG, ['-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-g', '15', '-pix_fmt', 'yuv420p', '-an', '-f', 'mp4', out + '.part'], { windowsHide: true });
  let log = '';
  p.stderr.on('data', (d) => { log = (log + d).slice(-4000); });
  p.stdin.on('error', () => {});
  encoders.set(id, { p, out, done: new Promise((r) => p.on('close', (code) => r(code === 0 ? null : log.split('\n').slice(-5).join('\n')))) });
  return id;
});
ipcMain.handle('enc:write', (_e, id, buf) => new Promise((resolve) => {
  const e = encoders.get(id);
  if (!e || e.p.exitCode !== null) return resolve(false);
  if (e.p.stdin.write(Buffer.from(buf))) return resolve(true);
  e.p.stdin.once('drain', () => resolve(true));
}));
ipcMain.handle('enc:close', async (_e, id, cancel) => {
  const e = encoders.get(id);
  if (!e) return false;
  encoders.delete(id);
  if (cancel) { e.p.kill('SIGKILL'); await e.done; await fsp.rm(e.out + '.part', { force: true }); return false; }
  e.p.stdin.end();
  const err = await e.done;
  if (err) { await fsp.rm(e.out + '.part', { force: true }); throw new Error(err); }
  await fsp.rename(e.out + '.part', e.out);
  return true;
});

// Stabilization (libvidstab, two passes) of `frames` frames from input second ss; video only, optimal static zoom
// so no black borders show. cwd = cache so the .trf path needs no filtergraph escaping.
ipcMain.handle('video:stabilize', async (_e, { file, ss, frames, fps, smoothing, jobId }) => {
  const key = hash([file, await fileTag(file), ss, frames, smoothing].join('|')), out = path.join(CACHE, `stab-${key}.mp4`), trf = `stab-${key}.trf`;
  if (await exists(out)) return out;
  const dur = frames / fps, prog = (a, b) => (l) => { const t = timeOf(l); if (t != null) send('job:progress', { jobId, progress: a + (b - a) * Math.min(1, t / dur) }); };
  const input = ['-ss', String(Math.max(0, ss)), '-i', file, '-frames:v', String(frames)];
  try {
    await run(FFMPEG, ['-y', ...input, '-vf', `vidstabdetect=shakiness=8:accuracy=15:result=${trf}`, '-f', 'null', '-'], { cwd: CACHE, onStderr: prog(0, 0.45) });
    await run(FFMPEG, ['-y', ...input, '-vf', `vidstabtransform=input=${trf}:smoothing=${Math.round(smoothing)}:optzoom=1:interpol=bicubic,unsharp=5:5:0.6:3:3:0.3`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-g', '15', '-pix_fmt', 'yuv420p', '-an', '-f', 'mp4', out + '.part'], { cwd: CACHE, onStderr: prog(0.45, 1) });
    await fsp.rename(out + '.part', out);
  } finally { await fsp.rm(path.join(CACHE, trf), { force: true }); }
  return out;
});

// Scene cuts (ffmpeg scdet) between input seconds ss and ss + dur: times of the first frame of each new shot.
ipcMain.handle('video:scenes', async (_e, { file, ss, dur, threshold }) => {
  let log = '';
  await run(FFMPEG, ['-hide_banner', '-ss', String(Math.max(0, ss)), '-i', file, '-t', String(dur), '-an', '-vf', `scale=320:-2,scdet=threshold=${threshold}`, '-f', 'null', '-'], { onStderr: (l) => { log += l; } });
  return [...log.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => ({ t: ss + +m[2], score: +m[1] }));
});

// ---------- audio effects ----------
const VOICES = {
  none: [],
  chipmunk: ['rubberband=pitch=1.6'],
  deep: ['rubberband=pitch=0.7'],
  robot: ['afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75'],
  echo: ['aecho=0.8:0.85:300:0.35'],
  hall: ['aecho=0.8:0.9:60|120|240:0.4|0.3|0.2'],
  megaphone: ['highpass=f=500', 'lowpass=f=3500', 'acrusher=bits=8:mix=0.3', 'volume=1.5'],
  telephone: ['highpass=f=400', 'lowpass=f=3000'],
  radio: ['highpass=f=300', 'lowpass=f=4500', 'acompressor=threshold=0.1:ratio=6'],
  chorus: ['chorus=0.6:0.9:50|60:0.4|0.32:0.25|0.4:2|1.3'],
  monster: ['rubberband=pitch=0.55', 'aecho=0.8:0.6:40:0.3'],
  vibrato: ['vibrato=f=6:d=0.5'],
};
function fxChain(fx) {
  const f = [];
  // "Mejorar voz": rumble cut, RNNoise, less mud, more presence, gentle compression (studio-like, offline).
  if (fx.enhance) f.push('highpass=f=80', 'arnndn=m=cb.rnnn', 'equalizer=f=250:t=q:w=1:g=-3', 'equalizer=f=3500:t=q:w=1.2:g=4',
    'acompressor=threshold=-22dB:ratio=3.5:attack=8:release=150:makeup=4', 'alimiter=limit=0.95');
  if (fx.denoise) f.push('afftdn=nf=-25');
  if (fx.pitch) f.push(`rubberband=pitch=${Math.pow(2, fx.pitch / 12).toFixed(4)}`);
  f.push(...(VOICES[fx.voice] || []));
  if (fx.normalize) f.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (fx.bass) f.push(`bass=g=${fx.bass}`);
  if (fx.treble) f.push(`treble=g=${fx.treble}`);
  return f;
}
// Renders source audio with effects to a WAV the preview plays and export reuses.
ipcMain.handle('audio:fx', async (_e, file, fx) => {
  const chain = fxChain(fx);
  if (!chain.length) return null;
  const out = path.join(CACHE, `fx-${hash(file + JSON.stringify(fx))}.wav`);
  if (!(await exists(out))) {
    if (fx.enhance) await getModel('rnnoise');
    // cwd = models folder so arnndn's model path needs no filtergraph escaping.
    await run(FFMPEG, ['-y', '-i', file, '-vn', '-af', chain.join(','), '-ar', '48000', '-ac', '2', out + '.part.wav'], { cwd: MODELS });
    await fsp.rename(out + '.part.wav', out);
  }
  return out;
});

// ---------- text to speech (Windows built-in voices, offline) ----------
const psRun = (script) => new Promise((resolve, reject) =>
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 1 << 24 }, (err, out) => err ? reject(err) : resolve(out)));
ipcMain.handle('tts:voices', async () => {
  try {
    const out = await psRun('Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | % { $_.VoiceInfo.Name + "|" + $_.VoiceInfo.Culture }');
    return out.split(/\r?\n/).filter(Boolean).map((l) => { const [name, culture] = l.split('|'); return { name, culture }; });
  } catch { return []; }
});
ipcMain.handle('tts:speak', async (_e, { text, voice, rate }) => {
  const out = path.join(CACHE, `tts-${hash(text + voice + rate + Date.now())}.wav`);
  const txt = path.join(CACHE, `tts-${Date.now()}.txt`);
  await fsp.writeFile(txt, text, 'utf8');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  await psRun(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
    (voice ? `$s.SelectVoice(${q(voice)}); ` : '') + `$s.Rate = ${Math.round(rate || 0)}; $s.SetOutputToWaveFile(${q(out)}); ` +
    `$s.Speak([IO.File]::ReadAllText(${q(txt)}, [Text.Encoding]::UTF8)); $s.Dispose()`);
  fsp.rm(txt, { force: true });
  return out;
});

// ---------- audio mix graph (shared by export and captions) ----------
function atempoChain(speed) {
  const f = []; let s = speed;
  while (s > 100) { f.push('atempo=100'); s /= 100; }
  while (s < 0.5) { f.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-3) f.push(`atempo=${s.toFixed(5)}`);
  return f;
}
// Gain filter: constant, or [[t, v], …] points in clip time as a sum of clipped ramps (piecewise linear, no nesting).
function volumeFilter(v) {
  if (!Array.isArray(v)) return v !== 1 ? `volume=${v.toFixed(3)}` : null;
  let e = v[0][1].toFixed(4);
  for (let i = 0; i < v.length - 1; i++) {
    const [t0, a] = v[i], [t1, b] = v[i + 1];
    if (t1 > t0 && a !== b) e += `+${((b - a) / (t1 - t0)).toFixed(5)}*(clip(t,${t0},${t1})-${t0})`;
  }
  return `volume='${e}':eval=frame`;
}
// segs: [{ path, in, srcDur, start, duration, speed, volume, fadeIn, fadeOut, pieces? }]
// pieces (speed curves): [{ in, srcDur, speed, duration }] contiguous constant-speed parts of the source.
// from/total: timeline range to render (export of a range); the output starts at 0.
function audioGraph(segs, total, firstInput, from = 0) {
  const inputs = [], parts = [];
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  segs.forEach((s, i) => {
    inputs.push('-i', s.path);
    let src = `[${firstInput + i}:a]`, f;
    if (s.pieces) {
      // Each constant-speed part is stretched on its own with 0.25 s of source context on both sides (atempo
      // loses ~a window at the edges of its input), cut to its exact span and joined with 10 ms crossfades.
      // A single stretcher driven by tempo commands drifts (its internal latency applies new tempos early).
      const ps = [];
      for (const p of s.pieces) {
        const q = ps[ps.length - 1];
        if (q && Math.abs(p.speed / q.speed - 1) < 0.01) { q.srcDur += p.srcDur; q.duration += p.duration; q.speed = q.srcDur / q.duration; } else ps.push({ ...p });
      }
      const CTX = 0.25, XF = 0.01, n = ps.length, ns = Math.round(s.duration * 48000);
      parts.push(`${src}${fmt},asplit=${n}${ps.map((_, j) => `[s${i}p${j}]`).join('')}`);
      ps.forEach((p, j) => {
        const pre = Math.min(CTX, p.in), len = p.duration + (j < n - 1 ? XF : 0);
        const g = [`atrim=start=${(p.in - pre).toFixed(5)}:duration=${(p.srcDur + pre + CTX).toFixed(5)}`, 'asetpts=PTS-STARTPTS', ...atempoChain(p.speed),
          `atrim=start=${(pre / p.speed).toFixed(5)}`, 'asetpts=PTS-STARTPTS', `apad=whole_len=${Math.round(len * 48000)}`, `atrim=end_sample=${Math.round(len * 48000)}`];
        parts.push(`[s${i}p${j}]${g.join(',')}[s${i}q${j}]`);
      });
      let cur = `[s${i}q0]`;
      for (let j = 1; j < n; j++) { parts.push(`${cur}[s${i}q${j}]acrossfade=d=${XF}:c1=tri:c2=tri[s${i}x${j}]`); cur = `[s${i}x${j}]`; }
      src = cur; f = [`apad=whole_len=${ns}`, `atrim=end_sample=${ns}`];
    } else f = [`atrim=start=${s.in.toFixed(4)}:duration=${s.srcDur.toFixed(4)}`, 'asetpts=PTS-STARTPTS', fmt, ...atempoChain(s.speed)];
    const vol = volumeFilter(s.volume);
    if (vol) f.push(vol);
    if (s.fadeIn > 0) f.push(`afade=t=in:d=${s.fadeIn}`);
    if (s.fadeOut > 0) f.push(`afade=t=out:st=${Math.max(0, s.duration - s.fadeOut).toFixed(4)}:d=${s.fadeOut}`);
    f.push(`adelay=${Math.round(s.start * 1000)}:all=1`);
    parts.push(`${src}${f.join(',')}[a${i}]`);
  });
  if (!segs.length) return { inputs: ['-f', 'lavfi', '-t', String(total - from), '-i', 'anullsrc=r=48000:cl=stereo'], filter: `[${firstInput}:a]anull[aout]` };
  const end = `apad,atrim=${from.toFixed(4)}:${total.toFixed(4)},asetpts=PTS-STARTPTS`;
  const mixOf = (ids, out) => (ids.length === 1 ? `[a${ids[0]}]${end}[${out}]` : ids.map((i) => `[a${i}]`).join('') + `amix=inputs=${ids.length}:normalize=0:duration=longest,${end}[${out}]`);
  const ducked = segs.map((s, i) => (s.duck > 0 ? i : -1)).filter((i) => i >= 0), voice = segs.map((s, i) => (s.duck > 0 ? -1 : i)).filter((i) => i >= 0);
  if (!ducked.length || !voice.length) return { inputs, filter: parts.join(';') + ';' + mixOf(segs.map((_, i) => i), 'aout') };
  // Ducking: every ducked clip goes through a sidechain compressor keyed by the mix of the other clips.
  // Sidechain boosted (+24 dB) so speech compresses the clip to near silence; the dry/wet mix then sets the depth
  // (≈ the chosen dB while someone talks). ponytail: broadband ducking, per-band if music still masks voice.
  parts.push(mixOf(voice, 'vmix'), `[vmix]asplit=${ducked.length + 1}[vout]${ducked.map((i) => `[k${i}]`).join('')}`);
  for (const i of ducked) {
    const wet = 1 - Math.pow(10, -segs[i].duck / 20);
    parts.push(`[a${i}][k${i}]sidechaincompress=threshold=0.05:ratio=20:level_sc=16:attack=20:release=400:mix=${wet.toFixed(3)}[d${i}]`);
  }
  const mix = `[vout]${ducked.map((i) => `[d${i}]`).join('')}amix=inputs=${ducked.length + 1}:normalize=0:duration=longest,${end}[aout]`;
  return { inputs, filter: parts.join(';') + ';' + mix };
}

// Mixed timeline audio as 16 kHz mono float32 for Whisper.
ipcMain.handle('captions:audio', async (_e, segs, total) => {
  const g = audioGraph(segs, total, 0);
  const raw = await run(FFMPEG, [...g.inputs, '-filter_complex', g.filter, '-map', '[aout]', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-']);
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
});

// ---------- export ----------
let hwCache = null;
async function hwEncoder() {
  if (hwCache !== null) return hwCache;
  for (const enc of ['h264_nvenc', 'h264_amf', 'h264_qsv']) {
    try { await run(FFMPEG, ['-f', 'lavfi', '-i', 'color=s=256x256:d=0.1', '-c:v', enc, '-f', 'null', '-']); return (hwCache = enc); } catch { /* next */ }
  }
  return (hwCache = '');
}
ipcMain.handle('export:hw', () => hwEncoder());

let job = null;
// H.264 from WebCodecs goes to a temp file (not a live ffmpeg pipe) with checkpoints at keyframes, so a long
// export that fails can resume from the last checkpoint, even after a restart. Audio is muxed in at the end.
const expFiles = (key) => ({ h264: path.join(CACHE, `exp-${key}.h264`), state: path.join(CACHE, `exp-${key}.json`) });
ipcMain.handle('export:resumable', async (_e, sig) => {
  const key = hash(sig), f = expFiles(key);
  try {
    const st = JSON.parse(await fsp.readFile(f.state, 'utf8'));
    return (await fsp.stat(f.h264)).size >= st.off && st.f > 0 ? { ...st, key } : null;
  } catch { return null; }
});
ipcMain.handle('export:start', async (_e, o) => {
  // o: { out, format, width, height, fps, quality: 'low'|'med'|'high', hw, segs, total, from, audioOnly, videoInput, sig, resume }
  o.from = o.from || 0;
  if (o.videoInput === 'h264') {
    const key = hash(o.sig), f = expFiles(key);
    if (o.resume) await fsp.truncate(f.h264, o.resume.off);
    else {
      // One resumable export at a time: a new export drops older temp streams (they can be GBs).
      for (const x of await fsp.readdir(CACHE)) if (/^exp-\w+\.(h264|json)$/.test(x)) await fsp.rm(path.join(CACHE, x), { force: true }).catch(() => {}); // in use by another window: leave it
    }
    job = { file: true, o, key, f, fd: fs.openSync(f.h264, o.resume ? 'r+' : 'w'), pos: o.resume ? o.resume.off : 0 };
    return { ok: true, key };
  }
  const g = audioGraph(o.segs, o.total, o.audioOnly ? 0 : 1, o.from);
  const crf = { low: 28, med: 22, high: 17 }[o.quality] || 22;
  const args = ['-y'];
  if (!o.audioOnly) args.push('-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.width}x${o.height}`, '-framerate', String(o.fps), '-i', 'pipe:0');
  args.push(...g.inputs);
  let filter = g.filter;
  if (o.format === 'gif') {
    filter = `[0:v]fps=${Math.min(o.fps, 15)},split[g1][g2];[g1]palettegen=stats_mode=diff[pal];[g2][pal]paletteuse=dither=bayer:bayer_scale=4[vout]`;
    args.push('-filter_complex', filter, '-map', '[vout]', '-loop', '0');
  } else if (o.audioOnly) {
    args.push('-filter_complex', filter, '-map', '[aout]');
    if (o.format === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '320k');
    else args.push('-c:a', 'pcm_s16le');
  } else {
    args.push('-filter_complex', filter, '-map', '0:v', '-map', '[aout]');
    if (o.format === 'webm') {
      args.push('-c:v', 'libvpx-vp9', '-crf', String(crf + 8), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '160k');
    } else {
      const enc = o.hw ? await hwEncoder() : '';
      if (enc === 'h264_nvenc') args.push('-c:v', enc, '-preset', 'p5', '-rc', 'vbr', '-cq', String(crf), '-b:v', '0');
      else if (enc === 'h264_amf') args.push('-c:v', enc, '-quality', 'quality', '-rc', 'cqp', '-qp_i', String(crf), '-qp_p', String(crf));
      else if (enc === 'h264_qsv') args.push('-c:v', enc, '-global_quality', String(crf));
      else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf));
      args.push('-pix_fmt', 'yuv420p', '-r', String(o.fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
    }
    args.push('-shortest'); // audio is already trimmed to the exact length
  }
  args.push(o.out);
  const proc = spawn(FFMPEG, args, { windowsHide: true });
  let log = '';
  proc.stderr.on('data', (d) => {
    log = (log + d).slice(-8000);
    if (o.audioOnly) { const t = timeOf(String(d)); if (t != null) send('export:audioProgress', Math.min(1, t / (o.total - o.from))); }
  });
  proc.stdin.on('error', () => {});
  const done = new Promise((resolve) => proc.on('close', (code) => resolve({ ok: code === 0, error: code === 0 ? null : log.split('\n').slice(-8).join('\n') })));
  job = { proc, done };
  if (o.audioOnly) { const r = await done; job = null; return r; }
  return { ok: true };
});
// ckpt { f, off }: frame f starts a keyframe at byte off of the stream; saved once the bytes before it are on disk.
// Resolves false if ffmpeg died, so the renderer stops instead of waiting on 'drain' forever.
ipcMain.handle('export:frame', (_e, buf, ckpt) => new Promise((resolve) => {
  if (!job || job.closed) return resolve(false);
  const j = job;
  if (j.file) {
    try {
      const b = Buffer.from(buf);
      fs.writeSync(j.fd, b, 0, b.length, j.pos); j.pos += b.length;
      if (ckpt && ckpt.off <= j.pos) fs.writeFileSync(j.f.state, JSON.stringify({ ...ckpt, out: j.o.out, at: Date.now() }));
      return resolve(true);
    } catch { return resolve(false); }
  }
  if (j.proc.stdin.write(Buffer.from(buf))) return resolve(true);
  const onDrain = () => { j.proc.removeListener('close', onClose); resolve(true); };
  const onClose = () => { j.proc.stdin.removeListener('drain', onDrain); resolve(false); };
  j.proc.stdin.once('drain', onDrain);
  j.proc.once('close', onClose);
}));
ipcMain.handle('export:finish', async () => {
  if (!job) return { ok: false, error: 'no job' };
  if (job.file) {
    const { o, f, fd } = job;
    fs.closeSync(fd); job = null;
    // Mux: copy the H.264 stream, render the audio mix.
    const g = audioGraph(o.segs, o.total, 1, o.from);
    try {
      await run(FFMPEG, ['-y', '-fflags', '+genpts', '-f', 'h264', '-framerate', String(o.fps), '-i', f.h264, ...g.inputs, '-filter_complex', g.filter,
        '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', o.out], {
        onStderr: (l) => { const t = timeOf(l); if (t != null) send('export:audioProgress', Math.min(1, t / (o.total - o.from))); },
      });
    } catch (e) { return { ok: false, error: e.message }; }
    await fsp.rm(f.h264, { force: true }); await fsp.rm(f.state, { force: true });
    return { ok: true };
  }
  job.proc.stdin.end();
  const r = await job.done; job = null; return r;
});
// keep: a failed export keeps its temp stream and checkpoint so it can resume; a user cancel removes them.
ipcMain.handle('export:cancel', async (_e, out, keep) => {
  if (job && job.file) {
    fs.closeSync(job.fd);
    if (!keep) { await fsp.rm(job.f.h264, { force: true }); await fsp.rm(job.f.state, { force: true }); }
    job = null; return;
  }
  if (job) { job.proc.kill('SIGKILL'); await job.done; job = null; }
  if (out) fsp.rm(out, { force: true }).catch(() => {});
});

