// Small document helpers without libraries: text from Office files (docx/pptx/xlsx/odt/odp/ods) and photos -> PDF.

/** Reads the entries of a ZIP file (Office files are ZIPs). Returns { name: Uint8Array } for the names `want` accepts. */
async function unzip(bytes, want) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= bytes.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true); const extra = dv.getUint16(p + 30, true); const comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    if (!want(name)) continue;
    const lstart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = bytes.subarray(lstart, lstart + csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  }
  return out;
}

const xmlText = (xml, paraTag) => xml
  .replace(new RegExp(`</${paraTag}>`, 'g'), '\n')
  .replace(/<w:tab\/>|<text:tab\/>/g, '\t').replace(/<w:br\/>|<a:br\/>|<text:line-break\/>/g, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

export const officeKind = (name) => (name.toLowerCase().match(/\.(docx|pptx|xlsx|odt|odp|ods)$/) || [])[1] || '';

/** Plain text of an Office/OpenDocument file. */
export async function officeText(bytes, name) {
  const kind = officeKind(name);
  const dec = new TextDecoder();
  if (kind === 'docx') {
    const f = await unzip(bytes, (n) => n === 'word/document.xml');
    return xmlText(dec.decode(f['word/document.xml'] || new Uint8Array()), 'w:p');
  }
  if (kind === 'pptx') {
    const f = await unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return Object.keys(f).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))
      .map((k, i) => `— ${i + 1} —\n${xmlText(dec.decode(f[k]), 'a:p')}`).join('\n\n');
  }
  if (kind === 'xlsx') {
    const f = await unzip(bytes, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const shared = [...dec.decode(f['xl/sharedStrings.xml'] || new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1], 'x'));
    return Object.keys(f).filter((k) => k.includes('worksheets')).sort().map((k) => {
      const xml = dec.decode(f[k]);
      return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>|<c[^>]*\/>/g)]
        .map((c) => (/t="s"/.test(c[1] || '') ? shared[Number(c[2])] || '' : (c[2] || '').replace(/<[^>]+>/g, ''))).join('\t')).join('\n');
    }).join('\n\n');
  }
  if (kind === 'odt' || kind === 'odp' || kind === 'ods') {
    const f = await unzip(bytes, (n) => n === 'content.xml');
    return xmlText(dec.decode(f['content.xml'] || new Uint8Array()), 'text:p');
  }
  return '';
}

/** Builds a PDF from JPEG photos (one page each, A4-ish width). photos: [{ bytes: Uint8Array, w, h }] */
export function photosToPdf(photos) {
  const enc = new TextEncoder();
  const chunks = []; const offsets = []; let len = 0;
  const add = (part) => { const b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; add(`${n} 0 obj\n`); body.forEach(add); add('\nendobj\n'); };
  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pages = photos.map((_, i) => 3 + i * 3);
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${pages.map((p) => `${p} 0 R`).join(' ')}] /Count ${photos.length} >>`]);
  photos.forEach((ph, i) => {
    const n = 3 + i * 3;
    const W = 595; const H = Math.round(W * ph.h / ph.w);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`]);
    obj(n + 1, [`<< /Type /XObject /Subtype /Image /Width ${ph.w} /Height ${ph.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${ph.bytes.length} >>\nstream\n`, ph.bytes, '\nendstream']);
    obj(n + 2, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  });
  const xref = len;
  const total = 3 + photos.length * 3;
  add(`xref\n0 ${total}\n0000000000 65535 f \n${Array.from({ length: total - 1 }, (_, i) => `${String(offsets[i + 1]).padStart(10, '0')} 00000 n \n`).join('')}`);
  add(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  const out = new Uint8Array(len); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Photo file -> scanned-looking JPEG (max 1800 px, a bit more contrast). */
export function scanPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const ctx = cv.getContext('2d');
      ctx.filter = 'contrast(1.25) brightness(1.06) saturate(0.9)';
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const data = cv.toDataURL('image/jpeg', 0.82);
      resolve({ bytes: b64ToBytes(data.split(',')[1]), w: cv.width, h: cv.height });
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
