// App shell: navigation, rendering, gestures, events and startup.
import {
  S, t, $, $$, esc, icon, fmt, relDay, weekNumber, sameDay, startOfDay, addDays, mondayOf, toUntisDate, fromUntisDate, pad,
  store, applyTheme, syncBars, ddHandlers, uiConfirm, uiPrompt, closeMenu, closeDialog, toast, plugin, safe, closeSheet, sheetState, rerenderSheet, bindLongPress, bindRipple,
} from './core.js';
import { Untis } from './api.js';
import { native } from './native.js';
import {
  refresh, loadWeek, loadHomework, loadExams, scheduleNative, iservClient, loadIServ, weekKey,
} from './data.js';
import { viewToday, viewWeek, viewTasks, viewExams, openLesson, hwDone, allExams } from './views.js';
import { openAISetup, openIServSetup, maybeRunSetup, saveAISetup, saveIServSetup, setAiProvider, openKeyPage, loadAiModels } from './onboarding.js';
import {
  viewMore, viewGrades, viewAttendance, viewRecorder, openCustomize, openBrowse, openHolidays, openNews,
  openGradeForm, saveGrade, togglePresence, setSchoolLocation, checkNow, attDay, moveMonth,
  recStart, recStop, recState, processSummary, openSummary, deleteSummary, openNotifSettings, notifToggle, dndToggle,
  directions, setS, loadPresence,
} from './features.js';
import { renderLogin, bindLogin } from './login.js';
import * as IS from './iserv-ui.js';
import * as A from './assist.js';

const tabList = () => [...A.userTabs().map((id) => ({ id, ...A.TAB_DEFS[id] })), { id: 'more', label: 'Menu', icon: 'layout-grid' }];
const TITLES = {
  grades: 'Grades', iserv: 'IServ', attendance: 'Attendance', recorder: 'Lesson recorder', ai: 'AI helper', 'ai-chat': 'AI helper',
  'is-chat': 'Messenger', 'is-room': 'Chat', 'is-mail': 'E-Mail', 'is-files': 'Files', 'is-cal': 'Calendar', 'is-notes': 'Notifications', 'is-tasks': 'Tasks',
  today: 'Home', week: 'Timetable', tasks: 'Homework', exams: 'Exams',
};
const PARENT = { 'is-chat': 'iserv', 'is-mail': 'iserv', 'is-files': 'iserv', 'is-cal': 'iserv', 'is-notes': 'iserv', 'is-tasks': 'iserv', 'is-room': 'is-chat', 'ai-chat': 'ai' };
const isRoot = (v) => v === 'more' || A.userTabs().includes(v);
const parentOf = (v) => PARENT[v] || 'more';
const rootOf = (v) => { let x = v; for (let i = 0; i < 4 && !isRoot(x); i++) x = parentOf(x); return x; };
const SUBVIEWS = new Proxy({}, { get: (_, v) => (typeof v === 'string' && !isRoot(v) ? TITLES[v] || v : undefined) });
const ORDER = ['today', 'week', 'tasks', 'exams', 'ai', 'ai-chat', 'more', 'grades', 'iserv', 'attendance', 'recorder', 'is-chat', 'is-mail', 'is-files', 'is-cal', 'is-notes', 'is-tasks', 'is-room'];

// ---------------------------------------------------------------- shell
const navHtml = () => `<nav class="tabs"><span class="tab-ind" id="tab-ind"></span>${tabList().map((x) => `<button data-act="tab" data-view="${x.id}" id="tab-${x.id}">${icon(x.icon)}<span>${esc(t(x.label))}</span></button>`).join('')}</nav>`;
function renderShell() {
  document.body.innerHTML = `
  <div class="bg-blobs" aria-hidden="true"><i></i><i></i><i></i></div>
  <div id="app">
    <header class="top">
      <button class="icon-btn back" id="btn-back" data-act="back" aria-label="Back" hidden>${icon('chevron-left')}</button>
      <div class="title-wrap" id="title-wrap"><h1 id="title"></h1><div id="subtitle"></div></div>
      <div class="top-actions">
        <button class="icon-btn" id="btn-today" data-act="today" aria-label="Today" hidden>${icon('calendar')}</button>
        <button class="icon-btn" id="btn-refresh" data-act="refresh" aria-label="Refresh">${icon('refresh-cw')}</button>
      </div>
    </header>
    <div id="banner"></div>
    <main id="main"><div id="ptr">${icon('refresh-cw')}</div><div id="content"></div></main>
    ${navHtml()}
  </div>
  <div id="sheet-root"></div>
  <div id="toast" class="toast"></div>`;
  bindLongPress($('#title-wrap'), openCustomize);
  bindGestures($('#main'));
}

