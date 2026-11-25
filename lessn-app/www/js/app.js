// App shell: navigation, rendering, gestures, events and startup.
import {
  S, t, $, $$, esc, icon, fmt, relDay, weekNumber, sameDay, startOfDay, addDays, mondayOf, toUntisDate, fromUntisDate, pad,
  store, applyTheme, haptic, toast, plugin, safe, closeSheet, sheetState, rerenderSheet, bindLongPress, bindRipple,
} from './core.js';
import { Untis } from './api.js';
import { native } from './native.js';
import {
  refresh, loadWeek, loadHomework, loadExams, scheduleNative, iservClient, loadIServ, weekKey,
} from './data.js';
import { viewToday, viewWeek, viewTasks, viewExams, openLesson, hwDone } from './views.js';
import {
  viewMore, viewGrades, viewAttendance, viewIServ, viewRecorder, openCustomize, openBrowse, openHolidays, openNews,
  openGradeForm, saveGrade, togglePresence, setSchoolLocation, checkNow, attDay, moveMonth, iservConnect, iservOpen,
  recStart, recStop, recState, processSummary, openSummary, deleteSummary, openNotifSettings, notifToggle, dndToggle,
  directions, setS, loadPresence,
} from './features.js';
import { renderLogin, bindLogin } from './login.js';

const TABS = [
  { id: 'today', label: 'Home', icon: 'house' },
  { id: 'week', label: 'Week', icon: 'calendar-range' },
  { id: 'tasks', label: 'Homework', icon: 'list-checks' },
  { id: 'exams', label: 'Exams', icon: 'graduation-cap' },
  { id: 'more', label: 'Menu', icon: 'layout-grid' },
];
const SUBVIEWS = { grades: 'Grades', iserv: 'IServ', attendance: 'Attendance', recorder: 'Lesson recorder' };
const ORDER = ['today', 'week', 'tasks', 'exams', 'more', 'grades', 'iserv', 'attendance', 'recorder'];

