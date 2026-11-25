// Local persistence: account, settings, cache, personal data (notes, done homework).

const KEY = 'lessn:';

function read(name, fallback) {
  try { const v = localStorage.getItem(KEY + name); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function write(name, value) {
  try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}
function remove(name) { try { localStorage.removeItem(KEY + name); } catch { /* ignore */ } }

export const DEFAULTS = {
  // Visible settings
  startView: 'today',
  weekDays: 'auto', // auto | 5 | 6 | 7
  autoRefresh: true,
  // Customization (only reachable through the hidden panel)
  theme: 'system', // system | light | dark | amoled
  accent: '#4f6bff',
  radius: 16,
  fontScale: 1,
  density: 'comfortable', // comfortable | compact
  colorMode: 'subject', // subject | accent | mono
  mergeDoubles: true,
  hideCancelled: false,
  showTeacher: true,
  showRoom: true,
  showBreaks: true,
  showPeriodNumbers: true,
  teacherLongNames: false,
  subjectLongNames: true,
  showNowLine: true,
  showCountdown: true,
  haptics: true,
  appTitle: '',
  font: 'system', // system | serif | mono
  subjectShortInGrid: true,
  subjectColors: {},
  subjectNames: {},
};

export const store = {
  account: () => read('account', null),
  setAccount: (a) => write('account', a),
  clearAccount: () => remove('account'),

  settings: () => ({ ...DEFAULTS, ...read('settings', {}) }),
  saveSettings: (s) => write('settings', s),
  resetCustomization: () => {
    const s = store.settings();
    const keep = { startView: s.startView, weekDays: s.weekDays, autoRefresh: s.autoRefresh };
    write('settings', keep);
  },

  cache: (name) => read('cache:' + name, null),
  setCache: (name, data) => write('cache:' + name, { t: Date.now(), data }),
  clearCache: () => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(KEY + 'cache:')).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },

  notes: () => read('notes', {}),
  setNote: (key, text) => { const n = read('notes', {}); if (text) n[key] = text; else delete n[key]; write('notes', n); },

  doneHomework: () => read('hwdone', {}),
  setHomeworkDone: (id, val) => { const d = read('hwdone', {}); d[id] = !!val; write('hwdone', d); },
};
