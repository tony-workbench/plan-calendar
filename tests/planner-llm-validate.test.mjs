import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/planner/approaches/llm-agent.mjs';

const events = [{ id: 'standup', title: 'standup', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T12:00:00.000Z' }];
const now = '2026-11-09T08:00:00.000Z';
const agentWith = (reply) => createAgent({ model: { complete: async () => (typeof reply === 'string' ? reply : JSON.stringify(reply)) } });
const run = (reply) => agentWith(reply).plan({ request: 'x', events, now, context: {} });

test('a well-formed reply is accepted', async () => {
  const r = await run({ blocks: [{ id: 'a', start: '2026-11-09T12:00:00.000Z', end: '2026-11-09T12:30:00.000Z' }] });
  assert.equal(r.blocks.length, 1);
});

test('bad model replies are rejected', async () => {
  await assert.rejects(run('not json'), /not JSON/);
  await assert.rejects(run({ notes: [] }), /no blocks/);
  await assert.rejects(run({ blocks: [{ id: 'a', start: 'nope', end: 'nope' }] }), /bad times/);
  await assert.rejects(run({ blocks: [{ id: 'a', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:30:00.000Z' }] }), /overlaps a fixed event/);
  const b = { id: 'a', start: '2026-11-09T12:00:00.000Z', end: '2026-11-09T12:30:00.000Z' };
  await assert.rejects(run({ blocks: [b, b] }), /duplicated/);
});
