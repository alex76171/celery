// Setup after the first login: AI key, then IServ (with automatic server detection).
import { S, t, $, esc, icon, store, openSheet, closeSheet, rerenderSheet, toast, dd, formSelect, toggle, stagger, openMenu, FONTS } from './core.js';
import { TAB_DEFS } from './assist.js';
import { PROVIDERS, listModels, catalog, priceOf, complete, linkedAIs, aiFor, aiConfig } from './ai.js';
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
const AIS = { provider: 'gemini', models: null, loading: false, error: '', testing: false, picked: '', mode: '' };

function aiForm() {
  const p = PROVIDERS[AIS.provider];
  const cur = AIS.picked || (S.settings.aiModels || {})[AIS.provider] || (AIS.provider === 'gemini' && S.settings.aiModel) || p.model;
  const list = AIS.models || catalog(AIS.provider);
  if (cur && !list.some((m) => m.id === cur)) list.unshift({ id: cur, name: '', price: priceOf(AIS.provider, cur, null, S.settings.aiBaseUrl) });
  const selected = list.find((m) => m.id === cur) || list[0];
  return `<div class="setup">
    <div class="setup-orb">${icon('sparkles')}</div>
    <h2>${esc(t('Meet your AI helper'))}</h2>
    <p>${esc(t('It explains homework, answers questions about photos, summarizes recorded lessons and makes study plans for your exams.'))}</p>
    <div class="card">
      ${dd(t('AI provider'), 'ai-provider', Object.entries(PROVIDERS).filter(([id]) => id !== 'pc' || AIS.provider === 'pc').map(([id, x]) => [id, x.name]), AIS.provider, { act: 'ai-provider', ic: 'sparkles' })}
    </div>
    ${!AIS.mode && !linkedAIs().length ? `<button class="free-ai" data-act="ai-free-now"><span class="fa-ic">${icon('gift')}</span><span><b>${esc(t('Start for free, no key'))}</b><small>${esc(t('Works right away. You can add other AIs any time.'))}</small></span>${icon('chevron-right', 'row-chev')}</button>
      <div class="or-line"><span>${esc(t('or choose an AI'))}</span></div>` : ''}
    ${p.oauth ? `<button class="btn signin-btn" data-act="ai-oauth">${icon('log-in')}${esc(t('Sign in with OpenRouter'))}</button><p class="hint center">${esc(t('No key to copy: sign in or create a free account. Free models cost nothing.'))}</p>` : ''}
    ${p.noKey ? `<div class="notice ok">${icon('circle-check')}<span>${esc(t('Free and no account needed. Answers can be slower and less private than with your own key.'))}</span></div>` : ''}
    ${p.keyUrl && !p.noKey ? `<button class="btn small ghost" data-act="ai-getkey">${icon('external-link')}${esc(p.oauth ? t('Or paste a key') : t('Get a key'))} · ${esc(new URL(p.keyUrl).hostname)}</button>` : ''}
    ${AIS.provider === 'custom' ? `<label class="lbl">${esc(t('Server address'))}</label>
      <label class="input">${icon('server')}<input id="setup-base" placeholder="https://api.example.com/v1" value="${esc(S.settings.aiBaseUrl || '')}" autocapitalize="off" autocorrect="off"></label>` : ''}
    ${p.noKey ? `<input id="setup-key" type="hidden" value="">` : AIS.provider === 'pc' ? `<input id="setup-key" type="hidden" value="${esc(store.aiKey('pc'))}"><p class="hint">${icon('monitor', 'mini')} ${esc(t('Runs on your paired PC. Free and private.'))}</p>` : `<label class="lbl">${esc(t('API key'))}</label>
    <label class="input">${icon('key-round')}<input id="setup-key" type="password" placeholder="${esc(p.placeholder)}" value="${esc(store.aiKey(AIS.provider))}" autocomplete="off"></label>`}
    <label class="lbl">${esc(t('Model'))}</label>
    <div class="model-row">
      ${list.length ? formSelect('setup-model', list.map(modelOption), selected?.id || '')
        : `<label class="input">${icon('cpu')}<input id="setup-model" value="${esc(cur)}" placeholder="${esc(p.model || 'model-name')}" autocapitalize="off" autocorrect="off"></label>`}
      <button class="icon-btn" data-act="ai-load-models" aria-label="${esc(t('Load models'))}">${icon(AIS.loading ? 'refresh-cw' : 'list', AIS.loading ? 'spin-ic' : '')}</button>
    </div>
    <div class="model-price" id="setup-price">${priceLine(selected)}</div>
    <p class="hint">${icon('info', 'mini')} ${esc(AIS.models ? t('These are all models your key can use. Prices are per 1M tokens (input / output) and can change.') : t('Tap the list button after entering your key to see every model your account can use.'))}${p.priceUrl ? ` <button class="link" data-act="ai-prices">${esc(t('Price list'))}</button>` : ''}</p>
    ${PROVIDERS[AIS.provider].audio ? '' : `<p class="hint">${icon('info', 'mini')} ${esc(t('This provider cannot listen to lesson recordings. For summaries, also add a Gemini, OpenAI or Mistral key.'))}</p>`}
    ${AIS.error ? `<div class="err shake">${icon('circle-alert')}<span>${esc(AIS.error)}</span></div>` : ''}
    <button class="btn" data-act="setup-ai-save" ${AIS.testing ? 'disabled' : ''}>${AIS.testing ? `${icon('refresh-cw', 'spin-ic')}${esc(t('Testing…'))}` : esc(t('Save'))}</button>
    <button class="link center" data-act="setup-ai-skip">${esc(t('Skip for now'))}</button>
  </div>`;
}
/** Dropdown entry for a model: [id, label, price line, tag] */
function modelOption(m) {
  const pr = m.price;
  return [m.id, m.name && m.name !== m.id ? m.name : m.id, priceSub(pr, true), priceTag(pr)];
}
function priceSub(pr, short = false) {
  if (!pr) return t('Price unknown');
  if (pr.kind === 'free') return t('No cost');
  if (pr.kind === 'local') return t('Runs on your own server');
  if (pr.kind === 'auto') return t('Costs what the chosen model costs');
  return `${pr.label} ${t('per 1M tokens')}${pr.kind === 'tier' && !short ? ` · ${t('after the free limit')}` : ''}`;
}
function priceTag(pr) {
  if (!pr) return null;
  if (pr.kind === 'free' || pr.kind === 'local') return { text: t('Free'), cls: 'free' };
  if (pr.kind === 'tier') return { text: t('Free tier'), cls: 'tier' };
  if (pr.kind === 'auto') return { text: t('Varies') };
  return null; // paid: the price line says it
}
function priceLine(m) {
  if (!m) return '';
  const pr = m.price; const tag = priceTag(pr);
  const per = pr?.perAnswer ? ` · ${t('about {price} per answer', { price: pr.perAnswer })}` : '';
  return `${tag ? `<em class="pi-tag ${tag.cls || ''}">${esc(tag.text)}</em>` : icon('coins')}<span>${esc(priceSub(pr) + per)}</span>`;
}
/** Updates the price line when another model is picked. */
export function aiModelPicked(id) {
  AIS.picked = id;
  const m = (AIS.models || catalog(AIS.provider)).find((x) => x.id === id) || { id, price: priceOf(AIS.provider, id, null, $('#setup-base')?.value) };
  const el = $('#setup-price'); if (el) el.innerHTML = priceLine(m);
}
export function openPricePage() { const p = PROVIDERS[AIS.provider]; if (p.priceUrl) native.openUrl(p.priceUrl); }

