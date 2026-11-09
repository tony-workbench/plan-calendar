// Live-model adapter for the Agent approach: builds the prompt, calls the Gemini API and turns the reply into a submit call.
// Nothing here runs unless createGeminiModel() is called; tests pass their own fetch, and the key is read from the environment.
import { slots, isFree, iso, ms, ceilTo, MIN, D, TIMEZONE } from './core.mjs';
import { checkResult } from '../../benchmark/contract.mjs';

export const SCHEMA_TEXT = '{"blocks":[{"id":string,"title":string,"start":ISO-8601 UTC,"end":ISO-8601 UTC,"kind":string,"step"?:number,"dependsOn"?:[block id]}],"notes":[string],"question"?:{"text":string,"items":[string]}}';
export const EXAMPLE = '{"blocks":[{"id":"b1","title":"Workout","start":"2026-11-10T17:00:00.000Z","end":"2026-11-10T17:30:00.000Z","kind":"task"}],"notes":["Picked the first free slot."]}';

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    blocks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, title: { type: 'STRING' }, start: { type: 'STRING' }, end: { type: 'STRING' }, kind: { type: 'STRING' }, step: { type: 'NUMBER' }, dependsOn: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['id', 'title', 'start', 'end', 'kind'] } },
    notes: { type: 'ARRAY', items: { type: 'STRING' } },
    question: { type: 'OBJECT', properties: { text: { type: 'STRING' }, items: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['text', 'items'] },
  },
  required: ['blocks', 'notes'],
};

// Free windows (UTC, outside meals and sleep) so the model needs no tool turns to read the schedule.
export function freeWindows({ events = [], now }, days = 8, max = 24) {
  const out = [], from = ceilTo(ms(now)), step = 15 * MIN;
  let cur = null;
  for (const t of slots(from, step, { limit: from + days * D, step })) {
    if (!isFree(t, t + step, { events })) { cur = null; continue; }
    if (cur && cur.end === t) cur.end = t + step; else { cur = { start: t, end: t + step }; out.push(cur); }
  }
  return out.slice(0, max).map((w) => ({ start: iso(w.start), end: iso(w.end) }));
}

// Guidance for the four situations in docs/PRODUCT-DIRECTION.md, so the live model is told what each one needs.
export const SITUATIONS = [
  'Situation 1, basic arrangement: one block of the requested length (default 30 minutes) in the earliest fitting free window, kind "task"; honour a stated day or time of day; add a short note on why that slot.',
  'Situation 2, deadline back-planning: when the request has a deadline, split the prep into exactly three blocks with kind "task" and step 1, 2, 3 titled outline, production and rehearsal; step 2 has dependsOn [id of step 1] and step 3 dependsOn [id of step 2]; all blocks end before the deadline and sit in free windows. If the request names a goal but NO deadline, return no blocks and ask exactly ONE question: "question":{"text":"When is <goal> due?","items":[]}.',
  'Situation 3, discovery: when the request asks what to do or the context lists interests, a city and free time, propose at most three candidate activities that match the context interests, each as a block with kind "candidate" in a free window; propose none if the context is thin; never invent a booking or registration.',
  'Situation 4, replan after a change (a dragged block, more time, a set deadline or answers): return the FULL current plan, keep every fixed event and every block the change does not touch exactly where it is, and treat existing events as unmovable. Move other blocks only when a stated or clearly necessary order requires it, and mention each consequential move in notes. If several related items need confirmation, ask ONE merged question naming all of them in "question":{"text":...,"items":[the item titles]}, and change nothing until answers arrive; use only the links the answers confirmed.',
].join('\n');

export function buildPrompt(task, feedback = '') {
  const { input } = task;
  const now = input.now ?? input.plan?.meta?.now;
  const body = task.kind === 'replan'
    ? { change: input.change, answers: input.answers ?? null, currentPlan: input.plan?.blocks ?? [] }
    : { request: input.request, context: input.context ?? {} };
  return [
    'You are a calendar planner. Answer with ONE JSON object and nothing else.',
    `The JSON must have exactly this shape: ${SCHEMA_TEXT}`,
    `Example: ${EXAMPLE}`,
    'Rules: every block needs id, title, start, end and kind; times are UTC ISO strings; blocks must not overlap each other or the existing events; use only the free windows below; keep steps in order with dependsOn; finish before any deadline. Never answer with prose or an {"answer": ...} object.',
    SITUATIONS,
    `Now: ${now ?? ''}`,
    `Existing events: ${JSON.stringify(input.events ?? [])}`,
    now && `Free windows: ${JSON.stringify(freeWindows({ events: input.events ?? [], now }))}`,
    `Task: ${JSON.stringify(body)}`,
    feedback && `Your previous reply was rejected: ${feedback}. Reply again with the exact shape.`,
  ].filter(Boolean).join('\n');
}

