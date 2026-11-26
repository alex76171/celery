// The Windows side of the app's "LessnNative" plugin. Same method names and results as the Android plugin,
// so the shared web code runs unchanged. Things that only make sense on a phone (Do Not Disturb, GPS) say so.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { app, shell, Notification, BrowserWindow, session, nativeImage } = require('electron');
const { request } = require('./http');

const unsupported = (what) => { const e = new Error(`${what} is only available on the phone.`); e.code = 'web'; throw e; };
const safeName = (n) => String(n || 'file').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'file';
const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', xml: 'text/xml',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', mp4: 'video/mp4', mov: 'video/quicktime',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip',
};
const mimeOf = (name, type) => MIME[String(name).split('.').pop().toLowerCase()] || (type && !/octet-stream/.test(type) ? type.split(';')[0].trim() : 'application/octet-stream');

function createNative(ctx) {
  const { jar, paths, getWindow, store } = ctx;
  const cacheDir = () => { const d = path.join(paths.cache, String(Date.now()) + Math.random().toString(36).slice(2, 6)); fs.mkdirSync(d, { recursive: true }); return d; };
  /** Only files the app made or the user shared may be read through the bridge. */
  const allowed = (p) => {
    const f = path.resolve(p);
    return [paths.cache, paths.data, store.get('sharedDir') || paths.shared].some((root) => f === root || f.startsWith(root + path.sep));
  };
  const safePath = (p) => { if (!p || !allowed(p)) throw new Error('Invalid path'); return path.resolve(p); };
  const timers = new Map();

  const notify = (title, body) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body: body || '', icon: paths.icon, silent: false });
    n.on('click', () => { const w = getWindow(); w?.show(); w?.focus(); });
    n.show();
  };

  // ------------------------------------------------------------ IServ sign-in (same steps as the Android IServSession)
  const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')); return m ? (m[1] ?? m[2]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'") : null; };
  const hasLoginForm = (html) => /name\s*=\s*["']_password["']/i.test(html || '');
  const loginForm = (html) => (html.match(/<form\b[\s\S]*?<\/form>/gi) || []).find(hasLoginForm) || null;
  const metaRefresh = (html) => { const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i); const c = m && attr(m[0], 'content'); const u = c && c.trim().match(/url=(.+)$/i); return u ? u[1].trim().replace(/^['"]|['"]$/g, '') : null; };
  const errorText = (html) => {
    const re = /<(div|p|span)[^>]*class="[^"]*(alert-danger|alert-error|text-danger|error|invalid-feedback)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(html))) { const t = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); if (t && t.length < 200) return t; }
    return '';
  };
  async function iservLogin({ host, username, password }) {
    const base = `https://${host}`;
    const get = async (u, extra = {}) => { const r = await request(jar, { url: u.startsWith('http') ? u : base + u, headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', ...extra } }); return { code: r.status, url: r.url, body: r.body.toString('utf8') }; };
    try {
      let r = await get('/iserv/');
      if (!hasLoginForm(r.body) && !r.url.includes('/iserv/auth/')) return { ok: true, code: 'ok' };
      const form = loginForm(r.body);
      if (!form) return { ok: false, code: 'noform' };
      const data = new URLSearchParams();
      for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
        const name = attr(tag, 'name');
        if (!name || name === '_username' || name === '_password') continue;
        const type = (attr(tag, 'type') || 'text').toLowerCase();
        if ((type === 'checkbox' || type === 'radio') && !/checked/i.test(tag)) continue;
        if (['submit', 'button', 'image'].includes(type)) continue;
        data.append(name, attr(tag, 'value') || '');
      }
      data.append('_username', username); data.append('_password', password);
      const action = attr((form.match(/<form\b[^>]*>/i) || [''])[0], 'action');
      const target = action ? new URL(action, r.url).href : r.url;
      let res = await request(jar, { url: target, method: 'POST', body: data.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base, Referer: r.url } });
      let page = { url: res.url, body: res.body.toString('utf8') };
      for (let i = 0; i < 5; i++) { const n = metaRefresh(page.body); if (!n) break; page = await get(new URL(n, page.url).href); }
      if (page.url.includes('/twofactor') || page.body.includes('two_factor_login_form')) return { ok: false, code: 'twofactor' };
      if (hasLoginForm(page.body)) return { ok: false, code: 'rejected', message: errorText(page.body) };
      let check = await get('/iserv/');
      for (let i = 0; i < 3 && check.url.includes('/iserv/auth/auth'); i++) { const n = metaRefresh(check.body); check = await get(n ? new URL(n, check.url).href : '/iserv/'); }
      if (hasLoginForm(check.body)) return { ok: false, code: 'session' };
      return { ok: true, code: 'ok' };
    } catch (e) { return { ok: false, code: 'network', message: e.message }; }
  }

  // ------------------------------------------------------------ the methods
  const M = {
    status: () => ({ platform: 'windows', notifications: Notification.isSupported(), dnd: false, exactAlarms: true, location: false, desktop: true }),
    requestPermissions: ({ permissions = [] } = {}) => Object.fromEntries(permissions.map((p) => [p, p === 'location' || p === 'backgroundLocation' ? 'denied' : 'granted'])),
    checkPermissions: () => ({ notifications: 'granted', microphone: 'granted', location: 'denied' }),

    /** Lesson reminders and change alerts as Windows notifications (Do Not Disturb is phone-only). */
    schedule: ({ events = [] } = {}) => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      const now = Date.now();
      for (const e of events) {
        if (e.type !== 'remind' || !e.at || e.at < now - 60000 || e.at - now > 2 ** 31 - 1) continue;
        timers.set(e.id, setTimeout(() => notify(e.title, e.body), Math.max(0, e.at - now)));
      }
      store.set('events', events.filter((e) => e.type === 'remind'));
    },
    openDndSettings: () => unsupported('Do Not Disturb'),
    openAppSettings: () => { shell.openExternal('ms-settings:notifications'); },
    openUrl: ({ url }) => { if (/^(https?|mailto|ms-settings):/i.test(url)) shell.openExternal(url); },
    getLocation: () => unsupported('Location'),
    getPresenceLog: () => ({ log: JSON.stringify(store.get('presence') || {}) }),
    setPresence: ({ date, status }) => { const p = store.get('presence') || {}; if (status) p[date] = status; else delete p[date]; store.set('presence', p); },

    readFileBase64: async ({ path: p }) => { const f = safePath(p); const b = await fsp.readFile(f); return { data: b.toString('base64'), size: b.length }; },
    deleteFile: async ({ path: p }) => { try { await fsp.rm(safePath(p), { force: true }); } catch { /* ignore */ } },
    writeCache: async ({ name, base64 }) => { const f = path.join(cacheDir(), safeName(name)); await fsp.writeFile(f, Buffer.from(base64 || '', 'base64')); return { path: f, mime: mimeOf(name) }; },
    /** Saves bytes made in the window (recordings, voice messages) and returns the path. */
    writeBytes: async ({ name, bytes }) => { const f = path.join(cacheDir(), safeName(name)); await fsp.writeFile(f, Buffer.from(bytes)); return { path: f, size: bytes.byteLength || bytes.length }; },

    iservLogin,
    setIServBackground: (o) => { store.set('iservBackground', { enabled: !!o.enabled, host: o.host, username: o.username }); },
    setBars: ({ top, dark }) => {
      const w = getWindow();
      if (w && process.platform === 'win32' && w.setTitleBarOverlay) {
        try { w.setTitleBarOverlay({ color: top || (dark ? '#0f1015' : '#f4f5f8'), symbolColor: dark ? '#e8e9ee' : '#1b1c22', height: 40 }); } catch { /* old Windows */ }
      }
      if (w && top) w.setBackgroundColor(top);
    },

    rawRequest: async (o) => {
      const r = await request(jar, { url: o.url, method: o.method, headers: o.headers, body: o.bodyBase64 ? Buffer.from(o.bodyBase64, 'base64') : o.bodyPath ? await fsp.readFile(safePath(o.bodyPath)) : undefined, cookies: true });
      const ct = (r.headers.find(([k]) => k === 'content-type') || [])[1] || '';
      return { status: r.status, contentType: ct, data: o.base64 ? r.body.toString('base64') : r.body.toString('utf8') };
    },
    davRequest: async ({ host, method, path: p, username, password, headers = {} }) => {
      const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      const r = await request(jar, { url: `https://${host}${p}`, method, headers: { Authorization: auth, ...headers }, cookies: false, redirect: 'manual' });
      return { status: r.status, body: r.body.toString('utf8') };
    },
    davList: async ({ host, path: p, username, password }) => {
      const auth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      const body = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:resourcetype/></d:prop></d:propfind>';
      const r = await request(jar, { url: `https://${host}${p}`, method: 'PROPFIND', headers: { Authorization: auth, Depth: '1', 'Content-Type': 'application/xml' }, body, cookies: false, redirect: 'manual' });
      return { status: r.status, body: r.body.toString('utf8') };
    },

    /** Downloads into the cache so the viewer can show it. */
    fetchFile: async (o) => {
      const r = await request(jar, { url: o.url, headers: o.headers, cookies: o.cookies !== false, timeout: 300000 });
      if (r.status >= 400) return { status: r.status };
      let name = o.name;
      const disp = (r.headers.find(([k]) => k === 'content-disposition') || [])[1];
      if (!name && disp) { const m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i); if (m) name = decodeURIComponent(m[1]); }
      name = safeName(name || 'file');
      const f = path.join(cacheDir(), name);
      await fsp.writeFile(f, r.body);
      const ct = (r.headers.find(([k]) => k === 'content-type') || [])[1] || '';
      return { status: r.status, path: f, name, size: r.body.length, mime: mimeOf(name, ct), contentType: ct };
    },
    followRedirects: async ({ url, stopAt = 'loginToken=' }) => {
      let cur = url; let status = 0; let body = '';
      for (let i = 0; i < 15 && !cur.includes(stopAt); i++) {
        const r = await request(jar, { url: cur, redirect: 'manual' });
        status = r.status;
        const loc = (r.headers.find(([k]) => k === 'location') || [])[1];
        if (status >= 300 && status < 400 && loc) { cur = new URL(loc, cur).href; continue; }
        body = r.body.toString('utf8');
        const m = body.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>]+)/i);
        if (m) { cur = new URL(m[1].replace(/&amp;/g, '&'), cur).href; continue; }
        break;
      }
      return { url: cur, status, body: body.slice(0, 20000) };
    },
    openFile: async ({ path: p }) => { const err = await shell.openPath(safePath(p)); if (err) { const e = new Error('No app can open this file'); e.code = 'noapp'; throw e; } },
    shareFile: ({ path: p }) => { if (p) shell.showItemInFolder(safePath(p)); },
    saveFile: async ({ path: p, name }) => {
      const dir = app.getPath('downloads');
      let target = path.join(dir, safeName(name || path.basename(p)));
      for (let i = 1; fs.existsSync(target) && i < 100; i++) { const ext = path.extname(name || p); target = path.join(dir, `${path.basename(safeName(name || p), ext)} (${i})${ext}`); }
      await fsp.copyFile(safePath(p), target);
      shell.showItemInFolder(target);
    },
    download: async (o) => {
      const r = await M.fetchFile({ url: o.url, headers: o.headers, name: o.filename });
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      await M.saveFile({ path: r.path, name: o.filename });
      notify(o.filename, 'Saved to Downloads');
    },
    openIServ: async ({ url, css, bg }) => {
      const ses = session.fromPartition('persist:iserv');
      const host = new URL(url).hostname;
      for (const c of jar.forHost(host)) {
        await ses.cookies.set({ url: `https://${c.domain}${c.path}`, name: c.name, value: c.value, domain: c.hostOnly ? undefined : c.domain, path: c.path, secure: c.secure, expirationDate: c.expires ? c.expires / 1000 : undefined }).catch(() => {});
      }
      const w = new BrowserWindow({ width: 1200, height: 820, backgroundColor: bg || '#ffffff', autoHideMenuBar: true, icon: paths.icon, parent: undefined, webPreferences: { partition: 'persist:iserv', sandbox: true } });
      w.webContents.on('did-finish-load', () => { if (css) w.webContents.insertCSS(css).catch(() => {}); });
      w.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: 'deny' }; });
      w.webContents.session.on('will-download', (_e, item) => { item.setSavePath(path.join(app.getPath('downloads'), safeName(item.getFilename()))); item.once('done', () => notify(item.getFilename(), 'Saved to Downloads')); });
      w.loadURL(url);
    },
    notify: ({ title, body }) => notify(title, body),
    /** OAuth sign-in: waits for the browser to come back to http://localhost:<port>/... and returns that path. */
    oauthListen: ({ port = 3000, timeout = 300000 } = {}) => new Promise((resolve, reject) => {
      const http = require('node:http');
      const srv = http.createServer((req, res) => {
        if (req.url.startsWith('/favicon')) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><body style="font-family:Segoe UI,sans-serif;text-align:center;padding:60px"><h2>Signed in</h2><p>You can close this tab and go back to Lessn.</p></body>');
        clearTimeout(timer); srv.close();
        const w = getWindow(); if (w) { w.show(); w.focus(); }
        resolve({ path: req.url });
      });
      const timer = setTimeout(() => { srv.close(); const e = new Error('Sign-in timed out'); e.code = 'timeout'; reject(e); }, timeout);
      srv.on('error', (e) => { clearTimeout(timer); reject(e); });
      srv.listen(port, '127.0.0.1');
    }),
    // Phone-only features
    startRecording: () => unsupported('Background recording'),
    voiceStart: () => unsupported('Voice recording'),
  };
  return M;
}

module.exports = { createNative, mimeOf, safeName };
