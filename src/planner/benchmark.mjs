// A fixed, deterministic benchmark of the four situations. Fixtures are plain data;
// runBenchmark(planner) -> { situations: [...], totals } with numbers only, no randomness.

import { enforce, toMs, validatePlan } from './interface.mjs';

export const NOW = '2026-11-09T09:00:00.000Z'; // a Monday

const ev = (id, title, start, end) => ({ id, title, start: `2026-11-${start}:00.000Z`, end: `2026-11-${end}:00.000Z` });

export const EVENTS = [
  ev('e1', 'Team sync', '09T09:00', '09T10:00'),
  ev('e2', 'Client call', '09T10:00', '09T12:00'),
  ev('e3', 'Workshop', '09T13:00', '09T17:00'),
  ev('e4', 'Offsite', '10T09:00', '10T18:00'),
  ev('e5', 'Planning', '11T09:00', '11T12:00'),
  ev('e6', 'Conference', '19T09:00', '19T18:00'),
  ev('e7', 'Review meeting', '20T15:00', '20T17:00'),
];

export const DEADLINE = '2026-11-20T17:00:00.000Z';

// Related-item fixture: a meal plan whose items share a group hint but no stated link.
export const MEAL_EVENTS = [ev('m1', 'Dentist', '10T08:00', '10T09:00'), ev('m2', 'Call with Sam', '10T20:00', '10T21:00')];
export const MEAL_PLAN = {
  blocks: [
    { id: 'shop', title: 'Shopping', start: '2026-11-10T10:00:00.000Z', end: '2026-11-10T11:00:00.000Z', kind: 'proposed', group: 'meal-tue' },
    { id: 'cook', title: 'Cooking', start: '2026-11-10T17:00:00.000Z', end: '2026-11-10T18:00:00.000Z', kind: 'proposed', group: 'meal-tue' },
    { id: 'dinner', title: 'Dinner', start: '2026-11-10T18:00:00.000Z', end: '2026-11-10T19:00:00.000Z', kind: 'proposed', group: 'meal-tue' },
    { id: 'groceries-wed', title: "Tomorrow's groceries", start: '2026-11-10T12:00:00.000Z', end: '2026-11-10T12:30:00.000Z', kind: 'proposed', group: 'meal-wed' },
  ],
  notes: [],
  meta: { kind: 'related' },
};
export const SHOP_DRAG = { type: 'drag', blockId: 'shop', start: '2026-11-10T16:30:00.000Z' };

export const FAKE_SOURCE = {
  find: () => [
    { id: 'a1', title: 'Pottery class', start: '2026-11-09T18:30:00.000Z', end: '2026-11-09T20:00:00.000Z', place: 'Studio 5', reason: 'You like making things', source: 'fake-listings', tags: ['crafts'] },
    { id: 'a2', title: 'Jazz night', start: '2026-11-10T19:00:00.000Z', end: '2026-11-10T21:00:00.000Z', place: 'Blue Room', reason: 'You like live music', source: 'fake-listings', tags: ['music'] },
    { id: 'a3', title: 'Clash with offsite', start: '2026-11-10T10:00:00.000Z', end: '2026-11-10T11:00:00.000Z', place: 'Hall', reason: 'Matches crafts', source: 'fake-listings', tags: ['crafts'] },
    { id: 'a4', title: 'No source listed', start: '2026-11-11T18:00:00.000Z', end: '2026-11-11T19:00:00.000Z', place: 'Hall', reason: 'Matches music', tags: ['music'] },
    { id: 'a5', title: 'Cage fighting', start: '2026-11-12T18:00:00.000Z', end: '2026-11-12T19:00:00.000Z', place: 'Arena', reason: 'Popular', source: 'fake-listings', tags: ['combat'] },
  ],
};

const DISCOVER_CONTEXT = { mode: 'discover', interests: ['crafts', 'music'], city: 'Springfield', source: FAKE_SOURCE };

const minutes = (b) => (toMs(b.end) - toMs(b.start)) / 60000;
const changed = (a, b) => a.start !== b.start || a.end !== b.end;

