// Planner: a real calendar with your own events (and exams/tests you add), reminders, study check-ins before
// tests, the schedule summary every AI chat gets, AI names for holidays, and notification targets.
import {
  S, t, $, esc, icon, fmt, relDay, inDays, pad, store, emptyState, stagger, openSheet, closeSheet, toast, colorFor, subjLabel,
  formSelect, formDate, uiConfirm, toUntisDate, fromUntisDate, daysBetween, startOfDay, addDays, mondayOf, sameDay, fmtTime,
} from './core.js';
import { native, hasNative } from './native.js';
import { prepareDay, weekData, ownElement, holidayFor } from './data.js';
import { render, setView } from './app.js';

const read = (k, d) => { try { const v = localStorage.getItem(`lessn:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(`lessn:${k}`, JSON.stringify(v)); } catch { toast(t('Storage is full'), 'err'); } };
export const myEvents = () => read('events', []);
const setEvents = (v) => write('events', v);
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uOfIso = (s) => Number(String(s).replace(/-/g, ''));
const hm = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 100 + Number(m[2]) : null; };

export const EVENT_TYPES = {
  event: { label: 'Event', icon: 'calendar', color: '#4f6bff' },
  exam: { label: 'Exam', icon: 'graduation-cap', color: '#8e4ec6' },
  test: { label: 'Test', icon: 'file-pen', color: '#d6409f' },
  presentation: { label: 'Presentation', icon: 'presentation', color: '#f76b15' },
  homework: { label: 'Homework', icon: 'clipboard-list', color: '#e08a00' },
  reminder: { label: 'Reminder', icon: 'bell', color: '#12a594' },
  trip: { label: 'Trip', icon: 'map-pin', color: '#30a46c' },
  birthday: { label: 'Birthday', icon: 'cake', color: '#e5484d' },
  free: { label: 'Day off', icon: 'sun', color: '#f59e0b' },
};
const examTypes = new Set(['exam', 'test', 'presentation']);

/** Own events that occur on a date (weekly / yearly repeats included). */
function eventsOn(u) {
  const d = fromUntisDate(u);
  return [...myEvents(), ...read('icsevents', [])].filter((e) => {
    if (e.date === u) return true;
    if (e.date > u) return false;
    if (e.repeat === 'weekly') return fromUntisDate(e.date).getDay() === d.getDay() && (!e.until || u <= e.until);
    if (e.repeat === 'yearly') return String(e.date).slice(4) === String(u).slice(4);
    return false;
  }).sort((a, b) => (hm(a.start) ?? -1) - (hm(b.start) ?? -1));
}
/** Exams and tests you added in the calendar, in the same shape as WebUntis exams. */
export function calendarExams() {
  return myEvents().filter((e) => examTypes.has(e.type)).map((e) => ({ id: `ev-${e.id}`, date: e.date, subject: e.subject || '', name: e.title, text: e.notes || '', start: hm(e.start) || 0, fromCalendar: true, type: e.type }));
}

// ---------------------------------------------------------------- everything on a day (for the calendar and the AI)
async function allExamsSafe() { try { return (await import('./views.js')).allExams(); } catch { return []; } }
function lessonsOn(d) {
  const data = weekData(mondayOf(d), ownElement());
  return data ? prepareDay(data, d) : null;
}
async function homeworkSafe() { try { const A = await import('./assist.js'); return A.allHomework().filter((h) => !A.hwDoneAny(h)); } catch { return []; } }
function iservEventsOn(u) {
  return (S.iservData?.events || []).filter((e) => { const d = new Date(e.start); return !Number.isNaN(d.getTime()) && toUntisDate(d) === u; });
}

// ---------------------------------------------------------------- schedule summary for every AI chat
let ctxCache = { t: 0, text: '' };
export function scheduleContext() {
  if (Date.now() - ctxCache.t < 60000) return ctxCache.text;
  const today = startOfDay(new Date());
  const u = toUntisDate(today);
  const lines = [];
  const les = lessonsOn(today);
  if (les?.length) lines.push(`Today's lessons: ${les.filter((l) => l.code !== 'cancelled').map((l) => `${fmtTime(l.start)} ${subjLabel(l.subjects[0]?.name) || l.subjects[0]?.name || ''}`).join(', ')}${les.some((l) => l.code === 'cancelled') ? ` (cancelled: ${les.filter((l) => l.code === 'cancelled').map((l) => subjLabel(l.subjects[0]?.name)).join(', ')})` : ''}.`);
  const tomorrow = lessonsOn(addDays(today, 1));
  if (tomorrow?.length) lines.push(`Tomorrow: ${tomorrow.filter((l) => l.code !== 'cancelled').map((l) => subjLabel(l.subjects[0]?.name) || l.subjects[0]?.name).join(', ')}.`);
  const exams = [...(S.exams || []), ...store.myExams(), ...calendarExams()].filter((e) => e.date >= u && e.date <= toUntisDate(addDays(today, 30))).sort((a, b) => a.date - b.date).slice(0, 10);
  if (exams.length) lines.push(`Upcoming exams/tests: ${exams.map((e) => `${subjLabel(e.subject) || e.subject || ''} "${e.name || 'Exam'}" on ${fmt(fromUntisDate(e.date), { weekday: 'short', day: 'numeric', month: 'short' })} (${daysBetween(today, fromUntisDate(e.date))} days)${e.text ? ` – ${String(e.text).slice(0, 80)}` : ''}`).join('; ')}.`);
  try {
    const hw = (window.__lessnHw || []).filter((h) => h.due >= u && h.due <= toUntisDate(addDays(today, 7))).slice(0, 10);
    if (hw.length) lines.push(`Homework due soon: ${hw.map((h) => `${subjLabel(h.subject) || h.subject || ''}: ${String(h.text).slice(0, 70)} (due ${fmt(fromUntisDate(h.due), { weekday: 'short', day: 'numeric', month: 'short' })})`).join('; ')}.`);
  } catch { /* no homework yet */ }
  const ev = [];
  for (let i = 0; i < 14; i++) { const du = toUntisDate(addDays(today, i)); for (const e of eventsOn(du)) if (!examTypes.has(e.type)) ev.push(`${e.title} (${fmt(fromUntisDate(du), { weekday: 'short', day: 'numeric', month: 'short' })}${e.start ? ` ${e.start}` : ''})`); }
  if (ev.length) lines.push(`Calendar: ${ev.slice(0, 10).join('; ')}.`);
  const hol = S.holidays?.filter((h) => h.end >= u).sort((a, b) => a.start - b.start)[0];
  if (hol) lines.push(`Next holiday: ${hol.name} from ${fmt(fromUntisDate(hol.start), { day: 'numeric', month: 'short' })}.`);
  const text = lines.length ? `What you know about the student's schedule (use it when it helps, e.g. to plan learning before tests):\n${lines.join('\n')}` : '';
  ctxCache = { t: Date.now(), text };
  return text;
}
// homework is loaded asynchronously; keep a copy for the summary above
export async function refreshContextData() { window.__lessnHw = await homeworkSafe(); ctxCache.t = 0; }

// ---------------------------------------------------------------- calendar screen
const CAL = { month: startOfDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), sel: startOfDay(new Date()) };
export function viewCalendar() {
  const m = CAL.month;
  const first = (m.getDay() + 6) % 7;
  const n = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const exams = [...(S.exams || []), ...store.myExams()];
  const hw = window.__lessnHw || [];
  if (!window.__lessnHw) refreshContextData().then(() => { if (S.view === 'calendar') render(); });
  const wd = Array.from({ length: 7 }, (_, i) => fmt(addDays(mondayOf(new Date()), i), { weekday: 'narrow' }));
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<span class="cal-cell pad"></span>');
  for (let day = 1; day <= n; day++) {
    const d = new Date(m.getFullYear(), m.getMonth(), day);
    const u = toUntisDate(d);
    const dots = [];
    if (exams.some((e) => e.date === u)) dots.push('exam');
    for (const e of eventsOn(u)) dots.push(e.type);
    if (hw.some((h) => h.due === u)) dots.push('homework');
    if (iservEventsOn(u).length) dots.push('iserv');
    const hol = holidayFor(d);
    cells.push(`<button class="cal-cell ${sameDay(d, CAL.sel) ? 'sel' : ''} ${sameDay(d, new Date()) ? 'today' : ''} ${hol ? 'hol' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'we' : ''}" data-act="cal-day" data-d="${u}"><b>${day}</b><span class="cal-dots">${[...new Set(dots)].slice(0, 4).map((x) => `<i style="--c:${(EVENT_TYPES[x] || { color: x === 'iserv' ? '#12a594' : '#8e4ec6' }).color}"></i>`).join('')}</span></button>`);
  }
  return `<div class="pad cal-wrap">
    <div class="cal-head"${stagger(0)}><button class="icon-btn" data-act="cal-month" data-dir="-1" aria-label="${esc(t('Previous month'))}">${icon('chevron-left')}</button>
      <button class="cal-title" data-act="cal-today"><b>${esc(fmt(m, { month: 'long', year: 'numeric' }))}</b></button>
      <button class="icon-btn" data-act="cal-month" data-dir="1" aria-label="${esc(t('Next month'))}">${icon('chevron-right')}</button></div>
    <div class="cal-grid"${stagger(1)}>${wd.map((w) => `<span class="cal-wd">${esc(w)}</span>`).join('')}${cells.join('')}</div>
    <div class="cal-legend"${stagger(2)}>${[['exam', t('Exams')], ['homework', t('Homework')], ['event', t('Events')], ['iserv', 'IServ']].map(([k, l]) => `<span><i style="--c:${(EVENT_TYPES[k] || { color: '#12a594' }).color}"></i>${esc(l)}</span>`).join('')}</div>
    <div id="cal-agenda">${agendaHtml(CAL.sel)}</div>
    <button class="fab" data-act="ev-add" aria-label="${esc(t('Add to calendar'))}">${icon('plus')}</button>
  </div>`;
}
function agendaHtml(d) {
  const u = toUntisDate(d);
  const items = [];
  const hol = holidayFor(d);
  if (hol) items.push(`<div class="ag-item hol">${icon('sun')}<span><b>${esc(hol.name)}</b><small>${esc(t('Holiday'))}</small></span></div>`);
  for (const e of [...(S.exams || []), ...store.myExams()].filter((x) => x.date === u)) {
    items.push(`<button class="ag-item" data-act="exam-open" data-id="${esc(String(e.id ?? `${e.date}-${e.subject}`))}" style="--c:${colorFor(e.subject)}">${icon('graduation-cap')}<span><b>${esc(subjLabel(e.subject) || t('Exam'))}</b><small>${esc([e.name, e.start ? fmtTime(e.start) : ''].filter(Boolean).join(' · '))}</small></span>${icon('chevron-right', 'row-chev')}</button>`);
  }
  for (const e of eventsOn(u)) {
    const ty = EVENT_TYPES[e.type] || EVENT_TYPES.event;
    items.push(`<button class="ag-item" data-act="ev-open" data-id="${esc(e.id)}" style="--c:${e.color || ty.color}">${icon(ty.icon)}<span><b>${esc(e.title)}</b><small>${esc([t(ty.label), e.start ? `${e.start}${e.end ? `–${e.end}` : ''}` : t('All day'), subjLabel(e.subject), e.repeat === 'weekly' ? t('Every week') : e.repeat === 'yearly' ? t('Every year') : ''].filter(Boolean).join(' · '))}</small></span>${icon('chevron-right', 'row-chev')}</button>`);
  }
  for (const h of (window.__lessnHw || []).filter((x) => x.due === u)) {
    items.push(`<button class="ag-item" data-act="hw-open" data-key="${esc(h.key)}" style="--c:${colorFor(h.subject)}">${icon('clipboard-list')}<span><b>${esc(subjLabel(h.subject) || t('Homework'))}</b><small>${esc(String(h.text).slice(0, 90))}</small></span>${icon('chevron-right', 'row-chev')}</button>`);
  }
  for (const e of iservEventsOn(u)) items.push(`<div class="ag-item" style="--c:#12a594">${icon('school')}<span><b>${esc(e.title)}</b><small>${esc([e.allDay ? t('All day') : fmt(new Date(e.start), { hour: '2-digit', minute: '2-digit' }), e.location].filter(Boolean).join(' · '))}</small></span></div>`);
  const les = lessonsOn(d);
  const real = (les || []).filter((l) => l.code !== 'cancelled');
  if (real.length) items.push(`<button class="ag-item lessons" data-act="cal-goto-day" data-d="${u}">${icon('calendar-days')}<span><b>${esc(t('{n} lessons', { n: real.length }))}</b><small>${esc(`${fmtTime(real[0].start)}–${fmtTime(real[real.length - 1].end)}`)}${les.length > real.length ? ` · ${esc(t('{n} cancelled', { n: les.length - real.length }))}` : ''}</small></span>${icon('chevron-right', 'row-chev')}</button>`);
  return `<div class="section-title ag-title">${esc(relDay(d))} · ${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))}<button class="link" data-act="ev-add" data-d="${u}">${icon('plus', 'mini')}${esc(t('Add'))}</button></div>
    ${items.length ? `<div class="card ag-list">${items.join('')}</div>` : emptyState('calendar', t('Nothing planned'))}`;
}
export function calDay(u) {
  CAL.sel = fromUntisDate(Number(u));
  document.querySelectorAll('.cal-cell.sel').forEach((x) => x.classList.remove('sel'));
  document.querySelector(`.cal-cell[data-d="${u}"]`)?.classList.add('sel');
  const a = $('#cal-agenda'); if (a) { a.innerHTML = agendaHtml(CAL.sel); a.classList.remove('swap'); void a.offsetWidth; a.classList.add('swap'); }
}
export function calMonth(dir) { CAL.month = new Date(CAL.month.getFullYear(), CAL.month.getMonth() + Number(dir), 1); S.anim = Number(dir) > 0 ? 'left' : 'right'; render(); }
export function calToday() { CAL.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); CAL.sel = startOfDay(new Date()); S.anim = 'fade'; render(); }

