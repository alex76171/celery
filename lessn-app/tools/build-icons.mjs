// Extracts the Lucide icons the app uses into www/js/icons.js (ISC license, see LICENSE-lucide).
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['arrow-left-right', 'award', 'ban', 'bell', 'bell-off', 'book-open', 'calendar', 'calendar-check', 'calendar-days', 'calendar-range', 'check', 'chevron-down', 'chevron-left', 'chevron-right', 'circle-alert', 'circle-check', 'circle-x', 'clipboard-list', 'clock', 'coffee', 'door-open', 'download', 'external-link', 'eye', 'eye-off', 'folder', 'globe', 'graduation-cap', 'house', 'inbox', 'info', 'key-round', 'layers', 'layout-grid', 'list-checks', 'locate-fixed', 'lock', 'log-out', 'mail', 'map-pin', 'megaphone', 'message-square', 'mic', 'navigation', 'newspaper', 'paintbrush', 'pencil', 'plus', 'refresh-cw', 'rotate-ccw', 'school', 'search', 'server', 'shield-alert', 'shield-check', 'sparkles', 'square', 'star', 'sticky-note', 'sun', 'sunrise', 'timer', 'trash-2', 'triangle-alert', 'user', 'users', 'x'];
const out = {};
for (const n of names) {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${n}.svg`, import.meta.url), 'utf8');
  out[n] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').trim();
}
writeFileSync(new URL('../www/js/icons.js', import.meta.url),
  '// Generated from lucide-static (ISC). Run `npm run icons` to rebuild.\nexport const ICONS = ' + JSON.stringify(out, null, 0) + ';\n');
console.log('icons:', Object.keys(out).length);
