import { ICONS } from './icons.js';
import { Untis, searchSchools, parseServerInput, toUntisDate, fromUntisDate, pad } from './api.js';
import { store } from './store.js';

const VERSION = '1.0.0';

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

const Cap = window.Capacitor;
const plugin = (name) => Cap?.Plugins?.[name];
const isNative = !!Cap?.isNativePlatform?.();
const safe = (p) => { try { p?.catch?.(() => {}); } catch { /* ignore */ } };

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return startOfDay(x); };
const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
const fmtTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const LOCALE = navigator.language || 'en';
const fmt = (d, o) => d.toLocaleDateString(LOCALE, o);
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
const durText = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
const weekNumber = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
function relDay(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return fmt(d, { weekday: 'long' });
  return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
}
function inDays(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1) return `in ${n} days`;
  if (n === -1) return 'yesterday';
  return `${-n} days ago`;
}

// ---------------------------------------------------------------- state
const S = {
  settings: store.settings(),
  account: store.account(),
  api: null,
  view: 'today',
  day: startOfDay(new Date()),
  week: mondayOf(new Date()),
  element: null, // {id, type, label} when browsing another timetable
  weeks: {},
  timegrid: store.cache('timegrid')?.data || [],
  holidays: store.cache('holidays')?.data || [],
  homework: store.cache('homework')?.data || null,
  exams: store.cache('exams')?.data || null,
  absences: null,
  elements: {},
  hwFilter: 'open',
  loading: 0,
  offline: false,
  lastRefresh: 0,
  index: {},
};

const PALETTE = ['#4f6bff', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#e2a300', '#0090ff', '#7c66dc', '#46a758', '#e54666', '#00a2c7', '#a18072', '#5b5bd6', '#ca5a2d'];
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

const subjKey = (l) => l.subjects[0]?.name || l.activity || l.text || 'Event';
function subjName(l, short = false) {
  const k = subjKey(l);
  const s = S.settings;
  if (s.subjectNames[k]) return s.subjectNames[k];
  const su = l.subjects[0];
  if (!su) return l.text || l.activity || 'Event';
  if (short) return su.name;
  return s.subjectLongNames ? su.long || su.name : su.name;
}
function colorFor(key) {
  const s = S.settings;
  if (s.colorMode === 'accent') return s.accent;
  if (s.colorMode === 'mono') return 'var(--mono)';
  return s.subjectColors[key] || PALETTE[hash(key) % PALETTE.length];
}
const personText = (list) => list.map((t) => (S.settings.teacherLongNames ? t.long : t.name)).filter(Boolean).join(', ');

function haptic(style = 'LIGHT') {
  if (S.settings.haptics) safe(plugin('Haptics')?.impact({ style }));
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const s = S.settings;
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = s.theme === 'system' ? (dark ? 'dark' : 'light') : s.theme;
  root.dataset.theme = theme;
  root.dataset.density = s.density;
  root.dataset.font = s.font;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--r', `${s.radius}px`);
  root.style.fontSize = `${16 * s.fontScale}px`;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  $('meta[name=theme-color]')?.setAttribute('content', bg);
  safe(plugin('SystemBars')?.setStyle({ style: theme === 'light' ? 'LIGHT' : 'DARK' }));
}

function setSetting(key, value, { rerenderSheet = true } = {}) {
  S.settings[key] = value;
  store.saveSettings(S.settings);
  applyTheme();
  if (S.api) render();
  if (rerenderSheet && sheetState?.render) sheetState.rerender();
}

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  if (!t) return;
  t.className = `toast show ${kind}`;
  t.innerHTML = `${icon(kind === 'err' ? 'circle-alert' : 'check')}<span>${esc(msg)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ---------------------------------------------------------------- data
function ownElement() {
  return S.api?.personType ? S.api.ownElement() : S.account?.element || { id: 0, type: 0 };
}
function elKey() { const el = S.element || ownElement(); return `${el.type}-${el.id}`; }
const weekKey = (monday) => `tt:${elKey()}:${toUntisDate(monday)}`;
function weekData(monday) {
  const k = weekKey(monday);
  if (S.weeks[k]) return S.weeks[k];
  const c = store.cache(k);
  if (c) { S.weeks[k] = c.data; return c.data; }
  return null;
}

async function run(fn, { quiet = false } = {}) {
  S.loading++;
  updateHeader();
  try {
    await fn();
    S.offline = false;
    return true;
  } catch (e) {
    console.warn(e);
    if (e.code === 'network') S.offline = true;
    else if (!quiet) toast(e.message || String(e), 'err');
    return false;
  } finally {
    S.loading--;
    render();
  }
}

async function loadWeek(monday, { force = false, quiet = false } = {}) {
  const k = weekKey(monday);
  weekData(monday);
  if (!force && S.weeks[k] && S.weeks[`fresh:${k}`]) return;
  const element = S.element;
  await run(async () => {
    let data;
    try { data = await S.api.timetable(monday, addDays(monday, 6), element); }
    catch (e) { if (e.code === -7004) data = []; else throw e; }
    S.weeks[k] = data;
    S.weeks[`fresh:${k}`] = true;
    if (!element) store.setCache(k, data);
  }, { quiet });
}

async function loadMeta(force = false) {
  const tg = store.cache('timegrid');
  if (!force && tg && Date.now() - tg.t < 864e5 && S.timegrid.length) return;
  await run(async () => {
    const [grid, hol] = await Promise.allSettled([S.api.timegrid(), S.api.holidays()]);
    if (grid.status === 'fulfilled') { S.timegrid = grid.value; store.setCache('timegrid', grid.value); }
    if (hol.status === 'fulfilled') { S.holidays = hol.value; store.setCache('holidays', hol.value); }
  }, { quiet: true });
}

async function loadHomework() {
  const t = startOfDay(new Date());
  await run(async () => {
    S.homework = await S.api.homework(addDays(t, -21), addDays(t, 90));
    store.setCache('homework', S.homework);
  });
}

async function loadExams() {
  const t = startOfDay(new Date());
  await run(async () => {
    S.exams = await S.api.exams(addDays(t, -60), addDays(t, 240));
    store.setCache('exams', S.exams);
  });
}

async function loadAbsences() {
  const t = startOfDay(new Date());
  return run(async () => { S.absences = await S.api.absences(addDays(t, -365), t); });
}

async function refresh(force = true) {
  S.lastRefresh = Date.now();
  const ok = await run(async () => {
    await S.api.login();
    const acc = { ...S.account, element: S.api.ownElement(), personType: S.api.personType, personId: S.api.personId, klasseId: S.api.klasseId };
    S.account = acc;
    store.setAccount(acc);
  });
  if (!ok) return;
  const jobs = [loadWeek(S.week, { force }), loadMeta(force)];
  if (S.view === 'tasks' || S.homework) jobs.push(loadHomework());
  if (S.view === 'exams' || S.exams) jobs.push(loadExams());
  await Promise.all(jobs);
  loadWeek(addDays(S.week, 7), { quiet: true });
}

// ---------------------------------------------------------------- lesson logic
function timegridFor(date) {
  return (S.timegrid.find((d) => d.day === date.getDay() + 1) || S.timegrid[0])?.units || [];
}
function periodLabel(l) {
  if (!S.settings.showPeriodNumbers) return '';
  const units = timegridFor(fromUntisDate(l.date));
  const a = units.findIndex((u) => u.start === l.start);
  const b = units.findIndex((u) => u.end === l.end);
  if (a < 0) return '';
  const na = units[a].name || a + 1;
  return b > a ? `${na}–${units[b].name || b + 1}` : String(na);
}
const holidayFor = (date) => { const u = toUntisDate(date); return S.holidays.find((h) => h.start <= u && u <= h.end); };

const sig = (l) => [subjKey(l), l.teachers.map((t) => `${t.id}:${t.orig}`).join(), l.rooms.map((r) => `${r.id}:${r.orig}`).join(),
  l.classes.map((c) => c.id).join(), l.code, l.type, l.info, l.subst, l.text, l.group].join('|');

function prepareDay(lessons, date) {
  const u = toUntisDate(date);
  let list = (lessons || []).filter((l) => l.date === u).map((l) => ({ ...l, ids: [l.id] }));
  list.sort((a, b) => a.start - b.start || subjKey(a).localeCompare(subjKey(b)));
  if (S.settings.hideCancelled) list = list.filter((l) => l.code !== 'cancelled');
  if (S.settings.mergeDoubles) {
    const out = [];
    for (const l of list) {
      const prev = out.find((p) => p.end <= l.start && l.start - p.end <= 5 && sig(p) === sig(l));
      if (prev) { prev.end = l.end; prev.ids.push(l.id); } else out.push(l);
    }
    list = out;
  }
  // Prefer a regular lesson over a cancelled one in the same slot so substitutions show first
  list.sort((a, b) => a.start - b.start || (a.code === 'cancelled') - (b.code === 'cancelled'));
  list.forEach((l) => { S.index[l.id] = l; });
  return list;
}

function changes(l) {
  const out = [];
  if (l.code === 'cancelled') out.push({ cls: 'bad', icon: 'ban', text: 'Cancelled' });
  if (l.type === 'ex') out.push({ cls: 'exam', icon: 'graduation-cap', text: 'Exam' });
  if (l.teachers.some((t) => t.orig)) out.push({ cls: 'warn', icon: 'arrow-left-right', text: 'Substitute' });
  if (l.rooms.some((r) => r.orig)) out.push({ cls: 'warn', icon: 'door-open', text: 'Room change' });
  if (l.code === 'irregular' && out.length === 0) out.push({ cls: 'warn', icon: 'triangle-alert', text: 'Changed' });
  return out;
}
const isChanged = (l) => l.code === 'cancelled' || l.code === 'irregular' || l.teachers.some((t) => t.orig) || l.rooms.some((r) => r.orig);

function placeText(list, cls = '') {
  return list.map((r) => (r.orig ? `<s>${esc(S.settings.teacherLongNames && r.origLong ? r.origLong : r.orig)}</s> <b class="${cls}">${esc(S.settings.teacherLongNames ? r.long : r.name)}</b>` : esc(S.settings.teacherLongNames ? r.long : r.name))).join(', ');
}
const roomText = (l) => l.rooms.map((r) => (r.orig ? `<s>${esc(r.orig)}</s> <b>${esc(r.name)}</b>` : esc(r.name))).join(', ');

function visibleDays(monday) {
  const wd = S.settings.weekDays;
  let n = 5;
  if (wd === 'auto') {
    const data = weekData(monday) || [];
    const sat = toUntisDate(addDays(monday, 5));
    const sun = toUntisDate(addDays(monday, 6));
    if (data.some((l) => l.date === sun)) n = 7; else if (data.some((l) => l.date === sat)) n = 6;
  } else n = Number(wd);
  return Array.from({ length: n }, (_, i) => addDays(monday, i));
}

// ---------------------------------------------------------------- views
const TABS = [
  { id: 'today', label: 'Today', icon: 'house' },
  { id: 'week', label: 'Week', icon: 'calendar-range' },
  { id: 'tasks', label: 'Homework', icon: 'list-checks' },
  { id: 'exams', label: 'Exams', icon: 'graduation-cap' },
  { id: 'more', label: 'More', icon: 'menu' },
];

function emptyState(ic, title, text = '') {
  return `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
}
const skeleton = (n = 5) => `<div class="skel-list">${'<div class="skel"></div>'.repeat(n)}</div>`;

