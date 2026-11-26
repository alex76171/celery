// Keeps the app data of the phone and the PC in step through the Lessn Hub on the PC.
// Every change to a synced item is time-stamped; the hub keeps the newest version of each item and hands
// out what changed since a device last synced. Timetable caches and device-only things are not synced.
const KEY = 'lessn:';
const META = 'lessn:sync:meta';
const SEQ = 'lessn:sync:seq';
const SYNCED = ['account', 'iserv', 'aikeys', 'settings', 'grades', 'summaries', 'myexams', 'notes', 'hwdone', 'chats', 'myhw', 'plans', 'plandone', 'seen'];
const SECRET = ['account', 'iserv', 'aikeys'];
/** Settings that stay per device (layout and size differ between phone and PC). */
const DEVICE_SETTINGS = ['tabs', 'startView', 'fontScale', 'density', 'weekLayout', 'onboarded'];

const isSynced = (k) => k.startsWith(KEY) && SYNCED.includes(k.slice(KEY.length));
let applying = false;
let dirtyTimer = null;
const listeners = new Set();

function readJson(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function meta() { return readJson(META, {}); }

// Record when each synced item changes on this device.
const origSet = Storage.prototype.setItem;
const origRemove = Storage.prototype.removeItem;
Storage.prototype.setItem = function (k, v) {
  const before = this === localStorage && !applying && isSynced(k) ? localStorage.getItem(k) : null;
  origSet.call(this, k, v);
  if (this === localStorage && !applying && isSynced(k) && before !== String(v)) touch(k);
};
Storage.prototype.removeItem = function (k) {
  const had = this === localStorage && !applying && isSynced(k) && localStorage.getItem(k) != null;
  origRemove.call(this, k);
  if (had) touch(k);
};
function touch(k) {
  const m = meta();
  m[k.slice(KEY.length)] = Date.now();
  origSet.call(localStorage, META, JSON.stringify(m));
  clearTimeout(dirtyTimer);
  dirtyTimer = setTimeout(() => listeners.forEach((fn) => fn('dirty')), 2500);
}
export const onLocalChange = (fn) => listeners.add(fn);

/**
 * One sync round with the hub. api(path, opts) sends an authorised request to the PC.
 * Returns the list of item names that changed on this device.
 */
export async function syncOnce(api, { secrets = true } = {}) {
  const m = meta();
  const since = Number(localStorage.getItem(SEQ) || 0);
  const lastPush = Number(localStorage.getItem('lessn:sync:pushed') || 0);
  const items = {};
  for (const [name, t] of Object.entries(m)) {
    if (t <= lastPush && since) continue;
    if (!secrets && SECRET.includes(name)) continue;
    const raw = localStorage.getItem(KEY + name);
    items[name] = { t, v: raw == null ? null : JSON.parse(raw) };
  }
  const started = Date.now();
  const res = await api('/api/sync', { method: 'POST', body: JSON.stringify({ since, items }) });
  const changed = [];
  applying = true;
  try {
    for (const [name, it] of Object.entries(res.items || {})) {
      if (!SYNCED.includes(name) || (!secrets && SECRET.includes(name))) continue;
      if ((m[name] || 0) >= it.t) continue;
      let v = it.v;
      if (name === 'settings' && v) {
        const mine = readJson(KEY + 'settings', {});
        v = { ...v };
        for (const k of DEVICE_SETTINGS) { if (k in mine) v[k] = mine[k]; else delete v[k]; }
      }
      if (v == null) origRemove.call(localStorage, KEY + name); else origSet.call(localStorage, KEY + name, JSON.stringify(v));
      m[name] = it.t;
      changed.push(name);
    }
  } finally { applying = false; }
  origSet.call(localStorage, META, JSON.stringify(m));
  origSet.call(localStorage, SEQ, String(res.seq || since));
  origSet.call(localStorage, 'lessn:sync:pushed', String(started));
  origSet.call(localStorage, 'lessn:sync:last', String(Date.now()));
  return changed;
}

/** First sync with a new PC: everything on this device counts as changed. */
export function markAllForSync(oldest = false) {
  const m = meta();
  const now = oldest ? 1001 : Date.now();
  for (const name of SYNCED) if (localStorage.getItem(KEY + name) != null && (oldest || !m[name])) m[name] = oldest ? now : now - 1000;
  origSet.call(localStorage, META, JSON.stringify(m));
  origRemove.call(localStorage, SEQ);
  origRemove.call(localStorage, 'lessn:sync:pushed');
}
export const lastSync = () => Number(localStorage.getItem('lessn:sync:last') || 0);
