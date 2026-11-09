import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../src/planner/approaches/agent.mjs';
import { createGeminiModel, buildPrompt, buildRequest, SCHEMA_TEXT } from '../src/planner/gemini.mjs';

const NOW = '2026-11-09T09:00:00.000Z';
const input = { request: 'Find time to work out for half an hour', events: [], now: NOW, context: {} };
const good = { blocks: [{ id: 'b1', title: 'Workout', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T10:30:00.000Z', kind: 'task' }], notes: [] };
const reply = (obj) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });

test('every prompt states the exact answer schema and an example', () => {
  for (const task of [{ kind: 'plan', input }, { kind: 'replan', input: { plan: { blocks: [], meta: { now: NOW } }, change: { type: 'set-deadline', text: 'Friday' }, events: [] } }]) {
    const p = buildPrompt(task);
    assert.ok(p.includes(SCHEMA_TEXT));
    assert.match(p, /Example: \{"blocks":\[/);
    assert.match(p, /Free windows: \[/);
  }
});

test('the request turns thinking off and passes a response schema', () => {
  const g = buildRequest('x').generationConfig;
  assert.deepEqual(g.thinkingConfig, { thinkingBudget: 0 });
  assert.ok(g.responseSchema.required.includes('blocks'));
});

test('the adapter sends the thinking config, retries a wrong shape once and never needs the network', async () => {
  const bodies = [], answers = [{ answer: 'Yes, you have plenty of room' }, good];
  const fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return reply(answers.shift()); };
  const agent = createAgent({ model: createGeminiModel({ fetch, env: { GEMINI_API_KEY: 'k' } }), maxTurns: 3 });
  const r = await agent.plan(input);
  assert.equal(r.blocks.length, 1);
  assert.equal(bodies.length, 2);
  for (const b of bodies) assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.match(bodies[1].contents[0].parts[0].text, /rejected/);
});

import { readFileSync } from 'node:fs';
test('the page tells a first-time user what to do and that nothing is saved until confirmed', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /Ask bar/);
  assert.match(html, /not built yet/);
  assert.match(html, /Nothing will be added to Google Calendar until you confirm/);
});

test('the benchmark can load a live Gemini approach, and it makes no request without a key', async () => {
  const live = (await import('../src/planner/approaches/agent-live.mjs')).default;
  assert.equal(typeof live.plan, 'function');
  assert.equal(typeof live.replan, 'function');
  const saved = process.env.GEMINI_API_KEY, savedFetch = globalThis.fetch;
  delete process.env.GEMINI_API_KEY;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('network'); };
  try { await assert.rejects(live.plan(input), /GEMINI_API_KEY/); } finally { globalThis.fetch = savedFetch; if (saved !== undefined) process.env.GEMINI_API_KEY = saved; }
  assert.equal(called, false);
});

test('a live reply is submitted with meta so deadline checks see the deadline', async () => {
  const fetch = async () => reply(good);
  const deadline = Date.parse('2026-11-09T10:15:00.000Z');
  const model = createGeminiModel({ fetch, env: { GEMINI_API_KEY: 'k' } });
  const out = await model({ task: { kind: 'plan', input, intent: { kind: 'deadline', deadline, assumed: false } }, history: [] });
  const m = out.args.result.meta;
  assert.equal(m.kind, 'deadline');
  assert.equal(m.deadline, new Date(deadline).toISOString());
  assert.equal(m.now, NOW);
});
