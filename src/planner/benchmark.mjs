// SUPPLEMENTARY smoke check, written by a coding seat. It is not the shared benchmark: the owner's
// benchmark/ is the one that produces the numbers in docs/P1-approach-comparison.md. One fixed
// example per situation; deterministic, no model, no network. Pass other planners to runBenchmark().

import { enforce, toMs } from './interface.mjs';
import rules from './approaches/rules.mjs';
import search from './approaches/search.mjs';
import llmAgent from './approaches/llm-agent.mjs';
import hybrid from './approaches/hybrid.mjs';

// llm-agent has no model offline (empty plans, scored as FAIL); with GEMINI_API_KEY set it runs for real.
export const APPROACHES = { rules, search, 'llm-agent': llmAgent, hybrid };

const NOW = '2026-11-09T08:00:00.000Z'; // Monday
const MIN = 60000;
const ev = (id, start, end) => ({ id, title: id, start, end });
const EVENTS = [
  ev('standup', '2026-11-09T09:00:00.000Z', '2026-11-09T12:00:00.000Z'),
  ev('review', '2026-11-18T09:00:00.000Z', '2026-11-18T17:00:00.000Z'),
  ev('offsite', '2026-11-19T09:00:00.000Z', '2026-11-19T14:00:00.000Z'),
];
const MEAL_EVENTS = [ev('dentist', '2026-11-10T12:00:00.000Z', '2026-11-10T13:00:00.000Z')];
const DEADLINE = Date.parse('2026-11-20T17:00:00.000Z'); // 17:00 on the due Friday, as in benchmark/gen.mjs
const STEPS = ['demo-outline', 'demo-production', 'demo-rehearsal'];

const mealBlock = (id, title, group, start, end) => ({ id, title, group, start, end });
const mealPlan = () => ({
  blocks: [
    mealBlock('shop', 'Shopping', 'meal', '2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z'),
    mealBlock('groceries', 'Groceries for tomorrow', 'other', '2026-11-10T11:00:00.000Z', '2026-11-10T11:30:00.000Z'),
    mealBlock('cook', 'Cooking', 'meal', '2026-11-10T14:00:00.000Z', '2026-11-10T15:00:00.000Z'),
    mealBlock('dinner', 'Dinner', 'meal', '2026-11-10T15:00:00.000Z', '2026-11-10T16:00:00.000Z'),
  ],
  notes: [],
  meta: { kind: 'basic' },
});

const CANDIDATES = [
  { id: 'run', title: 'Park run', start: '2026-11-10T07:00:00.000Z', end: '2026-11-10T08:00:00.000Z', place: 'City Park', reason: 'matches running', source: 'fake', tags: ['running'] },
  { id: 'talk', title: 'Design talk', start: '2026-11-11T17:00:00.000Z', end: '2026-11-11T18:00:00.000Z', place: 'Library', reason: 'matches design', source: 'fake', tags: ['design'] },
];
const fakeSource = { find: async () => CANDIDATES };

const overlap = (a, b) => toMs(a.start) < toMs(b.end) && toMs(a.end) > toMs(b.start);
const byId = (blocks) => Object.fromEntries(blocks.map((b) => [b.id, b]));

function overlaps(blocks, events) {
  let n = 0;
  for (let i = 0; i < blocks.length; i++) {
    for (const e of events) if (overlap(blocks[i], e)) n++;
    for (let j = i + 1; j < blocks.length; j++) if (overlap(blocks[i], blocks[j])) n++;
  }
  return n;
}
const outOfOrder = (blocks, ids) => {
  const by = byId(blocks);
  let n = 0;
  for (let i = 1; i < ids.length; i++) if (!by[ids[i - 1]] || !by[ids[i]] || toMs(by[ids[i - 1]].end) > toMs(by[ids[i]].start)) n++;
  return n;
};
const pastDeadline = (blocks) => blocks.filter((b) => toMs(b.end) > DEADLINE).length;
const movedCount = (blocks) => blocks.filter((b) => b.moved).length;
// Quality scores (lower is better): delay = minutes from now to the S1 block; shift = minutes other
// blocks moved from their previous start in a re-plan (the changed block itself is not counted).
const shiftOf = (prev, next, changedId) => {
  const old = byId(prev.blocks);
  return Math.round(next.blocks.reduce((n, b) => (b.id !== changedId && old[b.id] ? n + Math.abs(toMs(b.start) - toMs(old[b.id].start)) : n), 0) / MIN);
};
const hard = (blocks, events) => overlaps(blocks, events) + outOfOrder(blocks, STEPS) + pastDeadline(blocks);

// Each situation returns { ok, violations, questions, moved }.
async function s1(p) {
  const r = enforce(await p.plan({ request: 'Find time to work out for half an hour', events: EVENTS, now: NOW, context: {} }));
  const v = overlaps(r.blocks, EVENTS) + r.blocks.filter((b) => toMs(b.start) < toMs(NOW)).length;
  const ok = r.blocks.length === 1 && toMs(r.blocks[0].end) - toMs(r.blocks[0].start) === 30 * MIN && !r.question;
  return { ok: ok && v === 0, violations: v, questions: r.question ? 1 : 0, moved: 0, delay: Math.round((toMs(r.blocks[0]?.start) - toMs(NOW)) / MIN), shift: 0 };
}