function lessonRow(l) {
  const s = S.settings;
  const color = colorFor(subjKey(l));
  const p = periodLabel(l);
  const ch = changes(l);
  const meta = [];
  if (s.showRoom && l.rooms.length) meta.push(`<span>${icon('map-pin')}${roomText(l)}</span>`);
  if (s.showTeacher && l.teachers.length) meta.push(`<span>${icon('user')}${placeText(l.teachers)}</span>`);
  if (l.group && !l.subjects.length) meta.push(`<span>${icon('users')}${esc(l.group)}</span>`);
  const note = store.notes()[noteKey(l)];
  const info = [l.subst, l.info].filter(Boolean).join(' · ');
  return `<button class="lesson ${l.code === 'cancelled' ? 'cancelled' : ''} ${isChanged(l) ? 'changed' : ''}" data-act="lesson" data-id="${l.id}" style="--c:${color}">
    <div class="l-time"><b>${fmtTime(l.start)}</b><span>${fmtTime(l.end)}</span>${p ? `<em>${esc(p)}</em>` : ''}</div>
    <div class="l-bar"></div>
    <div class="l-body">
      <div class="l-title">${esc(subjName(l))}${note ? icon('sticky-note', 'note-ic') : ''}</div>
      ${meta.length ? `<div class="l-meta">${meta.join('')}</div>` : ''}
      ${ch.length ? `<div class="badges">${ch.map((b) => `<span class="badge ${b.cls}">${icon(b.icon)}${b.text}</span>`).join('')}</div>` : ''}
      ${info ? `<div class="l-info">${icon('info')}<span>${esc(info)}</span></div>` : ''}
    </div>
  </button>`;
}

function gapRow(from, to) {
  const m = to - from;
  if (m < 5 || !S.settings.showBreaks) return '';
  const free = m >= 40;
  return `<div class="gap ${free ? 'free' : ''}">${icon(free ? 'sunrise' : 'coffee')}<span>${free ? 'Free period' : 'Break'} · ${durText(m)}</span></div>`;
}

function nowCard(lessons) {
  const s = S.settings;
  const n = nowMin();
  const active = lessons.filter((l) => l.code !== 'cancelled');
  if (!active.length) return '';
  const cur = active.find((l) => l.start <= n && n < l.end);
  const next = active.find((l) => l.start > n);
  const where = (l) => [s.showRoom && l.rooms.length ? `${icon('map-pin')}${roomText(l)}` : '', s.showTeacher && l.teachers.length ? `${icon('user')}${placeText(l.teachers)}` : ''].filter(Boolean).map((x) => `<span>${x}</span>`).join('');
  if (cur) {
    const pct = Math.min(100, Math.max(0, ((n - cur.start) / (cur.end - cur.start)) * 100));
    return `<div class="now-card" style="--c:${colorFor(subjKey(cur))}" data-act="lesson" data-id="${cur.id}">
      <div class="now-top"><span class="live"></span>Now${periodLabel(cur) ? ` · Period ${esc(periodLabel(cur))}` : ''}</div>
      <div class="now-title">${esc(subjName(cur))}</div>
      <div class="now-meta">${where(cur)}</div>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="now-foot"><span>${fmtTime(cur.start)} – ${fmtTime(cur.end)}</span>${s.showCountdown ? `<b>${durText(cur.end - n)} left</b>` : ''}</div>
      ${next ? `<div class="now-next">${icon('chevron-right')}<span>Next <b>${esc(subjName(next))}</b> at ${fmtTime(next.start)}${next.rooms.length && s.showRoom ? ` · ${roomText(next)}` : ''}</span></div>` : '<div class="now-next">' + icon('sparkles') + '<span>Last lesson today</span></div>'}
    </div>`;
  }
  if (next) {
    const first = next === active[0];
    const prevEnd = Math.max(0, ...active.filter((l) => l.end <= n).map((l) => l.end));
    const free = !first && n - prevEnd >= 40;
    return `<div class="now-card soft" style="--c:${colorFor(subjKey(next))}" data-act="lesson" data-id="${next.id}">
      <div class="now-top">${icon(first || free ? 'sunrise' : 'coffee')}${first ? 'School starts' : free ? 'Free period' : 'Break'}${s.showCountdown ? ` · in ${durText(next.start - n)}` : ''}</div>
      <div class="now-title">${esc(subjName(next))}</div>
      <div class="now-meta"><span>${icon('clock')}${fmtTime(next.start)} – ${fmtTime(next.end)}</span>${where(next)}</div>
    </div>`;
  }
  const last = active[active.length - 1];
  return `<div class="now-card done"><div class="now-top">${icon('sparkles')}Done for today</div>
    <div class="now-title">School ended at ${fmtTime(last.end)}</div>${tomorrowHint()}</div>`;
}

