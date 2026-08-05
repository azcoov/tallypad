// CommonJS preload. Exposes a minimal, safe API to the renderer.
// Every method is a thin wrapper over IPC; the main process holds all file
// and settings access, so the renderer never touches Node directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tallypad', {
  loadInitialDocument: () => ipcRenderer.invoke('doc:load-initial'),
  newFile: () => ipcRenderer.invoke('file:new'),
  autosave: (text) => ipcRenderer.send('doc:autosave', text),
  openFile: () => ipcRenderer.invoke('file:open'),
  openRecent: (path) => ipcRenderer.invoke('file:open-recent', path),
  saveFile: (text) => ipcRenderer.invoke('file:save', text),
  saveFileAs: (text) => ipcRenderer.invoke('file:save-as', text),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  getZoom: () => ipcRenderer.invoke('zoom:get'),
  setZoom: (fontSize) => ipcRenderer.send('zoom:set', fontSize),
  onMenu: (handler) => ipcRenderer.on('menu', (_e, action, arg) => handler(action, arg)),
  onFileName: (handler) => ipcRenderer.on('file-name', (_e, name) => handler(name)),
  setDirty: (dirty, text) => ipcRenderer.send('doc:set-dirty', { dirty, text }),
  guardDiscard: (text) => ipcRenderer.invoke('doc:guard-discard', text),
});
