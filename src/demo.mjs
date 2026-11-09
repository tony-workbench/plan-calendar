// Offline four-situation demo. Run: node src/demo.mjs
// Uses the hybrid planner only (rules draft, hard-rule check, search fallback). No Google Calendar, no app, no network:
// fetch is replaced while the demo runs and every call is counted, so the result proves nothing went out.
import { pathToFileURL } from 'node:url';
import hybrid from './planner/approaches/hybrid.mjs';
import { validatePlan } from '../benchmark/contract.mjs';

export const NOW = '2026-11-09T09:00:00.000Z'; // a Monday
const at = (day, hh, mm = 0) => new Date(Date.UTC(2026, 10, 9 + day, hh, mm)).toISOString();
const ev = (id, title, day, h1, h2) => ({ id, title, start: at(day, h1), end: at(day, h2) });

export const EVENTS = [
  ev('e1', 'Team sync', 0, 10, 11),
  ev('e2', 'Client call', 1, 14, 15),
  ev('e3', 'Design review', 3, 10, 12),
  ev('e4', 'Evening class', 2, 19, 20),
];
const hm = (b) => `${b.start.slice(5, 16).replace('T', ' ')}-${b.end.slice(11, 16)}`;
const line = (b) => `${b.moved ? '* ' : '  '}${hm(b)}  ${b.title}`;
const movedIds = (r) => r.blocks.filter((b) => b.moved).map((b) => b.id);

function basicArrangement() {
  return hybrid.plan({ request: 'Find time to work out for half an hour', events: EVENTS, now: NOW, context: {} })
    .then((result) => ({ request: 'Find time to work out for half an hour', events: EVENTS, result, check: validatePlan(result, { events: EVENTS }) }));
}

async function deadlineBackPlanning() {
  const request = 'The demo is due next Friday, help me plan the prep';
  const plan = await hybrid.plan({ request, events: EVENTS, now: NOW, context: {} });
  const deadline = plan.meta.deadline;
  const [s1, s2] = plan.blocks;
  // Drag 1: move step 1 to a free spot on Wednesday morning, still well before step 2, so dependents stay put.
  const small = await hybrid.replan({ plan, events: EVENTS, change: { type: 'drag', blockId: s1.id, start: at(2, 9) } });
  // Drag 2: drop step 1 onto the start of step 2, so the dependent steps must move.
  const big = await hybrid.replan({ plan, events: EVENTS, change: { type: 'drag', blockId: s1.id, start: s2.start } });
  return {
    request, plan, deadline,
    smallDrag: { result: small, moved: movedIds(small), check: validatePlan(small, { events: EVENTS, deadline }) },
    bigDrag: { result: big, moved: movedIds(big), check: validatePlan(big, { events: EVENTS, deadline }) },
  };
}

async function activityDiscovery() {
  const cand = (id, title, day, h, extra = {}) => ({ id, title, start: at(day, h), end: at(day, h + 2), place: `Hall ${id}`, reason: 'Matches your interests', source: 'city listing', tags: ['music'], ...extra });
  const candidates = [
    cand('a1', 'Jazz night', 2, 17),
    cand('a2', 'Street food fair', 2, 19, { tags: ['food'] }), // clashes with the evening class
    cand('a3', 'Mystery gig', 3, 18, { source: undefined }), // no source: not reliable
    cand('a4', 'Maker market', 4, 17, { tags: ['crafts'] }), // not an interest
    cand('a5', 'Choir concert', 4, 18),
  ];
  const context = { mode: 'discover', interests: ['music', 'food'], city: 'Springfield', candidates, source: { find: () => candidates } };
  const request = 'Anything fun this week?';
  const result = await hybrid.plan({ request, events: EVENTS, now: NOW, context });
  const ignored = await hybrid.plan({ request, events: EVENTS, now: NOW, context: { ...context, dismissed: true } });
  return { request, candidates, result, ignored, check: validatePlan(result, { events: EVENTS }) };
}

