import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAgent, offline } from '../src/planner/approaches/agent.mjs';
import { understand, parseMinutes } from '../src/planner/core.mjs';

const NOW = '2026-11-09T09:00:00.000Z';

test('with a key the default agent calls the model; without one it stays offline', async () => {
  assert.equal(offline({}), true);
  assert.equal(offline({ GEMINI_API_KEY: 'k', AGENT_OFFLINE: '1' }), true);
  assert.equal(offline({ GEMINI_API_KEY: 'k' }), false);
  const saved = globalThis.fetch, urls = [];
  globalThis.fetch = async (url, opts) => {
    urls.push({ url, body: JSON.parse(opts.body) });
    const blocks = [{ id: 'b1', title: 'Gym', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:30:00.000Z', kind: 'task' }];
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ blocks, notes: [] }) }] } }] }) };
  };
  try {
    const r = await createDefaultAgent({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm1' }).plan({ request: 'hit the gym', events: [], now: NOW, context: {} });
    assert.equal(r.blocks[0].title, 'Gym');
    assert.equal(urls.length, 1);
    assert.match(urls[0].url, /models\/m1:generateContent/);
    assert.deepEqual(urls[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  } finally { globalThis.fetch = saved; }
});

test('the rules parser understands wider date and duration wordings', () => {
  const dl = (request) => understand({ request, now: NOW, context: {} });
  const a = dl('The report is due by the 13th, help me plan the prep');
  assert.equal(a.kind, 'deadline');
  assert.equal(new Date(a.deadline).toISOString().slice(0, 10), '2026-11-13');
  const b = dl('Finish the slides by end of next week');
  assert.equal(b.kind, 'deadline');
  assert.equal(new Date(b.deadline).toISOString().slice(0, 10), '2026-11-20');
  const c = dl('I want to hit the gym for 90 minutes');
  assert.equal(c.kind, 'basic');
  assert.equal(c.minutes, 90);
  assert.match(c.title, /gym/i);
  assert.equal(parseMinutes('a 45-minute walk'), 45);
  assert.equal(parseMinutes('an hour and a half'), 90);
});
