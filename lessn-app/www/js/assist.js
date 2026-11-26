// Homework from every source, the AI helper chat, study plans for exams, the tab editor
// and the extra "day plan" sections on Home.
import {
  S, t, $, esc, icon, fmt, relDay, inDays, pad, store, emptyState, skeleton, stagger, openSheet, closeSheet, rerenderSheet,
  toast, colorFor, subjLabel, formSelect, formDate, uiConfirm, toUntisDate, fromUntisDate, daysBetween, startOfDay, addDays, badge, fmtTime,
} from './core.js';
import { chat as aiChat, studyPlan as aiPlan, LANG_NAME, aiReady, linkedAIs, aiFor, aiLabel, PROVIDERS, extractHomework } from './ai.js';
import { native, hasNative } from './native.js';
import { openMenu } from './core.js';
import { client as iservClient, iservOpenUrl } from './iserv-ui.js';
import { render, setView } from './app.js';

const read = (k, d) => { try { const v = localStorage.getItem(`lessn:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(`lessn:${k}`, JSON.stringify(v)); } catch { toast(t('Storage is full'), 'err'); } };

// ================================================================ homework from all sources
export const myHomework = () => read('myhw', []);
const setMyHomework = (v) => write('myhw', v);

export function loadIServTasks() {
  const c = iservClient();
  if (!c || S.iservTasksLoading) return;
  S.iservTasksLoading = true;
  c.exercises().then((list) => { S.iservTasks = list; store.setCache('is-tasks', list); }, () => { S.iservTasks = S.iservTasks || []; })
    .finally(() => { S.iservTasksLoading = false; render(); });
}
S.iservTasks = store.cache('is-tasks')?.data || null;

/** All homework: WebUntis, your own and IServ tasks, in one shape. */
export function allHomework() {
  const out = [];
  for (const h of S.homework || []) out.push({ ...h, source: 'untis', key: `u${h.id}` });
  for (const h of myHomework()) out.push({ ...h, source: 'mine', key: `m${h.id}`, attachments: [], teacher: '', remark: '' });
  for (const x of S.iservTasks || []) {
    out.push({ id: x.id, key: x.id, source: 'iserv', subject: x.tags[0] || '', text: x.title, due: x.due || toUntisDate(new Date()), date: x.start || x.due || 0, url: x.url, completed: x.done, attachments: [], remark: x.tags.slice(1).join(', ') });
  }
  return out;
}
export function hwDoneAny(h) { const m = store.doneHomework(); return h.key in m ? m[h.key] : (h.id in m && h.source === 'untis' ? m[h.id] : !!h.completed); }

/** Date of the next lesson of a subject after a given date (for the due date). */
function nextLessonOf(subject, after) {
  const lessons = Object.values(S.weeks).filter(Array.isArray).flat()
    .filter((l) => l.subjects[0]?.name === subject && l.date > after && l.code !== 'cancelled')
    .sort((a, b) => a.date - b.date);
  return lessons[0] ? fromUntisDate(lessons[0].date) : null;
}

export function openHomeworkForm(prefill = {}) {
  const subs = subjectsKnown();
  const next = prefill.subject ? nextLessonOf(prefill.subject, prefill.date || toUntisDate(new Date())) : null;
  const tomorrow = next || addDays(new Date(), 1);
  openSheet(() => `<h2 class="sheet-title">${icon('square-pen')}${esc(t('Add homework'))}</h2>
    ${aiReady() && !prefill.text ? `<button class="ai-cta" data-act="hw-scan"><span class="ai-orb">${icon('camera')}</span><span><b>${esc(t('Scan with AI'))}</b><small>${esc(t('Photo of the board, worksheet or planner'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
    <input type="file" id="hw-scan" accept="image/*" capture="environment" hidden>` : ''}
    <div class="form">
      <label class="lbl">${esc(t('Subject'))}</label>
      ${formSelect('h-subj', [['', t('No subject')], ...subs.map(([k, long]) => [k, subjLabel(k) || long])], prefill.subject || '')}
      <label class="lbl">${esc(t('What to do'))}</label>
      <textarea class="note" id="h-text" placeholder="${esc(t('e.g. Workbook p. 42, no. 3–7'))}">${esc(prefill.text || '')}</textarea>
      <label class="lbl">${esc(t('Due'))}</label>
      ${formDate('h-due', `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`, [...(next ? [[t('Next lesson'), next]] : []), [t('Tomorrow'), addDays(new Date(), 1)], [t('in {n} days', { n: 2 }), addDays(new Date(), 2)], [t('Next week'), addDays(new Date(), 7)]])}
      <button class="btn" data-act="hw-save">${esc(t('Save'))}</button>
    </div>`);
}
/** Photo -> homework entries found by the AI, which the student confirms. */
let found = [];
export async function scanHomework(files) {
  const f = files?.[0];
  if (!f) return;
  found = null;
  const build = () => `<h2 class="sheet-title">${icon('sparkles')}${esc(t('Scan with AI'))}</h2>
    ${found === null ? `<div class="fv-loading">${icon('refresh-cw', 'spin-ic')}<span>${esc(t('Reading the photo…'))}</span></div>`
    : !found.length ? `<p class="hint">${esc(t('No homework found on this photo.'))}</p>`
      : `<div class="card">${found.map((h, i) => `<label class="row hw-found"><input type="checkbox" data-found="${i}" checked><span class="row-text"><b>${esc(h.text)}</b><small>${esc([subjLabel(h.subject) || h.subject, h.due ? fmt(new Date(h.due), { weekday: 'short', day: 'numeric', month: 'short' }) : ''].filter(Boolean).join(' · '))}</small></span></label>`).join('')}</div>
        <button class="btn" data-act="hw-found-save">${esc(t('Add {n} homework', { n: found.length }))}</button>`}`;
  openSheet(build);
  try {
    const data = await shrink(f, 1600, 0.85);
    const subs = subjectsKnown().map(([k]) => k);
    found = await extractHomework({ images: [{ mime: 'image/jpeg', data: data.split(',')[1] }], subjects: subs, today: new Date().toISOString().slice(0, 10) });
  } catch (e) { found = []; toast(t(e.message), 'err'); }
  const b = $('.sheet-body'); if (b) b.innerHTML = build();
}
export function saveFound() {
  const pick = [...document.querySelectorAll('[data-found]')].filter((x) => x.checked).map((x) => found[Number(x.dataset.found)]);
  const now = toUntisDate(new Date());
  const add = pick.map((h, i) => {
    const due = Number(String(h.due || '').replace(/-/g, '')) || toUntisDate(nextLessonOf(h.subject, now) || addDays(new Date(), 1));
    return { id: `h${Date.now()}${i}`, subject: subjectsKnown().some(([k]) => k === h.subject) ? h.subject : '', text: h.text, due, date: now };
  });
  setMyHomework([...myHomework(), ...add]);
  closeSheet(); render();
  toast(t('{n} homework added', { n: add.length }));
}

export function saveHomework() {
  const text = $('#h-text').value.trim();
  if (!text) { toast(t('Write what you have to do'), 'err'); return; }
  const due = Number($('#h-due').value.replace(/-/g, '')) || toUntisDate(addDays(new Date(), 1));
  setMyHomework([...myHomework(), { id: `h${Date.now()}`, subject: $('#h-subj').value, text, due, date: toUntisDate(new Date()) }]);
  closeSheet();
  render();
  toast(t('Homework saved'));
}

export function openHomework(key) {
  const h = allHomework().find((x) => x.key === key);
  if (!h) return;
  const done = hwDoneAny(h);
  const src = { untis: 'WebUntis', mine: t('Added by you'), iserv: t('IServ task') }[h.source];
  openSheet(() => `<div class="d-head" style="--c:${colorFor(h.subject)}">
      <div class="d-chip">${esc(subjLabel(h.subject) || t('Homework'))}</div>
      <h2>${esc(h.text.split('\n')[0].slice(0, 90))}</h2>
      <p>${esc(t('Due'))} ${esc(relDay(fromUntisDate(h.due)))} · ${esc(fmt(fromUntisDate(h.due), { day: 'numeric', month: 'long' }))}</p>
      <div class="badges">${badge({ cls: 'soft', icon: h.source === 'iserv' ? 'school' : h.source === 'mine' ? 'user' : 'calendar', text: src })}${done ? badge({ cls: 'ok', icon: 'check', text: t('Done') }) : ''}</div>
    </div>
    ${h.text.length > 90 || h.remark ? `<div class="card"><p class="sum-text">${esc(h.text)}${h.remark ? `\n\n${esc(h.remark)}` : ''}</p></div>` : ''}
    <button class="ai-cta" data-act="ai-homework" data-key="${esc(key)}"><span class="ai-orb">${icon('sparkles')}</span><span><b>${esc(t('Get help from AI'))}</b><small>${esc(t('Ask questions or send a photo of the task'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
    <div class="card">
      <button class="row" data-act="hw-toggle-any" data-key="${esc(key)}"><span class="row-ic">${icon(done ? 'rotate-ccw' : 'circle-check')}</span><span class="row-text"><b>${esc(done ? t('Mark as not done') : t('Mark as done'))}</b></span></button>
      ${h.source === 'iserv' ? `<button class="row" data-act="iserv-open" data-url="${esc(h.url)}"><span class="row-ic">${icon('external-link')}</span><span class="row-text"><b>${esc(t('Open in IServ'))}</b><small>${esc(t('Hand in or see attachments'))}</small></span></button>` : ''}
      ${h.source === 'mine' ? `<button class="row danger" data-act="hw-del" data-key="${esc(key)}"><span class="row-ic">${icon('trash-2')}</span><span class="row-text"><b>${esc(t('Delete'))}</b></span></button>` : ''}
    </div>`);
}
export function toggleHomework(key) {
  const h = allHomework().find((x) => x.key === key);
  if (!h) return;
  const v = !hwDoneAny(h);
  store.setHomeworkDone(key, v);
  return v;
}
export function deleteHomework(key) {
  setMyHomework(myHomework().filter((h) => `m${h.id}` !== key));
  closeSheet();
  render();
}

function subjectsKnown() {
  const m = {};
  Object.values(S.weeks).forEach((list) => { if (Array.isArray(list)) list.forEach((l) => { if (l.subjects[0]) m[l.subjects[0].name] = l.subjects[0].long; }); });
  return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
}

// ================================================================ AI chat
const chats = () => read('chats', []);
const saveChats = (list) => write('chats', list.slice(0, 40).map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m, docs: (m.docs || []).map((d) => ({ name: d.name })), images: (m.images || []).map((i) => ({ thumb: i.thumb })) })) })));
const live = {}; // chat id -> messages incl. full image data for this session
let pending = []; // images attached in the composer: { mime, data, thumb } or documents: { doc: true, name, text?, pages? }
let current = null;

/** Recent AI lesson summaries for a subject, newest first. */
export function summariesFor(subject, n = 5) {
  return store.summaries().filter((x) => x.status === 'done' && (!subject || x.subject === subject)).sort((a, b) => b.date - a.date).slice(0, n);
}
const summaryText = (list) => list.map((x) => `- ${fmt(fromUntisDate(x.date), { day: 'numeric', month: 'short' })}: ${x.result.title}. ${x.result.summary} Topics: ${(x.result.topics || []).join(', ')}. Homework: ${(x.result.homework || []).join('; ') || '–'}. Tests: ${(x.result.tests || []).map((ts) => `${ts.what} ${ts.when}`).join('; ') || '–'}`).join('\n');

function systemPrompt(extra) {
  const lang = LANG_NAME[S.settings.lang] || 'German';
  return `You are a friendly, patient tutor for a school student in Germany. Explain step by step and check understanding.
Help the student learn: give hints and explanations before full solutions, but give the full solution if they ask for it.
Reply in ${lang} unless the student writes in another language. Keep answers short and clear, use simple Markdown (bold, lists).
Today is ${fmt(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.
${extra || ''}`;
}

export function newChat({ title, context = '', kind = 'free', subject = '', keepPending = false, go = true } = {}) {
  const c = { id: `c${Date.now()}`, title: title || t('New chat'), context, kind, subject, t: Date.now(), messages: [] };
  saveChats([c, ...chats()]);
  live[c.id] = [];
  current = c.id;
  if (!keepPending) pending = [];
  if (go) setView('ai-chat', 'left');
  return c;
}

export function chatForHomework(key) {
  const h = allHomework().find((x) => x.key === key);
  if (!h) return;
  closeSheet(true);
  const sums = summariesFor(h.subject, 3);
  newChat({
    title: `${subjLabel(h.subject) || t('Homework')}: ${h.text.slice(0, 40)}`, subject: h.subject, kind: 'homework',
    context: `The student needs help with this homework (subject: ${subjLabel(h.subject) || 'unknown'}, due ${fmt(fromUntisDate(h.due), { day: 'numeric', month: 'long' })}):\n"${h.text}"${h.remark ? `\nNote: ${h.remark}` : ''}
${sums.length ? `What was covered in recent lessons of this subject (from recordings):\n${summaryText(sums)}` : ''}`,
  });
}

export function chatForExam(e) {
  closeSheet(true);
  const sums = summariesFor(e.subject, 6);
  const plan = read('plans', {})[examId(e)];
  newChat({
    title: `${t('Exam')}: ${subjLabel(e.subject) || e.name}`, subject: e.subject, kind: 'exam',
    context: `The student is preparing for an exam: ${subjLabel(e.subject)} "${e.name || e.type || ''}" on ${fmt(fromUntisDate(e.date), { weekday: 'long', day: 'numeric', month: 'long' })}. ${e.text || ''}
${sums.length ? `Recent lesson summaries in this subject:\n${summaryText(sums)}` : 'No lesson summaries are available.'}
${plan ? `Their study plan: ${plan.plan.map((d) => `${d.date}: ${d.title}`).join('; ')}` : ''}
Offer to quiz them with practice questions.`,
  });
}

const firstName = () => {
  const u = store.iserv()?.username || S.account?.username || '';
  const f = u.split(/[._\s@-]/)[0];
  return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : '';
};

function suggestions() {
  const out = [];
  const tomorrow = toUntisDate(addDays(new Date(), 1));
  const hw = allHomework().filter((h) => !hwDoneAny(h) && h.due <= tomorrow).sort((a, b) => a.due - b.due)[0];
  if (hw) out.push({ ic: 'clipboard-list', title: t('Help with my homework'), sub: hw.text.slice(0, 60), act: 'ai-homework', data: `data-key="${esc(hw.key)}"` });
  const ex = [...(S.exams || []), ...store.myExams()].filter((e) => e.date >= toUntisDate(new Date())).sort((a, b) => a.date - b.date)[0];
  if (ex) out.push({ ic: 'graduation-cap', title: t('Prepare for my exam'), sub: `${subjLabel(ex.subject) || ex.name} · ${inDays(fromUntisDate(ex.date))}`, act: 'ai-exam', data: `data-id="${esc(examId(ex))}"` });
  const sum = summariesFor('', 1)[0];
  if (sum) out.push({ ic: 'book-open', title: t('Explain my last lesson'), sub: sum.result.title, act: 'ai-prompt', data: `data-text="${esc(t('Explain the most important points of my last lesson ({title}) simply.', { title: sum.result.title }))}"` });
  out.push({ ic: 'camera', title: t('Solve a task from a photo'), sub: t('Take a photo and ask'), act: 'ai-photo', data: '' });
  out.push({ ic: 'lightbulb', title: t('Explain a topic to me'), sub: t('Step by step, like a tutor'), act: 'ai-prompt', data: `data-text="${esc(t('Explain a topic to me'))}"` });
  return out.slice(0, 4);
}

const composer = (placeholder, c) => `<div class="composer-dock">
  ${aiReady() && linkedAIs().length > 1 ? `<button class="ai-switch" data-act="ai-switch">${icon('sparkles')}<span>${esc(aiLabel(aiFor('chat', c?.ai)))}</span>${icon('chevron-down')}</button>` : ''}
  <div class="attach-row" id="attach-row">${pendingHtml()}</div>
  <form class="composer gem" id="ai-composer">
    <button type="button" class="attach" data-act="ai-attach" aria-label="${esc(t('Attach'))}">${icon('plus')}</button>
    <input type="file" id="ai-file" accept="image/*" multiple hidden><input type="file" id="ai-cam" accept="image/*" capture="environment" hidden>
    <input type="file" id="ai-doc" accept=".pdf,.txt,.md,.csv,.json,.html,.xml,.tex,.py,.js,.java,.c,.cpp,application/pdf,text/*" multiple hidden>
    <textarea id="ai-input" rows="1" placeholder="${esc(placeholder)}" enterkeyhint="send"></textarea>
    <button class="send" aria-label="${esc(t('Send'))}">${icon('arrow-up')}</button>
  </form>
  <p class="ai-disclaimer">${esc(t('The AI can make mistakes. Check important answers.'))}</p>
</div>`;

/** Start screen of the AI tab: greeting, suggestions, recent chats and the message bar at the bottom. */
export function viewAI() {
  const list = chats().slice(0, 8);
  const name = firstName();
  return `<div class="chat-wrap ai-home">
    <div class="ai-hero">
      <div class="ai-spark">${icon('sparkles')}</div>
      <h1 class="ai-hello">${esc(name ? t('Hi {name}', { name }) : t('Hi there'))}</h1>
      <h2 class="ai-ask">${esc(t('How can I help you today?'))}</h2>
    </div>
    ${aiReady() ? '' : `<button class="ai-setup" data-act="setup-ai">${icon('key-round')}<span><b>${esc(t('Set up AI'))}</b><small>${esc(t('Choose an AI provider and add your key.'))}</small></span>${icon('chevron-right', 'row-chev')}</button>`}
    <div class="ai-sugs">${suggestions().map((x, i) => `<button class="ai-sug" data-act="${x.act}" ${x.data} style="--i:${i}"><b>${esc(x.title)}</b><small>${esc(x.sub)}</small><span class="ai-sug-ic">${icon(x.ic)}</span></button>`).join('')}</div>
    ${list.length ? `<div class="section-title">${esc(t('Recent'))}</div><div class="ai-recent">${list.map((c) => `<button class="ai-rec" data-act="ai-open" data-id="${c.id}">${icon(c.kind === 'exam' ? 'graduation-cap' : c.kind === 'homework' ? 'clipboard-list' : 'message-square')}<span>${esc(c.title)}</span></button>`).join('')}</div>` : ''}
    <div class="grow"></div>
    ${composer(t('Ask the AI…'), { ai: homeAI })}
  </div>`;
}
let homeAI = '';

export function openChat(id) { current = id; pending = []; setView('ai-chat', 'left'); }
export const chatTitle = () => chats().find((c) => c.id === current)?.title || t('AI helper');

export function md(s) {
  return esc(s)
    .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<b class="md-h">$1</b>')
    .replace(/^\s*[-*] (.+)$/gm, '<span class="md-li">$1</span>')
    .replace(/^\s*(\d+)\. (.+)$/gm, '<span class="md-li num"><em>$1.</em> $2</span>')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(<\/span>|<\/b>)\n(?=<span class="md-li)/g, '$1')
    .replace(/(class="md-h">[^<]*<\/b>)\n/g, '$1')
    .trim();
}

function chatMessages(c) {
  const msgs = live[c.id] || c.messages;
  const intro = c.context ? `<div class="ai-context">${icon('info')}<span>${esc(t('The AI knows about this task and your recent lessons.'))}</span></div>` : '';
  const many = linkedAIs().length > 1;
  return intro + msgs.map((m, i) => (m.role === 'user'
    ? `<div class="gm-user">${(m.images || []).filter((x) => x.thumb).map((x) => `<img class="msg-img" src="${x.thumb}" alt="">`).join('')}${(m.docs || []).map((d) => `<span class="msg-doc">${icon('file-text')}${esc(d.name)}</span>`).join('')}${m.text ? `<div class="gm-ubub">${esc(m.text)}</div>` : ''}</div>`
    : `<div class="gm-ai ${m.alt ? 'alt' : ''}"><span class="gm-spark">${icon('sparkles')}</span><div class="gm-text">${m.by && (many || m.alt) ? `<small class="gm-by">${esc(m.by)}</small>` : ''}${md(m.text)}${m.note ? `<small class="gm-note">${icon('info')}${esc(m.note)}</small>` : ''}
      <div class="gm-acts"><button data-act="ai-copy" data-i="${i}" aria-label="${esc(t('Copy'))}">${icon('copy')}</button>${many ? `<button data-act="ai-retry" data-i="${i}">${icon('refresh-cw')}<span>${esc(t('Ask another AI'))}</span></button>` : ''}</div></div></div>`)).join('')
    + (S.aiThinking === c.id ? `<div class="gm-ai thinking"><span class="gm-spark spin">${icon('sparkles')}</span><div class="gm-text"><span class="shimmer">${esc(t('Thinking…'))}</span><i class="gm-line"></i><i class="gm-line short"></i></div></div>` : '');
}

export function viewAIChat() {
  const c = chats().find((x) => x.id === current);
  if (!c) return emptyState('sparkles', t('No chat selected'));
  setTimeout(() => { const m = $('#main'); if (m) m.scrollTop = m.scrollHeight; }, 0);
  const starters = c.kind === 'exam' ? [t('Quiz me with 5 questions'), t('Explain the most important topics'), t('What should I learn today?')]
    : c.kind === 'homework' ? [t('Explain how to start'), t('Give me a hint'), t('Check my solution')]
      : [t('Explain a topic to me'), t('Help me with my homework'), t('Make a summary of my last lesson')];
  const empty = !(live[c.id] || c.messages).length;
  return `<div class="chat-wrap">
    <div class="chat gem-chat"><div id="msgs" class="msgs">${chatMessages(c)}</div>
    ${empty && !S.aiThinking ? `<div class="starters">${starters.map((x) => `<button class="chip" data-act="ai-starter" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}</div>
    ${composer(t('Ask the AI…'), c)}
  </div>`;
}
const pendingHtml = () => pending.map((p, i) => `<span class="att-prev ${p.doc ? 'doc' : ''}">${p.doc ? `${icon('file-text')}<small>${esc(p.name)}</small>` : `<img src="${p.thumb}" alt="">`}<button data-act="ai-unattach" data-i="${i}">${icon('x')}</button></span>`).join('');

/** "+" in the AI composer: photos, camera, documents. */
export function openAiAttach() {
  openSheet(() => `<div class="attach-grid">
    <button data-act="pick" data-input="ai-file"><span style="--c:#8e4ec6">${icon('image')}</span>${esc(t('Photos'))}</button>
    <button data-act="pick" data-input="ai-cam"><span style="--c:#e5484d">${icon('camera')}</span>${esc(t('Camera'))}</button>
    <button data-act="pick" data-input="ai-doc"><span style="--c:#0090ff">${icon('file-text')}</span>${esc(t('Document'))}</button>
    <button data-act="ai-attach-iserv"><span style="--c:#12a594">${icon('folders')}</span>${esc(t('IServ files'))}</button>
  </div>`);
}

/** Switch the AI for this chat (all linked AIs). */
export function switchAI(anchor) {
  const c = chats().find((x) => x.id === current);
  const cur = aiFor('chat', S.view === 'ai-chat' ? c?.ai : homeAI).provider;
  openMenu(anchor, linkedAIs().map((x) => [x.provider, x.p.name.replace(/ \(.*\)$/, ''), x.model]), cur, (v) => {
    if (S.view === 'ai-chat' && c) { c.ai = v; saveChats([c, ...chats().filter((x) => x.id !== c.id)]); } else homeAI = v;
    const lbl = $('.ai-switch span'); if (lbl) lbl.textContent = aiLabel(aiFor('chat', v));
  }, t('Answer with'));
}

/** Ask the same question again with another linked AI (answers stay side by side). */
export function retryWith(anchor, idx) {
  const c = chats().find((x) => x.id === current);
  if (!c) return;
  const others = linkedAIs();
  openMenu(anchor, others.map((x) => [x.provider, x.p.name.replace(/ \(.*\)$/, ''), x.model]), '', async (v) => {
    const msgs = live[c.id] || (live[c.id] = c.messages.map((m) => ({ ...m })));
    const upto = msgs.slice(0, Number(idx)).filter((m) => !m.alt).map((m) => (m.docText ? { ...m, text: m.text + m.docText } : m));
    S.aiThinking = c.id; repaint(c);
    try {
      const r = await aiChat({ messages: upto, system: systemPrompt(c.context), provider: v });
      msgs.splice(Number(idx) + 1, 0, { role: 'model', text: r.text, by: r.name, alt: true });
    } catch (e) { toast(t(e.message), 'err'); }
    S.aiThinking = null;
    c.messages = msgs; saveChats([c, ...chats().filter((x) => x.id !== c.id)]);
    repaint(c);
  }, t('Ask another AI'));
}
export function copyAnswer(idx) {
  const c = chats().find((x) => x.id === current);
  const m = (live[c?.id] || c?.messages || [])[Number(idx)];
  if (m) navigator.clipboard?.writeText(m.text).then(() => toast(t('Copied')), () => {});
}

/** Reads documents for the AI: PDFs become page images (native), text files are read as text. */
export async function attachDocs(files) {
  for (const f of [...files].slice(0, 3)) {
    try {
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        if (!hasNative()) { toast(t('PDFs can only be read in the Android app'), 'err'); continue; }
        const data = await fileToB64(f);
        const tmp = await native.writeCache(f.name, data);
        pending.push({ doc: true, name: f.name, pages: await pdfImages(tmp.path, 6) });
      } else {
        const text = await f.text();
        pending.push({ doc: true, name: f.name, text: text.slice(0, 60000) });
      }
    } catch { toast(t('Could not read {name}', { name: f.name }), 'err'); }
  }
  $('#attach-row').innerHTML = pendingHtml();
}
/** Adds an already-downloaded file (e.g. from IServ) to the next AI message. */
export async function attachPath({ path, name, mime }) {
  if (typeof arguments[0].text === 'string') { pending.push({ doc: true, name, text: arguments[0].text.slice(0, 60000) }); return; }
  if (/pdf/.test(mime)) pending.push({ doc: true, name, pages: await pdfImages(path, 6) });
  else if (/^image\//.test(mime)) { const r = await native.readFile(path); pending.push({ mime, data: r.data, thumb: `data:${mime};base64,${r.data}` }); }
  else { const r = await native.readFile(path); pending.push({ doc: true, name, text: new TextDecoder().decode(Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0))).slice(0, 60000) }); }
}
export async function pdfImages(path, max) {
  const out = [];
  const first = await native.pdfPage(path, 0, 1100);
  out.push({ mime: 'image/jpeg', data: first.data });
  for (let i = 1; i < Math.min(first.pages, max); i++) out.push({ mime: 'image/jpeg', data: (await native.pdfPage(path, i, 1100)).data });
  return out;
}
const fileToB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
export function unattach(i) { pending.splice(i, 1); $('#attach-row').innerHTML = pendingHtml(); }

/** Shrinks a photo so it uploads fast: max 1600 px, JPEG. */
function shrink(file, max, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}
export async function attachFiles(files) {
  for (const f of [...files].slice(0, 4)) {
    try {
      const full = await shrink(f, 1600, 0.85);
      const thumb = await shrink(f, 360, 0.7);
      pending.push({ mime: 'image/jpeg', data: full.split(',')[1], thumb });
    } catch { toast(t('Could not read that image'), 'err'); }
  }
  $('#attach-row').innerHTML = pendingHtml();
}

export async function sendAI(textOverride) {
  const input = $('#ai-input');
  const text = (textOverride ?? input?.value ?? '').trim();
  if (!text && !pending.length) return;
  if (!aiReady()) { toast(t('Add an AI key first.'), 'err'); return; }
  if (S.view === 'ai') { newChat({ keepPending: true }); const nc = chats()[0]; if (homeAI && nc) { nc.ai = homeAI; saveChats([nc, ...chats().slice(1)]); } }
  const list = chats();
  const c = list.find((x) => x.id === current);
  if (!c) return;
  const msgs = live[c.id] || (live[c.id] = c.messages.map((m) => ({ ...m })));
  const docs = pending.filter((p) => p.doc);
  const imgs = pending.filter((p) => !p.doc);
  const docText = docs.filter((d) => d.text).map((d) => `\n\n[${d.name}]\n${d.text}`).join('');
  msgs.push({ role: 'user', text: (text || (docs.length ? t('Please look at this document.') : t('Please look at this picture.'))), images: [...imgs, ...docs.flatMap((d) => d.pages || [])], docs: docs.map((d) => ({ name: d.name })), docText });
  pending = [];
  if (input) { input.value = ''; input.style.height = ''; }
  S.aiThinking = c.id;
  repaint(c);
  try {
    const r = await aiChat({ messages: msgs.filter((m) => !m.alt).map((m) => (m.docText ? { ...m, text: m.text + m.docText } : m)), system: systemPrompt(c.context), provider: c.ai || (S.view === 'ai-chat' ? '' : homeAI) });
    msgs.push({ role: 'model', text: r.text, by: r.name, note: r.fellBack ? t('{name} answered because the other AI failed.', { name: r.name.split(' · ')[0] }) : '' });
  } catch (e) {
    msgs.push({ role: 'model', text: `⚠ ${t(e.message)}` });
  }
  S.aiThinking = null;
  c.messages = msgs;
  c.t = Date.now();
  if (c.title === t('New chat') && text) c.title = text.slice(0, 48);
  saveChats([c, ...chats().filter((x) => x.id !== c.id)]);
  if (S.view === 'ai-chat' && current === c.id) {
    repaint(c);
    const title = $('#title');
    if (title) title.textContent = c.title;
  }
}
function repaint(c) {
  const box = $('#msgs');
  if (!box) return;
  box.innerHTML = chatMessages(c);
  $('.starters')?.remove();
  $('#attach-row').innerHTML = pendingHtml();
  const m = $('#main');
  requestAnimationFrame(() => { m.scrollTop = m.scrollHeight; });
}
export function deleteChat(id) { saveChats(chats().filter((c) => c.id !== id)); delete live[id]; setView('ai', 'right'); }

// ================================================================ exams & study plans
export const examId = (e) => String(e.id ?? `${e.date}-${e.subject}`);
const plans = () => read('plans', {});
const savePlans = (p) => write('plans', p);

export function openExam(e) {
  const d = fromUntisDate(e.date);
  const sums = summariesFor(e.subject, 6);
  openSheet(() => {
    const p = plans()[examId(e)];
    const doneMap = read('plandone', {});
    return `<div class="d-head" style="--c:${colorFor(e.subject)}">
      <div class="d-chip">${esc(subjLabel(e.subject) || t('Exam'))}</div>
      <h2>${esc(e.name || e.type || t('Exam'))}</h2>
      <p>${esc(fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${e.start ? ` · ${fmtTime(e.start)}–${fmtTime(e.end)}` : ''} · ${esc(inDays(d))}</p>
      ${e.text ? `<div class="l-info">${icon('info')}<span>${esc(e.text)}</span></div>` : ''}
    </div>
    <button class="ai-cta" data-act="ai-exam" data-id="${esc(examId(e))}"><span class="ai-orb">${icon('sparkles')}</span><span><b>${esc(t('Study with AI'))}</b><small>${esc(sums.length ? t('Uses your {n} lesson summaries', { n: sums.length }) : t('Explanations and practice questions'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
    <div class="section-title">${icon('calendar-check')}${esc(t('Study plan'))}</div>
    ${S.planBusy === examId(e) ? `<div class="processing">${icon('sparkles', 'spin-slow')}<span>${esc(t('Making your plan…'))}</span></div>`
    : p ? `${p.plan.map((day) => {
      const dd = new Date(day.date);
      const past = !Number.isNaN(dd.getTime()) && daysBetween(dd, new Date()) > 0;
      return `<div class="plan-day ${past ? 'past' : ''}"><div class="plan-date"><b>${Number.isNaN(dd.getTime()) ? '' : dd.getDate()}</b><span>${Number.isNaN(dd.getTime()) ? esc(day.date) : esc(fmt(dd, { weekday: 'short' }))}</span></div>
        <div class="plan-body"><b>${esc(day.title)}</b>${(day.tasks || []).map((task, i) => {
          const k = `${examId(e)}|${day.date}|${i}`;
          return `<button class="plan-task ${doneMap[k] ? 'done' : ''}" data-act="plan-toggle" data-k="${esc(k)}"><span class="check">${icon('check')}</span><span>${esc(task)}</span></button>`;
        }).join('')}${day.minutes ? `<small>${icon('timer')}${day.minutes} min</small>` : ''}</div></div>`;
    }).join('')}${p.tips?.length ? `<div class="card"><p class="sum-text">${p.tips.map((x) => `• ${esc(x)}`).join('\n')}</p></div>` : ''}
      <button class="btn small ghost" data-act="plan-make" data-id="${esc(examId(e))}">${icon('refresh-cw')}${esc(t('Make a new plan'))}</button>`
      : `<p class="hint">${esc(sums.length ? t('The AI uses your lesson summaries to plan what to learn each day.') : t('Record lessons in this subject to get a plan based on what was taught.'))}</p>
      <button class="btn" data-act="plan-make" data-id="${esc(examId(e))}">${icon('sparkles')}${esc(t('Make a study plan'))}</button>`}
  `;
  }, { full: true });
}

export async function makePlan(e) {
  if (!aiReady()) { toast(t('Add an AI key first.'), 'err'); return; }
  const id = examId(e);
  S.planBusy = id;
  rerenderSheet();
  try {
    const d = fromUntisDate(e.date);
    const iso = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
    const sums = summariesFor(e.subject, 8).map((x) => ({ date: iso(fromUntisDate(x.date)), title: x.result.title, topics: x.result.topics || [], keyPoints: x.result.keyPoints || [] }));
    const res = await aiPlan({
      lang: S.settings.lang, today: iso(new Date()),
      exam: { date: iso(d), subject: subjLabel(e.subject), name: e.name || e.type || '', text: e.text || '' }, summaries: sums,
    });
    savePlans({ ...plans(), [id]: { ...res, subject: e.subject, examDate: e.date, name: e.name || e.type || '', t: Date.now() } });
    toast(t('Study plan ready'));
  } catch (err) { toast(t(err.message), 'err'); }
  S.planBusy = null;
  rerenderSheet();
  render();
}
export function togglePlanTask(k) {
  const m = read('plandone', {});
  m[k] = !m[k];
  write('plandone', m);
  rerenderSheet();
  render();
}

// ================================================================ Home: day plan sections
export function homeExtras() {
  const today = toUntisDate(new Date());
  const tomorrow = toUntisDate(addDays(new Date(), 1));
  const out = [];
  // homework due today / tomorrow / overdue
  const due = allHomework().filter((h) => !hwDoneAny(h) && h.due <= tomorrow && h.due >= today - 7).sort((a, b) => a.due - b.due);
  if (due.length) {
    out.push(`<div class="section-title">${icon('list-checks')}${esc(t('Homework due'))}</div><div class="card">${due.slice(0, 5).map((h) => `<button class="d-row tap" data-act="hw-open" data-key="${esc(h.key)}" style="--c:${colorFor(h.subject)}">
      <span class="dot-c"></span><div><span>${esc(h.text.split('\n')[0].slice(0, 70))}</span><small>${esc(subjLabel(h.subject) || (h.source === 'iserv' ? 'IServ' : t('Homework')))} · <b class="${h.due < today ? 'bad' : ''}">${esc(relDay(fromUntisDate(h.due)))}</b></small></div></button>`).join('')}</div>`);
  }
  // study plan tasks for today
  const iso = `${String(today).slice(0, 4)}-${String(today).slice(4, 6)}-${String(today).slice(6)}`;
  const doneMap = read('plandone', {});
  const study = [];
  for (const [id, p] of Object.entries(plans())) {
    if (p.examDate < today) continue;
    const day = (p.plan || []).find((d) => d.date === iso);
    if (day) (day.tasks || []).forEach((task, i) => study.push({ k: `${id}|${day.date}|${i}`, task, subject: p.subject, title: day.title, examDate: p.examDate }));
  }
  if (study.length) {
    out.push(`<div class="section-title">${icon('graduation-cap')}${esc(t('Study today'))}</div><div class="card">${study.map((x) => `<button class="plan-task row-like ${doneMap[x.k] ? 'done' : ''}" data-act="plan-toggle" data-k="${esc(x.k)}" style="--c:${colorFor(x.subject)}">
      <span class="check">${icon('check')}</span><span><b>${esc(x.task)}</b><small>${esc(subjLabel(x.subject))} · ${esc(t('Exam'))} ${esc(inDays(fromUntisDate(x.examDate)))}</small></span></button>`).join('')}</div>`);
  }
  // IServ notifications
  const notes = (S.iservData?.notifications || []).filter((n) => !n.read).slice(0, 3);
  if (notes.length) {
    out.push(`<div class="section-title">${icon('bell')}IServ</div><div class="card">${notes.map((n) => `<button class="d-row tap unread" data-act="is-note" data-id="${esc(n.id)}" data-url="${esc(n.url)}">${icon('bell')}<div><span>${esc(n.title)}</span><small>${esc(n.text)}</small></div></button>`).join('')}</div>`);
  }
  return out.join('');
}

// ================================================================ tabs
export const TAB_DEFS = {
  today: { label: 'Home', icon: 'house' },
  week: { label: 'Week', icon: 'calendar-range' },
  tasks: { label: 'Homework', icon: 'list-checks' },
  exams: { label: 'Exams', icon: 'graduation-cap' },
  iserv: { label: 'IServ', icon: 'school' },
  ai: { label: 'AI', icon: 'sparkles' },
  grades: { label: 'Grades', icon: 'award' },
  attendance: { label: 'Attendance', icon: 'calendar-check' },
  recorder: { label: 'Recorder', icon: 'mic' },
};
export const userTabs = () => (S.settings.tabs || ['today', 'week', 'tasks', 'exams']).filter((x) => TAB_DEFS[x]).slice(0, 4);

export function openTabEditor() {
  openSheet(() => {
    const tabs = userTabs();
    const rest = Object.keys(TAB_DEFS).filter((k) => !tabs.includes(k));
    return `<h2 class="sheet-title">${icon('layout-grid')}${esc(t('Tabs'))}</h2>
    <p class="hint">${esc(t('Pick up to 4 tabs. Menu is always there, so you can still reach everything.'))}</p>
    <div class="card">${tabs.map((k, i) => `<div class="row tab-edit"><span class="row-ic">${icon(TAB_DEFS[k].icon)}</span><span class="row-text"><b>${esc(t(TAB_DEFS[k].label))}</b></span>
      <button class="icon-btn" data-act="tab-move" data-k="${k}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>${icon('chevron-up')}</button>
      <button class="icon-btn" data-act="tab-move" data-k="${k}" data-dir="1" ${i === tabs.length - 1 ? 'disabled' : ''}>${icon('chevron-down')}</button>
      <button class="icon-btn danger-ic" data-act="tab-remove" data-k="${k}" ${tabs.length <= 1 ? 'disabled' : ''}>${icon('x')}</button></div>`).join('')}
      <div class="row tab-edit static"><span class="row-ic">${icon('layout-grid')}</span><span class="row-text"><b>${esc(t('Menu'))}</b><small>${esc(t('Always shown'))}</small></span></div></div>
    ${rest.length ? `<div class="section-title">${esc(t('Add a tab'))}</div><div class="card">${rest.map((k) => `<button class="row" data-act="tab-add" data-k="${k}" ${tabs.length >= 4 ? 'disabled' : ''}><span class="row-ic">${icon(TAB_DEFS[k].icon)}</span><span class="row-text"><b>${esc(t(TAB_DEFS[k].label))}</b></span>${icon('plus', 'row-chev')}</button>`).join('')}</div>` : ''}
    ${tabs.length >= 4 ? `<p class="hint">${esc(t('Remove a tab first to add another one.'))}</p>` : ''}`;
  });
}
export function editTabs(action, k, dir) {
  const tabs = userTabs();
  if (action === 'remove' && tabs.length > 1) tabs.splice(tabs.indexOf(k), 1);
  if (action === 'add' && tabs.length < 4 && !tabs.includes(k)) tabs.push(k);
  if (action === 'move') { const i = tabs.indexOf(k); const j = i + dir; if (j >= 0 && j < tabs.length) [tabs[i], tabs[j]] = [tabs[j], tabs[i]]; }
  S.settings.tabs = tabs;
  store.saveSettings(S.settings);
  rerenderSheet();
  return tabs;
}

export { iservOpenUrl, startOfDay };