function tomorrowHint() {
  let d = addDays(S.day, 1);
  for (let i = 0; i < 7; i++, d = addDays(d, 1)) {
    const data = weekData(mondayOf(d));
    if (!data) return '';
    const list = prepareDay(data, d).filter((l) => l.code !== 'cancelled');
    if (list.length) return `<div class="now-meta"><span>${icon('calendar')}${esc(relDay(d))} starts at ${fmtTime(list[0].start)} with ${esc(subjName(list[0]))}</span></div>`;
  }
  return '';
}

function dayStrip() {
  const today = new Date();
  const data = weekData(S.week) || [];
  return `<div class="strip">${visibleDays(S.week).map((d) => {
    const u = toUntisDate(d);
    const ch = data.some((l) => l.date === u && isChanged(l));
    return `<button class="dpill ${sameDay(d, S.day) ? 'sel' : ''} ${sameDay(d, today) ? 'today' : ''}" data-act="day" data-d="${u}">
      <span>${esc(fmt(d, { weekday: 'short' }))}</span><b>${d.getDate()}</b><i class="${ch ? 'on' : ''}"></i></button>`;
  }).join('')}</div>`;
}

function viewToday() {
  const data = weekData(S.week);
  const isToday = sameDay(S.day, new Date());
  let body;
  const hol = holidayFor(S.day);
  if (!data) body = skeleton(5);
  else {
    const list = prepareDay(data, S.day);
    if (!list.length) {
      body = hol ? emptyState('sun', hol.name, 'Enjoy the holidays.') : emptyState('coffee', 'No lessons', 'Nothing scheduled for this day.');
    } else {
      const rows = [];
      list.forEach((l, i) => {
        if (i > 0) {
          const prevEnd = Math.max(...list.slice(0, i).filter((x) => x.code !== 'cancelled').map((x) => x.end), 0);
          if (prevEnd && l.code !== 'cancelled' && l.start > prevEnd) rows.push(gapRow(prevEnd, l.start));
        }
        rows.push(lessonRow(l));
      });
      const real = list.filter((l) => l.code !== 'cancelled');
      const cancelled = list.length - real.length;
      const summary = real.length
        ? `${real.length} ${real.length === 1 ? 'lesson' : 'lessons'} · ${fmtTime(real[0].start)} – ${fmtTime(Math.max(...real.map((l) => l.end)))}${cancelled ? ` · ${cancelled} cancelled` : ''}`
        : 'All lessons cancelled';
      body = `${isToday ? nowCard(list) : ''}
        ${hol ? `<div class="banner-inline">${icon('sun')}${esc(hol.name)}</div>` : ''}
        <div class="day-head"><h2>${esc(fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2><span>${esc(summary)}</span></div>
        <div class="lessons">${rows.join('')}</div>`;
    }
  }
  return `${dayStrip()}<div class="pad swipe-area">${body}</div>`;
}

function layoutCols(list) {
  const clusters = [];
  let cur = [];
  let end = -1;
  for (const l of list) {
    if (cur.length && l.start >= end) { clusters.push(cur); cur = []; end = -1; }
    cur.push(l);
    end = Math.max(end, l.end);
  }
  if (cur.length) clusters.push(cur);
  for (const c of clusters) {
    const ends = [];
    for (const l of c) {
      let i = ends.findIndex((e) => e <= l.start);
      if (i < 0) { i = ends.length; ends.push(0); }
      ends[i] = l.end;
      l._col = i;
    }
    c.forEach((l) => { l._n = ends.length; });
  }
}

function weekRel() {
  const n = Math.round(daysBetween(mondayOf(new Date()), S.week) / 7);
  if (n === 0) return 'This week';
  if (n === 1) return 'Next week';
  if (n === -1) return 'Last week';
  return n > 0 ? `In ${n} weeks` : `${-n} weeks ago`;
}

function viewWeek() {
  const s = S.settings;
  const data = weekData(S.week);
  const days = visibleDays(S.week);
  const end = days[days.length - 1];
  const nav = `<div class="week-nav">
    <button class="icon-btn" data-act="week-prev" aria-label="Previous week">${icon('chevron-left')}</button>
    <div class="week-label"><b>${esc(fmt(S.week, { day: 'numeric', month: 'short' }))} – ${esc(fmt(end, { day: 'numeric', month: 'short' }))}</b><span>${esc(weekRel())}</span></div>
    <button class="icon-btn" data-act="week-next" aria-label="Next week">${icon('chevron-right')}</button></div>`;
  if (!data) return nav + `<div class="pad">${skeleton(6)}</div>`;

  const units = timegridFor(S.week);
  const perDay = days.map((d) => prepareDay(data, d));
  const all = perDay.flat();
  let min = units.length ? units[0].start : 8 * 60;
  let max = units.length ? units[units.length - 1].end : 16 * 60;
  if (all.length) { min = Math.min(min, ...all.map((l) => l.start)); max = Math.max(max, ...all.map((l) => l.end)); }
  if (!units.length && all.length) { min = Math.min(...all.map((l) => l.start)); max = Math.max(...all.map((l) => l.end)); }
  const ppm = s.density === 'compact' ? 0.95 : 1.25;
  const H = Math.ceil((max - min) * ppm);
  const today = new Date();

  const head = days.map((d) => `<div class="wk-day ${sameDay(d, today) ? 'today' : ''}" data-act="goto-day" data-d="${toUntisDate(d)}"><span>${esc(fmt(d, { weekday: 'short' }))}</span><b>${d.getDate()}</b></div>`).join('');
  const bands = units.map((u, i) => `<div class="wk-band ${i % 2 ? 'alt' : ''}" style="top:${(u.start - min) * ppm}px;height:${(u.end - u.start) * ppm}px"></div>`).join('');
  const axis = units.map((u) => `<div class="wk-tick" style="top:${(u.start - min) * ppm}px"><b>${esc(u.name)}</b><span>${fmtTime(u.start)}</span></div>`).join('')
    || Array.from({ length: Math.ceil((max - min) / 60) }, (_, i) => `<div class="wk-tick" style="top:${i * 60 * ppm}px"><span>${fmtTime(min + i * 60)}</span></div>`).join('');

  const cols = days.map((d, di) => {
    const list = perDay[di];
    const hol = holidayFor(d);
    layoutCols(list);
    const blocks = list.map((l) => {
      const top = (l.start - min) * ppm;
      const h = Math.max(18, (l.end - l.start) * ppm - 3);
      const color = colorFor(subjKey(l));
      const name = s.subjectShortInGrid ? subjName(l, true) : subjName(l);
      const lines = [];
      if (s.showRoom && l.rooms.length && h > 34) lines.push(`<span>${roomText(l)}</span>`);
      if (s.showTeacher && l.teachers.length && h > 52) lines.push(`<span>${placeText(l.teachers)}</span>`);
      return `<button class="blk ${l.code === 'cancelled' ? 'cancelled' : ''} ${isChanged(l) ? 'changed' : ''} ${l.type === 'ex' ? 'is-exam' : ''}" data-act="lesson" data-id="${l.id}"
        style="--c:${color};top:${top}px;height:${h}px;left:calc(${(l._col / l._n) * 100}% + 2px);width:calc(${100 / l._n}% - 4px)">
        <b>${esc(name)}</b>${lines.join('')}</button>`;
    }).join('');
    const nowLine = s.showNowLine && sameDay(d, today) && nowMin() >= min && nowMin() <= max ? `<div class="now-line" style="top:${(nowMin() - min) * ppm}px"></div>` : '';
    const holTag = hol && !list.length ? `<div class="wk-hol"><span>${esc(hol.name)}</span></div>` : '';
    return `<div class="wk-col">${holTag}${blocks}${nowLine}</div>`;
  }).join('');

  return `${nav}<div class="wk swipe-area" style="--n:${days.length}">
    <div class="wk-head"><div class="wk-corner">${esc(String(weekNumber(S.week)))}</div>${head}</div>
    <div class="wk-body" style="height:${H + 8}px"><div class="wk-axis">${axis}</div><div class="wk-grid">${bands}${cols}</div></div>
  </div>
  ${all.length ? '' : `<div class="pad">${emptyState('calendar', 'No lessons this week')}</div>`}`;
}

