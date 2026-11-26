// AI providers: Google Gemini, OpenAI, Anthropic Claude, Mistral, OpenRouter and any OpenAI-compatible server.
// Every feature (chat with photos, study plans, lesson summaries) goes through `complete()`.
import { S, store } from './core.js';
import { native, hasNative } from './native.js';

export const LANG_NAME = { en: 'English', de: 'German', tr: 'Turkish', fr: 'French', es: 'Spanish', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian', ar: 'Arabic' };

/**
 * audio: 'native' = understands audio directly, 'transcribe' = has a speech-to-text endpoint, null = text and images only.
 * models: preferred model ids, first one the account offers wins when the model list is loaded.
 */
export const PROVIDERS = {
  gemini: {
    name: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', placeholder: 'AIza…', audio: 'native',
    priceUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    model: 'gemini-flash-latest', models: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest'],
  },
  openai: {
    name: 'OpenAI (ChatGPT)', keyUrl: 'https://platform.openai.com/api-keys', placeholder: 'sk-…', base: 'https://api.openai.com/v1',
    audio: 'transcribe', transcribeModel: 'whisper-1', json: true,
    priceUrl: 'https://openai.com/api/pricing',
    model: 'gpt-4o-mini', models: ['gpt-5-mini', 'gpt-5-nano', 'gpt-5', 'gpt-4.1-mini', 'gpt-4o-mini'],
  },
  anthropic: {
    name: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-…', audio: null,
    priceUrl: 'https://www.anthropic.com/pricing#api',
    model: 'claude-opus-5-5', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  mistral: {
    name: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys', placeholder: '', base: 'https://api.mistral.ai/v1',
    audio: 'transcribe', transcribeModel: 'voxtral-mini-latest', json: true,
    priceUrl: 'https://mistral.ai/pricing#api-pricing',
    model: 'mistral-medium-latest', models: ['mistral-medium-latest', 'mistral-small-latest', 'mistral-large-latest'],
  },
  openrouter: {
    name: 'OpenRouter (many models)', keyUrl: 'https://openrouter.ai/keys', placeholder: 'sk-or-…', base: 'https://openrouter.ai/api/v1',
    audio: null, priceUrl: 'https://openrouter.ai/models', model: 'openrouter/auto', models: ['openrouter/auto'],
  },
  pc: {
    name: 'Lessn PC (local AI)', keyUrl: '', placeholder: '', base: '', audio: null, json: false, local: true,
    model: '', models: [],
  },
  custom: {
    name: 'Other (OpenAI-compatible)', keyUrl: '', placeholder: '', base: '', audio: 'transcribe', transcribeModel: 'whisper-1',
    model: '', models: [],
  },
};

// ---------------------------------------------------------------- prices
// USD per 1M tokens (input / output). Claude prices are Anthropic's list prices; the others are approximate
// (checked November 2026) and can change, so the app marks them with "≈" and links the provider's price page.
const PRICES = {
  anthropic: [
    [/^claude-fable-5-2/, 8, 40], [/^claude-mythos-5-2/, 8, 40], [/^claude-fable-5-1/, 10, 50], [/^claude-mythos-5-1/, 10, 50],
    [/^claude-fable-5\b/, 10, 50], [/^claude-opus-5-5/, 4, 20], [/^claude-opus-5\b/, 5, 25], [/^claude-opus-4-[678]/, 5, 25],
    [/^claude-sonnet-5-5/, 2, 10], [/^claude-sonnet-5\b/, 2, 10], [/^claude-sonnet-4-6/, 3, 15], [/^claude-haiku-5-5/, 0.1, 0.5],
    [/^claude-haiku-4-5/, 1, 5],
  ],
  openai: [
    [/^gpt-5\.4-nano/, 0.2, 1.25], [/^gpt-5\.4-mini/, 0.75, 4.5], [/^gpt-5-nano/, 0.05, 0.4], [/^gpt-5-mini/, 0.25, 2], [/^gpt-5(-|$)/, 1.25, 10],
    [/^gpt-4\.1-nano/, 0.1, 0.4], [/^gpt-4\.1-mini/, 0.4, 1.6], [/^gpt-4\.1/, 2, 8], [/^gpt-4o-mini/, 0.15, 0.6], [/^gpt-4o/, 2.5, 10],
    [/^o4-mini/, 1.1, 4.4], [/^o3-mini/, 1.1, 4.4], [/^o3(-|$)/, 2, 8],
  ],
  mistral: [
    [/ministral-3b/, 0.1, 0.1], [/small/, 0.15, 0.6], [/medium/, 1.5, 7.5], [/large/, 0.7, 2.1],
  ],
};
const EXACT = { anthropic: true };
const fmtUsd = (n) => (n >= 1 && n % 1 === 0 ? `$${n}` : n >= 0.01 ? `$${n.toFixed(2)}` : `$${Number(n.toPrecision(2))}`);

/**
 * Price of a model: { free, kind, label, perAnswer } or null when unknown.
 * kind: 'free' | 'tier' (free tier, then paid) | 'paid' | 'auto' | 'local'. orPrice: OpenRouter pricing (USD per token).
 */
export function priceOf(provider, id, orPrice, base = '') {
  if (provider === 'openrouter') {
    if (id === 'openrouter/auto') return { free: false, kind: 'auto' };
    if (/:free$/.test(id)) return { free: true, kind: 'free' };
    if (!orPrice) return null;
    const i = Number(orPrice.prompt) * 1e6; const o = Number(orPrice.completion) * 1e6;
    if (!(i > 0) && !(o > 0)) return { free: true, kind: 'free' };
    return priceLabel(i, o, true);
  }
  if (provider === 'gemini') {
    if (/pro/.test(id)) return { ...priceLabel(2, 12, false), kind: 'paid' };
    if (/lite/.test(id)) return { ...priceLabel(0.25, 1.5, false), free: true, kind: 'tier' };
    if (/flash|gemma/.test(id)) return { ...priceLabel(0.75, 3.75, false), free: true, kind: 'tier' };
    return null;
  }
  if (provider === 'pc') return { free: true, kind: 'local' };
  if (provider === 'custom') {
    return /localhost|127\.0\.0\.1|192\.168\.|\/\/10\.|\.local\b/.test(base) ? { free: true, kind: 'local' } : null;
  }
  const hit = (PRICES[provider] || []).find(([re]) => re.test(id));
  return hit ? priceLabel(hit[1], hit[2], !!EXACT[provider]) : null;
}
function priceLabel(i, o, exact) {
  // A typical homework answer: ~1,500 tokens in, ~600 tokens out
  const per = (i * 1500 + o * 600) / 1e6;
  return {
    free: false, kind: 'paid',
    label: `${exact ? '' : '≈ '}${fmtUsd(i)} / ${fmtUsd(o)}`,
    perAnswer: per < 0.0001 ? '< $0.0001' : fmtUsd(per),
  };
}

// Claude models that accept the server-side refusal fallback (re-runs a declined request on a suitable model).
const CLAUDE_FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|sonnet-5-5|fable-5-1|fable-5-2)$/;

/** Current provider settings. */
export function aiConfig(provider = S.settings.aiProvider || 'gemini') {
  const p = PROVIDERS[provider] || PROVIDERS.gemini;
  const model = (S.settings.aiModels || {})[provider] || (provider === 'gemini' && S.settings.aiModel) || p.model;
  const base = provider === 'custom' ? String(S.settings.aiBaseUrl || '').replace(/\/+$/, '') : provider === 'pc' ? pcBase() : p.base;
  return { provider, p, key: store.aiKey(provider), model, base };
}
const usable = (c) => !!c.key && !!c.model && ((c.provider !== 'custom' && c.provider !== 'pc') || !!c.base);
/** The Lessn Hub on the paired PC forwards to its local AI (Ollama). */
function pcBase() { try { const c = JSON.parse(localStorage.getItem('lessn:pc') || 'null'); return c?.base ? `${c.base}/ai/v1` : ''; } catch { return ''; } }
/** Every provider the user linked (saved a key for), default first. */
export function linkedAIs() {
  const def = S.settings.aiProvider || 'gemini';
  return Object.keys(PROVIDERS).map((id) => aiConfig(id)).filter(usable).sort((a, b) => (b.provider === def) - (a.provider === def));
}
export const aiReady = () => linkedAIs().length > 0;
/** Provider for a feature ('chat' | 'plan' | 'summary' | 'files'): its own choice, else the default, else any linked one. */
export function aiFor(feature, override) {
  const list = linkedAIs();
  const want = override || (feature && S.settings[`ai_${feature}`]) || S.settings.aiProvider || 'gemini';
  return list.find((c) => c.provider === want) || list.find((c) => c.provider === (S.settings.aiProvider || 'gemini')) || list[0] || aiConfig();
}
export const aiLabel = (c) => `${c.p.name.replace(/ \(.*\)$/, '')} · ${c.model}`;

const ERR = (m) => new Error(m);
async function jsonOf(res) {
  let j = {};
  try { j = await res.json(); } catch { throw ERR(`AI service answered with HTTP ${res.status}.`); }
  if (!res.ok || j.error) {
    const e = j.error;
    throw ERR(`AI: ${(typeof e === 'string' ? e : e?.message || e?.status) || `HTTP ${res.status}`}`);
  }
  return j;
}

// ---------------------------------------------------------------- one request per provider
async function callGemini(c, { messages, system, json, temperature }) {
  const contents = messages.map((m) => ({
    role: m.role === 'model' ? 'model' : 'user',
    parts: [...(m.images || []).filter((i) => i.data).map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })),
      ...(m.audio ? [{ inline_data: { mime_type: m.audio.mime, data: m.audio.data } }] : []), { text: m.text || ' ' }],
  }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  const j = await jsonOf(res);
  return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function callClaude(c, { messages, system }) {
  const fallback = CLAUDE_FALLBACK_MODELS.test(c.model);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: 16000,
      ...(system ? { system } : {}),
      ...(fallback ? { fallbacks: 'default' } : {}),
      messages: messages.map((m) => ({
        role: m.role === 'model' ? 'assistant' : 'user',
        content: [
          ...(m.images || []).filter((i) => i.data).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
          { type: 'text', text: m.text || ' ' },
        ],
      })),
    }),
  });
  const j = await jsonOf(res);
  if (j.stop_reason === 'refusal') throw ERR('The AI declined this request.');
  return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function callOpenAICompatible(c, { messages, system, json }) {
  const res = await fetch(`${c.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${c.key}`,
      ...(c.provider === 'openrouter' ? { 'X-Title': 'Lessn' } : {}),
    },
    body: JSON.stringify({
      model: c.model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages.map((m) => {
          const imgs = (m.images || []).filter((i) => i.data);
          return {
            role: m.role === 'model' ? 'assistant' : 'user',
            content: imgs.length && m.role !== 'model'
              ? [{ type: 'text', text: m.text || ' ' }, ...imgs.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))]
              : m.text || ' ',
          };
        }),
      ],
      ...(json && c.p.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  const j = await jsonOf(res);
  const content = j.choices?.[0]?.message?.content;
  return Array.isArray(content) ? content.map((x) => x.text || '').join('') : content || '';
}

