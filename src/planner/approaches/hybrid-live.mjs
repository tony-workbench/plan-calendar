// Approach 5: hybrid-live. A live model only reads the request wording; core.mjs places the blocks, asks the question and checks the rules.
// Discovery and replans make no model call. If the model fails or answers badly, the offline understanding takes over and a note says so.
import { understand, basicResult, deadlineResult, greedyFinder, greedySteps, planWith, replanWith, dayStart, ms, D, WINDOW, TIMEZONE } from '../core.mjs';

const solver = { finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };
const MODEL = (env) => env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_NOTE = 'I read your request in basic mode because the language model was not available.';

// Turn a model reply into the intent core.mjs expects, or null when the reply is unusable.
export function toIntent(reply, { now }) {
  if (!reply || typeof reply !== 'object') return null;
  const today = dayStart(ms(now)), text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (reply.kind === 'none') return { kind: 'none' };
  if (reply.kind === 'ask-deadline') return text(reply.what) ? { kind: 'ask-deadline', what: text(reply.what) } : null;
  if (reply.kind === 'deadline') {
    const dl = typeof reply.deadline === 'string' ? ms(reply.deadline) : NaN;
    return text(reply.what) && Number.isFinite(dl) ? { kind: 'deadline', what: text(reply.what), deadline: dl, assumed: false } : null;
  }
  if (reply.kind !== 'basic' || !text(reply.title)) return null;
  const minutes = Number.isFinite(reply.minutes) && reply.minutes >= 5 && reply.minutes <= 480 ? Math.round(reply.minutes) : 30;
  let pref = null;
  if (reply.day === 'tomorrow') pref = { from: today + D, window: WINDOW, limit: today + 2 * D };
  else if (reply.day === 'tonight') pref = { from: today, window: [1020, 1410], limit: today + D };
  return { kind: 'basic', title: text(reply.title), minutes, pref, past: false };
}

function build(intent, input) {
  const ctx = { events: input.events ?? [], now: input.now, context: input.context ?? {} };
  switch (intent.kind) {
    case 'basic': return basicResult(intent, ctx, solver.finder);
    case 'deadline': return deadlineResult(intent, solver.steps(intent, ctx), ctx);
    case 'ask-deadline': return { blocks: [], question: { text: `When is ${intent.what.toLowerCase()} due?`, items: [] }, notes: [], meta: { kind: 'deadline', now: ctx.now, timezone: TIMEZONE } };
    default: return { blocks: [], notes: [], meta: { kind: 'none', timezone: TIMEZONE } };
  }
}

export function createHybridLive({ understander }) {
  const plan = async (input) => {
    // Discovery needs no wording help, so it never reaches the model.
    if (understand(input).kind === 'discover') return planWith(input, solver);
    let intent = null;
    try { intent = toIntent(await understander({ request: input.request, now: input.now }), input); } catch (e) { intent = null; }
    if (intent) { const r = build(intent, input); return { ...r, meta: { ...r.meta, debug: { used: 'live' } } }; }
    const r = planWith(input, solver);
    return { ...r, notes: [...(r.notes ?? []), FALLBACK_NOTE], meta: { ...r.meta, debug: { used: 'offline-fallback' } } };
  };
  return { plan, replan: async (input) => replanWith(input, solver) };
}

const PROMPT = (request, now) => [
  'Read the calendar request and answer with ONE JSON object only. Do not plan times.',
  'Shapes: {"kind":"basic","title":string,"minutes":number,"day":"today"|"tomorrow"|"tonight"|"any"}',
  '{"kind":"deadline","what":string,"deadline":ISO-8601 UTC} when the request names a due date or time (resolve it from Now; use 17:00 if no time)',
  '{"kind":"ask-deadline","what":string} when a goal has a deadline but none is given; {"kind":"none"} when it is not a scheduling request.',
  `Now: ${now}`, `Request: ${JSON.stringify(request)}`,
].join('\n');

// Sends only the request wording (never the schedule). The key goes in a header, never in the URL or body.
export function createGeminiUnderstander({ env = process.env, fetch: doFetch = globalThis.fetch } = {}) {
  return async ({ request, now }) => {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set; no request was made');
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL(env)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT(request, now) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }),
    });
    if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);
    const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
  };
}

const live = createHybridLive({ understander: createGeminiUnderstander() });
export const plan = (input) => live.plan(input);
export const replan = (input) => live.replan(input);
export default { plan, replan };
