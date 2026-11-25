// Custom IServ screens: hub, messenger, mail, files, calendar and notifications.
import {
  seg, S, t, $, esc, icon, fmt, relDay, pad, store, emptyState, skeleton, stagger, openSheet, closeSheet, toast, hash,
  PALETTE, isDark, sameDay, daysBetween, startOfDay,
} from './core.js';
import { native } from './native.js';
import { IServ, normalizeIServHost, normalizeIServUser } from './iserv.js';
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
    ['is-tasks', 'clipboard-list', t('Tasks'), 0],
  ];
  const recent = (d.notifications || []).slice(0, 3);
  return `<div class="pad">
    <div class="is-hero"${stagger(0)}>
      <div class="is-hero-ic">${icon('school')}</div>
      <div class="is-hero-text"><b>IServ</b><small>${esc(acc.username)} · ${esc(acc.host)}</small></div>
      <button class="icon-btn" data-act="iserv-open" data-path="" aria-label="${esc(t('Open IServ website'))}">${icon('external-link')}</button>
    </div>
    <div class="card list-card"${stagger(1)}>${tiles.map(([v, ic, label, n]) => `<button class="row" data-act="${v.startsWith('web:') ? 'iserv-open' : 'nav'}" data-view="${v}" data-path="${v.startsWith('web:') ? v.slice(4) : ''}">
      <span class="row-ic tint" style="--c:${PALETTE[hash(v) % PALETTE.length]}">${icon(ic)}</span><span class="row-text"><b>${esc(label)}</b></span>${n ? `<em class="count">${n > 99 ? '99+' : n}</em>` : ''}${icon(v.startsWith('web:') ? 'external-link' : 'chevron-right', 'row-chev')}</button>`).join('')}</div>
    <div class="section-title">${icon('layout-grid')}${esc(t('More IServ'))}</div>
    <div class="card list-card">${MORE_MODULES.map(([path, ic, label]) => `<button class="row" data-act="iserv-open" data-path="${path}"><span class="row-ic tint" style="--c:${PALETTE[hash(path) % PALETTE.length]}">${icon(ic)}</span><span class="row-text"><b>${esc(t(label))}</b></span>${icon('external-link', 'row-chev')}</button>`).join('')}</div>
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
  const username = normalizeIServUser($('#is-user').value);
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
  } catch (e) {
    const hint = !$('#is-pass').value && e.code === 'auth' ? ` ${t('You left the password empty, so your WebUntis password was used. Enter your IServ password.')}` : '';
    toast(t(e.message) + hint, 'err');
  }
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

const MORE_MODULES = [
  ['forum', 'messages-square', 'Forums'], ['videoconference', 'video', 'Video conferences'], ['news', 'newspaper', 'News'],
  ['poll', 'chart-bar', 'Polls'], ['plan', 'clipboard-list', 'Plans'], ['booking', 'calendar-check', 'Room booking'],
  ['addressbook', 'book-user', 'Address book'], ['profile', 'user', 'My profile'],
];

// ---------------------------------------------------------------- tasks ("Aufgaben")
export function viewTasksIServ() {
  const c = client();
  if (!S.iservTasks && !I.error.tasks) {
    task('tasks', async () => { S.iservTasks = await c.exercises(); store.setCache('is-tasks', S.iservTasks); });
    return `<div class="pad">${skeleton(5)}</div>`;
  }
  if (!S.iservTasks) return `<div class="pad">${errBox('tasks', 'is-tasks-retry')}</div>`;
  const today = Number(`${new Date().getFullYear()}${pad(new Date().getMonth() + 1)}${pad(new Date().getDate())}`);
  const list = S.iservTasks.slice().sort((a, b) => (a.due || 99999999) - (b.due || 99999999));
  if (!list.length) return `<div class="pad">${emptyState('clipboard-list', t('No current tasks'))}</div>`;
  let i = 0;
  return `<div class="pad"><div class="card">${list.map((x) => {
    const d = x.due ? new Date(Math.floor(x.due / 10000), Math.floor(x.due / 100) % 100 - 1, x.due % 100) : null;
    const late = x.due && x.due < today && !x.done;
    return `<button class="row" data-act="is-task" data-id="${esc(x.id)}"${stagger(i++)}>
      <span class="row-ic tint" style="--c:${x.done ? '#30a46c' : late ? '#e5484d' : PALETTE[hash(x.tags[0] || x.title) % PALETTE.length]}">${icon(x.done ? 'circle-check' : 'clipboard-list')}</span>
      <span class="row-text"><b>${esc(x.title)}</b><small>${[x.tags.join(', '), d ? `${t('Due')} ${relDay(d)}` : ''].filter(Boolean).map(esc).join(' · ')}</small></span>${icon('chevron-right', 'row-chev')}</button>`;
  }).join('')}</div></div>`;
}

export async function openTask(id) {
  const x = S.iservTasks?.find((y) => y.id === id);
  if (!x) return;
  let det = null;
  let error = '';
  const build = () => `<div class="d-head" style="--c:${S.settings.accent}"><div class="d-chip">${esc(x.tags[0] || 'IServ')}</div><h2>${esc(x.title)}</h2>
      ${x.due ? `<p>${esc(t('Due'))} ${esc(relDay(new Date(Math.floor(x.due / 10000), Math.floor(x.due / 100) % 100 - 1, x.due % 100)))}</p>` : ''}</div>
    ${error ? `<div class="notice warn">${icon('circle-alert')}<span>${esc(t(error))}</span></div>` : !det ? skeleton(3) : `
      ${det.text ? `<div class="card"><p class="sum-text">${esc(det.text)}</p></div>` : ''}
      ${det.files.length ? `<div class="section-title">${icon('paperclip')}${esc(t('Attachments'))}</div><div class="card">${det.files.map((f) => `<button class="row" data-act="iserv-open" data-url="${esc(f.href)}"><span class="row-ic">${icon('file')}</span><span class="row-text"><b>${esc(f.name)}</b></span>${icon('external-link', 'row-chev')}</button>`).join('')}</div>` : ''}`}
    <button class="ai-cta" data-act="ai-homework" data-key="${esc(x.id)}"><span class="ai-orb">${icon('sparkles')}</span><span><b>${esc(t('Get help from AI'))}</b><small>${esc(t('Ask questions or send a photo of the task'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
    <button class="btn" data-act="iserv-open" data-url="${esc(x.url)}">${icon('upload')}${esc(t('Hand in on IServ'))}</button>`;
  openSheet(build, { full: true });
  try { det = await client().exerciseDetails(x.url); } catch (e) { error = e.message; }
  const body = $('.sheet-body'); if (body) body.innerHTML = build();
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
    <button class="fab" data-act="new-chat" aria-label="${esc(t('New chat'))}">${icon('square-pen')}</button>
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
  I.room = { id, name: r.name, direct: r.direct, encrypted: !!r.encrypted, messages: null, end: null };
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
    const media = m.kind === 'm.image' || m.kind === 'm.audio' || m.kind === 'm.file' || m.kind === 'm.video';
    const body = m.redacted ? `<i class="enc">${icon('ban')}${esc(t('Message deleted'))}</i>`
      : m.encrypted ? `<i class="enc">${icon('lock')}${esc(t('Encrypted message. Open it on the IServ website.'))}</i>`
        : m.kind === 'm.image' ? `<button class="m-img" data-act="img-view" data-mxc="${esc(m.mxc || m.localSrc || '')}" style="aspect-ratio:${m.info?.w && m.info?.h ? `${m.info.w}/${m.info.h}` : '4/3'}">${m.localSrc ? `<img src="${m.localSrc}" alt="">` : mediaCache[m.mxc] ? `<img src="${mediaCache[m.mxc]}" alt="">` : `<span class="m-load">${icon('image')}</span>`}</button>`
          : m.kind === 'm.audio' ? `<button class="m-voice" data-act="voice-play" data-mxc="${esc(m.mxc)}" data-id="${esc(m.id)}"><span class="vp-ic">${icon(playing.id === m.id && playing.on ? 'pause' : 'play')}</span><span class="vp-bars">${bars(m.id)}</span><span class="vp-t">${fmtDur(m.info?.duration)}</span></button>`
            : m.kind === 'm.file' || m.kind === 'm.video' ? `<button class="m-file" data-act="msg-file" data-mxc="${esc(m.mxc)}" data-name="${esc(m.filename)}"><span class="file-ic">${icon(fileIcon({ name: m.filename, type: m.info?.mimetype || '' }))}</span><span><b>${esc(m.filename)}</b><small>${esc(sizeText(m.info?.size || 0))}</small></span>${icon('download', 'row-chev')}</button>`
              : esc(m.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    return `${sep}<div class="msg ${m.mine ? 'me' : 'them'} ${tail ? 'tail' : ''} ${m.pending ? 'pending' : ''}" data-msg="${esc(m.id)}">
      ${!m.mine && !I.room.direct ? (tail ? avatar(m.name, 'sm') : '<span class="av-sp"></span>') : ''}
      <div class="bubble ${media && !m.redacted ? 'has-media' : ''}" ${!m.mine ? `style="--c:${PALETTE[hash(m.name) % PALETTE.length]}"` : ''}>${showName ? `<b class="who">${esc(m.name)}</b>` : ''}<span class="txt">${body}</span><small>${m.pending ? icon('clock', 'mini') : ''}${timeOf(m.ts)}</small></div>
    </div>`;
  }).join('');
}

function paintMessages(toBottom) {
  const box = $('#msgs');
  if (!box || !I.room?.messages) return;
  box.innerHTML = `${I.room.end ? `<button class="older" data-act="older-msgs">${icon('chevron-up')}${esc(t('Load earlier messages'))}</button>` : ''}${messagesHtml(I.room.messages)}${I.room.messages.length ? '' : emptyState('message-square', t('No messages yet'))}`;
  if (toBottom) requestAnimationFrame(() => { const main = $('#main'); main.scrollTop = main.scrollHeight; });
  hydrateImages();
}

// ---------------------------------------------------------------- media in chats
const mediaCache = {};
const playing = { id: null, on: false, audio: null };
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
const bars = (id) => Array.from({ length: 22 }, (_, i) => `<i style="height:${30 + ((hash(`${id}${i}`) % 70))}%"></i>`).join('');

async function hydrateImages() {
  const c = client();
  for (const el of document.querySelectorAll('.m-img[data-mxc^="mxc://"]')) {
    const mxc = el.dataset.mxc;
    if (el.querySelector('img')) continue;
    try {
      mediaCache[mxc] ||= await c.mediaData(mxc, 'thumbnail');
      el.innerHTML = `<img src="${mediaCache[mxc]}" alt="">`;
    } catch { el.innerHTML = `<span class="m-load">${icon('image')}${esc(t('Photo'))}</span>`; }
  }
}

export async function viewImage(mxc) {
  if (!mxc) return;
  const c = client();
  let src = /^data:/.test(mxc) ? mxc : mediaCache[mxc];
  openSheet(() => `<div class="img-view">${src ? `<img src="${src}" alt="">` : skeleton(1)}</div>
    ${/^mxc:/.test(mxc) ? `<div class="mail-actions"><button class="btn small ghost" data-act="msg-file" data-mxc="${esc(mxc)}" data-name="photo.jpg">${icon('download')}${esc(t('Save'))}</button></div>` : ''}`, { full: true });
  if (/^mxc:/.test(mxc)) {
    try { src = await c.mediaData(mxc, 'download'); const box = $('.img-view'); if (box) box.innerHTML = `<img src="${src}" alt="">`; } catch { /* keep thumbnail */ }
  }
}

export async function playVoice(mxc, id) {
  if (playing.id === id && playing.audio) {
    if (playing.on) { playing.audio.pause(); playing.on = false; } else { playing.audio.play(); playing.on = true; }
    paintMessages(false);
    return;
  }
  playing.audio?.pause();
  Object.assign(playing, { id, on: true, audio: null });
  paintMessages(false);
  try {
    const src = mediaCache[`a:${mxc}`] ||= await client().mediaData(mxc, 'download');
    const a = new Audio(src);
    playing.audio = a;
    a.ontimeupdate = () => {
      const el = document.querySelector(`.m-voice[data-id="${CSS.escape(id)}"]`);
      if (el) { el.style.setProperty('--p', `${(a.currentTime / (a.duration || 1)) * 100}%`); el.querySelector('.vp-t').textContent = fmtDur((a.duration - a.currentTime) * 1000); }
    };
    a.onended = () => { playing.on = false; paintMessages(false); };
    await a.play();
  } catch (e) { playing.on = false; paintMessages(false); toast(t('Could not play this voice message'), 'err'); }
}

export function downloadChatFile(mxc, name) {
  client().downloadMedia(mxc, name).then(() => toast(t('Downloading {name}', { name })), (e) => toast(e.message, 'err'));
}

export function viewRoom() {
  if (!I.room) return emptyState('message-square', t('No chat selected'));
  setTimeout(() => paintMessages(true), 0);
  const enc = I.room.encrypted;
  return `<div class="chat-wrap"><div class="chat">
    ${enc ? `<div class="ai-context">${icon('lock')}<span>${esc(t('This chat is end-to-end encrypted. Lessn can only show and send unencrypted messages; open it on the IServ website to read everything.'))}</span></div>` : ''}
    <div id="msgs" class="msgs">${I.error.room ? errBox('room') : skeleton(4)}</div>
  </div>
  <div class="composer-dock">
    <div id="voice-bar" class="voice-bar" hidden><span class="rec-dot"></span><b id="voice-time">0:00</b><span class="vb-hint">${esc(t('Recording voice message'))}</span>
      <button type="button" class="icon-btn" data-act="voice-cancel" aria-label="${esc(t('Delete'))}">${icon('trash-2')}</button>
      <button type="button" class="send" data-act="voice-send" aria-label="${esc(t('Send'))}">${icon('send')}</button></div>
    <form class="composer gem" id="composer">
      <button type="button" class="attach" data-act="chat-attach" aria-label="${esc(t('Attach'))}">${icon('plus')}</button>
      <textarea id="msg-input" rows="1" placeholder="${esc(t('Message'))}" enterkeyhint="send"></textarea>
      <button type="button" class="send mic" data-act="voice-start" aria-label="${esc(t('Voice message'))}">${icon('mic')}</button>
      <button class="send txt-send" aria-label="${esc(t('Send'))}">${icon('send')}</button>
    </form>
    <input type="file" id="chat-photo" accept="image/*" multiple hidden>
    <input type="file" id="chat-camera" accept="image/*" capture="environment" hidden>
    <input type="file" id="chat-file" hidden>
  </div></div>`;
}

export function openAttachMenu() {
  openSheet(() => `<h2 class="sheet-title">${icon('paperclip')}${esc(t('Send'))}</h2>
    <div class="attach-grid">
      <button data-act="pick" data-input="chat-photo"><span style="--c:#8e4ec6">${icon('image')}</span>${esc(t('Photos'))}</button>
      <button data-act="pick" data-input="chat-camera"><span style="--c:#e5484d">${icon('camera')}</span>${esc(t('Camera'))}</button>
      <button data-act="pick" data-input="chat-file"><span style="--c:#0090ff">${icon('file')}</span>${esc(t('File'))}</button>
    </div>`);
}

const readFile = (f) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f); });
const imageSize = (src) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => resolve({}); i.src = src; });
async function shrinkImage(file) {
  const src = await readFile(file);
  const { w, h } = await imageSize(src);
  if (!w || Math.max(w, h) <= 2048) return { src, w, h, mime: file.type || 'image/jpeg' };
  const k = 2048 / Math.max(w, h);
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const img = new Image(); img.src = src; await new Promise((r) => { img.onload = r; });
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return { src: cv.toDataURL('image/jpeg', 0.88), w: cv.width, h: cv.height, mime: 'image/jpeg' };
}

export async function sendFiles(files, asImage) {
  closeSheet(true);
  const c = client();
  for (const f of [...files].slice(0, 10)) {
    if (f.size > 50e6) { toast(t('{name} is too big (max 50 MB)', { name: f.name }), 'err'); continue; }
    const isImg = asImage || /^image\//.test(f.type);
    const tmp = { id: `tmp${Date.now()}${Math.random()}`, mine: true, ts: Date.now(), pending: true, kind: isImg ? 'm.image' : 'm.file', filename: f.name, info: { size: f.size, mimetype: f.type }, body: f.name };
    try {
      let data; let w; let h; let mime = f.type || 'application/octet-stream';
      if (isImg) { const r = await shrinkImage(f); data = r.src; w = r.w; h = r.h; mime = r.mime; tmp.localSrc = data; tmp.info = { ...tmp.info, w, h }; }
      else data = await readFile(f);
      I.room.messages = [...I.room.messages, tmp];
      paintMessages(true);
      const base64 = data.split(',')[1];
      const size = Math.round(base64.length * 0.75);
      const r = isImg ? await c.sendImage(I.room.id, { base64, mime, name: f.name || 'photo.jpg', w, h, size })
        : await c.sendFile(I.room.id, { base64, mime, name: f.name, size });
      tmp.id = r.event_id || tmp.id; tmp.pending = false;
      paintMessages(false);
    } catch (e) {
      I.room.messages = I.room.messages.filter((m) => m !== tmp);
      paintMessages(false);
      toast(t(e.message), 'err');
    }
  }
}

// voice messages
let voiceTimer = null;
export async function voiceStart() {
  try {
    const st = await native.request(['microphone']);
    if (st.microphone !== 'granted') { toast(t('Microphone permission is needed'), 'err'); return; }
    await native.voiceStart();
    const t0 = Date.now();
    $('#voice-bar').hidden = false;
    $('#composer').hidden = true;
    clearInterval(voiceTimer);
    voiceTimer = setInterval(() => { const el = $('#voice-time'); if (el) el.textContent = fmtDur(Date.now() - t0); }, 250);
  } catch (e) { toast(t(e.message === 'permission' ? 'Microphone permission is needed' : e.message), 'err'); }
}
export async function voiceStop(send) {
  clearInterval(voiceTimer);
  const bar = $('#voice-bar'); if (bar) bar.hidden = true;
  const comp = $('#composer'); if (comp) comp.hidden = false;
  let r;
  try { r = await native.voiceStop(!send); } catch { return; }
  if (!send || r.cancelled || !r.path) return;
  const tmp = { id: `tmp${Date.now()}`, mine: true, ts: Date.now(), pending: true, kind: 'm.audio', mxc: '', info: { duration: r.duration }, body: '' };
  I.room.messages = [...I.room.messages, tmp];
  paintMessages(true);
  try {
    const res = await client().sendVoice(I.room.id, { path: r.path, duration: r.duration, size: r.size });
    tmp.id = res.event_id || tmp.id; tmp.pending = false;
    paintMessages(false);
  } catch (e) {
    I.room.messages = I.room.messages.filter((m) => m !== tmp);
    paintMessages(false);
    toast(t(e.message), 'err');
  }
}

// message menu: copy / delete
export function messageMenu(id) {
  const m = I.room?.messages?.find((x) => x.id === id);
  if (!m || m.pending || m.redacted) return;
  openSheet(() => `<div class="card">
    ${m.body && m.kind === 'm.text' ? `<button class="row" data-act="msg-copy" data-id="${esc(id)}"><span class="row-ic">${icon('copy')}</span><span class="row-text"><b>${esc(t('Copy'))}</b></span></button>` : ''}
    ${m.mxc ? `<button class="row" data-act="msg-file" data-mxc="${esc(m.mxc)}" data-name="${esc(m.filename || 'file')}"><span class="row-ic">${icon('download')}</span><span class="row-text"><b>${esc(t('Save'))}</b></span></button>` : ''}
    ${m.mine ? `<button class="row danger" data-act="msg-delete" data-id="${esc(id)}"><span class="row-ic">${icon('trash-2')}</span><span class="row-text"><b>${esc(t('Delete for everyone'))}</b></span></button>` : ''}
  </div>`);
}
export function copyMessage(id) {
  const m = I.room?.messages?.find((x) => x.id === id);
  closeSheet();
  if (m) navigator.clipboard?.writeText(m.body).then(() => toast(t('Copied to clipboard')), () => {});
}
export async function deleteMessage(id) {
  closeSheet();
  try {
    await client().redact(I.room.id, id);
    const m = I.room.messages.find((x) => x.id === id);
    if (m) m.redacted = true;
    paintMessages(false);
  } catch (e) { toast(t(e.message), 'err'); }
}

// new chat
export function openNewChat() {
  let results = [];
  let q = '';
  let busy = false;
  const build = () => `<h2 class="sheet-title">${icon('square-pen')}${esc(t('New chat'))}</h2>
    <label class="search">${icon('search')}<input id="user-q" placeholder="${esc(t('Search people'))}" value="${esc(q)}" autocomplete="off"></label>
    <div id="user-results">${busy ? skeleton(3) : results.length ? `<div class="card">${results.map((u) => `<button class="chat-row" data-act="start-dm" data-id="${esc(u.id)}">${avatar(u.name)}<span class="chat-row-text"><b>${esc(u.name)}</b><span class="chat-row-bottom"><span>${esc(u.id.replace(/^@/, '').split(':')[0])}</span></span></span></button>`).join('')}</div>` : q.length >= 2 ? emptyState('search', t('No matches')) : ''}</div>`;
  openSheet(build, { full: true });
  let timer;
  openNewChat.search = (v) => {
    q = v; clearTimeout(timer);
    if (q.length < 2) { results = []; $('#user-results').innerHTML = ''; return; }
    timer = setTimeout(async () => {
      busy = true; $('#user-results').innerHTML = skeleton(3);
      try { results = await client().searchUsers(q); } catch (e) { results = []; toast(t(e.message), 'err'); }
      busy = false;
      const tmp = document.createElement('div'); tmp.innerHTML = build();
      $('#user-results').innerHTML = $('#user-results', tmp).innerHTML;
    }, 350);
  };
}
export async function startDirect(userId) {
  closeSheet(true);
  try {
    const roomId = await client().createDirect(userId);
    await loadRooms();
    openRoom(roomId);
  } catch (e) { toast(t(e.message), 'err'); }
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
  return `${folders.length > 1 ? `<div class="chips">${seg('mailFolder', folders.map((f) => [f.path, `${folderName(f)}${f.unread ? ` (${f.unread})` : ''}`]), I.folder, 'mail-folder')}</div>` : ''}
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
    <div class="file-tools">
      <button class="btn small ghost" data-act="file-upload">${icon('upload')}${esc(t('Upload'))}</button>
      <button class="btn small ghost" data-act="file-mkdir">${icon('folder-plus')}${esc(t('New folder'))}</button>
      <input type="file" id="file-up" multiple hidden>
    </div>
    ${list.length ? `<div class="card">${list.map((f) => `<div class="file-row">
      <button class="file-main" data-act="${f.isDir ? 'files-go' : 'file-open'}" data-p="${esc(f.isDir && !f.path.endsWith('/') ? `${f.path}/` : f.path)}">
        <span class="file-ic ${f.isDir ? 'dir' : ''}">${icon(fileIcon(f))}</span>
        <span class="row-text"><b>${esc(f.name)}</b><small>${[f.isDir ? '' : sizeText(f.size), f.modified ? when(f.modified) : ''].filter(Boolean).join(' · ')}</small></span>
      </button>
      <button class="icon-btn" data-act="file-menu" data-p="${esc(f.path)}" aria-label="${esc(t('More'))}">${icon('ellipsis-vertical')}</button>
    </div>`).join('')}</div>` : emptyState('folder', t('This folder is empty'))}
  </div>`;
}

const isImageFile = (f) => /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(f.name) || /^image\//.test(f.type || '');
export async function openFile(path) {
  const f = I.files?.find((x) => x.path === path);
  if (!f) return;
  if (!isImageFile(f)) { downloadFile(path); return; }
  openSheet(() => `<div class="img-view">${skeleton(1)}</div><div class="mail-actions"><button class="btn small ghost" data-act="file-dl" data-p="${esc(path)}">${icon('download')}${esc(t('Save'))}</button></div>`, { full: true });
  try { const src = await client().fileData(path); const box = $('.img-view'); if (box) box.innerHTML = `<img src="${src}" alt="">`; } catch (e) { toast(t(e.message), 'err'); }
}

export function fileMenu(path) {
  const f = I.files?.find((x) => x.path === path);
  if (!f) return;
  openSheet(() => `<h2 class="sheet-title">${icon(fileIcon(f))}${esc(f.name)}</h2><div class="card">
    ${f.isDir ? '' : `<button class="row" data-act="file-dl" data-p="${esc(path)}"><span class="row-ic">${icon('download')}</span><span class="row-text"><b>${esc(t('Download'))}</b></span></button>`}
    <button class="row" data-act="file-rename" data-p="${esc(path)}"><span class="row-ic">${icon('pencil')}</span><span class="row-text"><b>${esc(t('Rename'))}</b></span></button>
    <button class="row danger" data-act="file-delete" data-p="${esc(path)}"><span class="row-ic">${icon('trash-2')}</span><span class="row-text"><b>${esc(t('Delete'))}</b></span></button>
  </div>`);
}

const reloadFiles = () => loadFiles(I.path);
export async function fileRename(path) {
  const f = I.files?.find((x) => x.path === path);
  closeSheet(true);
  const name = prompt(t('New name'), f?.name || '');
  if (!name || name === f?.name || /[\\/]/.test(name)) return;
  const parent = path.replace(/\/$/, '').split('/').slice(0, -1).join('/');
  try { await client().move(path, `${parent}/${name}${f?.isDir ? '/' : ''}`); reloadFiles(); } catch (e) { toast(t(e.message), 'err'); }
}
export async function fileDelete(path) {
  const f = I.files?.find((x) => x.path === path);
  closeSheet(true);
  if (!confirm(t('Delete {name}?', { name: f?.name || path }))) return;
  try { await client().remove(path); reloadFiles(); toast(t('Deleted')); } catch (e) { toast(t(e.message), 'err'); }
}
export async function fileMkdir() {
  const name = prompt(t('Folder name'));
  if (!name || /[\\/]/.test(name)) return;
  try { await client().mkdir(`${I.path.replace(/\/?$/, '/')}${name}/`); reloadFiles(); } catch (e) { toast(t(e.message), 'err'); }
}
export async function fileUpload(files) {
  for (const f of [...files].slice(0, 20)) {
    if (f.size > 25e6) { toast(t('{name} is too big (max 25 MB)', { name: f.name }), 'err'); continue; }
    toast(t('Uploading {name}', { name: f.name }));
    try { const data = await readFile(f); await client().uploadFile(I.path, { name: f.name, base64: data.split(',')[1], mime: f.type }); }
    catch (e) { toast(t(e.message), 'err'); }
  }
  reloadFiles();
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
