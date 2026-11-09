import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnderstander } from '../src/planner/understand-live.mjs';
import { understand } from '../src/planner/core.mjs';

const input = { request: 'find time to work out for half an hour', now: '2030-01-07T08:00:00Z', context: {} };
const env = Object.fromEntries([['GEMINI_API_KEY', 'x'.repeat(3)]]);
const reply = (o) => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }) });

test('a stalled model call falls back to the regex parser after the timeout', async () => {
  const hang = () => new Promise(() => {});
  assert.deepEqual(await createUnderstander({ fetch: hang, env, timeoutMs: 20 })(input), understand(input));
});

test('an aborted fetch falls back to the regex parser', async () => {
  const f = (_u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
  assert.deepEqual(await createUnderstander({ fetch: f, env, timeoutMs: 20 })(input), understand(input));
});

test('a discover reply outside discover mode uses the regex parser result', async () => {
  const got = await createUnderstander({ fetch: reply({ kind: 'discover', interests: ['music'] }), env })(input);
  assert.deepEqual(got, understand(input));
});
