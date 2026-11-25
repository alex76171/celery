// Lesson summaries with Google's Gemini API (it understands German audio directly).

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const DEFAULT_MODEL = 'gemini-flash-latest';

const LANG_NAME = { en: 'English', de: 'German', tr: 'Turkish', fr: 'French' };

function prompt(lang, ctx) {
  return `You are given the audio recording of a school lesson${ctx.subject ? ` in the subject "${ctx.subject}"` : ''}${ctx.date ? ` held on ${ctx.date}` : ''}.
The lesson is most likely spoken in German. Listen carefully and answer in ${LANG_NAME[lang] || 'German'}.
Return ONLY a JSON object with these fields:
{
  "title": "short title of the lesson topic",
  "summary": "a clear summary of the lesson in 4-8 sentences",
  "topics": ["main topics covered"],
  "keyPoints": ["important facts, definitions, formulas or explanations a student should remember"],
  "homework": ["homework or tasks that were given, with due dates if mentioned"],
  "tests": [{"what": "test / exam / presentation", "when": "date or time as said, e.g. next Tuesday", "date": "YYYY-MM-DD if it can be worked out from the lesson date, otherwise empty", "details": "what it covers"}],
  "announcements": ["other organisational announcements"]
}
Use empty arrays when something was not mentioned. Do not invent anything that was not said.`;
}

export async function summarizeAudio({ apiKey, model, base64, mime = 'audio/mp4', lang = 'de', context = {} }) {
  if (!apiKey) throw new Error('Add your Gemini API key first.');
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: prompt(lang, context) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
  });
  let j;
  try { j = await res.json(); } catch { throw new Error(`AI service answered with HTTP ${res.status}.`); }
  if (j.error) throw new Error(`AI: ${j.error.message || j.error.status}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('AI returned no result. The recording may be too quiet or too long.');
  let out;
  try { out = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { out = { title: '', summary: text }; }
  for (const k of ['topics', 'keyPoints', 'homework', 'tests', 'announcements']) if (!Array.isArray(out[k])) out[k] = [];
  return out;
}

async function gemini({ apiKey, model, contents, system, json = false, temperature = 0.5 }) {
  if (!apiKey) throw new Error('Add your Gemini API key first.');
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model || DEFAULT_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
    }),
  });
  let j;
  try { j = await res.json(); } catch { throw new Error(`AI service answered with HTTP ${res.status}.`); }
  if (j.error) throw new Error(`AI: ${j.error.message || j.error.status}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('The AI did not answer. Try again.');
  return text;
}

/**
 * Multi-turn chat. messages: [{ role: 'user'|'model', text, images: [{ mime, data }] }]
 */
export function chat({ apiKey, model, messages, system }) {
  const contents = messages.map((m) => ({
    role: m.role,
    parts: [...(m.images || []).filter((i) => i.data).map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })), { text: m.text || ' ' }],
  }));
  return gemini({ apiKey, model, contents, system, temperature: 0.6 });
}

/** Builds a day-by-day study plan for an exam. */
export async function studyPlan({ apiKey, model, lang, exam, today, summaries }) {
  const prompt = `Create a realistic study plan for a school student.
Today is ${today}. The exam is on ${exam.date}: subject "${exam.subject}", "${exam.name}". ${exam.text ? `Details: ${exam.text}.` : ''}
${summaries.length ? `Here are summaries of recent lessons in this subject. Base the plan on their topics:\n${summaries.map((s, i) => `Lesson ${i + 1} (${s.date}): ${s.title}. Topics: ${s.topics.join(', ')}. Key points: ${s.keyPoints.join('; ')}`).join('\n')}` : 'No lesson summaries are available, so plan around typical topics for this subject and keep tasks general.'}
Spread the work from today until the day before the exam, 20–45 minutes per day, with a review day at the end. Skip days only if there are more than 10 days.
Answer in ${({ en: 'English', de: 'German', tr: 'Turkish', fr: 'French' })[lang] || 'German'}. Return ONLY JSON:
{"plan":[{"date":"YYYY-MM-DD","title":"short focus of the day","tasks":["concrete task"],"minutes":30}],"tips":["short tip"]}`;
  const text = await gemini({ apiKey, model, contents: [{ role: 'user', parts: [{ text: prompt }] }], json: true, temperature: 0.4 });
  const out = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim());
  if (!Array.isArray(out.plan)) throw new Error('The AI did not return a plan. Try again.');
  return { plan: out.plan, tips: Array.isArray(out.tips) ? out.tips : [] };
}
