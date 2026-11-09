import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/planner/approaches/rules.mjs';
import { EVENTS, MEAL_EVENTS, MEAL_PLAN, NOW, SHOP_DRAG, FAKE_SOURCE, runBenchmark } from '../src/planner/benchmark.mjs';
import { assertPlanner, validatePlan } from '../src/planner/interface.mjs';

const find = (plan, id) => plan.blocks.find((b) => b.id === id);

test('rules implements the interface', () => {
  assertPlanner(rules);
});

test('rules passes every benchmark situation with no violations', async () => {
  const r = await runBenchmark(rules);
  for (const s of r.situations) assert.deepEqual(s.failures, [], s.id);
  assert.equal(r.totals.passed, 4);
  assert.equal(r.totals.violations, 0);
});

test('basic request takes the first free working-hours slot', async () => {
  const r = await rules.plan({ request: 'find time to work out for half an hour', events: EVENTS, now: NOW, context: {} });
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].start, '2026-11-09T12:00:00.000Z');
  assert.equal(r.blocks[0].end, '2026-11-09T12:30:00.000Z');
  assert.equal(r.blocks[0].title, 'Workout');
});

test('deadline request back-plans ordered steps before the deadline', async () => {
  const r = await rules.plan({ request: 'Demo due next Friday, plan the prep', events: EVENTS, now: NOW, context: {} });
  assert.equal(r.meta.deadline, '2026-11-20T17:00:00.000Z');
  assert.deepEqual(r.blocks.map((b) => b.title), ['Demo: outline', 'Demo: production', 'Demo: rehearsal']);
  assert.equal(validatePlan(r, { events: EVENTS }).ok, true);
});

test('a request with no deadline asks for one', async () => {
  const r = await rules.plan({ request: 'The demo is due soon', events: EVENTS, now: NOW, context: {} });
  assert.equal(r.blocks.length, 0);
  assert.match(r.question.text, /due/);
});

test('dragging a step re-plans only later steps and marks them', async () => {
  const plan = await rules.plan({ request: 'Demo due next Friday', events: EVENTS, now: NOW, context: {} });
  const out = await rules.replan({ plan, change: { type: 'drag', blockId: 'prep-1', start: '2026-11-18T17:00:00.000Z' }, events: EVENTS });
  assert.equal(find(out, 'prep-1').start, '2026-11-18T17:00:00.000Z');
  assert.ok(find(out, 'prep-2').moved);
  assert.equal(out.before.blocks.length, 3); // the earlier state is kept for undo
  assert.equal(validatePlan(out, { events: EVENTS, deadline: plan.meta.deadline }).ok, true);
});

test('discovery filters candidates and prompts once', async () => {
  const context = { mode: 'discover', interests: ['crafts', 'music'], city: 'Springfield', source: FAKE_SOURCE };
  const r = await rules.plan({ request: '', events: EVENTS, now: NOW, context });
  assert.deepEqual(r.blocks.map((b) => b.id), ['candidate-a1', 'candidate-a2']);
  assert.match(r.question.text, /^Two activities fit you this week/);
  const thin = await rules.plan({ request: '', events: EVENTS, now: NOW, context: { ...context, city: '' } });
  assert.equal(thin.blocks.length, 0);
});

test('related items: one merged question, then only confirmed items move', async () => {
  const ask = await rules.replan({ plan: MEAL_PLAN, change: SHOP_DRAG, events: MEAL_EVENTS });
  assert.deepEqual(ask.question.items, ['shop', 'cook', 'dinner']);
  assert.equal(find(ask, 'cook').start, find(MEAL_PLAN, 'cook').start);
  const part = await rules.replan({ plan: ask, change: null, events: MEAL_EVENTS, answers: { confirm: ['cook'] } });
  assert.ok(find(part, 'cook').moved);
  assert.equal(find(part, 'dinner').start, find(MEAL_PLAN, 'dinner').start);
  assert.equal(find(part, 'groceries-wed').start, find(MEAL_PLAN, 'groceries-wed').start);
  assert.deepEqual(find(part, 'cook').dependsOn, ['shop']);
});

test('related items: refusal makes no links and is not asked again', async () => {
  const ask = await rules.replan({ plan: MEAL_PLAN, change: SHOP_DRAG, events: MEAL_EVENTS });
  const no = await rules.replan({ plan: ask, change: null, events: MEAL_EVENTS, answers: { confirm: 'none' } });
  assert.ok(no.blocks.every((b) => !b.dependsOn));
  assert.deepEqual(no.meta.refused.sort(), ['cook', 'dinner', 'shop'].filter((id) => id !== 'shop'));
  const again = await rules.replan({ plan: no, change: { type: 'drag', blockId: 'shop', start: '2026-11-10T16:00:00.000Z' }, events: MEAL_EVENTS });
  assert.equal(again.question, undefined);
});

test('replan does not mutate its input', async () => {
  const snapshot = JSON.stringify(MEAL_PLAN);
  await rules.replan({ plan: MEAL_PLAN, change: SHOP_DRAG, events: MEAL_EVENTS });
  assert.equal(JSON.stringify(MEAL_PLAN), snapshot);
});
