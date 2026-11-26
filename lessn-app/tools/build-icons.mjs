// Extracts the Lucide icons the app uses into www/js/icons.js (ISC license, see LICENSE-lucide).
import { readFileSync, writeFileSync } from 'node:fs';
const names = ['arrow-left-right', 'arrow-up', 'award', 'ban', 'bell', 'bell-off', 'book-open', 'book-user', 'calendar', 'calendar-check', 'calendar-days', 'calendar-range', 'camera', 'chart-bar', 'check', 'chevron-down', 'chevron-left', 'chevron-right', 'chevron-up', 'chevrons-up-down', 'circle-alert', 'circle-check', 'circle-x', 'clipboard-list', 'clock', 'coffee', 'coins', 'copy', 'cpu', 'door-open', 'download', 'ellipsis-vertical', 'external-link', 'eye', 'eye-off', 'file', 'file-archive', 'file-spreadsheet', 'file-text', 'folder', 'folder-plus', 'folders', 'globe', 'graduation-cap', 'house', 'image', 'inbox', 'info', 'key-round', 'layers', 'layout-grid', 'lightbulb', 'list-checks', 'locate-fixed', 'lock', 'log-out', 'mail', 'map-pin', 'megaphone', 'message-square', 'messages-square', 'mic', 'monitor', 'smartphone', 'settings-2', 'music', 'navigation', 'newspaper', 'paintbrush', 'palette', 'paperclip', 'pause', 'pencil', 'play', 'plus', 'presentation', 'refresh-cw', 'reply', 'rotate-ccw', 'school', 'search', 'send', 'server', 'shield-alert', 'shield-check', 'sparkles', 'square', 'square-pen', 'star', 'sticky-note', 'sun', 'sunrise', 'timer', 'trash-2', 'triangle-alert', 'type', 'upload', 'user', 'users', 'video', 'x'];
const out = {};
for (const n of names) {
  const svg = readFileSync(new URL(`../node_modules/lucide-static/icons/${n}.svg`, import.meta.url), 'utf8');
  out[n] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s*\n\s*/g, '').trim();
}
writeFileSync(new URL('../www/js/icons.js', import.meta.url),
  '// Generated from lucide-static (ISC). Run `npm run icons` to rebuild.\nexport const ICONS = ' + JSON.stringify(out, null, 0) + ';\n');
console.log('icons:', Object.keys(out).length);