function keepAi(fn) {
  const v = { k: $('#setup-key')?.value, b: $('#setup-base')?.value, m: $('#setup-model')?.value };
  fn();
  if (v.k !== undefined && $('#setup-key')) $('#setup-key').value = v.k;
  if (v.b !== undefined && $('#setup-base')) $('#setup-base').value = v.b;
  if (v.m && $('#setup-model')?.type !== 'hidden') $('#setup-model').value = v.m;
}

export function openAISetup(next, { add = false, provider = '' } = {}) {
  const linked = new Set(linkedAIs().map((c) => c.provider));
  const first = add ? Object.keys(PROVIDERS).find((id) => !linked.has(id)) || 'custom' : provider || S.settings.aiProvider || 'gemini';
  Object.assign(AIS, { provider: first, models: null, loading: false, error: '', testing: false, picked: '', mode: add ? 'add' : provider ? 'edit' : '' });
  openSheet(aiForm, { full: true, onClose: () => { const n = next; next = null; n?.(); } });
  if (store.aiKey(AIS.provider)) loadAiModels(true);
}
export function setAiProvider(id) {
  Object.assign(AIS, { provider: id, models: null, error: '', loading: false, picked: '' });
  rerenderSheet();
  if (store.aiKey(id)) loadAiModels(true);
}
export function openKeyPage() { const p = PROVIDERS[AIS.provider]; if (p.keyUrl) native.openUrl(p.keyUrl); }