function subjLabel(k) {
  if (!k) return '';
  if (S.settings.subjectNames[k]) return S.settings.subjectNames[k];
  if (!S.settings.subjectLongNames) return k;
  for (const list of Object.values(S.weeks)) {
    if (!Array.isArray(list)) continue;
    const l = list.find((x) => x.subjects[0]?.name === k);
    if (l) return l.subjects[0].long || k;
  }
  return k;
}

function hwDone(h) { const m = store.doneHomework(); return h.id in m ? m[h.id] : h.completed; }

function viewTasks() {
  const chips = ['open', 'done', 'all'].map((f) => `<button class="chip ${S.hwFilter === f ? 'on' : ''}" data-act="hw-filter" data-f="${f}">${{ open: 'To do', done: 'Done', all: 'All' }[f]}</button>`).join('');
  if (!S.homework) return `<div class="chips">${chips}</div><div class="pad">${skeleton(4)}</div>`;
  const t = toUntisDate(new Date());
  let list = S.homework.slice().sort((a, b) => a.due - b.due);
  if (S.hwFilter === 'open') list = list.filter((h) => !hwDone(h));
  else if (S.hwFilter === 'done') list = list.filter(hwDone).reverse();
  const open = S.homework.filter((h) => !hwDone(h) && h.due >= t).length;
  if (!list.length) {
    return `<div class="chips">${chips}</div><div class="pad">${S.hwFilter === 'open' ? emptyState('circle-check', 'All caught up', 'No open homework.') : emptyState('clipboard-list', 'Nothing here')}</div>`;
  }
  const groups = {};
  list.forEach((h) => { (groups[h.due] ||= []).push(h); });
  const html = Object.entries(groups).map(([due, items]) => {
    const d = fromUntisDate(Number(due));
    const overdue = Number(due) < t;
    return `<div class="group"><div class="group-head ${overdue ? 'bad' : ''}"><b>${esc(relDay(d))}</b><span>${esc(fmt(d, { day: 'numeric', month: 'short' }))}</span></div>
      ${items.map((h) => {
        const done = hwDone(h);
        return `<div class="hw ${done ? 'done' : ''} ${overdue && !done ? 'overdue' : ''}" style="--c:${colorFor(h.subject)}">
          <button class="check" data-act="hw-toggle" data-id="${h.id}" aria-label="Mark as done">${icon('check')}</button>
          <div class="hw-body"><div class="hw-subj">${esc(subjLabel(h.subject) || 'Homework')}</div>
            <div class="hw-text">${esc(h.text)}</div>
            ${h.remark ? `<div class="hw-remark">${esc(h.remark)}</div>` : ''}
            <div class="hw-meta">Given ${esc(fmt(fromUntisDate(h.date), { day: 'numeric', month: 'short' }))}${h.teacher ? ` · ${esc(h.teacher)}` : ''}${h.attachments.length ? ` · ${h.attachments.length} attachment${h.attachments.length > 1 ? 's' : ''}` : ''}</div>
          </div></div>`;
      }).join('')}</div>`;
  }).join('');
  return `<div class="chips">${chips}<span class="chip-note">${open} open</span></div><div class="pad">${html}</div>`;
}

function examCard(e, past) {
  const d = fromUntisDate(e.date);
  const n = daysBetween(new Date(), d);
  const urgent = !past && n <= 3;
  const rooms = e.rooms.map((r) => (typeof r === 'string' ? r : r.name)).join(', ');
  const teachers = e.teachers.map((r) => (typeof r === 'string' ? r : r.name)).join(', ');
  return `<div class="exam ${past ? 'past' : ''}" style="--c:${colorFor(e.subject)}">
    <div class="exam-date"><b>${d.getDate()}</b><span>${esc(fmt(d, { month: 'short' }))}</span></div>
    <div class="exam-body">
      <div class="exam-top"><span class="exam-subj">${esc(subjLabel(e.subject) || 'Exam')}</span>${past ? (e.grade ? `<span class="badge ok">${icon('star')}${esc(e.grade)}</span>` : '') : `<span class="badge ${urgent ? 'bad' : 'soft'}">${icon('timer')}${esc(inDays(d))}</span>`}</div>
      <div class="exam-name">${esc(e.name || e.type || 'Exam')}</div>
      <div class="l-meta"><span>${icon('clock')}${fmtTime(e.start)} – ${fmtTime(e.end)}</span>${rooms ? `<span>${icon('map-pin')}${esc(rooms)}</span>` : ''}${teachers ? `<span>${icon('user')}${esc(teachers)}</span>` : ''}</div>
      ${e.text ? `<div class="l-info">${icon('info')}<span>${esc(e.text)}</span></div>` : ''}
    </div></div>`;
}

function viewExams() {
  if (!S.exams) return `<div class="pad">${skeleton(4)}</div>`;
  const t = toUntisDate(new Date());
  const up = S.exams.filter((e) => e.date >= t).sort((a, b) => a.date - b.date || a.start - b.start);
  const past = S.exams.filter((e) => e.date < t).sort((a, b) => b.date - a.date);
  if (!S.exams.length) return `<div class="pad">${emptyState('graduation-cap', 'No exams', 'Nothing announced yet.')}</div>`;
  return `<div class="pad">
    ${up.length ? `<div class="section-title">Upcoming · ${up.length}</div>${up.map((e) => examCard(e, false)).join('')}` : emptyState('shield-check', 'No upcoming exams')}
    ${past.length ? `<details class="past"><summary>${icon('chevron-down')}Past exams · ${past.length}</summary>${past.map((e) => examCard(e, true)).join('')}</details>` : ''}
  </div>`;
}

