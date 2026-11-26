// Phone <-> PC link through the Lessn Hub that runs in Lessn for Windows.
// Phone: find and pair the PC, browse/upload the PC's files, share a phone folder with the PC, sync, use the PC's AI.
// PC: pairing code, linked phones, the phone's shared folder, the PC's shared folder, local AI (Ollama), autostart.
import { S, t, $, esc, icon, toast, openSheet, closeSheet, uiPrompt, uiConfirm, emptyState, skeleton, stagger, store, toggle, fmt } from './core.js';
import { native, hasNative } from './native.js';
import { openViewer } from './viewer.js';
import { syncOnce, markAllForSync, onLocalChange, lastSync } from './sync.js';
import { render, setView } from './app.js';
import { photosToPdf, scanPhoto, bytesToB64 } from './docs.js';

export const isDesktop = () => !!window.Capacitor?.isDesktop;
const D = () => window.lessnDesktop;
const CONF = 'lessn:pc';
const conf = () => { try { return JSON.parse(localStorage.getItem(CONF) || 'null'); } catch { return null; } };
const setConf = (c) => { if (c) localStorage.setItem(CONF, JSON.stringify(c)); else localStorage.removeItem(CONF); };
const L = { status: null, online: false, files: null, path: '/', error: '', found: null, searching: false, phone: null, phonePath: '/', phoneFiles: null, phoneError: '', ai: null, pull: null, code: null, syncing: false };

// ---------------------------------------------------------------- talking to the hub
export const linked = () => !!conf()?.token;
async function api(path, opts = {}) {
  const c = conf();
  if (!c) throw new Error(t('Not connected to a PC'));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 20000);
  let r;
  try {
    r = await fetch(c.base + path, { ...opts, signal: ctl.signal, headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  } catch { throw new Error(t('PC not reachable. Is Lessn running on the PC and are both on the same Wi-Fi?')); } finally { clearTimeout(timer); }
  if (r.status === 401) { throw new Error(t('This device is no longer linked. Connect again.')); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || j.error || `HTTP ${r.status}`);
  return j;
}
const fileUrl = (p) => `${conf().base}/api/file?path=${encodeURIComponent(p)}`;
const auth = () => ({ Authorization: `Bearer ${conf().token}` });

/** On the PC the app links to its own hub automatically (for sync and the local AI). */
async function ensureDesktopLink() {
  if (!isDesktop() || linked()) return;
  const { token, base } = await D().invoke('hubLocalToken');
  setConf({ base, token, name: t('This PC'), self: true });
  markAllForSync(true);
}

// ---------------------------------------------------------------- background: sync + answering the PC (phone)
let started = false;
export async function startLink() {
  if (started) return;
  started = true;
  await ensureDesktopLink().catch(() => {});
  onLocalChange(() => syncNow(true));
  setInterval(() => syncNow(true), 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { syncNow(true); if (!isDesktop()) phoneLoop(); } });
  if (isDesktop()) window.lessnHubEvents?.push(onHubEvent);
  setTimeout(() => syncNow(true), 1500);
  if (!isDesktop()) phoneLoop();
}
function onHubEvent(ev) {
  if (ev.type === 'sync' || ev.type === 'resume') syncNow(true);
  if (['devices', 'paired'].includes(ev.type)) { if (S.view === 'pc') refreshPC(); }
  if (ev.type === 'files' && S.view === 'pc') loadPcFiles(L.path, false);
  if (ev.type === 'ai-pull') { L.pull = ev.data; const el = $('#ai-pull'); if (el) el.innerHTML = pullHtml(); }
}

export async function syncNow(quiet = false) {
  if (!linked() || S.settings.pcSync === false || L.syncing) return;
  L.syncing = true;
  try {
    const changed = await syncOnce(api, { secrets: S.settings.pcSyncSecrets !== false });
    L.online = true;
    if (changed.length) {
      // pick up the new data
      if (changed.includes('account') && !S.api) { location.reload(); return; }
      S.settings = store.settings();
      const { applyTheme } = await import('./core.js');
      applyTheme();
      if (S.api) render();
      if (!quiet) toast(t('Synced'));
    } else if (!quiet) toast(t('Everything is up to date'));
  } catch (e) {
    L.online = false;
    if (!quiet) toast(t(e.message), 'err');
  } finally { L.syncing = false; }
  if (S.view === 'pc') paintSoon();
}