export async function loadAiModels(quiet = false) {
  const key = $('#setup-key')?.value.trim();
  const base = $('#setup-base')?.value.trim() || S.settings.aiBaseUrl || '';
  if (!key) { if (!quiet) { AIS.error = t('Add an AI key first.'); keepAi(rerenderSheet); } return; }
  if (AIS.loading) return;
  const prov = AIS.provider;
  AIS.loading = true; AIS.error = ''; keepAi(rerenderSheet);
  try {
    const r = await listModels(prov, key, base);
    if (prov !== AIS.provider) return;
    AIS.models = r.models;
    const picked = $('#setup-model')?.value;
    const keep = [picked, (S.settings.aiModels || {})[prov]].find((m) => m && r.ids.includes(m));
    S.settings.aiModels = { ...(S.settings.aiModels || {}), [prov]: keep || r.best };
  } catch (e) { if (prov !== AIS.provider) return; if (!quiet) AIS.error = e.message; }
  AIS.loading = false;
  keepAi(rerenderSheet);
}

export async function saveAISetup() {
  const key = $('#setup-key')?.value.trim();
  const base = ($('#setup-base')?.value || '').trim().replace(/\/+$/, '');
  const model = ($('#setup-model')?.value || '').trim();
  const prov = AIS.provider;
  if (!key && !PROVIDERS[prov].noKey) { closeSheet(); return; }
  const config = { provider: prov, p: PROVIDERS[prov], key, model: model || PROVIDERS[prov].model, base: prov === 'custom' ? base : prov === 'pc' ? aiConfig('pc').base : PROVIDERS[prov].base };
  if (!config.model || (prov === 'custom' && !base)) { AIS.error = t('Fill in the server address and model.'); keepAi(rerenderSheet); return; }
  AIS.testing = true; AIS.error = ''; keepAi(rerenderSheet);
  try {
    await complete({ config, messages: [{ role: 'user', text: 'Reply with the single word OK.' }] });
  } catch (e) {
    AIS.testing = false; AIS.error = e.message; keepAi(rerenderSheet);
    return;
  }
  AIS.testing = false;
  if (PROVIDERS[prov].noKey) S.settings[`aiOn_${prov}`] = true; else store.setAiKey(key, prov);
  const defLinked = linkedAIs().some((c) => c.provider === S.settings.aiProvider && c.provider !== prov);
  if (!AIS.mode || !defLinked) S.settings.aiProvider = prov;
  S.settings.aiModels = { ...(S.settings.aiModels || {}), [prov]: config.model };
  if (prov === 'custom') S.settings.aiBaseUrl = base;
  store.saveSettings(S.settings);
  toast(t('AI connected: {name}', { name: PROVIDERS[prov].name }));
  if (S.view === 'ai-settings') S.anim = 'fade';
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
  setTimeout(() => openWizard(() => setTimeout(() => openAISetup(() => setTimeout(() => { if (!store.iserv()) openIServSetup(() => setTimeout(pcStep, 350)); else pcStep(); }, 350)), 350)), 900);
}

