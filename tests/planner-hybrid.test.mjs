import { test } from 'node:test';
import assert from 'node:assert/strict';
import approach from '../src/planner/approaches/hybrid.mjs';

const NOW = '2026-11-09T08:00:00.000Z'; // Monday
const ev = (id, start, end) => ({ id, title: id, start, end });
const EVENTS = [
  ev('standup', '2026-11-09T09:00:00.000Z', '2026-11-09T12:00:00.000Z'),
  ev('review', '2026-11-18T09:00:00.000Z', '2026-11-18T17:00:00.000Z'),
  ev('offsite', '2026-11-19T09:00:00.000Z', '2026-11-19T14:00:00.000Z'),
];
const t = (s) => Date.parse(s);
const byId = (blocks) => Object.fromEntries(blocks.map((b) => [b.id, b]));
const noOverlap = (blocks, events) => {
  const all = [...blocks.map((b) => ({ id: b.id, s: t(b.start), e: t(b.end) })), ...events.map((e) => ({ id: e.id, s: t(e.start), e: t(e.end) }))];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(all[i].e <= all[j].s || all[j].e <= all[i].s, `${all[i].id} overlaps ${all[j].id}`);
};
const inOrder = (blocks, ids) => {
  const by = byId(blocks);
  for (let i = 1; i < ids.length; i++) assert.ok(t(by[ids[i - 1]].end) <= t(by[ids[i]].start), `${ids[i - 1]} must end before ${ids[i]}`);
};

test('situation 1: basic arrangement picks a scored free slot', () => {
  const events = structuredClone(EVENTS);
  const p = approach.plan({ request: 'Find time to work out for half an hour', events, now: NOW, context: {} });
  assert.equal(p.blocks.length, 1);
  assert.equal(t(p.blocks[0].end) - t(p.blocks[0].start), 30 * 60000);
  assert.ok(t(p.blocks[0].start) >= t(NOW));
  noOverlap(p.blocks, events);
  assert.deepEqual(events, EVENTS, 'fixed events untouched');
  assert.equal(p.question, null);
});

const deadlinePlan = () => approach.plan({ request: 'The demo is due next Friday, plan the prep', events: EVENTS, now: NOW, context: {} });
const ORDER = ['demo-outline', 'demo-production', 'demo-rehearsal'];

test('situation 2: deadline back-planning keeps order, deadline and fixed events', () => {
  const p = deadlinePlan();
  assert.equal(p.blocks.length, 3);
  noOverlap(p.blocks, EVENTS);
  inOrder(p.blocks, ORDER);
  const deadline = t('2026-11-20T00:00:00.000Z');
  assert.ok(p.blocks.every((b) => t(b.end) <= deadline));
  assert.equal(p.question, null);
});

test('situation 2: dragging a step re-plans later steps; more time re-plans the rest', () => {
  const p = deadlinePlan();
  const by0 = byId(p.blocks);
  const into = new Date(t(by0['demo-production'].start) + 30 * 60000).toISOString();
  const r = approach.replan({ plan: p, change: { blockId: 'demo-outline', start: into }, events: EVENTS });
  noOverlap(r.blocks, EVENTS);
  inOrder(r.blocks, ORDER);
  const by = byId(r.blocks);
  assert.equal(by['demo-outline'].start, into);
  assert.equal(by['demo-production'].moved, true);
  assert.equal(r.question, null);

  const more = approach.replan({ plan: p, change: { blockId: 'demo-production', extraMinutes: 60 }, events: EVENTS });
  const mp = byId(more.blocks);
  assert.equal(t(mp['demo-production'].end) - t(mp['demo-production'].start), 180 * 60000);
  noOverlap(more.blocks, EVENTS);
  inOrder(more.blocks, ORDER);
});

// Situation 4 fixture: the meal items share a goal but no order is stated; the hybrid infers
// the candidates and asks once. An unrelated block has a different goal.
const mealPlan = () => ({
  now: NOW,
  question: null,
  hints: [],
  links: [], refused: [], asked: [],
  blocks: [
    { id: 'shop', title: 'Shopping', goal: 'meal', start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T10:00:00.000Z', after: [] },
    { id: 'groceries', title: 'Groceries for tomorrow', goal: 'other', start: '2026-11-10T11:00:00.000Z', end: '2026-11-10T11:30:00.000Z', after: [] },
    { id: 'cook', title: 'Cooking', goal: 'meal', start: '2026-11-10T14:00:00.000Z', end: '2026-11-10T15:00:00.000Z', after: [] },
    { id: 'dinner', title: 'Dinner', goal: 'meal', start: '2026-11-10T15:00:00.000Z', end: '2026-11-10T16:00:00.000Z', after: [] },
  ],
});
const MEAL_EVENTS = [ev('dentist', '2026-11-10T12:00:00.000Z', '2026-11-10T13:00:00.000Z')];

test('situation 4: one merged question, confirmed items move, refused are not re-asked', () => {
  const p = mealPlan();
  const r1 = approach.replan({ plan: p, change: { blockId: 'cook', start: '2026-11-10T13:00:00.000Z' }, events: MEAL_EVENTS });
  assert.ok(r1.question, 'a question is asked');
  for (const name of ['Shopping', 'Cooking', 'Dinner']) assert.ok(r1.question.text.includes(name));
  assert.ok(!r1.question.text.includes('Groceries'));
  assert.equal(byId(r1.blocks).dinner.start, '2026-11-10T15:00:00.000Z', 'nothing else moves before the answer');

  // Same request again without an answer: still only one question was ever asked.
  const again = approach.replan({ plan: r1, change: { blockId: 'cook', start: '2026-11-10T13:00:00.000Z' }, events: MEAL_EVENTS });
  assert.equal(again.question, null);

  const r2 = approach.replan({ plan: r1, change: { blockId: 'cook', start: '2026-11-10T15:00:00.000Z' }, events: MEAL_EVENTS, answers: { confirmed: ['dinner'] } });
  assert.equal(r2.question, null);
  const by2 = byId(r2.blocks);
  assert.equal(by2.dinner.moved, true);
  assert.equal(by2.shop.start, '2026-11-10T09:00:00.000Z', 'unconfirmed item untouched');
  assert.equal(by2.groceries.start, '2026-11-10T11:00:00.000Z', 'unrelated item untouched');
  assert.ok(t(by2.cook.end) <= t(by2.dinner.start), 'order kept');
  noOverlap(r2.blocks, MEAL_EVENTS);
  assert.ok(r2.previous, 'earlier state kept for undo');

  const r3 = approach.replan({ plan: r2, change: { blockId: 'cook', start: '2026-11-10T14:00:00.000Z' }, events: MEAL_EVENTS });
  assert.equal(r3.question, null, 'refused link is not asked again');
  assert.equal(byId(r3.blocks).shop.start, '2026-11-10T09:00:00.000Z');
});

test('situation 4: clear prerequisites are adjusted directly without a question', () => {
  const p = mealPlan();
  p.blocks.find((b) => b.id === 'cook').after = ['shop'];
  p.blocks.find((b) => b.id === 'dinner').after = ['cook'];
  const r = approach.replan({ plan: p, change: { blockId: 'cook', start: '2026-11-10T15:00:00.000Z' }, events: MEAL_EVENTS });
  assert.equal(r.question, null);
  const by = byId(r.blocks);
  assert.ok(t(by.cook.end) <= t(by.dinner.start));
  assert.ok(t(by.shop.end) <= t(by.cook.start));
  assert.equal(by.groceries.start, '2026-11-10T11:00:00.000Z');
  noOverlap(r.blocks, MEAL_EVENTS);
});