// Phone: while the app is open, answer the PC's requests for files in the shared folder.
let looping = false;
async function phoneLoop() {
  if (looping || isDesktop() || !hasNative()) return;
  looping = true;
  while (linked() && !document.hidden) {
    try {
      const share = readShare();
      const j = await api(`/api/phone/poll?sharing=${share ? 1 : 0}`, { timeout: 35000 });
      L.online = true;
      for (const job of j.jobs || []) handleJob(job, share);
    } catch {
      L.online = false;
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  looping = false;
}
const readShare = () => { try { return JSON.parse(localStorage.getItem('lessn:phoneShare') || 'null'); } catch { return null; } };
async function reply(id, status, meta, body) {
  const c = conf();
  const headers = { Authorization: `Bearer ${c.token}`, 'X-Status': String(status), 'X-Meta': btoa(unescape(encodeURIComponent(JSON.stringify(meta || {})))) };
  await native.raw({ url: `${c.base}/api/phone/reply/${id}`, method: 'POST', headers, ...(body?.path ? { bodyPath: body.path } : { bodyBase64: body?.base64 || '' }) });
}
async function handleJob(job, share) {
  try {
    if (!share) throw new Error(t('Nothing shared on the phone. Choose a folder in Lessn on the phone (Menu → PC).'));
    const tree = share.uri;
    if (job.op === 'list') { const r = await native.treeList({ uri: tree, path: job.path || '/' }); await reply(job.id, 200, { items: r.items }); return; }
    if (job.op === 'read') { const r = await native.treeRead({ uri: tree, path: job.path }); await reply(job.id, 200, { name: r.name, mime: r.mime }, { path: r.path }); native.deleteFile(r.path); return; }
    if (job.op === 'write') {
      const c = conf();
      const f = await native.fetchFile({ url: c.base + job.blob, headers: { Authorization: `Bearer ${c.token}` }, name: job.name });
      await native.treeWrite({ uri: tree, path: job.path || '/', name: job.name, source: f.path });
      native.deleteFile(f.path);
      await reply(job.id, 200, { ok: true });
      return;
    }
    if (job.op === 'delete') { await native.treeDelete({ uri: tree, path: job.path }); await reply(job.id, 200, { ok: true }); return; }
    if (job.op === 'mkdir') { await native.treeMkdir({ uri: tree, path: job.path, name: job.name }); await reply(job.id, 200, { ok: true }); return; }
    throw new Error('Unknown request');
  } catch (e) {
    reply(job.id, 400, { error: e.message }).catch(() => {});
  }
}

// ---------------------------------------------------------------- phone: find and pair
async function discover() {
  L.searching = true; L.found = null; paint();
  try { L.found = (await native.discoverPcs({ timeout: 2500 })).pcs || []; } catch (e) { L.found = []; toast(t(e.message), 'err'); }
  L.searching = false; paint();
}
export async function pairWith(address) {
  const base = /^https?:/.test(address) ? address.replace(/\/+$/, '') : `http://${address.replace(/\/+$/, '')}${/:\d+$/.test(address) ? '' : ':47900'}`;
  const code = await uiPrompt(t('Enter the 6-digit code shown in Lessn on your PC (Phone page).'), '', { placeholder: '123456' });
  if (!code) return;
  try {
    const r = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.replace(/\D/g, ''), device: S.account?.username ? `${t('Phone')} (${S.account.username})` : t('Phone'), platform: 'android' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setConf({ base, token: j.token, name: j.name, id: j.id });
    markAllForSync();
    toast(t('Connected to {name}', { name: j.name }));
    L.online = true;
    syncNow(true);
    phoneLoop();
    refreshPC();
  } catch (e) { toast(t(e.message === 'Failed to fetch' ? 'PC not reachable. Is Lessn running on the PC and are both on the same Wi-Fi?' : e.message), 'err'); }
}
export async function pairManual() {
  const a = await uiPrompt(t('Address of the PC (shown in Lessn on the PC)'), '', { placeholder: '192.168.178.20' });
  if (a) pairWith(a.trim());
}
export async function unlinkPC() {
  if (!await uiConfirm(t('Disconnect from {name}?', { name: conf()?.name || 'PC' }), { danger: true, ok: t('Disconnect') })) return;
  setConf(null);
  Object.assign(L, { files: null, status: null, online: false, ai: null, loaded: false });
  render();
}

// ---------------------------------------------------------------- PC files (used on the phone, and on the PC for its own folder)
export async function loadPcFiles(path = '/', paint2 = true) {
  L.path = path; L.error = '';
  if (paint2) { L.files = null; paint(); }
  try { L.files = (await api(`/api/files?path=${encodeURIComponent(path)}`)).items; L.online = true; } catch (e) { L.error = e.message; L.files = []; }
  paint();
}
export function openPcFile(p) {
  const f = L.files?.find((x) => x.path === p);
  if (!f) return;
  openViewer({ name: f.name, size: f.size, request: { url: fileUrl(p), headers: auth() } });
}
export async function pcFileMenu(p) {
  const f = L.files?.find((x) => x.path === p);
  if (!f) return;
  openSheet(() => `<h2 class="sheet-title">${icon(f.isDir ? 'folder' : 'file')}${esc(f.name)}</h2><div class="card">
    ${f.isDir ? '' : `<button class="row" data-act="pc-open" data-p="${esc(p)}"><span class="row-ic">${icon('eye')}</span><span class="row-text"><b>${esc(t('Open'))}</b></span></button>`}
    <button class="row" data-act="pc-rename" data-p="${esc(p)}"><span class="row-ic">${icon('pencil')}</span><span class="row-text"><b>${esc(t('Rename'))}</b></span></button>
    <button class="row danger" data-act="pc-delete" data-p="${esc(p)}"><span class="row-ic">${icon('trash-2')}</span><span class="row-text"><b>${esc(t('Delete'))}</b></span></button></div>`);
}
export async function pcRename(p) {
  closeSheet(true);
  const f = L.files?.find((x) => x.path === p);
  const name = await uiPrompt(t('New name'), f?.name || '');
  if (!name || /[\\/]/.test(name)) return;
  const parent = p.replace(/\/$/, '').split('/').slice(0, -1).join('/') || '';
  try { await api(`/api/move?path=${encodeURIComponent(p)}&to=${encodeURIComponent(`${parent}/${name}`)}`, { method: 'POST' }); loadPcFiles(L.path, false); } catch (e) { toast(t(e.message), 'err'); }
}
export async function pcDelete(p) {
  closeSheet(true);
  const f = L.files?.find((x) => x.path === p);
  if (!await uiConfirm(t('Delete {name}?', { name: f?.name || p }), { ok: t('Delete'), danger: true })) return;
  try { await api(`/api/file?path=${encodeURIComponent(p)}`, { method: 'DELETE' }); loadPcFiles(L.path, false); } catch (e) { toast(t(e.message), 'err'); }
}
export async function pcMkdir() {
  const name = await uiPrompt(t('Folder name'));
  if (!name || /[\\/]/.test(name)) return;
  try { await api(`/api/mkdir?path=${encodeURIComponent(`${L.path.replace(/\/?$/, '/')}${name}`)}`, { method: 'POST' }); loadPcFiles(L.path, false); } catch (e) { toast(t(e.message), 'err'); }
}
const fileB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
async function putBytes(name, base64) {
  const c = conf();
  const r = await native.raw({ url: `${c.base}/api/file?path=${encodeURIComponent(`${L.path.replace(/\/?$/, '/')}${name}`)}`, method: 'PUT', headers: auth(), bodyBase64: base64 });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
}
export async function pcUpload(files) {
  const list = [...files];
  for (const [i, f] of list.entries()) {
    if (f.size > 200e6) { toast(t('{name} is too big (max 200 MB)', { name: f.name }), 'err'); continue; }
    toast(`${t('Uploading {name}', { name: f.name })}${list.length > 1 ? ` (${i + 1}/${list.length})` : ''}`);
    try { await putBytes(f.name, await fileB64(f)); } catch (e) { toast(t(e.message), 'err'); }
  }
  loadPcFiles(L.path, false);
  toast(t('Uploaded'));
}
export async function pcScan(files) {
  const pages = [];
  for (const f of files) pages.push(await scanPhoto(f));
  const name = await uiPrompt(t('File name'), `Scan ${new Date().toLocaleDateString().replace(/[\\/:.]/g, '-')}`);
  if (!name) return;
  try { await putBytes(/\.pdf$/i.test(name) ? name : `${name}.pdf`, bytesToB64(photosToPdf(pages))); loadPcFiles(L.path, false); toast(t('Uploaded')); } catch (e) { toast(t(e.message), 'err'); }
}
export function pcUploadMenu() {
  openSheet(() => `<h2 class="sheet-title">${icon('upload')}${esc(t('Send to PC'))}</h2>
    <div class="attach-grid">
      <button data-act="pick" data-input="pc-up-photo"><span style="--c:#8e4ec6">${icon('image')}</span>${esc(t('Photos'))}</button>
      <button data-act="pick" data-input="pc-up-cam"><span style="--c:#e5484d">${icon('camera')}</span>${esc(t('Camera'))}</button>
      <button data-act="pick" data-input="pc-up"><span style="--c:#0090ff">${icon('file')}</span>${esc(t('Files'))}</button>
      <button data-act="pick" data-input="pc-scan"><span style="--c:#f76b15">${icon('file-text')}</span>${esc(t('Scan to PDF'))}</button>
    </div>`);
}

// ---------------------------------------------------------------- phone: share a folder with the PC
export async function chooseShare() {
  try {
    const r = await native.pickFolder();
    if (!r?.uri) return;
    localStorage.setItem('lessn:phoneShare', JSON.stringify({ uri: r.uri, name: r.name }));
    toast(t('The PC can now see "{name}" while Lessn is open', { name: r.name }));
    paint();
  } catch (e) { toast(t(e.message), 'err'); }
}
export function stopShare() { localStorage.removeItem('lessn:phoneShare'); paint(); }

// ---------------------------------------------------------------- PC: the phone's files
export async function openPhone(id) { L.phone = id; L.phonePath = '/'; await loadPhone('/'); }
export async function loadPhone(path) {
  L.phonePath = path; L.phoneFiles = null; L.phoneError = ''; paint();
  try { L.phoneFiles = (await D().invoke('phone', { device: L.phone, op: 'list', path })).items || []; } catch (e) { L.phoneError = cleanErr(e); L.phoneFiles = []; }
  paint();
}
const cleanErr = (e) => String(e.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, '');
export async function openPhoneFile(p) {
  const f = L.phoneFiles?.find((x) => x.path === p);
  toast(t('Loading {name}', { name: f?.name || '' }));
  try { const r = await D().invoke('phone', { device: L.phone, op: 'read', path: p }); openViewer({ name: r.name, size: r.size, path: r.path, mime: r.mime }); } catch (e) { toast(cleanErr(e), 'err'); }
}
export async function sendToPhone() {
  const files = await D().invoke('pickFiles', { multi: true });
  for (const f of files) {
    toast(t('Uploading {name}', { name: f.name }));
    try { await D().invoke('phone', { device: L.phone, op: 'write', path: L.phonePath, name: f.name, filePath: f.path }); } catch (e) { toast(cleanErr(e), 'err'); }
  }
  if (files.length) loadPhone(L.phonePath);
}
export async function deletePhoneFile(p) {
  const f = L.phoneFiles?.find((x) => x.path === p);
  if (!await uiConfirm(t('Delete {name}?', { name: f?.name || p }), { ok: t('Delete'), danger: true })) return;
  try { await D().invoke('phone', { device: L.phone, op: 'delete', path: p }); loadPhone(L.phonePath); } catch (e) { toast(cleanErr(e), 'err'); }
}

// ---------------------------------------------------------------- local AI
export async function loadAI() {
  try { L.ai = isDesktop() ? await D().invoke('aiStatus') : await api('/api/ai/status'); } catch { L.ai = { available: false, models: [] }; }
  paint();
}
export const SUGGESTED_MODELS = [
  ['gemma3:4b', 'Gemma 3 4B', '3.3 GB', 'Good all-rounder, understands photos'],
  ['qwen3:8b', 'Qwen 3 8B', '5.2 GB', 'Strong at maths and German'],
  ['llama3.2:3b', 'Llama 3.2 3B', '2.0 GB', 'Fast, for older PCs'],
  ['qwen2.5vl:7b', 'Qwen 2.5 VL 7B', '6.0 GB', 'Reads photos of worksheets'],
];
export async function pullModel(model) {
  if (!model) { model = await uiPrompt(t('Model name (from ollama.com/library)'), '', { placeholder: 'mistral-small3.2' }); if (!model) return; }
  L.pull = { model, status: t('Starting…') }; paint();
  try { await D().invoke('aiPull', { model }); toast(t('{name} is ready', { name: model })); } catch (e) { toast(cleanErr(e), 'err'); }
  L.pull = null; loadAI();
}
export async function deleteModel(model) {
  if (!await uiConfirm(t('Delete {name}?', { name: model }), { danger: true, ok: t('Delete') })) return;
  await D().invoke('aiDelete', { model }); loadAI();
}
/** Adds the PC's AI as an AI helper (free, private, works without internet). */
export function usePcAI() {
  const c = conf();
  if (!c) return;
  const models = L.ai?.models || [];
  if (!models.length) { toast(t('Download a model on the PC first.'), 'err'); return; }
  const keys = store.aiKeys(); keys.pc = c.token; localStorage.setItem('lessn:aikeys', JSON.stringify(keys));
  S.settings.aiModels = { ...(S.settings.aiModels || {}), pc: S.settings.aiModels?.pc && models.includes(S.settings.aiModels.pc) ? S.settings.aiModels.pc : models[0] };
  if (!store.aiKey(S.settings.aiProvider)) S.settings.aiProvider = 'pc';
  store.saveSettings(S.settings);
  toast(t('The PC\'s AI is now one of your AI helpers'));
  paint();
}
function pullHtml() {
  const p = L.pull;
  if (!p) return '';
  const pct = p.total ? Math.round((p.completed || 0) / p.total * 100) : null;
  return `<div class="pull"><b>${esc(p.model)}</b><small>${esc(p.status || '')}${pct != null ? ` · ${pct}%` : ''}</small><i style="--p:${pct ?? 0}%"></i></div>`;
}

// ---------------------------------------------------------------- screen
let paintTimer = null;
const paintSoon = () => { clearTimeout(paintTimer); paintTimer = setTimeout(paint, 120); };
function paint() { if (S.view === 'pc') render(); }
export async function refreshPC() {
  if (isDesktop()) { try { L.status = await D().invoke('hubStatus'); L.code = await D().invoke('hubPairCode'); L.auto = await D().invoke('autostart', {}); } catch { /* ignore */ } }
  if (linked()) { loadAI(); if (!L.files) loadPcFiles(L.path); }
  paint();
}

const fileRow = (f, open, menu) => `<div class="file-row">
  <button class="file-main" data-act="${f.isDir ? open[0] : open[1]}" data-p="${esc(f.path)}"><span class="file-ic ${f.isDir ? 'dir' : ''}">${icon(f.isDir ? 'folder' : /image/.test(f.type) ? 'image' : /pdf|text|word/.test(f.type) ? 'file-text' : /video/.test(f.type) ? 'video' : /audio/.test(f.type) ? 'music' : 'file')}</span>
  <span class="row-text"><b>${esc(f.name)}</b><small>${esc([f.isDir ? '' : size(f.size), f.modified ? fmt(new Date(f.modified), { day: 'numeric', month: 'short' }) : ''].filter(Boolean).join(' · '))}</small></span></button>
  ${menu ? `<button class="icon-btn" data-act="${menu}" data-p="${esc(f.path)}" aria-label="${esc(t('More'))}">${icon('ellipsis-vertical')}</button>` : ''}</div>`;
const size = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const crumbs = (p, act) => {
  const parts = p.split('/').filter(Boolean);
  return `<div class="crumbs inline">${[`<button data-act="${act}" data-p="/">${icon('house')}</button>`, ...parts.map((x, i) => `<button data-act="${act}" data-p="/${parts.slice(0, i + 1).join('/')}/">${esc(x)}</button>`)].join(icon('chevron-right', 'crumb-sep'))}</div>`;
};
function filesCard(title, ic) {
  return `<div class="section-title">${icon(ic)}${esc(title)}</div>
    ${crumbs(L.path, 'pc-go')}
    <div class="file-tools">
      <button class="btn small ghost" data-act="pc-upload">${icon('upload')}${esc(t('Upload'))}</button>
      <button class="btn small ghost" data-act="pc-mkdir">${icon('folder-plus')}${esc(t('New folder'))}</button>
      ${isDesktop() ? `<button class="btn small ghost" data-act="pc-open-folder">${icon('external-link')}${esc(t('Open in Explorer'))}</button>` : ''}
      <input type="file" id="pc-up" multiple hidden><input type="file" id="pc-up-photo" accept="image/*,video/*" multiple hidden><input type="file" id="pc-up-cam" accept="image/*" capture="environment" hidden><input type="file" id="pc-scan" accept="image/*" capture="environment" multiple hidden>
    </div>
    ${L.error ? `<div class="notice warn">${icon('circle-alert')}<span>${esc(t(L.error))}</span></div>` : ''}
    ${!L.files ? skeleton(3) : L.files.length ? `<div class="card">${L.files.slice().sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name)).map((f) => fileRow(f, ['pc-go', 'pc-open'], 'pc-menu')).join('')}</div>` : emptyState('folder', t('This folder is empty'))}`;
}

