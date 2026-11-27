// Linked apps: calendar export (.ics for Google / Outlook / Apple Calendar), calendar subscriptions (school or
// Google calendar links), sharing single events, and the "Linked apps & accounts" screen.
import { S, t, esc, icon, toast, store, openSheet, closeSheet, uiPrompt, uiConfirm, stagger, toUntisDate, fromUntisDate, addDays, mondayOf, pad, subjLabel, fmt } from './core.js';
import { native, hasNative } from './native.js';
import { prepareDay, weekData, ownElement } from './data.js';
import { render, setView } from './app.js';
import { linkedAIs } from './ai.js';

const read = (k, d) => { try { const v = localStorage.getItem(`lessn:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(`lessn:${k}`, JSON.stringify(v)); } catch { /* full */ } };

// ---------------------------------------------------------------- iCalendar writing
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const dt = (u, hhmm) => { const s = String(u); return hhmm == null ? s : `${s}T${pad(Math.floor(hhmm / 100))}${pad(hhmm % 100)}00`; };
const toHhmm = (min) => (min == null || min === '' ? null : Math.floor(min / 60) * 100 + (min % 60));
const hm = (s) => { const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 100 + Number(m[2]) : null; };
function vevent({ uid, u, start, end, title, desc, loc }) {
  const allDay = start == null;
  return ['BEGIN:VEVENT', `UID:${uid}@lessn`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    allDay ? `DTSTART;VALUE=DATE:${dt(u)}` : `DTSTART:${dt(u, start)}`,
    allDay ? `DTEND;VALUE=DATE:${toUntisDate(addDays(fromUntisDate(u), 1))}` : `DTEND:${dt(u, end ?? start + 100)}`,
    `SUMMARY:${icsEsc(title)}`, desc ? `DESCRIPTION:${icsEsc(desc)}` : '', loc ? `LOCATION:${icsEsc(loc)}` : '', 'END:VEVENT'].filter(Boolean).join('\r\n');
}
const wrapCal = (events, name) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Lessn//Timetable//EN\r\nX-WR-CALNAME:${icsEsc(name)}\r\nCALSCALE:GREGORIAN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;

/** Everything Lessn knows for the next weeks as one .ics file. */
export async function exportCalendar({ lessons = true, weeks = 4 } = {}) {
  const ev = [];
  const { myEvents, calendarExams } = await import('./planner.js');
  for (const e of myEvents()) ev.push(vevent({ uid: `ev-${e.id}`, u: e.date, start: hm(e.start), end: hm(e.end), title: e.title, desc: [subjLabel(e.subject), e.notes].filter(Boolean).join(' – ') }));
  for (const e of [...(S.exams || []), ...store.myExams()]) ev.push(vevent({ uid: `ex-${e.id ?? `${e.date}-${e.subject}`}`, u: e.date, start: e.start ? toHhmm(e.start) : null, end: e.start ? toHhmm(e.end || e.start + 45) : null, title: `${t('Exam')}: ${subjLabel(e.subject) || ''} ${e.name || ''}`.trim(), desc: e.text }));
  if (lessons) {
    const m0 = mondayOf(new Date());
    for (let w = 0; w < weeks; w++) {
      const m = addDays(m0, w * 7);
      const data = weekData(m, ownElement());
      if (!data) continue;
      for (let i = 0; i < 7; i++) {
        const d = addDays(m, i);
        for (const l of prepareDay(data, d)) {
          if (l.code === 'cancelled') continue;
          ev.push(vevent({ uid: `l-${toUntisDate(d)}-${l.start}-${l.subjects[0]?.name}`, u: toUntisDate(d), start: toHhmm(l.start), end: toHhmm(l.end), title: subjLabel(l.subjects[0]?.name) || l.subjects[0]?.name || t('Lesson'), loc: l.rooms.map((r) => r.name).join(', '), desc: l.teachers.map((x) => x.name).join(', ') }));
        }
      }
    }
  }
  void calendarExams;
  return wrapCal(ev, `Lessn${S.account?.username ? ` – ${S.account.username}` : ''}`);
}
async function shareText(name, text, mime = 'text/calendar') {
  if (hasNative()) {
    const b64 = btoa(unescape(encodeURIComponent(text)));
    const f = await native.writeCache(name, b64);
    await native.shareFile({ path: f.path, mime });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name; a.click();
}
export async function shareCalendar(lessons) {
  try { await shareText('Lessn.ics', await exportCalendar({ lessons })); } catch (e) { toast(t(e.message), 'err'); }
}
export async function shareEventIcs(id) {
  const { myEvents } = await import('./planner.js');
  const e = myEvents().find((x) => x.id === id);
  if (!e) return;
  shareText(`${e.title.replace(/[\\/:*?"<>|]/g, '_')}.ics`, wrapCal([vevent({ uid: `ev-${e.id}`, u: e.date, start: hm(e.start), end: hm(e.end), title: e.title, desc: e.notes })], e.title));
}

// ---------------------------------------------------------------- calendar subscriptions (read-only)
export const feeds = () => read('icsfeeds', []);
export const feedEvents = () => read('icsevents', []);
function parseIcs(text, feedId) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = {};
    else if (l === 'END:VEVENT' && cur) {
      if (cur.date) out.push({ id: `f${feedId}-${cur.uid || out.length}`, feed: feedId, type: 'event', title: cur.title || '', date: cur.date, start: cur.start || '', end: cur.end || '', notes: cur.loc || '', readonly: true });
      cur = null;
    } else if (cur) {
      const i = l.indexOf(':');
      const key = l.slice(0, i); const val = l.slice(i + 1).replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1');
      const name = key.split(';')[0];
      if (name === 'SUMMARY') cur.title = val;
      else if (name === 'UID') cur.uid = val;
      else if (name === 'LOCATION') cur.loc = val;
      else if (name === 'DTSTART' || name === 'DTEND') {
        const m = val.match(/^(\d{8})(?:T(\d{2})(\d{2}))?/);
        if (!m) continue;
        let date = Number(m[1]); let time = m[2] ? `${m[2]}:${m[3]}` : '';
        if (m[2] && /Z$/.test(val)) { const d = new Date(Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6), +m[2], +m[3])); date = toUntisDate(d); time = `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
        if (name === 'DTSTART') { cur.date = date; cur.start = time; } else cur.end = time;
      }
    }
  }
  const from = toUntisDate(addDays(new Date(), -30)); const to = toUntisDate(addDays(new Date(), 400));
  return out.filter((e) => e.date >= from && e.date <= to).slice(0, 1500);
}
export async function refreshFeeds(force = false) {
  const list = feeds();
  if (!list.length) return;
  if (!force && Date.now() - Number(localStorage.getItem('lessn:icsat') || 0) < 6 * 3600000) return;
  let all = [];
  for (const f of list) {
    try {
      const r = await fetch(f.url.replace(/^webcal:/, 'https:'));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      all = all.concat(parseIcs(await r.text(), f.id));
      f.error = '';
    } catch (e) { f.error = e.message; all = all.concat(feedEvents().filter((x) => x.feed === f.id)); }
  }
  write('icsfeeds', list); write('icsevents', all);
  localStorage.setItem('lessn:icsat', String(Date.now()));
  if (S.view === 'calendar' || S.view === 'links') render();
}
export async function addFeed() {
  const url = await uiPrompt(t('Calendar link (.ics or webcal://)'), '', { placeholder: 'https://…/basic.ics' });
  if (!url || !/^(https?|webcal):\/\//i.test(url.trim())) return;
  const name = (await uiPrompt(t('Name'), t('School calendar'))) || t('Calendar');
  write('icsfeeds', [...feeds(), { id: Date.now().toString(36), url: url.trim(), name }]);
  toast(t('Loading {name}', { name }));
  await refreshFeeds(true);
  render();
}
export async function removeFeed(id) {
  if (!await uiConfirm(t('Remove this calendar?'), { danger: true, ok: t('Remove') })) return;
  write('icsfeeds', feeds().filter((f) => f.id !== id));
  write('icsevents', feedEvents().filter((e) => e.feed !== id));
  render();
}

// ---------------------------------------------------------------- "Linked apps & accounts" screen
export function viewLinks() {
  const ai = linkedAIs();
  const fl = feeds();
  const pc = (() => { try { return JSON.parse(localStorage.getItem('lessn:pc') || 'null'); } catch { return null; } })();
  const row = (act, ic, color, title, sub, right = icon('chevron-right', 'row-chev'), extra = '') => `<button class="row" data-act="${act}" ${extra}><span class="row-ic tint" style="--c:${color}">${icon(ic)}</span><span class="row-text"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${right}</button>`;
  const ok = `<em class="pi-tag free">${esc(t('Connected'))}</em>`;
  return `<div class="pad">
    <p class="hint lead"${stagger(0)}>${esc(t('Connect Lessn with other apps and accounts.'))}</p>
    <div class="section-title">${icon('user')}${esc(t('Accounts'))}</div>
    <div class="card"${stagger(1)}>
      ${row('profiles', 'users', '#4f6bff', 'WebUntis', S.account ? `${S.account.username} · ${S.account.schoolName || S.account.school}` : '', ok)}
      ${row('setup-iserv', 'school', '#12a594', 'IServ', store.iserv()?.host || t('Not set up'), store.iserv() ? ok : icon('chevron-right', 'row-chev'))}
      ${row('nav', 'monitor', '#30a46c', window.Capacitor?.isDesktop ? t('Phone') : 'Lessn PC', pc ? pc.name : t('Not set up'), pc ? ok : icon('chevron-right', 'row-chev'), 'data-view="pc"')}
    </div>
    <div class="section-title">${icon('sparkles')}${esc(t('AI accounts'))}</div>
    <div class="card"${stagger(2)}>
      ${row('nav', 'sparkles', '#6e56cf', t('AI helpers'), ai.length ? ai.map((c) => c.p.name.replace(/ \(.*\)$/, '')).join(', ') : t('Not set up'), ai.length ? ok : icon('chevron-right', 'row-chev'), 'data-view="ai-settings"')}
      ${row('link-openrouter', 'log-in', '#e5484d', t('Sign in with OpenRouter'), t('Use many AIs with your account, including free models, without copying a key'))}
      ${row('link-free-ai', 'gift', '#f59e0b', t('Free AI without an account'), 'Pollinations')}
    </div>
    <div class="section-title">${icon('calendar')}${esc(t('Calendar apps'))}</div>
    <div class="card"${stagger(3)}>
      ${row('ics-export', 'calendar-plus', '#0090ff', t('Add to Google, Outlook or Apple Calendar'), t('Exams, your events and the next 4 weeks of lessons as a calendar file'))}
      ${row('ics-export-nolessons', 'calendar-check', '#8e4ec6', t('Only exams and my events'), t('Without lessons'))}
      ${fl.map((f) => row('feed-remove', 'calendar-range', '#12a594', f.name, f.error ? `${t('Error')}: ${f.error}` : f.url.replace(/^https?:\/\//, '').slice(0, 48), icon('x'), `data-id="${esc(f.id)}"`)).join('')}
      ${row('feed-add', 'link', '#12a594', t('Subscribe to a calendar'), t('School calendar, Google Calendar (secret iCal address) or any .ics link'))}
    </div>
  </div>`;
}
