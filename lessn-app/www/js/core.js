// Shared state, helpers, i18n, theme and small UI building blocks.
import { ICONS } from './icons.js';
import { DICT } from './i18n.js';
import { pad, toUntisDate, fromUntisDate } from './api.js';
import { store } from './store.js';

export { pad, toUntisDate, fromUntisDate, store };
export const VERSION = '4.0.3';

// ---------------------------------------------------------------- basics
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (name, cls = '') => `<svg class="ic ${cls}" data-ic="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
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
const LOCALES = { en: 'en-GB', de: 'de-DE', tr: 'tr-TR', fr: 'fr-FR', es: 'es-ES', pl: 'pl-PL', ru: 'ru-RU', uk: 'uk-UA', ar: 'ar' };
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
  ['oneui-light', 'One UI Light'], ['oneui-dark', 'One UI Dark'],
  ['windows-light', 'Windows 11 Light'], ['windows-dark', 'Windows 11 Dark'], ['ios-light', 'iOS Light'], ['ios-dark', 'iOS Dark'],
  ['sunset', 'Sunset'], ['ocean', 'Ocean'], ['forest', 'Forest'], ['paper', 'Paper'], ['neon', 'Neon'], ['pastel', 'Pastel'],
  ['nord', 'Nord'], ['dracula', 'Dracula'], ['latte', 'Catppuccin Latte'], ['mocha', 'Catppuccin Mocha'], ['rosepine', 'Rosé Pine'],
  ['solarized', 'Solarized'], ['mint', 'Mint'], ['lavender', 'Lavender'], ['contrast', 'High contrast'],
];
// family = surface style, motion = how screens animate in, font = default font of the theme
const THEME_META = {
  'material-light': { family: 'material', motion: 'slide', font: 'system' },
  'material-dark': { family: 'material', motion: 'slide', font: 'system', dark: true },
  'glass-light': { family: 'glass', motion: 'blur', font: 'inter' },
  'glass-dark': { family: 'glass', motion: 'blur', font: 'inter', dark: true },
  amoled: { family: 'material', motion: 'fade', font: 'system', dark: true },
  'oneui-light': { family: 'oneui', motion: 'spring', font: 'system' },
  'oneui-dark': { family: 'oneui', motion: 'spring', font: 'system', dark: true },
  sunset: { family: 'glass', motion: 'bloom', font: 'outfit' },
  ocean: { family: 'glass', motion: 'wave', font: 'outfit', dark: true },
  forest: { family: 'material', motion: 'grow', font: 'nunito', dark: true },
  paper: { family: 'paper', motion: 'flip', font: 'lora' },
  neon: { family: 'neon', motion: 'flicker', font: 'space', dark: true },
  pastel: { family: 'material', motion: 'bounce', font: 'nunito' },
  'windows-light': { family: 'fluent', motion: 'fluent', font: 'segoe' },
  'windows-dark': { family: 'fluent', motion: 'fluent', font: 'segoe', dark: true },
  'ios-light': { family: 'cupertino', motion: 'spring', font: 'system' },
  'ios-dark': { family: 'cupertino', motion: 'spring', font: 'system', dark: true },
  nord: { family: 'material', motion: 'fade', font: 'manrope', dark: true },
  dracula: { family: 'material', motion: 'bloom', font: 'figtree', dark: true },
  latte: { family: 'material', motion: 'bounce', font: 'jakarta' },
  mocha: { family: 'material', motion: 'bounce', font: 'jakarta', dark: true },
  rosepine: { family: 'glass', motion: 'blur', font: 'quicksand', dark: true },
  solarized: { family: 'paper', motion: 'slide', font: 'source-serif' },
  mint: { family: 'oneui', motion: 'spring', font: 'dm-sans' },
  lavender: { family: 'glass', motion: 'bloom', font: 'lexend' },
  contrast: { family: 'material', motion: 'fade', font: 'atkinson', dark: true },
};
export const FONTS = [
  ['theme', 'Theme default'], ['system', 'System'], ['inter', 'Inter'], ['poppins', 'Poppins'], ['nunito', 'Nunito'],
  ['outfit', 'Outfit'], ['space', 'Space Grotesk'], ['lora', 'Lora'], ['mono', 'JetBrains Mono'],
  ['segoe', 'Segoe UI (Windows)'], ['manrope', 'Manrope'], ['dm-sans', 'DM Sans'], ['jakarta', 'Plus Jakarta Sans'], ['figtree', 'Figtree'],
  ['lexend', 'Lexend (easy reading)'], ['quicksand', 'Quicksand'], ['comfortaa', 'Comfortaa'], ['rubik', 'Rubik'], ['montserrat', 'Montserrat'],
  ['fraunces', 'Fraunces'], ['source-serif', 'Source Serif'], ['caveat', 'Caveat (handwriting)'], ['atkinson', 'Atkinson Hyperlegible'], ['dyslexic', 'OpenDyslexic'],
];
const LEGACY = { system: 'auto', light: 'material-light', dark: 'material-dark' };
export function currentTheme() {
  const th = LEGACY[S.settings.theme] || S.settings.theme;
  if (th === 'auto' || !THEME_META[th]) return matchMedia('(prefers-color-scheme: dark)').matches ? 'material-dark' : 'material-light';
  return th;
}
export const themeMeta = () => THEME_META[currentTheme()];
export const isDark = () => !!themeMeta().dark;
export function applyTheme() {
  const s = S.settings;
  const root = document.documentElement;
  const theme = currentTheme();
  root.dataset.theme = theme;
  const meta = themeMeta();
  root.dataset.family = meta.family;
  root.dataset.motion = meta.motion;
  root.dataset.dark = meta.dark ? '1' : '0';
  root.dataset.density = s.density;
  root.dataset.font = !s.font || s.font === 'theme' ? meta.font : s.font;
  root.dataset.anim = s.animations ? '1' : '0';
  root.lang = s.lang;
  root.dir = s.lang === 'ar' ? 'rtl' : 'ltr';
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--r', `${s.radius}px`);
  root.style.fontSize = `${16 * s.fontScale}px`;
  syncBars();
}

// ---------------------------------------------------------------- system bars
/** Resolves a CSS color variable to #rrggbb (also handles color-mix and transparency). */
function cssColor(varName, fallback) {
  const probe = document.createElement('i');
  probe.style.cssText = `position:absolute;width:0;height:0;background:var(${varName})`;
  document.body.appendChild(probe);
  const v = getComputedStyle(probe).backgroundColor;
  probe.remove();
  let r; let g; let b; let a = 1;
  let m = v.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (m) { [r, g, b] = [m[1], m[2], m[3]].map(Number); if (m[4] != null) a = Number(m[4]); }
  else if ((m = v.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?/))) {
    [r, g, b] = [m[1], m[2], m[3]].map((x) => Number(x) * 255); if (m[4] != null) a = Number(m[4]);
  } else return fallback;
  if (a < 0.98) return fallback;
  return `#${[r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
}