// ---------------------------------------------------------------- shell
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
    <nav class="tabs"><span class="tab-ind" id="tab-ind"></span>${TABS.map((x) => `<button data-act="tab" data-view="${x.id}" id="tab-${x.id}">${icon(x.icon)}<span>${esc(t(x.label))}</span></button>`).join('')}</nav>
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
  title.textContent = titles[v] || t(SUBVIEWS[v] || '');
  const now = toUntisDate(new Date());
  const subs = {
    today: fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }),
    week: `${t('Week')} ${weekNumber(S.week)}`,
    tasks: S.homework ? t('{n} open', { n: S.homework.filter((h) => !hwDone(h) && h.due >= now).length }) : '',
    exams: S.exams ? t('{n} upcoming', { n: S.exams.filter((e) => e.date >= now).length }) : '',
    more: S.account?.schoolName || S.account?.school || '',
    grades: t('This school year'), iserv: store.iserv()?.host || '', attendance: t('Your attendance'), recorder: 'Beta',
  };
  const sub = $('#subtitle');
  sub.textContent = S.offline ? t('Offline · showing saved data') : subs[v] || '';
  sub.classList.toggle('off', S.offline);
  $('#btn-refresh').classList.toggle('spin', S.loading > 0);
  $('#btn-back').hidden = !SUBVIEWS[v];
  const offToday = (v === 'today' && !sameDay(S.day, new Date())) || (v === 'week' && !sameDay(S.week, mondayOf(new Date())));
  $('#btn-today').hidden = !offToday;
  const active = SUBVIEWS[v] ? 'more' : v;
  TABS.forEach((x) => $(`#tab-${x.id}`).classList.toggle('on', x.id === active));
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
  const views = { today: viewToday, week: viewWeek, tasks: viewTasks, exams: viewExams, more: viewMore, grades: viewGrades, attendance: viewAttendance, iserv: viewIServ, recorder: viewRecorder };
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
  haptic();
  render();
  if (v === 'tasks' && !S.homework) loadHomework();
  if (v === 'exams' && !S.exams) loadExams();
  if (v === 'week' || v === 'today') loadWeek(S.week);
  if (v === 'iserv' && iservClient()) loadIServ();
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
    if (pulling && !horiz && dy * 0.5 > 60) { haptic(); refresh(); return; }
    if (horiz && Math.abs(dx) > 70 && e.target.closest('.swipe-area, .strip')) {
      haptic();
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
  if (versionTaps.length >= 7) { versionTaps = []; haptic('MEDIUM'); openCustomize(); }
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
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(() => toast(t('Copied to clipboard')), () => prompt(t('Copy this text'), json));
  else prompt(t('Copy this text'), json);
}
function importSettings() {
  const txt = prompt(t('Paste your customization text'));
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
    case 'nav': closeSheet(true); setView(d.view, 'left'); break;
    case 'back': setView('more', 'right'); break;
    case 'day': haptic(); setDay(fromUntisDate(Number(d.d))); break;
    case 'goto-day': S.view = 'today'; setDay(fromUntisDate(Number(d.d)), 'fade'); break;
    case 'week-prev': haptic(); shiftWeek(-1); break;
    case 'week-next': haptic(); shiftWeek(1); break;
    case 'today': haptic(); S.anim = 'fade'; S.day = startOfDay(new Date()); S.week = mondayOf(S.day); render(); loadWeek(S.week); break;
    case 'refresh': haptic(); refresh(); break;
    case 'lesson': openLesson(Number(d.id)); break;
    case 'close-sheet': closeSheet(); break;
    case 'news': openNews(Number(d.i)); break;
    case 'hw-filter': S.hwFilter = d.f; S.anim = 'fade'; render(); break;
    case 'hw-toggle': {
      const h = S.homework.find((x) => String(x.id) === d.id);
      if (h) { const v = !hwDone(h); store.setHomeworkDone(h.id, v); haptic(v ? 'MEDIUM' : 'LIGHT'); el.closest('.hw').classList.toggle('done', v); setTimeout(render, 450); }
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
      if (confirm(t('Sign out of this account?'))) {
        S.api?.logout(); store.clearAccount(); store.clearCache(); store.setIServ(null); native.schedule([]);
        location.reload();
      }
      break;
    case 'version': versionTap(); break;
    case 'set': setSetting(d.key, d.val); haptic(); break;
    case 'toggle': setSetting(d.key, !S.settings[d.key]); haptic(); break;
    case 'subj-reset': {
      const c = { ...S.settings.subjectColors }; delete c[d.k];
      const n = { ...S.settings.subjectNames }; delete n[d.k];
      S.settings.subjectColors = c; setSetting('subjectNames', n);
      break;
    }
    case 'export-settings': exportSettings(); break;
    case 'import-settings': importSettings(); break;
    case 'reset-custom':
      if (confirm(t('Reset all customization to default?'))) { store.resetCustomization(); S.settings = store.settings(); applyTheme(); render(); rerenderSheet(); }
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
    case 'iserv-connect': iservConnect(); break;
    case 'iserv-open': iservOpen(d.path, d.url); break;
    case 'iserv-logout': store.setIServ(null); S.iserv = null; S.iservData = null; store.setCache('iserv', null); render(); break;
    // recorder
    case 'ai-getkey': native.openUrl('https://aistudio.google.com/apikey'); break;
    case 'ai-savekey': {
      const v = $('#ai-key').value.trim();
      if (v) { store.setAiKey(v); toast(t('Key saved')); render(); }
      break;
    }
    case 'ai-clearkey': if (confirm(t('Remove the API key?'))) { store.setAiKey(''); render(); } break;
    case 'rec-start': recStart(); break;
    case 'rec-stop': recStop(); break;
    case 'open-summary': closeSheet(true); openSummary(d.id); break;
    case 'sum-retry': closeSheet(); processSummary(d.id); break;
    case 'sum-del': if (confirm(t('Delete this summary?'))) deleteSummary(d.id); break;
    default:
  }
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'browse-q') { openBrowse.setQuery(el.value); return; }
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
  S.view = S.settings.startView;
  S.anim = 'fade';
  renderShell();
  render();
  refresh();
  scheduleNative();
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
  document.addEventListener('visibilitychange', () => {
    if (!S.api || document.hidden) return;
    if (S.settings.autoRefresh && Date.now() - S.lastRefresh > 5 * 60000) {
      if (!sameDay(S.day, new Date()) && S.view === 'today') { S.day = startOfDay(new Date()); S.week = mondayOf(S.day); }
      refresh();
    }
    if (S.view === 'recorder' || S.view === 'attendance') render();
  });
  plugin('App')?.addListener('backButton', () => {
    if (!S.api) return;
    if (closeSheet()) return;
    if (SUBVIEWS[S.view]) { setView('more', 'right'); return; }
    if (S.element) { S.element = null; render(); return; }
    if (S.view !== S.settings.startView) { setView(S.settings.startView, 'right'); return; }
    safe(plugin('App').exitApp());
  });
  if (S.account) startApp();
  else { bindLogin(); renderLogin(); }
}

boot();
