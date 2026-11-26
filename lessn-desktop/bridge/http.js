// HTTP for the app on Windows: every request from the web code goes through here (like CapacitorHttp on
// Android), so there is no CORS problem and cookies (IServ session) are kept across requests and redirects.
const fs = require('node:fs');
const path = require('node:path');

class CookieJar {
  constructor(file) {
    this.file = file;
    this.list = [];
    try { this.list = JSON.parse(fs.readFileSync(file, 'utf8')).filter((c) => !c.expires || c.expires > Date.now()); } catch { /* new jar */ }
    this.saveSoon = null;
  }
  save() {
    clearTimeout(this.saveSoon);
    this.saveSoon = setTimeout(() => { try { fs.writeFileSync(this.file, JSON.stringify(this.list.filter((c) => c.expires))); } catch { /* ignore */ } }, 500);
  }
  /** Stores one Set-Cookie header received from `url`. */
  set(url, header) {
    const u = new URL(url);
    const [kv, ...attrs] = header.split(';');
    const i = kv.indexOf('=');
    if (i <= 0) return;
    const c = { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), domain: u.hostname, hostOnly: true, path: '/', secure: false, expires: 0 };
    let defPath = u.pathname.replace(/\/[^/]*$/, '') || '/';
    c.path = defPath;
    for (const a of attrs) {
      const [k, ...v] = a.split('=');
      const key = k.trim().toLowerCase(); const val = v.join('=').trim();
      if (key === 'domain' && val) { c.domain = val.replace(/^\./, '').toLowerCase(); c.hostOnly = false; }
      else if (key === 'path' && val.startsWith('/')) c.path = val;
      else if (key === 'secure') c.secure = true;
      else if (key === 'max-age') c.expires = Number(val) <= 0 ? -1 : Date.now() + Number(val) * 1000;
      else if (key === 'expires' && !c.expires) { const t = Date.parse(val); if (!Number.isNaN(t)) c.expires = t; }
    }
    this.list = this.list.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
    if (c.expires === -1 || (c.expires && c.expires < Date.now())) { this.save(); return; }
    this.list.push(c);
    this.save();
  }
  header(url) {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const now = Date.now();
    return this.list.filter((c) => (!c.expires || c.expires > now)
      && (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`))
      && (u.pathname === c.path || u.pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/')
      && (!c.secure || u.protocol === 'https:'))
      .sort((a, b) => b.path.length - a.path.length).map((c) => `${c.name}=${c.value}`).join('; ');
  }
  /** All cookies for a host (to hand them to an IServ browser window). */
  forHost(host) { return this.list.filter((c) => host === c.domain || host.endsWith(`.${c.domain}`)); }
  clear() { this.list = []; this.save(); }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lessn/3.0';

/**
 * request({ url, method, headers, body (Buffer|string), redirect: 'follow'|'manual', cookies: true, timeout })
 * -> { status, url, headers: [[k, v]], body: Buffer }
 */
async function request(jar, opts) {
  let url = opts.url;
  let method = (opts.method || 'GET').toUpperCase();
  let body = opts.body == null ? undefined : (typeof opts.body === 'string' ? Buffer.from(opts.body) : Buffer.from(opts.body));
  let headers = { ...(opts.headers || {}) };
  const useJar = opts.cookies !== false;
  for (let hop = 0; hop < 12; hop++) {
    const h = new Headers();
    for (const [k, v] of Object.entries(headers)) if (v != null && !/^(host|content-length|connection)$/i.test(k)) h.set(k, String(v));
    if (!h.has('user-agent')) h.set('user-agent', UA);
    if (useJar) {
      const ck = jar.header(url);
      const own = h.get('cookie');
      if (ck) h.set('cookie', own ? `${own}; ${ck}` : ck);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 120000);
    let res;
    try {
      res = await fetch(url, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'manual', signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'Timeout' : (e.cause?.code || e.message || 'Network error'));
    }
    if (useJar) for (const sc of res.headers.getSetCookie?.() || []) jar.set(url, sc);
    const loc = res.headers.get('location');
    if (opts.redirect !== 'manual' && res.status >= 300 && res.status < 400 && loc) {
      clearTimeout(timer);
      await res.arrayBuffer().catch(() => {});
      url = new URL(loc, url).href;
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET'; body = undefined;
        headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^content-/i.test(k)));
      }
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    clearTimeout(timer);
    return { status: res.status, url, headers: [...res.headers.entries()], body: buf };
  }
  throw new Error('Too many redirects');
}

module.exports = { CookieJar, request, UA };
