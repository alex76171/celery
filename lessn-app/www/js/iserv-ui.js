// Custom IServ screens: hub, messenger, mail, files, calendar and notifications.
import {
  S, t, $, esc, icon, fmt, relDay, pad, store, emptyState, skeleton, stagger, openSheet, closeSheet, toast, haptic, hash,
  PALETTE, isDark, sameDay, daysBetween, startOfDay,
} from './core.js';
import { native } from './native.js';
import { IServ, normalizeIServHost } from './iserv.js';
import { render, setView } from './app.js';

// ---------------------------------------------------------------- state
const I = {
  rooms: store.cache('is-rooms')?.data || null,
  room: null, // { id, name, messages, end, loadingOlder }
  mail: null, folder: 'INBOX', folders: null, mailTotal: 0,
  files: null, path: '/', events: store.cache('is-events')?.data || null,
  notes: null, polling: false, error: {},
};

export function client() {
  const acc = store.iserv();
  if (!acc) return null;
  if (!S.iserv || S.iserv.host !== acc.host || S.iserv.username !== acc.username) S.iserv = new IServ(acc);
  return S.iserv;
}

async function task(key, fn) {
  I.error[key] = null;
  S.loading++;
  try { await fn(); } catch (e) { console.warn(e); I.error[key] = e.message || String(e); if (e.code === 'network') S.offline = true; }
  finally { S.loading--; render(); }
}

const initials = (name) => (String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('') || '?').toUpperCase();
const avatar = (name, cls = '') => `<span class="av ${cls}" style="--c:${PALETTE[hash(name) % PALETTE.length]}">${esc(initials(name))}</span>`;
function when(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  if (sameDay(d, new Date())) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (daysBetween(d, new Date()) < 7) return fmt(d, { weekday: 'short' });
  return fmt(d, { day: 'numeric', month: 'short' });
}
const timeOf = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const sizeText = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : n ? `${n} B` : '');
const errBox = (key, retry) => (I.error[key] ? `<div class="notice warn">${icon('circle-alert')}<span>${esc(t(I.error[key]))}</span></div>${retry ? `<button class="btn small ghost" data-act="${retry}">${icon('refresh-cw')}${esc(t('Try again'))}</button>` : ''}` : '');

// ---------------------------------------------------------------- hub
export function viewIServHub() {
  const acc = store.iserv();
  if (!acc) return setupForm();
  const d = S.iservData || {};
  const unreadMail = (d.mail || []).filter((m) => !m.seen).length;
  const unreadNotes = (d.notifications || []).filter((n) => !n.read).length;
  const unreadChat = (I.rooms || []).reduce((a, r) => a + r.unread, 0);
  if (!I.rooms && !I.error.rooms) loadRooms();
  const tiles = [
    ['is-chat', 'message-square', t('Messenger'), unreadChat],
    ['is-mail', 'mail', t('E-Mail'), unreadMail],
    ['is-files', 'folder', t('Files'), 0],
    ['is-cal', 'calendar-days', t('Calendar'), 0],
    ['is-notes', 'bell', t('Notifications'), unreadNotes],
    ['web:exercise', 'clipboard-list', t('Tasks'), 0],
  ];
  const recent = (d.notifications || []).slice(0, 3);
  return `<div class="pad">
    <div class="is-hero"${stagger(0)}>
      <div class="is-hero-ic">${icon('school')}</div>
      <div class="is-hero-text"><b>IServ</b><small>${esc(acc.username)} · ${esc(acc.host)}</small></div>
      <button class="icon-btn" data-act="iserv-open" data-path="" aria-label="${esc(t('Open IServ website'))}">${icon('external-link')}</button>
    </div>
    <div class="is-grid">${tiles.map(([v, ic, label, n], i) => `<button class="is-tile" data-act="${v.startsWith('web:') ? 'iserv-open' : 'nav'}" data-view="${v}" data-path="${v.startsWith('web:') ? v.slice(4) : ''}"${stagger(i + 1)}>
      <span class="is-tile-ic">${icon(ic)}${n ? `<em>${n > 99 ? '99+' : n}</em>` : ''}</span><b>${esc(label)}</b></button>`).join('')}</div>
    ${recent.length ? `<div class="section-title">${icon('bell')}${esc(t('Latest'))}</div><div class="card">${recent.map((n) => noteRow(n)).join('')}</div>` : ''}
    ${(I.rooms || []).filter((r) => r.unread).slice(0, 3).length ? `<div class="section-title">${icon('message-square')}${esc(t('Unread chats'))}</div><div class="card">${I.rooms.filter((r) => r.unread).slice(0, 3).map(roomRow).join('')}</div>` : ''}
    <div class="card" style="margin-top:16px"><button class="row danger" data-act="iserv-logout"><span class="row-ic">${icon('log-out')}</span><span class="row-text"><b>${esc(t('Disconnect IServ'))}</b></span></button></div>
  </div>`;
}

