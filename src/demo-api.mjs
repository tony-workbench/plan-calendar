// JSON API for the visual demo page. The model (live Gemini, or a recorded reply in tests/fixtures) only understands the request;
// core.mjs plans, and the hybrid planner re-plans and checks. Nothing here talks to Google Calendar.
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import hybrid from './planner/approaches/hybrid.mjs';
import { understand, basicResult, deadlineResult, greedySteps, discoverResult, parseMinutes, MIN, ms } from './planner/core.mjs';
import { buildRequest } from './planner/gemini.mjs';
import { validatePlan } from '../benchmark/contract.mjs';
import { NOW } from './demo.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const at = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, 9 + day, hh, mm)).toISOString();
const ev = (id, title, day, h1, h2) => ({ id, title, start: at(day, h1), end: at(day, h2) });

export const PAGE_EVENTS = [ev('e1', 'Team sync', 0, 10, 11), ev('e2', 'Client call', 1, 14, 15), ev('e3', 'Design review', 3, 10, 12), ev('e4', 'Evening class', 2, 19, 20), ev('f1', 'Dentist', 1, 8, 9)];
const cand = (id, title, day, h, extra = {}) => ({ id, title, start: at(day, h), end: at(day, h + 2), place: `Hall ${id}`, reason: 'Matches your interests', source: 'city listing', tags: ['music'], ...extra });
const CANDIDATES = [cand('a1', 'Jazz night', 2, 17), cand('a2', 'Street food fair', 2, 19, { tags: ['food'] }), cand('a3', 'Mystery gig', 3, 18, { source: undefined }), cand('a4', 'Maker market', 4, 17, { tags: ['crafts'] }), cand('a5', 'Choir concert', 4, 18)];
const DISCOVER = { mode: 'discover', interests: ['music', 'food'], city: 'Springfield', candidates: CANDIDATES };

export const state = (env = process.env) => ({ model: env.GEMINI_API_KEY ? 'live' : 'recorded', now: NOW, weekStart: at(0, 0), events: PAGE_EVENTS, writesToGoogleCalendar: false });

export function shoppingPlan() {
  const blk = (id, title, h, len, group) => ({ id, title, start: at(1, Math.floor(h), (h % 1) * 60), end: at(1, Math.floor(h + len), ((h + len) % 1) * 60), kind: 'proposed', group });
  return { blocks: [blk('shop', 'Shopping', 9.5, 1, 'meal'), blk('cook', 'Cooking', 12, 1, 'meal'), blk('dinner', 'Dinner', 15, 1, 'meal'), blk('other', "Tomorrow's groceries", 17, 0.5, 'other')], notes: [], meta: { kind: 'related' } };
}

const recorded = () => JSON.parse(readFileSync(here('../tests/fixtures/model-replies.json'), 'utf8'));
const key = (s) => s.trim().toLowerCase();

async function liveReply(request, env, doFetch) {
  const prompt = `Understand this calendar request and answer with ONE JSON object: {"kind":"basic"|"deadline"|"discover"|"none","title"?:string,"minutes"?:number,"what"?:string,"deadline"?:ISO-8601 UTC}. Request: ${JSON.stringify(request)}`;
  const body = buildRequest(prompt);
  delete body.generationConfig.responseSchema;
  const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  const reply = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ''));
  if (!['basic', 'deadline', 'discover', 'none'].includes(reply.kind)) throw new Error('bad reply');
  return reply;
}

function intentFrom(reply, request) {
  const base = understand({ request, now: NOW });
  if (reply.kind === 'basic') return { pref: null, past: false, ...(base.kind === 'basic' ? base : {}), kind: 'basic', title: reply.title || 'Task', minutes: Number(reply.minutes) > 0 ? Number(reply.minutes) : 30 };
  if (reply.kind === 'deadline') {
    if (base.kind === 'deadline') return { ...base, what: reply.what || base.what };
    if (reply.deadline && Number.isFinite(ms(reply.deadline))) return { kind: 'deadline', what: reply.what || 'Deadline', deadline: ms(reply.deadline), assumed: false };
    return { kind: 'ask-deadline', what: reply.what || 'Your deadline' };
  }
  return { kind: reply.kind };
}