function aiCard() {
  const ai = L.ai;
  const models = ai?.models || [];
  const usingPc = !!store.aiKeys().pc;
  if (!isDesktop()) {
    return `<div class="section-title">${icon('cpu')}${esc(t('AI on your PC'))}</div>
      <div class="card pad-card"><p class="hint">${esc(ai?.available ? t('Your PC runs {n} AI models. They are free, private and work without internet.', { n: models.length }) : t('No local AI on the PC yet. Set it up in Lessn on the PC (Phone page → AI on this PC).'))}</p>
      ${ai?.available && models.length ? `<button class="btn" data-act="pc-use-ai">${icon('sparkles')}${esc(usingPc ? t('Using the PC\'s AI') : t('Use the PC\'s AI'))}</button>` : ''}</div>`;
  }
  return `<div class="section-title">${icon('cpu')}${esc(t('AI on this PC'))}</div>
    <div class="card pad-card">
      ${ai == null ? skeleton(1) : ai.available ? `<p class="hint">${esc(t('Ollama is running. Your phone and this PC can use these models for free, privately and without internet.'))}</p>
        ${models.length ? `<div class="card">${models.map((m) => `<div class="row"><span class="row-ic">${icon('cpu')}</span><span class="row-text"><b>${esc(m)}</b></span><button class="icon-btn" data-act="pc-ai-del" data-m="${esc(m)}" aria-label="${esc(t('Delete'))}">${icon('trash-2')}</button></div>`).join('')}</div>` : ''}
        <div class="section-title small">${esc(t('Download a model'))}</div>
        <div class="model-grid">${SUGGESTED_MODELS.map(([id, name, sz, why]) => `<button class="model-card ${models.some((m) => m.startsWith(id)) ? 'have' : ''}" data-act="pc-ai-pull" data-m="${id}"><b>${esc(name)}</b><small>${esc(t(why))}</small><em>${esc(sz)}</em></button>`).join('')}
          <button class="model-card" data-act="pc-ai-pull" data-m=""><b>${esc(t('Other model…'))}</b><small>ollama.com/library</small></button></div>
        <div id="ai-pull">${pullHtml()}</div>
        ${models.length ? `<button class="btn" data-act="pc-use-ai">${icon('sparkles')}${esc(usingPc ? t('Using the PC\'s AI') : t('Use it as an AI helper'))}</button>` : ''}`
      : `<p class="hint">${esc(t('Run AI on this PC for free and without internet: install Ollama, then download a model here. Your phone can use it too.'))}</p>
        <button class="btn" data-act="pc-ollama">${icon('download')}${esc(t('Get Ollama (free)'))}</button>
        <button class="btn small ghost center-btn" data-act="pc-ai-refresh">${icon('refresh-cw')}${esc(t('Check again'))}</button>`}
    </div>`;
}

