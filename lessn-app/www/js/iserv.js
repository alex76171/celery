// IServ client: login, notifications, mail, calendar, files (WebDAV) and the messenger (Matrix).
// Cookies are kept by the Android cookie store, which the in-app IServ browser shares.
import { native, hasNative } from './native.js';

/** IServ wants the account name ("max.mustermann"), not the e-mail address. */
export function normalizeIServUser(user) {
  return String(user || '').trim().replace(/@.*$/, '').toLowerCase();
}

export function normalizeIServHost(input) {
  let s = (input || '').trim();
  try { s = new URL(/^https?:/i.test(s) ? s : 'https://' + s).hostname; } catch { /* keep */ }
  return s.toLowerCase();
}

const err = (message, code) => Object.assign(new Error(message), { code });
const pickArray = (j, keys) => {
  if (Array.isArray(j)) return j;
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o ? o[p] : undefined), j);
    if (Array.isArray(v)) return v;
  }
  return [];
};
const b64 = (s) => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '');
const isAuthPath = (url) => { try { return /^\/iserv\/auth\//.test(new URL(url).pathname); } catch { return false; } };

/** Collects the values of all <input> fields of the first form on a page. */
/** The form with the password field (login pages can have other forms before it). */
function loginForm(html) {
  return (html.match(/<form\b[\s\S]*?<\/form>/gi) || []).find((f) => /name=["']_password["']/i.test(f)) || null;
}
function errorText(html) {
  const m = html.match(/<(div|p|span)[^>]*class="[^"]*(alert-danger|alert-error|text-danger|invalid-feedback)[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
  return m ? m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
function loginError(code, message = '') {
  const texts = {
    rejected: message ? `IServ: ${message}` : 'IServ did not accept the login. Use your account name (e.g. max.mustermann, without @…) and your IServ password.',
    twofactor: 'IServ: two-factor login is on. Sign in through the IServ button instead.',
    session: 'IServ accepted the login but did not keep the session. Try again, or open IServ through the button.',
    noform: 'No IServ login page found at this address. Check the IServ address.',
    network: 'No connection to IServ.',
  };
  return err(texts[code] || texts.rejected, code === 'network' ? 'network' : 'auth');
}
function formFields(form) {
  const out = new URLSearchParams();
  for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
    const name = (tag.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!name) continue;
    const type = ((tag.match(/\btype\s*=\s*["']([^"']+)["']/i) || [])[1] || 'text').toLowerCase();
    if (['submit', 'button', 'image'].includes(type) || (['checkbox', 'radio'].includes(type) && !/\bchecked\b/i.test(tag))) continue;
    const value = (tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    out.set(name, value.replace(/&amp;/g, '&'));
  }
  return out;
}
function metaRefresh(html, base) {
  const m = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"']+)["']/i);
  if (!m) return null;
  try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { return null; }
}

export class IServ {
  constructor({ host, username, password }) {
    Object.assign(this, { host: normalizeIServHost(host), username: normalizeIServUser(username), password });
    this.loggedIn = false;
    this.matrix = null; // { token, userId }
    this.loginPromise = null;
  }

  get base() { return `https://${this.host}`; }

  async http(url, opts = {}) {
    try { return await fetch(url.startsWith('http') ? url : this.base + url, opts); }
    catch { throw err('No connection to IServ.', 'network'); }
  }

  login() {
    if (!this.loginPromise) this.loginPromise = this.doLogin().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  async doLogin() {
    if (hasNative()) {
      // Native sign-in keeps every cookie across redirects and shares them with the app's web requests
      const r = await native.iservLogin({ host: this.host, username: this.username, password: this.password });
      if (r.ok) { this.loggedIn = true; this.matrix = null; return; }
      throw loginError(r.code, r.message);
    }
    // Browser fallback (development only)
    // 1) open IServ, which redirects to the login form
    let res = await this.http('/iserv/');
    let html = await res.text();
    if (!isAuthPath(res.url || '') && !/name=["']_password["']/.test(html)) { this.loggedIn = true; return; }
    const form = loginForm(html);
    if (!form) throw loginError('noform');
    const fields = formFields(form);
    fields.set('_username', this.username);
    fields.set('_password', this.password);
    const action = (form.match(/<form[^>]+action=["']([^"']+)["']/i) || [])[1];
    const target = action ? new URL(action.replace(/&amp;/g, '&'), res.url || this.base + '/iserv/auth/login').href : (res.url || `${this.base}/iserv/auth/login`);
    // 2) submit the form
    res = await this.http(target, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fields.toString() });
    html = await res.text();
    for (let i = 0; i < 4; i++) {
      const next = metaRefresh(html, res.url || this.base);
      if (!next) break;
      res = await this.http(next); html = await res.text();
    }
    if (/two_factor_login_form/i.test(html) || /\/twofactor/.test(res.url || '')) throw loginError('twofactor');
    if (/name=["']_password["']/.test(html)) throw loginError('rejected', errorText(html));
    // 3) follow the single sign-on hops until we land inside IServ
    for (let i = 0; i < 4; i++) {
      const next = metaRefresh(html, res.url || this.base);
      if (next) { res = await this.http(next); html = await res.text(); continue; }
      res = await this.http('/iserv/');
      html = await res.text();
      if (!isAuthPath(res.url || '') && !/name=["']_password["']/.test(html)) break;
      if (/name=["']_password["']/.test(html)) throw loginError('session');
    }
    this.loggedIn = true;
    this.matrix = null;
  }

  async json(path, opts = {}, retry = true) {
    if (!this.loggedIn) await this.login();
    const res = await this.http(path, { ...opts, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-ISERV-CSRF-PROTECTION': 'yes pls', ...(opts.headers || {}) } });
    const text = await res.text();
    try { return JSON.parse(text); } catch {
      if (retry && (res.status === 401 || res.status === 403 || isAuthPath(res.url || '') || /<html/i.test(text))) {
        this.loggedIn = false;
        return this.json(path, opts, false);
      }
      if (res.status === 204 || !text) return {};
      throw err(`IServ did not answer as expected (HTTP ${res.status}).`, res.status);
    }
  }

  // ---------------------------------------------------------------- notifications
  async notifications() {
    const j = await this.json('/iserv/user/api/notifications');
    return pickArray(j, ['data.notifications', 'notifications', 'data', 'items']).map((n) => ({
      id: n.id, title: n.title || n.subject || n.trigger?.name || 'IServ',
      text: n.message || n.content || n.description || n.text || '',
      date: n.date || n.created || n.createdAt || '', url: n.url || n.link || '',
      read: !!(n.read || n.isRead || n.seen), module: n.module || n.type || n.trigger?.module || '',
    }));
  }
  readNotification(id) { return this.json(`/iserv/notification/api/v1/notifications/${id}/read`, { method: 'POST' }).catch(() => {}); }
  readAllNotifications() { return this.json('/iserv/notification/api/v1/notifications/readall', { method: 'POST' }).catch(() => {}); }

  // ---------------------------------------------------------------- mail
  get mailAccount() { return encodeURIComponent(`${this.username}@${this.host}`); }

  async folders() {
    try {
      const j = await this.json('/iserv/mail/api/folder/list');
      const flat = [];
      const walk = (list) => (list || []).forEach((f) => {
        const path = f.path || f.name || f.id;
        if (path) flat.push({ path, name: f.displayName || f.title || f.name || path, unread: f.unseen ?? f.unread ?? 0 });
        walk(f.children || f.subfolders);
      });
      walk(pickArray(j, ['data', 'folders', 'items']));
      if (flat.length) return flat;
    } catch { /* fall back */ }
    return [{ path: 'INBOX', name: 'Inbox', unread: 0 }];
  }

  async mail(folder = 'INBOX', offset = 0, limit = 30) {
    try {
      const q = new URLSearchParams({ 'mailbox[]': b64(folder), limit, offset, sort: 'date', order: 'desc' });
      const j = await this.json(`/iserv/mail/api/v2/account/${this.mailAccount}/message?${q}`);
      const items = pickArray(j, ['items', 'data']);
      if (items.length || 'items' in j) {
        return {
          total: j.total ?? items.length,
          items: items.map((m) => ({
            uid: m.id?.uid ?? m.uid, folder, subject: m.subject || '', date: m.date,
            from: (m.from || []).map((a) => a.personal || a.bare_address || '').join(', '),
            fromAddr: m.from?.[0]?.bare_address || '', seen: !!m.read, flagged: !!m.flagged,
            attachments: m.attachmentCount || 0, answered: !!m.answered,
          })),
        };
      }
    } catch (e) { if (e.code === 'network') throw e; }
    const j = await this.json(`/iserv/mail/api/message/list?path=${encodeURIComponent(folder)}&length=${limit}&start=${offset}&order%5Bcolumn%5D=date&order%5Bdir%5D=desc`);
    const items = pickArray(j, ['data', 'messages', 'items']);
    return {
      total: j.recordsTotal ?? items.length,
      items: items.map((m) => ({
        uid: m.uid || m.id, folder, subject: m.subject || '', date: m.date || m.time,
        from: (m.from && (m.from[0]?.name || m.from[0]?.email || m.from.name || m.from)) || m.sender || '',
        seen: m.seen ?? true, flagged: !!m.flagged, attachments: m.hasAttachments ? 1 : 0,
      })),
    };
  }

  async message(uid, folder = 'INBOX') {
    const j = await this.json(`/iserv/mail/api/v2/account/${this.mailAccount}/mailbox/${b64(folder)}/message/${uid}`);
    const env = j.envelope || j;
    const parts = (kind) => (j.content?.[kind] || []).map((p) => p.content).join('\n');
    return {
      subject: env.subject || '', date: env.date,
      from: (env.from || []).map((a) => ({ name: a.personal || a.bare_address, addr: a.bare_address })),
      to: (env.to || []).map((a) => a.personal || a.bare_address),
      cc: (env.cc || []).map((a) => a.personal || a.bare_address),
      html: parts('rich'), text: parts('plain'),
      attachments: (j.attachments || []).map((a) => ({ name: a.name || a.filename || 'file', size: a.size || 0, partId: a.partId })),
    };
  }

  markRead(uid, folder = 'INBOX') {
    return this.json(`/iserv/mail/api/v2/account/${this.mailAccount}/mailbox/${b64(folder)}/message/${uid}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flags: { add: ['\\Seen'] } }),
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- tasks ("Aufgaben")
  /** IServ has no JSON for tasks, so this reads the task table of the web page. */
  async exercises() {
    if (!this.loggedIn) await this.login();
    const res = await this.http('/iserv/exercise?filter%5Bstatus%5D=current');
    const html = await res.text();
    if (/name=["']_password["']/.test(html)) { this.loggedIn = false; throw err('IServ: please sign in again.', 'auth'); }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('#crud-table tbody tr, table tbody tr')].filter((r) => r.querySelector('a[href*="/exercise/show/"]'));
    const seen = new Set();
    return rows.map((r) => {
      const a = r.querySelector('a[href*="/exercise/show/"]');
      const href = a.getAttribute('href');
      const id = (href.match(/show\/(\d+)/) || [])[1] || href;
      if (seen.has(id)) return null;
      seen.add(id);
      const dates = [...r.querySelectorAll('td')].map((td) => parseIServDate(td.getAttribute('data-sort') || td.textContent)).filter(Boolean);
      const tags = [...r.querySelectorAll('.label, .badge, .tag')].map((x) => x.textContent.trim()).filter(Boolean);
      const done = /done|erledigt|abgegeben|submitted/i.test(r.className + r.textContent);
      return {
        id: `is-${id}`, title: a.textContent.trim(), url: href, start: dates.length > 1 ? Math.min(...dates) : null,
        due: dates.length ? Math.max(...dates) : null, tags, done,
      };
    }).filter(Boolean);
  }

  // ---------------------------------------------------------------- calendar
  async events() {
    const j = await this.json('/iserv/calendar/api/upcoming');
    return pickArray(j, ['events', 'data', 'items']).map((e) => ({
      title: e.title || e.summary || '', start: e.start || e.startDate || e.when || '', end: e.end || '',
      location: e.location || '', calendar: e.calendar || e.calendarName || '', allDay: !!(e.allDay || e.isAllDay),
      color: e.color || e.backgroundColor || '',
    }));
  }

  // ---------------------------------------------------------------- files (WebDAV)
  async files(path = '/') {
    const r = await native.davList({ host: `webdav.${this.host}`, path: encodeURI(path), username: this.username, password: this.password });
    if (r.status === 401) throw err('IServ: wrong username or password.', 'auth');
    if (r.status >= 400 || !r.body) throw err(`IServ files: HTTP ${r.status}`, r.status);
    const doc = new DOMParser().parseFromString(r.body, 'application/xml');
    const ns = 'DAV:';
    const self = decodeURIComponent(path).replace(/\/$/, '');
    return [...doc.getElementsByTagNameNS(ns, 'response')].map((resp) => {
      const href = decodeURIComponent(resp.getElementsByTagNameNS(ns, 'href')[0]?.textContent || '');
      const prop = (n) => resp.getElementsByTagNameNS(ns, n)[0]?.textContent || '';
      const isDir = resp.getElementsByTagNameNS(ns, 'collection').length > 0;
      const clean = href.replace(/^https?:\/\/[^/]+/, '');
      const name = prop('displayname') || clean.replace(/\/$/, '').split('/').pop();
      return { path: clean, name, isDir, size: Number(prop('getcontentlength')) || 0, modified: prop('getlastmodified'), type: prop('getcontenttype') };
    }).filter((f) => f.path.replace(/\/$/, '') !== self && f.name);
  }

  downloadFile(f) {
    const auth = 'Basic ' + btoa(unescape(encodeURIComponent(`${this.username}:${this.password}`)));
    return native.download({ url: `https://webdav.${this.host}${encodeURI(f.path)}`, filename: f.name, headers: { Authorization: auth } });
  }

  // ---------------------------------------------------------------- messenger (Matrix)
  get hs() { return this.matrix?.hs || this.base; }
  get mx() { return `${this.hs}/_matrix/client/v3`; }

  /**
   * Signs in to the IServ messenger (Matrix). Tries, in order:
   * a saved session, IServ's own token endpoint, single sign-on through the IServ session, and a password login.
   * Every attempt is recorded in this.mxLog so the app can explain what went wrong.
   */
  async matrixLogin() {
    if (this.matrix) return this.matrix;
    if (!this.mxPromise) this.mxPromise = this.doMatrixLogin().finally(() => { this.mxPromise = null; });
    return this.mxPromise;
  }

  async doMatrixLogin() {
    this.mxLog = [];
    const log = (step, ok, info = '') => this.mxLog.push({ step, ok, info: String(info).slice(0, 160) });
    const key = `lessn:mx:${this.host}:${this.username}`;
    // 0) saved session from last time (avoids a new "device" on every start)
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved?.token) {
        const r = await this.http(`${saved.hs}/_matrix/client/v3/account/whoami`, { headers: { Authorization: `Bearer ${saved.token}` } });
        if (r.ok) { this.matrix = saved; log('saved session', true); return saved; }
        log('saved session', false, `HTTP ${r.status}`);
      }
    } catch (e) { log('saved session', false, e.message); }
    const save = (m) => { this.matrix = m; try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* full */ } return m; };
    // 1) where is the Matrix server? (.well-known, else IServ itself)
    let hs = this.base;
    try {
      const r = await this.http('/.well-known/matrix/client', { headers: { Accept: 'application/json' } });
      const j = await r.json();
      if (j?.['m.homeserver']?.base_url) hs = j['m.homeserver'].base_url.replace(/\/+$/, '');
      log('server discovery', true, hs);
    } catch (e) { log('server discovery', false, 'no .well-known, using IServ'); }
    if (!this.loggedIn) await this.login();
    // 2) IServ's token endpoint (what the IServ web messenger uses)
    for (const [method, path] of [['POST', '/iserv/messenger/authenticate'], ['GET', '/iserv/messenger/authenticate'], ['GET', '/iserv/messenger/api/token'], ['POST', '/iserv/messenger/api/authenticate']]) {
      try {
        if (path === '/iserv/messenger/authenticate' && method === 'POST') await this.http('/iserv/messenger/').catch(() => {});
        const r = await this.http(path, { method, headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
        const txt = await r.text();
        let j = {};
        try { j = JSON.parse(txt); } catch { /* not JSON */ }
        const token = j.access_token || j.accessToken || j.token || j.data?.access_token;
        if (token) {
          const base = (j.home_server_url || j.homeserver || j.homeserver_url || j.base_url || j.well_known?.['m.homeserver']?.base_url || hs).replace(/\/+$/, '');
          log(`${method} ${path}`, true);
          return save({ token, userId: j.user_id || j.userId || j.mxid, hs: /^https?:/.test(base) ? base : `https://${base}`, deviceId: j.device_id || '' });
        }
        if (j.login_token || j.loginToken) {
          const m = await this.matrixTokenLogin(hs, j.login_token || j.loginToken);
          log(`${method} ${path} + login token`, true);
          return save(m);
        }
        log(`${method} ${path}`, false, `HTTP ${r.status}`);
      } catch (e) { log(`${method} ${path}`, false, e.message); }
    }
    // 3) Matrix login flows of the server
    let flows = [];
    try {
      const r = await this.http(`${hs}/_matrix/client/v3/login`, { headers: { Accept: 'application/json' } });
      flows = ((await r.json()).flows || []).map((f) => f.type);
      log('login flows', true, flows.join(', '));
    } catch (e) { log('login flows', false, e.message); }
    // 3a) single sign-on through the IServ session (no password typed again)
    if (hasNative() && (flows.includes('m.login.sso') || flows.includes('m.login.cas') || !flows.length)) {
      try {
        const back = 'https://lessn.invalid/sso';
        const r = await native.followRedirects({ url: `${hs}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(back)}`, stopAt: 'loginToken=' });
        const tok = (String(r.url).match(/[?&]loginToken=([^&#]+)/) || [])[1];
        if (tok) { const m = await this.matrixTokenLogin(hs, decodeURIComponent(tok)); log('single sign-on', true); return save(m); }
        log('single sign-on', false, `stopped at ${String(r.url).replace(/\?.*/, '')} (HTTP ${r.status})`);
      } catch (e) { log('single sign-on', false, e.message); }
    }
    // 3b) password login with the IServ account
    if (flows.includes('m.login.password') || !flows.length) {
      for (const user of [this.username, `@${this.username}:${new URL(hs).hostname}`, `@${this.username}:${this.host}`]) {
        try {
          const r = await this.http(`${hs}/_matrix/client/v3/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user }, password: this.password, initial_device_display_name: 'Lessn (Android)' }) });
          const j = await r.json().catch(() => ({}));
          if (j.access_token) { log('password login', true); return save({ token: j.access_token, userId: j.user_id, hs: (j.well_known?.['m.homeserver']?.base_url || hs).replace(/\/+$/, ''), deviceId: j.device_id }); }
          log('password login', false, j.error || `HTTP ${r.status}`);
          if (r.status !== 403 && r.status !== 400) break;
        } catch (e) { log('password login', false, e.message); break; }
      }
    }
    const e = err('Lessn could not sign in to the IServ messenger.', 'messenger');
    e.details = this.mxLog;
    throw e;
  }

  async matrixTokenLogin(hs, loginToken) {
    const r = await this.http(`${hs}/_matrix/client/v3/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'm.login.token', token: loginToken, initial_device_display_name: 'Lessn (Android)' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) throw err(j.error || `Matrix login failed (HTTP ${r.status})`, r.status);
    return { token: j.access_token, userId: j.user_id, hs: (j.well_known?.['m.homeserver']?.base_url || hs).replace(/\/+$/, ''), deviceId: j.device_id };
  }

  forgetMatrix() {
    this.matrix = null;
    try { localStorage.removeItem(`lessn:mx:${this.host}:${this.username}`); } catch { /* ignore */ }
  }

  async mxFetch(path, opts = {}, retry = true) {
    const m = await this.matrixLogin();
    const res = await this.http(this.mx + path, { ...opts, headers: { Authorization: `Bearer ${m.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (res.status === 401 && retry) { this.forgetMatrix(); return this.mxFetch(path, opts, false); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw err(j.error || `Messenger error ${res.status}`, res.status);
    return j;
  }

  /** Full room list with names, last message and unread counts. Also returns a sync token. */
  async rooms() {
    const filter = JSON.stringify({ room: { timeline: { limit: 1 }, state: { lazy_load_members: true } } });
    const j = await this.mxFetch(`/sync?timeout=0&filter=${encodeURIComponent(filter)}`);
    this.since = j.next_batch;
    const direct = new Set();
    for (const ev of j.account_data?.events || []) if (ev.type === 'm.direct') Object.values(ev.content || {}).flat().forEach((id) => direct.add(id));
    const me = this.matrix.userId || j.account_data?.user_id;
    this.invites = Object.entries(j.rooms?.invite || {}).map(([id, r]) => {
      const ev = r.invite_state?.events || [];
      const inviter = ev.find((e) => e.type === 'm.room.member' && e.state_key === me)?.sender;
      const nameOf = (u) => ev.find((e) => e.type === 'm.room.member' && e.state_key === u)?.content?.displayname || shortId(u);
      return { id, name: ev.find((e) => e.type === 'm.room.name')?.content?.name || (inviter ? nameOf(inviter) : 'Chat'), from: inviter ? nameOf(inviter) : '' };
    });
    return Object.entries(j.rooms?.join || {}).map(([id, r]) => {
      const state = [...(r.state?.events || []), ...(r.timeline?.events || [])];
      const names = {};
      state.filter((e) => e.type === 'm.room.member').forEach((e) => { if (e.content?.displayname) names[e.state_key] = e.content.displayname; });
      let name = state.find((e) => e.type === 'm.room.name')?.content?.name;
      if (!name) {
        const hero = (r.summary?.['m.heroes'] || []).find((h) => h !== me);
        name = names[hero] || Object.entries(names).find(([k]) => k !== me)?.[1] || hero || 'Chat';
      }
      const last = (r.timeline?.events || []).filter((e) => (e.type === 'm.room.message' && e.content?.['m.relates_to']?.rel_type !== 'm.replace') || e.type === 'm.room.encrypted').pop();
      return {
        id, name, direct: direct.has(id), encrypted: state.some((e) => e.type === 'm.room.encryption'),
        unread: r.unread_notifications?.notification_count || 0,
        members: r.summary?.['m.joined_member_count'] || 0,
        last: last ? { body: last.type === 'm.room.encrypted' ? null : messageText(last), sender: names[last.sender] || shortId(last.sender), mine: last.sender === me, ts: last.origin_server_ts } : null,
      };
    }).sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));
  }

  async messages(roomId, from) {
    const q = new URLSearchParams({ dir: 'b', limit: '40', filter: JSON.stringify({ lazy_load_members: true }) });
    if (from) q.set('from', from);
    const j = await this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/messages?${q}`);
    const names = {};
    (j.state || []).forEach((e) => { if (e.type === 'm.room.member' && e.content?.displayname) names[e.state_key] = e.content.displayname; });
    const me = this.matrix.userId;
    const msgs = applyEdits((j.chunk || []).filter((e) => e.type === 'm.room.message' || e.type === 'm.room.encrypted')).map((e) => toMsg(e, names, me)).sort((x, y) => x.ts - y.ts);
    return { messages: msgs, end: j.end, names };
  }

  /** Long-polls for new events. Returns {roomId: [messages]}. */
  async poll(timeout = 20000) {
    if (!this.since) { await this.rooms(); return {}; }
    const filter = JSON.stringify({ room: { timeline: { limit: 30, types: ['m.room.message', 'm.room.encrypted'] }, state: { lazy_load_members: true } }, presence: { not_types: ['*'] } });
    const j = await this.mxFetch(`/sync?timeout=${timeout}&since=${encodeURIComponent(this.since)}&filter=${encodeURIComponent(filter)}`);
    this.since = j.next_batch;
    const me = this.matrix.userId;
    const out = {};
    for (const [id, r] of Object.entries(j.rooms?.join || {})) {
      const names = {};
      (r.state?.events || []).forEach((e) => { if (e.type === 'm.room.member' && e.content?.displayname) names[e.state_key] = e.content.displayname; });
      const msgs = applyEdits(r.timeline?.events || []).map((e) => toMsg(e, names, me));
      if (msgs.length) out[id] = msgs;
    }
    return out;
  }

  join(roomId) { return this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/join`, { method: 'POST', body: '{}' }); }

  async send(roomId, body) {
    const txn = `lessn${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    return this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, { method: 'PUT', body: JSON.stringify({ msgtype: 'm.text', body }) });
  }

  // ---------------------------------------------------------------- messenger media
  async mediaV1() {
    if (this.hasV1 !== undefined) return this.hasV1;
    try {
      const m = await this.matrixLogin();
      const r = await native.raw({ url: `${this.hs}/_matrix/client/v1/media/config`, headers: { Authorization: `Bearer ${m.token}` } });
      this.hasV1 = r.status === 200;
    } catch { this.hasV1 = false; }
    return this.hasV1;
  }

  async mediaUrl(mxc, kind = 'download', name = '') {
    const [server, id] = String(mxc).replace(/^mxc:\/\//, '').split('/');
    const v1 = await this.mediaV1();
    const base = v1 ? `${this.hs}/_matrix/client/v1/media` : `${this.hs}/_matrix/media/v3`;
    if (kind === 'thumbnail') return `${base}/thumbnail/${server}/${id}?width=720&height=720&method=scale`;
    return `${base}/download/${server}/${id}${name ? `/${encodeURIComponent(name)}` : ''}`;
  }

  /** Media as a data: URL (images, voice messages). */
  async mediaData(mxc, kind = 'thumbnail') {
    const m = await this.matrixLogin();
    const r = await native.raw({ url: await this.mediaUrl(mxc, kind), headers: { Authorization: `Bearer ${m.token}` }, base64: true });
    if (r.status >= 400) throw err(`Media error ${r.status}`, r.status);
    return `data:${(r.contentType || 'application/octet-stream').split(';')[0]};base64,${r.data}`;
  }

  async downloadMedia(mxc, name) {
    const m = await this.matrixLogin();
    return native.download({ url: await this.mediaUrl(mxc, 'download', name), filename: name || 'file', headers: { Authorization: `Bearer ${m.token}` } });
  }

  async upload({ base64, path, mime, name }) {
    const m = await this.matrixLogin();
    const r = await native.raw({
      url: `${this.hs}/_matrix/media/v3/upload?filename=${encodeURIComponent(name)}`, method: 'POST',
      headers: { Authorization: `Bearer ${m.token}`, 'Content-Type': mime || 'application/octet-stream' },
      ...(path ? { bodyPath: path } : { bodyBase64: base64 }),
    });
    let j = {};
    try { j = JSON.parse(r.data); } catch { /* handled below */ }
    if (r.status >= 400 || !j.content_uri) throw err(j.error || `Upload failed (${r.status})`, r.status);
    return j.content_uri;
  }

  async sendContent(roomId, content) {
    const txn = `lessn${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    return this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, { method: 'PUT', body: JSON.stringify(content) });
  }

  async sendImage(roomId, { base64, mime, name, w, h, size }) {
    const url = await this.upload({ base64, mime, name });
    return this.sendContent(roomId, { msgtype: 'm.image', body: name, url, info: { mimetype: mime, size, w, h } });
  }

  async sendFile(roomId, { base64, mime, name, size }) {
    const url = await this.upload({ base64, mime, name });
    return this.sendContent(roomId, { msgtype: 'm.file', body: name, filename: name, url, info: { mimetype: mime, size } });
  }

  async sendVoice(roomId, { path, duration, size, mime = 'audio/mp4' }) {
    const url = await this.upload({ path, mime, name: mime.includes('webm') ? 'voice-message.webm' : 'voice-message.m4a' });
    return this.sendContent(roomId, {
      msgtype: 'm.audio', body: 'Voice message', url, info: { mimetype: mime, size, duration },
      'org.matrix.msc1767.audio': { duration }, 'org.matrix.msc3245.voice': {},
    });
  }

  redact(roomId, eventId) {
    const txn = `lessn${Date.now()}`;
    return this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${txn}`, { method: 'PUT', body: '{}' });
  }

  async searchUsers(term) {
    const j = await this.mxFetch('/user_directory/search', { method: 'POST', body: JSON.stringify({ search_term: term, limit: 20 }) });
    return (j.results || []).filter((u) => u.user_id !== this.matrix.userId).map((u) => ({ id: u.user_id, name: u.display_name || shortId(u.user_id) }));
  }

  async createDirect(userId) {
    const j = await this.mxFetch('/createRoom', { method: 'POST', body: JSON.stringify({ is_direct: true, invite: [userId], preset: 'trusted_private_chat' }) });
    try {
      const me = encodeURIComponent(this.matrix.userId);
      const cur = await this.mxFetch(`/user/${me}/account_data/m.direct`).catch(() => ({}));
      cur[userId] = [...(cur[userId] || []), j.room_id];
      await this.mxFetch(`/user/${me}/account_data/m.direct`, { method: 'PUT', body: JSON.stringify(cur) });
    } catch { /* not important */ }
    return j.room_id;
  }

  // ---------------------------------------------------------------- files: write operations (WebDAV)
  get davAuth() { return `Basic ${btoa(unescape(encodeURIComponent(`${this.username}:${this.password}`)))}`; }
  davUrl(path) { return `https://webdav.${this.host}${encodeURI(path)}`; }

  async fileData(path) {
    const r = await native.raw({ url: this.davUrl(path), headers: { Authorization: this.davAuth }, base64: true });
    if (r.status >= 400) throw err(`IServ files: HTTP ${r.status}`, r.status);
    return `data:${(r.contentType || 'application/octet-stream').split(';')[0]};base64,${r.data}`;
  }

  async uploadFile(folder, { name, base64, mime }) {
    const r = await native.raw({ url: this.davUrl(folder.replace(/\/?$/, '/') + name), method: 'PUT', headers: { Authorization: this.davAuth, 'Content-Type': mime || 'application/octet-stream' }, bodyBase64: base64 });
    if (r.status >= 400) throw err(`Upload failed (HTTP ${r.status})`, r.status);
  }

  async davOp(method, path, headers = {}) {
    const r = await native.davRequest({ host: `webdav.${this.host}`, method, path: encodeURI(path), username: this.username, password: this.password, headers });
    if (r.status >= 400) throw err(`IServ files: HTTP ${r.status}`, r.status);
    return r;
  }
  mkdir(path) { return this.davOp('MKCOL', path); }
  remove(path) { return this.davOp('DELETE', path); }
  move(from, to) { return this.davOp('MOVE', from, { Destination: this.davUrl(to), Overwrite: 'F' }); }

  // ---------------------------------------------------------------- task details (web page)
  async exerciseDetails(url) {
    if (!this.loggedIn) await this.login();
    const res = await this.http(url.startsWith('http') ? url : url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pick = (sel) => [...doc.querySelectorAll(sel)].map((x) => x.textContent.replace(/\s+\n/g, '\n').trim()).filter(Boolean);
    const text = pick('.text-break-word, .exercise-text, .panel-body .text, .card-body .text').join('\n\n')
      || (doc.querySelector('main, #content, .content')?.innerText || '').trim().slice(0, 4000);
    const files = [...doc.querySelectorAll('a[href*="/file/"], a[href*="download"], a[href*="attachment"]')]
      .map((a) => ({ name: a.textContent.trim() || 'file', href: a.getAttribute('href') })).filter((f) => f.name.length < 140);
    const teacher = (pick('.bt0.pt-0.pl-0, [class*="author"]')[0] || '');
    return { text, files, teacher };
  }

  markRoomRead(roomId, eventId) {
    if (!eventId) return Promise.resolve();
    return this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`, { method: 'POST', body: '{}' }).catch(() => {});
  }
}

/** Turns IServ date cells (unix time, ISO or dd.mm.yyyy) into a yyyymmdd number. */
function parseIServDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let d = null;
  if (/^\d{9,11}$/.test(s)) d = new Date(Number(s) * 1000);
  else if (/^\d{12,14}$/.test(s)) d = new Date(Number(s));
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s.slice(0, 10));
  else { const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); }
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

const shortId = (id) => String(id || '').replace(/^@/, '').split(':')[0];
/** Edits replace the original message's text; the edit events themselves are hidden. */
function applyEdits(events) {
  const edits = {};
  for (const e of events) {
    const rel = e.content?.['m.relates_to'];
    if (rel?.rel_type === 'm.replace' && rel.event_id && e.content['m.new_content']) edits[rel.event_id] = e.content['m.new_content'];
  }
  return events.filter((e) => e.content?.['m.relates_to']?.rel_type !== 'm.replace').map((e) => (edits[e.event_id] ? { ...e, content: { ...e.content, ...edits[e.event_id] }, edited: true } : e));
}
/** Removes the quoted "> <@user> ..." fallback of replies. */
const stripReply = (body) => String(body || '').replace(/^(> .*\n?)+\n?/, '');
function messageText(e) {
  const c = e.content || {};
  if (c['m.relates_to']?.['m.in_reply_to'] && c.msgtype === 'm.text') return stripReply(c.body);
  const kind = { 'm.image': '[Photo]', 'm.file': `[File] ${c.body || ''}`, 'm.video': '[Video]', 'm.audio': '[Audio]' }[c.msgtype];
  return kind || c.body || '';
}
function toMsg(e, names, me) {
  const enc = e.type === 'm.room.encrypted';
  return {
    id: e.event_id, sender: e.sender, name: names[e.sender] || shortId(e.sender), mine: e.sender === me,
    ts: e.origin_server_ts, encrypted: enc, kind: enc ? 'encrypted' : (e.content?.msgtype || 'm.text'),
    body: enc ? '' : messageText(e), file: e.content?.msgtype === 'm.file' ? e.content.body : '',
    mxc: e.content?.url || '', info: e.content?.info || {}, filename: e.content?.filename || e.content?.body || '',
    redacted: !!e.unsigned?.redacted_because || (e.type === 'm.room.message' && !e.content?.msgtype),
    edited: !!e.edited, notice: e.content?.msgtype === 'm.notice' || e.content?.msgtype === 'm.emote',
  };
}
