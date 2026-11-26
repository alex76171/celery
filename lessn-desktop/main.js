// Lessn for Windows (Electron). Runs the same app as the phone, with a PC layout, and hosts the Lessn Hub
// for the phone (files, sync, local AI). Closing the window keeps Lessn running in the tray (hidden icons);
// "Quit Lessn" in the tray menu ends it completely.
const { app, BrowserWindow, ipcMain, protocol, net, Tray, Menu, nativeImage, shell, Notification, dialog, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { CookieJar, request } = require('./bridge/http');
const { createNative } = require('./bridge/native');
const { Hub } = require('./hub');

const VERSION = require('./package.json').version;
app.setAppUserModelId('app.lessn.desktop');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'lfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

// ------------------------------------------------------------ folders and settings
const userData = app.getPath('userData');
const paths = {
  data: userData,
  cache: path.join(app.getPath('temp'), 'Lessn'),
  shared: path.join(app.getPath('documents'), 'Lessn'),
  syncFile: path.join(userData, 'sync.json'),
  icon: path.join(__dirname, 'app', 'icon.png'),
  www: path.join(__dirname, 'app', 'www'),
};
fs.mkdirSync(paths.cache, { recursive: true });
const storeFile = path.join(userData, 'desktop.json');
let storeData = {};
try { storeData = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch { /* first start */ }
const store = {
  get: (k) => storeData[k],
  set: (k, v) => { storeData[k] = v; try { fs.writeFileSync(storeFile, JSON.stringify(storeData, null, 1)); } catch { /* disk full */ } },
};
const jar = new CookieJar(path.join(userData, 'cookies.json'));

let win = null;
let tray = null;
let quitting = false;
const getWindow = () => win;
const native = createNative({ jar, paths, getWindow, store });

// ------------------------------------------------------------ hub
const hub = new Hub({
  store, paths, version: VERSION,
  onEvent: (type, data) => {
    win?.webContents.send('hub-event', { type, data });
    if (type === 'paired') notifyOnce('Phone connected', `${data.name} is now linked to this PC.`);
    if (type === 'notify') notifyOnce(data.title || `From ${data.from}`, data.text || '');
    if (type === 'devices' || type === 'paired') updateTray();
  },
});
function notifyOnce(title, body) { if (Notification.isSupported()) new Notification({ title, body, icon: paths.icon }).show(); }

// ------------------------------------------------------------ window
function createWindow(show = true) {
  const dark = store.get('dark');
  win = new BrowserWindow({
    width: store.get('w') || 1280, height: store.get('h') || 840, minWidth: 880, minHeight: 600,
    show: false, title: 'Lessn', icon: paths.icon, backgroundColor: dark ? '#0f1015' : '#f4f5f8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' || process.platform === 'linux' ? { color: dark ? '#0f1015' : '#f4f5f8', symbolColor: dark ? '#e8e9ee' : '#1b1c22', height: 40 } : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, spellcheck: true, backgroundThrottling: false },
  });
  win.removeMenu();
  win.loadURL('app://lessn/index.html');
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!store.get('trayHintShown')) {
      store.set('trayHintShown', true);
      notifyOnce('Lessn is still running', 'Lessn keeps running in the hidden icons of the taskbar. Right-click its icon and choose "Quit Lessn" to close it completely.');
    }
  });
  win.on('resize', () => { const [w, h] = win.getSize(); store.set('w', w); store.set('h', h); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  win.webContents.on('before-input-event', (_e, input) => { if (input.type === 'keyDown' && input.key === 'F12' && input.control && input.shift) win.webContents.toggleDevTools(); });
}
function showWindow() { if (!win) createWindow(); win.show(); if (win.isMinimized()) win.restore(); win.focus(); }

function updateTray() {
  if (!tray) return;
  const st = hub.status();
  const online = st.devices.filter((d) => d.online);
  tray.setToolTip(`Lessn${online.length ? ` · ${online.map((d) => d.name).join(', ')} connected` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lessn', click: showWindow, type: 'normal' },
    { type: 'separator' },
    { label: online.length ? `Phone connected: ${online.map((d) => d.name).join(', ')}` : 'No phone connected', enabled: false },
    { label: 'Open shared folder', click: () => shell.openPath(hub.sharedDir) },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Quit Lessn', click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(paths.icon).resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  updateTray();
  setInterval(updateTray, 30000);
}

// ------------------------------------------------------------ IPC
const DESKTOP_ONLY = {
  hubStatus: () => hub.status(),
  hubPairCode: () => hub.pairCode(),
  hubNewCode: () => { hub.newCode(); return hub.pairCode(); },
  hubUnpair: ({ id }) => hub.unpair(id),
  hubLocalToken: () => ({ token: store.get('localToken'), base: `http://127.0.0.1:${require('./hub').PORT}` }),
  hubSetName: ({ name }) => { store.set('pcName', String(name || '').slice(0, 60)); updateTray(); },
  chooseSharedDir: async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: hub.sharedDir });
    if (!r.canceled && r.filePaths[0]) store.set('sharedDir', r.filePaths[0]);
    return hub.status();
  },
  openSharedDir: () => shell.openPath(hub.sharedDir),
  /** The PC asks a phone for files: list / read (-> local file) / write / delete / mkdir / move */
  phone: async ({ device, op, path: p, to, name, filePath }) => {
    if (op === 'read') {
      const r = await hub.phoneRequest(device, { op, path: p }, { timeout: 180000 });
      const f = path.join(paths.cache, `${Date.now()}`, (r.meta.name || path.basename(p)).replace(/[\\/:*?"<>|]/g, '_'));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, r.body);
      return { path: f, name: path.basename(f), size: r.body.length, mime: r.meta.mime || '' };
    }
    if (op === 'write') {
      const blob = fs.readFileSync(filePath);
      await hub.phoneRequest(device, { op, path: p, name }, { timeout: 300000, blob });
      return { ok: true };
    }
    const r = await hub.phoneRequest(device, { op, path: p, to, name });
    return r.meta;
  },
  aiStatus: () => hub.aiStatus(),
  aiSetBase: ({ base }) => { store.set('aiLocalBase', base); return hub.aiStatus(); },
  /** Downloads a model into Ollama and reports progress events. */
  aiPull: async ({ model }) => {
    const res = await fetch(`${hub.aiBase()}/api/pull`, { method: 'POST', body: JSON.stringify({ name: model, stream: true }) });
    if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}`);
    let buf = '';
    for await (const chunk of res.body) {
      buf += Buffer.from(chunk).toString('utf8');
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) { try { const j = JSON.parse(l); win?.webContents.send('hub-event', { type: 'ai-pull', data: { model, ...j } }); if (j.error) throw new Error(j.error); } catch (e) { if (e.message && !/JSON/.test(e.message)) throw e; } }
    }
    return { ok: true };
  },
  aiDelete: async ({ model }) => { await fetch(`${hub.aiBase()}/api/delete`, { method: 'DELETE', body: JSON.stringify({ name: model }) }); return hub.aiStatus(); },
  pickFiles: async ({ multi = true, dir = false } = {}) => {
    const r = await dialog.showOpenDialog(win, { properties: [dir ? 'openDirectory' : 'openFile', ...(multi ? ['multiSelections'] : [])] });
    return r.canceled ? [] : r.filePaths.map((f) => ({ path: f, name: path.basename(f), size: fs.statSync(f).size }));
  },
  readLocal: ({ path: p }) => fs.readFileSync(p).toString('base64'),
  autostart: ({ on }) => { if (on !== undefined) app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] }); updateTray(); return app.getLoginItemSettings().openAtLogin; },
  setTheme: ({ dark }) => { store.set('dark', !!dark); },
  quit: () => { quitting = true; app.quit(); },
  version: () => ({ version: VERSION, os: `${os.type()} ${os.release()}` }),
};
ipcMain.handle('native', async (_e, name, args) => {
  const fn = native[name] || DESKTOP_ONLY[name];
  if (!fn) throw new Error(`Unknown method ${name}`);
  return fn(args || {});
});
ipcMain.handle('http', async (_e, opts) => {
  const r = await request(jar, opts);
  return { status: r.status, url: r.url, headers: r.headers, body: new Uint8Array(r.body) };
});

// ------------------------------------------------------------ start
app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; hub.stop(); });
app.on('window-all-closed', (e) => { if (!quitting) e?.preventDefault?.(); });
app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || !rel) rel = '/index.html';
    const f = path.normalize(path.join(paths.www, rel));
    if (!f.startsWith(paths.www)) return new Response('Forbidden', { status: 403 });
    if (rel.startsWith('/vendor/pdfjs/')) {
      const v = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build', path.basename(rel));
      return net.fetch(pathToFileURL(v).href);
    }
    if (rel === '/vendor/lame.min.js') return net.fetch(pathToFileURL(path.join(__dirname, 'node_modules', 'lamejs', 'lame.min.js')).href);
    return net.fetch(pathToFileURL(f).href);
  });
  // local files the app may show (cache, shared folder): lfile://local/<encoded path>
  protocol.handle('lfile', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname.slice(1));
    const roots = [paths.cache, paths.data, store.get('sharedDir') || paths.shared];
    const f = path.resolve(p);
    if (!roots.some((r) => f.startsWith(r))) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(f).href, { headers: req.headers });
  });
  createWindow(!process.argv.includes('--hidden'));
  createTray();
  hub.start();
  // a previous Lessn version wrote reminders: re-arm them
  native.schedule({ events: store.get('events') || [] });
  powerMonitor.on('resume', () => win?.webContents.send('hub-event', { type: 'resume' }));
  // clean old cached downloads (older than 3 days)
  try {
    for (const d of fs.readdirSync(paths.cache)) {
      const f = path.join(paths.cache, d);
      if (Date.now() - fs.statSync(f).mtimeMs > 3 * 86400000) fs.rmSync(f, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});