export function updateHeader() {
  const title = $('#title');
  if (!title) return;
  const v = S.view;
  const titles = {
    today: S.settings.appTitle || relDay(S.day), week: S.element ? S.element.label : t('Timetable'),
    tasks: t('Homework'), exams: t('Exams'), more: t('Menu'),
  };
  title.textContent = v === 'is-room' ? IS.roomTitle() : v === 'ai-chat' ? A.chatTitle() : titles[v] || t(TITLES[v] || '');
  $('#app').classList.toggle('chat-mode', v === 'is-room' || v === 'ai-chat');
  syncBars();
  const now = toUntisDate(new Date());
  const subs = {
    today: fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }),
    week: `${t('Week')} ${weekNumber(S.week)}`,
    tasks: S.homework ? t('{n} open', { n: S.homework.filter((h) => !hwDone(h) && h.due >= now).length }) : '',
    exams: S.exams ? t('{n} upcoming', { n: S.exams.filter((e) => e.date >= now).length }) : '',
    more: S.account?.schoolName || S.account?.school || '',
    grades: t('This school year'), iserv: store.iserv()?.host || '', attendance: t('Your attendance'), recorder: 'Beta',
    'is-chat': 'IServ', 'is-mail': 'IServ', 'is-files': 'IServ', 'is-cal': 'IServ', 'is-notes': 'IServ', 'is-room': 'IServ Messenger',
  };
  const sub = $('#subtitle');
  sub.textContent = S.offline ? t('Offline · showing saved data') : subs[v] || '';
  sub.classList.toggle('off', S.offline);
  $('#btn-refresh').classList.toggle('spin', S.loading > 0);
  $('#btn-back').hidden = !SUBVIEWS[v];
  const offToday = (v === 'today' && !sameDay(S.day, new Date())) || (v === 'week' && !sameDay(S.week, mondayOf(new Date())));
  $('#btn-today').hidden = !offToday;
  const active = rootOf(v);
  tabList().forEach((x) => $(`#tab-${x.id}`)?.classList.toggle('on', x.id === active));
  moveIndicator(active);
  $('#banner').innerHTML = S.element && (v === 'week' || v === 'today')
    ? `<div class="viewing">${icon('eye')}<span>${esc(t('Viewing'))} <b>${esc(S.element.label)}</b></span><button data-act="clear-element">${icon('x')}${esc(t('Back to mine'))}</button></div>` : '';
}

function moveIndicator(active) {
  const ind = $('#tab-ind');
  const tab = $(`#tab-${active}`);
  if (!ind || !tab) return;
  const r = tab.getBoundingClientRect();
  const p = tab.parentElement.getBoundingClientRect();
  ind.style.width = `${r.width}px`;
  ind.style.transform = `translateX(${r.left - p.left}px)`;
}

let lastView = null;
export function render() {
  if (!S.api || !$('#content')) return;
  S.index = {};
  const main = $('#main');
  const content = $('#content');
  const same = lastView === S.view && !S.anim;
  const keep = same ? main.scrollTop : 0;
  const views = {
    today: viewToday, week: viewWeek, tasks: viewTasks, exams: viewExams, more: viewMore, grades: viewGrades, attendance: viewAttendance,
    recorder: viewRecorder, iserv: IS.viewIServHub, 'is-chat': IS.viewChats, 'is-room': IS.viewRoom, 'is-mail': IS.viewMail,
    'is-files': IS.viewFiles, 'is-cal': IS.viewCalendar, 'is-notes': IS.viewNotes, 'is-tasks': IS.viewTasksIServ, ai: A.viewAI, 'ai-chat': A.viewAIChat,
  };
  if ((S.view === 'is-room' || S.view === 'ai-chat') && lastView === S.view && !S.anim) { updateHeader(); return; }
  content.innerHTML = views[S.view]();
  const anim = S.anim && S.settings.animations ? `anim anim-${S.anim}` : '';
  content.className = '';
  if (anim) { void content.offsetWidth; content.className = anim; }
  S.anim = null;
  main.scrollTop = keep;
  lastView = S.view;
  updateHeader();
}

