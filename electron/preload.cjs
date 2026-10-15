const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('api', {
  mediaBase: ipcRenderer.sendSync('media:base'),
  openMedia: inv('dialog:openMedia'),
  saveDialog: inv('dialog:save'),
  showItem: inv('shell:show'),
  openPath: inv('shell:open'),
  writeFile: inv('file:write'),
  readFile: inv('file:read'),
  openFile: inv('dialog:openFile'),
  fileExists: inv('file:exists'),
  paths: inv('app:paths'),
  pathForFile: (f) => webUtils.getPathForFile(f),

  listProjects: inv('projects:list'),
  loadProject: inv('projects:load'),
  saveProject: inv('projects:save'),
  deleteProject: inv('projects:delete'),
  saveProjectThumb: inv('projects:thumb'),

  probe: inv('media:probe'),
  thumb: inv('media:thumb'),
  strip: inv('media:strip'),
  peaks: inv('media:peaks'),
  transcode: inv('media:transcode'),
  frame: inv('media:frame'),
  audioFx: inv('audio:fx'),
  ttsVoices: inv('tts:voices'),
  tts: inv('tts:speak'),
  captionsAudio: inv('captions:audio'),
  onJobProgress: on('job:progress'),

  exportHw: inv('export:hw'),
  exportStart: inv('export:start'),
  exportFrame: inv('export:frame'),
  exportFinish: inv('export:finish'),
  exportCancel: inv('export:cancel'),
  onAudioExportProgress: on('export:audioProgress'),
});
