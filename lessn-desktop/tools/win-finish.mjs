// Windows packaging without Wine: puts the Lessn icon and version info into Lessn.exe (pure JS),
// then builds the installer with the native NSIS compiler (makensis).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ResEdit = require('resedit');
const PELibrary = require('pe-library');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const unpacked = path.join(root, 'dist', 'win-unpacked');
const exe = path.join(unpacked, 'Lessn.exe');

// 1) .ico from PNGs (PNG-compressed icon entries, supported since Windows Vista)
async function makeIco() {
  const { chromium } = require('playwright');
  const src = fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    const data = await page.evaluate(async ([b64, size]) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = c.height = size;
      const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png').split(',')[1];
    }, [src, s]);
    pngs.push(Buffer.from(data, 'base64'));
  }
  await browser.close();
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let off = 6 + dir.length;
  sizes.forEach((s, i) => {
    const e = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1); dir.writeUInt8(0, e + 2); dir.writeUInt8(0, e + 3);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6); dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(off, e + 12);
    off += pngs[i].length;
  });
  const ico = Buffer.concat([head, dir, ...pngs]);
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
  return ico;
}

function patchExe(ico) {
  const data = fs.readFileSync(exe);
  const pe = PELibrary.NtExecutable.from(data, { ignoreCert: true });
  const res = PELibrary.NtExecutableResource.from(pe);
  const iconFile = ResEdit.Data.IconFile.from(ico);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, lang, iconFile.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = pkg.version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: 'Lessn', FileDescription: 'Lessn', CompanyName: 'Lessn', InternalName: 'Lessn', OriginalFilename: 'Lessn.exe',
    LegalCopyright: 'MIT License', ProductVersion: pkg.version, FileVersion: pkg.version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
}

const ico = await makeIco();
patchExe(ico);
execFileSync('makensis', ['-V2', `-DVERSION=${pkg.version}`, `-DSRC=${unpacked}`, `-DICON=${path.join(root, 'build', 'icon.ico')}`, `-DOUT=${path.join(root, 'dist', `Lessn-Setup-${pkg.version}.exe`)}`, path.join(root, 'build', 'installer.nsi')], { stdio: 'inherit' });
console.log('installer ready');