/** Sends a conversation and returns the answer text. messages: [{ role: 'user'|'model', text, images: [{ mime, data }] }] */
export async function complete(opts) {
  return (await completeEx(opts)).text;
}

async function callOnce(config, { messages, system, json, temperature }) {
  if (!config.key) throw ERR('Add an AI key first.');
  const call = config.provider === 'gemini' ? callGemini : config.provider === 'anthropic' ? callClaude : callOpenAICompatible;
  const text = await call(config, { messages, system, json, temperature });
  if (!text) throw ERR('The AI did not answer. Try again.');
  return text;
}

/**
 * Like complete(), but also says which AI answered: { text, provider, model, name, fellBack }.
 * Without an explicit config it uses the AI chosen for `feature`, and if that one fails (no credit, limit reached,
 * server down) it automatically asks the next linked AI, unless the user turned the backup off.
 */
export async function completeEx({ messages, system, json = false, temperature = 0.5, config, feature, provider }) {
  const first = config || aiFor(feature, provider);
  const order = [first, ...(config || S.settings.aiFallback === false ? [] : linkedAIs().filter((c) => c.provider !== first.provider))];
  let lastErr;
  for (const c of order) {
    try {
      const text = await callOnce(c, { messages, system, json, temperature });
      return { text, provider: c.provider, model: c.model, name: aiLabel(c), fellBack: c !== first, error: c !== first ? lastErr?.message : '' };
    } catch (e) {
      lastErr = e;
      if (/refus/i.test(e.message)) break; // a declined request should not be retried elsewhere
    }
  }
  throw lastErr || ERR('Add an AI key first.');
}

