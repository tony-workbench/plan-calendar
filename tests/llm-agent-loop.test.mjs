import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/planner/approaches/llm-agent.mjs';

const now = '2026-11-09T08:00:00.000Z';
const scripted = (steps, seen) => ({
  async complete({ key, prompt }) {
    seen.push({ key, prompt: JSON.parse(prompt) });
    const next = steps.shift();
    if (!next) throw new Error('model called too often');
    return JSON.stringify(next);
  },
});

test('llm-agent runs a tool loop: the model calls a tool, sees the result, then answers', async () => {
  const seen = [];
  const events = [{ id: 'e1', title: 'Meeting', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:00:00.000Z' }];
  const model = scripted([
    { tool: 'free_slots', args: { from: now, to: '2026-11-09T12:00:00.000Z', minutes: 30 } },
    { blocks: [{ id: 'b1', title: 'Workout', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:30:00.000Z' }] },
  ], seen);
  const r = await createAgent({ model }).plan({ request: 'workout', events, now });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].prompt.transcript[0].tool, 'free_slots');
  assert.deepEqual(seen[1].prompt.transcript[0].result[1], { start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T12:00:00.000Z' });
  assert.equal(r.blocks[0].id, 'b1');
});

test('llm-agent feeds unknown-tool errors back and stops a loop that never answers', async () => {
  const seen = [];
  const model = scripted([{ tool: 'nope' }, { blocks: [] }], seen);
  await createAgent({ model }).plan({ request: 'x', events: [], now });
  assert.match(seen[1].prompt.transcript[0].result.error, /unknown tool/);
  const forever = { complete: async () => JSON.stringify({ tool: 'list_events' }) };
  await assert.rejects(() => createAgent({ model: forever }).plan({ request: 'x', events: [], now }), /did not finish/);
});

test('llm-agent discovery calls find_activities through the loop', async () => {
  const seen = [];
  const cand = { id: 'c1', title: 'Run club', start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T10:00:00.000Z' };
  const model = scripted([{ tool: 'find_activities', args: {} }, { pick: ['c1'], question: 'See it?' }], seen);
  const source = { find: async () => [cand] };
  const r = await createAgent({ model }).plan({ request: 'r', events: [], now, context: { mode: 'discover', interests: ['run'], city: 'X', source } });
  assert.equal(r.blocks[0].id, 'candidate-c1');
  assert.equal(seen[1].prompt.transcript[0].tool, 'find_activities');
});
