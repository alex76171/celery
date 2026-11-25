// Two-step sign-in: 1) find your school, 2) enter your login.
import { S, t, esc, icon, $, store, applyTheme } from './core.js';
import { LANGS } from './i18n.js';
import { Untis, searchSchools, parseServerInput } from './api.js';
import { startApp } from './app.js';

const L = { step: 1, dir: 'fwd', school: null, manual: false, results: [], query: '', searching: false, searchMsg: '', error: '', busy: false };

const blobs = '<div class="blobs" aria-hidden="true"><i></i><i></i><i></i></div>';

function langPicker() {
  return `<div class="lang-pick">${icon('globe')}<select id="lang-sel">${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${S.settings.lang === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>`;
}

function step1() {
  return `<div class="login-step step-${L.dir}">
    <div class="login-top"><span></span>${langPicker()}</div>
    <div class="login-hero">
      <div class="logo">${icon('calendar-days')}</div>
      <h1>${esc(t('Find your school'))}</h1>
      <p>${esc(t('Search for your school to sign in with your WebUntis account.'))}</p>
    </div>
    ${L.manual ? `<div class="login-card">
        <label class="lbl">${esc(t('Server'))}</label><label class="input">${icon('server')}<input id="m-server" placeholder="${esc(t('e.g. nessa.webuntis.com'))}" autocapitalize="off" autocorrect="off"></label>
        <label class="lbl">${esc(t('School login name'))}</label><label class="input">${icon('school')}<input id="m-school" placeholder="${esc(t('As shown in the WebUntis URL'))}" autocapitalize="off" autocorrect="off"></label>
        <button class="btn" data-login="manual-next">${esc(t('Continue'))}${icon('chevron-right')}</button>
        <button type="button" class="link" data-login="search">${icon('search')}${esc(t('Search for your school instead'))}</button>
      </div>`
    : `<label class="input big">${icon('search')}<input id="school-q" placeholder="${esc(t('School name or city'))}" value="${esc(L.query)}" autocomplete="off" autofocus></label>
      <div id="school-results">${schoolResults()}</div>
      <button type="button" class="link center" data-login="manual">${esc(t("Can't find it? Enter the server manually"))}</button>`}
  </div>`;
}

function step2() {
  const sc = L.school;
  return `<div class="login-step step-${L.dir}">
    <div class="login-top"><button class="icon-btn" data-login="back" aria-label="${esc(t('Back'))}">${icon('chevron-left')}</button>${langPicker()}</div>
    <div class="login-hero compact">
      <div class="school-badge">${icon('school')}</div>
      <h1>${esc(sc.name)}</h1>
      <p>${esc(sc.address || sc.server)}</p>
    </div>
    <form id="login-form" class="login-card" autocomplete="on">
      <label class="lbl">${esc(t('Username'))}</label><label class="input">${icon('user')}<input name="username" autocomplete="username" autocapitalize="off" autocorrect="off" required></label>
      <label class="lbl">${esc(t('Password'))}</label><label class="input">${icon('lock')}<input name="password" type="password" autocomplete="current-password" required><button type="button" class="eye" data-login="eye" aria-label="${esc(t('Show password'))}">${icon('eye')}</button></label>
      ${L.error ? `<div class="err shake">${icon('circle-alert')}<span>${esc(L.error)}</span></div>` : ''}
      <button class="btn" ${L.busy ? 'disabled' : ''}>${L.busy ? `${icon('refresh-cw', 'spin-ic')}${esc(t('Signing in'))}` : esc(t('Sign in'))}</button>
      <p class="fine">${icon('shield-check')}${esc(t("Your login stays on this phone and is only sent to your school's server."))}</p>
    </form>
  </div>`;
}