function parseJson(text) {
  const s = String(text);
  const a = s.search(/[{[]/);
  const b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
}

export function chat({ messages, system, provider }) {
  return completeEx({ messages, system, temperature: 0.6, feature: 'chat', provider });
}

// ---------------------------------------------------------------- model lists
/** Lists the models an account can use, with prices: { models: [{ id, name, price }], ids, best } */
export async function listModels(provider, key, base) {
  const p = PROVIDERS[provider];
  let items = [];
  if (provider === 'gemini') {
    const j = await jsonOf(await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }));
    items = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && !/embedding|aqa|imagen|tts|image-generation|native-audio|live/.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName }));
  } else if (provider === 'anthropic') {
    const j = await jsonOf(await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }));
    items = (j.data || []).map((m) => ({ id: m.id, name: m.display_name }));
  } else {
    const url = `${(provider === 'custom' ? base : provider === 'pc' ? pcBase() : p.base).replace(/\/+$/, '')}/models`;
    const j = await jsonOf(await fetch(url, { headers: { Authorization: `Bearer ${key}` } }));
    items = (j.data || j.models || []).map((m) => ({ id: m.id || m.name, name: m.name && m.name !== m.id ? m.name : '', pricing: m.pricing })).filter((m) => m.id);
    if (provider === 'openai') items = items.filter((m) => /^(gpt-|o\d|chatgpt)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct)/.test(m.id));
    if (provider === 'mistral') items = items.filter((m) => !/(embed|moderation|ocr|voxtral|transcribe)/.test(m.id));
  }
  const seen = new Set();
  let models = items.filter((m) => !seen.has(m.id) && seen.add(m.id))
    .map((m) => ({ id: m.id, name: m.name || '', price: priceOf(provider, m.id, m.pricing, base) }));
  // order: preferred first, then free, then priced (cheapest first), then unknown
  const cost = (m) => (m.price?.free ? -1 : m.price?.label ? parseFloat(m.price.label.replace(/[^\d.]+/, '')) || 0 : 1e9);
  const rank = (m) => (p.models.includes(m.id) ? p.models.indexOf(m.id) : 100);
  models.sort((x, y) => rank(x) - rank(y) || cost(x) - cost(y) || x.id.localeCompare(y.id));
  if (provider === 'openrouter' && !seen.has('openrouter/auto')) models.unshift({ id: 'openrouter/auto', name: 'Auto', price: priceOf('openrouter', 'openrouter/auto') });
  const ids = models.map((m) => m.id);
  return { models, ids, best: p.models.find((m) => ids.includes(m)) || (provider === 'gemini' ? p.model : ids[0]) || p.model };
}

