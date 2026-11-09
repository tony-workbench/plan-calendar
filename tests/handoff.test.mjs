import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handOffToCalendarAgent, isCalendarRequest } from '../src/handoff/handoff.mjs';
import { createCalendarMcpServer } from '../src/mcp/server.mjs';
import { createInProcessClient } from '../src/mcp/client.mjs';
import { createFakeCalendarAdapter } from '../src/mcp/fake-calendar-adapter.mjs';
import { createFakeModel } from '../src/agent/fake-model.mjs';

const NOW = '2026-11-09T08:00:00.000Z';
const END = '2026-11-16T08:00:00.000Z';
const REQUEST = 'find time to work out for half an hour';
const GOOD = { title: 'Workout', start: '2026-11-10T17:00:00.000Z', end: '2026-11-10T17:30:00.000Z' };
const CLASH = { title: 'Workout', start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T09:30:00.000Z' };

const read = { toolCalls: [{ name: 'read_events', args: { start: NOW, end: END } }] };
const free = { toolCalls: [{ name: 'find_free_time', args: { start: NOW, end: END, durationMinutes: 30 } }] };
const propose = (block) => ({ toolCalls: [{ name: 'propose_blocks', args: { blocks: [block] } }] });
const done = { text: 'Proposed one 30 minute workout block.' };

// Records any call that looks like a write.
function watch(adapter) {
  const writes = [];
  const proxy = new Proxy(adapter, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v === 'function' && /create|insert|write|update|delete|sync|save/i.test(String(prop))) {
        return (...args) => { writes.push(String(prop)); return v.apply(target, args); };
      }
      return v;
    },
  });
  return { proxy, writes };
}

test('isCalendarRequest spots calendar wording', () => {
  assert.equal(isCalendarRequest(REQUEST), true);
  assert.equal(isCalendarRequest('The demo is due next Friday, plan the prep'), true);
  assert.equal(isCalendarRequest('tell me a joke'), false);
  assert.equal(isCalendarRequest(undefined), false);
});

test('hand-off runs request -> tool use -> plan with the proposed blocks, offline', async () => {
  const model = createFakeModel([read, free, propose(GOOD), done]);
  const plan = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model, adapter: createFakeCalendarAdapter() });
  assert.equal(plan.ok, true, plan.error);
  assert.equal(plan.request, REQUEST);
  assert.deepEqual(plan.blocks, [GOOD]);
  assert.deepEqual(plan.existingEvents.map((e) => e.id), ['ev1', 'ev2', 'ev3']);
  for (const e of plan.existingEvents) {
    assert.ok(Date.parse(GOOD.end) <= Date.parse(e.start) || Date.parse(GOOD.start) >= Date.parse(e.end));
  }
  assert.equal(plan.steps, 3);
  assert.equal(model.requests.length, 4);
  const toolMsgs = model.requests[3].messages.filter((m) => m.role === 'tool');
  assert.deepEqual(toolMsgs.map((m) => m.name), ['read_events', 'find_free_time', 'propose_blocks']);
  assert.ok(toolMsgs[1].content.slots.length > 0);
});

test('a conflicting proposal is not returned; a corrected one is', async () => {
  const model = createFakeModel([read, propose(CLASH), propose(GOOD), done]);
  const plan = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model, adapter: createFakeCalendarAdapter() });
  assert.equal(plan.ok, true, plan.error);
  const rejected = model.requests[2].messages.filter((m) => m.role === 'tool').at(-1).content;
  assert.equal(rejected.ok, false);
  assert.equal(rejected.conflicts[0].eventId, 'ev1');
  assert.deepEqual(plan.blocks, [GOOD]);

  const stuck = createFakeModel([read, propose(CLASH), done]);
  const none = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model: stuck, adapter: createFakeCalendarAdapter() });
  assert.deepEqual(none.blocks, []);
});

test('hand-off reuses a given mcp instead of building one', async () => {
  const seen = [];
  const inner = createInProcessClient(createCalendarMcpServer({ adapter: createFakeCalendarAdapter() }));
  const mcp = {
    listTools: () => inner.listTools(),
    callTool: (name, args) => { seen.push(name); return inner.callTool(name, args); },
  };
  const model = createFakeModel([read, free, propose(GOOD), done]);
  const plan = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model, mcp });
  assert.equal(plan.ok, true, plan.error);
  for (const name of ['read_events', 'find_free_time', 'propose_blocks']) assert.ok(seen.includes(name), name);
});

test('model failure returns ok:false with an error and no blocks', async () => {
  const model = { generate: async () => { throw new Error('model unavailable'); } };
  const plan = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model, adapter: createFakeCalendarAdapter() });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /model unavailable/);
  assert.deepEqual(plan.blocks, []);
});

test('agent-loop errors (unknown tool, tool failure, step limit) give ok:false and no blocks', async () => {
  const cases = [
    [[propose(GOOD), { toolCalls: [{ name: 'delete_everything', args: {} }] }], /unknown tool/],
    [[propose(GOOD), { toolCalls: [{ name: 'read_events', args: { start: 'x', end: 'y' } }] }], /read_events failed/],
    [Array.from({ length: 12 }, () => read), /step limit/],
  ];
  for (const [replies, pattern] of cases) {
    const plan = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model: createFakeModel(replies), adapter: createFakeCalendarAdapter() });
    assert.equal(plan.ok, false);
    assert.match(plan.error, pattern);
    assert.deepEqual(plan.blocks, []);
  }
});

test('empty request is rejected without calling the model', async () => {
  const model = createFakeModel([done]);
  const plan = await handOffToCalendarAgent({ request: '  ', now: NOW, model, adapter: createFakeCalendarAdapter() });
  assert.equal(plan.ok, false);
  assert.equal(model.requests.length, 0);
});

test('nothing is written to the adapter', async () => {
  const { proxy, writes } = watch(createFakeCalendarAdapter());
  const model = createFakeModel([read, free, propose(GOOD), done]);
  const plan = await handOffToCalendarAgent({ request: REQUEST, now: NOW, model, adapter: proxy });
  assert.equal(plan.ok, true, plan.error);
  assert.deepEqual(writes, []);
});