export function setView(v, dir) {
  if (v === S.view) { $('#main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.anim = dir || (ORDER.indexOf(v) > ORDER.indexOf(S.view) ? 'left' : 'right');
  S.view = v;
  render();
  if (v === 'tasks' && !S.homework) loadHomework();
  if (v === 'tasks') A.loadIServTasks();
  if (v === 'exams' && !S.exams) loadExams();
  if (v === 'week' || v === 'today') loadWeek(S.week);
  if (v === 'iserv' && iservClient()) loadIServ();
  if (v === 'is-chat' || v === 'is-room') IS.resumePolling();
  if (v === 'attendance') loadPresence();
}

function setDay(d, anim) {
  S.anim = anim || (d > S.day ? 'left' : 'right');
  S.day = startOfDay(d);
  const m = mondayOf(S.day);
  if (!sameDay(m, S.week)) { S.week = m; loadWeek(m); }
  render();
}
function shiftDay(dir) {
  let d = addDays(S.day, dir);
  for (let i = 0; i < 7 && (d.getDay() === 0 || d.getDay() === 6); i++) {
    const data = S.weeks[weekKey(mondayOf(d))] || [];
    if (data.some((l) => l.date === toUntisDate(d)) || S.settings.weekDays === '7' || (S.settings.weekDays === '6' && d.getDay() === 6)) break;
    d = addDays(d, dir);
  }
  setDay(d, dir > 0 ? 'left' : 'right');
}
function shiftWeek(dir) {
  S.anim = dir > 0 ? 'left' : 'right';
  S.week = addDays(S.week, 7 * dir);
  S.day = sameDay(S.week, mondayOf(new Date())) ? startOfDay(new Date()) : S.week;
  render();
  loadWeek(S.week).then(() => loadWeek(addDays(S.week, 7 * dir), { quiet: true }));
}

// ---------------------------------------------------------------- gestures
function bindGestures(main) {
  let x0 = 0; let y0 = 0; let pulling = false; let tracking = false; let horiz = null;
  const ptr = $('#ptr');
  const content = $('#content');
  main.addEventListener('scroll', () => { $('#app')?.classList.toggle('scrolled', main.scrollTop > 28); }, { passive: true });
  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tracking = true; horiz = null;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    pulling = main.scrollTop <= 0;
  }, { passive: true });
  main.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (horiz === null && Math.abs(dx) + Math.abs(dy) > 12) horiz = Math.abs(dx) > Math.abs(dy) * 1.4;
    if (horiz && (S.view === 'today' || S.view === 'week') && S.settings.animations && e.target.closest('.swipe-area, .strip')) {
      content.style.transition = 'none';
      content.style.transform = `translateX(${dx * 0.35}px)`;
      content.style.opacity = String(1 - Math.min(0.4, Math.abs(dx) / 600));
    } else if (pulling && dy > 0 && !horiz) {
      const p = Math.min(90, dy * 0.5);
      ptr.style.transform = `translateY(${p}px) rotate(${p * 4}deg)`;
      ptr.style.opacity = Math.min(1, p / 60);
    }
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const tch = e.changedTouches[0];
    const dx = tch.clientX - x0;
    const dy = tch.clientY - y0;
    ptr.style.transform = ''; ptr.style.opacity = '';
    content.style.transition = ''; content.style.transform = ''; content.style.opacity = '';
    if (pulling && !horiz && dy * 0.5 > 60) { refresh(); return; }
    if (horiz && Math.abs(dx) > 70 && e.target.closest('.swipe-area, .strip')) {
      if (S.view === 'today') shiftDay(dx < 0 ? 1 : -1);
      else if (S.view === 'week') shiftWeek(dx < 0 ? 1 : -1);
    }
  });
}

