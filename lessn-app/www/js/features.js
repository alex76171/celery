// Menu hub, Grades, Attendance, IServ, Lesson recorder (beta), Settings and the hidden Customize panel.
import {
  dd, formSelect, formDate, uiConfirm, S, t, esc, icon, fmt, fmtTime, relDay, inDays, sameDay, addDays, startOfDay, daysBetween, toUntisDate, fromUntisDate, pad,
  subjLabel, colorFor, PALETTE, hash, store, emptyState, skeleton, badge, stagger, row, seg, toggle, openSheet, closeSheet,
  rerenderSheet, toast, THEMES, FONTS, VERSION, currentTheme, isDark, nowMin, subjKey, subjName, durText,
} from './core.js';
import { LANGS } from './i18n.js';
import { native, hasNative } from './native.js';
import { summarizeAudio, aiReady, audioReady, aiConfig } from './ai.js';
import {
  loadGrades, loadAbsences, offlineInfo, weekData, prepareDay, scheduleNative, ownElement,
} from './data.js';
import { noteKey } from './views.js';
import { userTabs, TAB_DEFS } from './assist.js';
import { render } from './app.js';

// ---------------------------------------------------------------- Menu
export function viewMore() {
  const a = S.account;
  const s = S.settings;
  const off = offlineInfo();
  const tabs = userTabs();
  const tiles = [
    ...Object.entries(TAB_DEFS).filter(([k]) => !tabs.includes(k)).map(([k, d]) => [k, d.icon, t(d.label === 'Recorder' ? 'Lesson recorder' : d.label === 'AI' ? 'AI helper' : d.label), k === 'recorder' || k === 'ai' ? 'Beta' : '', 'nav']),
    ['browse', 'users', t('Other timetables'), '', 'browse'],
    ['holidays', 'sun', t('Holidays'), '', 'holidays'],
    ['directions', 'navigation', t('Directions to school'), '', 'directions'],
    ['notif-settings', 'bell', t('Notifications'), '', 'notif-settings'],
    ['pc', 'monitor', window.Capacitor?.isDesktop ? t('Phone') : t('PC'), '', 'nav'],
    ['links', 'link', t('Linked apps'), '', 'nav'],
  ];
  return `<div class="pad">
    <button class="account"${stagger(0)} data-act="profiles"><div class="avatar">${icon('user')}</div><div><b>${esc(a.username)}</b><small>${esc(a.schoolName || a.school)}</small></div><span class="acc-switch">${icon('chevrons-up-down')}</span></button>
    <div class="section-title">${esc(t('More'))}</div>
    <div class="card list-card"${stagger(1)}>${tiles.map(([view, ic, label, tag, act]) => `<button class="row" data-act="${act}" data-view="${view}">
      <span class="row-ic tint" style="--c:${PALETTE[hash(view) % PALETTE.length]}">${icon(ic)}</span><span class="row-text"><b>${esc(label)}</b></span>${tag ? `<em class="tag">${tag}</em>` : ''}${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>
    <div class="section-title">${esc(t('Settings'))}</div>
    <div class="card">
      ${dd(t('Language'), 'lang', Object.entries(LANGS), s.lang)}
      ${row('tabs-edit', 'layout-grid', t('Tabs'), userTabs().map((k) => t(TAB_DEFS[k].label)).join(' · '))}
      ${row('setup-ai', 'sparkles', t('AI helper'), aiReady() ? `${aiConfig().p.name} · ${aiConfig().model}` : t('Not set up'))}
      ${row('setup-iserv', 'school', 'IServ', store.iserv()?.host || t('Not set up'))}
      ${dd(t('Days per week'), 'weekDays', [['auto', t('Auto')], ['5', '5'], ['6', '6'], ['7', '7']], s.weekDays)}
      ${toggle('autoRefresh', t('Refresh on open'), t('Update when you return to the app'))}
    </div>
    <div class="section-title">${esc(t('Offline'))}</div>
    <div class="card">
      <div class="row static off-row"><span class="row-ic">${icon('download')}</span><span class="row-text"><b>${esc(t('{n} weeks saved for offline use', { n: off.weeks }))}</b><small>${off.at ? esc(t('Updated {d}', { d: `${relDay(new Date(off.at))} ${fmtTime(new Date(off.at).getHours() * 60 + new Date(off.at).getMinutes())}` })) : ''}</small></span></div>
      ${row('refresh-all', 'refresh-cw', t('Refresh everything'))}${row('clear-cache', 'trash-2', t('Clear offline data'))}
    </div>
    <div class="card"><button class="row danger" data-act="logout"><span class="row-ic">${icon('log-out')}</span><span class="row-text"><b>${esc(t('Sign out'))}</b></span></button></div>
    <button class="version" data-act="version">Lessn ${VERSION}</button>
  </div>`;
}

// ---------------------------------------------------------------- Grades
const allGrades = () => [...(S.grades || []), ...store.manualGrades().map((g) => ({ ...g, source: 'manual' }))];
const isPoints = (list) => list.some((g) => g.value > 6.5);
function avg(list) {
  const v = list.filter((g) => Number.isFinite(g.value));
  const w = v.reduce((a, g) => a + (g.weight || 1), 0);
  return w ? v.reduce((a, g) => a + g.value * (g.weight || 1), 0) / w : null;
}
function gradeTone(v, points) {
  if (v == null) return '';
  const good = points ? v >= 10 : v <= 2.5;
  const bad = points ? v < 5 : v > 4;
  return good ? 'ok' : bad ? 'bad' : 'warn';
}

export function viewGrades() {
  if (S.grades === null) { loadGrades(); return `<div class="pad">${skeleton(4)}</div>`; }
  const list = allGrades();
  const points = isPoints(list);
  const bySubj = {};
  list.forEach((g) => { (bySubj[g.subject || '—'] ||= []).push(g); });
  const subjects = Object.entries(bySubj).map(([k, gs]) => ({ k, gs: gs.sort((a, b) => b.date - a.date), a: avg(gs) })).sort((a, b) => subjLabel(a.k).localeCompare(subjLabel(b.k)));
  const overall = avg(subjects.filter((x) => x.a != null).map((x) => ({ value: x.a, weight: 1 })));
  const note = S.gradesError && !(S.grades || []).length
    ? `<div class="notice">${icon('info')}<span>${esc(t('Your school does not share grades through WebUntis. Add your grades yourself to track your average.'))}</span></div>` : '';
  return `<div class="pad">
    <div class="grade-hero"${stagger(0)}>
      <div><small>${esc(t('Average'))}</small><b class="${gradeTone(overall, points)}">${overall == null ? '–' : overall.toFixed(2).replace('.', S.settings.lang === 'en' ? '.' : ',')}</b><span>${esc(t('{n} grades', { n: list.length }))} · ${esc(points ? t('Points (0–15)') : t('Grades (1–6)'))}</span></div>
      <button class="btn small" data-act="grade-add">${icon('plus')}${esc(t('Add grade'))}</button>
    </div>
    ${note}
    ${subjects.length ? subjects.map((x, i) => `<details class="subj-grades" style="--c:${colorFor(x.k)};--i:${Math.min(i + 1, 14)}">
      <summary><span class="sg-dot"></span><b>${esc(subjLabel(x.k))}</b><span class="sg-count">${x.gs.length}</span><span class="sg-avg ${gradeTone(x.a, points)}">${x.a == null ? '–' : x.a.toFixed(1)}</span>${icon('chevron-down')}</summary>
      ${x.gs.map((g) => `<div class="g-row"><span class="g-val ${gradeTone(g.value, points)}">${esc(g.display)}</span><div><b>${esc(g.type || g.text || t('Grade'))}</b><small>${g.date ? esc(fmt(fromUntisDate(g.date), { day: 'numeric', month: 'short', year: 'numeric' })) : ''}${g.weight && g.weight !== 1 ? ` · ×${g.weight}` : ''}${g.source === 'manual' ? ` · ${esc(t('added by you'))}` : ''}</small></div>${g.source === 'manual' ? `<button class="link-btn" data-act="grade-del" data-id="${esc(g.id)}">${icon('trash-2')}</button>` : ''}</div>`).join('')}
    </details>`).join('') : emptyState('award', t('No grades yet'), t('Add a grade to start tracking.'))}
  </div>`;
}

function knownSubjects() {
  const m = {};
  Object.values(S.weeks).forEach((list) => { if (Array.isArray(list)) list.forEach((l) => { if (l.subjects[0]) m[l.subjects[0].name] = l.subjects[0].long; }); });
  return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
}

export function openGradeForm() {
  const subs = knownSubjects();
  const today = new Date();
  openSheet(() => `<h2 class="sheet-title">${icon('award')}${esc(t('Add grade'))}</h2>
    <div class="form">
      <label class="lbl">${esc(t('Subject'))}</label>
      ${formSelect('g-subj', [...subs.map(([k, long]) => [k, subjLabel(k) || long]), ['', t('Other')]], subs[0]?.[0] ?? '')}
      <label class="lbl">${esc(t('Grade'))}</label>
      <input class="field" id="g-val" inputmode="decimal" placeholder="${esc(t('e.g. 2 or 2- or 12'))}">
      <label class="lbl">${esc(t('Type'))}</label>
      <input class="field" id="g-type" placeholder="${esc(t('e.g. Test, oral grade'))}">
      <label class="lbl">${esc(t('Weight'))}</label>
      ${seg('g-weight', [['0.5', '×0.5'], ['1', '×1'], ['2', '×2']], S.gradeWeight || '1', 'g-weight')}
      <label class="lbl">${esc(t('Date'))}</label>
      ${formDate('g-date', `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`, [[t('Today'), today], [t('Yesterday'), addDays(today, -1)]])}
      <button class="btn" data-act="grade-save">${esc(t('Save'))}</button>
    </div>`);
}

export function saveGrade() {
  const raw = document.getElementById('g-val').value.trim();
  if (!raw) { toast(t('Enter a grade'), 'err'); return; }
  let value = parseFloat(raw.replace(',', '.'));
  if (/^[1-6]\s*[+-]$/.test(raw)) value += raw.trim().endsWith('-') ? 0.3 : -0.3;
  const date = document.getElementById('g-date').value.replace(/-/g, '');
  const g = {
    id: 'm' + Date.now(), subject: document.getElementById('g-subj').value, value, display: raw,
    type: document.getElementById('g-type').value.trim(), weight: Number(S.gradeWeight || 1), date: Number(date) || toUntisDate(new Date()),
  };
  store.setManualGrades([...store.manualGrades(), g]);
  closeSheet();
  render();
  toast(t('Grade saved'));
}

// ---------------------------------------------------------------- Attendance
let attMonth = startOfDay(new Date());
attMonth.setDate(1);
export async function loadPresence() {
  S.presence = await native.presenceLog();
  render();
}

function attendanceMap() {
  const map = {};
  for (const [d, e] of Object.entries(S.presence || {})) map[d] = e.status;
  for (const a of S.absences || []) {
    for (let u = a.startDate, d = fromUntisDate(a.startDate); u <= a.endDate; d = addDays(d, 1), u = toUntisDate(d)) {
      if (!map[u] || map[u] === 'present') map[u] = a.excused ? 'excused' : 'absence';
    }
  }
  return map;
}

export function viewAttendance() {
  const s = S.settings;
  if (S.presence === undefined) { loadPresence(); }
  if (S.absences === null) loadAbsences(true);
  const map = attendanceMap();
  const first = new Date(attMonth);
  const startPad = (first.getDay() + 6) % 7;
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push('<i></i>');
  for (let d = 1; d <= daysIn; d++) {
    const date = new Date(first.getFullYear(), first.getMonth(), d);
    const st = map[toUntisDate(date)] || '';
    cells.push(`<button class="cal-d ${st} ${sameDay(date, new Date()) ? 'today' : ''}" data-act="att-day" data-d="${toUntisDate(date)}">${d}</button>`);
  }
  const missed = Object.entries(map).filter(([, st]) => st !== 'present').sort((a, b) => b[0] - a[0]);
  const label = { away: t('Away from school (not answered)'), absent: t('You said you were not at school'), absence: t('Absence in WebUntis'), excused: t('Excused absence in WebUntis') };
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt(addDays(new Date(2024, 0, 1), i), { weekday: 'narrow' }));
  return `<div class="pad">
    <div class="card"${stagger(0)}>
      ${toggle('presenceCheck', t('Check if I am at school'), t('Uses your location 10 minutes after your first lesson starts'), 'presence-toggle')}
      ${s.presenceCheck || s.schoolLoc ? `
      <div class="row static"><span class="row-ic">${icon('map-pin')}</span><span class="row-text"><b>${esc(t('School location'))}</b><small>${s.schoolLoc ? `${s.schoolLoc.lat.toFixed(4)}, ${s.schoolLoc.lng.toFixed(4)}` : esc(t('Not set yet'))}</small></span></div>
      <div class="row-pad"><button class="btn small ghost" data-act="set-school-loc">${icon('locate-fixed')}${esc(t("I'm at school now, use my location"))}</button></div>
      ${dd(t('School area radius'), 'presenceRadius', [['150', '150 m'], ['250', '250 m'], ['400', '400 m'], ['700', '700 m']], s.presenceRadius)}
      ${row('check-now', 'radar', t('Check now'))}` : ''}
    </div>
    <div class="cal"${stagger(1)}>
      <div class="cal-head"><button class="icon-btn" data-act="att-month" data-dir="-1">${icon('chevron-left')}</button><b>${esc(fmt(first, { month: 'long', year: 'numeric' }))}</b><button class="icon-btn" data-act="att-month" data-dir="1">${icon('chevron-right')}</button></div>
      <div class="cal-grid">${weekdays.map((w) => `<span>${esc(w)}</span>`).join('')}${cells.join('')}</div>
      <div class="cal-legend"><span class="present">${esc(t('At school'))}</span><span class="away">${esc(t('Not at school'))}</span><span class="absence">${esc(t('Absence'))}</span><span class="excused">${esc(t('Excused'))}</span></div>
    </div>
    <div class="section-title">${esc(t("Days you weren't at school"))} · ${missed.length}</div>
    ${missed.length ? `<div class="card">${missed.slice(0, 60).map(([d, st]) => `<div class="d-row">${icon(st === 'excused' ? 'circle-check' : 'circle-alert', st === 'excused' ? 'ok' : 'bad')}<div><span>${esc(fmt(fromUntisDate(Number(d)), { weekday: 'long', day: 'numeric', month: 'long' }))}</span><small>${esc(label[st] || st)}</small></div></div>`).join('')}</div>` : emptyState('calendar-check', t('No missed days'), t('Nice!'))}
  </div>`;
}

export async function togglePresence() {
  const s = S.settings;
  if (s.presenceCheck) { setS('presenceCheck', false); scheduleNative(); return; }
  if (!hasNative()) { toast(t('Only available in the Android app'), 'err'); return; }
  try {
    let st = await native.request(['location']);
    if (st.location !== 'granted') { toast(t('Location permission is needed'), 'err'); return; }
    st = await native.request(['backgroundLocation']).catch(() => ({}));
    if (st.backgroundLocation !== 'granted') toast(t('Choose "Allow all the time" so the check also works when the app is closed'));
    await native.request(['notifications']).catch(() => {});
    setS('presenceCheck', true);
    if (!s.schoolLoc) toast(t('Now set your school location while you are at school'));
    scheduleNative();
  } catch (e) { toast(e.message, 'err'); }
}

export async function setSchoolLocation() {
  try {
    const st = await native.request(['location']);
    if (st.location !== 'granted') { toast(t('Location permission is needed'), 'err'); return; }
    toast(t('Getting your location…'));
    const loc = await native.getLocation();
    setS('schoolLoc', { lat: loc.lat, lng: loc.lng });
    scheduleNative();
    toast(t('School location saved'));
  } catch (e) { toast(t(e.message === 'permission' ? 'Location permission is needed' : e.message), 'err'); }
}

export async function checkNow() {
  const s = S.settings;
  if (!s.schoolLoc) { toast(t('Set your school location first'), 'err'); return; }
  try {
    const loc = await native.getLocation();
    const dist = distance(loc.lat, loc.lng, s.schoolLoc.lat, s.schoolLoc.lng);
    const inside = dist <= Number(s.presenceRadius) + Math.min(loc.accuracy || 0, 300);
    await native.setPresence(String(toUntisDate(new Date())), inside ? 'present' : 'away');
    toast(inside ? t('You are at school') : t('You are {m} m away from school', { m: Math.round(dist) }), inside ? '' : 'err');
    loadPresence();
  } catch (e) { toast(t(e.message === 'permission' ? 'Location permission is needed' : e.message), 'err'); }
}

function distance(a, b, c, d) {
  const R = 6371e3; const r = Math.PI / 180;
  const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function attDay(u) {
  const d = fromUntisDate(Number(u));
  openSheet(() => `<h2 class="sheet-title">${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</h2>
    <p class="hint">${esc(t('Mark this day yourself:'))}</p>
    <div class="card">${row('att-set', 'circle-check', t('I was at school'), '', `data-d="${u}" data-st="present"`)}${row('att-set', 'circle-x', t('I was not at school'), '', `data-d="${u}" data-st="absent"`)}</div>`);
}

export function moveMonth(dir) { attMonth = new Date(attMonth.getFullYear(), attMonth.getMonth() + dir, 1); render(); }

// ---------------------------------------------------------------- Recorder (beta)
const REC_KEY = 'rec';
export const recState = () => store.cache(REC_KEY)?.data || null;
const setRec = (v) => store.setCache(REC_KEY, v);

function currentLesson() {
  const data = weekData(S.week, ownElement());
  if (!data) return null;
  const list = prepareDay(data, new Date()).filter((l) => l.code !== 'cancelled');
  const n = nowMin();
  return list.find((l) => l.start - 10 <= n && n < l.end) || null;
}

export function viewRecorder() {
  const key = audioReady();
  const rec = recState();
  const sums = store.summaries().slice().sort((a, b) => b.t - a.t);
  const cur = currentLesson();
  const elapsed = rec?.startedAt ? Math.floor((Date.now() - rec.startedAt) / 1000) : 0;
  const busy = S.recBusy;
  return `<div class="pad">
    <div class="notice warn"${stagger(0)}>${icon('shield-alert')}<span>${esc(t('Beta. Only record lessons when your teacher and class agree. Recording people without their consent can be illegal.'))}</span></div>
    ${!key ? `<button class="ai-setup" data-act="setup-ai"${stagger(1)}>${icon('key-round')}<span><b>${esc(t('Set up AI'))}</b><small>${esc(t('Lesson summaries need Gemini, OpenAI or Mistral for the audio. Add one of these keys in the AI settings.'))}</small></span>${icon('chevron-right', 'row-chev')}</button>` : ''}
    <div class="rec-panel ${rec ? 'live' : ''}"${stagger(2)}>
      <button class="rec-btn" data-act="${rec ? 'rec-stop' : 'rec-start'}" ${busy ? 'disabled' : ''} aria-label="${esc(rec ? t('Stop') : t('Record'))}">${icon(rec ? 'square' : 'mic')}</button>
      <div class="rec-info">
        <b>${esc(rec ? rec.title : cur ? subjName(cur) : t('Record a lesson'))}</b>
        <span id="rec-time">${rec ? `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}` : esc(cur ? `${fmtTime(cur.start)} – ${fmtTime(cur.end)}` : t('Tap to start. Works with the screen off.'))}</span>
      </div>
    </div>
    ${busy ? `<div class="processing">${icon('sparkles', 'spin-slow')}<span>${esc(busy)}</span></div>` : ''}
    <div class="card"${stagger(3)}>
      ${dd(t('Summary language'), 'aiLang', [['auto', t('App language')], ...Object.entries(LANGS)], S.settings.aiLang, { sub: t('The lesson audio can be German, the summary can be in any of these') })}
      ${toggle('keepAudio', t('Keep audio after summary'))}
      ${row('setup-ai', 'key-round', t('AI provider'), aiReady() ? aiConfig().p.name : t('Not set up'))}
    </div>
    <div class="section-title">${icon('sparkles')}${esc(t('Summaries'))} · ${sums.length}</div>
    ${sums.length ? sums.map((x, i) => `<button class="sum-card ${x.status === 'error' ? 'err' : ''}" data-act="open-summary" data-id="${x.id}" style="--c:${colorFor(x.subject)};--i:${Math.min(i + 4, 14)}">
      <div class="sum-top"><b>${esc(subjLabel(x.subject) || t('Lesson'))}</b><span>${esc(fmt(fromUntisDate(x.date), { day: 'numeric', month: 'short' }))} · ${esc(durText(Math.round(x.durationMs / 60000)))}</span></div>
      <div class="sum-title">${esc(x.status === 'error' ? t('Summary failed. Tap to retry.') : x.result?.title || '')}</div>
      ${x.result?.topics?.length ? `<div class="chips-mini">${x.result.topics.slice(0, 4).map((tp) => `<span>${esc(tp)}</span>`).join('')}</div>` : ''}
      ${x.result?.tests?.length ? badge({ cls: 'bad', icon: 'graduation-cap', text: t('{n} tests mentioned', { n: x.result.tests.length }) }) : ''}
    </button>`).join('') : emptyState('audio-lines', t('No summaries yet'), t('Record a lesson and get the topics, homework and upcoming tests.'))}
  </div>`;
}

export async function recStart() {
  if (!hasNative()) { toast(t('Only available in the Android app'), 'err'); return; }
  if (!audioReady()) { toast(t('Lesson summaries need Gemini, OpenAI or Mistral for the audio. Add one of these keys in the AI settings.'), 'err'); return; }
  try {
    const st = await native.request(['microphone', 'notifications']);
    if (st.microphone !== 'granted') { toast(t('Microphone permission is needed'), 'err'); return; }
    const cur = currentLesson();
    const title = cur ? `${subjName(cur)} · ${fmtTime(cur.start)}` : t('Lesson recording');
    await native.startRecording(title, 95);
    setRec({ startedAt: Date.now(), title, subject: cur ? subjKey(cur) : '', lessonKey: cur ? noteKey(cur) : '', date: toUntisDate(new Date()), start: cur?.start || nowMin() });
    render();
  } catch (e) { toast(t(e.message === 'permission' ? 'Microphone permission is needed' : e.message), 'err'); }
}

export async function recStop() {
  const rec = recState();
  let res;
  try { res = await native.stopRecording(); } catch (e) { toast(e.message, 'err'); return; }
  setRec(null);
  if (!res?.path) { toast(t('Recording failed'), 'err'); render(); return; }
  const item = { id: 's' + Date.now(), t: Date.now(), subject: rec?.subject || '', lessonKey: rec?.lessonKey || '', date: rec?.date || toUntisDate(new Date()), durationMs: res.duration || 0, path: res.path, mime: res.mime || 'audio/mp4', status: 'pending' };
  store.setSummaries([...store.summaries(), item]);
  processSummary(item.id);
}

export async function processSummary(id) {
  const all = store.summaries();
  const item = all.find((x) => x.id === id);
  if (!item || !item.path) return;
  const update = (patch) => store.setSummaries(store.summaries().map((x) => (x.id === id ? { ...x, ...patch } : x)));
  try {
    S.recBusy = t('Reading recording…'); render();
    const { data } = await native.readFile(item.path);
    S.recBusy = t('AI is listening to the lesson. This can take a minute…'); render();
    const lang = S.settings.aiLang === 'auto' ? S.settings.lang : S.settings.aiLang;
    const d = fromUntisDate(item.date);
    const result = await summarizeAudio({
      base64: data, mime: item.mime || 'audio/mp4', lang,
      context: { subject: subjLabel(item.subject), date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${fmt(d, { weekday: 'long' })})` },
    });
    update({ status: 'done', result, path: S.settings.keepAudio ? item.path : null });
    if (!S.settings.keepAudio) native.deleteFile(item.path);
    // Tests with a known date also show up in the exam list
    const add = (result.tests || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map((x, i) => ({
      id: `${id}-${i}`, subject: item.subject, date: Number(x.date.replace(/-/g, '')), name: x.what || t('Test'), text: [x.details, x.when].filter(Boolean).join(' · '),
    }));
    if (add.length) store.setMyExams([...store.myExams().filter((e) => !e.id.startsWith(id)), ...add]);
    toast(t('Summary ready'));
    S.recBusy = null;
    render();
    openSummary(id);
  } catch (e) {
    update({ status: 'error', error: e.message });
    S.recBusy = null;
    render();
    toast(t(e.message), 'err');
  }
}

