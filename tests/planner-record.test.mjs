import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAgent, createFakeModel } from '../src/planner/approaches/llm-agent.mjs';

const replies = JSON.parse(readFileSync(new URL('./fixtures/llm-replies.json', import.meta.url), 'utf8'));
const now = new Date('2026-01-05T08:00:00Z');

test('llm-agent replays a recorded reply and fails loudly on an unrecorded request', async () => {
  const model = createFakeModel(replies);
  const r = await createAgent({ model }).plan({ request: 'Find time to work out for half an hour', events: [], now: '2026-11-09T08:00:00.000Z' });
  assert.equal(r.blocks.length, 1);
  await assert.rejects(() => createFakeModel({}).complete({ key: 'plan|never recorded' }), /no recorded reply/);
  await assert.rejects(() => createAgent({ model: createFakeModel({}) }).plan({ request: 'never recorded', events: [], now }), /no recorded reply/);
});

test('llm-agent rejects a malformed model reply', async () => {
  const bad = { async complete() { return JSON.stringify({ notes: [] }); } };
  await assert.rejects(() => createAgent({ model: bad }).plan({ request: 'x', events: [], now }), /no blocks/);
  const notJson = { async complete() { return 'not json'; } };
  await assert.rejects(() => createAgent({ model: notJson }).plan({ request: 'x', events: [], now }));
});

test('the production llm-agent module does not import the recorded replies', () => {
  const src = readFileSync(new URL('../src/planner/approaches/llm-agent.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /readFileSync|from '[^']*fixtures/);
});

test('the comparison record names the owner benchmark and labels llm-agent as replay-only', () => {
  const doc = readFileSync(new URL('../docs/P1-approach-comparison.md', import.meta.url), 'utf8');
  assert.doesNotMatch(doc, /not present in this tree/);
  assert.match(doc, /benchmark\/run\.mjs/);
  assert.match(doc, /replay-only/i);
});