function planFrom(intent, request, events, dismissed) {
  const ctx = { events, now: NOW, context: { ...DISCOVER, dismissed } };
  if (intent.kind === 'basic') return basicResult(intent, ctx);
  if (intent.kind === 'deadline') return deadlineResult(intent, greedySteps(intent, ctx), ctx);
  if (intent.kind === 'discover') return discoverResult(ctx);
  if (intent.kind === 'ask-deadline') return { blocks: [], question: { text: `When is ${intent.what.toLowerCase()} due?`, items: [] }, notes: [], meta: { kind: 'deadline', now: NOW } };
  return { blocks: [], notes: ['I could not turn that into a calendar plan. Try a task, a deadline or "anything fun this week?".'], meta: { kind: 'none' } };
}

const STEP = [['outline', 'step-1'], ['production', 'step-2'], ['rehearsal', 'step-3']];
function changeFrom(request, plan) {
  const t = request.toLowerCase();
  if (/\bmore\b|\bextra\b|longer/.test(t)) {
    const hit = STEP.find(([w]) => t.includes(w)), minutes = parseMinutes(t) ?? 60;
    return hit ? { type: 'more-time', blockId: hit[1], minutes } : null;
  }
  return /\b(due|deadline)\b/.test(t) ? { type: 'set-deadline', text: request } : null;
}

export async function planRoute(input, { env = process.env, fetch: doFetch = globalThis.fetch } = {}) {
  const request = String(input?.request ?? '').trim();
  if (!request) return { status: 400, body: { error: 'Type a request first.' } };
  const events = input.events ?? PAGE_EVENTS, live = Boolean(env.GEMINI_API_KEY);
  if (input.plan?.meta?.kind === 'deadline') {
    const change = changeFrom(request, input.plan);
    if (change) {
      const plan = await hybrid.replan({ plan: input.plan, events, change });
      return { status: 200, body: { mode: 'replan', model: live ? 'live' : 'recorded', source: live ? 'live' : 'recorded', plan } };
    }
  }
  let reply, source = 'recorded', fallback;
  if (live) {
    try { reply = await liveReply(request, env, doFetch); source = 'live'; } catch { fallback = 'The live model did not answer, so I used a recorded reply.'; }
  }
  if (!reply) reply = recorded()[key(request)] ?? { kind: understand({ request, now: NOW }).kind };
  let plan = planFrom(intentFrom(reply, request), request, events, Boolean(input.dismissed));
  if (plan.blocks.length && !validatePlan(plan, { events }).ok) plan = await hybrid.plan({ request, events, now: NOW, context: { ...DISCOVER, dismissed: Boolean(input.dismissed) } });
  return { status: 200, body: { mode: 'plan', model: source, source, plan, ...(fallback ? { fallback } : {}) } };
}

export async function replanRoute(input) {
  if (!input?.plan) return { status: 400, body: { error: 'No plan to change.' } };
  const events = input.events ?? PAGE_EVENTS, pend = input.plan.meta?.pending, c = input.answers?.confirm;
  const plan = await hybrid.replan({ plan: input.plan, events, change: input.change, answers: input.answers });
  if (pend && !input.change && !plan.meta.pending) {
    const ok = c === 'all' ? pend.items : Array.isArray(c) ? pend.items.filter((id) => c.includes(id)) : [];
    if (ok.length) plan.meta = { ...plan.meta, declined: [...new Set([...(plan.meta.declined ?? []), ...pend.items.filter((id) => !ok.includes(id))])] };
  }
  return { status: 200, body: { plan } };
}

const FILES = { '/demo': ['demo.html', 'text/html; charset=utf-8'], '/demo.js': ['demo.js', 'text/javascript; charset=utf-8'] };
const send = (res, status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
const json = (res, status, body) => send(res, status, 'application/json', JSON.stringify(body));

// Returns true when it answered the request, so a server can call it first and fall through otherwise.
export async function handleDemo(req, res) {
  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && FILES[path]) {
    try { send(res, 200, FILES[path][1], await readFile(here(`../public/${FILES[path][0]}`))); } catch { send(res, 500, 'text/plain', 'missing demo file'); }
    return true;
  }
  if (req.method === 'GET' && path === '/api/state') { json(res, 200, state()); return true; }
  if (req.method === 'GET' && path === '/api/scene/shopping') { json(res, 200, { plan: shoppingPlan() }); return true; }
  if (req.method === 'POST' && (path === '/api/plan' || path === '/api/replan')) {
    let input;
    try { let raw = ''; for await (const chunk of req) raw += chunk; input = JSON.parse(raw || '{}'); } catch { json(res, 400, { error: 'Bad request body.' }); return true; }
    const out = await (path === '/api/plan' ? planRoute(input) : replanRoute(input));
    json(res, out.status, out.body);
    return true;
  }
  return false;
}
