#!/usr/bin/env node
// Lessn web server: serves Lessn.html and passes WebUntis/IServ requests through (browsers block them otherwise).
// No extra packages needed (Node 18 or newer). Start: node server.js   (options: --port 8080  --lan)
// --lan lets phones/tablets in the same Wi-Fi open Lessn at http://<this computer>:8080
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 8080;
const LAN = args.includes('--lan');
const PAGE = fs.existsSync(path.join(__dirname, 'Lessn.html')) ? path.join(__dirname, 'Lessn.html') : path.join(__dirname, 'dist', 'Lessn.html');

// ---------------------------------------------------------------- one cookie jar per browser (keeps the school logins)
const jars = new Map();
function jarFor(req, res) {
  const m = /(?:^|;\s*)lessn_sid=([a-f0-9]{32})/.exec(req.headers.cookie || '');
  let sid = m && m[1];
  if (!sid || !jars.has(sid)) {
    sid = sid || crypto.randomBytes(16).toString('hex');
    jars.set(sid, []);
    res.setHeader('Set-Cookie', `lessn_sid=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  }
  return jars.get(sid);
}
function setCookie(jar, url, header) {
  const u = new URL(url);
  const [kv, ...attrs] = header.split(';');
  const i = kv.indexOf('=');
  if (i <= 0) return;
  const c = { name: kv.slice(0, i).trim(), value: kv.slice(i + 1).trim(), domain: u.hostname, host: true, path: '/', expires: 0 };
  for (const a of attrs) {
    const [k, ...v] = a.split('='); const key = k.trim().toLowerCase(); const val = v.join('=').trim();
    if (key === 'domain' && val) { c.domain = val.replace(/^\./, '').toLowerCase(); c.host = false; }
    else if (key === 'path' && val.startsWith('/')) c.path = val;
    else if (key === 'max-age') c.expires = Number(val) <= 0 ? -1 : Date.now() + Number(val) * 1000;
    else if (key === 'expires' && !c.expires) { const t = Date.parse(val); if (!Number.isNaN(t)) c.expires = t; }
  }
  const idx = jar.findIndex((x) => x.name === c.name && x.domain === c.domain && x.path === c.path);
  if (idx >= 0) jar.splice(idx, 1);
  if (c.expires !== -1 && !(c.expires && c.expires < Date.now())) jar.push(c);
}
function cookieHeader(jar, url) {
  const u = new URL(url); const h = u.hostname.toLowerCase();
  return jar.filter((c) => (!c.expires || c.expires > Date.now()) && (c.host ? h === c.domain : h === c.domain || h.endsWith(`.${c.domain}`)) && u.pathname.startsWith(c.path))
    .map((c) => `${c.name}=${c.value}`).join('; ');
}

// ---------------------------------------------------------------- the pass-through
const SKIP_REQ = /^(host|connection|content-length|origin|referer|cookie|accept-encoding|sec-|x-lessn-)/i;
const SKIP_RES = /^(set-cookie|content-encoding|content-length|transfer-encoding|connection|access-control-)/i;
async function proxy(req, res) {
  const jar = jarFor(req, res);
  let url = req.headers['x-lessn-url'];
  let method = String(req.headers['x-lessn-method'] || 'GET').toUpperCase();
  const testing = process.env.LESSN_ALLOW_LOCAL === '1'; // only for automated tests
  if (!/^https:\/\//i.test(url || '') && !testing) { res.writeHead(400); res.end('Only https'); return; }
  const host = new URL(url).hostname;
  if (!testing && (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith('.local'))) { res.writeHead(403); res.end('Blocked'); return; }
  let sent = {};
  try { sent = JSON.parse(Buffer.from(String(req.headers['x-lessn-headers'] || 'e30='), 'base64').toString('utf8')); } catch { /* none */ }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = chunks.length ? Buffer.concat(chunks) : undefined;
  const manual = req.headers['x-lessn-redirect'] === 'manual';
  try {
    for (let hop = 0; hop < 12; hop++) {
      const h = new Headers();
      for (const [k, v] of Object.entries(sent)) if (!SKIP_REQ.test(k)) h.set(k, v);
      if (!h.has('user-agent')) h.set('user-agent', 'Mozilla/5.0 Lessn-Web');
      const ck = cookieHeader(jar, url);
      if (ck) h.set('cookie', ck);
      const r = await fetch(url, { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : body, redirect: 'manual', signal: AbortSignal.timeout(120000) });
      for (const sc of r.headers.getSetCookie?.() || []) setCookie(jar, url, sc);
      const loc = r.headers.get('location');
      if (!manual && r.status >= 300 && r.status < 400 && loc) {
        await r.arrayBuffer().catch(() => {});
        url = new URL(loc, url).href;
        if (r.status !== 307 && r.status !== 308) { method = 'GET'; body = undefined; sent = Object.fromEntries(Object.entries(sent).filter(([k]) => !/^content-/i.test(k))); }
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const headers = {};
      r.headers.forEach((v, k) => { if (!SKIP_RES.test(k)) headers[k] = v; });
      res.writeHead(200, {
        'content-type': 'application/octet-stream', 'x-lessn-status': String(r.status), 'x-lessn-final-url': url,
        'x-lessn-headers': Buffer.from(JSON.stringify(headers)).toString('base64'), 'cache-control': 'no-store',
      });
      res.end(buf);
      return;
    }
    res.writeHead(599); res.end('Too many redirects');
  } catch (e) {
    res.writeHead(599); res.end(e.cause?.code || e.message || 'Network error');
  }
}

// ---------------------------------------------------------------- the page
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/proxy')) {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    proxy(req, res).catch((e) => { res.writeHead(599); res.end(String(e.message)); });
    return;
  }
  if (req.url === '/' || req.url.startsWith('/?') || req.url === '/index.html' || req.url === '/Lessn.html') {
    jarFor(req, res);
    const html = fs.readFileSync(PAGE, 'utf8').replace('<head>', '<head><script>window.__LESSN_PROXY="/proxy"</script>');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(html);
    return;
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  Lessn is running:  http://localhost:${PORT}`);
  if (LAN) for (const ip of ips) console.log(`  On your phone (same Wi-Fi):  http://${ip}:${PORT}`);
  console.log('\n  Keep this window open while you use Lessn. Close it to stop.\n');
});
