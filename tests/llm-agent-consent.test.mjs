import { test } from 'node:test';
import assert from 'node:assert/strict';
import agent, { createAgent, createFakeModel } from '../src/planner/approaches/llm-agent.mjs';
import rules from '../src/planner/approaches/rules.mjs';

const now = '2026-11-09T08:00:00.000Z';
const blk = (id, s, e) => ({ id, title: id, start: s, end: e, kind: 'proposed' });

test('opt-out env var keeps the calendar local even with a key', async () => {
  process.env.GEMINI_API_KEY = 'x'; process.env.PLANNER_NO_EXTERNAL_MODEL = '1';
  try {
    const r = await agent.plan({ request: 'x', events: [{ start: now, end: now }], now });
    assert.ok(r.notes.some((n) => /model unavailable/.test(n)));
  } finally { delete process.env.GEMINI_API_KEY; delete process.env.PLANNER_NO_EXTERNAL_MODEL; }
});

test('an ignored question is remembered across drags in llm-agent', async () => {
  const blocks = [blk('a', '2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z'), blk('b', '2026-11-11T09:00:00.000Z', '2026-11-11T10:00:00.000Z')];
  const change = { type: 'drag', blockId: 'a', start: '2026-11-10T11:00:00.000Z' };
  const prev = { blocks, notes: [], meta: { kind: 'plan', pending: { mates: ['b'] } }, question: { text: 'q', items: ['a', 'b'] } };
  const key = `replan|${JSON.stringify(change)}|null|asked`;
  const model = createFakeModel({ [key]: { blocks, question: 'same again?' } });
  const r = await createAgent({ model }).replan({ plan: prev, change, events: [] });
  assert.deepEqual(r.meta.declined, ['b']);
  assert.equal(r.meta.pending, undefined);
  assert.equal(r.question, undefined);
});

test('deadline step titles are generic, not "Tax return rehearsal"', async () => {
  const r = await rules.plan({ request: 'The tax return is due next Friday, help me work back', events: [], now, context: {} });
  assert.ok(r.blocks.every((b) => !/rehearsal|production|outline/i.test(b.title)), JSON.stringify(r.blocks.map((b) => b.title)));
});
