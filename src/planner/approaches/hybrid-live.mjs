// Approach 5: hybrid-live. A live model only understands the request; core.mjs plans, asks, remembers refusals and checks the rules.
// Discovery and replans make no model call. If the model is missing, fails or answers badly, the offline regex understanding takes over.
// Run it only on purpose: node benchmark/run.mjs --approach hybrid-live. The key is read from GEMINI_API_KEY and never logged.
import { planWith, replanWith, understand, greedyFinder, greedySteps, ms, dayStart, D, WINDOW, parseMinutes } from '../core.mjs';

const solver = { finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };
const AWAKE_END = 1410;

const SCHEMA = { type: 'OBJECT', properties: { kind: { type: 'STRING' }, title: { type: 'STRING' }, minutes: { type: 'NUMBER' }, day: { type: 'STRING' }, afterHour: { type: 'NUMBER' }, what: { type: 'STRING' }, deadline: { type: 'STRING' } }, required: ['kind'] };

export const buildPrompt = ({ request, now }) => [
  'Read the calendar request and answer with ONE JSON object and nothing else; do not plan or pick times.',
  'Fields: kind is "basic" (one activity to schedule), "deadline" (something is due and prep is wanted), "ask-deadline" (a goal to prepare for but no due date given) or "none" (not a calendar request).',
  'basic: title (short activity name), minutes (length, default 30), day ("today", "tomorrow" or "" when not stated), afterHour (0-23 24-hour clock when the user says after/from a time, otherwise omit).',
  'deadline: what (the deliverable, short), deadline (ISO-8601 UTC time it is due; if only a day is given use 17:00 UTC that day). ask-deadline: what.',
  `Now: ${now}`, `Request: ${JSON.stringify(request)}`,
].join('\n');

// Turn the model's reply into the intent core.mjs plans from, or null when it cannot be trusted.
export function toIntent(reply, input) {
  const nowMs = ms(input.now), today = dayStart(nowMs), r = reply ?? {};
  const what = typeof r.what === 'string' && r.what.trim() ? r.what.trim() : null;
  if (r.kind === 'none') return { kind: 'none' };
  if (r.kind === 'ask-deadline' && what) return { kind: 'ask-deadline', what };
  if (r.kind === 'deadline' && what) {
    const dl = Date.parse(r.deadline);
    return Number.isFinite(dl) && dl > nowMs ? { kind: 'deadline', what, deadline: dl, assumed: false } : null;
  }
  if (r.kind !== 'basic' || typeof r.title !== 'string' || !r.title.trim()) return null;
  const minutes = Number.isFinite(r.minutes) && r.minutes >= 5 && r.minutes <= 480 ? Math.round(r.minutes) : parseMinutes(input.request) ?? 30;
  let pref = null;
  if (Number.isInteger(r.afterHour) && r.afterHour >= 0 && r.afterHour < 24) pref = { from: today, window: [r.afterHour * 60, AWAKE_END], limit: today + D };
  else if (r.day === 'tomorrow') pref = { from: today + D, window: WINDOW, limit: today + 2 * D };
  return { kind: 'basic', title: r.title.trim(), minutes, pref, past: false };
}

// An understander for createHybridLive: one Gemini call returning the understanding JSON.
export function createGeminiUnderstander({ fetch: doFetch = globalThis.fetch, env = process.env } = {}) {
  return async (input) => {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);
    const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
  };
}

export function createHybridLive({ understander = createGeminiUnderstander() } = {}) {
  return {
    async plan(input) {
      if (input.context?.mode === 'discover') return planWith(input, solver); // no model call
      let intent = null;
      try { intent = toIntent(await understander(input), input); } catch { /* fall back below */ }
      return planWith(input, solver, intent ?? understand(input));
    },
    async replan(input) { return replanWith(input, solver); }, // no model call: core.mjs asks, remembers and checks
  };
}

const live = createHybridLive();
export const plan = (input) => live.plan(input);
export const replan = (input) => live.replan(input);
export default { plan, replan };
