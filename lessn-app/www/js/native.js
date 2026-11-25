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
  download: (opts) => (hasNative() ? call('download', opts) : Promise.resolve(window.open(opts.url, '_blank'))),
  openIServ: (opts) => (hasNative() ? call('openIServ', opts) : Promise.resolve(window.open(opts.url, '_blank'))),
};
