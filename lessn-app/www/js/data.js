// Data loading, caching, lesson logic and background scheduling.
import {
  S, t, store, toUntisDate, fromUntisDate, addDays, mondayOf, startOfDay, fmtTime, toast, subjKey, subjName, fmt,
} from './core.js';
import { native } from './native.js';
import { client as iservUiClient, refreshHub } from './iserv-ui.js';
import { render, updateHeader } from './app.js';

// ---------------------------------------------------------------- cache keys
export function ownElement() {
  return S.api?.personType ? S.api.ownElement() : S.account?.element || { id: 0, type: 0 };
}
const elKey = (el) => { const e = el || S.element || ownElement(); return `${e.type}-${e.id}`; };
export const weekKey = (monday, el) => `tt:${elKey(el)}:${toUntisDate(monday)}`;
export function weekData(monday, el) {
  const k = weekKey(monday, el);
  if (S.weeks[k]) return S.weeks[k];
  const c = store.cache(k);
  if (c) { S.weeks[k] = c.data; return c.data; }
  return null;
}
const ownWeek = (monday) => weekData(monday, ownElement());

// ---------------------------------------------------------------- runner
export async function run(fn, { quiet = false } = {}) {
  S.loading++;
  updateHeader();
  try {
    await fn();
    S.offline = false;
    return true;
  } catch (e) {
    console.warn(e);
    if (e.code === 'network') S.offline = true;
    else if (!quiet) toast(t(e.message || String(e)), 'err');
    return false;
  } finally {
    S.loading--;
    render();
  }
}

// ---------------------------------------------------------------- loaders
export async function loadWeek(monday, { force = false, quiet = false } = {}) {
  const k = weekKey(monday);
  weekData(monday);
  if (!force && S.weeks[k] && S.weeks[`fresh:${k}`]) return;
  const element = S.element;
  await run(async () => {
    let data;
    try { data = await S.api.timetable(monday, addDays(monday, 6), element); }
    catch (e) { if (e.code === -7004) data = []; else throw e; }
    if (!element) detectChanges(S.weeks[k] || store.cache(k)?.data || null, data);
    S.weeks[k] = data;
    S.weeks[`fresh:${k}`] = true;
    if (!element) store.setCache(k, data);
  }, { quiet });
}

export async function loadMeta(force = false) {
  const tg = store.cache('timegrid');
  if (!force && tg && Date.now() - tg.t < 864e5 && S.timegrid.length) return;
  await run(async () => {
    const [grid, hol] = await Promise.allSettled([S.api.timegrid(), S.api.holidays()]);
    if (grid.status === 'fulfilled') { S.timegrid = grid.value; store.setCache('timegrid', grid.value); }
    if (hol.status === 'fulfilled') { S.holidays = hol.value; store.setCache('holidays', hol.value); }
  }, { quiet: true });
}

const today = () => startOfDay(new Date());

export const loadHomework = (quiet = false) => run(async () => {
  S.homework = await S.api.homework(addDays(today(), -21), addDays(today(), 90));
  store.setCache('homework', S.homework);
}, { quiet });

export const loadExams = (quiet = false) => run(async () => {
  S.exams = await S.api.exams(addDays(today(), -60), addDays(today(), 240));
  store.setCache('exams', S.exams);
}, { quiet });

export const loadNews = () => run(async () => {
  S.news = await S.api.news(today());
  store.setCache('news', S.news);
}, { quiet: true });

export const loadAbsences = (quiet = false) => run(async () => {
  S.absences = await S.api.absences(addDays(today(), -365), today());
  store.setCache('absences', S.absences);
}, { quiet });

async function schoolyearRange() {
  try {
    const y = await S.api.schoolyear();
    if (y?.startDate) return [fromUntisDate(y.startDate), fromUntisDate(y.endDate)];
  } catch { /* fall through */ }
  return [addDays(today(), -330), addDays(today(), 30)];
}

export const loadGrades = (quiet = true) => run(async () => {
  try {
    const [a, b] = await schoolyearRange();
    S.grades = await S.api.grades(a, b);
    S.gradesError = false;
    store.setCache('grades', S.grades);
  } catch (e) {
    S.gradesError = true;
    if (!S.grades) S.grades = [];
    if (e.code === 'network') throw e;
  }
}, { quiet });

export const iservClient = () => iservUiClient();
export const loadIServ = () => refreshHub();

