// Lessn Hub: a small server on the PC that the Lessn phone app connects to over the home Wi-Fi.
//  - pairing with a 6-digit code (shown on the PC), then a private token per phone
//  - the PC's "Lessn" folder as files for the phone (browse, open, upload, rename, delete)
//  - the phone's shared folder for the PC (the phone answers requests while the app is open)
//  - local AI: forwards OpenAI-style requests to Ollama (or another local server) on this PC
//  - sync of the app data (homework, chats, settings…) between all paired devices
// Phones find the PC with a UDP broadcast on port 47901.
const http = require('node:http');
const dgram = require('node:dgram');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const PORT = 47900;
const DISCOVERY_PORT = 47901;
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', json: 'application/json', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', html: 'text/html; charset=utf-8', csv: 'text/csv; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const mimeOf = (n) => MIME[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';

class Hub {
  constructor({ store, paths, version, onEvent }) {
    Object.assign(this, { store, paths, version, onEvent: onEvent || (() => {}) });
    this.jobs = new Map();      // phone device id -> [job]
    this.waiting = new Map();   // phone device id -> res of a pending long-poll
    this.pendingReplies = new Map(); // job id -> { resolve, reject, timer }
    this.blobs = new Map();     // job id -> Buffer to hand to the phone (PC -> phone uploads)
    this.lastSeen = new Map();  // device id -> time of last request
    this.failed = new Map();    // ip -> [times] of wrong pairing codes
    this.newCode();
    if (!this.store.get('localToken')) this.store.set('localToken', crypto.randomBytes(24).toString('hex'));
  }