// Each situation returns { failures, violations, questions, moved } for one planner.
function tracker() {
  const t = { failures: [], violations: 0, questions: 0, moved: 0 };
  t.expect = (cond, msg) => { if (!cond) t.failures.push(msg); };
  t.result = (r) => { if (r.question) t.questions += 1; return r; };
  t.validate = (plan, opts, label, ignore = []) => {
    const violations = validatePlan(plan, opts).violations.filter((v) => !ignore.includes(v.code));
    t.violations += violations.length;
    t.expect(violations.length === 0, `${label}: ${violations.map((v) => v.code).join(',')}`);
  };
  // Count blocks other than `skip` whose time changed.
  t.countMoved = (before, after, skip) => {
    const old = new Map(before.blocks.map((b) => [b.id, b]));
    t.moved += after.blocks.filter((b) => b.id !== skip && old.has(b.id) && changed(old.get(b.id), b)).length;
  };
  return t;
}

async function basic(p) {
  const t = tracker();
  const r = t.result(await p.plan({ request: 'Find time to work out for half an hour', events: EVENTS, now: NOW, context: {} }));
  t.expect(r.blocks.length === 1, 'exactly one block');
  const [b] = r.blocks;
  if (b) {
    t.expect(minutes(b) === 30, 'block is 30 minutes');
    t.expect(toMs(b.start) >= toMs(NOW), 'block is not in the past');
  }
  t.validate(r, { events: EVENTS }, 'basic');
  t.expect(!r.question, 'no question needed');
  return t;
}

async function deadline(p) {
  const t = tracker();
  const request = 'The demo is due next Friday, help me plan the prep';
  const r = t.result(await p.plan({ request, events: EVENTS, now: NOW, context: {} }));
  t.expect(r.blocks.length === 3, 'three preparation steps');
  t.expect(r.blocks.every((b) => toMs(b.end) <= toMs(DEADLINE)), 'every step ends before the deadline');
  t.validate(r, { events: EVENTS, deadline: DEADLINE }, 'plan');
  if (r.blocks.length !== 3) return t;
  const [outline, production, rehearsal] = [...r.blocks].sort((a, b) => toMs(a.start) - toMs(b.start));
  t.expect(/outline/i.test(outline.title) && /production/i.test(production.title) && /rehearsal/i.test(rehearsal.title), 'steps in order outline, production, rehearsal');

  // Dragging the first step to a later time re-plans only the later steps.
  const drag = { type: 'drag', blockId: outline.id, start: '2026-11-18T17:00:00.000Z' };
  const d = t.result(await p.replan({ plan: r, change: drag, events: EVENTS }));
  const dragged = d.blocks.find((b) => b.id === outline.id);
  t.expect(dragged && dragged.start === drag.start, 'dragged step stays where the user put it');
  t.validate(d, { events: EVENTS, eventsBefore: EVENTS, before: r, allowedMoves: r.blocks.map((b) => b.id), deadline: DEADLINE }, 'drag');
  t.countMoved(r, d, outline.id);
  t.expect(d.blocks.filter((b) => b.moved).length === t.moved, 'moved items are marked');

  // More time re-plans the remaining work.
  const more = { type: 'more-time', blockId: production.id, minutes: 60 };
  const m = t.result(await p.replan({ plan: r, change: more, events: EVENTS }));
  const longer = m.blocks.find((b) => b.id === production.id);
  t.expect(longer && minutes(longer) === minutes(production) + 60, 'production is an hour longer');
  const prodAfter = m.blocks.find((b) => b.id === production.id);
  const outAfter = m.blocks.find((b) => b.id === outline.id);
  t.expect(outAfter && !changed(outAfter, outline), 'earlier steps are untouched');
  t.validate(m, { events: EVENTS, eventsBefore: EVENTS, before: r, allowedMoves: [production.id, rehearsal.id], deadline: DEADLINE }, 'more-time');
  t.countMoved(r, m, production.id);
  t.expect(prodAfter !== undefined, 'production still planned');
  return t;
}

async function discovery(p) {
  const t = tracker();
  const r = t.result(await p.plan({ request: 'Anything fun this week?', events: EVENTS, now: NOW, context: DISCOVER_CONTEXT }));
  t.expect(r.blocks.length >= 1 && r.blocks.length <= 3, 'a few candidates');
  t.expect(r.blocks.every((b) => b.place && b.reason && b.source && b.tentative), 'candidates show place, reason, source and are tentative');
  t.expect(!r.blocks.some((b) => /clash|no source|cage/i.test(b.title)), 'clashing, unsourced and off-interest items are dropped');
  t.validate(r, { events: EVENTS }, 'discovery');
  t.expect(r.question && /want to see/i.test(r.question.text), 'one light prompt');

  const thin = t.result(await p.plan({ request: 'Anything fun this week?', events: EVENTS, now: NOW, context: { ...DISCOVER_CONTEXT, interests: [] } }));
  t.expect(thin.blocks.length === 0 && !thin.question, 'thin information yields nothing and no prompt');

  const ignored = t.result(await p.plan({ request: 'Anything fun this week?', events: EVENTS, now: NOW, context: { ...DISCOVER_CONTEXT, dismissed: true } }));
  t.expect(ignored.blocks.length === 0 && !ignored.question, 'an ignored prompt is not repeated');
  return t;
}

