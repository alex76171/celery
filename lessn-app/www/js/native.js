// Thin wrapper around the app's own Android plugin. In a desktop browser every call is a no-op.
const P = () => window.Capacitor?.Plugins?.LessnNative;
export const hasNative = () => !!(window.Capacitor?.isNativePlatform?.() && P());

async function call(name, args) {
  const p = P();
  if (!p || !hasNative()) throw Object.assign(new Error('Only available in the Android app'), { code: 'web' });
  return p[name](args || {});
}

export const native = {
  status: () => call('status').catch(() => ({})),
  request: (aliases) => call('requestPermissions', { permissions: aliases }),
  schedule: (events) => call('schedule', { events }).catch(() => {}),
  openDndSettings: () => call('openDndSettings'),
  openAppSettings: () => call('openAppSettings'),
  openUrl: (url) => (hasNative() ? call('openUrl', { url }) : Promise.resolve(window.open(url, '_blank'))),
  getLocation: () => call('getLocation'),
  presenceLog: async () => { try { return JSON.parse((await call('getPresenceLog')).log || '{}'); } catch { return {}; } },
  setPresence: (date, status) => call('setPresence', { date, status }).catch(() => {}),
  startRecording: (title, maxMinutes) => call('startRecording', { title, maxMinutes }),
  stopRecording: () => call('stopRecording'),
  recordingStatus: () => call('recordingStatus').catch(() => ({ recording: false })),
  readFile: (path) => call('readFileBase64', { path }),
  deleteFile: (path) => call('deleteFile', { path }).catch(() => {}),
  davList: (opts) => call('davList', opts),
  davRequest: (opts) => call('davRequest', opts),
  raw: (opts) => call('rawRequest', opts),
  voiceStart: () => call('voiceStart'),
  voiceStop: (cancel = false) => call('voiceStop', { cancel }),
  iservLogin: (opts) => call('iservLogin', opts),
  iservBackground: (opts) => call('setIServBackground', opts).catch(() => {}),
  download: (opts) => (hasNative() ? call('download', opts) : Promise.resolve(window.open(opts.url, '_blank'))),
  fetchFile: (opts) => call('fetchFile', opts),
  followRedirects: (opts) => call('followRedirects', opts),
  openFile: (path, mime, title) => call('openFile', { path, mime, title }),
  shareFile: (opts) => call('shareFile', opts),
  saveFile: (path, name) => call('saveFile', { path, name }),
  pdfPage: (path, page, width) => call('pdfPage', { path, page, width }),
  writeCache: (name, base64) => call('writeCache', { name, base64 }),
  discoverPcs: (opts) => call('discoverPcs', opts),
  pickFolder: () => call('pickFolder'),
  treeList: (opts) => call('treeList', opts),
  treeRead: (opts) => call('treeRead', opts),
  treeWrite: (opts) => call('treeWrite', opts),
  treeDelete: (opts) => call('treeDelete', opts),
  treeMkdir: (opts) => call('treeMkdir', opts),
  notify: (opts) => call('notify', opts),
  openIServ: (opts) => (hasNative() ? call('openIServ', opts) : Promise.resolve(window.open(opts.url, '_blank'))),
};
