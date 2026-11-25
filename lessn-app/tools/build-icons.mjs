// Extracts the Lucide icons the app uses into www/js/icons.js (ISC license, see LICENSE-lucide).
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['calendar','calendar-days','calendar-range','house','list-checks','graduation-cap','menu','settings',
 'chevron-left','chevron-right','chevron-down','x','check','circle','circle-check','refresh-cw','log-out','user',
 'map-pin','clock','book-open','info','triangle-alert','ban','arrow-left-right','search','school','lock','eye','eye-off',
 'palette','sun','moon','smartphone','type','layout-grid','rows-3','pencil','sticky-note','trash-2','users','door-open',
 'user-x','wifi-off','sparkles','coffee','bell','paintbrush','rotate-ccw','square-pen','clipboard-list','server','at-sign',
 'circle-alert','circle-x','timer','sliders-horizontal','hash','layers','sunrise','moon-star','tag','download','upload','shield-check','zap','eye-closed','filter','star'];
const out = {};
for (const n of names) {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${n}.svg`, import.meta.url), 'utf8');
  out[n] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').trim();
}
writeFileSync(new URL('../www/js/icons.js', import.meta.url),
  '// Generated from lucide-static (ISC). Run `npm run icons` to rebuild.\nexport const ICONS = ' + JSON.stringify(out, null, 0) + ';\n');
console.log('icons:', Object.keys(out).length);
