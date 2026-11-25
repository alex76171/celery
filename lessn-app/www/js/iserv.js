// IServ client. Signs in with the same flow the IServ website uses; cookies live in the
// Android WebView cookie store, which CapacitorHttp and the in-app IServ browser share.

export function normalizeIServHost(input) {
  let s = (input || '').trim();
  try { s = new URL(/^https?:/i.test(s) ? s : 'https://' + s).hostname; } catch { /* keep */ }
  return s.toLowerCase();
}

const pickArray = (j, keys) => {
  if (Array.isArray(j)) return j;
  for (const k of keys) {
    const v = k.split('.').reduce((o, p) => (o ? o[p] : undefined), j);
    if (Array.isArray(v)) return v;
  }
  return [];
};

export class IServ {
  constructor({ host, username, password }) {
    Object.assign(this, { host: normalizeIServHost(host), username, password });
    this.loggedIn = false;
  }

  get base() { return `https://${this.host}/iserv`; }

  async login() {
    const body = new URLSearchParams({ _username: this.username, _password: this.password }).toString();
    let res;
    try {
      res = await fetch(`${this.base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    } catch { throw Object.assign(new Error('No connection to IServ.'), { code: 'network' }); }
    const text = await res.text();
    if (/Anmeldung fehlgeschlagen|Login failed|Benutzername oder Passwort/i.test(text)) {
      throw Object.assign(new Error('IServ: wrong username or password.'), { code: 'auth' });
    }
    // Finish the single sign-on hop so the IServ session cookies get set
    try {
      const home = await (await fetch(`${this.base}/`)).text();
      const m = home.match(/url=([^"\s>]+)/i);
      if (m) await fetch(m[1].replace(/&amp;/g, '&'));
    } catch { /* not fatal */ }
    this.loggedIn = true;
  }

  async json(path, retry = true) {
    if (!this.loggedIn) await this.login();
    let res;
    try { res = await fetch(`${this.base}${path}`, { headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' } }); }
    catch { throw Object.assign(new Error('No connection to IServ.'), { code: 'network' }); }
    const text = await res.text();
    try { return JSON.parse(text); } catch {
      if (retry) { this.loggedIn = false; return this.json(path, false); }
      throw new Error('IServ did not answer as expected.');
    }
  }

  async notifications() {
    const j = await this.json('/user/api/notifications');
    return pickArray(j, ['data.notifications', 'notifications', 'data', 'items']).map((n) => ({
      id: n.id, title: n.title || n.subject || n.trigger?.name || 'IServ',
      text: n.message || n.content || n.description || n.text || '',
      date: n.date || n.created || n.createdAt || '', url: n.url || n.link || '',
      read: !!(n.read || n.isRead || n.seen),
    }));
  }

  async mail() {
    const j = await this.json('/mail/api/message/list?path=INBOX&length=30&start=0&order%5Bcolumn%5D=date&order%5Bdir%5D=desc');
    return pickArray(j, ['data', 'messages', 'items']).map((m) => ({
      id: m.uid || m.id, subject: m.subject || '(no subject)',
      from: (m.from && (m.from[0]?.name || m.from[0]?.email || m.from.name || m.from)) || m.sender || '',
      date: m.date || m.time || '', seen: m.seen ?? !(m.flags || []).includes?.('unseen'),
      preview: m.preview || '',
    }));
  }

  async events() {
    const j = await this.json('/calendar/api/upcoming');
    return pickArray(j, ['events', 'data', 'items']).map((e) => ({
      title: e.title || e.summary || '', start: e.start || e.startDate || e.when || '', end: e.end || '',
      location: e.location || '', calendar: e.calendar || e.calendarName || '',
    }));
  }

  async badges() {
    try { return await this.json('/app/navigation/badges'); } catch { return {}; }
  }
}