function setupForm() {
  return `<div class="pad">
    <div class="iserv-intro"${stagger(0)}><div class="logo small">${icon('school')}</div><h2>${esc(t('Connect IServ'))}</h2><p>${esc(t('Messenger, mail, files and dates from IServ, right here.'))}</p></div>
    <button class="btn" data-act="setup-iserv"${stagger(1)}>${icon('search')}${esc(t('Set up IServ'))}</button>
  </div>`;
}

export async function connect() {
  const host = normalizeIServHost($('#is-host').value);
  const username = $('#is-user').value.trim();
  const password = $('#is-pass').value || S.account.password;
  if (!host || !username) { toast(t('Fill in the IServ address and username'), 'err'); return; }
  toast(t('Connecting…'));
  try {
    const c = new IServ({ host, username, password });
    await c.login();
    store.setIServ({ host, username, password });
    S.iserv = c;
    S.iservData = null;
    render();
    refreshHub();
  } catch (e) { toast(t(e.message), 'err'); }
}

export async function refreshHub() {
  const c = client();
  if (!c) return;
  const [n, m, e] = await Promise.allSettled([c.notifications(), c.mail('INBOX', 0, 30), c.events()]);
  S.iservData = {
    notifications: n.status === 'fulfilled' ? n.value : S.iservData?.notifications || null,
    mail: m.status === 'fulfilled' ? m.value.items : S.iservData?.mail || null,
    events: e.status === 'fulfilled' ? e.value : S.iservData?.events || null,
    t: Date.now(),
  };
  store.setCache('iserv', S.iservData);
  render();
  loadRooms();
}

// ---------------------------------------------------------------- messenger
function roomRow(r) {
  const last = r.last ? (r.last.body == null ? t('Encrypted message') : `${r.last.mine ? `${t('You')}: ` : !r.direct ? `${r.last.sender}: ` : ''}${r.last.body}`) : '';
  return `<button class="chat-row ${r.unread ? 'unread' : ''}" data-act="open-room" data-id="${esc(r.id)}">
    ${avatar(r.name, r.direct ? '' : 'group')}
    <span class="chat-row-text"><span class="chat-row-top"><b>${esc(r.name)}</b><small>${r.last ? esc(when(r.last.ts)) : ''}</small></span>
    <span class="chat-row-bottom"><span>${esc(last)}</span>${r.unread ? `<em>${r.unread}</em>` : ''}</span></span>
  </button>`;
}

export function loadRooms() {
  const c = client();
  if (!c) return Promise.resolve();
  return task('rooms', async () => {
    I.rooms = await c.rooms();
    store.setCache('is-rooms', I.rooms.map((r) => ({ ...r })));
    startPolling();
  });
}

let roomQuery = '';
export function viewChats() {
  if (!I.rooms) { if (!I.error.rooms && !S.loading) loadRooms(); return `<div class="pad">${errBox('rooms', 'is-rooms-retry') || skeleton(6)}</div>`; }
  const list = I.rooms.filter((r) => !roomQuery || r.name.toLowerCase().includes(roomQuery.toLowerCase()));
  return `<div class="pad">
    <label class="search">${icon('search')}<input id="room-q" placeholder="${esc(t('Search chats'))}" value="${esc(roomQuery)}" autocomplete="off"></label>
    ${errBox('rooms')}
    ${list.length ? `<div class="card chat-list">${list.map(roomRow).join('')}</div>` : emptyState('message-square', t('No chats'))}
  </div>`;
}
export function filterRooms(q) {
  roomQuery = q;
  const tmp = document.createElement('div');
  tmp.innerHTML = viewChats();
  const a = $('.chat-list'); const b = $('.chat-list', tmp);
  if (a && b) a.innerHTML = b.innerHTML; else if (b) render();
}