function row(act, ic, title, sub = '', extra = '') {
  return `<button class="row" data-act="${act}" ${extra}><span class="row-ic">${icon(ic)}</span><span class="row-text"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${icon('chevron-right', 'row-chev')}</button>`;
}
function seg(key, options, value) {
  return `<div class="seg" data-key="${key}">${options.map(([v, label]) => `<button class="${String(value) === String(v) ? 'on' : ''}" data-act="set" data-key="${key}" data-val="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}
function toggle(key, label, sub = '') {
  const on = !!S.settings[key];
  return `<button class="row toggle-row" data-act="toggle" data-key="${key}"><span class="row-text"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="switch ${on ? 'on' : ''}"><i></i></span></button>`;
}

function viewMore() {
  const a = S.account;
  const s = S.settings;
  return `<div class="pad">
    <div class="account"><div class="avatar">${icon('user')}</div><div><b>${esc(a.username)}</b><small>${esc(a.schoolName || a.school)}</small></div></div>
    <div class="section-title">Timetables</div>
    <div class="card">${row('browse', 'users', 'Other timetables', 'Classes, teachers and rooms')}${row('absences', 'user-x', 'Absences', 'Your absence record')}${row('holidays', 'sun', 'Holidays', 'School breaks this year')}</div>
    <div class="section-title">Settings</div>
    <div class="card">
      <div class="row static"><span class="row-text"><b>Start screen</b></span></div>
      <div class="row-pad">${seg('startView', [['today', 'Today'], ['week', 'Week'], ['tasks', 'Homework']], s.startView)}</div>
      <div class="row static"><span class="row-text"><b>Days per week</b></span></div>
      <div class="row-pad">${seg('weekDays', [['auto', 'Auto'], ['5', '5'], ['6', '6'], ['7', '7']], s.weekDays)}</div>
      ${toggle('autoRefresh', 'Refresh on open', 'Update when you return to the app')}
    </div>
    <div class="section-title">Data</div>
    <div class="card">${row('refresh-all', 'refresh-cw', 'Refresh everything')}${row('clear-cache', 'trash-2', 'Clear offline data')}</div>
    <div class="card"><button class="row danger" data-act="logout"><span class="row-ic">${icon('log-out')}</span><span class="row-text"><b>Sign out</b></span></button></div>
    <button class="version" data-act="version">Lessn ${VERSION}</button>
  </div>`;
}

// ---------------------------------------------------------------- shell & render
function renderShell() {
  document.body.innerHTML = `
  <div id="app">
    <header class="top">
      <div class="title-wrap" id="title-wrap"><h1 id="title"></h1><div id="subtitle"></div></div>
      <div class="top-actions">
        <button class="icon-btn" id="btn-today" data-act="today" aria-label="Jump to today" hidden>${icon('calendar')}</button>
        <button class="icon-btn" id="btn-refresh" data-act="refresh" aria-label="Refresh">${icon('refresh-cw')}</button>
      </div>
    </header>
    <div id="banner"></div>
    <main id="main"><div id="ptr">${icon('refresh-cw')}</div><div id="content"></div></main>
    <nav class="tabs">${TABS.map((t) => `<button data-act="tab" data-view="${t.id}" id="tab-${t.id}">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}</nav>
  </div>
  <div id="sheet-root"></div>
  <div id="toast" class="toast"></div>`;
  bindLongPress($('#title-wrap'), openCustomize);
  bindGestures($('#main'));
}

function updateHeader() {
  const t = $('#title');
  if (!t) return;
  const titles = { today: S.settings.appTitle || relDay(S.day), week: S.element ? S.element.label : 'Timetable', tasks: 'Homework', exams: 'Exams', more: 'More' };
  t.textContent = titles[S.view];
  const subs = {
    today: fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }),
    week: `Week ${weekNumber(S.week)}`,
    tasks: S.homework ? `${S.homework.filter((h) => !hwDone(h) && h.due >= toUntisDate(new Date())).length} open` : '',
    exams: S.exams ? `${S.exams.filter((e) => e.date >= toUntisDate(new Date())).length} upcoming` : '',
    more: S.account?.schoolName || S.account?.school || '',
  };
  $('#subtitle').textContent = S.offline ? 'Offline · showing saved data' : subs[S.view];
  $('#subtitle').classList.toggle('off', S.offline);
  $('#btn-refresh').classList.toggle('spin', S.loading > 0);
  const offToday = (S.view === 'today' && !sameDay(S.day, new Date())) || (S.view === 'week' && !sameDay(S.week, mondayOf(new Date())));
  $('#btn-today').hidden = !offToday;
  TABS.forEach((x) => $(`#tab-${x.id}`).classList.toggle('on', x.id === S.view));
  $('#banner').innerHTML = S.element && (S.view === 'week' || S.view === 'today')
    ? `<div class="viewing">${icon('eye')}<span>Viewing <b>${esc(S.element.label)}</b></span><button data-act="clear-element">${icon('x')}Back to mine</button></div>` : '';
}

let lastView = null;
function render() {
  if (!S.api || !$('#content')) return;
  S.index = {};
  const main = $('#main');
  const keep = lastView === S.view ? main.scrollTop : 0;
  const views = { today: viewToday, week: viewWeek, tasks: viewTasks, exams: viewExams, more: viewMore };
  $('#content').innerHTML = views[S.view]();
  main.scrollTop = keep;
  lastView = S.view;
  updateHeader();
}

function setView(v) {
  if (v === S.view) { $('#main').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  S.view = v;
  haptic();
  render();
  if (v === 'tasks' && !S.homework) loadHomework();
  if (v === 'exams' && !S.exams) loadExams();
  if (v === 'week' || v === 'today') loadWeek(S.week);
}

function setDay(d) {
  S.day = startOfDay(d);
  const m = mondayOf(S.day);
  if (!sameDay(m, S.week)) { S.week = m; loadWeek(m); }
  render();
}
function shiftDay(dir) {
  let d = addDays(S.day, dir);
  for (let i = 0; i < 7; i++) {
    const n = visibleDays(mondayOf(d)).length;
    if ((d.getDay() + 6) % 7 < n) break;
    d = addDays(d, dir);
  }
  setDay(d);
}
function shiftWeek(dir) {
  S.week = addDays(S.week, 7 * dir);
  S.day = sameDay(S.week, mondayOf(new Date())) ? startOfDay(new Date()) : S.week;
  render();
  loadWeek(S.week).then(() => loadWeek(addDays(S.week, 7 * dir), { quiet: true }));
}

// ---------------------------------------------------------------- gestures
function bindLongPress(el, fn) {
  let timer;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', () => { timer = setTimeout(() => { haptic('MEDIUM'); fn(); }, 700); });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) => el.addEventListener(ev, ev === 'pointermove' ? (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancel(); } : cancel));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function bindGestures(main) {
  let x0 = 0; let y0 = 0; let pulling = false; let dy = 0; let tracking = false;
  const ptr = $('#ptr');
  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tracking = true;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dy = 0;
    pulling = main.scrollTop <= 0;
  }, { passive: true });
  main.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - x0;
    dy = e.touches[0].clientY - y0;
    if (pulling && dy > 0 && Math.abs(dy) > Math.abs(dx)) {
      const p = Math.min(90, dy * 0.5);
      ptr.style.transform = `translateY(${p}px) rotate(${p * 4}deg)`;
      ptr.style.opacity = Math.min(1, p / 60);
    }
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const ddy = t.clientY - y0;
    ptr.style.transform = ''; ptr.style.opacity = '';
    if (pulling && ddy * 0.5 > 60 && Math.abs(ddy) > Math.abs(dx)) { haptic(); refresh(); return; }
    const inGrid = e.target.closest('.wk') && e.target.closest('.wk').scrollWidth > e.target.closest('.wk').clientWidth;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(ddy) * 1.6 && !inGrid && e.target.closest('.swipe-area, .strip')) {
      haptic();
      if (S.view === 'today') shiftDay(dx < 0 ? 1 : -1);
      else if (S.view === 'week') shiftWeek(dx < 0 ? 1 : -1);
    }
  });
}

// ---------------------------------------------------------------- sheets
let sheetState = null;
function openSheet(build, { full = false, onClose } = {}) {
  closeSheet(true);
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="sheet ${full ? 'full' : ''}"><div class="grab"></div><div class="sheet-body"></div></div>`;
  sheetState = {
    render: build, onClose,
    rerender() {
      const body = $('.sheet-body', root);
      if (!body) return;
      const st = body.scrollTop;
      body.innerHTML = build();
      body.scrollTop = st;
    },
  };
  sheetState.rerender();
  requestAnimationFrame(() => root.classList.add('open'));
  history.pushState({ sheet: true }, '');
  bindSheetDrag($('.sheet', root));
}
function closeSheet(silent = false) {
  if (!sheetState) return false;
  const root = $('#sheet-root');
  const st = sheetState;
  sheetState = null;
  root.classList.remove('open');
  setTimeout(() => { if (!sheetState) root.innerHTML = ''; }, 260);
  st.onClose?.();
  if (!silent && history.state?.sheet) history.back();
  return true;
}
function bindSheetDrag(sheet) {
  const grab = $('.grab', sheet);
  let y0 = null;
  grab.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
  grab.addEventListener('touchmove', (e) => { if (y0 == null) return; const d = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${d}px)`; }, { passive: true });
  grab.addEventListener('touchend', (e) => {
    const d = e.changedTouches[0].clientY - (y0 ?? 0);
    y0 = null; sheet.style.transition = ''; sheet.style.transform = '';
    if (d > 90) closeSheet();
  });
}
window.addEventListener('popstate', () => { if (sheetState) closeSheet(true); });

const noteKey = (l) => `${subjKey(l)}|${l.date}|${l.start}`;

