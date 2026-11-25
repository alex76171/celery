// Shared state, helpers, i18n, theme and small UI building blocks.
import { ICONS } from './icons.js';
import { DICT } from './i18n.js';
import { pad, toUntisDate, fromUntisDate } from './api.js';
import { store } from './store.js';

export { pad, toUntisDate, fromUntisDate, store };
export const VERSION = '2.1.0';

// ---------------------------------------------------------------- basics
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
export const plugin = (name) => window.Capacitor?.Plugins?.[name];
export const safe = (p) => { try { p?.catch?.(() => {}); } catch { /* ignore */ } };

// ---------------------------------------------------------------- state
export const S = {
  settings: store.settings(),
  account: store.account(),
  api: null,
  view: 'today',
  day: null,
  week: null,
  element: null,
  weeks: {},
  timegrid: store.cache('timegrid')?.data || [],
  holidays: store.cache('holidays')?.data || [],
  homework: store.cache('homework')?.data || null,
  exams: store.cache('exams')?.data || null,
  news: store.cache('news')?.data || null,
  grades: store.cache('grades')?.data || null,
  gradesError: false,
  absences: store.cache('absences')?.data || null,
  iserv: null,
  iservData: store.cache('iserv')?.data || null,
  elements: {},
  hwFilter: 'open',
  loading: 0,
  offline: false,
  lastRefresh: store.cache('lastRefresh')?.data || 0,
  index: {},
  anim: null, // next render's entrance animation
};

// ---------------------------------------------------------------- i18n
export function t(str, vars) {
  const d = DICT[S.settings.lang];
  let out = (d && d[str]) || str;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return out;
}
const LOCALES = { en: 'en-GB', de: 'de-DE', tr: 'tr-TR', fr: 'fr-FR' };
export const locale = () => LOCALES[S.settings.lang] || navigator.language || 'en';
export const fmt = (d, o) => d.toLocaleDateString(locale(), o);

