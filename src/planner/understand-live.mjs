// Hybrid understanding: Gemini only reads the request and returns an intent JSON; core.mjs plans, asks, remembers refusals and checks rules.
// One call per request, no tool turns, thinkingBudget 0, temperature 0. The model never decides moves, questions or ids.
// An invalid or missing reply falls back to the regex parser in core.mjs. Nothing is sent unless the caller opts in with an env that holds GEMINI_API_KEY.
import { understand, parseDeadline, parseMinutes, parseWhen, titleCase, ms, dayStart, D } from './core.mjs';

export const INTENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['basic', 'deadline', 'discover', 'none'] },
    activity: { type: 'STRING' },
    minutes: { type: 'NUMBER' },
    deadline_text: { type: 'STRING' },
    when_text: { type: 'STRING' },
    interests: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['kind'],
};

export function buildIntentPrompt(request) {
  return [
    'Read the user request for a calendar assistant and answer with ONE JSON object and nothing else.',
    'Shape: {"kind":"basic"|"deadline"|"discover"|"none","activity":string,"minutes":number,"deadline_text":string,"when_text":string,"interests":[string]}.',
    'kind: "basic" = find time for one activity; "deadline" = something is due or must be done by a date; "discover" = asks what to do or for ideas; "none" = not a calendar request.',
    'activity: short name of the activity or deliverable, without dates or durations. minutes: requested length in minutes (omit if not stated).',
    'deadline_text: the due date wording copied from the request, for example "next Friday at 3 pm" (omit if none). when_text: wording about when the activity should happen, for example "tomorrow" or "after 6 pm" (omit if none).',
    'interests: interests the user names (omit if none). Do not plan, choose times or write questions.',
    `Request: ${JSON.stringify(request)}`,
  ].join('\n');
}

export function buildIntentRequest(request) {
  return {
    contents: [{ role: 'user', parts: [{ text: buildIntentPrompt(request) }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: INTENT_SCHEMA, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  };
}

// Turn a model reply (text) into the intent shape core.mjs plans from, or null when it is unusable.
export function intentFromReply(text, request, now) {
  let o;
  try { o = JSON.parse(String(text).replace(/^\s*```(?:json)?|```\s*$/g, '')); } catch { return null; }
  if (!o || typeof o !== 'object' || !['basic', 'deadline', 'discover', 'none'].includes(o.kind)) return null;
  const nowMs = ms(now), str = (v) => (typeof v === 'string' ? v.trim() : '');
  const what = str(o.activity);
  if (o.kind === 'none') return { kind: 'none' };
  // Discovery runs only in discover mode (handled before the call); in normal mode the regex parser decides, as it always did.
  if (o.kind === 'discover') return null;
  if (o.kind === 'deadline') {
    // The due date must come from the model's wording; without it the reply is unusable and the regex parser reads the whole request.
    const dl = parseDeadline(str(o.deadline_text), nowMs);
    if (!dl) return null;
    const name = titleCase((what || 'your deadline').replace(/^(the|my)\s+/i, ''));
    return { kind: 'deadline', what: name, deadline: dl.ms, assumed: dl.assumed };
  }
  const minutes = Number.isFinite(o.minutes) && o.minutes >= 5 && o.minutes <= 600 ? Math.round(o.minutes) : (parseMinutes(request) ?? 30);
  const t = request.toLowerCase();
  return { kind: 'basic', title: titleCase(what || 'Task'), minutes, pref: parseWhen(`${str(o.when_text)} ${request}`, nowMs), past: /\byesterday\b/.test(t) };
}

// Offline by default: the request only leaves the machine when the caller opts in with env (for example { env: process.env }).
export const MODEL_TIMEOUT_MS = 15000;

export function createUnderstander({ fetch: custom, env = {}, timeoutMs = MODEL_TIMEOUT_MS } = {}) {
  return async (input) => {
    const doFetch = custom ?? globalThis.fetch;
    const fallback = () => understand(input);
    if (input.context?.mode === 'discover' || !env.GEMINI_API_KEY) return fallback();
    const ctl = new AbortController();
    let timer;
    const stalled = new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new Error('model call timed out')); }, timeoutMs); });
    stalled.catch(() => {});
    const call = async () => {
      const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(buildIntentRequest(input.request ?? '')), signal: ctl.signal,
      });
      if (!res.ok) return fallback();
      const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const intent = intentFromReply(text, input.request ?? '', input.now);
      if (!intent) {
        // Unusable reply: the parser plans, but a generic "Task" title takes the model's activity name when it gave one.
        const parsed = fallback();
        let act = '';
        try { act = String(JSON.parse(String(text).replace(/^\s*```(?:json)?|```\s*$/g, '')).activity ?? '').trim(); } catch { /* no activity */ }
        return parsed.kind === 'basic' && parsed.title === 'Task' && act ? { ...parsed, title: titleCase(act) } : parsed;
      }
      // A plan request cannot be "discover" (that needs the discover context) and "none" must not hide a request the parser can plan.
      if (intent.kind === 'discover' || intent.kind === 'none') {
        const parsed = fallback();
        if (parsed.kind === 'basic' || parsed.kind === 'deadline') return parsed;
        if (intent.kind === 'discover') return { kind: 'none' };
      }
      return { ...intent, model: true };
    };
    // A stalled or failed call falls back to the regex parser, even when the fetch ignores the abort signal.
    try { return await Promise.race([call(), stalled]); } catch { return fallback(); } finally { clearTimeout(timer); }
  };
}
