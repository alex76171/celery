// IServ client: login, notifications, mail, calendar, files (WebDAV) and the messenger (Matrix).
// Cookies are kept by the Android cookie store, which the in-app IServ browser shares.
import { native } from './native.js';

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
function formFields(html) {
  const out = new URLSearchParams();
  const form = (html.match(/<form[\s\S]*?<\/form>/i) || [html])[0];
  for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
    const name = (tag.match(/\bname\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!name) continue;
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
    Object.assign(this, { host: normalizeIServHost(host), username, password });
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
    // 1) open IServ, which redirects to the login form
    let res = await this.http('/iserv/');
    let html = await res.text();
    if (!isAuthPath(res.url || '') && !/name=["']_password["']/.test(html)) { this.loggedIn = true; return; }
    const fields = formFields(html);
    fields.set('_username', this.username);
    fields.set('_password', this.password);
    const action = (html.match(/<form[^>]+action=["']([^"']+)["']/i) || [])[1];
    const target = action ? new URL(action.replace(/&amp;/g, '&'), res.url || this.base + '/iserv/auth/login').href : (res.url || `${this.base}/iserv/auth/login`);
    // 2) submit the form
    res = await this.http(target, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fields.toString() });
    html = await res.text();
    if (/Anmeldung fehlgeschlagen|Login failed/i.test(html)) throw err('IServ: wrong username or password.', 'auth');
    if (/Account existiert nicht/i.test(html)) throw err('IServ: this account does not exist.', 'auth');
    if (/two_factor_login_form|twofactor/i.test(html + (res.url || ''))) throw err('IServ: two-factor login is on. Sign in through the IServ button instead.', 'auth');
    // 3) follow the single sign-on hops until we land inside IServ
    for (let i = 0; i < 4; i++) {
      const next = metaRefresh(html, res.url || this.base);
      if (next) { res = await this.http(next); html = await res.text(); continue; }
      res = await this.http('/iserv/');
      html = await res.text();
      if (!isAuthPath(res.url || '') && !/name=["']_password["']/.test(html)) break;
      if (/name=["']_password["']/.test(html)) throw err('IServ: wrong username or password.', 'auth');
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
  get mx() { return `${this.base}/_matrix/client/v3`; }

  async matrixLogin() {
    if (this.matrix) return this.matrix;
    if (!this.loggedIn) await this.login();
    await this.http('/iserv/messenger/');
    const res = await this.http('/iserv/messenger/authenticate', { method: 'POST', headers: { Accept: '*/*' } });
    let j = {};
    try { j = await res.json(); } catch { /* handled below */ }
    if (!j.access_token) throw err('IServ messenger is not available for your account.', 'messenger');
    this.matrix = { token: j.access_token, userId: j.user_id };
    return this.matrix;
  }

  async mxFetch(path, opts = {}, retry = true) {
    const m = await this.matrixLogin();
    const res = await this.http(this.mx + path, { ...opts, headers: { Authorization: `Bearer ${m.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (res.status === 401 && retry) { this.matrix = null; this.loggedIn = false; return this.mxFetch(path, opts, false); }
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
    const me = this.matrix.userId;
    return Object.entries(j.rooms?.join || {}).map(([id, r]) => {
      const state = [...(r.state?.events || []), ...(r.timeline?.events || [])];
      const names = {};
      state.filter((e) => e.type === 'm.room.member').forEach((e) => { if (e.content?.displayname) names[e.state_key] = e.content.displayname; });
      let name = state.find((e) => e.type === 'm.room.name')?.content?.name;
      if (!name) {
        const hero = (r.summary?.['m.heroes'] || []).find((h) => h !== me);
        name = names[hero] || Object.entries(names).find(([k]) => k !== me)?.[1] || hero || 'Chat';
      }
      const last = (r.timeline?.events || []).filter((e) => e.type === 'm.room.message' || e.type === 'm.room.encrypted').pop();
      return {
        id, name, direct: direct.has(id),
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
    const msgs = (j.chunk || []).filter((e) => e.type === 'm.room.message' || e.type === 'm.room.encrypted').map((e) => toMsg(e, names, me)).sort((x, y) => x.ts - y.ts);
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
      const msgs = (r.timeline?.events || []).map((e) => toMsg(e, names, me));
      if (msgs.length) out[id] = msgs;
    }
    return out;
  }

  async send(roomId, body) {
    const txn = `lessn${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    return this.mxFetch(`/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, { method: 'PUT', body: JSON.stringify({ msgtype: 'm.text', body }) });
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
function messageText(e) {
  const c = e.content || {};
  const kind = { 'm.image': '[Photo]', 'm.file': `[File] ${c.body || ''}`, 'm.video': '[Video]', 'm.audio': '[Audio]' }[c.msgtype];
  return kind || c.body || '';
}
function toMsg(e, names, me) {
  const enc = e.type === 'm.room.encrypted';
  return {
    id: e.event_id, sender: e.sender, name: names[e.sender] || shortId(e.sender), mine: e.sender === me,
    ts: e.origin_server_ts, encrypted: enc, kind: enc ? 'encrypted' : (e.content?.msgtype || 'm.text'),
    body: enc ? '' : messageText(e), file: e.content?.msgtype === 'm.file' ? e.content.body : '',
  };
}
