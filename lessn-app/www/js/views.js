// Main screens: Home (today), Week, Homework, Exams, and the lesson detail sheet.
import {
  S, t, esc, icon, fmt, fmtTime, durText, relDay, inDays, sameDay, addDays, mondayOf, daysBetween, nowMin, weekNumber,
  toUntisDate, fromUntisDate, subjKey, subjName, subjLabel, colorFor, PALETTE, hash, store, emptyState, skeleton, badge,
  stagger, openSheet, seg,
} from './core.js';
import { allHomework, hwDoneAny, homeExtras, examId } from './assist.js';
import { calendarExams } from './planner.js';
import {
  weekData, prepareDay, changes, isChanged, periodLabel, holidayFor, nextHoliday, visibleDays, timegridFor,
} from './data.js';

const placeText = (list) => list.map((r) => {
  const name = S.settings.teacherLongNames ? r.long : r.name;
  return r.orig ? `<s>${esc(r.orig)}</s> <b class="chg">${esc(name)}</b>` : esc(name);
}).join(', ');
const roomText = (l) => l.rooms.map((r) => (r.orig ? `<s>${esc(r.orig)}</s> <b class="chg">${esc(r.name)}</b>` : esc(r.name))).join(', ');
export const noteKey = (l) => `${subjKey(l)}|${l.date}|${l.start}`;

// ---------------------------------------------------------------- homework & exams per lesson
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
/** Does a homework/exam subject (short code, long name or IServ tag) belong to this lesson? */
function sameSubject(subject, l) {
  const n = norm(subject);
  if (!n) return false;
  const su = l.subjects[0];
  const names = [subjKey(l), su?.name, su?.long, S.settings.subjectNames[subjKey(l)]].map(norm).filter(Boolean);
  return names.some((x) => x === n || (n.length >= 3 && (x.startsWith(n) || n.startsWith(x))));
}
/** Homework due in / given in this lesson and exams written in it. */
export function lessonExtras(l) {
  const ids = l.ids || [l.id];
  const all = allHomework();
  const due = all.filter((h) => h.due === l.date && sameSubject(h.subject, l));
  const given = all.filter((h) => h.date === l.date && h.due !== l.date && sameSubject(h.subject, l));
  const exams = allExams().filter((e) => e.date === l.date && (
    (e.start && e.end ? e.start < l.end && e.end > l.start && (!e.subject || sameSubject(e.subject, l) || !l.subjects.length) : sameSubject(e.subject, l))
  ));
  if (l.type === 'ex' && !exams.length) exams.push({ id: `lesson-${ids[0]}`, subject: subjKey(l), date: l.date, start: l.start, end: l.end, name: l.info || l.text || t('Exam'), fromLesson: true });
  return { due, open: due.filter((h) => !hwDoneAny(h)), given, exams };
}
function extraBadges(x) {
  const out = [];
  if (x.exams.length) out.push({ cls: 'exm', icon: 'graduation-cap', text: x.exams.map((e) => e.name || e.type || t('Exam')).join(', ').slice(0, 40) });
  if (x.due.length) out.push({ cls: x.open.length ? 'hwb' : 'ok', icon: x.open.length ? 'clipboard-list' : 'circle-check', text: x.open.length ? t('Homework due') : t('Homework done') });
  return out;
}

// ---------------------------------------------------------------- lesson rows
function lessonCard(l, i) {
  const s = S.settings;
  const color = colorFor(subjKey(l));
  const p = periodLabel(l);
  const extras = lessonExtras(l);
  const ch = [...extraBadges(extras), ...changes(l).filter((b) => !(l.code === 'cancelled' && b.cls === 'bad') && !(b.cls === 'exm' && extras.exams.length))];
  if (l.units > 1) ch.unshift({ cls: 'soft', icon: 'layers', text: t('Double period') });
  const meta = [];
  if (s.showRoom && l.rooms.length) meta.push(`<span>${icon('map-pin')}${roomText(l)}</span>`);
  if (s.showTeacher && l.teachers.length) meta.push(`<span>${icon('user')}${placeText(l.teachers)}</span>`);
  if (l.group && !l.subjects.length) meta.push(`<span>${icon('users')}${esc(l.group)}</span>`);
  const note = store.notes()[noteKey(l)];
  const hasSummary = store.summaries().some((x) => x.lessonKey === noteKey(l));
  const info = [l.subst, l.info].filter(Boolean).join(' · ');
  const cancelled = l.code === 'cancelled';
  return `<button class="lesson ${cancelled ? 'cancelled' : ''} ${extras.exams.length ? 'has-exam' : ''} ${isChanged(l) ? 'changed' : ''} ${l.chainPrev ? 'chain-prev' : ''} ${l.chainNext ? 'chain-next' : ''}" data-act="lesson" data-id="${l.id}" style="--c:${color};--i:${Math.min(i, 14)}">
    <div class="l-time"><b>${fmtTime(l.start)}</b><span>${fmtTime(l.end)}</span>${p ? `<em>${esc(p)}</em>` : ''}</div>
    <div class="l-bar"></div>
    <div class="l-body">
      <div class="l-title"><span>${esc(subjName(l))}</span>${note ? icon('sticky-note', 'mini') : ''}${hasSummary ? icon('sparkles', 'mini') : ''}</div>
      ${meta.length ? `<div class="l-meta">${meta.join('')}</div>` : ''}
      ${ch.length ? `<div class="badges">${ch.map(badge).join('')}</div>` : ''}
      ${extras.open.length ? `<div class="l-hw">${icon('clipboard-list')}<span>${esc(extras.open.map((h) => h.text.split('\n')[0]).join(' · ').slice(0, 120))}</span></div>` : ''}
      ${l.breakMin ? `<div class="l-sub">${icon('coffee')}${esc(t('incl. {m} min break', { m: l.breakMin }))}</div>` : ''}
      ${info ? `<div class="l-info">${icon('info')}<span>${esc(info)}</span></div>` : ''}
    </div>
    ${cancelled ? `<div class="cancel-tag">${icon('ban')}${esc(t('Cancelled'))}</div>` : ''}
  </button>`;
}

