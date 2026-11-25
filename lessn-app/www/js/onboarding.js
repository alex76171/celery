// Setup after the first login: AI key, then IServ (with automatic server detection).
import { S, t, $, esc, icon, store, openSheet, closeSheet, rerenderSheet, toast } from './core.js';
import { native, hasNative } from './native.js';
import { IServ, normalizeIServHost } from './iserv.js';
import { render } from './app.js';
import { refreshHub } from './iserv-ui.js';

const UA = { 'User-Agent': 'Lessn-School-App/2.2 (Android)', Accept: 'application/json' };
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ---------------------------------------------------------------- location helpers (OpenStreetMap)
export async function cityFromLocation() {
  const loc = await native.getLocation();
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${loc.lat}&lon=${loc.lng}&accept-language=de`, { headers: UA });
  const j = await r.json();
  const a = j.address || {};
  return a.city || a.town || a.village || a.municipality || a.county || '';
}

/** Tries to find the IServ server of a school: website from OpenStreetMap, then checks for /iserv. */
export async function detectIServ(school) {
  const name = school?.name || S.account?.schoolName || '';
  const addr = school?.address || S.account?.schoolAddress || '';
  const city = (addr.split(',')[0] || '').trim();
  const candidates = new Set();
  try {
    const q = encodeURIComponent([name, city].filter(Boolean).join(', '));
    const r = await withTimeout(fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&extratags=1&limit=6&q=${q}`, { headers: UA }), 8000);
    for (const p of await r.json()) {
      const tags = p.extratags || {};
      for (const k of ['website', 'contact:website', 'url', 'operator:website']) {
        if (!tags[k]) continue;
        try {
          const host = new URL(/^https?:/.test(tags[k]) ? tags[k] : `https://${tags[k]}`).hostname.replace(/^www\./, '');
          candidates.add(host);
          candidates.add(`iserv.${host}`);
        } catch { /* ignore */ }
      }
    }
  } catch { /* no website found */ }
  for (const host of candidates) {
    try {
      const res = await withTimeout(fetch(`https://${host}/iserv/auth/login`, { headers: { Accept: 'text/html' } }), 7000);
      const html = await res.text();
      if (/iserv/i.test(html) && /_username|_password/.test(html)) return host;
    } catch { /* try next */ }
  }
  return null;
}

// ---------------------------------------------------------------- AI setup sheet
export function openAISetup(next) {
  openSheet(() => `<div class="setup">
    <div class="setup-orb">${icon('sparkles')}</div>
    <h2>${esc(t('Meet your AI helper'))}</h2>
    <p>${esc(t('It explains homework, answers questions about photos, summarizes recorded lessons and makes study plans for your exams.'))}</p>
    <ol class="setup-steps">
      <li>${esc(t('Open Google AI Studio and sign in with a Google account.'))}</li>
      <li>${esc(t('Tap "Create API key" and copy it.'))}</li>
      <li>${esc(t('Paste it here.'))}</li>
    </ol>
    <button class="btn small ghost" data-act="ai-getkey">${icon('external-link')}${esc(t('Open Google AI Studio'))}</button>
    <label class="input" style="margin-top:14px">${icon('key-round')}<input id="setup-key" type="password" placeholder="AIza…" value="${esc(store.aiKey())}" autocomplete="off"></label>
    <button class="btn" data-act="setup-ai-save">${esc(t('Continue'))}</button>
    <button class="link center" data-act="setup-ai-skip">${esc(t('Skip for now'))}</button>
  </div>`, { full: true, onClose: () => { const n = next; next = null; n?.(); } });
  openAISetup.done = () => { closeSheet(); };
}
export function saveAISetup() {
  const v = $('#setup-key')?.value.trim();
  if (v) { store.setAiKey(v); toast(t('Key saved')); }
  closeSheet();
}

