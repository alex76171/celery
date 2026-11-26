// Runs only in Lessn for Windows (does nothing on the phone). Makes the PC look like the Android app to the
// shared code: window.Capacitor.Plugins.LessnNative, fetch() without CORS (through the PC side, with cookies),
// lesson/voice recording with the microphone, and PDF pages rendered with pdf.js.
(function () {
  const D = window.lessnDesktop;
  if (!D) return;
  document.documentElement.classList.add('desktop', `os-${D.platform}`);

  // ---------------------------------------------------------------- fetch through the PC side
  const ownFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const req = new Request(input, init);
    if (!/^https?:/i.test(req.url)) return ownFetch(input, init);
    const headers = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : new Uint8Array(await req.arrayBuffer());
    let r;
    try { r = await D.http({ url: req.url, method: req.method, headers, body, redirect: req.redirect === 'manual' ? 'manual' : 'follow' }); }
    catch (e) { throw new TypeError(`Failed to fetch (${String(e.message || e).replace(/^Error invoking remote method 'http': (Error: )?/, '')})`); }
    const status = r.status >= 200 && r.status <= 599 ? r.status : 200;
    const res = new Response([101, 204, 205, 304].includes(status) ? null : r.body, { status, headers: r.headers.filter(([k]) => k !== 'set-cookie') });
    Object.defineProperty(res, 'url', { value: r.url });
    Object.defineProperty(res, 'redirected', { value: r.url !== req.url });
    return res;
  };

  // ---------------------------------------------------------------- microphone recording (lessons and voice messages)
  let rec = null;
  async function startMic(maxMinutes) {
    if (rec) throw new Error('Already recording');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const mr = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.start(5000);
    rec = { mr, stream, chunks, started: Date.now(), timer: maxMinutes ? setTimeout(() => { if (rec?.mr === mr) stopMic(false, 'lesson.webm'); }, maxMinutes * 60000) : null };
  }
  async function stopMic(cancel, name) {
    const r = rec; rec = null;
    if (!r) return { path: null };
    clearTimeout(r.timer);
    await new Promise((res) => { r.mr.onstop = res; r.mr.stop(); });
    r.stream.getTracks().forEach((t) => t.stop());
    const duration = Date.now() - r.started;
    if (cancel) return { cancelled: true };
    const blob = new Blob(r.chunks, { type: 'audio/webm' });
    if (/^lesson/.test(name)) {
      // lessons: small MP3 (16 kHz mono) so every AI provider accepts it
      try {
        const mp3 = await toMp3(blob);
        const saved = await D.invoke('writeBytes', { name: name.replace(/\.webm$/, '.mp3'), bytes: mp3 });
        return { path: saved.path, duration, size: mp3.length, mime: 'audio/mpeg' };
      } catch (e) { console.warn('mp3', e); }
    }
    const saved = await D.invoke('writeBytes', { name, bytes: new Uint8Array(await blob.arrayBuffer()) });
    return { path: saved.path, duration, size: blob.size, mime: 'audio/webm' };
  }
  function loadLame() {
    return window.lamejs ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/lame.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  async function toMp3(blob) {
    await loadLame();
    const ac = new AudioContext();
    const decoded = await ac.decodeAudioData(await blob.arrayBuffer());
    ac.close();
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const enc = new window.lamejs.Mp3Encoder(1, rate, 32);
    const parts = []; let total = 0;
    const block = 1152 * 32;
    const i16 = new Int16Array(block);
    for (let i = 0; i < pcm.length; i += block) {
      const n = Math.min(block, pcm.length - i);
      for (let k = 0; k < n; k++) { const v = Math.max(-1, Math.min(1, pcm[i + k])); i16[k] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      const out = enc.encodeBuffer(n === block ? i16 : i16.subarray(0, n));
      if (out.length) { parts.push(new Uint8Array(out)); total += out.length; }
      if (i % (block * 200) === 0) await new Promise((r2) => setTimeout(r2, 0));
    }
    const end = enc.flush(); if (end.length) { parts.push(new Uint8Array(end)); total += end.length; }
    const all = new Uint8Array(total); let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    return all;
  }

  // ---------------------------------------------------------------- PDF pages (pdf.js, loaded on first use)
  let pdfjs = null;
  const pdfCache = new Map();
  async function pdfPage({ path, page = 0, width = 1200 }) {
    if (!pdfjs) {
      pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    }
    let doc = pdfCache.get(path);
    if (!doc) {
      const { data } = await D.invoke('readFileBase64', { path });
      doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), isEvalSupported: false }).promise;
      pdfCache.clear(); pdfCache.set(path, doc);
    }
    const p = await doc.getPage(Math.max(1, Math.min(doc.numPages, page + 1)));
    const vp1 = p.getViewport({ scale: 1 });
    const vp = p.getViewport({ scale: Math.min(4, width / vp1.width) });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await p.render({ canvasContext: ctx, viewport: vp }).promise;
    return { pages: doc.numPages, width: cv.width, height: cv.height, data: cv.toDataURL('image/jpeg', 0.85).split(',')[1] };
  }

  // ---------------------------------------------------------------- the plugin object the app expects
  const local = {
    startRecording: async ({ maxMinutes } = {}) => { await startMic(maxMinutes || 95); },
    stopRecording: () => stopMic(false, `lesson-${Date.now()}.webm`),
    recordingStatus: () => ({ recording: !!rec, startedAt: rec?.started || 0 }),
    voiceStart: () => startMic(10),
    voiceStop: ({ cancel } = {}) => stopMic(cancel, `voice-${Date.now()}.webm`),
    pdfPage,
    requestPermissions: async ({ permissions = [] } = {}) => {
      const out = {};
      for (const p of permissions) {
        if (p === 'microphone') { try { (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop()); out[p] = 'granted'; } catch { out[p] = 'denied'; } }
        else if (p === 'notifications') out[p] = (await Notification.requestPermission()) === 'granted' ? 'granted' : 'denied';
        else out[p] = 'denied';
      }
      return out;
    },
    addListener: () => ({ remove() {} }),
    takeLaunch: () => ({ target: null }),
    takeCheckins: () => ({ log: {} }),
    takeRecordings: () => { const items = doneRecs.splice(0); return { items, armedFor: armed?.start || 0 }; },
    /** PC: record the next lesson with the microphone, starting and stopping by itself. */
    armRecording: ({ startAt, endAt, title, meta } = {}) => {
      if (armed) clearTimeout(armed.timer);
      const begin = async () => {
        try {
          await startMic(Math.ceil((endAt - Date.now()) / 60000) + 1);
          setTimeout(async () => { const r = await stopMic(false, `lesson-${Date.now()}.webm`); if (r.path) { doneRecs.push({ path: r.path, duration: r.duration, meta, t: Date.now() }); D.invoke('notify', { title: `${title} ✓`, body: 'Lessn' }); } armed = null; }, Math.max(60000, endAt - Date.now()));
        } catch (e) { console.warn(e); armed = null; }
      };
      armed = { start: startAt, timer: setTimeout(begin, Math.max(0, startAt - Date.now())) };
    },
    notifHealth: () => ({ enabled: true, exact: true, battery: true, pending: 0 }),
    testNotification: ({ title, body } = {}) => D.invoke('notify', { title, body }),
    untisBackground: () => {},
    setUntisBackground: () => {},
    openBatterySettings: () => {},
    openNotificationSettings: () => D.invoke('openAppSettings', {}),
  };
  const doneRecs = [];
  let armed = null;
  const plugin = new Proxy({}, { get: (_, name) => (typeof name !== 'string' || name === 'then' ? undefined : local[name] || ((args) => D.invoke(name, args))) });
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'windows',
    isDesktop: true,
    convertFileSrc: (p) => `lfile://local/${encodeURIComponent(p)}`,
    Plugins: { LessnNative: plugin },
  };
  window.lessnHubEvents = [];
  D.on((ev) => { for (const cb of window.lessnHubEvents) { try { cb(ev); } catch (e) { console.warn(e); } } });
})();