/** Models shown before the account's own list is loaded (no key yet). */
export function catalog(provider) {
  return PROVIDERS[provider].models.map((id) => ({ id, name: '', price: priceOf(provider, id) }));
}

// ---------------------------------------------------------------- lesson summaries
function lessonPrompt(lang, ctx, transcript) {
  const intro = transcript
    ? `Below is an automatic transcript of a school lesson${ctx.subject ? ` in the subject "${ctx.subject}"` : ''}${ctx.date ? ` held on ${ctx.date}` : ''}. It may contain recognition errors.`
    : `You are given the audio recording of a school lesson${ctx.subject ? ` in the subject "${ctx.subject}"` : ''}${ctx.date ? ` held on ${ctx.date}` : ''}. The lesson is most likely spoken in German. Listen carefully.`;
  return `${intro}
Answer in ${LANG_NAME[lang] || 'German'}. Return ONLY a JSON object with these fields:
{
  "title": "short title of the lesson topic",
  "summary": "a clear summary of the lesson in 4-8 sentences",
  "topics": ["main topics covered"],
  "keyPoints": ["important facts, definitions, formulas or explanations a student should remember"],
  "homework": ["homework or tasks that were given, with due dates if mentioned"],
  "tests": [{"what": "test / exam / presentation", "when": "date or time as said, e.g. next Tuesday", "date": "YYYY-MM-DD if it can be worked out from the lesson date, otherwise empty", "details": "what it covers"}],
  "announcements": ["other organisational announcements"]
}
Use empty arrays when something was not mentioned. Do not invent anything that was not said.${transcript ? `\n\nTRANSCRIPT:\n${transcript}` : ''}`;
}