// ---------------------------------------------------------------- dates
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return startOfDay(x); };
export const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const sameDay = (a, b) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };
export const fmtTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
export const durText = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
export const weekNumber = (d) => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y) / 864e5 + 1) / 7); };
export function relDay(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return t('Today');
  if (n === 1) return t('Tomorrow');
  if (n === -1) return t('Yesterday');
  if (n > 1 && n < 7) return fmt(d, { weekday: 'long' });
  return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function inDays(d) {
  const n = daysBetween(new Date(), d);
  if (n === 0) return t('today');
  if (n === 1) return t('tomorrow');
  if (n > 1) return t('in {n} days', { n });
  if (n === -1) return t('yesterday');
  return t('{n} days ago', { n: -n });
}
S.day = startOfDay(new Date());
S.week = mondayOf(new Date());

// ---------------------------------------------------------------- subjects & colors
export const PALETTE = ['#4f6bff', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#12a594', '#d6409f', '#e2a300', '#0090ff', '#7c66dc', '#46a758', '#e54666', '#00a2c7', '#a18072', '#5b5bd6', '#ca5a2d'];
export const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
export const subjKey = (l) => l.subjects[0]?.name || l.activity || l.text || 'Event';
export function subjName(l, short = false) {
  const k = subjKey(l);
  const s = S.settings;
  if (s.subjectNames[k]) return s.subjectNames[k];
  const su = l.subjects[0];
  if (!su) return l.text || l.activity || t('Event');
  if (short) return su.name;
  return s.subjectLongNames ? su.long || su.name : su.name;
}
/** Display name for a short subject code (used where only the code is known). */
export function subjLabel(k) {
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
export function colorFor(key) {
  const s = S.settings;
  if (s.colorMode === 'accent') return s.accent;
  if (s.colorMode === 'mono') return 'var(--mono)';
  return s.subjectColors[key] || PALETTE[hash(key) % PALETTE.length];
}
export const personText = (list) => list.map((x) => (S.settings.teacherLongNames ? x.long : x.name)).filter(Boolean).join(', ');

// ---------------------------------------------------------------- feedback
export function haptic(style = 'LIGHT') {
  if (S.settings.haptics) safe(plugin('Haptics')?.impact({ style }));
}
let toastTimer;
export function toast(msg, kind = '') {
  const el = $('#toast');
  if (!el) return;
  el.className = `toast show ${kind}`;
  el.innerHTML = `${icon(kind === 'err' ? 'circle-alert' : 'check')}<span>${esc(msg)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

// ---------------------------------------------------------------- theme
export const THEMES = [
  ['auto', 'Auto'], ['material-light', 'Material Light'], ['material-dark', 'Material Dark'],
  ['glass-light', 'Liquid Glass Light'], ['glass-dark', 'Liquid Glass Dark'], ['amoled', 'Black'],
];
const LEGACY = { system: 'auto', light: 'material-light', dark: 'material-dark' };
export function currentTheme() {
  const th = LEGACY[S.settings.theme] || S.settings.theme;
  if (th === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'material-dark' : 'material-light';
  return th;
}
export const isDark = () => /dark|amoled/.test(currentTheme());
export function applyTheme() {
  const s = S.settings;
  const root = document.documentElement;
  const theme = currentTheme();
  root.dataset.theme = theme;
  root.dataset.family = theme.startsWith('glass') ? 'glass' : 'material';
  root.dataset.dark = isDark() ? '1' : '0';
  root.dataset.density = s.density;
  root.dataset.font = s.font;
  root.dataset.anim = s.animations ? '1' : '0';
  root.lang = s.lang;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--r', `${s.radius}px`);
  root.style.fontSize = `${16 * s.fontScale}px`;
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  $('meta[name=theme-color]')?.setAttribute('content', bg);
  safe(plugin('SystemBars')?.setStyle({ style: isDark() ? 'DARK' : 'LIGHT' }));
}

// ---------------------------------------------------------------- components
export const stagger = (i) => (S.settings.animations ? ` style="--i:${Math.min(i, 14)}"` : '');
export function emptyState(ic, title, text = '') {
  return `<div class="empty pop">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}</div>`;
}
export const skeleton = (n = 5) => `<div class="skel-list">${Array.from({ length: n }, (_, i) => `<div class="skel" style="--i:${i}"></div>`).join('')}</div>`;
export function row(act, ic, title, sub = '', extra = '', right = '') {
  return `<button class="row" data-act="${act}" ${extra}><span class="row-ic">${icon(ic)}</span><span class="row-text"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${right}${icon('chevron-right', 'row-chev')}</button>`;
}
export function seg(key, options, value, act = 'set') {
  return `<div class="seg" data-key="${key}">${options.map(([v, label]) => `<button class="${String(value) === String(v) ? 'on' : ''}" data-act="${act}" data-key="${key}" data-val="${esc(v)}">${esc(label)}</button>`).join('')}</div>`;
}
export function toggle(key, label, sub = '', act = 'toggle') {
  const on = !!S.settings[key];
  return `<button class="row toggle-row" data-act="${act}" data-key="${key}"><span class="row-text"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="switch ${on ? 'on' : ''}"><i></i></span></button>`;
}
export const badge = (b) => `<span class="badge ${b.cls}">${icon(b.icon)}${esc(b.text)}</span>`;

// ---------------------------------------------------------------- sheets
export let sheetState = null;
export function openSheet(build, { full = false, onClose } = {}) {
  closeSheet(true);
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim" data-act="close-sheet"></div><div class="sheet ${full ? 'full' : ''}"><div class="grab"></div><div class="sheet-body"></div></div>`;
  sheetState = {
    build, onClose,
    rerender() {
      const body = $('.sheet-body', root);
      if (!body) return;
      const st = body.scrollTop;
      body.innerHTML = build();
      body.scrollTop = st;
    },
  };
  sheetState.rerender();
  const mine = sheetState;
  root.getBoundingClientRect();
  requestAnimationFrame(() => { if (sheetState === mine) root.classList.add('open'); });
  history.pushState({ sheet: true }, '');
  bindSheetDrag($('.sheet', root));
}
export function closeSheet(silent = false) {
  if (!sheetState) return false;
  const root = $('#sheet-root');
  const st = sheetState;
  sheetState = null;
  root.classList.remove('open');
  setTimeout(() => { if (!sheetState) root.innerHTML = ''; }, 320);
  st.onClose?.();
  if (!silent && history.state?.sheet) history.back();
  return true;
}
export const rerenderSheet = () => sheetState?.rerender();
function bindSheetDrag(sheet) {
  const grab = $('.grab', sheet);
  let y0 = null;
  let last = 0;
  let lastT = 0;
  grab.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; last = y0; lastT = Date.now(); sheet.style.transition = 'none'; }, { passive: true });
  grab.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const y = e.touches[0].clientY;
    const d = y - y0;
    sheet.style.transform = `translateY(${d > 0 ? d : d / 4}px)`;
    last = y; lastT = Date.now();
  }, { passive: true });
  grab.addEventListener('touchend', (e) => {
    const y = e.changedTouches[0].clientY;
    const d = y - (y0 ?? y);
    const v = (y - last) / Math.max(1, Date.now() - lastT);
    y0 = null; sheet.style.transition = ''; sheet.style.transform = '';
    if (d > 110 || v > 0.6) closeSheet();
  });
}
window.addEventListener('popstate', () => { if (sheetState) closeSheet(true); });

// ---------------------------------------------------------------- hidden-trigger helpers
export function bindLongPress(el, fn) {
  let timer;
  let x0 = 0;
  let y0 = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; timer = setTimeout(() => { haptic('MEDIUM'); fn(); }, 650); });
  el.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 10) cancel(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => el.addEventListener(ev, cancel));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** Press ripple used on cards and buttons. */
export function bindRipple() {
  document.addEventListener('pointerdown', (e) => {
    if (!S.settings.animations) return;
    const el = e.target.closest('.lesson, .row:not(.static), .tile, .btn, .chip, .hw, .exam, .dpill, .result, .news, .now-card');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const d = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    el.appendChild(s);
    setTimeout(() => s.remove(), 600);
  }, { passive: true });
}