// ---------------------------------------------------------------- IServ setup sheet
const IS = { state: 'idle', host: '', error: '' };
export function openIServSetup(next) {
  IS.state = 'detecting'; IS.host = store.iserv()?.host || ''; IS.error = '';
  const build = () => `<div class="setup">
    <div class="setup-orb is">${icon('school')}</div>
    <h2>${esc(t('Connect IServ'))}</h2>
    <p>${esc(t('See messages, mail, files and tasks from IServ in Lessn, and get notified about new ones.'))}</p>
    ${IS.state === 'detecting' ? `<div class="processing">${icon('search', 'spin-slow')}<span>${esc(t("Looking for your school's IServ…"))}</span></div>`
      : IS.host && IS.state === 'found' ? `<div class="notice">${icon('circle-check')}<span>${esc(t('Found it:'))} <b>${esc(IS.host)}</b></span></div>`
        : `<div class="notice warn">${icon('info')}<span>${esc(t("Couldn't find it automatically. Enter your IServ address."))}</span></div>`}
    <label class="lbl">${esc(t('IServ address'))}</label>
    <label class="input">${icon('globe')}<input id="su-host" value="${esc(IS.host)}" placeholder="${esc(t('e.g. myschool.de'))}" autocapitalize="off" autocorrect="off"></label>
    <label class="lbl">${esc(t('Username'))}</label>
    <label class="input">${icon('user')}<input id="su-user" value="${esc(store.iserv()?.username || guessUser())}" placeholder="vorname.nachname" autocapitalize="off" autocorrect="off"></label>
    <label class="lbl">${esc(t('Password'))}</label>
    <label class="input">${icon('lock')}<input id="su-pass" type="password" placeholder="${esc(t('Leave empty to use your WebUntis password'))}"></label>
    ${IS.error ? `<div class="err shake">${icon('circle-alert')}<span>${esc(t(IS.error))}</span></div>` : ''}
    <button class="btn" data-act="setup-iserv-save" ${IS.state === 'connecting' ? 'disabled' : ''}>${IS.state === 'connecting' ? `${icon('refresh-cw', 'spin-ic')}${esc(t('Connecting…'))}` : esc(t('Connect'))}</button>
    <button class="link center" data-act="setup-iserv-skip">${esc(t('Skip for now'))}</button>
  </div>`;
  openSheet(build, { full: true, onClose: () => { const n = next; next = null; n?.(); } });
  if (IS.host) { IS.state = 'found'; rerenderSheet(); return; }
  detectIServ().then((host) => { IS.host = host || ''; IS.state = host ? 'found' : 'manual'; keepInputs(rerenderSheet); }, () => { IS.state = 'manual'; keepInputs(rerenderSheet); });
}
function keepInputs(fn) {
  const v = { u: $('#su-user')?.value, p: $('#su-pass')?.value, h: $('#su-host')?.value };
  fn();
  if (v.u) $('#su-user').value = v.u;
  if (v.p) $('#su-pass').value = v.p;
  if (v.h && !IS.host) $('#su-host').value = v.h;
}
const guessUser = () => {
  const u = S.account?.username || '';
  return u.includes('.') ? u.toLowerCase() : u;
};

export async function saveIServSetup() {
  const host = normalizeIServHost($('#su-host').value);
  const username = $('#su-user').value.trim();
  const password = $('#su-pass').value || S.account.password;
  if (!host || !username) { IS.error = 'Fill in the IServ address and username'; keepInputs(rerenderSheet); return; }
  IS.state = 'connecting'; IS.error = ''; IS.host = host;
  keepInputs(rerenderSheet);
  try {
    const c = new IServ({ host, username, password });
    await c.login();
    store.setIServ({ host, username, password });
    S.iserv = c;
    if (S.settings.iservNotify && hasNative()) {
      await native.request(['notifications']).catch(() => {});
      native.iservBackground({ enabled: true, host, username, password, chats: true });
    }
    toast(t('IServ connected'));
    closeSheet();
    refreshHub();
    render();
  } catch (e) {
    IS.state = 'manual'; IS.error = e.message;
    keepInputs(rerenderSheet);
  }
}

/** Runs the setup pop-ups once after the first login. */
export function maybeRunSetup() {
  if (S.settings.onboarded) return;
  S.settings.onboarded = true;
  store.saveSettings(S.settings);
  setTimeout(() => openAISetup(() => setTimeout(() => { if (!store.iserv()) openIServSetup(); }, 350)), 900);
}