function openLesson(id) {
  const l = S.index[id];
  if (!l) return;
  haptic();
  const color = colorFor(subjKey(l));
  const d = fromUntisDate(l.date);
  const ch = changes(l);
  const hw = (S.homework || []).filter((h) => h.due === l.date && h.subject === subjKey(l));
  const detail = (ic, label, value) => (value ? `<div class="d-row">${icon(ic)}<div><small>${label}</small><span>${value}</span></div></div>` : '');
  openSheet(() => `
    <div class="d-head" style="--c:${color}">
      <div class="d-chip">${esc(l.subjects[0]?.name || l.activity || 'Event')}</div>
      <h2>${esc(subjName(l))}</h2>
      <p>${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${fmtTime(l.start)} – ${fmtTime(l.end)}${periodLabel(l) ? ` · Period ${esc(periodLabel(l))}` : ''}</p>
      ${ch.length ? `<div class="badges">${ch.map((b) => `<span class="badge ${b.cls}">${icon(b.icon)}${b.text}</span>`).join('')}</div>` : ''}
    </div>
    <div class="card">
      ${detail('user', l.teachers.length > 1 ? 'Teachers' : 'Teacher', l.teachers.map((t) => (t.orig ? `<s>${esc(t.orig)}</s> ` : '') + esc(t.long !== t.name ? `${t.long} (${t.name})` : t.name)).join(', '))}
      ${detail('map-pin', 'Room', l.rooms.map((r) => (r.orig ? `<s>${esc(r.orig)}</s> ` : '') + esc(r.long && r.long !== r.name ? `${r.name} · ${r.long}` : r.name)).join(', '))}
      ${detail('users', 'Classes', esc(l.classes.map((c) => c.name).join(', ')))}
      ${detail('layers', 'Group', esc(l.group))}
      ${detail('clock', 'Duration', durText(l.end - l.start))}
      ${detail('arrow-left-right', 'Substitution', esc(l.subst))}
      ${detail('info', 'Info', esc(l.info))}
      ${detail('book-open', 'Lesson text', esc(l.text))}
    </div>
    ${hw.length ? `<div class="section-title">Homework due</div><div class="card">${hw.map((h) => `<div class="d-row">${icon('clipboard-list')}<div><span>${esc(h.text)}</span></div></div>`).join('')}</div>` : ''}
    <div class="section-title">My note</div>
    <textarea class="note" id="note" placeholder="Add a note for this lesson">${esc(store.notes()[noteKey(l)] || '')}</textarea>
  `, {
    onClose: () => {
      const v = $('#note')?.value.trim();
      if (v !== undefined) { store.setNote(noteKey(l), v); render(); }
    },
  });
}