  // ------------------------------------------------------------ setup
  get sharedDir() { const d = this.store.get('sharedDir') || this.paths.shared; fs.mkdirSync(d, { recursive: true }); return d; }
  get name() { return this.store.get('pcName') || os.hostname(); }
  devices() { return this.store.get('devices') || []; }
  newCode() { this.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); this.codeUntil = Date.now() + 10 * 60000; return this.code; }
  pairCode() { if (Date.now() > this.codeUntil) this.newCode(); return { code: this.code, until: this.codeUntil, addresses: this.addresses(), port: PORT, name: this.name }; }
  addresses() {
    return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
      .sort((a, b) => (/^192\.168\./.test(b) - /^192\.168\./.test(a)));
  }
  status() {
    const now = Date.now();
    return {
      running: !!this.server?.listening, port: PORT, name: this.name, addresses: this.addresses(), sharedDir: this.sharedDir,
      devices: this.devices().map((d) => ({ id: d.id, name: d.name, platform: d.platform, paired: d.paired, online: now - (this.lastSeen.get(d.id) || 0) < 40000, sharing: !!d.sharing })),
      ai: this.aiBase(),
    };
  }

  start() {
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => this.send(res, e.status || (e.code === 'ENOENT' ? 404 : e.code === 'EEXIST' ? 409 : 500), { error: e.code === 'ENOENT' ? 'Not found' : e.message })));
    this.server.requestTimeout = 0;
    this.server.on('error', (e) => this.onEvent('error', e.message));
    this.server.listen(PORT, '0.0.0.0');
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('message', (msg, rinfo) => {
      if (String(msg).startsWith('LESSN_DISCOVER')) {
        const reply = Buffer.from(`LESSN_HERE ${JSON.stringify({ name: this.name, port: PORT, version: this.version })}`);
        this.udp.send(reply, rinfo.port, rinfo.address);
      }
    });
    this.udp.on('error', () => {});
    this.udp.bind(DISCOVERY_PORT);
  }
  stop() { try { this.server?.close(); this.udp?.close(); } catch { /* ignore */ } }

  // ------------------------------------------------------------ http plumbing
  send(res, code, obj, headers = {}) {
    if (res.headersSent) return;
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length, 'Access-Control-Allow-Origin': '*', ...headers });
    res.end(body);
  }
  async body(req, limit = 2e9) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > limit) throw new Error('Too big'); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  auth(req, url) {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('t');
    if (!tok) return null;
    if (tok === this.store.get('localToken')) return { id: 'pc', name: this.name, local: true };
    const d = this.devices().find((x) => crypto.timingSafeEqual(Buffer.from(x.tokenHash), Buffer.from(crypto.createHash('sha256').update(tok).digest('hex'))));
    if (d) this.lastSeen.set(d.id, Date.now());
    return d || null;
  }
  /** Resolves a path inside a root folder; never lets "../" escape it. */
  inside(root, p) {
    const f = path.resolve(root, `.${path.posix.normalize(`/${String(p || '/').replace(/\\/g, '/')}`)}`);
    if (f !== root && !f.startsWith(root + path.sep)) throw Object.assign(new Error('Invalid path'), { status: 400 });
    return f;
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
    if (p === '/api/hello') return this.send(res, 200, { app: 'lessn', name: this.name, version: this.version });
    if (p === '/api/pair' && req.method === 'POST') return this.pair(req, res);
    const dev = this.auth(req, url);
    if (!dev) return this.send(res, 401, { error: 'Not paired' });

    if (p === '/api/status') return this.send(res, 200, { ...this.status(), you: dev.id });
    if (p.startsWith('/api/files') || p === '/api/file' || p === '/api/mkdir' || p === '/api/move') return this.files(req, res, url);
    if (p.startsWith('/api/phone/')) return this.phone(req, res, url, dev);
    if (p.startsWith('/ai/')) return this.ai(req, res, url);
    if (p === '/api/ai/status') return this.send(res, 200, await this.aiStatus());
    if (p === '/api/sync' && req.method === 'POST') return this.sync(req, res, dev);
    if (p === '/api/notify' && req.method === 'POST') { const j = JSON.parse(await this.body(req, 1e5) || '{}'); this.onEvent('notify', { from: dev.name, ...j }); return this.send(res, 200, { ok: true }); }
    return this.send(res, 404, { error: 'Not found' });
  }

  // ------------------------------------------------------------ pairing
  async pair(req, res) {
    const ip = req.socket.remoteAddress;
    const tries = (this.failed.get(ip) || []).filter((t) => Date.now() - t < 10 * 60000);
    if (tries.length >= 8) return this.send(res, 429, { error: 'Too many wrong codes. Wait 10 minutes.' });
    let j = {};
    try { j = JSON.parse(await this.body(req, 1e4)); } catch { /* bad json */ }
    if (String(j.code) !== this.code || Date.now() > this.codeUntil) {
      this.failed.set(ip, [...tries, Date.now()]);
      return this.send(res, 403, { error: 'Wrong or expired code. Check the code shown on your PC.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    const dev = { id: crypto.randomUUID(), name: String(j.device || 'Phone').slice(0, 60), platform: String(j.platform || 'android').slice(0, 20), paired: Date.now(), tokenHash: crypto.createHash('sha256').update(token).digest('hex') };
    this.store.set('devices', [...this.devices(), dev]);
    this.newCode();
    this.onEvent('paired', { name: dev.name });
    return this.send(res, 200, { token, id: dev.id, name: this.name });
  }
  unpair(id) { this.store.set('devices', this.devices().filter((d) => d.id !== id)); this.onEvent('devices'); }

  // ------------------------------------------------------------ PC files for the phone
  async files(req, res, url) {
    const root = this.sharedDir;
    const rel = url.searchParams.get('path') || '/';
    const f = this.inside(root, rel);
    if (url.pathname === '/api/files') {
      const list = await fsp.readdir(f, { withFileTypes: true });
      const out = [];
      for (const e of list) {
        if (e.name.startsWith('.') || e.name === 'desktop.ini' || e.name === 'Thumbs.db') continue;
        try {
          const st = await fsp.stat(path.join(f, e.name));
          out.push({ name: e.name, path: path.posix.join(rel, e.name) + (st.isDirectory() ? '/' : ''), isDir: st.isDirectory(), size: st.size, modified: st.mtime.toISOString(), type: st.isDirectory() ? '' : mimeOf(e.name) });
        } catch { /* vanished */ }
      }
      return this.send(res, 200, { path: rel, items: out });
    }
    if (url.pathname === '/api/file' && req.method === 'GET') {
      const st = await fsp.stat(f);
      if (st.isDirectory()) return this.send(res, 400, { error: 'Is a folder' });
      const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const headers = { 'Content-Type': mimeOf(f), 'Accept-Ranges': 'bytes', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(f))}`, 'Access-Control-Allow-Origin': '*' };
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        return pipeline(fs.createReadStream(f, { start, end }), res);
      }
      res.writeHead(200, { ...headers, 'Content-Length': st.size });
      return pipeline(fs.createReadStream(f), res);
    }
    if (url.pathname === '/api/file' && req.method === 'PUT') {
      await fsp.mkdir(path.dirname(f), { recursive: true });
      const tmp = `${f}.lessn-part`;
      await pipeline(req, fs.createWriteStream(tmp));
      await fsp.rename(tmp, f);
      this.onEvent('files');
      return this.send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/file' && req.method === 'DELETE') {
      if (f === root) return this.send(res, 400, { error: 'Cannot delete the shared folder' });
      await fsp.rm(f, { recursive: true, force: true });
      this.onEvent('files');
      return this.send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/mkdir') { await fsp.mkdir(f, { recursive: true }); this.onEvent('files'); return this.send(res, 200, { ok: true }); }
    if (url.pathname === '/api/move') {
      const to = this.inside(root, url.searchParams.get('to'));
      if (fs.existsSync(to)) return this.send(res, 409, { error: 'A file with this name already exists' });
      await fsp.rename(f, to);
      this.onEvent('files');
      return this.send(res, 200, { ok: true });
    }
    return this.send(res, 404, { error: 'Not found' });
  }

  // ------------------------------------------------------------ phone files for the PC (relay)
  async phone(req, res, url, dev) {
    const sub = url.pathname.slice('/api/phone/'.length);
    if (sub === 'poll') {
      // the phone asks for work; we answer as soon as there is a job or after 25 s
      const d = this.devices().find((x) => x.id === dev.id);
      if (d && d.sharing !== (url.searchParams.get('sharing') === '1')) { d.sharing = url.searchParams.get('sharing') === '1'; this.store.set('devices', this.devices().map((x) => (x.id === d.id ? d : x))); this.onEvent('devices'); }
      const q = this.jobs.get(dev.id) || [];
      if (q.length) { this.jobs.set(dev.id, []); return this.send(res, 200, { jobs: q }); }
      const prev = this.waiting.get(dev.id);
      if (prev) this.send(prev, 200, { jobs: [] });
      this.waiting.set(dev.id, res);
      const timer = setTimeout(() => { if (this.waiting.get(dev.id) === res) { this.waiting.delete(dev.id); this.send(res, 200, { jobs: [] }); } }, 25000);
      req.on('close', () => { clearTimeout(timer); if (this.waiting.get(dev.id) === res) this.waiting.delete(dev.id); });
      return undefined;
    }
    if (sub.startsWith('reply/')) {
      const id = sub.slice(6);
      const pend = this.pendingReplies.get(id);
      const buf = await this.body(req);
      if (!pend) return this.send(res, 410, { error: 'Request expired' });
      this.pendingReplies.delete(id);
      clearTimeout(pend.timer);
      const status = Number(req.headers['x-status'] || 200);
      const meta = req.headers['x-meta'] ? JSON.parse(Buffer.from(String(req.headers['x-meta']), 'base64').toString('utf8')) : {};
      if (status >= 400) pend.reject(new Error(meta.error || `Phone answered ${status}`)); else pend.resolve({ meta, body: buf });
      return this.send(res, 200, { ok: true });
    }
    if (sub.startsWith('blob/')) {
      const b = this.blobs.get(sub.slice(5));
      if (!b) return this.send(res, 404, { error: 'Gone' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': b.length });
      return res.end(b);
    }
    return this.send(res, 404, { error: 'Not found' });
  }

  /** Called by the PC app: asks a phone to list / read / write / delete in its shared folder. */
  phoneRequest(deviceId, job, { timeout = 60000, blob } = {}) {
    const id = crypto.randomUUID();
    const full = { id, ...job };
    if (blob) { this.blobs.set(id, blob); full.blob = `/api/phone/blob/${id}`; }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingReplies.delete(id); this.blobs.delete(id); reject(new Error('The phone did not answer. Open Lessn on the phone and keep it on the same Wi-Fi.')); }, timeout);
      this.pendingReplies.set(id, { resolve: (v) => { this.blobs.delete(id); resolve(v); }, reject: (e) => { this.blobs.delete(id); reject(e); }, timer });
      const waiting = this.waiting.get(deviceId);
      if (waiting) { this.waiting.delete(deviceId); this.send(waiting, 200, { jobs: [full] }); } else this.jobs.set(deviceId, [...(this.jobs.get(deviceId) || []), full]);
    });
  }

  // ------------------------------------------------------------ local AI (Ollama / LM Studio / any OpenAI-compatible server on this PC)
  aiBase() { return (this.store.get('aiLocalBase') || 'http://127.0.0.1:11434').replace(/\/+$/, ''); }
  async aiStatus() {
    const base = this.aiBase();
    try {
      const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
      const j = await r.json();
      return { available: true, base, models: (j.data || []).map((m) => m.id) };
    } catch {
      return { available: false, base, models: [] };
    }
  }
  async ai(req, res, url) {
    const target = `${this.aiBase()}/v1/${url.pathname.replace(/^\/ai\/v1\/?/, '')}${url.search}`;
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await this.body(req, 200e6);
    let r;
    try {
      r = await fetch(target, { method: req.method, headers: { 'Content-Type': req.headers['content-type'] || 'application/json' }, body });
    } catch {
      return this.send(res, 502, { error: { message: 'No local AI is running on the PC. Install Ollama on the PC and download a model in Lessn on the PC (Phone page → AI on this PC).' } });
    }
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin': '*' });
    if (!r.body) return res.end();
    for await (const chunk of r.body) res.write(chunk);
    return res.end();
  }

  // ------------------------------------------------------------ data sync (last change wins, per item)
  syncData() { if (!this.sdata) { try { this.sdata = JSON.parse(fs.readFileSync(this.paths.syncFile, 'utf8')); } catch { this.sdata = { seq: 0, items: {} }; } } return this.sdata; }
  saveSync() { clearTimeout(this.syncTimer); this.syncTimer = setTimeout(() => fs.writeFile(this.paths.syncFile, JSON.stringify(this.sdata), () => {}), 300); }
  async sync(req, res, dev) {
    const j = JSON.parse((await this.body(req, 100e6)).toString('utf8') || '{}');
    const data = this.syncData();
    const changedKeys = [];
    for (const [k, it] of Object.entries(j.items || {})) {
      if (!/^[\w:.-]{1,120}$/.test(k) || typeof it?.t !== 'number') continue;
      const cur = data.items[k];
      if (!cur || it.t > cur.t) { data.seq++; data.items[k] = { v: it.v, t: it.t, seq: data.seq, by: dev.id }; changedKeys.push(k); }
    }
    if (changedKeys.length) { this.saveSync(); this.onEvent('sync', { from: dev.id, keys: changedKeys }); }
    const since = Number(j.since) || 0;
    const out = {};
    for (const [k, it] of Object.entries(data.items)) if (it.seq > since && !(it.by === dev.id && changedKeys.includes(k))) out[k] = { v: it.v, t: it.t };
    return this.send(res, 200, { seq: data.seq, items: out });
  }
}

module.exports = { Hub, PORT, DISCOVERY_PORT };