// ---------------------------------------------------------------- events
let versionTaps = [];
function versionTap() {
  const now = Date.now();
  versionTaps = versionTaps.filter((x) => now - x < 3000);
  versionTaps.push(now);
  if (versionTaps.length >= 7) { versionTaps = []; openCustomize(); }
}

function setSetting(key, value, { sheet = true } = {}) {
  setS(key, value);
  applyTheme();
  if (key === 'lang') { renderShell(); S.anim = 'fade'; }
  if (S.api) render();
  if (sheet) rerenderSheet();
  if (['notifyMinutes', 'presenceRadius', 'dndBreaks', 'mergeDoubles', 'hideCancelled', 'lang'].includes(key)) scheduleNative();
}

function exportSettings() {
  const json = JSON.stringify(S.settings);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(() => toast(t('Copied to clipboard')), () => uiPrompt(t('Copy this text'), json, { multiline: true }));
  else uiPrompt(t('Copy this text'), json, { multiline: true });
}
async function importSettings() {
  const txt = await uiPrompt(t('Paste your customization text'), '', { multiline: true });
  if (!txt) return;
  try {
    S.settings = { ...S.settings, ...JSON.parse(txt) };
    store.saveSettings(S.settings);
    applyTheme(); render(); rerenderSheet();
    toast(t('Customization applied'));
  } catch { toast(t('That text is not valid'), 'err'); }
}

