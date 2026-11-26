// Rich AI answers: Markdown (headings, lists, tables, quotes, --- lines, links, code), files the AI creates
// (```file:name.ext blocks -> real files, Markdown -> PDF), and running Python (Pyodide) or JavaScript code.
import { t, esc, icon, toast } from './core.js';
import { native, hasNative } from './native.js';
import { photosToPdf, bytesToB64 } from './docs.js';

// ---------------------------------------------------------------- Markdown
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/__(.+?)__/g, '<b>$1</b>')
  .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
  .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>')
  .replace(/~~(.+?)~~/g, '<s>$1</s>')
  .replace(/==(.+?)==/g, '<mark>$1</mark>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

/** Registry of code/file blocks of rendered messages: id -> { lang, code, name } */
export const BLOCKS = {};
let blockSeq = 0;
const FILE_IC = [[/\.pdf$/, 'file-text'], [/\.(png|jpe?g|svg|gif|webp)$/, 'image'], [/\.(csv|xlsx?)$/, 'file-spreadsheet'], [/\.(py|js|ts|java|c|cpp|html?|css|json|sh)$/, 'file-code'], [/\.(md|txt|docx?)$/, 'file-text']];
const fileIcon = (n) => (FILE_IC.find(([re]) => re.test(n.toLowerCase())) || [0, 'file'])[1];

/** Markdown -> HTML. */
export function renderMd(src, { live = true } = {}) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let list = null; // { type, items }
  const flush = () => { if (list) { out.push(`<${list.type} class="md-list">${list.items.map((x) => `<li>${x}</li>`).join('')}</${list.type}>`); list = null; } };
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w.+#:/ -]*)\s*$/);
    if (fence) {
      flush();
      const info = fence[1].trim();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      const id = `b${++blockSeq}`;
      const fm = info.match(/^file:\s*(.+)$/i);
      if (fm) {
        const name = fm[1].trim().replace(/[\\/:*?"<>|]/g, '_');
        BLOCKS[id] = { name, code };
        out.push(`<div class="md-file" data-block="${id}"><span class="mf-ic">${icon(fileIcon(name))}</span><span class="mf-txt"><b>${esc(name)}</b><small>${esc(t('Created by the AI'))}${/\.pdf$/i.test(name) ? ' · PDF' : ` · ${esc(sizeOf(code))}`}</small></span>
          <button class="icon-btn" data-act="file-open-block" data-id="${id}" aria-label="${esc(t('Open'))}">${icon('eye')}</button>
          <button class="icon-btn" data-act="file-save-block" data-id="${id}" aria-label="${esc(t('Save'))}">${icon('download')}</button></div>`);
        continue;
      }
      const lang = info.toLowerCase();
      BLOCKS[id] = { lang, code };
      const runnable = live && /^(python|py|javascript|js)$/.test(lang);
      out.push(`<div class="md-code" data-block="${id}"><div class="mc-head"><span>${esc(lang || t('Code'))}</span>
        <button data-act="code-copy" data-id="${id}">${icon('copy')}${esc(t('Copy'))}</button>${runnable ? `<button data-act="code-run" data-id="${id}">${icon('play')}${esc(t('Run'))}</button>` : ''}</div>
        <pre><code>${esc(code)}</code></pre><div class="mc-out" id="out-${id}"></div></div>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr class="md-hr">'); i++; continue; }
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flush(); const n = Math.min(h[1].length + 1, 5); out.push(`<h${n} class="md-h">${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const li = line.match(/^\s*(?:([-*+•])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      const type = li[1] ? 'ul' : 'ol';
      if (!list || list.type !== type) { flush(); list = { type, items: [] }; }
      const task = li[3].match(/^\[( |x)\]\s+(.*)$/i);
      list.items.push(task ? `<span class="md-task ${task[1] !== ' ' ? 'on' : ''}">${icon(task[1] !== ' ' ? 'circle-check' : 'circle')}</span>${inline(task[2])}` : inline(li[3]));
      i++;
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    flush();
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|[-*+•]\s|\d+[.)]\s|\|)/.test(lines[i]) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  flush();
  return out.join('');
}
const sizeOf = (s) => { const n = new Blob([s]).size; return n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`; };

// ---------------------------------------------------------------- files from the AI
const MIME = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', svg: 'image/svg+xml', py: 'text/x-python', js: 'text/javascript', css: 'text/css', xml: 'text/xml', tex: 'text/x-tex', ics: 'text/calendar' };
/** Turns a block into bytes (Markdown -> PDF for .pdf names). */
export async function blockBytes(id) {
  const b = BLOCKS[id];
  if (!b) throw new Error('Gone');
  if (b.bytes) return b;
  if (/\.pdf$/i.test(b.name)) return { ...b, bytes: await mdToPdf(b.code), mime: 'application/pdf' };
  const ext = b.name.split('.').pop().toLowerCase();
  return { ...b, bytes: new TextEncoder().encode(b.code), mime: MIME[ext] || 'text/plain' };
}
export async function saveBlock(id, open) {
  try {
    const f = await blockBytes(id);
    if (!hasNative()) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([f.bytes], { type: f.mime }));
      a.download = f.name; a.click();
      return;
    }
    const tmp = await native.writeCache(f.name, bytesToB64(f.bytes));
    if (open) {
      const { openViewer } = await import('./viewer.js');
      openViewer({ name: f.name, size: f.bytes.length, path: tmp.path, mime: f.mime });
    } else {
      await native.saveFile(tmp.path, f.name);
      toast(t('Saved to Downloads'));
    }
  } catch (e) { toast(t(e.message), 'err'); }
}
/** Files made by running code (Python plots, CSVs…) are kept here: id -> { name, bytes, mime } */
export function addFileBlock(name, bytes, mime) {
  const id = `b${++blockSeq}`;
  BLOCKS[id] = { name, bytes, mime, code: '' };
  return `<div class="md-file" data-block="${id}">${/^image\//.test(mime) ? `<img src="data:${mime};base64,${bytesToB64(bytes)}" alt="">` : `<span class="mf-ic">${icon(fileIcon(name))}</span>`}<span class="mf-txt"><b>${esc(name)}</b><small>${esc(bytes.length > 1e3 ? `${Math.round(bytes.length / 1e3)} KB` : `${bytes.length} B`)}</small></span>
    <button class="icon-btn" data-act="file-open-block" data-id="${id}" aria-label="${esc(t('Open'))}">${icon('eye')}</button>
    <button class="icon-btn" data-act="file-save-block" data-id="${id}" aria-label="${esc(t('Save'))}">${icon('download')}</button></div>`;
}

/** Markdown -> PDF. Text is drawn on A4 pages with the app's fonts, so every language and script works. */
export async function mdToPdf(md) {
  const W = 1240; const H = 1754; const M = 110; // A4 at 150 dpi
  const pages = [];
  let cv; let ctx; let y;
  const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const newPage = () => {
    if (cv) pages.push(cv);
    cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#111'; ctx.textBaseline = 'top';
    y = M;
  };
  const wrap = (text, size, weight = 400, indent = 0, color = '#111', lh = 1.45, style = '') => {
    ctx.font = `${style} ${weight} ${size}px ${font}`; ctx.fillStyle = color;
    const words = String(text).split(/(\s+)/);
    let line = '';
    const lines = [];
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > W - 2 * M - indent && line.trim()) { lines.push(line.trimEnd()); line = w.trimStart(); } else line = test;
    }
    if (line.trim()) lines.push(line.trimEnd());
    for (const l of lines) {
      if (y + size * lh > H - M) newPage(), ctx.font = `${style} ${weight} ${size}px ${font}`, ctx.fillStyle = color;
      ctx.fillText(l, M + indent, y);
      y += size * lh;
    }
  };
  const plain = (s) => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/(^|\s)[*_](.+?)[*_](?=\s|$)/g, '$1$2');
  newPage();
  const lines = String(md).replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      ctx.fillStyle = '#f3f4f6';
      const h = code.length * 26 + 24;
      if (y + Math.min(h, 400) > H - M) newPage();
      ctx.fillStyle = '#f3f4f6'; ctx.fillRect(M - 10, y - 6, W - 2 * M + 20, Math.min(h, H - M - y));
      y += 6;
      for (const c of code) wrap(c || ' ', 20, 400, 6, '#1f2937', 1.3);
      y += 16;
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.+)$/);
    if (h) { y += 14; wrap(plain(h[2]), [0, 46, 36, 30, 26, 24, 22][h[1].length], 750, 0, '#0b0b10', 1.25); y += 10; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { y += 10; ctx.fillStyle = '#d1d5db'; ctx.fillRect(M, y, W - 2 * M, 2); y += 22; continue; }
    const li = l.match(/^\s*(?:([-*+•])|(\d+)[.)])\s+(.*)$/);
    if (li) { ctx.font = `400 25px ${font}`; ctx.fillStyle = '#111'; if (y + 36 > H - M) newPage(); ctx.fillText(li[1] ? '•' : `${li[2]}.`, M + 8, y); wrap(plain(li[3]), 25, 400, 44); y += 4; continue; }
    if (/^\s*>/.test(l)) { ctx.fillStyle = '#9ca3af'; ctx.fillRect(M, y, 4, 34); wrap(plain(l.replace(/^\s*>\s?/, '')), 25, 400, 22, '#4b5563', 1.45, 'italic'); continue; }
    if (/^\s*\|/.test(l)) { if (/^\s*\|?\s*:?-{2,}/.test(l)) continue; wrap(plain(l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('    ')), 23, 400, 0, '#111'); continue; }
    if (!l.trim()) { y += 16; continue; }
    wrap(plain(l), 25, 400);
  }
  pages.push(cv);
  const photos = pages.map((c) => {
    const data = c.toDataURL('image/jpeg', 0.9).split(',')[1];
    return { bytes: Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)), w: W, h: H };
  });
  return photosToPdf(photos);
}

// ---------------------------------------------------------------- running code
let pyWorker = null;
const pyCalls = new Map();
const WORKER_SRC = `
let py = null;
async function boot() {
  if (py) return py;
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js');
  py = await loadPyodide();
  return py;
}
onmessage = async (e) => {
  const { id, code } = e.data;
  const out = [];
  try {
    const p = await boot();
    p.setStdout({ batched: (s) => out.push(s) });
    p.setStderr({ batched: (s) => out.push(s) });
    await p.loadPackagesFromImports(code, { messageCallback: () => {} });
    try { p.FS.mkdir('/out'); } catch (_) {}
    for (const f of p.FS.readdir('/out')) if (f !== '.' && f !== '..') p.FS.unlink('/out/' + f);
    p.FS.chdir('/out');
    if (/matplotlib|pyplot/.test(code)) {
      await p.runPythonAsync("import matplotlib\\nmatplotlib.use('Agg')\\nimport matplotlib.pyplot as _plt\\n_n=[0]\\ndef _show(*a, **k):\\n    _n[0]+=1\\n    _plt.savefig(f'/out/figure_{_n[0]}.png', dpi=150, bbox_inches='tight')\\n    _plt.close('all')\\n_plt.show=_show");
    }
    const res = await p.runPythonAsync(code);
    if (/matplotlib|pyplot/.test(code)) await p.runPythonAsync("import matplotlib.pyplot as _plt\\nif _plt.get_fignums(): _plt.show()");
    if (res !== undefined && res !== null && String(res) !== 'None') out.push(String(res));
    const files = p.FS.readdir('/out').filter((f) => f !== '.' && f !== '..').slice(0, 10).map((f) => ({ name: f, bytes: p.FS.readFile('/out/' + f) }));
    postMessage({ id, ok: true, out: out.join('\\n'), files });
  } catch (err) {
    postMessage({ id, ok: false, out: out.join('\\n'), error: String(err.message || err).split('\\n').slice(-6).join('\\n') });
  }
};`;
function runPython(code) {
  if (!pyWorker) pyWorker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
  pyWorker.onmessage = (e) => { const cb = pyCalls.get(e.data.id); if (cb) { pyCalls.delete(e.data.id); cb(e.data); } };
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => { pyCalls.set(id, resolve); pyWorker.postMessage({ id, code }); });
}
function runJs(code) {
  const src = `onmessage = async () => { const out = []; const log = (...a) => out.push(a.map((x) => typeof x === 'object' ? JSON.stringify(x, null, 1) : String(x)).join(' '));
    console.log = log; console.error = log; console.warn = log;
    try { const r = await (async () => { ${code}\n })(); if (r !== undefined) out.push(String(typeof r === 'object' ? JSON.stringify(r, null, 1) : r)); postMessage({ ok: true, out: out.join('\\n') }); }
    catch (e) { postMessage({ ok: false, out: out.join('\\n'), error: String(e) }); } };`;
  return new Promise((resolve) => {
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    const timer = setTimeout(() => { w.terminate(); resolve({ ok: false, error: t('Stopped after 10 seconds') }); }, 10000);
    w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
    w.postMessage(0);
  });
}
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', csv: 'text/csv', txt: 'text/plain', pdf: 'application/pdf', json: 'application/json', html: 'text/html' };
/** Runs a code block and shows output (and files the code wrote to the current folder) under it. */
export async function runBlock(id, onError) {
  const b = BLOCKS[id];
  const box = document.getElementById(`out-${id}`);
  if (!b || !box) return;
  const py = /^(python|py)$/.test(b.lang);
  box.innerHTML = `<div class="mc-running">${icon('refresh-cw', 'spin-ic')}${esc(py ? t('Running Python… (the first run loads Python, about 10 MB)') : t('Running…'))}</div>`;
  let r;
  try { r = py ? await runPython(b.code) : await runJs(b.code); } catch (e) { r = { ok: false, error: e.message }; }
  const files = (r.files || []).map((f) => addFileBlock(f.name, f.bytes, MIME_BY_EXT[f.name.split('.').pop().toLowerCase()] || 'application/octet-stream')).join('');
  box.innerHTML = `${r.out ? `<pre class="mc-stdout">${esc(r.out)}</pre>` : ''}${r.ok ? '' : `<pre class="mc-err">${esc(r.error || 'Error')}</pre><button class="chip ai-chip" data-act="code-fix" data-id="${id}">${icon('sparkles')}${esc(t('Fix with AI'))}</button>`}${files}${r.ok && !r.out && !files ? `<small class="mc-ok">${icon('circle-check')}${esc(t('Done, no output'))}</small>` : ''}`;
  if (!r.ok) BLOCKS[id].error = r.error;
  return r;
}
export function copyBlock(id) {
  const b = BLOCKS[id];
  if (b) navigator.clipboard?.writeText(b.code).then(() => toast(t('Copied')), () => {});
}