async function related(p) {
  const t = tracker();
  const base = { ...MEAL_PLAN, blocks: MEAL_PLAN.blocks };
  const ids = base.blocks.map((b) => b.id);
  const opts = (before, allowed) => ({ events: MEAL_EVENTS, eventsBefore: MEAL_EVENTS, before, allowedMoves: allowed });

  const ask = t.result(await p.replan({ plan: base, change: SHOP_DRAG, events: MEAL_EVENTS }));
  t.expect(ask.question && ['shop', 'cook', 'dinner'].every((id) => ask.question.items.includes(id)), 'one merged question names shopping, cooking and dinner');
  t.expect(ask.question && !ask.question.items.includes('groceries-wed'), 'unrelated groceries are not part of the question');
  t.countMoved(base, ask, 'shop');
  t.expect(t.moved === 0, 'nothing else moves before the answer');

  const all = t.result(await p.replan({ plan: ask, change: null, events: MEAL_EVENTS, answers: { confirm: 'all' } }));
  t.expect(!all.question, 'no second question after the answer');
  t.validate(all, opts(base, ['shop', 'cook', 'dinner']), 'confirm all');
  t.countMoved(base, all, 'shop');
  t.expect(['cook', 'dinner'].every((id) => changed(base.blocks.find((b) => b.id === id), all.blocks.find((b) => b.id === id))), 'confirmed items move');

  const part = t.result(await p.replan({ plan: ask, change: null, events: MEAL_EVENTS, answers: { confirm: ['cook'] } }));
  t.validate(part, opts(base, ['shop', 'cook']), 'partial');
  const dinner = (x) => x.blocks.find((b) => b.id === 'dinner');
  t.expect(!changed(dinner(part), dinner(base)), 'dinner is left alone when only cooking was confirmed');
  t.countMoved(base, part, 'shop');

  const no = t.result(await p.replan({ plan: ask, change: null, events: MEAL_EVENTS, answers: { confirm: 'none' } }));
  t.validate(no, opts(base, ['shop']), 'refusal', ['overlap-block']); // refusing leaves the overlap the user chose
  t.expect(ids.every((id) => id === 'shop' || !changed(base.blocks.find((b) => b.id === id), no.blocks.find((b) => b.id === id))), 'refusal moves nothing else');
  const again = t.result(await p.replan({ plan: no, change: { type: 'drag', blockId: 'shop', start: '2026-11-10T16:00:00.000Z' }, events: MEAL_EVENTS }));
  t.expect(!again.question, 'a refused link is not asked again');
  return t;
}

export const SITUATIONS = [
  { id: 'basic', name: 'Basic arrangement', run: basic },
  { id: 'deadline', name: 'Deadline back-planning', run: deadline },
  { id: 'discovery', name: 'Proactive discovery', run: discovery },
  { id: 'related', name: 'Related-item adjustment', run: related },
];

export async function runBenchmark(planner) {
  const checked = enforce(planner);
  const situations = [];
  for (const s of SITUATIONS) {
    const started = performance.now();
    let t;
    try {
      t = await s.run(checked);
    } catch (err) {
      t = { failures: [`threw: ${err.message}`], violations: 0, questions: 0, moved: 0 };
    }
    situations.push({
      id: s.id,
      name: s.name,
      pass: t.failures.length === 0,
      failures: t.failures,
      violations: t.violations,
      questions: t.questions,
      moved: t.moved,
      ms: Math.round((performance.now() - started) * 100) / 100,
    });
  }
  const sum = (k) => situations.reduce((n, s) => n + s[k], 0);
  return {
    situations,
    totals: { passed: situations.filter((s) => s.pass).length, total: situations.length, violations: sum('violations'), questions: sum('questions'), moved: sum('moved'), ms: Math.round(sum('ms') * 100) / 100 },
  };
}
