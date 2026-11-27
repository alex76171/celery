// Builds dist/Lessn.html: the whole app (code, styles, fonts, icon) in one file, plus the server and start scripts.
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.dirname(new URL(import.meta.url).pathname);
const www = path.resolve(root, '..', 'lessn-app', 'www');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

const js = await esbuild.build({ entryPoints: [path.join(www, 'js', 'app.js')], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' });
const shim = fs.readFileSync(path.join(www, 'js', 'web-shim.js'), 'utf8');
const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const inlineFonts = (css) => css.replace(/url\(\.\.\/fonts\/([^)]+)\)/g, (_, f) => `url(${dataUri(path.join(www, 'fonts', f), 'font/woff2')})`);
const css = inlineFonts(fs.readFileSync(path.join(www, 'css', 'fonts.css'), 'utf8')) + '\n' + fs.readFileSync(path.join(www, 'css', 'app.css'), 'utf8');
const icon = dataUri(path.join(www, 'icon.png'), 'image/png');
const code = js.outputFiles[0].text.replace(/"icon\.png"/g, JSON.stringify(icon)).replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#5B47F0">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Lessn</title>
<link rel="icon" href="${icon}">
<link rel="apple-touch-icon" href="${icon}">
<style>${css}</style>
</head>
<body>
<script>${shim}</script>
<script>${code}</script>
</body>
</html>
`;
fs.writeFileSync(path.join(out, 'Lessn.html'), html);
fs.copyFileSync(path.join(root, 'server.js'), path.join(out, 'server.js'));
fs.writeFileSync(path.join(out, 'start-windows.bat'), '@echo off\r\ntitle Lessn\r\nwhere node >nul 2>nul || (echo Node.js is needed: https://nodejs.org & start https://nodejs.org & pause & exit /b)\r\nstart "" http://localhost:8080\r\nnode "%~dp0server.js" --lan\r\npause\r\n');
fs.writeFileSync(path.join(out, 'start.sh'), '#!/bin/sh\ncd "$(dirname "$0")"\ncommand -v node >/dev/null || { echo "Node.js is needed: https://nodejs.org"; exit 1; }\n(sleep 1; (xdg-open http://localhost:8080 || open http://localhost:8080) >/dev/null 2>&1) &\nnode server.js --lan\n');
fs.chmodSync(path.join(out, 'start.sh'), 0o755);
console.log(`dist/Lessn.html ${(html.length / 1e6).toFixed(1)} MB`);
