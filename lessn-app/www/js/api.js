// WebUntis client. Uses the public JSON-RPC API plus the REST endpoints the web app uses.
// On Android, CapacitorHttp routes fetch() through native HTTP, so there is no CORS problem.

const CLIENT = 'Lessn';

export class UntisError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export const pad = (n) => String(n).padStart(2, '0');
export const toUntisDate = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
export const fromUntisDate = (n) => new Date(Math.floor(n / 10000), Math.floor(n / 100) % 100 - 1, n % 100);
export const untisTimeToMin = (t) => Math.floor(t / 100) * 60 + (t % 100);

const ERRORS = {
  '-8504': 'Wrong username or password.',
  '-8500': 'School not found. Check the school name.',
  '-8520': 'Session expired.',
  '-8509': 'Your account is not allowed to see this.',
  '-8998': 'Too many login attempts. Wait a minute and try again.',
  '-7004': 'No timetable is available for this date range.',
};

/** Accepts "nessa", "nessa.webuntis.com", or a full WebUntis URL and returns {server, school}. */
export function parseServerInput(input) {
  let s = (input || '').trim();
  let school = '';
  try {
    const u = new URL(/^https?:/i.test(s) ? s : 'https://' + s);
    school = u.searchParams.get('school') || (u.hash.match(/school=([^&]+)/) || [])[1] || '';
    s = u.hostname;
  } catch { /* keep raw */ }
  if (s && !s.includes('.')) s += '.webuntis.com';
  return { server: s.toLowerCase(), school: decodeURIComponent(school) };
}

/** Searches schools by name through the public WebUntis school directory. */
export async function searchSchools(query) {
  const res = await fetch('https://mobile.webuntis.com/ms/schoolquery2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(Date.now()), method: 'searchSchool', params: [{ search: query }], jsonrpc: '2.0' }),
  });
  const j = await res.json();
  if (j.error) {
    if (j.error.code === -6003) throw new UntisError('Too many results. Type a bit more.', -6003);
    throw new UntisError(j.error.message || 'Search failed', j.error.code);
  }
  return (j.result?.schools || []).map((s) => ({
    name: s.displayName, address: s.address, login: s.loginName,
    server: parseServerInput(s.serverUrl || s.server).server,
  }));
}

function names(list) {
  return (list || []).map((x) => ({
    id: x.id, name: x.name || '', long: x.longname || x.name || '',
    orig: x.orgname || null, origId: x.orgid || null,
  }));
}

function normalizeLesson(l) {
  return {
    id: l.id,
    date: l.date,
    start: untisTimeToMin(l.startTime),
    end: untisTimeToMin(l.endTime),
    subjects: names(l.su),
    teachers: names(l.te),
    rooms: names(l.ro),
    classes: names(l.kl),
    code: l.code || '', // '' | 'cancelled' | 'irregular'
    type: l.lstype || 'ls', // ls lesson, oh office hour, sb standby, bs break supervision, ex exam
    info: l.info || '',
    subst: l.substText || '',
    text: l.lstext || '',
    group: l.sg || '',
    activity: l.activityType || '',
  };
}

export class Untis {
  constructor({ server, school, username, password }) {
    Object.assign(this, { server, school, username, password });
    this.sessionId = null;
    this.token = null;
    this.loginPromise = null;
  }

  get base() { return `https://${this.server}/WebUntis`; }

  cookie() {
    const enc = btoa(unescape(encodeURIComponent(this.school)));
    return `JSESSIONID=${this.sessionId}; schoolname="_${enc}"`;
  }

  async rpc(method, params = {}, retry = true) {
    if (method !== 'authenticate' && !this.sessionId) await this.login();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (method !== 'authenticate') headers.Cookie = this.cookie();
    let res;
    try {
      res = await fetch(`${this.base}/jsonrpc.do?school=${encodeURIComponent(this.school)}`, {
        method: 'POST', headers,
        body: JSON.stringify({ id: String(Date.now()), method, params, jsonrpc: '2.0' }),
      });
    } catch (e) {
      throw new UntisError('No connection to the server.', 'network');
    }
    if (!res.ok) throw new UntisError(`Server answered with HTTP ${res.status}.`, res.status);
    let j;
    try { j = await res.json(); } catch { throw new UntisError('Unexpected answer from the server. Check the server address.', 'parse'); }
    if (j.error) {
      if (retry && method !== 'authenticate' && j.error.code === -8520) {
        this.sessionId = null;
        await this.login();
        return this.rpc(method, params, false);
      }
      throw new UntisError(ERRORS[j.error.code] || j.error.message || 'Unknown error', j.error.code);
    }
    return j.result;
  }

