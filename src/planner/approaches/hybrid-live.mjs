// Approach 5: hybrid-live. A live model reads only the request text; core.mjs plans, asks, remembers refusals and checks the rules.
// If the model fails or answers badly, the offline understanding is used instead and meta.debug.used says so.
import rules from './rules.mjs';
import { basicResult, deadlineResult, greedyFinder, greedySteps, parseDay, dayStart, ms, MIN, D, WINDOW, TIMEZONE } from '../core.mjs';

const solver = { finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };
const text = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Turn the model's reply into the intent shape core.mjs uses, or null when the reply cannot be trusted.
export function toIntent(reply, { now }) {
  if (!reply || typeof reply !== 'object') return null;
  const nowMs = ms(now);
  if (reply.kind === 'none') return { kind: 'none' };
  if (reply.kind === 'basic') {
    const title = text(reply.title);
    if (!title) return null;
    const minutes = Number.isFinite(reply.minutes) && reply.minutes >= 5 && reply.minutes <= 480 ? Math.round(reply.minutes) : 30;
    const day = typeof reply.day === 'string' ? parseDay(reply.day, nowMs) : null, today = dayStart(nowMs);
    const pref = day !== null && day >= today ? { from: day, window: WINDOW, limit: day + D } : null;
    return { kind: 'basic', title, minutes, pref, past: day !== null && day < today };
  }
  const what = text(reply.what);
  if (reply.kind === 'ask-deadline') return what ? { kind: 'ask-deadline', what } : null;
  if (reply.kind === 'deadline') {
    const deadline = typeof reply.deadline === 'string' ? Date.parse(reply.deadline) : NaN;
    return what && Number.isFinite(deadline) && deadline > nowMs ? { kind: 'deadline', what, deadline, assumed: false } : null;
  }
  return null;
}

const mark = (r, used) => ({ ...r, meta: { ...r.meta, debug: { used } } });

function build(intent, input) {
  const ctx = { events: input.events ?? [], now: input.now, context: input.context ?? {} };
  switch (intent.kind) {
    case 'basic': return basicResult(intent, ctx, solver.finder);
    case 'deadline': return deadlineResult(intent, solver.steps(intent, ctx), ctx);
    case 'ask-deadline': return { blocks: [], question: { text: `When is ${intent.what.toLowerCase()} due?`, items: [] }, notes: [], meta: { kind: 'deadline', now: ctx.now, timezone: TIMEZONE } };
    default: return { blocks: [], notes: [], meta: { kind: 'none', timezone: TIMEZONE } };
  }
}

const PROMPT = [
  'You read one calendar request and answer with ONE JSON object and nothing else. You never plan times or write questions.',
  'Shapes: {"kind":"basic","title":string,"minutes":number,"day"?:"today"|"tomorrow"|weekday name}',
  '{"kind":"deadline","what":string,"deadline":ISO-8601 UTC}',
  '{"kind":"ask-deadline","what":string} (a goal with a deadline but no date or time given)',
  '{"kind":"none"} (not a calendar task).',
].join('\n');

// A live understander: one Gemini call per request. The key goes only in a header; without one nothing is sent.
export function createGeminiUnderstander({ fetch: doFetch = globalThis.fetch, env = process.env } = {}) {
  return async ({ request, now }) => {
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set; hybrid-live makes no request without it');
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${PROMPT}\nNow: ${now}\nRequest: ${JSON.stringify(String(request ?? ''))}` }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);
    const out = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return JSON.parse(out.replace(/^\s*```(?:json)?|```\s*$/g, ''));
  };
}

export function createHybridLive({ understander = createGeminiUnderstander() } = {}) {
  return {
    async plan(input) {
      if (input.context?.mode === 'discover') return mark(await rules.plan(input), 'offline');
      let intent = null;
      try { intent = toIntent(await understander({ request: input.request, now: input.now }), input); } catch { intent = null; }
      return intent ? mark(build(intent, input), 'model') : mark(await rules.plan(input), 'offline-fallback');
    },
    replan: (input) => rules.replan(input),
  };
}

const live = createHybridLive();
export const plan = (input) => live.plan(input);
export const replan = (input) => live.replan(input);
export default { plan, replan };
