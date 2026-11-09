import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAgent, offline, plan, replan } from '../src/planner/approaches/agent.mjs';
import { buildPrompt, buildRequest } from '../src/planner/gemini.mjs';

const NOW = '2026-11-09T09:00:00.000Z';
const input = { request: 'Find time to work out for half an hour', events: [], now: NOW, context: {} };
const reply = (obj) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const blocks = [{ id: 'b1', title: 'Gym', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:30:00.000Z', kind: 'task' }];

test('the live request uses temperature 0 and thinking budget 0', () => {
  const g = buildRequest('x').generationConfig;
  assert.equal(g.temperature, 0);
  assert.deepEqual(g.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(g.responseMimeType, 'application/json');
});

test('the prompt tells the model how to handle all four situations', () => {
  const p = buildPrompt({ kind: 'plan', input });
  for (const re of [/outline/, /production/, /rehearsal/, /dependsOn/, /exactly ONE question/, /"candidate"/, /unmovable/, /ONE merged question/]) assert.match(p, re);
});

test('exported plan and replan stay offline under node --test even when a key is set', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this suite runs under node --test');
  assert.equal(offline({ GEMINI_API_KEY: 'k', NODE_TEST_CONTEXT: 'child-v8' }), true);
  const savedKey = process.env.GEMINI_API_KEY, savedFetch = globalThis.fetch;
  let calls = 0;
  process.env.GEMINI_API_KEY = 'k';
  globalThis.fetch = async () => { calls++; throw new Error('network is forbidden in tests'); };
  try {
    const r = await plan(input);
    assert.equal(r.meta.engine, 'scripted-offline');
    const r2 = await replan({ plan: r, change: { type: 'extend', stepId: r.blocks[0].id, minutes: 15 }, events: [], now: NOW, context: {} }).catch(() => null);
    if (r2) assert.equal(r2.meta.engine, 'scripted-offline');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
  }
  assert.equal(calls, 0);
});

test('a live agent labels results with the model and handles replan, deadline and ask-deadline prompts', async () => {
  const saved = globalThis.fetch, prompts = [];
  let next;
  globalThis.fetch = async (url, opts) => { const b = JSON.parse(opts.body); prompts.push(b.contents[0].parts[0].text); assert.equal(b.generationConfig.temperature, 0); return reply(next); };
  try {
    const agent = createDefaultAgent({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm2' });
    next = { blocks, notes: [] };
    const first = await agent.plan(input);
    assert.equal(first.meta.engine, 'gemini:m2');
    // replan goes through the model too, with the current plan and the change in the prompt
    const re = await agent.replan({ plan: first, change: { type: 'set-deadline', text: 'Friday' }, events: [], now: NOW, context: {} });
    assert.equal(re.blocks.length, 1);
    assert.match(prompts.at(-1), /set-deadline/);
    // a request without a deadline: the model's single question is passed through
    next = { blocks: [], notes: [], question: { text: 'When is the demo due?', items: [] } };
    const q = await agent.plan({ request: 'Help me prepare the demo', events: [], now: NOW, context: {} });
    assert.equal(q.question.text, 'When is the demo due?');
    // a deadline request carries the deadline in meta
    next = { blocks, notes: [] };
    const d = await agent.plan({ request: 'The demo is due by the 13th, plan the prep', events: [], now: NOW, context: {} });
    assert.equal(d.meta.kind, 'deadline');
    assert.equal(d.meta.deadline.slice(0, 10), '2026-11-13');
    assert.equal(prompts.length, 4);
  } finally { globalThis.fetch = saved; }
});
