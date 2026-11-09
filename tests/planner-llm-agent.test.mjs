import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLlmPlanner, createFakeModel, createGeminiModel } from '../src/planner/approaches/llm-agent.mjs';
import { toMs } from '../src/planner/approaches/llm-tools.mjs';
import { enforce, validatePlan } from '../src/planner/interface.mjs';
import { DEADLINE, EVENTS, FAKE_SOURCE, MEAL_EVENTS, MEAL_PLAN, NOW, SHOP_DRAG, runBenchmark } from '../src/planner/benchmark.mjs';

const planner = enforce(createLlmPlanner({ model: createFakeModel() }));
const ids = (blocks) => Object.fromEntries(blocks.map((b) => [b.id, b]));
const DISCOVER = { mode: 'discover', interests: ['crafts', 'music'], city: 'Springfield', source: FAKE_SOURCE };
const DEMO = 'The demo is due next Friday, help me plan the prep';

test('the llm-agent planner passes the fixed benchmark on all four situations', async () => {
  const result = await runBenchmark(createLlmPlanner({ model: createFakeModel() }));
  assert.deepEqual(result.situations.filter((s) => !s.pass).map((s) => `${s.id}: ${s.failures.join('; ')}`), []);
  assert.equal(result.totals.passed, 4);
  assert.equal(result.totals.violations, 0);
});

test('results follow the one interface: notes array, one question, drag and more-time changes', async () => {
  const plan = await planner.plan({ request: DEMO, events: EVENTS, now: NOW, context: {} });
  assert.ok(Array.isArray(plan.notes));
  assert.equal(plan.meta.deadline, DEADLINE);
  assert.equal(plan.question, undefined);
  await assert.rejects(planner.replan({ plan, change: { type: 'move', blockId: 'outline', start: NOW }, events: EVENTS }), /unsupported change/);
});

test('basic arrangement: one 30 minute block in a free slot, tools called in order', async () => {
  const plan = await planner.plan({ request: 'Find time to work out for half an hour', events: EVENTS, now: NOW, context: {} });
  assert.equal(plan.blocks.length, 1);
  assert.equal(toMs(plan.blocks[0].end) - toMs(plan.blocks[0].start), 30 * 60000);
  assert.equal(plan.meta.kind, 'basic');
  assert.deepEqual(plan.meta.trace, ['read_events', 'find_free_time', 'propose_blocks']);
  assert.equal(validatePlan(plan, { events: EVENTS }).ok, true);
});

test('deadline back-planning: ordered steps with dependencies before the deadline', async () => {
  const plan = await planner.plan({ request: DEMO, events: EVENTS, now: NOW, context: {} });
  const b = ids(plan.blocks);
  assert.deepEqual(plan.blocks.map((x) => x.id), ['outline', 'production', 'rehearsal']);
  assert.deepEqual(b.production.dependsOn, ['outline']);
  assert.deepEqual(b.rehearsal.dependsOn, ['production']);
  assert.equal(validatePlan(plan, { events: EVENTS }).ok, true);
});

test('proactive discovery: tentative candidates with place, reason and source and one light prompt', async () => {
  const plan = await planner.plan({ request: 'Anything fun this week?', events: EVENTS, now: NOW, context: DISCOVER });
  assert.deepEqual(plan.blocks.map((b) => b.id), ['a1', 'a2']);
  for (const block of plan.blocks) {
    assert.equal(block.kind, 'candidate');
    assert.equal(block.tentative, true);
    for (const key of ['place', 'reason', 'source']) assert.ok(block[key], key);
  }
  assert.equal(plan.question.text, 'Two activities fit you this week, want to see them?');
  assert.deepEqual(plan.meta.trace, ['search_activities', 'find_free_time', 'propose_blocks']);
});

test('discovery makes no model call when information is thin or the prompt was ignored', async () => {
  const silent = { async generate() { throw new Error('the model must not be called'); } };
  const quiet = enforce(createLlmPlanner({ model: silent }));
  for (const context of [{ ...DISCOVER, interests: [] }, { ...DISCOVER, dismissed: true }]) {
    const plan = await quiet.plan({ request: 'Anything fun this week?', events: EVENTS, now: NOW, context });
    assert.deepEqual(plan.blocks, []);
    assert.equal(plan.question, undefined);
  }
});

test('dragging a step keeps it there, re-plans later steps and marks them as moved', async () => {
  const plan = await planner.plan({ request: DEMO, events: EVENTS, now: NOW, context: {} });
  const next = await planner.replan({ plan, change: { type: 'drag', blockId: 'outline', start: '2026-11-18T17:00:00.000Z' }, events: EVENTS });
  const b = ids(next.blocks);
  assert.equal(b.outline.start, '2026-11-18T17:00:00.000Z');
  assert.equal(b.outline.moved, undefined);
  assert.equal(b.production.moved, true);
  assert.equal(b.rehearsal.moved, true);
  assert.deepEqual(next.before.blocks, plan.blocks); // pre-change state kept for undoing the whole change
  assert.ok(next.blocks.every((x) => !('from' in x) && !('previous' in x)));
  const check = validatePlan(next, { events: EVENTS, eventsBefore: EVENTS, before: next.before, allowedMoves: plan.blocks.map((x) => x.id), deadline: DEADLINE });
  assert.deepEqual(check.violations, []);
});