// ---------------------------------------------------------------- setup wizard: look, tabs, notifications
const WZ = { step: 0, next: null };
const QUICK_THEMES = [['auto', 'Auto', '#f4f5f8', '#15161e'], ['material-light', 'Material', '#f6f7fa', '#4f6bff'], ['material-dark', 'Material Dark', '#0f1015', '#4f6bff'], ['glass-light', 'Liquid Glass', '#e9eefc', '#7aa2ff'], ['glass-dark', 'Glass Dark', '#141726', '#8ea6ff'],
  ['oneui-light', 'One UI', '#f4f4f6', '#3e91ff'], ['ios-light', 'iOS', '#f2f2f7', '#007aff'], ['windows-light', 'Windows 11', '#f3f3f3', '#0067c0'], ['windows-dark', 'Windows Dark', '#202020', '#4cc2ff'], ['amoled', 'Black', '#000', '#4f6bff'], ['sunset', 'Sunset', '#fff4ec', '#f97316'],
  ['ocean', 'Ocean', '#06182a', '#38bdf8'], ['forest', 'Forest', '#0f1a14', '#4ade80'], ['mocha', 'Mocha', '#1e1e2e', '#cba6f7'], ['nord', 'Nord', '#2e3440', '#88c0d0'], ['lavender', 'Lavender', '#f5f2ff', '#8e4ec6'], ['neon', 'Neon', '#0b0614', '#e879f9']];