function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const d = el.dataset;
  switch (d.act) {
    case 'tab': setView(d.view); break;
    case 'nav': closeSheet(true); if (d.view === 'is-room') break; setView(d.view, 'left'); break;
    case 'back': setView(parentOf(S.view), 'right'); break;
    case 'day': setDay(fromUntisDate(Number(d.d))); break;
    case 'goto-day': S.view = 'today'; setDay(fromUntisDate(Number(d.d)), 'fade'); break;
    case 'week-prev': shiftWeek(-1); break;
    case 'week-next': shiftWeek(1); break;
    case 'today': S.anim = 'fade'; S.day = startOfDay(new Date()); S.week = mondayOf(S.day); render(); loadWeek(S.week); break;
    case 'refresh': refresh(); break;
    case 'lesson': openLesson(Number(d.id)); break;
    case 'close-sheet': closeSheet(); break;
    case 'news': openNews(Number(d.i)); break;
    case 'hw-filter': S.hwFilter = d.f; S.anim = 'fade'; render(); break;
    case 'hw-toggle': {
      const h = S.homework.find((x) => String(x.id) === d.id);
      if (h) { const v = !hwDone(h); store.setHomeworkDone(h.id, v); el.closest('.hw').classList.toggle('done', v); setTimeout(render, 450); }
      break;
    }
    case 'del-myexam': store.setMyExams(store.myExams().filter((x) => String(x.id) !== d.id)); render(); break;
    case 'browse': openBrowse(); break;
    case 'browse-kind': openBrowse.setKind(d.k); break;
    case 'pick-element':
      S.element = { id: Number(d.id), type: Number(d.type), label: d.label };
      closeSheet(); S.view = 'week'; S.anim = 'fade'; render(); loadWeek(S.week, { force: true });
      break;
    case 'clear-element': S.element = null; S.anim = 'fade'; render(); loadWeek(S.week); break;
    case 'holidays': openHolidays(); break;
    case 'directions': directions(); break;
    case 'notif-settings': openNotifSettings(); break;
    case 'notif-toggle': notifToggle(d.key); break;
    case 'dnd-toggle': dndToggle(); break;
    case 'dnd-access': native.openDndSettings(); break;
    case 'refresh-all': S.weeks = {}; refresh(); toast(t('Refreshing')); break;
    case 'clear-cache': store.clearCache(); S.weeks = {}; S.homework = null; S.exams = null; S.grades = null; refresh(); toast(t('Offline data cleared')); break;
    case 'logout':
      uiConfirm(t('Sign out of this account?'), { ok: t('Sign out'), danger: true }).then((ok) => { if (!ok) return;
        S.api?.logout(); store.clearAccount(); store.clearCache(); store.setIServ(null); native.schedule([]);
        location.reload();
      });
      break;
    case 'version': versionTap(); break;
    case 'set': setSetting(d.key, d.val); break;
    case 'toggle': setSetting(d.key, !S.settings[d.key]); break;
    case 'subj-reset': {
      const c = { ...S.settings.subjectColors }; delete c[d.k];
      const n = { ...S.settings.subjectNames }; delete n[d.k];
      S.settings.subjectColors = c; setSetting('subjectNames', n);
      break;
    }
    case 'export-settings': exportSettings(); break;
    case 'import-settings': importSettings(); break;
    case 'reset-custom':
      uiConfirm(t('Reset all customization to default?'), { danger: true }).then((ok) => { if (ok) { store.resetCustomization(); S.settings = store.settings(); applyTheme(); render(); rerenderSheet(); } });
      break;
    // grades
    case 'grade-add': openGradeForm(); break;
    case 'g-weight': S.gradeWeight = d.val; $$('.seg[data-key="g-weight"] button').forEach((b) => b.classList.toggle('on', b === el)); break;
    case 'grade-save': saveGrade(); break;
    case 'grade-del': store.setManualGrades(store.manualGrades().filter((g) => g.id !== d.id)); render(); break;
    // attendance
    case 'presence-toggle': togglePresence().then(render); break;
    case 'set-school-loc': setSchoolLocation().then(render); break;
    case 'check-now': checkNow(); break;
    case 'att-month': moveMonth(Number(d.dir)); break;
    case 'att-day': attDay(d.d); break;
    case 'att-set': native.setPresence(d.d, d.st).then(() => { closeSheet(); loadPresence(); }); break;
    // iserv
    case 'iserv-connect': IS.connect(); break;
    case 'iserv-notify': { const v = !S.settings.iservNotify; setS('iservNotify', v); const a = store.iserv(); native.iservBackground({ enabled: v && !!a, host: a?.host, username: a?.username, password: a?.password, chats: true }); rerenderSheet(); render(); break; }
    case 'iserv-open': if (d.url) IS.iservOpenUrl(d.url); else IS.iservOpen(d.path); break;
    case 'iserv-logout': uiConfirm(t('Disconnect IServ?'), { danger: true }).then((ok) => { if (ok) { IS.disconnect(); native.iservBackground({ enabled: false }); } }); break;
    case 'open-room': IS.openRoom(d.id); break;
    case 'chat-attach': IS.openAttachMenu(); break;
    case 'pick': $(`#${d.input}`)?.click(); break;
    case 'voice-start': IS.voiceStart(); break;
    case 'voice-send': IS.voiceStop(true); break;
    case 'voice-cancel': IS.voiceStop(false); break;
    case 'voice-play': IS.playVoice(d.mxc, d.id); break;
    case 'img-view': IS.viewImage(d.mxc); break;
    case 'msg-file': IS.downloadChatFile(d.mxc, d.name); break;
    case 'msg-copy': IS.copyMessage(d.id); break;
    case 'msg-delete': uiConfirm(t('Delete this message for everyone?'), { ok: t('Delete'), danger: true }).then((ok) => { if (ok) IS.deleteMessage(d.id); }); break;
    case 'new-chat': IS.openNewChat(); break;
    case 'start-dm': IS.startDirect(d.id); break;
    case 'file-open': IS.openFile(d.p); break;
    case 'file-menu': IS.fileMenu(d.p); break;
    case 'file-rename': IS.fileRename(d.p); break;
    case 'file-delete': IS.fileDelete(d.p); break;
    case 'file-mkdir': IS.fileMkdir(); break;
    case 'file-upload': $('#file-up')?.click(); break;
    case 'is-task': IS.openTask(d.id); break;
    case 'is-tasks-retry': S.iservTasks = null; IS.retry('tasks'); render(); break;
    case 'hw-add': A.openHomeworkForm(); break;
    case 'hw-add-for': closeSheet(true); A.openHomeworkForm({ subject: d.subj, date: Number(d.date) }); break;
    case 'hw-save': A.saveHomework(); break;
    case 'hw-open': A.openHomework(d.key); break;
    case 'hw-check': { const v = A.toggleHomework(d.key); el.closest('.hw')?.classList.toggle('done', v); setTimeout(render, 450); break; }
    case 'hw-toggle-any': A.toggleHomework(d.key); closeSheet(); render(); break;
    case 'hw-del': A.deleteHomework(d.key); break;
    case 'ai-homework': A.chatForHomework(d.key); break;
    case 'ai-new': A.newChat(); break;
    case 'ai-open': A.openChat(d.id); break;
    case 'ai-starter': A.sendAI(d.text); break;
    case 'ai-prompt': A.sendAI(d.text); break;
    case 'ai-photo': $('#ai-file')?.click(); break;
    case 'ai-unattach': A.unattach(Number(d.i)); break;
    case 'exam-open': { const e = allExams().find((x) => A.examId(x) === d.id); if (e) A.openExam(e); break; }
    case 'ai-exam': { const e = allExams().find((x) => A.examId(x) === d.id); if (e) A.chatForExam(e); break; }
    case 'plan-make': { const e = allExams().find((x) => A.examId(x) === d.id); if (e) A.makePlan(e); break; }
    case 'plan-toggle': A.togglePlanTask(d.k); break;
    case 'tabs-edit': A.openTabEditor(); break;
    case 'tab-add': case 'tab-remove': case 'tab-move': {
      A.editTabs(d.act.slice(4), d.k, Number(d.dir));
      $('nav.tabs').outerHTML = navHtml();
      updateHeader();
      break;
    }
    case 'setup-ai': openAISetup(); break;
    case 'setup-iserv': openIServSetup(); break;
    case 'setup-ai-save': saveAISetup(); break;
    case 'setup-ai-skip': closeSheet(); break;
    case 'setup-iserv-save': saveIServSetup(); break;
    case 'setup-iserv-skip': closeSheet(); break;
    case 'older-msgs': IS.olderMessages(); break;
    case 'is-rooms-retry': IS.retry('rooms'); break;
    case 'is-mail-retry': IS.retry('mail'); break;
    case 'is-files-retry': IS.retry('files'); break;
    case 'is-cal-retry': IS.retry('events'); break;
    case 'mail-folder': IS.setFolder(d.f); break;
    case 'mail-more': IS.loadMail(true); break;
    case 'open-mail': IS.openMail(Number(d.i)); break;
    case 'files-go': IS.loadFiles(d.p); break;
    case 'file-dl': IS.downloadFile(d.p); break;
    case 'is-note': IS.openNote(d.id, d.url); break;
    case 'is-read-all': IS.readAll(); break;
    // recorder
    case 'ai-getkey': openKeyPage(); break;
    case 'ai-load-models': loadAiModels(); break;
    case 'rec-start': recStart(); break;
    case 'rec-stop': recStop(); break;
    case 'open-summary': closeSheet(true); openSummary(d.id); break;
    case 'sum-retry': closeSheet(); processSummary(d.id); break;
    case 'sum-del': uiConfirm(t('Delete this summary?'), { ok: t('Delete'), danger: true }).then((ok) => { if (ok) deleteSummary(d.id); }); break;
    default:
  }
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'browse-q') { openBrowse.setQuery(el.value); return; }
  if (el.id === 'room-q') { IS.filterRooms(el.value); return; }
  if (el.id === 'chat-photo' || el.id === 'chat-camera') { IS.sendFiles(el.files, true); el.value = ''; return; }
  if (el.id === 'chat-file') { IS.sendFiles(el.files, false); el.value = ''; return; }
  if (el.id === 'file-up') { IS.fileUpload(el.files); el.value = ''; return; }
  if (el.id === 'user-q') { IS.openNewChat.search(el.value.trim()); return; }
  if (el.id === 'ai-file') { A.attachFiles(el.files); el.value = ''; return; }
  if (el.id === 'ai-input') { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; return; }
  if (el.id === 'msg-input') { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 140)}px`; return; }
  if (el.dataset.subjName !== undefined) {
    const n = { ...S.settings.subjectNames };
    if (el.value.trim()) n[el.dataset.subjName] = el.value.trim(); else delete n[el.dataset.subjName];
    setSetting('subjectNames', n, { sheet: false });
    return;
  }
  if (el.dataset.subjColor !== undefined) {
    setSetting('subjectColors', { ...S.settings.subjectColors, [el.dataset.subjColor]: el.value }, { sheet: false });
    el.parentElement.style.setProperty('--c', el.value);
    return;
  }
  const key = el.dataset.key;
  if (!key) return;
  if (el.type === 'range') {
    const v = Number(el.value);
    setSetting(key, v, { sheet: false });
    const lab = $(`#v-${key}`);
    if (lab) lab.textContent = key === 'fontScale' ? `${Math.round(v * 100)}%` : `${v}px`;
  } else if (el.type === 'color') {
    setSetting(key, el.value, { sheet: false });
    el.parentElement.style.setProperty('--c', el.value);
  } else setSetting(key, el.value, { sheet: false });
}