function schoolResults() {
  if (L.searching) return `<div class="results muted">${icon('refresh-cw', 'spin-ic')}${esc(t('Searching'))}</div>`;
  if (L.searchMsg) return `<div class="results muted">${icon('circle-alert')}${esc(L.searchMsg)}</div>`;
  if (!L.results.length) return L.query.length >= 3 ? `<div class="results muted">${icon('search')}${esc(t('No schools found'))}</div>` : '';
  return `<div class="results">${L.results.slice(0, 25).map((s, i) => `<button type="button" class="result" data-login="pick" data-i="${i}" style="--i:${Math.min(i, 10)}"><span class="res-ic">${icon('school')}</span><div><b>${esc(s.name)}</b><small>${esc(s.address)}</small></div>${icon('chevron-right', 'row-chev')}</button>`).join('')}</div>`;
}

export function renderLogin() {
  document.body.innerHTML = `<div class="login">${blobs}${L.step === 1 ? step1() : step2()}</div><div id="toast" class="toast"></div>`;
}

function keepCreds() {
  const f = $('#login-form');
  return f ? Object.fromEntries([...f.querySelectorAll('input[name]')].map((i) => [i.name, i.value])) : {};
}
function restoreCreds(v) {
  Object.entries(v || {}).forEach(([k, val]) => { const i = $(`#login-form input[name="${k}"]`); if (i) i.value = val; });
}
const go = (step, dir) => { L.step = step; L.dir = dir; renderLogin(); };

let searchTimer;
export function bindLogin() {
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'lang-sel') return;
    S.settings.lang = e.target.value;
    store.saveSettings(S.settings);
    applyTheme();
    const k = keepCreds(); L.dir = 'none'; renderLogin(); restoreCreds(k);
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'school-q') return;
    L.query = e.target.value.trim();
    L.searchMsg = '';
    clearTimeout(searchTimer);
    const box = () => $('#school-results');
    if (L.query.length < 3) { L.results = []; if (box()) box().innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      L.searching = true;
      if (box()) box().innerHTML = schoolResults();
      try { L.results = await searchSchools(L.query); } catch (err) {
        L.results = [];
        L.searchMsg = err.code === -6003 ? t('Too many results. Type a bit more.') : t('School search is unavailable. Enter the server manually.');
      }
      L.searching = false;
      if (box()) box().innerHTML = schoolResults();
    }, 350);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-login]');
    if (!b) return;
    const a = b.dataset.login;
    if (a === 'pick') { L.school = L.results[Number(b.dataset.i)]; L.error = ''; go(2, 'fwd'); }
    else if (a === 'back') { L.error = ''; go(1, 'back'); }
    else if (a === 'manual') { L.manual = true; go(1, 'none'); }
    else if (a === 'search') { L.manual = false; go(1, 'none'); }
    else if (a === 'manual-next') {
      const p = parseServerInput($('#m-server').value);
      const school = ($('#m-school').value || p.school || '').trim();
      if (!p.server || !school) { b.classList.add('shake'); setTimeout(() => b.classList.remove('shake'), 500); return; }
      L.school = { name: school, server: p.server, login: school, address: p.server };
      go(2, 'fwd');
    } else if (a === 'eye') {
      const inp = b.previousElementSibling;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.innerHTML = icon(inp.type === 'password' ? 'eye' : 'eye-off');
    }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'login-form') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const sc = L.school;
    const username = String(f.get('username')).trim();
    const password = String(f.get('password'));
    const keep = keepCreds();
    L.busy = true; L.error = ''; L.dir = 'none'; renderLogin(); restoreCreds(keep);
    try {
      const api = new Untis({ server: sc.server, school: sc.login, username, password });
      await api.login();
      const acc = {
        server: sc.server, school: sc.login, schoolName: sc.name, schoolAddress: sc.address || '', username, password,
        element: api.ownElement(), personType: api.personType, personId: api.personId, klasseId: api.klasseId,
      };
      store.setAccount(acc);
      S.account = acc;
      L.busy = false;
      startApp(api);
    } catch (err) {
      L.busy = false;
      L.error = t(err.message || 'Login failed.');
      renderLogin(); restoreCreds(keep);
    }
  });
}