export async function refresh(force = true) {
  if (S.view === 'iserv' || S.view.startsWith('is-')) { refreshHub(); return; }
  S.lastRefresh = Date.now();
  const ok = await run(async () => {
    await S.api.login();
    const acc = { ...S.account, element: S.api.ownElement(), personType: S.api.personType, personId: S.api.personId, klasseId: S.api.klasseId };
    S.account = acc;
    store.setAccount(acc);
  });
  if (!ok) return;
  store.setCache('lastRefresh', S.lastRefresh);
  const jobs = [loadWeek(S.week, { force }), loadMeta(force), loadNews()];
  if (S.view === 'tasks' || S.homework) jobs.push(loadHomework(true));
  if (S.view === 'exams' || S.exams || S.view === 'today') jobs.push(loadExams(true));
  if (store.iserv()) jobs.push(loadIServ());
  await Promise.all(jobs);
  prefetchOffline();
}

/** Saves the surrounding weeks so the plan also works without internet. */
async function prefetchOffline() {
  if (S.element) return;
  const base = mondayOf(new Date());
  for (const off of [0, 1, 2, 3, -1]) {
    const m = addDays(base, off * 7);
    const k = weekKey(m);
    if (!S.weeks[`fresh:${k}`]) await loadWeek(m, { quiet: true });
  }
  if (!S.homework) loadHomework(true);
  if (!S.exams) loadExams(true);
  scheduleNative();
}

export function offlineInfo() {
  let weeks = 0;
  try { weeks = Object.keys(localStorage).filter((k) => k.startsWith('lessn:cache:tt:')).length; } catch { /* ignore */ }
  return { weeks, at: S.lastRefresh };
}

// ---------------------------------------------------------------- lesson logic
export function timegridFor(date) {
  return (S.timegrid.find((d) => d.day === date.getDay() + 1) || S.timegrid[0])?.units || [];
}
export function periodLabel(l) {
  if (!S.settings.showPeriodNumbers) return '';
  const units = timegridFor(fromUntisDate(l.date));
  const a = units.findIndex((u) => u.start === l.start);
  const b = units.findIndex((u) => u.end === l.end);
  if (a < 0) return '';
  const na = units[a].name || a + 1;
  return b > a ? `${na}–${units[b].name || b + 1}` : String(na);
}
export function holidayFor(date) {
  const u = toUntisDate(date);
  return S.holidays.find((h) => h.start <= u && u <= h.end);
}
export function nextHoliday() {
  const u = toUntisDate(new Date());
  return S.holidays.filter((h) => h.end >= u).sort((a, b) => a.start - b.start)[0];
}

const sig = (l) => [subjKey(l), l.teachers.map((x) => `${x.id}:${x.orig}`).join(), l.rooms.map((r) => `${r.id}:${r.orig}`).join(),
  l.classes.map((c) => c.id).join(), l.code, l.type, l.info, l.subst, l.text, l.group].join('|');
const MAX_LINK_GAP = 20;

/**
 * Lessons of one day. Identical consecutive lessons are merged into one double period,
 * consecutive lessons of the same subject that differ (e.g. another room) are linked as a chain.
 */
export function prepareDay(lessons, date) {
  const u = toUntisDate(date);
  let list = (lessons || []).filter((l) => l.date === u).map((l) => ({ ...l, ids: [l.id], units: 1, breakMin: 0 }));
  list.sort((a, b) => a.start - b.start || subjKey(a).localeCompare(subjKey(b)));
  if (S.settings.hideCancelled) list = list.filter((l) => l.code !== 'cancelled');
  if (S.settings.mergeDoubles) {
    const out = [];
    for (const l of list) {
      const prev = out.find((p) => p.end <= l.start && l.start - p.end <= MAX_LINK_GAP && sig(p) === sig(l)
        && !out.some((o) => o !== p && o.start < l.start && o.end > p.end));
      if (prev) { prev.breakMin += l.start - prev.end; prev.end = l.end; prev.ids.push(l.id); prev.units++; } else out.push(l);
    }
    list = out;
  }
  list.sort((a, b) => a.start - b.start || (a.code === 'cancelled') - (b.code === 'cancelled'));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const b = list.find((x) => x.start >= a.end && x.start - a.end <= MAX_LINK_GAP && subjKey(x) === subjKey(a)
      && (x.code === 'cancelled') === (a.code === 'cancelled'));
    if (!b) continue;
    const parallel = list.some((o) => o !== a && o !== b && o.start < b.end && o.end > a.start);
    if (!parallel) { a.chainNext = b.id; b.chainPrev = a.id; }
  }
  list.forEach((l) => { S.index[l.id] = l; });
  return list;
}