export function viewPC() {
  if (!started) startLink();
  if (!L.loaded) { L.loaded = true; setTimeout(refreshPC, 0); }
  return isDesktop() ? viewDesktop() : viewPhone();
}

function viewPhone() {
  const c = conf();
  const share = readShare();
  if (!c) {
    return `<div class="pad">
      <div class="link-hero"${stagger(0)}><span class="link-ic">${icon('monitor')}${icon('arrow-left-right')}${icon('smartphone')}</span>
        <h2>${esc(t('Connect your PC'))}</h2><p>${esc(t('Open your PC\'s files on the phone, show the phone\'s files on the PC, sync homework, notes and chats, and use AI running on your PC.'))}</p></div>
      <div class="card pad-card steps"${stagger(1)}><p><b>1.</b> ${esc(t('Install Lessn on your Windows PC and open the "Phone" page there.'))}</p><p><b>2.</b> ${esc(t('Make sure the phone and the PC use the same Wi-Fi.'))}</p><p><b>3.</b> ${esc(t('Search, pick your PC and type the code shown on it.'))}</p></div>
      <button class="btn"${stagger(2)} data-act="pc-search" ${L.searching ? 'disabled' : ''}>${icon(L.searching ? 'refresh-cw' : 'search', L.searching ? 'spin-ic' : '')}${esc(L.searching ? t('Searching…') : t('Search for my PC'))}</button>
      ${L.found ? (L.found.length ? `<div class="card"${stagger(3)}>${L.found.map((p) => `<button class="row" data-act="pc-pair" data-a="${esc(`${p.address}:${p.port}`)}"><span class="row-ic">${icon('monitor')}</span><span class="row-text"><b>${esc(p.name)}</b><small>${esc(p.address)}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>`
        : `<p class="hint center">${esc(t('No PC found. Is Lessn open on the PC? You can also type its address.'))}</p>`) : ''}
      <button class="link center" data-act="pc-manual">${esc(t('Enter the address myself'))}</button>
    </div>`;
  }
  const last = lastSync();
  return `<div class="pad">
    <div class="card pc-card"${stagger(0)}><span class="pc-ic ${L.online ? 'on' : ''}">${icon('monitor')}</span><div><b>${esc(c.name || 'PC')}</b><small>${esc(L.online ? t('Connected') : t('Not reachable right now'))} · ${esc(c.base.replace(/^https?:\/\//, ''))}</small></div>
      <button class="icon-btn" data-act="pc-sync" aria-label="${esc(t('Sync now'))}">${icon('refresh-cw', L.syncing ? 'spin-ic' : '')}</button></div>
    <div class="card"${stagger(1)}>
      ${toggle('pcSync', t('Sync with this PC'), last ? t('Last synced {time}', { time: fmt(new Date(last), { hour: '2-digit', minute: '2-digit' }) }) : t('Homework, notes, chats, summaries, grades and settings'))}
      ${toggle('pcSyncSecrets', t('Also sync logins and AI keys'), t('So Lessn on the PC signs in by itself'))}
    </div>
    <div class="section-title">${icon('smartphone')}${esc(t('Phone files on the PC'))}</div>
    <div class="card"${stagger(2)}>${share ? `<div class="row"><span class="row-ic">${icon('folder')}</span><span class="row-text"><b>${esc(share.name)}</b><small>${esc(t('The PC can open, add and delete files here while Lessn is open.'))}</small></span><button class="btn small ghost" data-act="pc-share-stop">${esc(t('Stop'))}</button></div>`
      : `<button class="row" data-act="pc-share"><span class="row-ic">${icon('folder-plus')}</span><span class="row-text"><b>${esc(t('Share a folder with the PC'))}</b><small>${esc(t('e.g. Download, Documents or DCIM (photos)'))}</small></span>${icon('chevron-right', 'row-chev')}</button>`}</div>
    ${filesCard(t('Files on {name}', { name: c.name || 'PC' }), 'monitor')}
    ${aiCard()}
    <button class="btn small ghost center-btn danger-text" data-act="pc-unlink">${icon('log-out')}${esc(t('Disconnect'))}</button>
  </div>`;
}

function viewDesktop() {
  const st = L.status;
  const code = L.code;
  const dev = st?.devices || [];
  const cur = dev.find((d) => d.id === L.phone);
  return `<div class="pad desk-grid">
    <div class="col">
      <div class="section-title">${icon('smartphone')}${esc(t('Connect a phone'))}</div>
      <div class="card pad-card pair-card">
        <p class="hint">${esc(t('In Lessn on your phone: Menu → PC → Search for my PC, then type this code:'))}</p>
        <div class="pair-code">${esc(code ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : '··· ···')}</div>
        <small class="hint">${esc(code ? t('Address: {a}', { a: (code.addresses || []).map((a) => `${a}:${code.port}`).join(' · ') || '–' }) : '')}</small>
        <button class="btn small ghost" data-act="pc-newcode">${icon('refresh-cw')}${esc(t('New code'))}</button>
      </div>
      <div class="section-title">${icon('smartphone')}${esc(t('Linked phones'))}</div>
      <div class="card">${dev.length ? dev.map((d) => `<div class="row"><span class="row-ic ${d.online ? 'tint' : ''}" style="--c:#30a46c">${icon('smartphone')}</span><span class="row-text"><b>${esc(d.name)}</b><small>${esc(d.online ? (d.sharing ? t('Online · shares a folder') : t('Online')) : t('Offline (open Lessn on the phone)'))}</small></span>
        ${d.sharing ? `<button class="btn small ghost" data-act="ph-open" data-id="${d.id}">${icon('folder')}${esc(t('Files'))}</button>` : ''}
        <button class="icon-btn" data-act="ph-unpair" data-id="${d.id}" aria-label="${esc(t('Remove'))}">${icon('x')}</button></div>`).join('') : `<div class="row"><span class="row-text"><small>${esc(t('No phone linked yet.'))}</small></span></div>`}</div>
      ${cur ? `<div class="section-title">${icon('folder')}${esc(t('Files on {name}', { name: cur.name }))}</div>
        ${crumbs(L.phonePath, 'ph-go')}
        <div class="file-tools"><button class="btn small ghost" data-act="ph-send">${icon('upload')}${esc(t('Send files to the phone'))}</button></div>
        ${L.phoneError ? `<div class="notice warn">${icon('circle-alert')}<span>${esc(L.phoneError)}</span></div>` : ''}
        ${!L.phoneFiles ? skeleton(3) : L.phoneFiles.length ? `<div class="card">${L.phoneFiles.map((f) => fileRow(f, ['ph-go', 'ph-file'], 'ph-del')).join('')}</div>` : emptyState('folder', t('This folder is empty'))}` : ''}
      <div class="section-title">${icon('settings-2')}${esc(t('This PC'))}</div>
      <div class="card">
        <button class="row toggle-row" data-act="pc-autostart"><span class="row-text"><b>${esc(t('Start with Windows'))}</b><small>${esc(t('Lessn starts in the tray, so your phone can always reach the PC'))}</small></span><span class="switch ${L.auto ? 'on' : ''}"><i></i></span></button>
        <div class="row"><span class="row-text"><b>${esc(t('Closing the window'))}</b><small>${esc(t('Lessn keeps running in the hidden icons of the taskbar. Right-click the icon → Quit Lessn to close it completely.'))}</small></span></div>
        <button class="row" data-act="pc-quit"><span class="row-ic">${icon('log-out')}</span><span class="row-text"><b>${esc(t('Quit Lessn'))}</b></span></button>
      </div>
    </div>
    <div class="col">
      ${filesCard(t('Shared folder on this PC'), 'folder')}
      <p class="hint">${esc(st?.sharedDir || '')} · <button class="link" data-act="pc-choose-dir">${esc(t('Change'))}</button></p>
      ${aiCard()}
    </div>
  </div>`;
}

/** Click handler for everything on this screen. Returns true when it handled the action. */
export function linkAction(act, d, el) {
  const A = {
    'pc-search': discover, 'pc-pair': () => pairWith(d.a), 'pc-manual': pairManual, 'pc-unlink': unlinkPC, 'pc-sync': () => syncNow(false),
    'pc-go': () => loadPcFiles(d.p), 'pc-open': () => { closeSheet(true); openPcFile(d.p); }, 'pc-menu': () => pcFileMenu(d.p), 'pc-rename': () => pcRename(d.p), 'pc-delete': () => pcDelete(d.p),
    'pc-mkdir': pcMkdir, 'pc-upload': () => (isDesktop() ? desktopUpload() : pcUploadMenu()), 'pc-share': chooseShare, 'pc-share-stop': stopShare,
    'pc-use-ai': usePcAI, 'pc-ai-pull': () => pullModel(d.m), 'pc-ai-del': () => deleteModel(d.m), 'pc-ai-refresh': loadAI,
    'pc-ollama': () => native.openUrl('https://ollama.com/download/windows'),
    'pc-newcode': async () => { L.code = await D().invoke('hubNewCode'); paint(); },
    'pc-open-folder': () => D().invoke('openSharedDir'), 'pc-choose-dir': async () => { L.status = await D().invoke('chooseSharedDir'); loadPcFiles('/'); },
    'pc-autostart': async () => { L.auto = await D().invoke('autostart', { on: !L.auto }); paint(); },
    'pc-quit': () => D().invoke('quit'),
    'ph-open': () => openPhone(d.id), 'ph-go': () => loadPhone(d.p), 'ph-file': () => openPhoneFile(d.p), 'ph-del': () => deletePhoneFile(d.p), 'ph-send': sendToPhone,
    'ph-unpair': async () => { if (await uiConfirm(t('Remove this phone?'), { danger: true, ok: t('Remove') })) { await D().invoke('hubUnpair', { id: d.id }); if (L.phone === d.id) L.phone = null; refreshPC(); } },
  };
  if (!A[act]) return false;
  Promise.resolve(A[act]()).catch((e) => toast(cleanErr(e), 'err'));
  return true;
}
/** File inputs on this screen. */
export function linkInput(el) {
  if (['pc-up', 'pc-up-photo', 'pc-up-cam'].includes(el.id)) { pcUpload(el.files); el.value = ''; return true; }
  if (el.id === 'pc-scan') { pcScan([...el.files]); el.value = ''; return true; }
  return false;
}
async function desktopUpload() {
  // on the PC the shared folder is local: copy chosen files in through the hub
  const files = await D().invoke('pickFiles', { multi: true });
  for (const f of files) {
    try { await putBytes(f.name, await D().invoke('readLocal', { path: f.path })); } catch (e) { toast(cleanErr(e), 'err'); }
  }
  if (files.length) { loadPcFiles(L.path, false); toast(t('Uploaded')); }
}
export const pcConf = conf;
