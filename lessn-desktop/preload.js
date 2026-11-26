// Gives the page a small, fixed API into the PC side (nothing else from Node is exposed).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lessnDesktop', {
  platform: process.platform,
  invoke: (name, args) => ipcRenderer.invoke('native', name, args),
  http: (opts) => ipcRenderer.invoke('http', opts),
  on: (cb) => ipcRenderer.on('hub-event', (_e, ev) => cb(ev)),
});