function gapRow(from, to, i) {
  const m = to - from;
  if (m < 5 || !S.settings.showBreaks) return '';
  const free = m >= 40;
  return `<div class="gap ${free ? 'free' : ''}"${stagger(i)}>${icon(free ? 'sunrise' : 'coffee')}<span>${esc(free ? t('Free period') : t('Break'))} · ${durText(m)}</span></div>`;
}

function lessonList(list) {
  const rows = [];
  let i = 0;
  let chain = null;
  let chainColor = '';
  const flush = () => { if (chain) { rows.push(`<div class="chain" style="--c:${chainColor};--i:${Math.min(i, 14)}">${chain.join('')}</div>`); chain = null; } };
  list.forEach((l, idx) => {
    if (idx > 0 && !l.chainPrev) {
      const prevEnd = Math.max(0, ...list.slice(0, idx).filter((x) => x.code !== 'cancelled').map((x) => x.end));
      if (prevEnd && l.code !== 'cancelled' && l.start > prevEnd) { flush(); rows.push(gapRow(prevEnd, l.start, i++)); }
    }
    if (l.chainPrev && chain) {
      const prev = list.find((x) => x.id === l.chainPrev);
      const gap = prev ? l.start - prev.end : 0;
      chain.push(`<div class="link">${gap >= 5 ? `<span>${icon('coffee')}${durText(gap)}</span>` : ''}</div>`);
      chain.push(lessonCard(l, i));
      if (!l.chainNext) flush();
      return;
    }
    flush();
    if (l.chainNext) { chainColor = colorFor(subjKey(l)); chain = [lessonCard(l, i++)]; return; }
    rows.push(lessonCard(l, i++));
  });
  flush();
  return rows.join('');
}

// ---------------------------------------------------------------- home cards
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
    return `<div class="now-card hero" style="--c:${colorFor(subjKey(cur))}" data-act="lesson" data-id="${cur.id}">
      <div class="now-top"><span class="live"></span>${esc(t('Now'))}${periodLabel(cur) ? ` · ${esc(t('Period'))} ${esc(periodLabel(cur))}` : ''}</div>
      <div class="now-title">${esc(subjName(cur))}</div>
      <div class="now-meta">${where(cur)}</div>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="now-foot"><span>${fmtTime(cur.start)} – ${fmtTime(cur.end)}</span>${s.showCountdown ? `<b>${esc(t('{t} left', { t: durText(cur.end - n) }))}</b>` : ''}</div>
      <div class="now-next">${icon(next ? 'chevron-right' : 'sparkles')}<span>${next ? `${esc(t('Next'))} <b>${esc(subjName(next))}</b> · ${fmtTime(next.start)}${next.rooms.length && s.showRoom ? ` · ${roomText(next)}` : ''}` : esc(t('Last lesson today'))}</span></div>
    </div>`;
  }
  if (next) {
    const first = next === active[0];
    const prevEnd = Math.max(0, ...active.filter((l) => l.end <= n).map((l) => l.end));
    const free = !first && n - prevEnd >= 40;
    const label = first ? t('School starts') : free ? t('Free period') : t('Break');
    return `<div class="now-card soft" style="--c:${colorFor(subjKey(next))}" data-act="lesson" data-id="${next.id}">
      <div class="now-top">${icon(first || free ? 'sunrise' : 'coffee')}${esc(label)}${s.showCountdown ? ` · ${esc(t('in {t}', { t: durText(next.start - n) }))}` : ''}</div>
      <div class="now-title">${esc(subjName(next))}</div>
      <div class="now-meta"><span>${icon('clock')}${fmtTime(next.start)} – ${fmtTime(next.end)}</span>${where(next)}</div>
    </div>`;
  }
  const last = active[active.length - 1];
  return `<div class="now-card done"><div class="now-top">${icon('sparkles')}${esc(t('Done for today'))}</div>
    <div class="now-title">${esc(t('School ended at {t}', { t: fmtTime(last.end) }))}</div>${tomorrowHint()}</div>`;
}

function tomorrowHint() {
  let d = addDays(S.day, 1);
  for (let i = 0; i < 7; i++, d = addDays(d, 1)) {
    const data = weekData(mondayOf(d));
    if (!data) return '';
    const list = prepareDay(data, d).filter((l) => l.code !== 'cancelled');
    if (list.length) return `<div class="now-meta"><span>${icon('calendar')}${esc(t('{day} starts at {t} with {s}', { day: relDay(d), t: fmtTime(list[0].start), s: subjName(list[0]) }))}</span></div>`;
  }
  return '';
}

function holidayHero(date) {
  const h = holidayFor(date);
  const fmtR = (x) => `${fmt(fromUntisDate(x.start), { day: 'numeric', month: 'short' })}${x.end !== x.start ? ` – ${fmt(fromUntisDate(x.end), { day: 'numeric', month: 'short' })}` : ''}`;
  if (h) {
    const left = daysBetween(date, fromUntisDate(h.end)) + 1;
    return `<div class="holiday-hero pop">
      <div class="hh-ic">${icon('sun')}</div>
      <div class="hh-body"><small>${esc(t('Holiday'))}</small><h3>${esc(h.name)}</h3><p>${esc(fmtR(h))} · ${esc(left === 1 ? t('last day') : t('{n} days left', { n: left }))}</p></div>
    </div>`;
  }
  if (!sameDay(date, new Date())) return '';
  const nh = nextHoliday();
  if (!nh) return '';
  const n = daysBetween(new Date(), fromUntisDate(nh.start));
  if (n > 21 || n < 1) return '';
  return `<div class="holiday-soon"${stagger(0)}>${icon('sun')}<span><b>${esc(nh.name)}</b> ${esc(inDays(fromUntisDate(nh.start)))}</span><em>${n}</em></div>`;
}

