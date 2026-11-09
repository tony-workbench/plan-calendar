// Planning API for the visual demo page (public/demo.html). Everything stays in the browser and in these routes: no Google Calendar, nothing bought or booked.
// Planner: hybrid-live. With GEMINI_API_KEY set the model reads the request text; otherwise recorded replies from tests/fixtures are replayed.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import hybrid from './planner/approaches/hybrid.mjs';
import { ask } from './planner/approaches/hybrid-live.mjs';
import { EVENTS, NOW } from './demo.mjs';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const at = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, 9 + day, hh, mm)).toISOString();
export const PAGE_EVENTS = [...EVENTS, { id: 'e5', title: 'Dentist', start: at(1, 8), end: at(1, 9) }];
export const WEEK_START = at(0, 0);
export const CHIPS = ['Find time to work out for half an hour', 'The demo is due next Friday, help me plan the prep', 'Anything fun this week?'];

const cand = (id, title, day, h, extra = {}) => ({ id, title, start: at(day, h), end: at(day, h + 2), place: `Hall ${id}`, reason: 'Matches your interests', source: 'city listing', tags: ['music'], ...extra });
const CANDIDATES = [
  cand('a1', 'Jazz night', 2, 17),
  cand('a2', 'Street food fair', 2, 19, { tags: ['food'] }),
  cand('a3', 'Mystery gig', 3, 18, { source: undefined }),
  cand('a4', 'Maker market', 4, 17, { tags: ['crafts'] }),
  cand('a5', 'Choir concert', 4, 18),
];
const DISCOVERY = { interests: ['music', 'food'], city: 'Springfield', candidates: CANDIDATES };

const meal = (id, title, h1, h2, group) => ({ id, title, start: at(1, Math.floor(h1), (h1 % 1) * 60), end: at(1, Math.floor(h2), (h2 % 1) * 60), kind: 'proposed', group });
export const shoppingPlan = () => ({
  blocks: [meal('shop', 'Shopping', 9.5, 10.5, 'meal'), meal('cook', 'Cooking', 12, 13, 'meal'), meal('dinner', 'Dinner', 15, 16, 'meal'), meal('other', "Tomorrow's groceries", 17, 17.5, 'other')],
  notes: [], meta: { kind: 'related', timezone: 'UTC' },
});

let replies;
const recorded = async () => replies ??= JSON.parse(await readFile(join(root, 'tests', 'fixtures', 'model-replies.json'), 'utf8'));

export const modelMode = (env = process.env) => env.GEMINI_API_KEY ? 'live' : 'recorded';
export const state = (env = process.env) => ({ now: NOW, weekStart: WEEK_START, events: PAGE_EVENTS, chips: CHIPS, model: modelMode(env), writesToGoogleCalendar: false });

const NO_PLAN = 'I could not turn that into a calendar plan. Try "find time to ..." or "<something> is due next Friday".';
const withMessage = (r) => (r.blocks.length || r.question || r.notes?.length ? r : { ...r, notes: [NO_PLAN] });

export async function planRoute(body, { env = process.env, fetch = globalThis.fetch } = {}) {
  const request = String(body.request ?? '').trim();
  if (!request) return { status: 400, body: { error: 'request is required' } };
  const events = Array.isArray(body.events) ? body.events : PAGE_EVENTS;
  const context = { ...DISCOVERY, ...(body.dismissed ? { dismissed: true } : {}) };
  const out = await ask({ request, plan: body.plan, events, now: NOW, context }, { env, fetch, replies: await recorded() });
  const quiet = body.dismissed && out.result.meta?.kind === 'discover' && !out.result.blocks.length;
  if (quiet) out.result = { ...out.result, notes: ['You passed on these earlier, so I will not suggest them again.'] };
  const badge = out.source === 'live' ? 'live' : 'recorded';
  return { status: 200, body: { plan: withMessage(out.result), mode: out.mode, model: badge, source: out.source, ...(out.fallback && { fallback: out.fallback }) } };
}

export async function replanRoute(body) {
  if (!body.plan || !Array.isArray(body.plan.blocks)) return { status: 400, body: { error: 'plan is required' } };
  const events = Array.isArray(body.events) ? body.events : PAGE_EVENTS;
  const plan = await hybrid.replan({ plan: body.plan, events, change: body.change, answers: body.answers });
  return { status: 200, body: { plan: withMessage(plan) } };
}

const readBody = async (req) => {
  let size = 0; const parts = [];
  for await (const c of req) { size += c.length; if (size > 1e6) throw new Error('too large'); parts.push(c); }
  return parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {};
};
const send = (res, status, type, data) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(data); };
const json = (res, { status, body }) => send(res, status, 'application/json', JSON.stringify(body));

// Returns true when the request belonged to the demo. server.mjs can call this before its own routes.
export async function handleDemo(req, res, opts = {}) {
  const url = (req.url || '').split('?')[0], env = opts.env ?? process.env;
  try {
    if (req.method === 'GET' && (url === '/demo' || url === '/demo/')) return send(res, 200, 'text/html; charset=utf-8', await readFile(join(root, 'public', 'demo.html'))), true;
    if (req.method === 'GET' && url === '/demo.js') return send(res, 200, 'text/javascript; charset=utf-8', await readFile(join(root, 'public', 'demo.js'))), true;
    if (!url.startsWith('/api/')) return false;
    if (req.method === 'GET' && url === '/api/state') return json(res, { status: 200, body: state(env) }), true;
    if (req.method === 'GET' && url === '/api/scene/shopping') return json(res, { status: 200, body: { plan: shoppingPlan() } }), true;
    if (req.method === 'POST' && url === '/api/plan') return json(res, await planRoute(await readBody(req), { ...opts, env })), true;
    if (req.method === 'POST' && url === '/api/replan') return json(res, await replanRoute(await readBody(req))), true;
    return json(res, { status: 404, body: { error: 'not found' } }), true;
  } catch (err) {
    json(res, { status: 400, body: { error: err instanceof SyntaxError ? 'invalid JSON' : 'bad request' } });
    return true;
  }
}