export function openSummary(id) {
  const x = store.summaries().find((s) => s.id === id);
  if (!x) return;
  if (x.status === 'error' || x.status === 'pending') {
    openSheet(() => `<h2 class="sheet-title">${esc(t('Summary failed'))}</h2><p class="hint">${esc(x.error || '')}</p>
      <div class="card">${x.path ? row('sum-retry', 'refresh-cw', t('Try again'), '', `data-id="${id}"`) : ''}${row('sum-del', 'trash-2', t('Delete'), '', `data-id="${id}"`)}</div>`);
    return;
  }
  const r = x.result || {};
  const list = (title, ic, items, fn = (v) => esc(v)) => (items?.length ? `<div class="section-title">${icon(ic)}${esc(title)}</div><div class="card">${items.map((v) => `<div class="d-row">${icon('chevron-right')}<div><span>${fn(v)}</span></div></div>`).join('')}</div>` : '');
  openSheet(() => `<div class="d-head" style="--c:${colorFor(x.subject)}"><div class="d-chip">${esc(subjLabel(x.subject) || t('Lesson'))}</div>
      <h2>${esc(r.title || t('Lesson summary'))}</h2><p>${esc(fmt(fromUntisDate(x.date), { weekday: 'long', day: 'numeric', month: 'long' }))} · ${esc(durText(Math.round(x.durationMs / 60000)))}</p>
      ${r.topics?.length ? `<div class="chips-mini">${r.topics.map((tp) => `<span>${esc(tp)}</span>`).join('')}</div>` : ''}</div>
    ${r.tests?.length ? `<div class="test-alert">${icon('graduation-cap')}<div>${r.tests.map((ts) => `<b>${esc(ts.what || t('Test'))}</b><span>${esc([ts.when, ts.details].filter(Boolean).join(' · '))}</span>`).join('')}</div></div>` : ''}
    <div class="section-title">${icon('book-open')}${esc(t('Summary'))}</div><div class="card"><p class="sum-text">${esc(r.summary || '')}</p></div>
    ${list(t('Key points'), 'star', r.keyPoints)}
    ${hwItems(r).length ? `<div class="section-title">${icon('clipboard-list')}${esc(t('Homework'))}<button class="link" data-act="sum-hw-all" data-id="${id}">${icon('plus', 'mini')}${esc(t('Add all'))}</button></div>
      <div class="card">${hwItems(r).map((h, i) => `<div class="d-row sum-hw"><span class="dot-c" style="--c:${h.graded ? '#e5484d' : colorFor(x.subject)}"></span><div><span>${esc(h.task)}</span><small>${[h.due ? esc(fmt(new Date(h.due), { weekday: 'short', day: 'numeric', month: 'short' })) : h.dueText ? esc(h.dueText) : esc(t('No due date')), h.graded ? `<b class="bad">${esc(t('Graded'))}</b>` : '', h.importance === 'high' ? `<b class="warn">${esc(t('Important'))}</b>` : ''].filter(Boolean).join(' · ')}</small></div>
        <button class="icon-btn" data-act="sum-hw-add" data-id="${id}" data-i="${i}" aria-label="${esc(t('Add'))}">${icon(x.added?.[i] ? 'check' : 'plus')}</button></div>`).join('')}</div>` : ''}
    ${(r.tests || []).length ? `<div class="card">${(r.tests || []).map((ts, i) => `<button class="row" data-act="sum-test-add" data-id="${id}" data-i="${i}"><span class="row-ic tint" style="--c:#8e4ec6">${icon('calendar-plus')}</span><span class="row-text"><b>${esc(t('Add "{what}" to the calendar', { what: ts.what || t('Test') }))}</b><small>${esc(ts.date || ts.when || '')}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>` : ''}
    ${list(t('Announcements'), 'megaphone', r.announcements)}
    <div class="section-title">${icon('sparkles')}${esc(t('What the AI suggests'))}</div>
    <div class="ai-sugs list">${[...(r.suggestions || []), t('Make a study plan from this lesson'), t('Quiz me on this lesson'), t('Make flashcards as PDF')].slice(0, 6).map((sg, i) => `<button class="ai-sug" data-act="sum-suggest" data-id="${id}" data-text="${esc(sg)}" style="--i:${i}"><b>${esc(sg)}</b><span class="ai-sug-ic">${icon(i < (r.suggestions || []).length ? 'lightbulb' : ['list-checks', 'circle-help', 'file-text'][i - (r.suggestions || []).length] || 'sparkles')}</span></button>`).join('')}</div>
    <div class="card">${row('sum-chat', 'message-square', t('Ask the AI about this lesson'), '', `data-id="${id}"`)}${row('sum-pdf', 'file-down', t('Save summary as PDF'), '', `data-id="${id}"`)}${row('sum-del', 'trash-2', t('Delete summary'), '', `data-id="${id}"`)}</div>`, { full: true });
}

export function deleteSummary(id) {
  const x = store.summaries().find((s) => s.id === id);
  if (x?.path) native.deleteFile(x.path);
  store.setSummaries(store.summaries().filter((s) => s.id !== id));
  store.setMyExams(store.myExams().filter((e) => !String(e.id).startsWith(id)));
  closeSheet();
  render();
}

// ---------------------------------------------------------------- Notifications sheet
export async function openNotifSettings() {
  const st = await native.status();
  const health = await native.notifHealth();
  const s = S.settings;
  const fixes = health ? [
    !health.enabled && ['notif-perm', 'bell-off', t('Notifications are turned off for Lessn'), t('Tap to allow them')],
    !health.exact && ['notif-exact', 'clock', t('Exact alarms are off'), t('Reminders may come a few minutes late. Tap to allow.')],
    !health.battery && ['notif-battery', 'battery', t('Battery saver can delay reminders'), t('Tap and choose "Allow" (or "Unrestricted")')],
  ].filter(Boolean) : [];
  openSheet(() => `<h2 class="sheet-title">${icon('bell')}${esc(t('Notifications'))}</h2>
    ${fixes.length ? `<div class="card warn-card">${fixes.map(([act, ic, title, sub]) => `<button class="row" data-act="${act}"><span class="row-ic tint" style="--c:#e5484d">${icon(ic)}</span><span class="row-text"><b>${esc(title)}</b><small>${esc(sub)}</small></span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>`
      : health ? `<div class="notice ok">${icon('circle-check')}<span>${esc(t('Notifications are set up correctly.'))}${health.pending ? ` ${esc(t('{n} planned', { n: health.pending }))}` : ''}</span></div>` : ''}
    <div class="card">
      ${toggle('notifyLessons', t('Lesson reminders'), t('A notification before each lesson'), 'notif-toggle')}
      ${s.notifyLessons ? dd(t('Remind me'), 'notifyMinutes', [['2', '2 min'], ['5', '5 min'], ['10', '10 min'], ['15', '15 min']], s.notifyMinutes) : ''}
      ${toggle('notifyChanges', t('Change alerts'), t('Cancelled lessons, substitutions and room changes, checked every 30 minutes even when Lessn is closed'), 'notif-toggle')}
    </div>
    <div class="section-title">${icon('graduation-cap')}${esc(t('Studying'))}</div>
    <div class="card">
      ${toggle('studyCheckins', t('Ask if I have studied'), t('Before each exam or test, with help from the AI if not yet'), 'notif-toggle')}
      ${s.studyCheckins !== false ? dd(t('When to ask'), 'checkinDays', [['7,3,1', t('7, 3 and 1 day before')], ['3,1', t('3 and 1 day before')], ['5,2', t('5 and 2 days before')], ['14,7,3,1', t('2 weeks, 1 week, 3 days, 1 day before')], ['1', t('The day before')]], s.checkinDays || '7,3,1') : ''}
      ${s.studyCheckins !== false ? dd(t('At'), 'checkinHour', [['15', '15:00'], ['16', '16:00'], ['17', '17:00'], ['18', '18:00'], ['19', '19:00'], ['20', '20:00']], String(s.checkinHour ?? 17)) : ''}
    </div>
    <div class="section-title">${icon('mic')}${esc(t('Lesson recording'))}</div>
    <div class="card">
      ${toggle('recAsk', t('Ask before each lesson if I want to record'), t('Tap Record in the notification: it starts with the lesson and stops at the end, even with the phone locked'), 'notif-toggle')}
      ${s.recAsk ? dd(t('Ask'), 'recAskMinutes', [['1', t('1 minute before')], ['3', t('3 minutes before')], ['5', t('5 minutes before')], ['10', t('10 minutes before')]], String(s.recAskMinutes ?? 3)) : ''}
      ${s.recAsk ? `<button class="row" data-act="rec-subjects"><span class="row-text"><b>${esc(t('Subjects'))}</b><small>${esc((s.recAskSubjects || []).length ? (s.recAskSubjects || []).map((k) => subjLabel(k) || k).join(', ') : t('All subjects'))}</small></span>${icon('chevron-right', 'row-chev')}</button>` : ''}
    </div>
    <button class="btn small ghost center-btn" data-act="notif-test">${icon('bell')}${esc(t('Send a test notification'))}</button>
    ${store.iserv() ? `<div class="section-title">${icon('school')}IServ</div><div class="card">${toggle('iservNotify', t('IServ notifications'), t('New messages and IServ notifications, checked every 15 minutes'), 'iserv-notify')}</div>` : ''}
    <div class="section-title">${icon('bell-off')}${esc(t('Do not disturb'))}</div>
    <div class="card">
      ${toggle('dndLessons', t('Do not disturb during lessons'), t('Turns on when a lesson starts and off when it ends'), 'dnd-toggle')}
      ${s.dndLessons ? toggle('dndBreaks', t('Also during short breaks'), t('Stay silent from the first to the last lesson')) : ''}
      ${s.dndLessons && st.dnd === false ? `<div class="row-pad"><div class="notice warn">${icon('triangle-alert')}<span>${esc(t('Allow Lessn to change Do Not Disturb in the next screen.'))}</span></div><button class="btn small" data-act="dnd-access">${esc(t('Open settings'))}</button></div>` : ''}
    </div>
    ${hasNative() ? '' : `<p class="hint">${esc(t('Only available in the Android app'))}</p>`}`);
}

export async function notifToggle(key) {
  const on = !S.settings[key];
  if (on && hasNative()) {
    const r = await native.request(['notifications']).catch(() => ({}));
    if (r.notifications && r.notifications !== 'granted') { toast(t('Notification permission is needed'), 'err'); return; }
  }
  setS(key, on);
  scheduleNative();
  rerenderSheet();
}

export async function dndToggle() {
  const on = !S.settings.dndLessons;
  setS('dndLessons', on);
  scheduleNative();
  if (on && hasNative()) {
    const st = await native.status();
    if (!st.dnd) await native.openDndSettings().catch(() => {});
  }
  rerenderSheet();
}

// ---------------------------------------------------------------- Directions
export function directions() {
  const s = S.settings;
  const dest = s.schoolLoc ? `${s.schoolLoc.lat},${s.schoolLoc.lng}` : [S.account.schoolName, S.account.schoolAddress].filter(Boolean).join(', ');
  if (!dest) { toast(t('Set your school location in Attendance first'), 'err'); return; }
  native.openUrl(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=transit`);
}

// ---------------------------------------------------------------- Other sheets
export function openBrowse() {
  let kind = 'classes';
  let q = '';
  const load = async () => {
    if (S.elements[kind]) return;
    S.elements[kind] = 'loading';
    rerenderSheet();
    try { S.elements[kind] = await S.api.elements(kind); } catch (e) { S.elements[kind] = { error: e.message }; }
    rerenderSheet();
  };
  const listHtml = () => {
    const list = S.elements[kind];
    if (!list || list === 'loading') return skeleton(6);
    if (list.error) return emptyState('lock', t('Not available'), t('Your school does not share this list with your account.'));
    const f = list.filter((x) => !q || `${x.name} ${x.long}`.toLowerCase().includes(q.toLowerCase())).slice(0, 300);
    return f.length ? `<div class="card">${f.map((x) => `<button class="row" data-act="pick-element" data-id="${x.id}" data-type="${x.type}" data-label="${esc(x.name)}"><span class="row-ic">${icon({ classes: 'users', teachers: 'user', rooms: 'door-open' }[kind])}</span><span class="row-text"><b>${esc(x.name)}</b>${x.long && x.long !== x.name ? `<small>${esc(x.long)}</small>` : ''}</span>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>` : emptyState('search', t('No matches'));
  };
  openSheet(() => `<h2 class="sheet-title">${esc(t('Other timetables'))}</h2>
      <div class="card">${dd(t('Show'), 'browse-kind', [['classes', t('Classes')], ['teachers', t('Teachers')], ['rooms', t('Rooms')]], kind, { act: 'browse-kind', ic: 'users' })}</div>
      <label class="search">${icon('search')}<input id="browse-q" placeholder="${esc(t('Search'))}" value="${esc(q)}" autocomplete="off"></label>
      <div id="browse-list">${listHtml()}</div>`, { full: true });
  load();
  openBrowse.setKind = (k) => { kind = k; q = ''; rerenderSheet(); load(); };
  openBrowse.setQuery = (v) => { q = v; document.getElementById('browse-list').innerHTML = listHtml(); };
}

export function openHolidays() {
  const now = toUntisDate(new Date());
  openSheet(() => {
    const list = S.holidays.filter((h) => h.end >= now).sort((a, b) => a.start - b.start);
    return `<h2 class="sheet-title">${icon('sun')}${esc(t('Holidays'))}</h2>${list.length ? list.map((h, i) => {
      const a = fromUntisDate(h.start); const b = fromUntisDate(h.end);
      const cur = h.start <= now;
      const len = daysBetween(a, b) + 1;
      return `<div class="hol-card ${cur ? 'now' : ''}"${stagger(i)}><div class="hol-ic">${icon(cur ? 'sun' : 'calendar-days')}</div><div><b>${esc(h.name)}</b><span>${esc(fmt(a, { day: 'numeric', month: 'short' }))}${h.end !== h.start ? ` – ${esc(fmt(b, { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''} · ${esc(len === 1 ? t('1 day') : t('{n} days', { n: len }))}</span></div><em>${esc(cur ? t('now') : inDays(a))}</em></div>`;
    }).join('') : emptyState('calendar', t('No upcoming holidays'))}`;
  }, { full: true });
}

export function openNews(i) {
  const m = S.news?.[i];
  if (!m) return;
  openSheet(() => `<h2 class="sheet-title">${icon('megaphone')}${esc(m.subject || t('Announcement'))}</h2><div class="card"><p class="sum-text">${esc(m.text)}</p></div>`);
}

const FONT_CSS = { system: 'system-ui', inter: 'Inter', poppins: 'Poppins', nunito: 'Nunito', outfit: 'Outfit', space: "'Space Grotesk'", lora: 'Lora', mono: "'JetBrains Mono'" };

// ---------------------------------------------------------------- hidden customization
const ACCENTS = ['#4f6bff', '#7c5cff', '#d6409f', '#e5484d', '#f76b15', '#e2a300', '#30a46c', '#12a594', '#0090ff', '#64748b'];
export function setS(key, value) {
  S.settings[key] = value;
  store.saveSettings(S.settings);
}

export function openCustomize() {
  if (!S.api) return;
  openSheet(() => {
    const st = S.settings;
    const subjects = knownSubjects();
    const cur = st.theme === 'system' ? 'auto' : st.theme;
    return `<h2 class="sheet-title">${icon('paintbrush')}${esc(t('Customize'))}</h2>
    <div class="section-title">${esc(t('Theme'))}</div>
    <div class="card">
      <div class="theme-preview"><span class="tp tp-${cur}"><i></i><i></i><i></i></span></div>
      ${dd(t('Theme'), 'theme', THEMES.map(([id, label]) => [id, t(label)]), cur, { ic: 'palette' })}
      ${dd(t('Font'), 'font', FONTS.map(([id, label]) => [id, t(label)]), st.font || 'theme', { ic: 'type' })}
    </div>
    <div class="section-title">${esc(t('Appearance'))}</div>
    <div class="card">
      <div class="row static"><span class="row-text"><b>${esc(t('Accent color'))}</b></span></div>
      <div class="row-pad swatches">${ACCENTS.map((c) => `<button class="sw ${st.accent === c ? 'on' : ''}" style="--c:${c}" data-act="set" data-key="accent" data-val="${c}" aria-label="${c}"></button>`).join('')}
        <label class="sw custom" style="--c:${st.accent}">${icon('pencil')}<input type="color" data-key="accent" value="${esc(st.accent)}"></label></div>
      <div class="row static"><span class="row-text"><b>${esc(t('Corner roundness'))}</b><small id="v-radius">${st.radius}px</small></span></div>
      <div class="row-pad"><input type="range" min="0" max="28" step="1" value="${st.radius}" data-key="radius"></div>
      <div class="row static"><span class="row-text"><b>${esc(t('Text size'))}</b><small id="v-fontScale">${Math.round(st.fontScale * 100)}%</small></span></div>
      <div class="row-pad"><input type="range" min="0.85" max="1.25" step="0.05" value="${st.fontScale}" data-key="fontScale"></div>

      ${dd(t('Density'), 'density', [['comfortable', t('Comfortable')], ['compact', t('Compact')]], st.density)}
      ${dd(t('Lesson colors'), 'colorMode', [['subject', t('Per subject')], ['accent', t('Accent')], ['mono', t('Neutral')]], st.colorMode)}
      ${toggle('animations', t('Animations'))}
    </div>
    <div class="section-title">${esc(t('Timetable'))}</div>
    <div class="card">
      ${toggle('mergeDoubles', t('Merge double lessons'))}
      ${toggle('hideCancelled', t('Hide cancelled lessons'))}
      ${toggle('showRoom', t('Show rooms'))}
      ${toggle('showTeacher', t('Show teachers'))}
      ${toggle('teacherLongNames', t('Full teacher names'), t('When your school provides them'))}
      ${toggle('subjectLongNames', t('Full subject names in lists'))}
      ${toggle('subjectShortInGrid', t('Short subject names in week grid'))}
      ${toggle('showBreaks', t('Show breaks and free periods'))}
      ${toggle('showPeriodNumbers', t('Show period numbers'))}
      ${toggle('showNowLine', t('Current time line in week view'))}
      ${toggle('showCountdown', t('Countdown on Home card'))}
    </div>
    <div class="section-title">${esc(t('Title'))}</div>
    <div class="card"><div class="row-pad"><input class="field" data-key="appTitle" placeholder="${esc(t('Custom title on the Home screen'))}" value="${esc(st.appTitle)}" maxlength="30"></div></div>
    <div class="section-title">${esc(t('Subjects'))}</div>
    ${subjects.length ? `<div class="card">${subjects.map(([k, long]) => `<div class="subj-row">
        <label class="sw small" style="--c:${colorFor(k)}"><input type="color" data-subj-color="${esc(k)}" value="${esc(st.subjectColors[k] || PALETTE[hash(k) % PALETTE.length])}"></label>
        <div class="subj-text"><small>${esc(k)}</small><input class="field" data-subj-name="${esc(k)}" placeholder="${esc(long)}" value="${esc(st.subjectNames[k] || '')}"></div>
        ${st.subjectColors[k] || st.subjectNames[k] ? `<button class="icon-btn" data-act="subj-reset" data-k="${esc(k)}" aria-label="Reset">${icon('rotate-ccw')}</button>` : ''}
      </div>`).join('')}</div>` : `<p class="hint">${esc(t('Subjects appear here once your timetable has loaded.'))}</p>`}
    <div class="section-title">${esc(t('Backup'))}</div>
    <div class="card">${row('export-settings', 'upload', t('Copy customization'))}${row('import-settings', 'download', t('Paste customization'))}</div>
    <div class="card"><button class="row danger" data-act="reset-custom"><span class="row-ic">${icon('rotate-ccw')}</span><span class="row-text"><b>${esc(t('Reset customization'))}</b></span></button></div>
    <div class="sheet-foot"></div>`;
  }, { full: true });
}

export { currentTheme, inDays, startOfDay };

// ---------------------------------------------------------------- v4: summary actions, record-next card
/** Homework from a summary as objects (older summaries had plain strings). */
export function hwItems(r) {
  return (r.homework || []).map((h) => (typeof h === 'string' ? { task: h } : { task: h.task || h.text || '', due: h.due || '', dueText: h.dueText || h.when || '', graded: !!h.graded, importance: h.importance || 'normal' })).filter((h) => h.task);
}
export async function summaryHomework(id, i) {
  const x = store.summaries().find((s) => s.id === id);
  if (!x) return;
  const items = hwItems(x.result || {});
  const pick = i == null ? items.map((_, k) => k) : [Number(i)];
  const A = await import('./assist.js');
  const now = toUntisDate(new Date());
  const add = pick.filter((k) => !x.added?.[k]).map((k) => {
    const h = items[k];
    const due = /^\d{4}-\d{2}-\d{2}$/.test(h.due) ? Number(h.due.replace(/-/g, '')) : toUntisDate(addDays(new Date(), 7));
    return { id: `h${Date.now()}${k}`, subject: x.subject, text: `${h.task}${h.graded ? ` (${t('graded')})` : ''}`, due, date: now, graded: h.graded, fromSummary: id };
  });
  if (!add.length) { toast(t('Already added')); return; }
  A.addMyHomework(add);
  const added = { ...(x.added || {}) };
  pick.forEach((k) => { added[k] = true; });
  store.setSummaries(store.summaries().map((s) => (s.id === id ? { ...s, added } : s)));
  toast(t('{n} homework added', { n: add.length }));
  rerenderSheet();
}
export async function summaryTest(id, i) {
  const x = store.summaries().find((s) => s.id === id);
  const ts = x?.result?.tests?.[Number(i)];
  if (!ts) return;
  const { openEventForm } = await import('./planner.js');
  closeSheet(true);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ts.date || '') ? Number(ts.date.replace(/-/g, '')) : toUntisDate(addDays(new Date(), 7));
  setTimeout(() => openEventForm(null, { type: /pr[äa]sent|referat|vortrag/i.test(ts.what || '') ? 'presentation' : /klausur|schulaufgabe|exam/i.test(ts.what || '') ? 'exam' : 'test', date, subject: x.subject }), 300);
  setTimeout(() => { const el = document.getElementById('ev-title'); if (el) el.value = ts.what || t('Test'); const n = document.getElementById('ev-notes'); if (n) n.value = [ts.details, ts.when].filter(Boolean).join(' · '); }, 700);
}
export async function summaryChat(id, text) {
  const x = store.summaries().find((s) => s.id === id);
  if (!x) return;
  const r = x.result || {};
  const A = await import('./assist.js');
  closeSheet(true);
  A.newChat({ title: r.title || t('Lesson summary'), kind: 'free', subject: x.subject, context: `Summary of the student's lesson (${subjLabel(x.subject) || ''}, ${x.date}): ${r.title}. ${r.summary}\nTopics: ${(r.topics || []).join(', ')}\nKey points: ${(r.keyPoints || []).join('; ')}\nHomework: ${hwItems(r).map((h) => h.task).join('; ')}` });
  if (text) setTimeout(() => A.sendAI(text), 350);
}
export async function summaryPdf(id) {
  const x = store.summaries().find((s) => s.id === id);
  if (!x) return;
  const r = x.result || {};
  const md = `# ${r.title || t('Lesson summary')}\n${subjLabel(x.subject) || ''} · ${fmt(fromUntisDate(x.date), { weekday: 'long', day: 'numeric', month: 'long' })}\n\n${r.summary || ''}\n\n## ${t('Key points')}\n${(r.keyPoints || []).map((k) => `- ${k}`).join('\n')}\n\n## ${t('Homework')}\n${hwItems(r).map((h) => `- ${h.task}${h.due ? ` (${h.due})` : ''}${h.graded ? ` – ${t('Graded')}` : ''}`).join('\n') || '-'}\n`;
  const { BLOCKS, saveBlock } = await import('./rich.js');
  const bid = `sum${Date.now()}`;
  BLOCKS[bid] = { name: `${(r.title || 'Lesson').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.pdf`, code: md };
  saveBlock(bid, true);
}
/** Home card: "Record Maths at 09:45?" when the next lesson starts soon (works with the phone locked after that). */
export function recordNextCard() {
  if (!S.settings.recAsk || !hasNative()) return '';
  const now = new Date();
  const nowMin = now.getHours() * 100 + now.getMinutes();
  const list = (lessonsToday() || []).filter((l) => l.code !== 'cancelled' && l.start > nowMin);
  const next = list[0];
  if (!next) return '';
  const mins = (Math.floor(next.start / 100) * 60 + next.start % 100) - (now.getHours() * 60 + now.getMinutes());
  if (mins > 15) return '';
  const k = `${toUntisDate(now)}-${next.start}`;
  if (S.recArmed === k) return `<div class="checkin rec-armed">${icon('mic', 'live')}<div><b>${esc(t('Recording is set up'))}</b><small>${esc(t('{subject} starts at {time}. You can lock the phone.', { subject: subjName(next), time: fmtTime(next.start) }))}</small></div></div>`;
  return `<div class="checkin">${icon('mic')}<div><b>${esc(t('Record {subject}?', { subject: subjName(next) }))}</b><small>${esc(t('Starts at {time}. Recording starts and stops by itself, even with the phone locked.', { time: fmtTime(next.start) }))}</small>
    <div class="ci-btns"><button class="chip ai-chip" data-act="rec-arm" data-start="${next.start}" data-end="${chainEnd(list, next)}" data-subj="${esc(subjKey(next))}">${icon('mic')}${esc(t('Record'))}</button></div></div></div>`;
}
function lessonsToday() { const d = startOfDay(new Date()); const m = addDays(d, -((d.getDay() + 6) % 7)); const data = weekData(m, ownElement()); return data ? prepareDay(data, d) : null; }
function chainEnd(list, first) { let end = first.end; for (const l of list) if (l.start >= end && l.start - end <= 20 && subjKey(l) === subjKey(first)) end = l.end; return end; }
export async function armNext(start, end, subj) {
  const st = await native.request(['microphone', 'notifications']).catch(() => ({}));
  if (st.microphone && st.microphone !== 'granted') { toast(t('Microphone permission is needed'), 'err'); return; }
  const at = (hhmm) => { const d = new Date(); d.setHours(Math.floor(hhmm / 100), hhmm % 100, 0, 0); return d.getTime(); };
  try {
    await native.armRecording({ startAt: at(Number(start)), endAt: at(Number(end)), title: subjLabel(subj) || subj || t('Lesson'), meta: JSON.stringify({ subject: subj, date: toUntisDate(new Date()), start: Number(start), end: Number(end) }) });
    S.recArmed = `${toUntisDate(new Date())}-${start}`;
    toast(t('Recording is set up'));
    render();
  } catch (e) { toast(t(e.message === 'permission' ? 'Microphone permission is needed' : e.message), 'err'); }
}
export function openRecSubjects() {
  const subs = new Map();
  for (const w of Object.values(S.weeks || {})) for (const l of (Array.isArray(w) ? w : [])) for (const x of l.subjects || []) if (x?.name) subs.set(x.name, x.long || x.name);
  const cur = new Set(S.settings.recAskSubjects || []);
  openSheet(() => `<h2 class="sheet-title">${icon('mic')}${esc(t('Ask for these subjects'))}</h2><p class="hint">${esc(t('None selected = all subjects'))}</p>
    <div class="card">${[...subs.entries()].sort().map(([k, long]) => `<label class="row hw-found"><input type="checkbox" data-recsub="${esc(k)}" ${cur.has(k) ? 'checked' : ''}><span class="row-text"><b>${esc(subjLabel(k) || long)}</b></span></label>`).join('') || `<div class="row"><small>${esc(t('Subjects appear here once your timetable has loaded.'))}</small></div>`}</div>
    <button class="btn" data-act="rec-subjects-save">${esc(t('Save'))}</button>`);
}
export function saveRecSubjects() {
  setS('recAskSubjects', [...document.querySelectorAll('[data-recsub]')].filter((x) => x.checked).map((x) => x.dataset.recsub));
  scheduleNative();
  closeSheet();
}