function newsCards() {
  if (!S.news?.length) return '';
  return `<div class="section-title">${icon('megaphone')}${esc(t('Announcements'))}</div>${S.news.map((m, i) => `
    <button class="news" data-act="news" data-i="${i}"${stagger(i)}>
      <div class="news-ic">${icon('megaphone')}</div>
      <div class="news-body">${m.subject ? `<b>${esc(m.subject)}</b>` : ''}<p>${esc(m.text)}</p></div>
    </button>`).join('')}`;
}

function iservPreview() {
  const d = S.iservData;
  if (!d || !store.iserv()) return '';
  const unreadMail = (d.mail || []).filter((m) => !m.seen).length;
  const notes = (d.notifications || []).filter((n) => !n.read).length;
  if (!unreadMail && !notes) return '';
  return `<button class="iserv-strip" data-act="nav" data-view="iserv"${stagger(2)}>
    <span class="row-ic">${icon('school')}</span>
    <span class="row-text"><b>IServ</b><small>${[notes ? t('{n} new notifications', { n: notes }) : '', unreadMail ? t('{n} unread emails', { n: unreadMail }) : ''].filter(Boolean).join(' · ')}</small></span>
    ${icon('chevron-right', 'row-chev')}
  </button>`;
}

function upcomingExams() {
  const list = allExams().filter((e) => { const n = daysBetween(new Date(), fromUntisDate(e.date)); return n >= 0 && n <= 7; });
  if (!list.length) return '';
  return `<div class="section-title">${icon('graduation-cap')}${esc(t('Exams this week'))}</div><div class="mini-exams">${list.map((e, i) => {
    const d = fromUntisDate(e.date);
    return `<button class="mini-exam" data-act="nav" data-view="exams" style="--c:${colorFor(e.subject)};--i:${i}"><b>${esc(subjLabel(e.subject) || e.name)}</b><span>${esc(relDay(d))}</span></button>`;
  }).join('')}</div>`;
}

// ---------------------------------------------------------------- Home
function dayStrip() {
  const today = new Date();
  const data = weekData(S.week) || [];
  return `<div class="strip">${visibleDays(S.week).map((d) => {
    const u = toUntisDate(d);
    const day = prepareDay(data, d);
    const cancelled = day.filter((l) => l.code === 'cancelled').length;
    const ch = day.some((l) => isChanged(l) && l.code !== 'cancelled');
    const hol = holidayFor(d);
    return `<button class="dpill ${sameDay(d, S.day) ? 'sel' : ''} ${sameDay(d, today) ? 'today' : ''} ${hol ? 'hol' : ''}" data-act="day" data-d="${u}">
      <span>${esc(fmt(d, { weekday: 'short' }))}</span><b>${d.getDate()}</b>
      <i class="${cancelled ? 'bad' : ch ? 'on' : ''}">${hol ? icon('sun') : cancelled > 1 ? cancelled : ''}</i></button>`;
  }).join('')}<div class="strip-ind"></div></div>`;
}

export function viewToday() {
  const data = weekData(S.week);
  const isToday = sameDay(S.day, new Date());
  let body;
  const hol = holidayFor(S.day);
  if (!data) body = skeleton(5);
  else {
    const list = prepareDay(data, S.day);
    const cancelled = list.filter((l) => l.code === 'cancelled');
    const real = list.filter((l) => l.code !== 'cancelled');
    const top = `${holidayHero(S.day)}
      ${cancelled.length ? `<div class="cancel-alert pop">${icon('ban')}<span><b>${esc(cancelled.length === 1 ? t('1 lesson cancelled') : t('{n} lessons cancelled', { n: cancelled.length }))}</b>${esc(cancelled.map((l) => subjName(l, true)).join(', '))}</span></div>` : ''}
      ${isToday ? nowCard(list) : ''}
      ${isToday ? homeExtras() + newsCards() : ''}`;
    if (!list.length) {
      body = top + (hol ? '' : emptyState('coffee', t('No lessons'), t('Nothing scheduled for this day.')));
    } else {
      const summary = real.length
        ? `${real.length === 1 ? t('1 lesson') : t('{n} lessons', { n: real.length })} · ${fmtTime(real[0].start)} – ${fmtTime(Math.max(...real.map((l) => l.end)))}`
        : t('All lessons cancelled');
      body = `${top}
        <div class="day-head"><h2>${esc(fmt(S.day, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2><span>${esc(summary)}</span></div>
        <div class="lessons">${lessonList(list)}</div>`;
    }
    if (isToday) body += upcomingExams();
  }
  return `${dayStrip()}<div class="pad swipe-area">${body}</div>`;
}

// ---------------------------------------------------------------- Week grid
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
  if (n === 0) return t('This week');
  if (n === 1) return t('Next week');
  if (n === -1) return t('Last week');
  return n > 0 ? t('In {n} weeks', { n }) : t('{n} weeks ago', { n: -n });
}

