// Several WebUntis accounts on one device (e.g. siblings, or two schools). Each account keeps its own data
// (timetable cache, homework, notes, chats, calendar, IServ); theme, AI keys and app settings are shared.
import { S, t, esc, icon, toast, openSheet, closeSheet, uiConfirm, store } from './core.js';

const KEY = 'lessn:';
const PROFILE_KEYS = ['account', 'iserv', 'grades', 'summaries', 'myexams', 'notes', 'hwdone', 'chats', 'myhw', 'plans', 'plandone', 'seen', 'events', 'checkins', 'holnames', 'icsfeeds', 'icsevents', 'desk:seen'];
const PROFILE_PREFIXES = ['cache:', 'mx:'];
const isProfileKey = (k) => k.startsWith(KEY) && !k.startsWith(`${KEY}p:`) && (PROFILE_KEYS.includes(k.slice(KEY.length)) || PROFILE_PREFIXES.some((p) => k.slice(KEY.length).startsWith(p)));

export function profiles() {
  let p;
  try { p = JSON.parse(localStorage.getItem(`${KEY}profiles`) || 'null'); } catch { p = null; }
  if (!p) {
    const a = store.account();
    p = { active: 'p1', list: [{ id: 'p1', name: a?.username || t('Account 1'), school: a?.schoolName || a?.school || '' }] };
  }
  return p;
}
const saveProfiles = (p) => localStorage.setItem(`${KEY}profiles`, JSON.stringify(p));
export const isPrimaryProfile = () => profiles().active === profiles().list[0]?.id;

/** Moves the live data of the active account into its own storage area. */
function stash(id) {
  for (const k of Object.keys(localStorage)) {
    if (!isProfileKey(k)) continue;
    localStorage.setItem(`${KEY}p:${id}:${k.slice(KEY.length)}`, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
}
/** Brings an account's stored data back as the live data. */
function unstash(id) {
  const pre = `${KEY}p:${id}:`;
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith(pre)) continue;
    localStorage.setItem(KEY + k.slice(pre.length), localStorage.getItem(k));
    localStorage.removeItem(k);
  }
}
function updateActiveInfo(p) {
  const a = store.account();
  const cur = p.list.find((x) => x.id === p.active);
  if (cur && a) { cur.name = a.username; cur.school = a.schoolName || a.school || ''; }
}

export function switchProfile(id) {
  const p = profiles();
  if (id === p.active) { closeSheet(); return; }
  updateActiveInfo(p);
  stash(p.active);
  unstash(id);
  p.active = id;
  saveProfiles(p);
  location.reload();
}
export function addProfile() {
  const p = profiles();
  updateActiveInfo(p);
  stash(p.active);
  const id = `p${Date.now().toString(36)}`;
  p.list.push({ id, name: t('New account'), school: '' });
  p.active = id;
  saveProfiles(p);
  location.reload();
}
export async function removeProfile(id) {
  const p = profiles();
  if (p.list.length < 2) return;
  if (!await uiConfirm(t('Remove this account and its data from this device?'), { danger: true, ok: t('Remove') })) return;
  if (id === p.active) {
    for (const k of Object.keys(localStorage)) if (isProfileKey(k)) localStorage.removeItem(k);
    p.list = p.list.filter((x) => x.id !== id);
    p.active = p.list[0].id;
    unstash(p.active);
  } else {
    for (const k of Object.keys(localStorage)) if (k.startsWith(`${KEY}p:${id}:`)) localStorage.removeItem(k);
    p.list = p.list.filter((x) => x.id !== id);
  }
  saveProfiles(p);
  location.reload();
}
/** Keeps the account list in step after signing in. */
export function rememberActiveAccount() {
  const p = profiles();
  updateActiveInfo(p);
  saveProfiles(p);
}

export function openProfiles() {
  const p = profiles();
  updateActiveInfo(p);
  openSheet(() => `<h2 class="sheet-title">${icon('users')}${esc(t('Accounts'))}</h2>
    <p class="hint">${esc(t('Use Lessn with several WebUntis accounts, for example for siblings or a second school. Each account has its own timetable, homework, chats and calendar.'))}</p>
    <div class="card">${p.list.map((x) => `<div class="row ${x.id === p.active ? 'on' : ''}">
      <button class="row-main" data-act="profile-switch" data-id="${x.id}"><span class="avatar sm">${esc((x.name || '?')[0].toUpperCase())}</span><span class="row-text"><b>${esc(x.name || t('Account'))}</b><small>${esc(x.school || '')}${x.id === p.active ? ` · ${esc(t('Active'))}` : ''}</small></span></button>
      ${p.list.length > 1 ? `<button class="icon-btn" data-act="profile-remove" data-id="${x.id}" aria-label="${esc(t('Remove'))}">${icon('x')}</button>` : ''}</div>`).join('')}
      <button class="row" data-act="profile-add"><span class="row-ic">${icon('user-plus')}</span><span class="row-text"><b>${esc(t('Add another account'))}</b></span>${icon('chevron-right', 'row-chev')}</button></div>
    ${p.list.length > 1 ? `<p class="hint">${esc(t('Sync with a PC only runs for the first account.'))}</p>` : ''}`);
}
void S;