function openBrowse() {
  let kind = 'classes';
  let q = '';
  const load = async () => {
    if (S.elements[kind]) return;
    S.elements[kind] = 'loading';
    sheetState?.rerender();
    try { S.elements[kind] = await S.api.elements(kind); } catch (e) { S.elements[kind] = { error: e.message }; }
    sheetState?.rerender();
  };
  const build = () => {
    const list = S.elements[kind];
    let body;
    if (!list || list === 'loading') body = skeleton(6);
    else if (list.error) body = emptyState('lock', 'Not available', 'Your school does not share this list with your account.');
    else {
      const f = list.filter((x) => !q || `${x.name} ${x.long}`.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
      body = f.length ? `<div class="card">${f.map((x) => `<button class="row" data-act="pick-element" data-id="${x.id}" data-type="${x.type}" data-label="${esc(x.name)}"><span class="row-ic">${icon({ classes: 'users', teachers: 'user', rooms: 'door-open' }[kind])}</span><span class="row-text"><b>${esc(x.name)}</b>${x.long && x.long !== x.name ? `<small>${esc(x.long)}</small>` : ''}</span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>` : emptyState('search', 'No matches');
    }
    return `<h2 class="sheet-title">Other timetables</h2>
      <div class="seg wide">${[['classes', 'Classes'], ['teachers', 'Teachers'], ['rooms', 'Rooms']].map(([k, label]) => `<button class="${kind === k ? 'on' : ''}" data-act="browse-kind" data-k="${k}">${label}</button>`).join('')}</div>
      <label class="search">${icon('search')}<input id="browse-q" placeholder="Search" value="${esc(q)}" autocomplete="off"></label>
      <div id="browse-list">${body}</div>`;
  };
  openSheet(build, { full: true });
  load();
  openBrowse.setKind = (k) => { kind = k; q = ''; sheetState.rerender(); load(); };
  openBrowse.setQuery = (v) => {
    q = v;
    const tmp = document.createElement('div');
    tmp.innerHTML = build();
    $('#browse-list').innerHTML = $('#browse-list', tmp).innerHTML;
  };
}

function openAbsences() {
  const build = () => {
    if (!S.absences) return `<h2 class="sheet-title">Absences</h2>${skeleton(4)}`;
    if (!S.absences.length) return `<h2 class="sheet-title">Absences</h2>${emptyState('shield-check', 'No absences', 'Nothing recorded this year.')}`;
    const list = S.absences.slice().sort((a, b) => b.startDate - a.startDate || b.start - a.start);
    const unexcused = list.filter((a) => !a.excused).length;
    return `<h2 class="sheet-title">Absences</h2>
      <div class="stats"><div><b>${list.length}</b><span>Total</span></div><div><b>${list.length - unexcused}</b><span>Excused</span></div><div class="${unexcused ? 'bad' : ''}"><b>${unexcused}</b><span>Open</span></div></div>
      <div class="card">${list.map((a) => `<div class="d-row">${icon(a.excused ? 'circle-check' : 'circle-alert', a.excused ? 'ok' : 'bad')}<div>
        <span>${esc(fmt(fromUntisDate(a.startDate), { weekday: 'short', day: 'numeric', month: 'short' }))}${a.endDate !== a.startDate ? ` – ${esc(fmt(fromUntisDate(a.endDate), { day: 'numeric', month: 'short' }))}` : ''} · ${fmtTime(a.start)}–${fmtTime(a.end)}</span>
        <small>${esc([a.reason, a.status || (a.excused ? 'Excused' : 'Not excused'), a.text].filter(Boolean).join(' · '))}</small></div></div>`).join('')}</div>`;
  };
  openSheet(build, { full: true });
  if (!S.absences) loadAbsences().then((ok) => { if (!ok) S.absences = S.absences || []; sheetState?.rerender(); });
}

function openHolidays() {
  const t = toUntisDate(new Date());
  openSheet(() => {
    const list = S.holidays.filter((h) => h.end >= t).sort((a, b) => a.start - b.start);
    return `<h2 class="sheet-title">Holidays</h2>${list.length ? `<div class="card">${list.map((h) => {
      const a = fromUntisDate(h.start); const b = fromUntisDate(h.end);
      const now = h.start <= t;
      return `<div class="d-row">${icon(now ? 'sun' : 'calendar-days')}<div><span>${esc(h.name)}</span><small>${esc(fmt(a, { day: 'numeric', month: 'short' }))}${h.end !== h.start ? ` – ${esc(fmt(b, { day: 'numeric', month: 'short' }))}` : ''} · ${now ? 'now' : esc(inDays(a))}</small></div></div>`;
    }).join('')}</div>` : emptyState('calendar', 'No upcoming holidays')}`;
  }, { full: true });
}

// ---------------------------------------------------------------- hidden customization
const ACCENTS = ['#4f6bff', '#7c5cff', '#d6409f', '#e5484d', '#f76b15', '#e2a300', '#30a46c', '#12a594', '#0090ff', '#64748b'];

function knownSubjects() {
  const m = {};
  Object.entries(S.weeks).forEach(([k, list]) => {
    if (!Array.isArray(list)) return;
    list.forEach((l) => { if (l.subjects[0]) m[l.subjects[0].name] = l.subjects[0].long; });
  });
  (S.homework || []).forEach((h) => { if (h.subject && !m[h.subject]) m[h.subject] = h.subject; });
  return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
}

function openCustomize() {
  if (!S.api) return;
  const s = () => S.settings;
  openSheet(() => {
    const st = s();
    const subjects = knownSubjects();
    return `<h2 class="sheet-title">${icon('paintbrush')}Customize</h2>
    <div class="section-title">Appearance</div>
    <div class="card">
      <div class="row static"><span class="row-text"><b>Theme</b></span></div>
      <div class="row-pad">${seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark'], ['amoled', 'Black']], st.theme)}</div>
      <div class="row static"><span class="row-text"><b>Accent color</b></span></div>
      <div class="row-pad swatches">${ACCENTS.map((c) => `<button class="sw ${st.accent === c ? 'on' : ''}" style="--c:${c}" data-act="set" data-key="accent" data-val="${c}" aria-label="${c}"></button>`).join('')}
        <label class="sw custom" style="--c:${st.accent}">${icon('pencil')}<input type="color" data-key="accent" value="${esc(st.accent)}"></label></div>
      <div class="row static"><span class="row-text"><b>Corner roundness</b><small id="v-radius">${st.radius}px</small></span></div>
      <div class="row-pad"><input type="range" min="0" max="28" step="1" value="${st.radius}" data-key="radius"></div>
      <div class="row static"><span class="row-text"><b>Text size</b><small id="v-fontScale">${Math.round(st.fontScale * 100)}%</small></span></div>
      <div class="row-pad"><input type="range" min="0.85" max="1.25" step="0.05" value="${st.fontScale}" data-key="fontScale"></div>
      <div class="row static"><span class="row-text"><b>Font</b></span></div>
      <div class="row-pad">${seg('font', [['system', 'System'], ['serif', 'Serif'], ['mono', 'Mono']], st.font)}</div>
      <div class="row static"><span class="row-text"><b>Density</b></span></div>
      <div class="row-pad">${seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], st.density)}</div>
      <div class="row static"><span class="row-text"><b>Lesson colors</b></span></div>
      <div class="row-pad">${seg('colorMode', [['subject', 'Per subject'], ['accent', 'Accent'], ['mono', 'Neutral']], st.colorMode)}</div>
    </div>
    <div class="section-title">Timetable</div>
    <div class="card">
      ${toggle('mergeDoubles', 'Merge double lessons')}
      ${toggle('hideCancelled', 'Hide cancelled lessons')}
      ${toggle('showRoom', 'Show rooms')}
      ${toggle('showTeacher', 'Show teachers')}
      ${toggle('teacherLongNames', 'Full teacher names', 'When your school provides them')}
      ${toggle('subjectLongNames', 'Full subject names in lists')}
      ${toggle('subjectShortInGrid', 'Short subject names in week grid')}
      ${toggle('showBreaks', 'Show breaks and free periods')}
      ${toggle('showPeriodNumbers', 'Show period numbers')}
      ${toggle('showNowLine', 'Current time line in week view')}
      ${toggle('showCountdown', 'Countdown on Today card')}
      ${toggle('haptics', 'Vibration feedback')}
    </div>
    <div class="section-title">Title</div>
    <div class="card"><div class="row-pad"><input class="field" data-key="appTitle" placeholder="Custom title on the Today screen" value="${esc(st.appTitle)}" maxlength="30"></div></div>
    <div class="section-title">Subjects</div>
    ${subjects.length ? `<div class="card">${subjects.map(([k, long]) => `<div class="subj-row">
        <label class="sw small" style="--c:${colorFor(k)}"><input type="color" data-subj-color="${esc(k)}" value="${esc(st.subjectColors[k] || PALETTE[hash(k) % PALETTE.length])}"></label>
        <div class="subj-text"><small>${esc(k)}</small><input class="field" data-subj-name="${esc(k)}" placeholder="${esc(long)}" value="${esc(st.subjectNames[k] || '')}"></div>
        ${st.subjectColors[k] || st.subjectNames[k] ? `<button class="icon-btn" data-act="subj-reset" data-k="${esc(k)}" aria-label="Reset">${icon('rotate-ccw')}</button>` : ''}
      </div>`).join('')}</div>` : '<p class="hint">Subjects appear here once your timetable has loaded.</p>'}
    <div class="section-title">Backup</div>
    <div class="card">${row('export-settings', 'upload', 'Copy customization')}${row('import-settings', 'download', 'Paste customization')}</div>
    <div class="card"><button class="row danger" data-act="reset-custom"><span class="row-ic">${icon('rotate-ccw')}</span><span class="row-text"><b>Reset customization</b></span></button></div>
    <div class="sheet-foot"></div>`;
  }, { full: true });
}

function exportSettings() {
  const json = JSON.stringify(S.settings);
  const done = () => toast('Copied to clipboard');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(done, () => prompt('Copy this text', json));
  else prompt('Copy this text', json);
}
function importSettings() {
  const txt = prompt('Paste your customization text');
  if (!txt) return;
  try {
    const obj = JSON.parse(txt);
    S.settings = { ...S.settings, ...obj };
    store.saveSettings(S.settings);
    applyTheme(); render(); sheetState?.rerender();
    toast('Customization applied');
  } catch { toast('That text is not valid', 'err'); }
}

let versionTaps = [];
function versionTap() {
  const now = Date.now();
  versionTaps = versionTaps.filter((t) => now - t < 3000);
  versionTaps.push(now);
  if (versionTaps.length >= 7) { versionTaps = []; haptic('MEDIUM'); openCustomize(); }
}

// ---------------------------------------------------------------- events
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'tab': setView(el.dataset.view); break;
    case 'day': haptic(); setDay(fromUntisDate(Number(el.dataset.d))); break;
    case 'goto-day': S.view = 'today'; setDay(fromUntisDate(Number(el.dataset.d))); break;
    case 'week-prev': haptic(); shiftWeek(-1); break;
    case 'week-next': haptic(); shiftWeek(1); break;
    case 'today': haptic(); S.day = startOfDay(new Date()); S.week = mondayOf(S.day); render(); loadWeek(S.week); break;
    case 'refresh': haptic(); refresh(); break;
    case 'lesson': openLesson(Number(el.dataset.id)); break;
    case 'close-sheet': closeSheet(); break;
    case 'hw-filter': S.hwFilter = el.dataset.f; render(); break;
    case 'hw-toggle': {
      const h = S.homework.find((x) => String(x.id) === el.dataset.id);
      if (h) { const v = !hwDone(h); store.setHomeworkDone(h.id, v); haptic(v ? 'MEDIUM' : 'LIGHT'); el.closest('.hw').classList.toggle('done', v); setTimeout(render, 350); }
      break;
    }
    case 'browse': openBrowse(); break;
    case 'browse-kind': openBrowse.setKind(el.dataset.k); break;
    case 'pick-element':
      S.element = { id: Number(el.dataset.id), type: Number(el.dataset.type), label: el.dataset.label };
      closeSheet(); S.view = 'week'; render(); loadWeek(S.week, { force: true });
      break;
    case 'clear-element': S.element = null; render(); loadWeek(S.week); break;
    case 'absences': openAbsences(); break;
    case 'holidays': openHolidays(); break;
    case 'refresh-all': S.weeks = {}; refresh(); toast('Refreshing'); break;
    case 'clear-cache': store.clearCache(); S.weeks = {}; S.homework = null; S.exams = null; refresh(); toast('Offline data cleared'); break;
    case 'logout':
      if (confirm('Sign out of this account?')) {
        S.api?.logout(); store.clearAccount(); store.clearCache();
        location.reload();
      }
      break;
    case 'version': versionTap(); break;
    case 'set': {
      let v = el.dataset.val;
      setSetting(el.dataset.key, v);
      haptic();
      break;
    }
    case 'toggle': setSetting(el.dataset.key, !S.settings[el.dataset.key]); haptic(); break;
    case 'subj-reset': {
      const k = el.dataset.k;
      const c = { ...S.settings.subjectColors }; delete c[k];
      const n = { ...S.settings.subjectNames }; delete n[k];
      S.settings.subjectColors = c; setSetting('subjectNames', n);
      break;
    }
    case 'export-settings': exportSettings(); break;
    case 'import-settings': importSettings(); break;
    case 'reset-custom':
      if (confirm('Reset all customization to default?')) { store.resetCustomization(); S.settings = store.settings(); applyTheme(); render(); sheetState?.rerender(); }
      break;
    default:
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'browse-q') { openBrowse.setQuery(t.value); return; }
  if (t.dataset.subjName !== undefined) {
    const n = { ...S.settings.subjectNames };
    if (t.value.trim()) n[t.dataset.subjName] = t.value.trim(); else delete n[t.dataset.subjName];
    setSetting('subjectNames', n, { rerenderSheet: false });
    return;
  }
  if (t.dataset.subjColor !== undefined) {
    setSetting('subjectColors', { ...S.settings.subjectColors, [t.dataset.subjColor]: t.value }, { rerenderSheet: false });
    t.parentElement.style.setProperty('--c', t.value);
    return;
  }
  const key = t.dataset.key;
  if (!key) return;
  if (t.type === 'range') {
    const v = Number(t.value);
    setSetting(key, v, { rerenderSheet: false });
    const lab = $(`#v-${key}`);
    if (lab) lab.textContent = key === 'fontScale' ? `${Math.round(v * 100)}%` : `${v}px`;
  } else if (t.type === 'color') {
    setSetting(key, t.value, { rerenderSheet: false });
    t.parentElement.style.setProperty('--c', t.value);
  } else setSetting(key, t.value, { rerenderSheet: false });
});
document.addEventListener('change', (e) => {
  if (e.target.type === 'color' && sheetState) sheetState.rerender();
});