export function viewWeek() {
  const s = S.settings;
  const data = weekData(S.week);
  const days = visibleDays(S.week);
  const end = days[days.length - 1];
  const nav = `<div class="week-nav">
    <button class="icon-btn" data-act="week-prev" aria-label="${esc(t('Previous week'))}">${icon('chevron-left')}</button>
    <div class="week-label"><b>${esc(fmt(S.week, { day: 'numeric', month: 'short' }))} – ${esc(fmt(end, { day: 'numeric', month: 'short' }))}</b><span>${esc(weekRel())}</span></div>
    <button class="icon-btn" data-act="week-next" aria-label="${esc(t('Next week'))}">${icon('chevron-right')}</button></div>
    <div class="week-tools">${seg('weekLayout', [['list', t('List')], ['grid', t('Grid')]], s.weekLayout === 'grid' ? 'grid' : 'list')}</div>`;
  if (!data) return nav + `<div class="pad">${skeleton(6)}</div>`;
  if (s.weekLayout !== 'grid') return nav + weekList(days, data);

  const units = timegridFor(S.week);
  const perDay = days.map((d) => prepareDay(data, d));
  const all = perDay.flat();
  let min = units.length ? units[0].start : 8 * 60;
  let max = units.length ? units[units.length - 1].end : 16 * 60;
  if (all.length) { min = Math.min(min, ...all.map((l) => l.start)); max = Math.max(max, ...all.map((l) => l.end)); }
  const ppm = s.density === 'compact' ? 0.95 : 1.25;
  const H = Math.ceil((max - min) * ppm);
  const today = new Date();

  const head = days.map((d) => {
    const hol = holidayFor(d);
    return `<div class="wk-day ${sameDay(d, today) ? 'today' : ''} ${hol ? 'hol' : ''}" data-act="goto-day" data-d="${toUntisDate(d)}"><span>${esc(fmt(d, { weekday: 'short' }))}</span><b>${d.getDate()}</b></div>`;
  }).join('');
  const bands = units.map((u, i) => `<div class="wk-band ${i % 2 ? 'alt' : ''}" style="top:${(u.start - min) * ppm}px;height:${(u.end - u.start) * ppm}px"></div>`).join('');
  const axis = units.map((u) => `<div class="wk-tick" style="top:${(u.start - min) * ppm}px"><b>${esc(u.name)}</b><span>${fmtTime(u.start)}</span></div>`).join('')
    || Array.from({ length: Math.ceil((max - min) / 60) }, (_, i) => `<div class="wk-tick" style="top:${i * 60 * ppm}px"><span>${fmtTime(min + i * 60)}</span></div>`).join('');

  let bi = 0;
  const cols = days.map((d, di) => {
    const list = perDay[di];
    const hol = holidayFor(d);
    layoutCols(list);
    const blocks = list.map((l) => {
      const top = (l.start - min) * ppm;
      const next = l.chainNext ? list.find((x) => x.id === l.chainNext) : null;
      const bottom = next ? (next.start - min) * ppm : (l.end - min) * ppm - 3;
      const h = Math.max(18, bottom - top);
      const color = colorFor(subjKey(l));
      const name = s.subjectShortInGrid ? subjName(l, true) : subjName(l);
      const ex = lessonExtras(l);
      const marks = `${ex.exams.length ? `<i class="mk mk-ex">${icon('graduation-cap')}</i>` : ''}${ex.open.length ? `<i class="mk mk-hw">${icon('clipboard-list')}</i>` : ''}`;
      const lines = [];
      if (l.code === 'cancelled' && h > 34) lines.push(`<span class="x">${esc(t('Cancelled'))}</span>`);
      else if (l.replaces?.length && h > 34) lines.push(`<span class="chg-l">${esc(t('Substitution'))}</span>`);
      else if (s.showRoom && l.rooms.length && h > 34) lines.push(`<span>${roomText(l)}</span>`);
      if (s.showTeacher && l.teachers.length && h > 52 && l.code !== 'cancelled') lines.push(`<span>${placeText(l.teachers)}</span>`);
      return `<button class="blk ${l.code === 'cancelled' ? 'cancelled' : ''} ${isChanged(l) ? 'changed' : ''} ${l.type === 'ex' || ex.exams.length ? 'is-exam' : ''} ${l.chainPrev ? 'chain-prev' : ''} ${l.chainNext ? 'chain-next' : ''}" data-act="lesson" data-id="${l.id}"
        style="--c:${color};--i:${Math.min(bi++, 30)};top:${top}px;height:${h}px;left:calc(${(l._col / l._n) * 100}% + 2px);width:calc(${100 / l._n}% - 4px)">
        <b>${l.code === 'cancelled' ? icon('ban', 'mini') : ''}${esc(name)}</b>${lines.join('')}${marks ? `<span class="mks">${marks}</span>` : ''}</button>`;
    }).join('');
    const nowLine = s.showNowLine && sameDay(d, today) && nowMin() >= min && nowMin() <= max ? `<div class="now-line" style="top:${(nowMin() - min) * ppm}px"></div>` : '';
    const holTag = hol && !list.length ? `<div class="wk-hol">${icon('sun')}<span>${esc(hol.name)}</span></div>` : '';
    return `<div class="wk-col ${sameDay(d, today) ? 'today' : ''}">${holTag}${blocks}${nowLine}</div>`;
  }).join('');

  const hols = [...new Set(days.map((d) => holidayFor(d)).filter(Boolean))];
  return `${nav}${hols.map((h) => `<div class="holiday-soon wk-holbar">${icon('sun')}<span><b>${esc(h.name)}</b> ${esc(fmt(fromUntisDate(h.start), { day: 'numeric', month: 'short' }))} – ${esc(fmt(fromUntisDate(h.end), { day: 'numeric', month: 'short' }))}</span></div>`).join('')}
  <div class="wk swipe-area" style="--n:${days.length}">
    <div class="wk-head"><div class="wk-corner">${esc(String(weekNumber(S.week)))}</div>${head}</div>
    <div class="wk-body" style="height:${H + 8}px"><div class="wk-axis">${axis}</div><div class="wk-grid">${bands}${cols}</div></div>
  </div>
  ${all.length || hols.length ? '' : `<div class="pad">${emptyState('calendar', t('No lessons this week'))}</div>`}`;
}

