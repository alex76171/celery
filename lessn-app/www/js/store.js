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
  tabs: ['today', 'week', 'tasks', 'exams'],
  onboarded: false,
  iservNotify: true,
  lang: (navigator.language || 'en').slice(0, 2) === 'de' ? 'de' : 'en',
  startView: 'today',
  notifyLessons: false,
  notifyMinutes: 5,
  notifyChanges: true,
  dndLessons: false,
  dndBreaks: false,
  presenceCheck: false,
  presenceRadius: 250,
  schoolLoc: null,
  aiModel: 'gemini-flash-latest',
  aiLang: 'auto',
  keepAudio: false,
  weekDays: 'auto', // auto | 5 | 6 | 7
  weekLayout: 'list', // list | grid
  autoRefresh: true,
  // Customization (only reachable through the hidden panel)
  theme: 'auto', // auto | material-light | material-dark | glass-light | glass-dark | amoled
  animations: true,
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
  font: 'theme', // theme default or a bundled font
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
    const keys = ['weekLayout', 'tabs', 'onboarded', 'lang', 'startView', 'weekDays', 'autoRefresh', 'notifyLessons', 'notifyMinutes', 'notifyChanges', 'dndLessons',
      'dndBreaks', 'presenceCheck', 'presenceRadius', 'schoolLoc', 'aiModel', 'aiLang', 'keepAudio'];
    const keep = Object.fromEntries(keys.map((k) => [k, s[k]]));
    write('settings', keep);
  },

  cache: (name) => read('cache:' + name, null),
  setCache: (name, data) => write('cache:' + name, { t: Date.now(), data }),
  clearCache: () => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(KEY + 'cache:')).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  },

  iserv: () => read('iserv', null),
  setIServ: (v) => (v ? write('iserv', v) : remove('iserv')),
  aiKey: () => read('aikey', ''),
  setAiKey: (v) => write('aikey', v),

  manualGrades: () => read('grades', []),
  setManualGrades: (v) => write('grades', v),
  summaries: () => read('summaries', []),
  setSummaries: (v) => write('summaries', v),
  myExams: () => read('myexams', []),
  setMyExams: (v) => write('myexams', v),
  seenChanges: () => read('seen', {}),
  setSeenChanges: (v) => write('seen', v),

  notes: () => read('notes', {}),
  setNote: (key, text) => { const n = read('notes', {}); if (text) n[key] = text; else delete n[key]; write('notes', n); },

  doneHomework: () => read('hwdone', {}),
  setHomeworkDone: (id, val) => { const d = read('hwdone', {}); d[id] = !!val; write('hwdone', d); },
};