async function s2(p) {
  const r = enforce(await p.plan({ request: 'The demo is due next Friday, plan the prep', events: EVENTS, now: NOW, context: {} }));
  let v = hard(r.blocks, EVENTS);
  let ok = r.blocks.length === 3 && !r.question;
  const into = new Date(toMs(byId(r.blocks)['demo-production'].start) + 30 * MIN).toISOString();
  const d = enforce(await p.replan({ plan: r, change: { type: 'drag', blockId: 'demo-outline', start: into }, events: EVENTS }));
  v += hard(d.blocks, EVENTS);
  ok = ok && byId(d.blocks)['demo-outline'].start === into && byId(d.blocks)['demo-production'].moved === true;
  const m = enforce(await p.replan({ plan: r, change: { type: 'more-time', blockId: 'demo-production', minutes: 60 }, events: EVENTS }));
  v += hard(m.blocks, EVENTS);
  const mp = byId(m.blocks)['demo-production'];
  ok = ok && toMs(mp.end) - toMs(mp.start) === 180 * MIN;
  const questions = [r, d, m].filter((x) => x.question).length;
  return { ok: ok && v === 0, violations: v, questions, moved: movedCount(d.blocks) + movedCount(m.blocks), delay: 0, shift: shiftOf(r, d, 'demo-outline') + shiftOf(r, m, 'demo-production') };
}

async function s3(p) {
  const ctx = { mode: 'discover', interests: ['running', 'design'], city: 'Springfield', source: fakeSource };
  const ask = (context) => p.plan({ request: 'anything fun this week?', events: EVENTS, now: NOW, context });
  const r = enforce(await ask(ctx));
  const thin = enforce(await ask({ mode: 'discover', interests: [], source: fakeSource }));
  const ign = enforce(await ask({ ...ctx, dismissed: true }));
  const v = overlaps(r.blocks, EVENTS);
  const ok = r.blocks.length >= 1 && r.blocks.length <= 3 && !!r.question && r.blocks.every((b) => b.tentative && b.place && b.reason && b.source)
    && thin.blocks.length === 0 && !thin.question && ign.blocks.length === 0 && !ign.question;
  return { ok: ok && v === 0, violations: v, questions: r.question ? 1 : 0, moved: 0, delay: 0, shift: 0 };
}

async function s4(p) {
  const before = mealPlan();
  const drag = { type: 'drag', blockId: 'shop', start: '2026-11-10T13:00:00.000Z' }; // shopping moves later
  const r1 = enforce(await p.replan({ plan: before, change: drag, events: MEAL_EVENTS }));
  const q = r1.question?.text ?? '';
  // One question names the whole chain (shopping, cooking and dinner), not the unrelated groceries.
  const asked = ['Shopping', 'Cooking', 'Dinner'].every((n) => q.includes(n)) && !q.includes('Groceries')
    && byId(r1.blocks).cook.start === '2026-11-10T14:00:00.000Z';
  // Only cooking is confirmed: dinner is left alone.
  const r2 = enforce(await p.replan({ plan: r1, events: MEAL_EVENTS, answers: { confirm: ['cook'] } }));
  const by2 = byId(r2.blocks);
  let v = overlaps(r2.blocks, MEAL_EVENTS) + overlaps(r2.blocks, []);
  if (by2.groceries.start !== before.blocks[1].start) v++; // unrelated item moved
  if (by2.dinner.start !== before.blocks[3].start) v++; // unconfirmed item moved
  // A refused link (dinner) is not asked about again, and a later drag is still handled.
  const r3 = enforce(await p.replan({ plan: r2, change: { type: 'drag', blockId: 'shop', start: '2026-11-10T13:30:00.000Z' }, events: MEAL_EVENTS }));
  const again = !(r3.question?.text ?? '').includes('Dinner') && byId(r3.blocks).shop.start === '2026-11-10T13:30:00.000Z';
  const ok = asked && !r2.question && by2.cook.moved === true && again;

  return { ok: ok && v === 0, violations: v, questions: [r1, r2, r3].filter((x) => x.question).length, moved: movedCount(r2.blocks), delay: 0, shift: shiftOf(before, r1, 'shop') + shiftOf(r1, r2, 'shop') };
}

const SITUATIONS = [s1, s2, s3, s4];

export async function runBenchmark(approaches = APPROACHES) {
  const rows = {};
  for (const [name, planner] of Object.entries(approaches)) {
    const row = { passed: 0, situations: [], violations: 0, questions: 0, moved: 0, delay: 0, shift: 0 };
    for (const run of SITUATIONS) {
      let res;
      try {
        res = await run(planner);
      } catch (e) {
        res = { ok: false, violations: 0, questions: 0, moved: 0, delay: 0, shift: 0, error: e.message };
      }
      row.situations.push(res.ok ? 'pass' : 'FAIL');
      if (res.ok) row.passed++;
      row.violations += res.violations;
      row.questions += res.questions;
      row.moved += res.moved;
      row.delay += res.delay;
      row.shift += res.shift;
    }
    rows[name] = row;
  }
  return rows;
}