const ACCENTS = ['#4f6bff', '#0090ff', '#12a594', '#30a46c', '#f59e0b', '#f76b15', '#e5484d', '#d6409f', '#8e4ec6', '#6e56cf'];
export function openWizard(next) {
  WZ.step = 0; WZ.next = next;
  openSheet(wizardHtml, { full: true, onClose: () => { const n = WZ.next; WZ.next = null; n?.(); } });
}
function wizardHtml() {
  const s = S.settings;
  const dots = `<div class="wz-dots">${[0, 1, 2].map((i) => `<i class="${i === WZ.step ? 'on' : i < WZ.step ? 'done' : ''}"></i>`).join('')}</div>`;
  const nav = `<div class="wz-nav"><button class="link" data-act="wz-skip">${esc(t('Skip'))}</button><button class="btn" data-act="wz-next">${esc(WZ.step < 2 ? t('Next') : t('Done'))}${icon('chevron-right')}</button></div>`;
  if (WZ.step === 0) {
    return `<div class="setup wz">${dots}<div class="setup-orb">${icon('palette')}</div><h2>${esc(t('Make it yours'))}</h2><p>${esc(t('Pick a look. You can change everything later (long-press the title).'))}</p>
      <div class="wz-themes">${QUICK_THEMES.map(([id, name, bg, ac]) => `<button class="wz-theme ${s.theme === id ? 'on' : ''}" data-act="wz-theme" data-v="${id}" style="--tb:${bg};--ta:${ac}"><span class="tc-prev"><i></i><i></i><i></i></span><b>${esc(t(name))}</b></button>`).join('')}</div>
      <label class="lbl">${esc(t('Accent color'))}</label>
      <div class="accent-row">${ACCENTS.map((c) => `<button class="acc ${s.accent === c ? 'on' : ''}" data-act="wz-accent" data-v="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>
      <div class="card">${dd(t('Font'), 'font', FONTS.map(([k, l]) => [k, t(l)]), s.font || 'theme', { ic: 'type' })}${dd(t('Text size'), 'fontScale', [['0.9', t('Small')], ['1', t('Normal')], ['1.1', t('Large')], ['1.2', t('Extra large')]], String(s.fontScale), { ic: 'a-large-small' })}${toggle('animations', t('Animations'), t('Smooth motion everywhere'))}</div>
      ${nav}</div>`;
  }
  if (WZ.step === 1) {
    const tabs = S.settings.tabs || ['today', 'week', 'tasks', 'exams'];
    return `<div class="setup wz">${dots}<div class="setup-orb">${icon('layout-grid')}</div><h2>${esc(t('Your tabs'))}</h2><p>${esc(t('Pick up to 4 tabs for the bottom bar. Everything else is in the menu.'))}</p>
      <div class="tab-pick">${Object.entries(TAB_DEFS).map(([k, d]) => `<button class="tp ${tabs.includes(k) ? 'on' : ''}" data-act="wz-tab" data-v="${k}">${icon(d.icon)}<span>${esc(t(d.label))}</span>${tabs.includes(k) ? `<em>${tabs.indexOf(k) + 1}</em>` : ''}</button>`).join('')}</div>
      <div class="card">${dd(t('Start screen'), 'startView', tabs.map((k) => [k, t(TAB_DEFS[k]?.label || k)]), s.startView || tabs[0], { ic: 'house' })}${dd(t('Timetable view'), 'weekLayout', [['list', t('List')], ['grid', t('Grid')]], s.weekLayout || 'list', { ic: 'calendar-range' })}</div>
      ${nav}</div>`;
  }
  return `<div class="setup wz">${dots}<div class="setup-orb">${icon('bell')}</div><h2>${esc(t('Stay up to date'))}</h2><p>${esc(t('Choose what Lessn should tell you. Nothing is sent anywhere.'))}</p>
    <div class="card">
      ${toggle('notifyLessons', t('Lesson reminders'), t('A notification before each lesson'))}
      ${toggle('notifyChanges', t('Change alerts'), t('Cancelled lessons, substitutions and room changes'))}
      ${toggle('studyCheckins', t('Ask if I have studied'), t('Before each exam or test, with help from the AI if not yet'))}
      ${toggle('recAsk', t('Ask before each lesson if I want to record'), t('The AI then writes down homework and tests'))}
      ${toggle('aiHolidayNames', t('Nicer holiday names'), t('The AI names holidays properly'))}
      ${toggle('dndLessons', t('Do not disturb during lessons'), t('Turns on when a lesson starts and off when it ends'))}
    </div>
    ${nav}</div>`;
}
export async function wizardAct(act, v) {
  const s = S.settings;
  if (act === 'wz-theme') { s.theme = v; store.saveSettings(s); applyThemeNow(); }
  if (act === 'wz-accent') { s.accent = v; store.saveSettings(s); applyThemeNow(); }
  if (act === 'wz-tab') {
    let tabs = [...(s.tabs || ['today', 'week', 'tasks', 'exams'])];
    if (!tabs.includes(v) && tabs.length >= 4) { toast(t('Remove a tab first to add another one.')); return; }
    tabs = tabs.includes(v) ? tabs.filter((x) => x !== v) : [...tabs, v];
    if (!tabs.length) tabs = ['today'];
    s.tabs = tabs; store.saveSettings(s);
    const nav = document.querySelector('nav.tabs');
    if (nav) import('./app.js').then((m) => m.refreshNav?.());
  }
  if (act === 'wz-next') {
    if (WZ.step === 2) {
      if (hasNative() && (s.notifyLessons || s.notifyChanges || s.studyCheckins || s.recAsk)) await native.request(['notifications', ...(s.recAsk ? ['microphone'] : [])]).catch(() => {});
      if (s.dndLessons && hasNative()) { const st = await native.status(); if (!st.dnd) native.openDndSettings().catch(() => {}); }
      import('./data.js').then((m) => m.scheduleNative());
      closeSheet();
      return;
    }
    WZ.step++;
  }
  if (act === 'wz-skip') { closeSheet(); return; }
  const b = $('.sheet-body');
  if (b) { b.innerHTML = wizardHtml(); b.scrollTop = 0; }
}
function applyThemeNow() { import('./core.js').then((m) => { m.applyTheme(); }); }
/** Last step on the phone: Lessn on the PC. */
function pcStep() {
  if (window.Capacitor?.isDesktop) return;
  openSheet(() => `<div class="setup"><div class="setup-orb">${icon('monitor')}</div><h2>${esc(t('Lessn on your PC too?'))}</h2>
    <p>${esc(t('Install Lessn for Windows to see everything on a big screen, open your PC\'s files on the phone and use free local AI. Your data syncs by itself.'))}</p>
    <button class="btn" data-act="nav" data-view="pc">${icon('monitor')}${esc(t('Connect my PC'))}</button>
    <button class="link center" data-act="close-sheet">${esc(t('Maybe later'))}</button></div>`);
}


// ---------------------------------------------------------------- "AI helpers" screen: every linked AI
const shortName = (c) => c.p.name.replace(/ \(.*\)$/, '');
export function viewAISettings() {
  const list = linkedAIs();
  const def = aiFor('');
  const opts = [['', `${t('Default')} (${list.length ? shortName(def) : '–'})`], ...list.map((c) => [c.provider, shortName(c)])];
  const audioOpts = [['', t('Automatic')], ...list.filter((c) => c.p.audio).map((c) => [c.provider, shortName(c)])];
  return `<div class="pad">
    <p class="hint lead"${stagger(0)}>${esc(t('Link as many AIs as you like. Pick one as default, choose which AI does what, and switch between them in every chat.'))}</p>
    <div class="section-title">${esc(t('Linked AIs'))}</div>
    <div class="card"${stagger(1)}>${list.length ? list.map((c) => {
      const pr = priceOf(c.provider, c.model, null, c.base);
      const tag = priceTag(pr);
      return `<button class="row ai-row" data-act="ai-row" data-p="${c.provider}"><span class="row-ic tint ai-ic">${icon('sparkles')}</span>
        <span class="row-text"><b>${esc(shortName(c))}${c.provider === def.provider ? ` <em class="pi-tag tier">${esc(t('Default'))}</em>` : ''}</b><small>${esc(c.model)}${pr?.label ? ` · ${esc(pr.label)}` : ''}</small></span>
        ${tag ? `<em class="pi-tag ${tag.cls || ''}">${esc(tag.text)}</em>` : ''}${icon('ellipsis-vertical', 'row-chev')}</button>`;
    }).join('') : `<div class="row"><span class="row-text"><b>${esc(t('No AI linked yet'))}</b><small>${esc(t('Gemini has a free tier. Get a key in a minute.'))}</small></span></div>`}
      <button class="row" data-act="ai-link"><span class="row-ic">${icon('plus')}</span><span class="row-text"><b>${esc(list.length ? t('Link another AI') : t('Link an AI'))}</b></span>${icon('chevron-right', 'row-chev')}</button>
    </div>
    ${list.length ? `<div class="section-title">${esc(t('Which AI does what'))}</div>
    <div class="card"${stagger(2)}>
      ${dd(t('Chats & homework help'), 'ai_chat', opts, S.settings.ai_chat || '', { ic: 'message-square' })}
      ${dd(t('Study plans'), 'ai_plan', opts, S.settings.ai_plan || '', { ic: 'graduation-cap' })}
      ${dd(t('Files & documents'), 'ai_files', opts, S.settings.ai_files || '', { ic: 'file-text' })}
      ${dd(t('Lesson summaries'), 'ai_summary', audioOpts, S.settings.ai_summary || '', { ic: 'mic' })}
    </div>
    <div class="card"${stagger(3)}>${toggle('aiFallback', t('Backup AI'), t('If an AI fails (limit reached, no credit), ask the next linked AI automatically'))}</div>` : ''}
  </div>`;
}
export function aiRowMenu(anchor, provider) {
  const c = linkedAIs().find((x) => x.provider === provider);
  if (!c) return;
  const isDef = aiFor('').provider === provider;
  openMenu(anchor, [['edit', t('Change model or key')], ...(isDef ? [] : [['default', t('Make default')]]), ['unlink', t('Unlink')]], '', (v) => {
    if (v === 'edit') openAISetup(null, { provider });
    if (v === 'default') { S.settings.aiProvider = provider; store.saveSettings(S.settings); render(); }
    if (v === 'unlink') import('./core.js').then(({ uiConfirm }) => uiConfirm(t('Unlink {name}?', { name: shortName(c) }), { danger: true, ok: t('Unlink') })).then((ok) => { if (ok) unlinkAI(provider); });
  }, shortName(c));
}
export function unlinkAI(provider) {
  store.setAiKey('', provider);
  S.settings[`aiOn_${provider}`] = false;
  for (const f of ['ai_chat', 'ai_plan', 'ai_files', 'ai_summary']) if (S.settings[f] === provider) S.settings[f] = '';
  if (S.settings.aiProvider === provider) S.settings.aiProvider = linkedAIs()[0]?.provider || 'gemini';
  store.saveSettings(S.settings);
  render();
}

// ---------------------------------------------------------------- "Sign in with OpenRouter" (OAuth PKCE, no key copying)
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function openRouterSignIn() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const callback = 'http://localhost:3000/oauth';
  AIS.error = ''; AIS.testing = true; keepAi(rerenderSheet);
  try {
    const wait = native.oauthListen({ port: 3000, timeout: 300000 });
    await native.openUrl(`https://openrouter.ai/auth?callback_url=${encodeURIComponent(callback)}&code_challenge=${challenge}&code_challenge_method=S256`);
    const { path } = await wait;
    const code = new URL(path, 'http://x').searchParams.get('code');
    if (!code) throw new Error(t('Sign-in was cancelled.'));
    const r = await fetch('https://openrouter.ai/api/v1/auth/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }) });
    const j = await r.json().catch(() => ({}));
    if (!j.key) throw new Error(j.error?.message || `OpenRouter: HTTP ${r.status}`);
    store.setAiKey(j.key, 'openrouter');
    if (!linkedAIs().some((c) => c.provider === S.settings.aiProvider && c.provider !== 'openrouter')) S.settings.aiProvider = 'openrouter';
    S.settings.aiModels = { ...(S.settings.aiModels || {}), openrouter: (S.settings.aiModels || {}).openrouter || 'deepseek/deepseek-chat-v3-0324:free' };
    store.saveSettings(S.settings);
    AIS.testing = false;
    toast(t('AI connected: {name}', { name: 'OpenRouter' }));
    const inp = $('#setup-key'); if (inp) inp.value = j.key;
    loadAiModels(true);
  } catch (e) {
    AIS.testing = false;
    AIS.error = e.code === 'web' ? t('Sign-in works in the app. In the browser, paste a key instead.') : e.message;
    keepAi(rerenderSheet);
  }
}

export function useFreeAI() {
  S.settings.aiOn_pollinations = true;
  S.settings.aiModels = { ...(S.settings.aiModels || {}), pollinations: S.settings.aiModels?.pollinations || 'openai' };
  if (!linkedAIs().some((c) => c.provider === S.settings.aiProvider && c.provider !== 'pollinations')) S.settings.aiProvider = 'pollinations';
  store.saveSettings(S.settings);
  toast(t('Free AI is ready'));
  closeSheet();
  import('./app.js').then((m) => m.render());
}