  login() {
    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const r = await this.rpc('authenticate', { user: this.username, password: this.password, client: CLIENT }, false);
        if (!r || !r.sessionId) throw new UntisError('Login failed.', 'auth');
        this.sessionId = r.sessionId;
        this.personType = r.personType;
        this.personId = r.personId;
        this.klasseId = r.klasseId;
        this.token = null;
        return r;
      })().finally(() => { this.loginPromise = null; });
    }
    return this.loginPromise;
  }

  async logout() {
    try { if (this.sessionId) await this.rpc('logout', {}, false); } catch { /* ignore */ }
    this.sessionId = null;
  }

  ownElement() {
    if (this.personType === 5 || this.personType === 2) return { id: this.personId, type: this.personType };
    if (this.klasseId) return { id: this.klasseId, type: 1 };
    return { id: this.personId, type: this.personType };
  }

  async timetable(start, end, element) {
    if (!this.sessionId) await this.login();
    const el = element || this.ownElement();
    const list = await this.rpc('getTimetable', {
      options: {
        element: { id: el.id, type: el.type },
        startDate: toUntisDate(start), endDate: toUntisDate(end),
        showInfo: true, showSubstText: true, showLsText: true, showStudentgroup: true,
        klasseFields: ['id', 'name', 'longname'], roomFields: ['id', 'name', 'longname'],
        subjectFields: ['id', 'name', 'longname'], teacherFields: ['id', 'name', 'longname'],
      },
    });
    return (list || []).map(normalizeLesson);
  }

  async timegrid() {
    const g = await this.rpc('getTimegridUnits');
    return (g || []).map((d) => ({
      day: d.day,
      units: d.timeUnits.map((u) => ({ name: u.name, start: untisTimeToMin(u.startTime), end: untisTimeToMin(u.endTime) })),
    }));
  }

  async holidays() {
    const h = await this.rpc('getHolidays');
    return (h || []).map((x) => ({ name: x.longName || x.name, start: x.startDate, end: x.endDate }));
  }

  async schoolyear() { return this.rpc('getCurrentSchoolyear'); }

  async elements(kind) {
    const method = { classes: 'getKlassen', teachers: 'getTeachers', rooms: 'getRooms', subjects: 'getSubjects' }[kind];
    const type = { classes: 1, teachers: 2, subjects: 3, rooms: 4 }[kind];
    const list = await this.rpc(method);
    return (list || []).filter((x) => x.active !== false).map((x) => ({
      id: x.id, type, name: x.name, long: x.longName || [x.foreName, x.longName].filter(Boolean).join(' ') || x.name,
    }));
  }

  // ---------- REST endpoints (same ones the WebUntis web app uses) ----------

  async getToken() {
    const res = await fetch(`${this.base}/api/token/new`, { headers: { Cookie: this.cookie() } });
    const t = (await res.text()).trim();
    return t.split('.').length === 3 ? t : null;
  }

  async rest(path, query = {}, retry = true) {
    if (!this.sessionId) await this.login();
    if (this.token === null) { try { this.token = (await this.getToken()) || ''; } catch { this.token = ''; } }
    const qs = new URLSearchParams(query).toString();
    const headers = { Cookie: this.cookie(), Accept: 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let res;
    try { res = await fetch(`${this.base}${path}${qs ? '?' + qs : ''}`, { headers }); }
    catch { throw new UntisError('No connection to the server.', 'network'); }
    if ((res.status === 401 || res.status === 403) && retry) {
      this.sessionId = null;
      await this.login();
      return this.rest(path, query, false);
    }
    if (!res.ok) throw new UntisError(`HTTP ${res.status}`, res.status);
    try { return await res.json(); } catch { throw new UntisError('Unexpected answer from the server.', 'parse'); }
  }

  async homework(start, end) {
    const j = await this.rest('/api/homeworks/lessons', { startDate: toUntisDate(start), endDate: toUntisDate(end) });
    const d = j.data || {};
    const lessons = Object.fromEntries((d.lessons || []).map((l) => [l.id, l]));
    const teachers = Object.fromEntries((d.teachers || []).map((t) => [t.id, t.name]));
    const recs = Object.fromEntries((d.records || []).map((r) => [r.homeworkId, r]));
    return (d.homeworks || []).map((h) => ({
      id: h.id, date: h.date, due: h.dueDate, text: h.text || '', remark: h.remark || '',
      completed: !!h.completed, subject: lessons[h.lessonId]?.subject || '',
      teacher: teachers[recs[h.id]?.teacherId] || '',
      attachments: (h.attachments || []).map((a) => a.name),
    }));
  }

  async exams(start, end) {
    const j = await this.rest('/api/exams', {
      startDate: toUntisDate(start), endDate: toUntisDate(end),
      klasseId: this.klasseId || -1, withGrades: true,
    });
    return ((j.data && j.data.exams) || []).map((e) => ({
      id: e.id, type: e.examType || '', name: e.name || '', date: e.examDate,
      start: untisTimeToMin(e.startTime), end: untisTimeToMin(e.endTime),
      subject: e.subject || '', teachers: e.teachers || [], rooms: e.rooms || [],
      text: e.text || '', grade: e.grade || '',
    }));
  }

  async absences(start, end) {
    const j = await this.rest('/api/classreg/absences/students', {
      startDate: toUntisDate(start), endDate: toUntisDate(end),
      studentId: this.personId, excuseStatusId: -1,
    });
    return ((j.data && j.data.absences) || []).map((a) => ({
      id: a.id, startDate: a.startDate, endDate: a.endDate,
      start: untisTimeToMin(a.startTime), end: untisTimeToMin(a.endTime),
      reason: a.reason || '', text: a.text || '', excused: !!a.isExcused,
      status: a.excuseStatus || '',
    }));
  }
}