export function changes(l) {
  const out = [];
  if (l.code === 'cancelled') out.push({ cls: 'bad', icon: 'ban', text: t('Cancelled') });
  if (l.type === 'ex') out.push({ cls: 'exam', icon: 'graduation-cap', text: t('Exam') });
  if (l.teachers.some((x) => x.orig)) out.push({ cls: 'warn', icon: 'arrow-left-right', text: t('Substitute') });
  if (l.rooms.some((r) => r.orig)) out.push({ cls: 'warn', icon: 'door-open', text: t('Room change') });
  if (l.code === 'irregular' && out.length === 0) out.push({ cls: 'warn', icon: 'triangle-alert', text: t('Changed') });
  return out;
}
export const isChanged = (l) => l.code === 'cancelled' || l.code === 'irregular' || l.teachers.some((x) => x.orig) || l.rooms.some((r) => r.orig);

export function visibleDays(monday) {
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

// ---------------------------------------------------------------- change alerts
const changeSig = (l) => `${l.id}:${l.code}:${l.teachers.map((x) => x.orig || '').join()}:${l.rooms.map((x) => x.orig || '').join()}`;
function detectChanges(before, after) {
  if (!after) return;
  const seen = store.seenChanges();
  const first = !Object.keys(seen).length && !before;
  const now = toUntisDate(new Date());
  const fresh = [];
  for (const l of after) {
    if (!isChanged(l) || l.date < now) continue;
    const k = changeSig(l);
    if (!seen[k]) { seen[k] = l.date; if (!first && before) fresh.push(l); }
  }
  // forget old entries
  for (const [k, d] of Object.entries(seen)) if (d < now - 100) delete seen[k];
  store.setSeenChanges(seen);
  if (!fresh.length || !S.settings.notifyChanges) return;
  const l = fresh[0];
  const what = l.code === 'cancelled' ? t('Cancelled') : t('Changed');
  const msg = `${subjName(l)} · ${fmt(fromUntisDate(l.date), { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(l.start)}`;
  toast(`${what}: ${msg}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ''}`);
  native.schedule([...pendingEvents, { at: Date.now() + 1500, type: 'remind', id: 900, title: `${what}: ${subjName(l)}`, body: msg }]);
}

// ---------------------------------------------------------------- native scheduling
let pendingEvents = [];
function dateAt(u, min) { const d = fromUntisDate(u); d.setHours(Math.floor(min / 60), min % 60, 0, 0); return d.getTime(); }

/** Builds reminders, Do Not Disturb windows and attendance checks for the next days. */
export function buildEvents() {
  const s = S.settings;
  const events = [];
  const now = Date.now();
  const base = mondayOf(new Date());
  const days = {};
  for (const off of [0, 7]) {
    const m = addDays(base, off);
    const data = ownWeek(m);
    if (!data) continue;
    for (let i = 0; i < 7; i++) {
      const d = addDays(m, i);
      const list = prepareDay(data, d).filter((l) => l.code !== 'cancelled');
      if (list.length) days[toUntisDate(d)] = list;
    }
  }
  let id = 1000;
  for (const [u, list] of Object.entries(days)) {
    const date = Number(u);
    if (s.notifyLessons) {
      for (const l of list) {
        const at = dateAt(date, l.start) - s.notifyMinutes * 60000;
        if (at <= now) continue;
        const where = [l.rooms.map((r) => r.name).join(', '), l.teachers.map((x) => x.name).join(', ')].filter(Boolean).join(' · ');
        events.push({ at, type: 'remind', id: id++, title: t('{subject} in {n} min', { subject: subjName(l), n: s.notifyMinutes }), body: `${fmtTime(l.start)}–${fmtTime(l.end)}${where ? ` · ${where}` : ''}` });
      }
    }
    if (s.dndLessons) {
      const blocks = [];
      for (const l of list) {
        const last = blocks[blocks.length - 1];
        if (last && (s.dndBreaks || l.start <= last.end + 1)) last.end = Math.max(last.end, l.end);
        else blocks.push({ start: l.start, end: l.end });
      }
      for (const b of blocks) {
        const on = dateAt(date, b.start);
        const off = dateAt(date, b.end);
        if (off <= now) continue;
        events.push({ at: Math.max(on, now + 2000), type: 'dndOn' });
        events.push({ at: off, type: 'dndOff' });
      }
    }
    if (s.presenceCheck && s.schoolLoc) {
      const at = dateAt(date, list[0].start) + 10 * 60000;
      if (at > now) {
        events.push({
          at, type: 'presence', date: String(date), lat: s.schoolLoc.lat, lng: s.schoolLoc.lng, radius: s.presenceRadius,
          title: t('Are you at school?'), body: t('Your lessons started, but you seem to be away from school.'), yes: t('Yes'), no: t('No'),
        });
      }
    }
  }
  return events.sort((a, b) => a.at - b.at);
}

export function scheduleNative() {
  pendingEvents = buildEvents();
  native.schedule(pendingEvents);
}