// ---------------------------------------------------------------- login
const L = { school: null, manual: false, results: [], searching: false, error: '', busy: false, query: '' };

function renderLogin() {
  const sel = L.school;
  document.body.innerHTML = `<div class="login">
    <div class="login-hero"><div class="logo">${icon('calendar-days')}</div><h1>Lessn</h1><p>Your timetable, homework and exams in one place.</p></div>
    <form id="login-form" class="login-card" autocomplete="on">
      ${sel ? `<div class="picked">${icon('school')}<div><b>${esc(sel.name)}</b><small>${esc(sel.address || sel.server)}</small></div><button type="button" class="link" data-login="change">Change</button></div>`
      : L.manual ? `
        <label class="lbl">Server</label><label class="input">${icon('server')}<input name="server" placeholder="e.g. nessa.webuntis.com" autocapitalize="off" autocorrect="off" required></label>
        <label class="lbl">School login name</label><label class="input">${icon('school')}<input name="school" placeholder="As shown in the WebUntis URL" autocapitalize="off" autocorrect="off" required></label>
        <button type="button" class="link" data-login="search">Search for your school instead</button>`
      : `<label class="lbl">School</label><label class="input">${icon('search')}<input id="school-q" placeholder="Search by school name or city" value="${esc(L.query)}" autocomplete="off"></label>
        <div id="school-results">${schoolResults()}</div>
        <button type="button" class="link" data-login="manual">Enter server manually</button>`}
      <label class="lbl">Username</label><label class="input">${icon('user')}<input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required></label>
      <label class="lbl">Password</label><label class="input">${icon('lock')}<input name="password" type="password" autocomplete="current-password" required><button type="button" class="eye" data-login="eye" aria-label="Show password">${icon('eye')}</button></label>
      ${L.error ? `<div class="err">${icon('circle-alert')}<span>${esc(L.error)}</span></div>` : ''}
      <button class="btn" ${L.busy ? 'disabled' : ''}>${L.busy ? `${icon('refresh-cw', 'spin-ic')}Signing in` : 'Sign in'}</button>
      <p class="fine">${icon('shield-check')}Your login stays on this phone and is only sent to your school's server.</p>
    </form></div><div id="toast" class="toast"></div>`;
}
function schoolResults() {
  if (L.searching) return `<div class="results muted">${icon('refresh-cw', 'spin-ic')}Searching</div>`;
  if (L.error && !L.results.length && L.query) return '';
  return L.results.length ? `<div class="results">${L.results.slice(0, 20).map((s, i) => `<button type="button" class="result" data-login="pick" data-i="${i}">${icon('school')}<div><b>${esc(s.name)}</b><small>${esc(s.address)}</small></div></button>`).join('')}</div>` : '';
}

let searchTimer;
function bindLogin() {
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'school-q') return;
    L.query = e.target.value.trim();
    clearTimeout(searchTimer);
    if (L.query.length < 3) { L.results = []; $('#school-results').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      L.searching = true; L.error = '';
      $('#school-results').innerHTML = schoolResults();
      try { L.results = await searchSchools(L.query); if (!L.results.length) L.error = ''; }
      catch (err) { L.results = []; $('#school-results').innerHTML = `<div class="results muted">${icon('circle-alert')}${esc(err.code === -6003 ? err.message : 'School search is unavailable. Enter the server manually.')}</div>`; L.searching = false; return; }
      L.searching = false;
      const box = $('#school-results');
      if (box) box.innerHTML = schoolResults() || `<div class="results muted">${icon('search')}No schools found</div>`;
    }, 350);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-login]');
    if (!b) return;
    const keep = keepCreds();
    const a = b.dataset.login;
    if (a === 'pick') { L.school = L.results[Number(b.dataset.i)]; L.error = ''; }
    else if (a === 'change') { L.school = null; }
    else if (a === 'manual') { L.manual = true; L.school = null; }
    else if (a === 'search') { L.manual = false; }
    else if (a === 'eye') {
      const inp = b.previousElementSibling;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eye-off');
      return;
    }
    renderLogin(); restoreCreds(keep);
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'login-form') return;
    e.preventDefault();
    const f = new FormData(e.target);
    let server; let school; let schoolName;
    if (L.school) { server = L.school.server; school = L.school.login; schoolName = L.school.name; }
    else if (L.manual) {
      const p = parseServerInput(f.get('server'));
      server = p.server; school = (f.get('school') || p.school || '').trim(); schoolName = school;
    } else { L.error = 'Pick your school first.'; const k = keepCreds(); renderLogin(); restoreCreds(k); return; }
    const username = String(f.get('username')).trim();
    const password = String(f.get('password'));
    const keep = keepCreds();
    L.busy = true; L.error = ''; renderLogin(); restoreCreds(keep);
    try {
      const api = new Untis({ server, school, username, password });
      await api.login();
      const acc = { server, school, schoolName, username, password, element: api.ownElement(), personType: api.personType, personId: api.personId, klasseId: api.klasseId };
      store.setAccount(acc);
      S.account = acc;
      L.busy = false;
      startApp(api);
    } catch (err) {
      L.busy = false;
      L.error = err.message || 'Login failed.';
      renderLogin(); restoreCreds(keep);
    }
  });
}
function keepCreds() {
  const f = $('#login-form');
  if (!f) return {};
  return Object.fromEntries([...f.querySelectorAll('input[name]')].map((i) => [i.name, i.value]));
}
function restoreCreds(v) {
  Object.entries(v || {}).forEach(([k, val]) => { const i = $(`#login-form input[name="${k}"]`); if (i) i.value = val; });
}

// ---------------------------------------------------------------- boot
function startApp(api) {
  S.api = api || new Untis(S.account);
  if (!api) Object.assign(S.api, { personType: S.account.personType, personId: S.account.personId, klasseId: S.account.klasseId });
  S.view = S.settings.startView;
  renderShell();
  render();
  refresh();
  setInterval(() => {
    if (document.hidden || document.activeElement?.matches('input, textarea')) return;
    if (S.view === 'today' || S.view === 'week') render();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.settings.autoRefresh && Date.now() - S.lastRefresh > 5 * 60000) {
      if (!sameDay(S.day, new Date()) && S.view === 'today') { S.day = startOfDay(new Date()); S.week = mondayOf(S.day); }
      refresh();
    }
  });
  plugin('App')?.addListener('backButton', () => {
    if (closeSheet()) return;
    if (S.element) { S.element = null; render(); return; }
    if (S.view !== S.settings.startView) { setView(S.settings.startView); return; }
    safe(plugin('App').exitApp());
  });
}

function boot() {
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme(); });
  if (S.account) startApp();
  else { bindLogin(); renderLogin(); }
}

boot();