let lastBars = '';
/** Paints the status bar / camera cutout area and the navigation bar in the app's colors. */
export function syncBars() {
  if (!document.body) return;
  const top = cssColor('--bg', isDark() ? '#000000' : '#ffffff');
  const fam = document.documentElement.dataset.family;
  const tabs = document.querySelector('nav.tabs');
  const chat = document.getElementById('app')?.classList.contains('chat-mode');
  const solidBottom = (tabs && !chat) || (chat && document.querySelector('.composer'));
  const bottom = solidBottom && fam !== 'glass' ? cssColor('--surface', top) : top;
  $('meta[name=theme-color]')?.setAttribute('content', top);
  const key = `${top}|${bottom}|${isDark()}`;
  if (key === lastBars) return;
  lastBars = key;
  safe(plugin('LessnNative')?.setBars({ top, bottom, dark: isDark() }));
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
// ---------------------------------------------------------------- themed dropdowns, menus and dialogs
/** Registry of the dropdowns on screen: id -> { key, options, value, act } */
const DDS = {};
/** Handlers for picks, set by the app: (act, key, value, label, el) => void */
export const ddHandlers = { pick: null };

function ddReg(key, options, value, act) {
  const id = `${act}:${key}`;
  DDS[id] = { key, options, value: String(value), act };
  return id;
}
const ddLabel = (options, value) => (options.find(([v]) => String(v) === String(value)) || options[0] || ['', ''])[1];

/** A compact dropdown button; opens a themed menu. */
export function seg(key, options, value, act = 'set') {
  const id = ddReg(key, options, value, act);
  return `<button type="button" class="dd" data-dd-open="${esc(id)}"><span class="dd-text">${esc(ddLabel(options, value))}</span>${icon('chevron-down', 'dd-ic')}</button>`;
}
/** A settings row with a label on the left and the current value on the right; opens a themed menu. */
export function dd(label, key, options, value, { sub = '', act = 'set', ic = '' } = {}) {
  const id = ddReg(key, options, value, act);
  return `<button type="button" class="row dd-row" data-dd-open="${esc(id)}">${ic ? `<span class="row-ic">${icon(ic)}</span>` : ''}<span class="row-text"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <span class="dd-val">${esc(ddLabel(options, value))}</span>${icon('chevrons-up-down', 'dd-ic')}</button>`;
}
/** A form field (select) with a hidden input holding the value. */
export function formSelect(id, options, value) {
  ddReg(id, options, value, 'form');
  return `<input type="hidden" id="${esc(id)}" value="${esc(value ?? options[0]?.[0] ?? '')}"><button type="button" class="dd field-dd" data-dd-open="form:${esc(id)}"><span class="dd-text">${esc(ddLabel(options, value))}</span>${icon('chevron-down', 'dd-ic')}</button>`;
}
/** A date field (yyyy-mm-dd in a hidden input) that opens a themed calendar. quick: [[label, Date], ...] */
export function formDate(id, value, quick = []) {
  formDate.quick = { ...(formDate.quick || {}), [id]: quick };
  return `<input type="hidden" id="${esc(id)}" value="${esc(value)}"><button type="button" class="dd field-dd" data-date-open="${esc(id)}">${icon('calendar', 'dd-lead')}<span class="dd-text">${esc(fmtIso(value))}</span>${icon('chevron-down', 'dd-ic')}</button>`;
}
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOfIso = (v) => { const [y, m, d] = String(v).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
function fmtIso(v) { if (!v) return ''; const d = dateOfIso(v); return `${relDay(d)} · ${fmt(d, { day: 'numeric', month: 'short', year: 'numeric' })}`; }

let menuState = null;
export function closeMenu() {
  const root = $('#menu-root');
  if (!menuState || !root) return false;
  menuState = null;
  root.classList.remove('open');
  setTimeout(() => { if (!menuState) root.innerHTML = ''; }, 200);
  return true;
}
function menuRoot() {
  let root = $('#menu-root');
  if (!root) { root = document.createElement('div'); root.id = 'menu-root'; document.body.appendChild(root); }
  return root;
}
/** Places a popover next to its anchor, inside the screen. */
function placePopover(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth; const vh = window.innerHeight;
  const w = Math.min(Math.max(r.width, 220), vw - 24, 340);
  pop.style.width = `${w}px`;
  const rtl = document.documentElement.dir === 'rtl';
  let left = rtl ? r.left : r.right - w;
  left = Math.max(12, Math.min(left, vw - w - 12));
  pop.style.left = `${left}px`;
  const h = Math.min(pop.scrollHeight, vh * 0.6);
  const below = r.bottom + 6;
  const top = below + h > vh - 12 && r.top - h - 6 > 12 ? r.top - h - 6 : Math.min(below, vh - h - 12);
  pop.style.top = `${Math.max(12, top)}px`;
  pop.style.transformOrigin = `${r.left + r.width / 2 - left}px ${top < r.top ? '100%' : '0'}`;
}
/** Opens a themed menu of options under/over the anchor. */
export function openMenu(anchor, options, value, onPick, title = '') {
  closeMenu();
  const root = menuRoot();
  menuState = { onPick };
  // options: [value, label, sub?, tag?]  tag: { text, cls } shown as a pill (e.g. "Free")
  const item = ([v, l, sub, tag]) => `<button type="button" class="pop-item ${sub ? 'two' : ''} ${String(v) === String(value) ? 'on' : ''}" data-v="${esc(v)}" data-q="${esc(`${v} ${l} ${tag?.text || ''}`.toLowerCase())}"><span class="pi-main"><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${tag ? `<em class="pi-tag ${esc(tag.cls || '')}">${esc(tag.text)}</em>` : ''}${String(v) === String(value) ? icon('check') : ''}</button>`;
  // phones: a full-screen picker; PC and tablets: a popover next to the button
  const full = !document.documentElement.classList.contains('desktop') && window.innerWidth < 760;
  const search = options.length > (full ? 9 : 12);
  root.innerHTML = `<div class="menu-scrim"></div><div class="pop-menu ${full ? 'full' : ''} ${search ? 'has-search' : ''}" role="listbox">${full ? `<div class="pop-head"><button type="button" class="icon-btn pop-close" aria-label="${esc(t('Close'))}">${icon('x')}</button><b>${esc(title || t('Choose'))}</b><span></span></div>` : title ? `<div class="pop-title">${esc(title)}</div>` : ''}${search ? `<label class="pop-search">${icon('search')}<input type="search" placeholder="${esc(t('Search'))}" autocomplete="off" autocapitalize="off"></label>` : ''}<div class="pop-list">${options.map(item).join('')}</div></div>`;
  const pop = $('.pop-menu', root);
  if (search) {
    const q = $('.pop-search input', pop);
    q.oninput = () => { const v = q.value.trim().toLowerCase(); for (const b of pop.querySelectorAll('.pop-item')) b.hidden = !!v && !b.dataset.q.includes(v); };
  }
  if (full) { $('.pop-close', pop).onclick = () => closeMenu(); root.classList.add('full'); } else { root.classList.remove('full'); placePopover(pop, anchor); }
  root.getBoundingClientRect();
  root.classList.add('open');
  $('.pop-item.on', pop)?.scrollIntoView({ block: 'center' });
  $('.menu-scrim', root).onclick = () => closeMenu();
  pop.onclick = (e) => {
    const it = e.target.closest('.pop-item');
    if (!it) return;
    const v = it.dataset.v;
    const label = options.find(([x]) => String(x) === v)?.[1] || v;
    const cb = menuState?.onPick;
    closeMenu();
    cb?.(v, label);
  };
}
/** Opens a themed calendar under/over the anchor. */
export function openDatePicker(anchor, value, onPick, quick = []) {
  closeMenu();
  const root = menuRoot();
  const sel = value ? dateOfIso(value) : startOfDay(new Date());
  let month = new Date(sel.getFullYear(), sel.getMonth(), 1);
  menuState = { onPick };
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt(addDays(new Date(2024, 0, 1), i), { weekday: 'narrow' }));
  const draw = () => {
    const startPad = (month.getDay() + 6) % 7;
    const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Array.from({ length: startPad }, () => '<i></i>').concat(Array.from({ length: n }, (_, i) => {
      const d = new Date(month.getFullYear(), month.getMonth(), i + 1);
      return `<button type="button" class="dp-d ${sameDay(d, sel) ? 'on' : ''} ${sameDay(d, new Date()) ? 'today' : ''}" data-v="${isoOf(d)}">${i + 1}</button>`;
    }));
    return `<div class="dp-head"><button type="button" class="icon-btn" data-m="-1">${icon('chevron-left')}</button><b>${esc(fmt(month, { month: 'long', year: 'numeric' }))}</b><button type="button" class="icon-btn" data-m="1">${icon('chevron-right')}</button></div>
      ${quick.length ? `<div class="dp-quick">${quick.map(([l, d]) => `<button type="button" class="chip" data-v="${isoOf(d)}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="dp-grid">${weekdays.map((w) => `<span>${esc(w)}</span>`).join('')}${cells.join('')}</div>`;
  };
  root.innerHTML = `<div class="menu-scrim"></div><div class="pop-menu date-pop">${draw()}</div>`;
  const pop = $('.pop-menu', root);
  placePopover(pop, anchor);
  root.getBoundingClientRect();
  root.classList.add('open');
  $('.menu-scrim', root).onclick = () => closeMenu();
  pop.onclick = (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { month = new Date(month.getFullYear(), month.getMonth() + Number(m.dataset.m), 1); pop.innerHTML = draw(); return; }
    const d = e.target.closest('[data-v]');
    if (!d) return;
    const cb = menuState?.onPick;
    closeMenu();
    cb?.(d.dataset.v);
  };
}

/** Themed confirm dialog. Resolves true/false. */
export function uiConfirm(message, { ok = t('OK'), cancel = t('Cancel'), danger = false, title = '' } = {}) {
  return dialog(`${title ? `<h3>${esc(title)}</h3>` : ''}<p>${esc(message)}</p>`, [[cancel, false, 'ghost'], [ok, true, danger ? 'danger' : '']]);
}
/** Themed text input dialog. Resolves the text or null. */
export function uiPrompt(message, value = '', { ok = t('OK'), cancel = t('Cancel'), multiline = false, placeholder = '' } = {}) {
  const field = multiline
    ? `<textarea class="note" id="dlg-input" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="field" id="dlg-input" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return dialog(`<p>${esc(message)}</p>${field}`, [[cancel, null, 'ghost'], [ok, 'input', '']], true);
}
function dialog(html, buttons, focus = false) {
  return new Promise((resolve) => {
    let root = $('#dialog-root');
    if (!root) { root = document.createElement('div'); root.id = 'dialog-root'; document.body.appendChild(root); }
    root.innerHTML = `<div class="dlg-scrim"></div><div class="dlg" role="dialog">${html}<div class="dlg-btns">${buttons.map(([l, , cls], i) => `<button type="button" class="btn small ${cls}" data-i="${i}">${esc(l)}</button>`).join('')}</div></div>`;
    root.getBoundingClientRect();
    root.classList.add('open');
    const input = $('#dlg-input', root);
    if (focus && input) setTimeout(() => { input.focus(); input.select?.(); }, 120);
    const finish = (v) => {
      root.classList.remove('open');
      dialog.close = null;
      setTimeout(() => { root.innerHTML = ''; }, 200);
      resolve(v);
    };
    dialog.close = () => finish(buttons[0][1]);
    $('.dlg-scrim', root).onclick = () => finish(buttons[0][1]);
    $('.dlg-btns', root).onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const v = buttons[Number(b.dataset.i)][1];
      finish(v === 'input' ? (input?.value ?? '') : v);
    };
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.tagName === 'INPUT') { e.preventDefault(); finish(input.value); } });
  });
}
/** Closes an open dialog (Android back button). */
export function closeDialog() { if (dialog.close) { dialog.close(); return true; } return false; }

// open menus from any [data-dd-open] / [data-date-open] button, in every screen including login
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-dd-open]');
  if (b) {
    e.stopPropagation();
    const d = DDS[b.dataset.ddOpen];
    if (!d) return;
    let title = b.dataset.title || b.querySelector('.row-text b')?.textContent || '';
    for (let p = b.previousElementSibling; !title && p; p = p.previousElementSibling) if (p.classList.contains('lbl')) title = p.textContent;
    openMenu(b, d.options, d.value, (v, label) => {
      d.value = v;
      const txt = b.querySelector('.dd-val, .dd-text');
      if (txt) txt.textContent = label;
      if (d.act === 'form') { const inp = document.getElementById(d.key); if (inp) inp.value = v; ddHandlers.pick?.('form', d.key, v, label, b); return; }
      ddHandlers.pick?.(d.act, d.key, v, label, b);
    }, title);
    return;
  }
  const dbtn = e.target.closest?.('[data-date-open]');
  if (dbtn) {
    e.stopPropagation();
    const id = dbtn.dataset.dateOpen;
    const inp = document.getElementById(id);
    openDatePicker(dbtn, inp?.value, (v) => {
      if (inp) inp.value = v;
      const txt = dbtn.querySelector('.dd-text');
      if (txt) txt.textContent = fmtIso(v);
    }, (formDate.quick || {})[id] || []);
  }
}, true);

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
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; timer = setTimeout(() => { fn(); }, 650); });
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
