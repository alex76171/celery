// Setup after the first login: AI key, then IServ (with automatic server detection).
import { S, t, $, esc, icon, store, openSheet, closeSheet, rerenderSheet, toast, dd } from './core.js';
import { PROVIDERS, listModels, complete } from './ai.js';
import { native, hasNative } from './native.js';
import { IServ, normalizeIServHost, normalizeIServUser } from './iserv.js';
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
const AIS = { provider: 'gemini', models: null, loading: false, error: '', testing: false };

function aiForm() {
  const p = PROVIDERS[AIS.provider];
  const cur = (S.settings.aiModels || {})[AIS.provider] || (AIS.provider === 'gemini' && S.settings.aiModel) || p.model;
  const models = AIS.models || (cur ? [cur] : []);
  return `<div class="setup">
    <div class="setup-orb">${icon('sparkles')}</div>
    <h2>${esc(t('Meet your AI helper'))}</h2>
    <p>${esc(t('It explains homework, answers questions about photos, summarizes recorded lessons and makes study plans for your exams.'))}</p>
    <div class="card">
      ${dd(t('AI provider'), 'ai-provider', Object.entries(PROVIDERS).map(([id, x]) => [id, x.name]), AIS.provider, { act: 'ai-provider', ic: 'sparkles' })}
    </div>
    ${p.keyUrl ? `<button class="btn small ghost" data-act="ai-getkey">${icon('external-link')}${esc(t('Get a key'))} · ${esc(new URL(p.keyUrl).hostname)}</button>` : ''}
    ${AIS.provider === 'custom' ? `<label class="lbl">${esc(t('Server address'))}</label>
      <label class="input">${icon('server')}<input id="setup-base" placeholder="https://api.example.com/v1" value="${esc(S.settings.aiBaseUrl || '')}" autocapitalize="off" autocorrect="off"></label>` : ''}
    <label class="lbl">${esc(t('API key'))}</label>
    <label class="input">${icon('key-round')}<input id="setup-key" type="password" placeholder="${esc(p.placeholder)}" value="${esc(store.aiKey(AIS.provider))}" autocomplete="off"></label>
    <label class="lbl">${esc(t('Model'))}</label>
    <div class="model-row">
      ${AIS.models ? `<label class="dd"><span class="dd-text" id="model-text">${esc(cur && models.includes(cur) ? cur : models[0] || '')}</span>${icon('chevron-down', 'dd-ic')}<select id="setup-model">${models.map((m) => `<option ${m === cur ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>`
        : `<label class="input">${icon('cpu')}<input id="setup-model" value="${esc(cur)}" placeholder="${esc(p.model || 'model-name')}" autocapitalize="off" autocorrect="off"></label>`}
      <button class="icon-btn" data-act="ai-load-models" aria-label="${esc(t('Load models'))}">${icon(AIS.loading ? 'refresh-cw' : 'list', AIS.loading ? 'spin-ic' : '')}</button>
    </div>
    ${PROVIDERS[AIS.provider].audio ? '' : `<p class="hint">${icon('info', 'mini')} ${esc(t('This provider cannot listen to lesson recordings. For summaries, also add a Gemini, OpenAI or Mistral key.'))}</p>`}
    ${AIS.error ? `<div class="err shake">${icon('circle-alert')}<span>${esc(AIS.error)}</span></div>` : ''}
    <button class="btn" data-act="setup-ai-save" ${AIS.testing ? 'disabled' : ''}>${AIS.testing ? `${icon('refresh-cw', 'spin-ic')}${esc(t('Testing…'))}` : esc(t('Save'))}</button>
    <button class="link center" data-act="setup-ai-skip">${esc(t('Skip for now'))}</button>
  </div>`;
}
function keepAi(fn) {
  const v = { k: $('#setup-key')?.value, b: $('#setup-base')?.value, m: $('#setup-model')?.value };
  fn();
  if (v.k !== undefined && $('#setup-key')) $('#setup-key').value = v.k;
  if (v.b !== undefined && $('#setup-base')) $('#setup-base').value = v.b;
  if (v.m && $('#setup-model')?.tagName === 'INPUT') $('#setup-model').value = v.m;
}

export function openAISetup(next) {
  Object.assign(AIS, { provider: S.settings.aiProvider || 'gemini', models: null, loading: false, error: '', testing: false });
  openSheet(aiForm, { full: true, onClose: () => { const n = next; next = null; n?.(); } });
}
export function setAiProvider(id) {
  Object.assign(AIS, { provider: id, models: null, error: '' });
  rerenderSheet();
}
export function openKeyPage() { const p = PROVIDERS[AIS.provider]; if (p.keyUrl) native.openUrl(p.keyUrl); }

export async function loadAiModels() {
  const key = $('#setup-key')?.value.trim();
  const base = $('#setup-base')?.value.trim();
  if (!key) { AIS.error = t('Add an AI key first.'); keepAi(rerenderSheet); return; }
  AIS.loading = true; AIS.error = ''; keepAi(rerenderSheet);
  try {
    const r = await listModels(AIS.provider, key, base);
    AIS.models = r.ids;
    S.settings.aiModels = { ...(S.settings.aiModels || {}), [AIS.provider]: ((S.settings.aiModels || {})[AIS.provider] && r.ids.includes(S.settings.aiModels[AIS.provider])) ? S.settings.aiModels[AIS.provider] : r.best };
  } catch (e) { AIS.error = e.message; }
  AIS.loading = false;
  keepAi(rerenderSheet);
}

export async function saveAISetup() {
  const key = $('#setup-key')?.value.trim();
  const base = ($('#setup-base')?.value || '').trim().replace(/\/+$/, '');
  const model = ($('#setup-model')?.value || '').trim();
  if (!key) { closeSheet(); return; }
  const prov = AIS.provider;
  const config = { provider: prov, p: PROVIDERS[prov], key, model: model || PROVIDERS[prov].model, base: prov === 'custom' ? base : PROVIDERS[prov].base };
  if (!config.model || (prov === 'custom' && !base)) { AIS.error = t('Fill in the server address and model.'); keepAi(rerenderSheet); return; }
  AIS.testing = true; AIS.error = ''; keepAi(rerenderSheet);
  try {
    await complete({ config, messages: [{ role: 'user', text: 'Reply with the single word OK.' }] });
  } catch (e) {
    AIS.testing = false; AIS.error = e.message; keepAi(rerenderSheet);
    return;
  }
  AIS.testing = false;
  store.setAiKey(key, prov);
  S.settings.aiProvider = prov;
  S.settings.aiModels = { ...(S.settings.aiModels || {}), [prov]: config.model };
  if (prov === 'custom') S.settings.aiBaseUrl = base;
  store.saveSettings(S.settings);
  toast(t('AI connected: {name}', { name: PROVIDERS[prov].name }));
  closeSheet();
  render();
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
  const username = normalizeIServUser($('#su-user').value);
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
    IS.state = 'manual';
    IS.error = !$('#su-pass').value && e.code === 'auth' ? `${t(e.message)} ${t('You left the password empty, so your WebUntis password was used. Enter your IServ password.')}` : e.message;
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