/** Agenda-style week: one card per day with its lessons. */
function weekList(days, data) {
  const today = new Date();
  let i = 0;
  const html = days.map((d) => {
    const list = prepareDay(data, d);
    const hol = holidayFor(d);
    const real = list.filter((l) => l.code !== 'cancelled');
    const cancelled = list.length - real.length;
    return `<div class="wl-day ${sameDay(d, today) ? 'today' : ''}"${stagger(i++)}>
      <button class="wl-head" data-act="goto-day" data-d="${toUntisDate(d)}">
        <span class="wl-date"><b>${d.getDate()}</b><span>${esc(fmt(d, { weekday: 'short' }))}</span></span>
        <span class="wl-sum"><b>${esc(fmt(d, { weekday: 'long' }))}</b><small>${hol && !list.length ? esc(hol.name) : real.length ? `${esc(real.length === 1 ? t('1 lesson') : t('{n} lessons', { n: real.length }))} · ${fmtTime(real[0].start)}–${fmtTime(Math.max(...real.map((l) => l.end)))}` : esc(t('No lessons'))}</small></span>
        ${cancelled ? `<span class="badge bad">${icon('ban')}${cancelled}</span>` : ''}${hol ? `<span class="badge warn">${icon('sun')}</span>` : ''}${icon('chevron-right', 'row-chev')}
      </button>
      ${list.length ? `<div class="wl-lessons">${list.map((l) => `<button class="wl-l ${l.code === 'cancelled' ? 'cancelled' : ''} ${isChanged(l) && l.code !== 'cancelled' ? 'changed' : ''}" data-act="lesson" data-id="${l.id}" style="--c:${colorFor(subjKey(l))}">
        <span class="wl-t">${fmtTime(l.start)}</span><i class="wl-bar"></i>
        <span class="wl-n">${esc(subjName(l))}${l.units > 1 ? ` <em>×${l.units}</em>` : ''}${(() => { const ex = lessonExtras(l); return `${ex.exams.length ? `<b class="wl-mk ex">${icon('graduation-cap')}${esc(t('Exam'))}</b>` : ''}${ex.open.length ? `<b class="wl-mk hw">${icon('clipboard-list')}</b>` : ''}`; })()}</span>
        <span class="wl-r">${l.code === 'cancelled' ? `<b class="bad">${esc(t('Cancelled'))}</b>` : l.replaces?.length ? `<b class="chg">${esc(t('Substitution'))}</b>` : roomText(l)}</span>
      </button>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="pad swipe-area">${html}</div>`;
}

// ---------------------------------------------------------------- Homework
export function hwDone(h) { return hwDoneAny(h.key ? h : { ...h, key: `u${h.id}`, source: 'untis' }); }

const SRC_ICON = { untis: '', mine: 'user', iserv: 'school' };
export function viewTasks() {
  const chips = seg('hwFilter', [['open', t('To do')], ['done', t('Done')], ['all', t('All')]], S.hwFilter, 'hw-filter');
  const fab = `<button class="fab" data-act="hw-add" aria-label="${esc(t('Add homework'))}">${icon('plus')}</button>`;
  const all = allHomework();
  if (!S.homework && !all.length) return `<div class="chips">${chips}</div><div class="pad">${skeleton(4)}${fab}</div>`;
  const today = toUntisDate(new Date());
  let list = all.slice().sort((a, b) => a.due - b.due);
  if (S.hwFilter === 'open') list = list.filter((h) => !hwDoneAny(h));
  else if (S.hwFilter === 'done') list = list.filter(hwDoneAny).reverse();
  const open = all.filter((h) => !hwDoneAny(h) && h.due >= today).length;
  if (!list.length) {
    return `<div class="chips">${chips}</div><div class="pad">${S.hwFilter === 'open' ? emptyState('circle-check', t('All caught up'), t('No open homework. Tap + to add your own.')) : emptyState('clipboard-list', t('Nothing here'))}${fab}</div>`;
  }
  const groups = {};
  list.forEach((h) => { (groups[h.due] ||= []).push(h); });
  let i = 0;
  const html = Object.entries(groups).map(([due, items]) => {
    const d = fromUntisDate(Number(due));
    const overdue = Number(due) < today;
    return `<div class="group"><div class="group-head ${overdue ? 'bad' : ''}"${stagger(i++)}><b>${esc(relDay(d))}</b><span>${esc(fmt(d, { day: 'numeric', month: 'short' }))}</span></div>
      ${items.map((h) => {
        const done = hwDoneAny(h);
        return `<div class="hw ${done ? 'done' : ''} ${overdue && !done ? 'overdue' : ''}" style="--c:${colorFor(h.subject)};--i:${Math.min(i++, 14)}">
          <button class="check" data-act="hw-check" data-key="${esc(h.key)}" aria-label="${esc(t('Mark as done'))}">${icon('check')}</button>
          <button class="hw-body" data-act="hw-open" data-key="${esc(h.key)}"><div class="hw-subj">${SRC_ICON[h.source] ? icon(SRC_ICON[h.source], 'mini') : ''}${esc(subjLabel(h.subject) || (h.source === 'iserv' ? t('IServ task') : t('Homework')))}</div>
            <div class="hw-text">${esc(h.text)}</div>
            ${h.remark ? `<div class="hw-remark">${esc(h.remark)}</div>` : ''}
            <div class="hw-meta">${h.date ? esc(t('Given {d}', { d: fmt(fromUntisDate(h.date), { day: 'numeric', month: 'short' }) })) : ''}${h.teacher ? ` · ${esc(h.teacher)}` : ''}${h.attachments.length ? ` · ${h.attachments.length} ${esc(t('attachments'))}` : ''}</div>
          </button>
          <button class="hw-ai" data-act="ai-homework" data-key="${esc(h.key)}" aria-label="${esc(t('Get help from AI'))}">${icon('sparkles')}</button></div>`;
      }).join('')}</div>`;
  }).join('');
  return `<div class="chips">${chips}<span class="chip-note">${esc(t('{n} open', { n: open }))}</span></div><div class="pad">${html}${fab}</div>`;
}

// ---------------------------------------------------------------- Exams
export function allExams() {
  const mine = store.myExams().map((e) => ({ ...e, mine: true }));
  return [...(S.exams || []), ...mine, ...calendarExams().map((e) => ({ ...e, mine: true }))];
}

function examCard(e, past, i) {
  const d = fromUntisDate(e.date);
  const n = daysBetween(new Date(), d);
  const urgent = !past && n <= 3;
  const rooms = (e.rooms || []).map((r) => (typeof r === 'string' ? r : r.name)).join(', ');
  const teachers = (e.teachers || []).map((r) => (typeof r === 'string' ? r : r.name)).join(', ');
  return `<div class="exam ${past ? 'past' : ''} ${urgent ? 'urgent' : ''}" data-act="exam-open" data-id="${esc(examId(e))}" style="--c:${colorFor(e.subject)};--i:${Math.min(i, 14)}">
    <div class="exam-date"><b>${d.getDate()}</b><span>${esc(fmt(d, { month: 'short' }))}</span></div>
    <div class="exam-body">
      <div class="exam-top"><span class="exam-subj">${esc(subjLabel(e.subject) || t('Exam'))}</span>${past ? (e.grade ? badge({ cls: 'ok', icon: 'star', text: e.grade }) : '') : badge({ cls: urgent ? 'bad' : 'soft', icon: 'timer', text: inDays(d) })}</div>
      <div class="exam-name">${esc(e.name || e.type || t('Exam'))}</div>
      <div class="l-meta">${e.start ? `<span>${icon('clock')}${fmtTime(e.start)} – ${fmtTime(e.end)}</span>` : ''}${rooms ? `<span>${icon('map-pin')}${esc(rooms)}</span>` : ''}${teachers ? `<span>${icon('user')}${esc(teachers)}</span>` : ''}</div>
      ${e.text ? `<div class="l-info">${icon('info')}<span>${esc(e.text)}</span></div>` : ''}
      ${e.mine ? `<div class="exam-foot">${badge({ cls: 'soft', icon: 'sparkles', text: t('From lesson summary') })}<button class="link-btn" data-act="del-myexam" data-id="${esc(e.id)}">${icon('trash-2')}</button></div>` : ''}
    </div></div>`;
}

export function viewExams() {
  if (!S.exams && !store.myExams().length) return `<div class="pad">${skeleton(4)}</div>`;
  const all = allExams();
  const today = toUntisDate(new Date());
  const up = all.filter((e) => e.date >= today).sort((a, b) => a.date - b.date || (a.start || 0) - (b.start || 0));
  const past = all.filter((e) => e.date < today).sort((a, b) => b.date - a.date);
  if (!all.length) return `<div class="pad">${emptyState('graduation-cap', t('No exams'), t('Nothing announced yet.'))}</div>`;
  return `<div class="pad">
    ${up.length ? `<div class="section-title">${esc(t('Upcoming'))} · ${up.length}</div>${up.map((e, i) => examCard(e, false, i)).join('')}` : emptyState('shield-check', t('No upcoming exams'))}
    ${past.length ? `<details class="past"><summary>${icon('chevron-down')}${esc(t('Past exams'))} · ${past.length}</summary>${past.map((e, i) => examCard(e, true, i)).join('')}</details>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- lesson sheet
export function openLesson(id) {
  const l = S.index[id];
  if (!l) return;
  const color = colorFor(subjKey(l));
  const d = fromUntisDate(l.date);
  const ch = changes(l);
  const ex = lessonExtras(l);
  const hwRow = (h) => `<button class="d-row tap hw-line ${hwDoneAny(h) ? 'done' : ''}" data-act="hw-open" data-key="${esc(h.key)}">${icon(hwDoneAny(h) ? 'circle-check' : 'clipboard-list')}<div><span>${esc(h.text)}</span><small>${esc(h.source === 'iserv' ? t('IServ task') : h.source === 'mine' ? t('Added by you') : 'WebUntis')}${h.source !== 'mine' && h.date ? ` · ${esc(t('Given {d}', { d: fmt(fromUntisDate(h.date), { day: 'numeric', month: 'short' }) }))}` : ''}</small></div></button>`;
  const sums = store.summaries().filter((x) => x.lessonKey === noteKey(l));
  const detail = (ic, label, value) => (value ? `<div class="d-row">${icon(ic)}<div><small>${esc(label)}</small><span>${value}</span></div></div>` : '');
  openSheet(() => `
    <div class="d-head ${l.code === 'cancelled' ? 'is-cancelled' : ''}" style="--c:${color}">
      <div class="d-chip">${esc(l.subjects[0]?.name || l.activity || t('Event'))}</div>
      <h2>${esc(subjName(l))}</h2>
      <p>${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${fmtTime(l.start)} – ${fmtTime(l.end)}${periodLabel(l) ? ` · ${esc(t('Period'))} ${esc(periodLabel(l))}` : ''}</p>
      ${ch.length ? `<div class="badges">${ch.map(badge).join('')}</div>` : ''}
    </div>
    <div class="card">
      ${detail('user', t('Teacher'), l.teachers.map((x) => (x.orig ? `<s>${esc(x.orig)}</s> ` : '') + esc(x.long !== x.name ? `${x.long} (${x.name})` : x.name)).join(', '))}
      ${detail('map-pin', t('Room'), l.rooms.map((r) => (r.orig ? `<s>${esc(r.orig)}</s> ` : '') + esc(r.long && r.long !== r.name ? `${r.name} · ${r.long}` : r.name)).join(', '))}
      ${detail('users', t('Classes'), esc(l.classes.map((c) => c.name).join(', ')))}
      ${detail('layers', t('Group'), esc(l.group))}
      ${detail('clock', t('Duration'), esc(durText(l.end - l.start)) + (l.breakMin ? ` · ${esc(t('incl. {m} min break', { m: l.breakMin }))}` : ''))}
      ${l.replaces?.length ? detail('arrow-left-right', t('Instead of'), l.replaces.map((x) => `${esc(subjName(x))}${x.teachers.length ? ` (${esc(x.teachers.map((y) => y.name).join(', '))})` : ''}`).join(', ')) : ''}
      ${detail('arrow-left-right', t('Substitution'), esc(l.subst))}
      ${detail('info', t('Info'), esc(l.info))}
      ${detail('book-open', t('Lesson text'), esc(l.text))}
    </div>
    ${ex.exams.length ? `<div class="section-title">${icon('graduation-cap')}${esc(t('Exam in this lesson'))}</div>${ex.exams.map((e) => `<div class="exam-in">
        <div><b>${esc(e.name || e.type || t('Exam'))}</b>${e.text ? `<span>${esc(e.text)}</span>` : ''}${e.start ? `<small>${fmtTime(e.start)} – ${fmtTime(e.end)}${(e.rooms || []).length ? ` · ${esc(e.rooms.map((r) => (typeof r === 'string' ? r : r.name)).join(', '))}` : ''}</small>` : ''}</div>
        ${e.fromLesson ? '' : `<button class="btn small ghost" data-act="ai-exam" data-id="${esc(examId(e))}">${icon('sparkles')}${esc(t('Study with AI'))}</button>`}</div>`).join('')}` : ''}
    <div class="section-title">${icon('clipboard-list')}${esc(t('Homework due'))}</div>
    <div class="card">${ex.due.length ? ex.due.map(hwRow).join('') : `<div class="d-row muted">${icon('circle-check')}<div><span>${esc(t('Nothing due in this lesson'))}</span></div></div>`}
      <button class="row" data-act="hw-add-for" data-subj="${esc(subjKey(l))}" data-date="${l.date}"><span class="row-ic">${icon('plus')}</span><span class="row-text"><b>${esc(t('Add homework'))}</b><small>${esc(t('For this subject'))}</small></span></button></div>
    ${ex.given.length ? `<div class="section-title">${icon('square-pen')}${esc(t('Given in this lesson'))}</div><div class="card">${ex.given.map((h) => hwRow(h).replace('</small>', ` · ${esc(t('Due'))} ${esc(relDay(fromUntisDate(h.due)))}</small>`)).join('')}</div>` : ''}
    ${sums.length ? `<div class="section-title">${esc(t('AI summary'))}</div><div class="card">${sums.map((x) => `<button class="row" data-act="open-summary" data-id="${x.id}"><span class="row-ic">${icon('sparkles')}</span><span class="row-text"><b>${esc(x.result?.title || t('Lesson summary'))}</b><small>${esc((x.result?.topics || []).slice(0, 3).join(' · '))}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>` : ''}
    <div class="section-title">${icon('zap')}${esc(t('Actions'))}</div>
    <div class="action-grid">
      <button data-act="ls-test" data-id="${esc(id)}"><span style="--c:#8e4ec6">${icon('graduation-cap')}</span>${esc(t('Add test'))}</button>
      <button data-act="ls-event" data-id="${esc(id)}"><span style="--c:#4f6bff">${icon('calendar-plus')}</span>${esc(t('Add to calendar'))}</button>
      <button data-act="ls-remind" data-id="${esc(id)}"><span style="--c:#12a594">${icon('bell')}</span>${esc(t('Remind me'))}</button>
      ${!window.Capacitor?.isDesktop && l.date === toUntisDate(new Date()) && l.end > nowMinV() && l.code !== 'cancelled' ? `<button data-act="ls-record" data-id="${esc(id)}"><span style="--c:#e5484d">${icon('mic')}</span>${esc(l.start <= nowMinV() ? t('Record now') : t('Record'))}</button>` : ''}
      <button data-act="ls-ai" data-id="${esc(id)}"><span style="--c:#6e56cf">${icon('sparkles')}</span>${esc(t('Ask AI'))}</button>
      <button data-act="ls-share" data-id="${esc(id)}"><span style="--c:#f76b15">${icon('share-2')}</span>${esc(t('Share'))}</button>
      <button data-act="ls-subject" data-id="${esc(id)}"><span style="--c:#30a46c">${icon('book-open')}</span>${esc(t('Subject overview'))}</button>
      <button data-act="ls-color" data-id="${esc(id)}"><span style="--c:${color}">${icon('palette')}</span>${esc(t('Color'))}</button>
    </div>
    <div class="section-title">${esc(t('My note'))}</div>
    <textarea class="note" id="note" placeholder="${esc(t('Add a note for this lesson'))}">${esc(store.notes()[noteKey(l)] || '')}</textarea>
  `, {
    onClose: () => {
      const v = document.getElementById('note')?.value.trim();
      if (v !== undefined) store.setNote(noteKey(l), v);
    },
  });
}

export { PALETTE, hash };

const nowMinV = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
/** Actions of the lesson popup. */
export async function lessonAction(act, id) {
  const l = S.index[id];
  if (!l) return;
  const { closeSheet: close, toast: tst, PALETTE: pal } = await import('./core.js');
  const { setS: setSetting } = await import('./features.js');
  const { setView, render: rerender } = await import('./app.js');
  const P = await import('./planner.js');
  const subject = subjKey(l);
  const name = subjName(l);
  if (act === 'ls-test' || act === 'ls-event') {
    close(true);
    setTimeout(() => {
      P.openEventForm(null, { type: act === 'ls-test' ? 'test' : 'event', date: l.date, subject, remind: '1440' });
      setTimeout(() => { const s1 = document.getElementById('ev-start'); const s2 = document.getElementById('ev-end'); if (s1) s1.value = fmtTime(l.start); if (s2) s2.value = fmtTime(l.end); }, 80);
    }, 260);
  }
  if (act === 'ls-remind') {
    close(true);
    const ev = { id: `e${Date.now()}`, type: 'reminder', title: `${name} · ${(l.rooms || []).map((r) => r.name).join(', ')}`.replace(/ · $/, ''), subject, date: l.date, start: fmtTime(l.start), end: fmtTime(l.end), remind: '10', repeat: 'none', notes: '', t: Date.now() };
    localStorage.setItem('lessn:events', JSON.stringify([...P.myEvents(), ev]));
    (await import('./data.js')).scheduleNative();
    tst(t('You will be reminded 10 minutes before'));
  }
  if (act === 'ls-record') {
    close(true);
    if (l.start <= nowMinV()) { const F = await import('./features.js'); setView('recorder', 'left'); setTimeout(() => F.recStart(), 300); } else { const F = await import('./features.js'); F.armNext(l.start, l.end, subject); }
  }
  if (act === 'ls-ai') {
    close(true);
    const A = await import('./assist.js');
    const sums = store.summaries().filter((x) => x.subject === subject && x.status === 'done').slice(-3);
    A.newChat({ title: name, subject, context: `The student asks about the subject ${name} (lesson on ${l.date}, ${fmtTime(l.start)}, teacher ${(l.teachers || []).map((x) => x.name).join(', ')}). ${sums.length ? `Recent lesson summaries: ${sums.map((x) => `${x.result?.title}: ${x.result?.summary}`).join(' | ')}` : ''}` });
  }
  if (act === 'ls-share') {
    const text = `${name} · ${fmt(fromUntisDate(l.date), { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(l.start)}–${fmtTime(l.end)}${l.rooms.length ? ` · ${l.rooms.map((r) => r.name).join(', ')}` : ''}${l.code === 'cancelled' ? ` · ${t('Cancelled')}` : ''}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); tst(t('Copied')); } } catch { /* cancelled */ }
  }
  if (act === 'ls-subject') {
    close(true);
    setTimeout(() => openSubjectOverview(subject), 260);
  }
  if (act === 'ls-color') {
    const { openMenu } = await import('./core.js');
    const anchor = document.querySelector(`[data-act="ls-color"]`);
    openMenu(anchor, pal.map((c) => [c, c]), S.settings.subjectColors?.[subject] || '', (c) => { setSetting('subjectColors', { ...S.settings.subjectColors, [subject]: c }); close(); rerender(); }, t('Color'));
  }
}
/** Everything about one subject: next lessons, exams, homework, summaries, average grade. */
export function openSubjectOverview(subject) {
  const name = subjLabel(subject) || subject;
  const today = toUntisDate(new Date());
  const exams = allExams().filter((e) => e.subject === subject && e.date >= today).sort((a, b) => a.date - b.date);
  const hw = allHomework().filter((h) => h.subject === subject && !hwDoneAny(h)).sort((a, b) => a.due - b.due);
  const sums = store.summaries().filter((x) => x.subject === subject && x.status === 'done').sort((a, b) => b.date - a.date);
  const grades = (S.grades || []).concat(store.manualGrades()).filter((g) => g.subject === subject);
  const avg = grades.length ? (grades.reduce((a, g) => a + Number(String(g.mark ?? g.value ?? g.grade?.mark?.markDisplayValue ?? 0).replace(',', '.')), 0) / grades.length) : null;
  import('./core.js').then(({ openSheet: os }) => os(() => `<div class="d-head" style="--c:${colorFor(subject)}"><div class="d-chip">${esc(subject)}</div><h2>${esc(name)}</h2>${avg ? `<p>${esc(t('Average'))}: <b>${avg.toFixed(2)}</b> · ${esc(t('{n} grades', { n: grades.length }))}</p>` : ''}</div>
    <div class="section-title">${icon('graduation-cap')}${esc(t('Upcoming exams'))}</div>
    <div class="card">${exams.length ? exams.map((e) => `<button class="row" data-act="exam-open" data-id="${esc(examId(e))}"><span class="row-text"><b>${esc(e.name || t('Exam'))}</b><small>${esc(fmt(fromUntisDate(e.date), { weekday: 'short', day: 'numeric', month: 'short' }))} · ${esc(inDays(fromUntisDate(e.date)))}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('') : `<div class="row"><small>${esc(t('No upcoming exams'))}</small></div>`}</div>
    <div class="section-title">${icon('clipboard-list')}${esc(t('Open homework'))}</div>
    <div class="card">${hw.length ? hw.map((h) => `<button class="row" data-act="hw-open" data-key="${esc(h.key)}"><span class="row-text"><b>${esc(String(h.text).slice(0, 80))}</b><small>${esc(relDay(fromUntisDate(h.due)))}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('') : `<div class="row"><small>${esc(t('All caught up'))}</small></div>`}</div>
    ${sums.length ? `<div class="section-title">${icon('sparkles')}${esc(t('Lesson summaries'))}</div><div class="card">${sums.slice(0, 6).map((x) => `<button class="row" data-act="open-summary" data-id="${x.id}"><span class="row-text"><b>${esc(x.result?.title || '')}</b><small>${esc(fmt(fromUntisDate(x.date), { day: 'numeric', month: 'short' }))}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>` : ''}`, { full: true }));
}