export async function openRoom(id) {
  const r = (I.rooms || []).find((x) => x.id === id) || { id, name: 'Chat' };
  I.room = { id, name: r.name, direct: r.direct, messages: null, end: null };
  r.unread = 0;
  setView('is-room', 'left');
  const c = client();
  try {
    const res = await c.messages(id);
    if (I.room?.id !== id) return;
    I.room.messages = res.messages;
    I.room.end = res.end;
    paintMessages(true);
    const last = res.messages[res.messages.length - 1];
    if (last) c.markRoomRead(id, last.id);
  } catch (e) {
    I.error.room = e.message;
    render();
  }
}

export async function olderMessages() {
  const c = client();
  const room = I.room;
  if (!room?.end || room.loadingOlder) return;
  room.loadingOlder = true;
  try {
    const box = $('#msgs');
    const h = box?.scrollHeight || 0;
    const res = await c.messages(room.id, room.end);
    room.messages = [...res.messages, ...room.messages];
    room.end = res.messages.length ? res.end : null;
    paintMessages(false);
    const main = $('#main');
    if (box) main.scrollTop += box.scrollHeight - h;
  } finally { room.loadingOlder = false; }
}

function messagesHtml(list) {
  let lastDay = null;
  let lastSender = null;
  return list.map((m, i) => {
    const d = new Date(m.ts);
    let sep = '';
    if (!lastDay || !sameDay(d, lastDay)) { sep = `<div class="day-sep"><span>${esc(relDay(startOfDay(d)))}</span></div>`; lastSender = null; }
    lastDay = d;
    const next = list[i + 1];
    const tail = !next || next.sender !== m.sender || !sameDay(new Date(next.ts), d);
    const showName = !m.mine && !I.room.direct && lastSender !== m.sender;
    lastSender = m.sender;
    const body = m.encrypted
      ? `<i class="enc">${icon('lock')}${esc(t('Encrypted message. Open it on the IServ website.'))}</i>`
      : m.kind === 'm.image' ? `<span class="att">${icon('image')}${esc(t('Photo'))}</span>`
        : m.kind === 'm.file' ? `<span class="att">${icon('paperclip')}${esc(m.file)}</span>`
          : esc(m.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return `${sep}<div class="msg ${m.mine ? 'me' : 'them'} ${tail ? 'tail' : ''}">
      ${!m.mine && !I.room.direct ? (tail ? avatar(m.name, 'sm') : '<span class="av-sp"></span>') : ''}
      <div class="bubble" ${!m.mine ? `style="--c:${PALETTE[hash(m.name) % PALETTE.length]}"` : ''}>${showName ? `<b class="who">${esc(m.name)}</b>` : ''}<span class="txt">${body}</span><small>${timeOf(m.ts)}</small></div>
    </div>`;
  }).join('');
}

function paintMessages(toBottom) {
  const box = $('#msgs');
  if (!box || !I.room?.messages) return;
  box.innerHTML = `${I.room.end ? `<button class="older" data-act="older-msgs">${icon('chevron-up')}${esc(t('Load earlier messages'))}</button>` : ''}${messagesHtml(I.room.messages)}${I.room.messages.length ? '' : emptyState('message-square', t('No messages yet'))}`;
  if (toBottom) requestAnimationFrame(() => { const main = $('#main'); main.scrollTop = main.scrollHeight; });
}

export function viewRoom() {
  if (!I.room) return emptyState('message-square', t('No chat selected'));
  setTimeout(() => paintMessages(true), 0);
  return `<div class="chat">
    <div id="msgs" class="msgs">${I.error.room ? errBox('room') : skeleton(4)}</div>
  </div>
  <form class="composer" id="composer">
    <textarea id="msg-input" rows="1" placeholder="${esc(t('Message'))}" enterkeyhint="send"></textarea>
    <button class="send" aria-label="${esc(t('Send'))}">${icon('send')}</button>
  </form>`;
}

export async function sendMessage() {
  const input = $('#msg-input');
  const text = input?.value.trim();
  if (!text || !I.room) return;
  const c = client();
  const tmp = { id: `tmp${Date.now()}`, sender: c.matrix?.userId, name: '', mine: true, ts: Date.now(), body: text, kind: 'm.text', pending: true };
  I.room.messages = [...(I.room.messages || []), tmp];
  input.value = '';
  input.style.height = '';
  haptic();
  paintMessages(true);
  try {
    const r = await c.send(I.room.id, text);
    tmp.id = r.event_id || tmp.id;
    tmp.pending = false;
  } catch (e) {
    I.room.messages = I.room.messages.filter((m) => m !== tmp);
    input.value = text;
    paintMessages(true);
    toast(t(e.message), 'err');
  }
}

// Live updates while a messenger screen is open
async function startPolling() {
  if (I.polling) return;
  I.polling = true;
  const c = client();
  while (I.polling && c && store.iserv() && ['is-chat', 'is-room', 'iserv'].includes(S.view) && !document.hidden) {
    try {
      const updates = await c.poll(20000);
      for (const [roomId, msgs] of Object.entries(updates)) {
        const r = (I.rooms || []).find((x) => x.id === roomId);
        const lastMsg = msgs[msgs.length - 1];
        if (r && lastMsg) {
          r.last = { body: lastMsg.encrypted ? null : lastMsg.body, sender: lastMsg.name, mine: lastMsg.mine, ts: lastMsg.ts };
          if (!(S.view === 'is-room' && I.room?.id === roomId) && !lastMsg.mine) r.unread += msgs.filter((m) => !m.mine).length;
        }
        if (S.view === 'is-room' && I.room?.id === roomId && I.room.messages) {
          const known = new Set(I.room.messages.map((m) => m.id));
          const fresh = msgs.filter((m) => !known.has(m.id) && !(m.mine && I.room.messages.some((x) => x.pending && x.body === m.body)));
          I.room.messages.forEach((x) => { if (x.pending && msgs.some((m) => m.mine && m.body === x.body)) x.pending = false; });
          if (fresh.length) {
            const main = $('#main');
            const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 120;
            I.room.messages = [...I.room.messages, ...fresh];
            paintMessages(atBottom);
            c.markRoomRead(roomId, fresh[fresh.length - 1].id);
            if (!atBottom) toast(t('New message'));
          }
        }
      }
      if (I.rooms) I.rooms.sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0));
      if (S.view === 'is-chat' && !$('#room-q:focus')) filterRooms(roomQuery);
    } catch (e) {
      console.warn(e);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  I.polling = false;
}
export const resumePolling = () => { if (['is-chat', 'is-room'].includes(S.view)) startPolling(); };

// ---------------------------------------------------------------- mail
export function loadMail(more = false) {
  const c = client();
  return task('mail', async () => {
    if (!I.folders) I.folders = await c.folders();
    const res = await c.mail(I.folder, more ? I.mail.length : 0, 30);
    I.mail = more ? [...I.mail, ...res.items] : res.items;
    I.mailTotal = res.total;
  });
}

const folderName = (f) => ({ INBOX: t('Inbox'), 'INBOX/Sent': t('Sent'), Sent: t('Sent'), 'INBOX/Drafts': t('Drafts'), Drafts: t('Drafts'), 'INBOX/Trash': t('Trash'), Trash: t('Trash') }[f.path] || f.name.split(/[/.]/).pop());

export function viewMail() {
  if (!I.mail) { if (!I.error.mail && !S.loading) loadMail(); return `<div class="pad">${errBox('mail', 'is-mail-retry') || skeleton(6)}</div>`; }
  const folders = (I.folders || []).slice(0, 12);
  return `${folders.length > 1 ? `<div class="chips scroll">${folders.map((f) => `<button class="chip ${f.path === I.folder ? 'on' : ''}" data-act="mail-folder" data-f="${esc(f.path)}">${esc(folderName(f))}${f.unread ? ` <em>${f.unread}</em>` : ''}</button>`).join('')}</div>` : ''}
  <div class="pad">
    ${I.mail.length ? `<div class="card">${I.mail.map((m, i) => `<button class="mail-row ${m.seen ? '' : 'unread'}" data-act="open-mail" data-i="${i}">
      ${avatar(m.from || '?')}
      <span class="mail-text"><span class="mail-top"><b>${esc(m.from || t('Unknown'))}</b><small>${esc(when(m.date))}</small></span>
      <span class="mail-subj">${m.flagged ? icon('star', 'flag') : ''}${esc(m.subject || t('(no subject)'))}${m.attachments ? icon('paperclip', 'clip') : ''}</span></span>
    </button>`).join('')}</div>` : emptyState('inbox', t('Inbox is empty'))}
    ${I.mail.length < I.mailTotal ? `<button class="btn small ghost center-btn" data-act="mail-more">${esc(t('Load more'))}</button>` : ''}
    <button class="fab" data-act="iserv-open" data-path="mail/compose" aria-label="${esc(t('New email'))}">${icon('square-pen')}</button>
  </div>`;
}

export function setFolder(f) { I.folder = f; I.mail = null; render(); loadMail(); }

export async function openMail(i) {
  const m = I.mail?.[i];
  if (!m) return;
  const c = client();
  let msg = null;
  let error = '';
  const build = () => {
    if (error) return `<div class="pad">${`<div class="notice warn">${icon('circle-alert')}<span>${esc(t(error))}</span></div>`}<button class="btn small" data-act="iserv-open" data-path="mail">${esc(t('Open on the IServ website'))}</button></div>`;
    if (!msg) return `<h2 class="sheet-title">${esc(m.subject)}</h2>${skeleton(3)}`;
    return `<div class="mail-head">
      <h2>${esc(msg.subject || m.subject)}</h2>
      <div class="mail-from">${avatar(msg.from[0]?.name || m.from)}<div><b>${esc(msg.from[0]?.name || m.from)}</b><small>${esc(msg.from[0]?.addr || '')}</small><small>${esc(t('to'))} ${esc(msg.to.join(', '))}${msg.cc.length ? ` · cc ${esc(msg.cc.join(', '))}` : ''}</small></div><small class="mail-date">${esc(when(msg.date))}</small></div>
    </div>
    ${msg.attachments.length ? `<div class="chips-mini">${msg.attachments.map((a) => `<span>${icon('paperclip')}${esc(a.name)} ${esc(sizeText(a.size))}</span>`).join('')}</div>` : ''}
    <div class="mail-body"><iframe id="mail-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="mail"></iframe></div>
    <div class="mail-actions">
      <button class="btn small ghost" data-act="iserv-open" data-path="mail/compose?replyTo=${encodeURIComponent(m.uid)}&path=${encodeURIComponent(m.folder)}">${icon('reply')}${esc(t('Reply'))}</button>
      <button class="btn small ghost" data-act="iserv-open" data-path="mail?path=${encodeURIComponent(m.folder)}&msg=${encodeURIComponent(m.uid)}">${icon('external-link')}${esc(t('Open in IServ'))}</button>
    </div>`;
  };
  openSheet(build, { full: true });
  try {
    msg = await c.message(m.uid, m.folder);
    if (!m.seen) { m.seen = true; c.markRead(m.uid, m.folder); }
  } catch (e) { error = e.message; }
  const body = $('.sheet-body');
  if (!body) return;
  body.innerHTML = build();
  fillMailFrame(msg);
  render();
}

function fillMailFrame(msg) {
  const f = $('#mail-frame');
  if (!f || !msg) return;
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const css = `body{margin:0;padding:14px 16px;font:15px/1.5 system-ui,Roboto,sans-serif;color:${v('--text')};background:transparent;word-wrap:break-word}
    a{color:${S.settings.accent}} img{max-width:100%;height:auto} table{max-width:100%!important} pre{white-space:pre-wrap}
    blockquote{margin:8px 0;padding-left:10px;border-left:3px solid ${v('--line')};color:${v('--text2')}}`;
  const content = msg.html
    ? msg.html.replace(/<script[\s\S]*?<\/script>/gi, '')
    : `<pre style="font:inherit">${esc(msg.text)}</pre>`;
  f.srcdoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>${css}</style>${isDark() && msg.html ? `<style>body{background:${v('--surface')}}</style>` : ''}</head><body>${content}</body></html>`;
  f.onload = () => { try { f.style.height = `${f.contentDocument.documentElement.scrollHeight + 4}px`; } catch { f.style.height = '60vh'; } };
}

// ---------------------------------------------------------------- files
const FILE_ICONS = [[/pdf/, 'file-text'], [/image|png|jpe?g|gif|webp|heic/, 'image'], [/video|mp4|mov/, 'video'], [/audio|mp3|m4a|wav/, 'music'],
  [/zip|rar|7z/, 'file-archive'], [/sheet|excel|xlsx?|csv|ods/, 'file-spreadsheet'], [/presentation|pptx?|odp/, 'presentation'], [/word|docx?|odt|text|txt/, 'file-text']];
const fileIcon = (f) => (f.isDir ? 'folder' : (FILE_ICONS.find(([re]) => re.test(`${f.type} ${f.name}`.toLowerCase())) || [0, 'file'])[1]);

export function loadFiles(path = I.path, { paint = true } = {}) {
  const c = client();
  I.path = path;
  I.files = null;
  I.error.files = null;
  if (paint) render();
  return task('files', async () => { I.files = await c.files(path); });
}

export function viewFiles() {
  if (!I.files) { if (!I.error.files && !S.loading) loadFiles(I.path, { paint: false }); return `<div class="pad">${errBox('files', 'is-files-retry') || skeleton(6)}</div>`; }
  const parts = I.path.split('/').filter(Boolean);
  const crumbs = [`<button data-act="files-go" data-p="/">${icon('house')}</button>`, ...parts.map((p, i) => `<button data-act="files-go" data-p="/${parts.slice(0, i + 1).join('/')}/">${esc(p)}</button>`)].join(icon('chevron-right', 'crumb-sep'));
  const list = I.files.slice().sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
  return `<div class="crumbs">${crumbs}</div><div class="pad">
    ${list.length ? `<div class="card">${list.map((f, i) => `<button class="file-row" data-act="${f.isDir ? 'files-go' : 'file-dl'}" data-p="${esc(f.path.endsWith('/') || !f.isDir ? f.path : `${f.path}/`)}" data-i="${i}">
      <span class="file-ic ${f.isDir ? 'dir' : ''}">${icon(fileIcon(f))}</span>
      <span class="row-text"><b>${esc(f.name)}</b><small>${[f.isDir ? '' : sizeText(f.size), f.modified ? when(f.modified) : ''].filter(Boolean).join(' · ')}</small></span>
      ${icon(f.isDir ? 'chevron-right' : 'download', 'row-chev')}
    </button>`).join('')}</div>` : emptyState('folder', t('This folder is empty'))}
  </div>`;
}

export function downloadFile(path) {
  const f = I.files?.find((x) => x.path === path);
  if (!f) return;
  client().downloadFile(f).then(() => toast(t('Downloading {name}', { name: f.name })), (e) => toast(e.message, 'err'));
}

// ---------------------------------------------------------------- calendar
export function viewCalendar() {
  const c = client();
  if (!I.events && !I.error.events) {
    task('events', async () => { I.events = await c.events(); store.setCache('is-events', I.events); });
    return `<div class="pad">${skeleton(4)}</div>`;
  }
  if (!I.events) return `<div class="pad">${errBox('events', 'is-cal-retry')}</div>`;
  const groups = {};
  I.events.forEach((e) => { const d = new Date(e.start); const k = Number.isNaN(d.getTime()) ? 'x' : startOfDay(d).getTime(); (groups[k] ||= []).push(e); });
  const keys = Object.keys(groups).sort();
  if (!keys.length) return `<div class="pad">${emptyState('calendar-days', t('No upcoming dates'))}</div>`;
  let i = 0;
  return `<div class="pad">${keys.map((k) => {
    const d = k === 'x' ? null : new Date(Number(k));
    return `<div class="cal-group"${stagger(i++)}>
      <div class="cal-date">${d ? `<b>${d.getDate()}</b><span>${esc(fmt(d, { month: 'short' }))}</span>` : '<b>?</b>'}</div>
      <div class="cal-items">${d ? `<small>${esc(relDay(d))}</small>` : ''}${groups[k].map((e) => {
        const s = new Date(e.start);
        return `<div class="cal-ev" style="--c:${e.color || S.settings.accent}"><b>${esc(e.title)}</b><span>${e.allDay || Number.isNaN(s.getTime()) ? esc(t('All day')) : `${pad(s.getHours())}:${pad(s.getMinutes())}`}${e.location ? ` · ${esc(e.location)}` : ''}${e.calendar ? ` · ${esc(e.calendar)}` : ''}</span></div>`;
      }).join('')}</div></div>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- notifications
function noteRow(n) {
  const d = new Date(n.date);
  return `<button class="d-row tap ${n.read ? '' : 'unread'}" data-act="is-note" data-id="${esc(n.id)}" data-url="${esc(n.url)}">${icon('bell')}<div><span>${esc(n.title)}</span><small>${esc(n.text)}${Number.isNaN(d.getTime()) ? '' : ` · ${esc(when(d))}`}</small></div></button>`;
}
export function viewNotes() {
  const list = S.iservData?.notifications;
  if (!list) { refreshHub(); return `<div class="pad">${skeleton(5)}</div>`; }
  const unread = list.filter((n) => !n.read).length;
  return `<div class="pad">
    ${unread ? `<button class="btn small ghost" data-act="is-read-all" style="margin-bottom:12px">${icon('check')}${esc(t('Mark all as read'))}</button>` : ''}
    ${list.length ? `<div class="card">${list.map(noteRow).join('')}</div>` : emptyState('bell', t('No notifications'))}
  </div>`;
}
export function openNote(id, url) {
  const n = S.iservData?.notifications?.find((x) => String(x.id) === String(id));
  if (n && !n.read) { n.read = true; client().readNotification(n.id); }
  if (url) iservOpenUrl(url); else render();
}
export function readAll() { (S.iservData?.notifications || []).forEach((n) => { n.read = true; }); client().readAllNotifications(); render(); }

// ---------------------------------------------------------------- web pages in the IServ browser
export function iservCss() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const dark = isDark();
  const solid = (c, fallback) => (/rgba|color-mix/.test(c) ? fallback : c);
  const bg = solid(v('--bg'), dark ? '#0f1015' : '#f4f5f9');
  const surface = dark ? '#1b1d25' : '#ffffff';
  const r = S.settings.radius;
  return `
  :root{--lessn-accent:${S.settings.accent};color-scheme:${dark ? 'dark' : 'light'}}
  html,body{background:${bg}!important;font-family:system-ui,Roboto,sans-serif!important;-webkit-font-smoothing:antialiased}
  ${dark ? `body,.panel,.card,.list-group-item,.dropdown-menu,.modal-content,.well,table,.table,.form-control,input,select,textarea,.navbar,#idesk-sidebar,.sidebar,header,.page-content,.content,main{background-color:${surface}!important;color:#e9ebf2!important;border-color:rgba(255,255,255,.08)!important}
  .text-muted,small,.help-block{color:#a4a9ba!important} a{color:${S.settings.accent}!important} img{opacity:.92}` : ''}
  .panel,.card,.dropdown-menu,.modal-content,.list-group-item,.well{border-radius:${r}px!important;box-shadow:none!important}
  .btn,.form-control,.input-group,input,select,textarea{border-radius:${Math.max(6, r - 4)}px!important}
  .btn-primary,.btn-success,.label-primary,.badge-primary,.active>a,.nav-pills>.active>a{background:var(--lessn-accent)!important;border-color:var(--lessn-accent)!important;color:#fff!important}
  a{color:var(--lessn-accent)}
  table.table>tbody>tr>td{padding-top:10px!important;padding-bottom:10px!important}`;
}

export function iservOpen(path) {
  const acc = store.iserv();
  if (!acc) return;
  iservOpenUrl(`https://${acc.host}/iserv/${path || ''}`);
}
export function iservOpenUrl(url) {
  const acc = store.iserv();
  if (!acc) return;
  const target = /^https?:/.test(url) ? url : `https://${acc.host}${url.startsWith('/') ? '' : '/'}${url}`;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  native.openIServ({ url: target, username: acc.username, password: acc.password, css: iservCss(), bg: /^#/.test(bg) ? bg : isDark() ? '#0f1015' : '#ffffff' });
}

export function disconnect() {
  store.setIServ(null);
  S.iserv = null; S.iservData = null;
  Object.assign(I, { rooms: null, room: null, mail: null, folders: null, files: null, events: null, polling: false });
  ['iserv', 'is-rooms', 'is-events'].forEach((k) => store.setCache(k, null));
  render();
}

export const roomTitle = () => I.room?.name || t('Chat');
export const retry = (what) => { I.error[what] = null; if (what === 'rooms') loadRooms(); if (what === 'mail') loadMail(); if (what === 'files') loadFiles(); if (what === 'events') render(); };