export function buildRequest(prompt) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  };
}

export function parseReply(text) {
  let obj;
  try { obj = JSON.parse(String(text).replace(/^\s*```(?:json)?|```\s*$/g, '')); } catch { return { problem: 'reply is not valid JSON' }; }
  const problems = checkResult(obj);
  if (!problems.length && !obj.blocks.length && !obj.question) problems.push('no blocks');
  return problems.length ? { problem: problems.join('; ') } : { result: obj };
}

// The live reply carries no meta, so add what the validators and later replans read: kind, deadline, now and timezone.
export function withMeta(result, task, env = process.env) {
  const { input, intent } = task, now = input.now ?? input.plan?.meta?.now;
  const base = task.kind === 'replan' ? { ...input.plan?.meta } : { kind: intent?.kind ?? (result.blocks.length ? 'basic' : 'none'), now };
  if (task.kind !== 'replan' && intent?.kind === 'deadline' && Number.isFinite(intent.deadline)) { base.deadline = iso(intent.deadline); base.deadlineAssumed = intent.assumed; }
  return { ...result, meta: { ...base, ...result.meta, timezone: TIMEZONE, engine: `gemini:${env.GEMINI_MODEL || 'gemini-3.8-flash'}` } };
}

// A model for createAgent({ model }): one API call per case, one retry if the reply has the wrong shape.
export function createGeminiModel({ fetch: doFetch = globalThis.fetch, env = process.env, maxAttempts = 2 } = {}) {
  return async ({ task, history }) => {
    if (history.length >= maxAttempts) throw new Error('Gemini reply never matched the plan shape');
    const feedback = history.at(-1)?.out?.problem ?? '';
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(buildRequest(buildPrompt(task, feedback))),
    });
    if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);
    const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = parseReply(text);
    return parsed.result ? { tool: 'submit', args: { result: withMeta(parsed.result, task, env) } } : { tool: 'reject', args: { problem: parsed.problem } };
  };
}

// ---- hybrid: the model only reads the request and returns an intent; code plans, asks and checks ----
export const INTENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['basic', 'deadline', 'none'] },
    activity: { type: 'STRING' },
    minutes: { type: 'NUMBER' },
    deadline_text: { type: 'STRING' },
    interests: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['kind'],
};

export function buildIntentRequest(request, now) {
  const prompt = [
    'Read the calendar request and answer with ONE JSON object: {"kind":"basic"|"deadline"|"none","activity":string,"minutes"?:number,"deadline_text"?:string,"interests"?:[string]}.',
    'basic = find time for one activity (minutes = its length, default 30). deadline = a goal with a due date; deadline_text is the due date wording as a weekday or date with an optional time, for example "Friday at 3 pm" (say "next" only when the request does). none = not a calendar task.',
    'activity is a short noun phrase. Do not plan, pick times, write questions or ids.',
    `Now: ${now ?? ''}`,
    `Request: ${JSON.stringify(request)}`,
  ].join('\n');
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: INTENT_SCHEMA, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
  };
}

// Returns a checked intent or null; anything off-shape means "use the regex parser".
export function parseIntent(text) {
  let o;
  try { o = JSON.parse(String(text).replace(/^\s*```(?:json)?|```\s*$/g, '')); } catch { return null; }
  if (!o || typeof o !== 'object' || !['basic', 'deadline'].includes(o.kind)) return null;
  const activity = typeof o.activity === 'string' ? o.activity.trim().slice(0, 80) : '';
  if (!activity) return null;
  const out = { kind: o.kind, activity };
  if (o.minutes !== undefined) {
    if (!Number.isInteger(o.minutes) || o.minutes < 5 || o.minutes > 480) return null;
    out.minutes = o.minutes;
  }
  if (o.kind === 'deadline') {
    if (typeof o.deadline_text !== 'string' || !o.deadline_text.trim()) return null;
    out.deadlineText = o.deadline_text.trim().slice(0, 80);
  }
  if (Array.isArray(o.interests)) out.interests = o.interests.filter((s) => typeof s === 'string').slice(0, 10);
  return out;
}

// One call, no tools; null on any failed or invalid reply.
export async function modelIntent({ request, now, fetch: doFetch = globalThis.fetch, env = process.env }) {
  try {
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(buildIntentRequest(request, now)),
    });
    if (!res.ok) return null;
    return parseIntent(((await res.json()).candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join(''));
  } catch { return null; }
}
