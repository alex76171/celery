// One file viewer for everything: IServ files, messenger attachments, mail attachments, task attachments.
// Shows images, PDFs (page by page), text and Office documents, audio and video in the app, and can open the file
// in another app, share it, save it to Downloads or ask the AI about it.
import { S, t, $, esc, icon, openSheet, toast, openMenu } from './core.js';
import { native, hasNative } from './native.js';
import { officeKind, officeText } from './docs.js';
import { fileHelp, aiReady } from './ai.js';
import { md, attachPath, newChat, pdfImages } from './assist.js';

const V = { file: null, name: '', loading: false, error: '', pages: 0, shown: 0, text: '', ai: null, aiBusy: false };
const kindOf = (name, mime = '') => {
  const n = name.toLowerCase();
  if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/.test(n)) return 'image';
  if (/pdf/.test(mime) || n.endsWith('.pdf')) return 'pdf';
  if (/^video\//.test(mime) || /\.(mp4|mov|webm|mkv|3gp)$/.test(n)) return 'video';
  if (/^audio\//.test(mime) || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/.test(n)) return 'audio';
  if (officeKind(n)) return 'office';
  if (/^text\//.test(mime) || /json|xml|javascript/.test(mime) || /\.(txt|md|csv|tsv|json|xml|html?|css|js|ts|py|java|c|cpp|h|tex|log|ini|yml|yaml)$/.test(n)) return 'text';
  return 'other';
};
export const fileKind = kindOf;
const src = (path) => (window.Capacitor?.convertFileSrc ? window.Capacitor.convertFileSrc(path) : path);
const sizeText = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : n ? `${n} B` : '');
const decode = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const KIND_IC = { image: 'image', pdf: 'file-text', video: 'video', audio: 'music', office: 'file-text', text: 'file-text', other: 'file' };

/**
 * Opens the viewer. request: { url, headers, cookies } or a list of such requests (tried in order);
 * or { path, mime } for a file that is already on the phone.
 */
export async function openViewer({ name, size = 0, request, path, mime }) {
  Object.assign(V, { file: null, name, size, loading: true, error: '', pages: 0, shown: 0, text: '', ai: null, aiBusy: false });
  openSheet(build, { full: true });
  if (!hasNative()) { V.loading = false; V.error = t('Files can only be opened in the Android app.'); paint(); return; }
  try {
    if (path) V.file = { path, mime: mime || '', name, size };
    else {
      let last = '';
      for (const req of Array.isArray(request) ? request : [request]) {
        try {
          const r = await native.fetchFile({ ...req, name });
          if (r.status >= 400 || !r.path) { last = `HTTP ${r.status}`; continue; }
          if (/text\/html/.test(r.contentType || '') && !/\.html?$/i.test(name)) { last = t('IServ sent a web page instead of the file.'); continue; }
          V.file = r; break;
        } catch (e) { last = e.message; }
      }
      if (!V.file) throw new Error(last || t('Could not download the file.'));
    }
    V.kind = kindOf(V.file.name || name, V.file.mime);
    if (V.kind === 'text' || V.kind === 'office') {
      const r = await native.readFile(V.file.path);
      const bytes = decode(r.data);
      V.text = V.kind === 'office' ? await officeText(bytes, name) : new TextDecoder().decode(bytes.subarray(0, 400000));
    }
    if (V.kind === 'pdf') {
      const first = await native.pdfPage(V.file.path, 0, 1200);
      V.pages = first.pages; V.pageData = [first.data]; V.shown = 1;
    }
  } catch (e) { V.error = e.message; }
  V.loading = false;
  paint();
  if (V.kind === 'pdf') morePages();
}

function preview() {
  const f = V.file;
  if (V.kind === 'image') return `<div class="fv-img"><img src="${src(f.path)}" alt=""></div>`;
  if (V.kind === 'pdf') return `<div class="fv-pdf" id="fv-pdf">${(V.pageData || []).map((d, i) => `<img src="data:image/jpeg;base64,${d}" alt="${i + 1}">`).join('')}</div>
    <div class="fv-pageinfo">${esc(t('{n} of {total} pages', { n: V.shown, total: V.pages }))}</div>`;
  if (V.kind === 'video') return `<video class="fv-media" src="${src(f.path)}" controls playsinline></video>`;
  if (V.kind === 'audio') return `<div class="fv-audio">${icon('music')}<audio src="${src(f.path)}" controls></audio></div>`;
  if (V.kind === 'text' || V.kind === 'office') return V.text ? `<pre class="fv-text">${esc(V.text.slice(0, 120000))}</pre>` : `<p class="hint">${esc(t('No text found in this file.'))}</p>`;
  return `<div class="fv-other">${icon('file')}<p>${esc(t('This file type cannot be shown in Lessn. Open it with another app.'))}</p></div>`;
}

function build() {
  const head = `<div class="fv-head"><span class="file-ic">${icon(KIND_IC[V.kind] || 'file')}</span><div><b>${esc(V.name)}</b><small>${esc([sizeText(V.file?.size || V.size), V.pages ? t('{n} pages', { n: V.pages }) : ''].filter(Boolean).join(' · '))}</small></div></div>`;
  if (V.loading) return `${head}<div class="fv-loading">${icon('refresh-cw', 'spin-ic')}<span>${esc(t('Loading…'))}</span></div>`;
  if (V.error) return `${head}<div class="notice warn">${icon('circle-alert')}<span>${esc(t(V.error))}</span></div>`;
  const canAI = ['image', 'pdf', 'text', 'office'].includes(V.kind);
  return `${head}
    <div class="fv-actions">
      <button class="btn small" data-act="fv-open">${icon('external-link')}${esc(t('Open with…'))}</button>
      <button class="btn small ghost" data-act="fv-share">${icon('send')}${esc(t('Share'))}</button>
      <button class="btn small ghost" data-act="fv-save">${icon('download')}${esc(t('Save'))}</button>
    </div>
    ${canAI ? `<button class="ai-cta" data-act="fv-ai"><span class="ai-orb">${icon('sparkles')}</span><span><b>${esc(t('Ask AI about this file'))}</b><small>${esc(t('Summary, explanation, quiz, flashcards…'))}</small></span>${icon('chevron-down', 'row-chev')}</button>` : ''}
    <div id="fv-ai">${aiBox()}</div>
    ${preview()}`;
}
function aiBox() {
  if (V.aiBusy) return `<div class="card fv-ai-card"><div class="gm-ai thinking"><span class="gm-spark spin">${icon('sparkles')}</span><div class="gm-text"><span class="shimmer">${esc(t('Thinking…'))}</span><i class="gm-line"></i><i class="gm-line short"></i></div></div></div>`;
  if (!V.ai) return '';
  return `<div class="card fv-ai-card"><div class="gm-ai"><span class="gm-spark">${icon('sparkles')}</span><div class="gm-text">${md(V.ai)}</div></div>
    <div class="mail-actions"><button class="btn small ghost" data-act="fv-ai-copy">${icon('copy')}${esc(t('Copy'))}</button><button class="btn small ghost" data-act="fv-chat">${icon('message-square')}${esc(t('Continue in chat'))}</button></div></div>`;
}
function paint() { const b = $('.sheet-body'); if (b && V.name) b.innerHTML = build(); }

async function morePages() {
  const pdfPath = V.file?.path;
  while (V.file?.path === pdfPath && V.shown < Math.min(V.pages, 60)) {
    try {
      const r = await native.pdfPage(pdfPath, V.shown, 1200);
      if (V.file?.path !== pdfPath) return;
      V.pageData.push(r.data); V.shown++;
      const box = $('#fv-pdf');
      if (!box) return;
      box.insertAdjacentHTML('beforeend', `<img src="data:image/jpeg;base64,${r.data}" alt="${V.shown}">`);
      const info = $('.fv-pageinfo'); if (info) info.textContent = t('{n} of {total} pages', { n: V.shown, total: V.pages });
    } catch { return; }
  }
}

export function viewerAction(act, el) {
  const f = V.file;
  if (!f) return;
  if (act === 'fv-open') native.openFile(f.path, f.mime, V.name).catch((e) => toast(t(e.code === 'noapp' ? 'No app can open this file' : e.message), 'err'));
  if (act === 'fv-share') native.shareFile({ path: f.path, mime: f.mime }).catch((e) => toast(e.message, 'err'));
  if (act === 'fv-save') native.saveFile(f.path, V.name).then(() => toast(t('Saved to Downloads')), (e) => toast(e.message, 'err'));
  if (act === 'fv-ai-copy') navigator.clipboard?.writeText(V.ai || '').then(() => toast(t('Copied')));
  if (act === 'fv-chat') chatAbout();
  if (act === 'fv-ai') {
    if (!aiReady()) { toast(t('Add an AI key first.'), 'err'); return; }
    openMenu(el, [['summary', t('Summarize')], ['explain', t('Explain simply')], ['quiz', t('Quiz me')], ['cards', t('Make flashcards')], ['tasks', t('Help with the tasks in it')], ['chat', t('Chat about this file')]], '', (m) => (m === 'chat' ? chatAbout() : askAI(m)), t('Ask AI'));
  }
}

async function aiInput() {
  const f = V.file;
  if (V.kind === 'text' || V.kind === 'office') return { text: V.text };
  if (V.kind === 'pdf') return { images: await pdfImages(f.path, 8) };
  const r = await native.readFile(f.path);
  return { images: [{ mime: /png/.test(f.mime) ? 'image/png' : /webp/.test(f.mime) ? 'image/webp' : 'image/jpeg', data: r.data }] };
}

async function askAI(mode) {
  V.aiBusy = true; V.ai = null;
  const box = $('#fv-ai'); if (box) box.innerHTML = aiBox();
  try { V.ai = await fileHelp({ mode, name: V.name, ...(await aiInput()) }); } catch (e) { V.ai = `⚠ ${t(e.message)}`; }
  V.aiBusy = false;
  const b2 = $('#fv-ai'); if (b2) b2.innerHTML = aiBox();
}

async function chatAbout() {
  const f = V.file;
  try {
    if (V.kind === 'text' || V.kind === 'office') await attachPath({ path: f.path, name: V.name, mime: 'text/plain', text: V.text });
    else await attachPath({ path: f.path, name: V.name, mime: V.kind === 'pdf' ? 'application/pdf' : f.mime || 'image/jpeg' });
  } catch (e) { toast(t(e.message), 'err'); return; }
  newChat({ title: V.name, keepPending: true, go: false, context: V.ai ? `Earlier summary of the file "${V.name}":\n${V.ai}` : '' });
  const { setView } = await import('./app.js');
  const { closeSheet } = await import('./core.js');
  closeSheet(true);
  setView('ai-chat', 'left');
  setTimeout(() => $('#ai-input')?.focus(), 400);
}
