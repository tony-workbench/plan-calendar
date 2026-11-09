// Approach 4 with a live model: the model only reads the request text and returns a small intent; core.mjs plans, asks questions and remembers refusals.
// With GEMINI_API_KEY set it calls Gemini; otherwise it replays recorded replies. If neither answers, the rules parser reads the request and `fallback` says so.
import hybrid from './hybrid.mjs';
import { understand, parseDeadline, parseMinutes, ms, dayStart, D, WINDOW } from '../core.mjs';

export const KINDS = ['basic', 'deadline', 'discover', 'more-time', 'set-deadline', 'none'];
export const STEP_NAMES = ['outline', 'production', 'rehearsal'];
const SCHEMA = { type: 'OBJECT', properties: { kind: { type: 'STRING', enum: KINDS }, title: { type: 'STRING' }, minutes: { type: 'NUMBER' }, when: { type: 'STRING' }, what: { type: 'STRING' }, deadlineText: { type: 'STRING' }, target: { type: 'STRING' } }, required: ['kind'] };

export const normalize = (text) => String(text).toLowerCase().replace(/\s+/g, ' ').replace(/[.?!\s]+$/, '').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The prompt carries the request text and whether a deadline plan is open. It never carries the calendar.
export function buildIntentPrompt(request, hasDeadlinePlan) {
  return [
    'You read one calendar request and answer with ONE JSON object and nothing else.',
    `kind is one of: basic (find time for a task: title, minutes, optional when = today|tomorrow|tonight), deadline (something is due: what, deadlineText copied from the request, empty if no date is given), discover (asks what to do or for fun ideas), more-time (a prep step needs extra time: target = ${STEP_NAMES.join('|')}, minutes) and set-deadline (gives or corrects a due date: deadlineText), none (not a calendar task).`,
    hasDeadlinePlan ? 'A deadline plan with the steps outline, production and rehearsal is open, so a request about a step needing time is more-time and a new due date is set-deadline.' : 'No plan is open, so more-time and set-deadline do not apply.',
    `Request: ${JSON.stringify(request)}`,
  ].join('\n');
}

export function parseIntentReply(text) {
  let obj;
  try { obj = JSON.parse(String(text).replace(/^\s*```(?:json)?|```\s*$/g, '')); } catch { return null; }
  return obj && KINDS.includes(obj.kind) ? obj : null;
}

async function askLive(request, hasPlan, { fetch: doFetch, env }) {
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: buildIntentPrompt(request, hasPlan) }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  if (!res.ok) throw new Error(`Model request failed with status ${res.status}`);
  const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const reply = parseIntentReply(text);
  if (!reply) throw new Error('Model reply was not a valid intent');
  return reply;
}

// Last resort when no model reply exists: the offline rules parser, plus two follow-up patterns.
function rulesReply(request, hasPlan, nowMs) {
  const t = request.toLowerCase();
  if (hasPlan) {
    const step = STEP_NAMES.find((n) => t.includes(n)), minutes = /\b(more|longer|extra)\b/.test(t) ? parseMinutes(t) : null;
    if (step && minutes) return { kind: 'more-time', target: step, minutes };
    if (parseDeadline(request, nowMs) && /\b(due|deadline)\b/.test(t)) return { kind: 'set-deadline', deadlineText: request };
  }
  if (/\b(fun|something to do|things to do)\b/.test(t)) return { kind: 'discover' };
  const i = understand({ request, now: new Date(nowMs).toISOString(), context: {} });
  if (i.kind === 'basic') return { kind: 'basic', title: i.title, minutes: i.minutes, when: /\btomorrow\b/.test(t) ? 'tomorrow' : /\b(tonight|this evening)\b/.test(t) ? 'tonight' : '' };
  if (i.kind === 'deadline') return { kind: 'deadline', what: i.what, deadlineText: request };
  if (i.kind === 'ask-deadline') return { kind: 'deadline', what: i.what, deadlineText: '' };
  return { kind: 'none' };
}

// Where the reply came from: live model, recorded replies, or the rules parser (`fallback` is then set).
export async function readIntent(request, { hasPlan = false, nowMs, env = process.env, fetch: doFetch = globalThis.fetch, replies = {} } = {}) {
  let fallback;
  if (env.GEMINI_API_KEY) {
    try { return { reply: await askLive(request, hasPlan, { fetch: doFetch, env }), source: 'live' }; } catch (err) { fallback = `The live model did not answer (${err.message}).`; }
  }
  const recorded = replies[normalize(request)];
  if (recorded) return { reply: recorded, source: 'recorded', ...(fallback && { fallback }) };
  return { reply: rulesReply(request, hasPlan, nowMs), source: 'rules', fallback: fallback ?? 'No recorded model reply for this text, so the rules parser read it.' };
}

const prefFor = (when, nowMs) => {
  const today = dayStart(nowMs);
  if (when === 'tomorrow') return { from: today + D, window: WINDOW, limit: today + 2 * D };
  if (when === 'tonight') return { from: today, window: [1020, 1410], limit: today + D };
  return null;
};

// Turns a model reply into a core intent for a fresh plan.
export function toIntent(reply, request, nowMs) {
  switch (reply.kind) {
    case 'basic': return { kind: 'basic', title: cap(String(reply.title || 'Task')), minutes: Math.min(480, Math.max(5, Math.round(Number(reply.minutes) || 30))), pref: prefFor(reply.when, nowMs), past: false };
    case 'deadline': {
      const what = cap(String(reply.what || 'Your deadline')), dl = parseDeadline(reply.deadlineText || '', nowMs) ?? parseDeadline(request, nowMs);
      return dl ? { kind: 'deadline', what, deadline: dl.ms, assumed: dl.assumed } : { kind: 'ask-deadline', what };
    }
    case 'discover': return { kind: 'discover' };
    default: return { kind: 'none' };
  }
}

// One entry point for the Ask bar: returns { result, mode, source, fallback }. `plan` is the open plan, if any.
export async function ask({ request, plan, events = [], now, context = {} }, opts = {}) {
  const nowMs = ms(now), open = plan?.meta?.kind === 'deadline' && plan.blocks.length > 0;
  const { reply, source, fallback } = await readIntent(request, { ...opts, hasPlan: open, nowMs });
  const done = (result, mode) => ({ result, mode, source, ...(fallback && { fallback }) });
  if (open && reply.kind === 'more-time') {
    const step = plan.blocks.find((b) => b.title.toLowerCase().endsWith(`: ${String(reply.target).toLowerCase()}`)) ?? plan.blocks.find((b) => b.step === Number(reply.target));
    if (step) return done(await hybrid.replan({ plan, events, change: { type: 'more-time', blockId: step.id, minutes: Math.max(5, Math.round(Number(reply.minutes) || 60)) } }), 'replan');
  }
  if (open && reply.kind === 'set-deadline') return done(await hybrid.replan({ plan, events, change: { type: 'set-deadline', text: reply.deadlineText || request } }), 'replan');
  const intent = toIntent(reply, request, nowMs);
  const mode = intent.kind === 'discover' ? { ...context, mode: 'discover' } : context;
  return done(await hybrid.plan({ request, events, now, context: mode, intent }), 'plan');
}

export default { ask };
