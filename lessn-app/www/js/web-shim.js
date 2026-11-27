// Runs only when Lessn is opened in a normal browser (not the Android app, not Lessn for Windows).
// Browsers block pages from talking to WebUntis and IServ directly (CORS). When the page is served by the small
// Lessn web server, every outside request goes through it (it keeps the login cookies); AI services are reached directly.
(function () {
  if (window.Capacitor || window.lessnDesktop) return;
  document.documentElement.classList.add('web');
  const PROXY = window.__LESSN_PROXY || null;
  window.__lessnWeb = { proxy: !!PROXY };
  // these allow browser requests themselves, so they don't need the server
  const DIRECT = /(^|\.)(googleapis\.com|openai\.com|anthropic\.com|mistral\.ai|openrouter\.ai|pollinations\.ai|groq\.com|x\.ai|deepseek\.com|perplexity\.ai|cohere\.ai|cerebras\.ai|together\.xyz|fireworks\.ai|github\.ai|huggingface\.co|nvidia\.com|sambanova\.ai|moonshot\.ai|aliyuncs\.com|z\.ai|openstreetmap\.org|jsdelivr\.net)$/;
  const own = window.fetch.bind(window);
  if (!PROXY) {
    window.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.className = 'web-hint';
      bar.innerHTML = 'Lessn im Browser: Für den WebUntis/IServ-Login Lessn über den mitgelieferten Server öffnen (start-windows.bat / start.sh). · To sign in to WebUntis/IServ, open Lessn through the included server.';
      bar.onclick = () => bar.remove();
      document.body.appendChild(bar);
      setTimeout(() => { bar.style.opacity = '0'; setTimeout(() => bar.remove(), 450); }, 9000);
    });
    return;
  }
  window.fetch = async function (input, init) {
    const req = new Request(input, init);
    const u = new URL(req.url, location.href);
    if (u.origin === location.origin || !/^https?:$/.test(u.protocol) || DIRECT.test(u.hostname)) return own(input, init);
    const headers = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer();
    const r = await own(PROXY, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-lessn-url': u.href, 'x-lessn-method': req.method, 'x-lessn-redirect': req.redirect === 'manual' ? 'manual' : 'follow', 'x-lessn-headers': btoa(unescape(encodeURIComponent(JSON.stringify(headers)))) },
      body,
    });
    if (r.status === 599) throw new TypeError(`Failed to fetch (${await r.text()})`);
    const status = Number(r.headers.get('x-lessn-status')) || r.status;
    const out = new Response([101, 204, 205, 304].includes(status) ? null : await r.arrayBuffer(), { status: status >= 200 && status <= 599 ? status : 200, headers: JSON.parse(decodeURIComponent(escape(atob(r.headers.get('x-lessn-headers') || 'e30=')))) });
    Object.defineProperty(out, 'url', { value: r.headers.get('x-lessn-final-url') || u.href });
    return out;
  };
})();