// ---------------------------------------------------------------- add / edit events
const REMINDERS = [['', 'No reminder'], ['0', 'At the time'], ['10', '10 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'], ['2880', '2 days before'], ['10080', '1 week before']];
function subjectsKnown() {
  const map = new Map();
  for (const w of Object.values(S.weeks || {})) for (const l of (Array.isArray(w) ? w : [])) for (const s of l.subjects || l.su || []) if (s?.name) map.set(s.name, s.long || s.longname || s.name);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
export function openEventForm(id, prefill = {}) {
  const e = myEvents().find((x) => x.id === id) || { type: prefill.type || 'event', date: prefill.date || toUntisDate(CAL.sel), title: '', start: '', end: '', subject: prefill.subject || '', notes: '', remind: prefill.remind ?? '60', repeat: 'none' };
  const d = fromUntisDate(e.date);
  openSheet(() => `<h2 class="sheet-title">${icon(id ? 'pencil' : 'calendar-plus')}${esc(id ? t('Edit') : t('Add to calendar'))}</h2>
    <div class="form">
      <label class="lbl">${esc(t('Type'))}</label>
      ${formSelect('ev-type', Object.entries(EVENT_TYPES).map(([k, v]) => [k, t(v.label)]), e.type)}
      <label class="lbl">${esc(t('Title'))}</label>
      <label class="input">${icon('type')}<input id="ev-title" value="${esc(e.title)}" placeholder="${esc(t('e.g. Maths test chapter 4'))}"></label>
      <label class="lbl">${esc(t('Subject'))}</label>
      ${formSelect('ev-subj', [['', t('No subject')], ...subjectsKnown().map(([k, long]) => [k, subjLabel(k) || long])], e.subject)}
      <label class="lbl">${esc(t('Date'))}</label>
      ${formDate('ev-date', isoOf(d), [[t('Today'), new Date()], [t('Tomorrow'), addDays(new Date(), 1)], [t('Next week'), addDays(new Date(), 7)]])}
      <div class="two-col"><div><label class="lbl">${esc(t('From'))}</label><label class="input">${icon('clock')}<input id="ev-start" type="time" value="${esc(e.start)}"></label></div>
        <div><label class="lbl">${esc(t('To'))}</label><label class="input">${icon('clock')}<input id="ev-end" type="time" value="${esc(e.end)}"></label></div></div>
      <label class="lbl">${esc(t('Reminder'))}</label>
      ${formSelect('ev-remind', REMINDERS.map(([v, l]) => [v, t(l)]), String(e.remind ?? ''))}
      <label class="lbl">${esc(t('Repeat'))}</label>
      ${formSelect('ev-repeat', [['none', t('Never')], ['weekly', t('Every week')], ['yearly', t('Every year')]], e.repeat || 'none')}
      <label class="lbl">${esc(t('Notes'))}</label>
      <textarea class="note" id="ev-notes" placeholder="${esc(t('Topics, room, what to bring…'))}">${esc(e.notes)}</textarea>
      <button class="btn" data-act="ev-save" data-id="${esc(id || '')}">${esc(t('Save'))}</button>
      ${id ? `<button class="btn ghost danger-text" data-act="ev-del" data-id="${esc(id)}">${icon('trash-2')}${esc(t('Delete'))}</button>` : ''}
    </div>`, { full: true });
}
export function saveEvent(id) {
  const title = $('#ev-title').value.trim();
  const type = $('#ev-type').value;
  if (!title) { toast(t('Give it a title'), 'err'); return; }
  const ev = {
    id: id || `e${Date.now()}`, type, title, subject: $('#ev-subj').value, date: uOfIso($('#ev-date').value), start: $('#ev-start').value, end: $('#ev-end').value,
    remind: $('#ev-remind').value, repeat: $('#ev-repeat').value, notes: $('#ev-notes').value.trim(), t: Date.now(),
  };
  setEvents([...myEvents().filter((x) => x.id !== ev.id), ev]);
  CAL.sel = fromUntisDate(ev.date);
  CAL.month = new Date(CAL.sel.getFullYear(), CAL.sel.getMonth(), 1);
  closeSheet();
  ctxCache.t = 0;
  render();
  reschedule();
  toast(examTypes.has(type) ? t('Saved. The AI now knows about this test.') : t('Saved'));
}
export async function deleteEvent(id) {
  if (!await uiConfirm(t('Delete this entry?'), { danger: true, ok: t('Delete') })) return;
  setEvents(myEvents().filter((x) => x.id !== id));
  closeSheet(); ctxCache.t = 0; render(); reschedule();
}
export function openEvent(id) {
  const e = [...myEvents(), ...read('icsevents', [])].find((x) => x.id === id);
  if (!e) return;
  const ty = EVENT_TYPES[e.type] || EVENT_TYPES.event;
  const d = fromUntisDate(e.date);
  const isExam = examTypes.has(e.type);
  openSheet(() => `<div class="ev-head" style="--c:${e.color || ty.color}"><span class="ev-ic">${icon(ty.icon)}</span><div><small>${esc(t(ty.label))}${e.subject ? ` · ${esc(subjLabel(e.subject))}` : ''}</small><h2>${esc(e.title)}</h2>
      <p>${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${e.start ? ` · ${esc(e.start)}${e.end ? `–${esc(e.end)}` : ''}` : ''} · ${esc(inDays(d))}</p></div></div>
    ${e.notes ? `<div class="card pad-card"><p>${esc(e.notes)}</p></div>` : ''}
    ${isExam ? `<div class="card">
      <button class="row" data-act="ai-exam" data-id="ev-${esc(e.id)}"><span class="row-ic tint" style="--c:#6e56cf">${icon('sparkles')}</span><span class="row-text"><b>${esc(t('Study with AI'))}</b><small>${esc(t('Explanations and practice questions'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
      <button class="row" data-act="plan-make" data-id="ev-${esc(e.id)}"><span class="row-ic tint" style="--c:#30a46c">${icon('list-checks')}</span><span class="row-text"><b>${esc(t('Make a study plan'))}</b></span>${icon('chevron-right', 'row-chev')}</button>
      <button class="row" data-act="ai-cards" data-id="ev-${esc(e.id)}"><span class="row-ic tint" style="--c:#f76b15">${icon('file-text')}</span><span class="row-text"><b>${esc(t('Flashcards as PDF'))}</b></span>${icon('chevron-right', 'row-chev')}</button></div>` : ''}
    ${e.readonly ? `<p class="hint center">${esc(t('From a subscribed calendar'))}</p>` : `<div class="card">
      <button class="row" data-act="ev-edit" data-id="${esc(e.id)}"><span class="row-ic">${icon('pencil')}</span><span class="row-text"><b>${esc(t('Edit'))}</b></span></button>
      <button class="row" data-act="ev-ics" data-id="${esc(e.id)}"><span class="row-ic">${icon('share-2')}</span><span class="row-text"><b>${esc(t('Share or add to another calendar'))}</b></span></button>
      <button class="row danger" data-act="ev-del" data-id="${esc(e.id)}"><span class="row-ic">${icon('trash-2')}</span><span class="row-text"><b>${esc(t('Delete'))}</b></span></button>
    </div>`}`);
}

// ---------------------------------------------------------------- notifications planned from the calendar (merged into data.buildEvents)
const dateAtMin = (u, hhmm) => { const d = fromUntisDate(u); const v = hm(hhmm); if (v != null) d.setHours(Math.floor(v / 100), v % 100, 0, 0); else d.setHours(8, 0, 0, 0); return d.getTime(); };
export function plannerEvents() {
  const out = [];
  const now = Date.now();
  const s = S.settings;
  let id = 3000;
  const today = startOfDay(new Date());
  for (let i = 0; i < 21; i++) {
    const du = toUntisDate(addDays(today, i));
    for (const e of eventsOn(du)) {
      if (e.remind === '' || e.remind == null) continue;
      const at = dateAtMin(du, e.start) - Number(e.remind) * 60000;
      if (at > now) out.push({ at, type: 'remind', id: id++, channel: 'planner', open: 'calendar', title: e.title, body: `${t((EVENT_TYPES[e.type] || EVENT_TYPES.event).label)} · ${fmt(fromUntisDate(du), { weekday: 'short', day: 'numeric', month: 'short' })}${e.start ? ` · ${e.start}` : ''}` });
    }
  }
  // "Have you studied for …?" before every exam/test
  if (s.studyCheckins !== false) {
    const days = String(s.checkinDays || '7,3,1').split(',').map(Number).filter((x) => x > 0);
    const answered = read('checkins', {});
    const exams = [...(S.exams || []), ...store.myExams(), ...calendarExams()];
    for (const ex of exams) {
      const exId = String(ex.id ?? `${ex.date}-${ex.subject}`);
      if (answered[exId]?.answer === 'yes') continue;
      for (const dd of days) {
        const at = addDays(fromUntisDate(ex.date), -dd); at.setHours(Number(s.checkinHour ?? 17), 0, 0, 0);
        if (at.getTime() <= now || at.getTime() - now > 21 * 86400000) continue;
        const subj = subjLabel(ex.subject) || ex.subject || t('Exam');
        out.push({ at: at.getTime(), type: 'checkin', exam: exId, title: t('Have you studied for {subject}?', { subject: subj }), body: t('{name} {when}. Not yet? Tap for a plan and help from the AI.', { name: ex.name || t('Test'), when: inDays(fromUntisDate(ex.date)) }), yes: t('Yes'), no: t('Not yet') });
      }
    }
  }
  return out;
}
/** Asks before a lesson whether it should be recorded (the Record button then records it even with the phone locked). */
export function recordAskEvents(days) {
  const s = S.settings;
  if (!s.recAsk) return [];
  const out = [];
  const now = Date.now();
  const subjects = s.recAskSubjects || [];
  for (const [u, list] of Object.entries(days)) {
    // one question per block of lessons in the same subject (double periods)
    const blocks = [];
    for (const l of list) {
      const k = l.subjects[0]?.name || '';
      const last = blocks[blocks.length - 1];
      if (last && last.k === k && l.start - last.end <= 20) { last.end = l.end; last.ids.push(l.id); } else blocks.push({ k, start: l.start, end: l.end, l, ids: [l.id] });
    }
    for (const b of blocks) {
      if (subjects.length && !subjects.includes(b.k)) continue;
      const start = dateAtMin(Number(u), `${Math.floor(b.start / 100)}:${pad(b.start % 100)}`);
      const end = dateAtMin(Number(u), `${Math.floor(b.end / 100)}:${pad(b.end % 100)}`);
      const at = start - Number(s.recAskMinutes ?? 3) * 60000;
      if (at <= now) continue;
      const name = subjLabel(b.k) || b.k;
      out.push({
        at, type: 'recask', start, end, recTitle: name, title: t('Record {subject}?', { subject: name }), body: t('Starts at {time}. Recording starts and stops by itself, even with the phone locked.', { time: fmtTime(b.start) }),
        yes: t('Record'), no: t('Not now'), meta: JSON.stringify({ subject: b.k, date: Number(u), start: b.start, end: b.end }),
      });
    }
  }
  return out;
}
async function reschedule() { try { (await import('./data.js')).scheduleNative(); } catch { /* not logged in */ } }

// ---------------------------------------------------------------- study check-ins (Home card + sheet)
export function dueCheckin() {
  if (S.settings.studyCheckins === false) return null;
  const answered = read('checkins', {});
  const days = String(S.settings.checkinDays || '7,3,1').split(',').map(Number).filter((x) => x > 0);
  const now = new Date();
  const exams = [...(S.exams || []), ...store.myExams(), ...calendarExams()].filter((e) => e.date >= toUntisDate(now)).sort((a, b) => a.date - b.date);
  for (const ex of exams) {
    const id = String(ex.id ?? `${ex.date}-${ex.subject}`);
    const left = daysBetween(startOfDay(now), fromUntisDate(ex.date));
    const a = answered[id];
    if (a?.answer === 'yes') continue;
    const window = Math.max(...days);
    if (left > window) continue;
    if (a?.snooze && a.snooze > Date.now()) continue;
    return { ex, id, left };
  }
  return null;
}
export function checkinCard() {
  const c = dueCheckin();
  if (!c) return '';
  const subj = subjLabel(c.ex.subject) || c.ex.subject || t('Exam');
  return `<div class="checkin"${stagger(1)}><span class="ci-ic">${icon('graduation-cap')}</span><div><b>${esc(t('Have you studied for {subject}?', { subject: subj }))}</b><small>${esc(`${c.ex.name || t('Test')} · ${inDays(fromUntisDate(c.ex.date))}`)}</small>
    <div class="ci-btns"><button class="chip" data-act="ci-yes" data-id="${esc(c.id)}">${icon('check')}${esc(t('Yes'))}</button><button class="chip ai-chip" data-act="ci-no" data-id="${esc(c.id)}">${icon('sparkles')}${esc(t('Not yet'))}</button><button class="chip" data-act="ci-later" data-id="${esc(c.id)}">${esc(t('Ask later'))}</button></div></div></div>`;
}
export function answerCheckin(id, answer) {
  const all = read('checkins', {});
  all[id] = answer === 'later' ? { snooze: Date.now() + 20 * 3600000 } : { answer, t: Date.now() };
  write('checkins', all);
  if (answer === 'yes') toast(t('Great! Want a quick quiz to check? Open the exam and tap Study with AI.'));
  if (answer === 'no') openStudyHelp(id);
  else render();
  reschedule();
}
/** "Not yet": suggestions to start learning with the AI. */
export async function openStudyHelp(id) {
  const ex = (await allExamsSafe()).concat(calendarExams()).find((e) => String(e.id ?? `${e.date}-${e.subject}`) === String(id));
  if (!ex) { render(); return; }
  const subj = subjLabel(ex.subject) || ex.subject || t('Exam');
  const left = daysBetween(startOfDay(new Date()), fromUntisDate(ex.date));
  openSheet(() => `<div class="setup-orb small">${icon('sparkles')}</div>
    <h2 class="sheet-title center">${esc(t('No problem, let\'s start now'))}</h2>
    <p class="hint center">${esc(t('{subject} · {name} {when}', { subject: subj, name: ex.name || t('Test'), when: inDays(fromUntisDate(ex.date)) }))}</p>
    <div class="card">
      <button class="row" data-act="plan-make" data-id="${esc(id)}"><span class="row-ic tint" style="--c:#30a46c">${icon('list-checks')}</span><span class="row-text"><b>${esc(t('Make a study plan'))}</b><small>${esc(left > 1 ? t('{n} days, 20–45 minutes a day', { n: left }) : t('A focused plan for today'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
      <button class="row" data-act="ai-exam" data-id="${esc(id)}"><span class="row-ic tint" style="--c:#6e56cf">${icon('message-square')}</span><span class="row-text"><b>${esc(t('Explain the topics to me'))}</b><small>${esc(t('Step by step, from your lesson summaries'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
      <button class="row" data-act="ai-quiz" data-id="${esc(id)}"><span class="row-ic tint" style="--c:#d6409f">${icon('lightbulb')}</span><span class="row-text"><b>${esc(t('Quiz me'))}</b><small>${esc(t('10 practice questions'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
      <button class="row" data-act="ai-cards" data-id="${esc(id)}"><span class="row-ic tint" style="--c:#f76b15">${icon('file-text')}</span><span class="row-text"><b>${esc(t('Flashcards as PDF'))}</b><small>${esc(t('To print or learn on the go'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
      <button class="row" data-act="ev-add-study" data-id="${esc(id)}"><span class="row-ic tint" style="--c:#4f6bff">${icon('calendar-plus')}</span><span class="row-text"><b>${esc(t('Block study time in my calendar'))}</b><small>${esc(t('Today at 17:00, with a reminder'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
    </div>`);
}
export function blockStudyTime(id) {
  allExamsSafe().then((list) => {
    const ex = list.concat(calendarExams()).find((e) => String(e.id ?? `${e.date}-${e.subject}`) === String(id));
    const title = `${t('Study')}: ${subjLabel(ex?.subject) || ex?.subject || ''}`.trim();
    const today = toUntisDate(new Date());
    setEvents([...myEvents(), { id: `e${Date.now()}`, type: 'reminder', title, subject: ex?.subject || '', date: today, start: '17:00', end: '17:45', remind: '0', repeat: 'none', notes: ex?.name || '', t: Date.now() }]);
    closeSheet(); toast(t('Added to your calendar')); reschedule();
  });
}

// ---------------------------------------------------------------- AI names for holidays
export function applyHolidayNames() {
  const names = read('holnames', {});
  for (const h of S.holidays || []) {
    if (!h.raw) h.raw = h.name;
    const n = names[`${h.start}-${h.end}-${h.raw}`];
    if (n) h.name = n;
  }
}
let naming = false;
export async function nameHolidaysWithAI() {
  if (naming || S.settings.aiHolidayNames === false || !(S.holidays || []).length) return;
  const { aiReady, complete, LANG_NAME } = await import('./ai.js');
  if (!aiReady()) return;
  const names = read('holnames', {});
  const todo = (S.holidays || []).filter((h) => !names[`${h.start}-${h.end}-${h.raw || h.name}`]).slice(0, 30);
  if (!todo.length) return;
  naming = true;
  try {
    const lang = LANG_NAME[S.settings.lang] || 'German';
    const list = todo.map((h, i) => `${i}. "${h.raw || h.name}" from ${h.start} to ${h.end}`).join('\n');
    const out = await complete({ feature: 'chat', json: true, temperature: 0.2, messages: [{ role: 'user', text: `These are school holidays and free days from a German school timetable (dates as YYYYMMDD). Give each one its proper, friendly name in ${lang} (e.g. "Herbstferien", "Tag der Deutschen Einheit", "Weihnachtsferien", "Beweglicher Ferientag"). Keep official names. Return ONLY JSON: {"names": ["…", …]} in the same order.\n\n${list}` }] });
    const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    (j.names || []).forEach((n, i) => { if (todo[i] && n) names[`${todo[i].start}-${todo[i].end}-${todo[i].raw || todo[i].name}`] = String(n).slice(0, 60); });
    write('holnames', names);
    applyHolidayNames();
    if (S.api) render();
  } catch { /* keep WebUntis names */ } finally { naming = false; }
}

// ---------------------------------------------------------------- notification targets and background recordings
export async function handleLaunch() {
  if (!hasNative()) return;
  const { target } = await native.takeLaunch();
  const { log } = await native.takeCheckins();
  if (log && Object.keys(log).length) {
    const all = read('checkins', {});
    for (const [k, v] of Object.entries(log)) all[k] = { answer: v, t: Date.now() };
    write('checkins', all);
  }
  await intakeRecordings();
  if (!target) return;
  if (target === 'calendar') setView('calendar', 'left');
  else if (target === 'recorder' || target === 'rec') setView('recorder', 'left');
  else if (target === 'today') setView('today');
  else if (target.startsWith('checkin:')) { setView('today'); setTimeout(() => openStudyHelp(target.slice(8)), 400); }
}
/** Recordings made while the app was closed get summarized now. */
export async function intakeRecordings() {
  const { items } = await native.takeRecordings();
  if (!items?.length) return;
  const { processSummary } = await import('./features.js');
  for (const r of items) {
    let meta = {};
    try { meta = JSON.parse(r.meta || '{}'); } catch { /* ignore */ }
    const item = { id: `s${r.t}`, t: r.t, subject: meta.subject || '', lessonKey: '', date: meta.date || toUntisDate(new Date()), durationMs: r.duration || 0, path: r.path, mime: /\.mp3$/.test(r.path) ? 'audio/mpeg' : /\.webm$/.test(r.path) ? 'audio/webm' : 'audio/mp4', status: 'pending' };
    if (store.summaries().some((x) => x.id === item.id)) continue;
    store.setSummaries([...store.summaries(), item]);
    processSummary(item.id);
  }
}
