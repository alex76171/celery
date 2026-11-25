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
