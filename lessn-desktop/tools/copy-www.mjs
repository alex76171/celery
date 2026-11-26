// Copies the shared app (lessn-app/www) into the desktop app, so phone and PC always run the same code.
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.resolve(root, '..', 'lessn-app', 'www');
const dst = path.join(root, 'app', 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
fs.copyFileSync(path.join(root, 'build', 'icon.png'), path.join(root, 'app', 'icon.png'));
console.log('copied app to', dst);