test('asking for more production time re-plans the remaining work only', async () => {
  const plan = await planner.plan({ request: DEMO, events: EVENTS, now: NOW, context: {} });
  const next = await planner.replan({ plan, change: { type: 'more-time', blockId: 'production', minutes: 60 }, events: EVENTS });
  const b = ids(next.blocks);
  assert.equal(toMs(b.production.end) - toMs(b.production.start), 3 * 3600000);
  assert.deepEqual(b.outline, ids(plan.blocks).outline);
});

test('related items: ask once with one merged question, then use only what was confirmed', async () => {
  const first = await planner.replan({ plan: MEAL_PLAN, change: SHOP_DRAG, events: MEAL_EVENTS });
  assert.deepEqual(first.question.items, ['shop', 'cook', 'dinner']);
  assert.ok(first.blocks.every((b) => !b.moved));
  assert.deepEqual(first.before.blocks, MEAL_PLAN.blocks);

  const second = await planner.replan({ plan: first, change: null, events: MEAL_EVENTS, answers: { confirm: ['cook'] } });
  const b = ids(second.blocks);
  assert.equal(second.question, undefined);
  assert.equal(b.cook.moved, true);
  assert.equal(b.dinner.start, ids(MEAL_PLAN.blocks).dinner.start); // not confirmed, not moved
  assert.equal(b['groceries-wed'].start, ids(MEAL_PLAN.blocks)['groceries-wed'].start); // unrelated, not moved
  assert.deepEqual(second.before.blocks, MEAL_PLAN.blocks);
  assert.deepEqual(validatePlan(second, { events: MEAL_EVENTS, eventsBefore: MEAL_EVENTS, before: second.before, allowedMoves: ['shop', 'cook'] }).violations, []);
});

test('a refusal is not asked again and does not link items', async () => {
  const first = await planner.replan({ plan: MEAL_PLAN, change: SHOP_DRAG, events: MEAL_EVENTS });
  const no = await planner.replan({ plan: first, change: null, events: MEAL_EVENTS, answers: { confirm: 'none' } });
  assert.equal(no.question, undefined);
  assert.ok(no.blocks.every((b) => !b.moved && !b.dependsOn));
  assert.equal(ids(no.blocks).cook.start, ids(MEAL_PLAN.blocks).cook.start);
  const again = await planner.replan({ plan: no, change: { type: 'drag', blockId: 'shop', start: '2026-11-10T16:00:00.000Z' }, events: MEAL_EVENTS });
  assert.equal(again.question, undefined);
});

test('invalid proposals are rejected: fixed events stay safe', async () => {
  const bad = {
    async generate({ messages }) {
      const turns = messages.filter((m) => m.role === 'tool');
      if (turns.length === 0) {
        return { tool_call: { name: 'propose_blocks', args: { blocks: [{ id: 'x', title: 'X', start: '2026-11-09T09:00:00Z', end: '2026-11-09T10:00:00Z' }] } } };
      }
      assert.match(JSON.stringify(turns[0].content.rejected), /overlaps fixed event e1/);
      return { final: { summary: 'gave up' } };
    },
  };
  const plan = await enforce(createLlmPlanner({ model: bad })).plan({ request: 'anything', events: EVENTS, now: NOW, context: {} });
  assert.deepEqual(plan.blocks, []);
});

test('a question that names already refused items is dropped', async () => {
  const eager = { async generate() { return { final: { question: { text: 'Same meal?', items: ['shop', 'cook', 'dinner'] } } }; } };
  const p = enforce(createLlmPlanner({ model: eager }));
  const plan = { ...MEAL_PLAN, meta: { kind: 'related', refused: ['cook', 'dinner'] } };
  const result = await p.replan({ plan, change: SHOP_DRAG, events: MEAL_EVENTS });
  assert.equal(result.question, undefined);
});

test('the default planner works offline without a key and makes no network call', async () => {
  const saved = { key: process.env.GEMINI_API_KEY, fetch: globalThis.fetch };
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = () => { throw new Error('network call attempted'); };
  try {
    const { plan } = await import('../src/planner/approaches/llm-agent.mjs');
    const result = await plan({ request: 'work out for half an hour', events: EVENTS, now: NOW, context: {} });
    assert.equal(result.blocks.length, 1);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key !== undefined) process.env.GEMINI_API_KEY = saved.key;
  }
});

test('the Gemini adapter sends the key only as a header and never echoes it', async () => {
  const apiKey = ['placeholder', 'value', 'one'].join('_');
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const model = createGeminiModel({ apiKey, fetchImpl });
  await assert.rejects(model.generate({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] }), (error) => {
    assert.ok(!error.message.includes(apiKey));
    return true;
  });
  assert.ok(seen.url.includes('gemini-3.8-flash'));
  assert.ok(!seen.url.includes(apiKey) && !seen.init.body.includes(apiKey));
  assert.equal(seen.init.headers['x-goog-api-key'], apiKey);
  assert.throws(() => createGeminiModel({}), /not set/);
});