// ---------------------------------------------------------------- boot
let timers = [];
export function startApp(api) {
  S.api = api || new Untis(S.account);
  if (!api) Object.assign(S.api, { personType: S.account.personType, personId: S.account.personId, klasseId: S.account.klasseId });
  S.view = isRoot(S.settings.startView) ? S.settings.startView : A.userTabs()[0];
  S.anim = 'fade';
  renderShell();
  render();
  refresh();
  scheduleNative();
  maybeRunSetup();
  const isAcc = store.iserv();
  if (isAcc && S.settings.iservNotify) native.iservBackground({ enabled: true, host: isAcc.host, username: isAcc.username, password: isAcc.password, chats: true });
  timers.forEach(clearInterval);
  timers = [
    setInterval(() => {
      if (document.hidden || document.activeElement?.matches('input, textarea')) return;
      if (S.view === 'today' || S.view === 'week') render();
    }, 30000),
    setInterval(() => {
      const el = $('#rec-time');
      const rec = recState();
      if (el && rec?.startedAt) { const s = Math.floor((Date.now() - rec.startedAt) / 1000); el.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
    }, 1000),
  ];
  window.addEventListener('resize', () => updateHeader());
}

function boot() {
  applyTheme();
  bindRipple();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (['auto', 'system'].includes(S.settings.theme)) applyTheme(); });
  document.addEventListener('click', (e) => { if (S.api) onClick(e); });
  document.addEventListener('input', (e) => { if (S.api) onInput(e); });
  document.addEventListener('change', (e) => { if (S.api && e.target.type === 'color' && sheetState) rerenderSheet(); });
  ddHandlers.pick = (act, key, v) => {
    if (!S.api) return;
    switch (act) {
      case 'set': setSetting(key, v); break;
      case 'g-weight': S.gradeWeight = v; break;
      case 'hw-filter': S.hwFilter = v; S.anim = 'fade'; render(); break;
      case 'mail-folder': IS.setFolder(v); break;
      case 'browse-kind': openBrowse.setKind(v); break;
      case 'ai-provider': setAiProvider(v); break;
      default:
    }
  };
  document.addEventListener('contextmenu', (e) => {
    const m = e.target.closest?.('[data-msg]');
    if (m && S.api) { e.preventDefault(); IS.messageMenu(m.dataset.msg); }
  });
  document.addEventListener('submit', (e) => {
    if (!S.api) return;
    if (e.target.id === 'composer') { e.preventDefault(); IS.sendMessage(); }
    if (e.target.id === 'ai-composer') { e.preventDefault(); A.sendAI(); }
  });
  document.addEventListener('keydown', (e) => {
    if (S.api && e.target.id === 'msg-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); IS.sendMessage(); }
    if (S.api && e.target.id === 'ai-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); A.sendAI(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!S.api || document.hidden) return;
    if (S.settings.autoRefresh && Date.now() - S.lastRefresh > 5 * 60000) {
      if (!sameDay(S.day, new Date()) && S.view === 'today') { S.day = startOfDay(new Date()); S.week = mondayOf(S.day); }
      refresh();
    }
    if (S.view === 'recorder' || S.view === 'attendance') render();
    IS.resumePolling();
  });
  plugin('App')?.addListener('backButton', () => {
    if (!S.api) return;
    if (closeDialog() || closeMenu()) return;
    if (closeSheet()) return;
    if (SUBVIEWS[S.view]) { setView(parentOf(S.view), 'right'); return; }
    if (S.element) { S.element = null; render(); return; }
    if (S.view !== A.userTabs()[0]) { setView(A.userTabs()[0], 'right'); return; }
    safe(plugin('App').exitApp());
  });
  if (S.account) startApp();
  else { bindLogin(); renderLogin(); }
}

boot();