async function relatedAdjustment() {
  const hour = (h) => [Math.floor(h), (h % 1) * 60];
  const blk = (id, title, h1, h2, group) => ({ id, title, start: at(1, ...hour(h1)), end: at(1, ...hour(h2)), kind: 'proposed', group });
  const events = [ev('f1', 'Dentist', 1, 8, 9)];
  const plan = { blocks: [blk('shop', 'Shopping', 9.5, 10.5, 'meal'), blk('cook', 'Cooking', 12, 13, 'meal'), blk('dinner', 'Dinner', 15, 16, 'meal'), blk('other', "Tomorrow's groceries", 17, 17.5, 'other')], notes: [], meta: { kind: 'related' } };
  const drag = (p, shiftMin) => ({ plan: p, events, change: { type: 'drag', blockId: 'shop', start: new Date(Date.parse(p.blocks.find((b) => b.id === 'shop').start) + shiftMin * 60000).toISOString() } });
  let questions = 0;
  const ask = (r) => { if (r.question) questions++; return r; };

  // Partial confirmation: one merged question, the user confirms only "cook".
  const dragged = ask(await hybrid.replan(drag(plan, 60)));
  const partial = await hybrid.replan({ plan: dragged, events, answers: { confirm: ['cook'] } });

  // Refusal: same drag, the user says no; dragging again must not ask again.
  const dragged2 = ask(await hybrid.replan(drag(plan, 60)));
  const refused = await hybrid.replan({ plan: dragged2, events, answers: { confirm: [] } });
  const again = ask(await hybrid.replan(drag(refused, 30)));
  return { plan, dragged, partial, refused, again, questions, askedAfterRefusal: Boolean(again.question), partialMoved: movedIds(partial) };
}

export async function runDemo() {
  const realFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => { networkCalls++; return Promise.reject(new Error('The demo is offline')); };
  try {
    const out = { approach: 'hybrid', now: NOW };
    out.basic = await basicArrangement();
    out.deadline = await deadlineBackPlanning();
    out.discovery = await activityDiscovery();
    out.related = await relatedAdjustment();
    out.networkCalls = networkCalls;
    return out;
  } finally {
    globalThis.fetch = realFetch;
  }
}

export function render(d) {
  const L = [`Plan Calendar offline demo (approach: ${d.approach}, now: ${d.now})`, '', 'Existing events:', ...EVENTS.map((e) => `  ${hm(e)}  ${e.title}`), ''];
  L.push('1. Basic arrangement', `   Ask: ${d.basic.request}`, ...d.basic.result.blocks.map(line), '');
  L.push('2. Deadline back-planning', `   Ask: ${d.deadline.request}`, `   Deadline: ${d.deadline.deadline}`, ...d.deadline.plan.blocks.map(line));
  L.push('   Drag step 1 to Wednesday 09:00 (no overlap, nothing else moves):', ...d.deadline.smallDrag.result.blocks.map(line));
  L.push('   Drag step 1 onto step 2 (* = moved as a consequence):', ...d.deadline.bigDrag.result.blocks.map(line), '');
  L.push('3. Proactive activity discovery', `   Ask: ${d.discovery.request}`, `   Prompt: ${d.discovery.result.question?.text ?? '(none)'}`, ...d.discovery.result.blocks.map((b) => `  ${hm(b)}  ${b.title} @ ${b.place} (${b.reason}; ${b.source})`));
  L.push(`   After ignoring: ${d.discovery.ignored.blocks.length} candidates, no new prompt`, '');
  L.push('4. Related-item adjustment', `   Drag Shopping one hour later. Question: ${d.related.dragged.question?.text}`);
  L.push('   Answer "only cooking":', ...d.related.partial.blocks.map(line));
  L.push(`   Answer "no" then drag again: asked again = ${d.related.askedAfterRefusal}`, '', `Network calls: ${d.networkCalls}`);
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(render(await runDemo()));