function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function bytesToB64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** Speech-to-text through an OpenAI-compatible /audio/transcriptions endpoint. */
async function transcribe(c, base64, mime) {
  const boundary = `----lessn${Date.now()}`;
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${c.p.transcribeModel}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lesson.m4a"\r\nContent-Type: ${mime}\r\n\r\n`);
  const audio = b64ToBytes(base64);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + audio.length + tail.length);
  body.set(head); body.set(audio, head.length); body.set(tail, head.length + audio.length);
  const url = `${c.base}/audio/transcriptions`;
  let status; let text;
  if (hasNative()) {
    const r = await native.raw({ url, method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, bodyBase64: bytesToB64(body) });
    status = r.status; text = r.data;
  } else {
    const fd = new FormData();
    fd.append('model', c.p.transcribeModel);
    fd.append('file', new Blob([audio], { type: mime }), 'lesson.m4a');
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${c.key}` }, body: fd });
    status = r.status; text = await r.text();
  }
  let j = {};
  try { j = JSON.parse(text); } catch { /* handled below */ }
  if (status >= 400 || !j.text) throw ERR(`Transcription failed: ${j.error?.message || `HTTP ${status}`}`);
  return j.text;
}

/** Picks a provider that can handle audio: the current one if it can, otherwise any other provider with a saved key. */
function audioConfig() {
  const cur = aiFor('summary');
  if (cur.key && cur.p.audio && (cur.provider !== 'custom' || cur.base)) return cur;
  for (const id of ['gemini', 'openai', 'mistral']) { const c = aiConfig(id); if (c.key) return c; }
  return null;
}
export const audioReady = () => !!audioConfig();

export async function summarizeAudio({ base64, mime = 'audio/mp4', lang = 'de', context = {} }) {
  const ac = audioConfig();
  if (!ac) throw ERR('Lesson summaries need Gemini, OpenAI or Mistral for the audio. Add one of these keys in the AI settings.');
  let text;
  if (ac.p.audio === 'native') {
    text = await complete({ config: ac, json: true, temperature: 0.2, messages: [{ role: 'user', text: lessonPrompt(lang, context), audio: { mime, data: base64 } }] });
  } else {
    const transcript = await transcribe(ac, base64, mime);
    // The summary itself uses the provider you chose (it may differ from the one that transcribed)
    const cur = aiFor('summary');
    text = await complete({ config: usable(cur) ? cur : ac, json: true, temperature: 0.2, messages: [{ role: 'user', text: lessonPrompt(lang, context, transcript) }] });
  }
  let out;
  try { out = parseJson(text); } catch { out = { title: '', summary: text }; }
  for (const k of ['topics', 'keyPoints', 'homework', 'tests', 'announcements']) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

// ---------------------------------------------------------------- study plans
export async function studyPlan({ lang, exam, today, summaries }) {
  const prompt = `Create a realistic study plan for a school student.
Today is ${today}. The exam is on ${exam.date}: subject "${exam.subject}", "${exam.name}". ${exam.text ? `Details: ${exam.text}.` : ''}
${summaries.length ? `Here are summaries of recent lessons in this subject. Base the plan on their topics:\n${summaries.map((s, i) => `Lesson ${i + 1} (${s.date}): ${s.title}. Topics: ${s.topics.join(', ')}. Key points: ${s.keyPoints.join('; ')}`).join('\n')}` : 'No lesson summaries are available, so plan around typical topics for this subject and keep tasks general.'}
Spread the work from today until the day before the exam, 20–45 minutes per day, with a review day at the end. Skip days only if there are more than 10 days.
Answer in ${LANG_NAME[lang] || 'German'}. Return ONLY JSON:
{"plan":[{"date":"YYYY-MM-DD","title":"short focus of the day","tasks":["concrete task"],"minutes":30}],"tips":["short tip"]}`;
  const text = await complete({ messages: [{ role: 'user', text: prompt }], json: true, temperature: 0.4, feature: 'plan' });
  const out = parseJson(text);
  if (!Array.isArray(out.plan)) throw ERR('The AI did not return a plan. Try again.');
  return { plan: out.plan, tips: Array.isArray(out.tips) ? out.tips : [] };
}

export const DEFAULT_MODEL = PROVIDERS.gemini.model;

// ---------------------------------------------------------------- quick helpers used across the app
const ask = (feature, prompt, extra = {}) => complete({ feature, temperature: 0.4, messages: [{ role: 'user', text: prompt, images: extra.images }], system: extra.system });
const langName = () => LANG_NAME[S.settings.lang] || 'German';

/** Explains / summarizes a file the student opened (pages or photos as images, or plain text). */
export function fileHelp({ mode, name, text, images }) {
  const what = {
    summary: 'Summarize this document for a school student: a short overview, then the most important points as a list.',
    explain: 'Explain this document simply, step by step, as a patient tutor. Point out the key terms.',
    quiz: 'Make 6 quiz questions with short answers (answers at the end) so the student can check if they understood this document.',
    cards: 'Make 10 flashcards (front – back) with the most important facts, definitions and formulas from this document.',
    tasks: 'Find every task or exercise in this document and explain how to approach each one (hints, not full solutions).',
  }[mode] || mode;
  return ask('files', `${what}\nFile name: ${name}.\nAnswer in ${langName()}. Use simple Markdown.${text ? `\n\nCONTENT:\n${text.slice(0, 60000)}` : ''}`, { images });
}

/** Summary of an e-mail plus the things the student has to do. */
export function mailHelp({ mode, subject, from, body, note }) {
  if (mode === 'reply') return ask('chat', `Write a short, polite reply e-mail in ${langName()} from a school student to this e-mail. ${note ? `The reply should say: ${note}.` : ''} Return only the reply text, no subject line.\n\nFROM: ${from}\nSUBJECT: ${subject}\n\n${body.slice(0, 20000)}`);
  return ask('chat', `Summarize this e-mail for a school student in 2-4 sentences in ${langName()}. Then list any tasks, deadlines or dates as bullet points (or say there are none).\n\nFROM: ${from}\nSUBJECT: ${subject}\n\n${body.slice(0, 20000)}`);
}

/** Summary of a chat, a reply suggestion, or a translation of a message. */
export function chatHelp({ mode, lines, note, text }) {
  if (mode === 'translate') return ask('chat', `Translate this message into ${langName()} (if it is already in ${langName()}, translate it into English). Return only the translation.\n\n${text}`);
  if (mode === 'reply') return ask('chat', `You help a school student answer in a school messenger. Suggest ONE short, friendly reply in the language of the chat${note ? ` that says: ${note}` : ''}. Return only the reply text.\n\nCHAT (oldest first):\n${lines.slice(-30).join('\n')}`);
  return ask('chat', `Summarize this school chat in ${langName()}: what was discussed, decisions, dates, and anything the student has to do. Use short bullet points.\n\nCHAT (oldest first):\n${lines.slice(-120).join('\n')}`);
}

/** Turns a photo or text into homework entries: [{ subject, text, due: 'YYYY-MM-DD' }] */
export async function extractHomework({ text, images, subjects, today }) {
  const out = await complete({ feature: 'chat', json: true, temperature: 0.2, messages: [{ role: 'user', images, text: `Find homework or tasks in this ${images?.length ? 'photo' : 'text'} and return ONLY JSON: {"items":[{"subject":"one of: ${subjects.join(', ')} (or empty)","text":"the task","due":"YYYY-MM-DD or empty"}]}. Today is ${today}. Write the tasks in ${langName()}.${text ? `\n\n${text}` : ''}` }] });
  const j = parseJson(out);
  return Array.isArray(j.items) ? j.items.filter((x) => x && x.text) : [];
}

