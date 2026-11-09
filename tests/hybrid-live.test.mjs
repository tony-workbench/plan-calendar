import test from 'node:test';
import assert from 'node:assert/strict';
import { createHybridLive, toIntent, createGeminiUnderstander } from '../src/planner/approaches/hybrid-live.mjs';
import { generate } from '../benchmark/gen.mjs';

const NOW = '2026-11-09T09:00:00.000Z';
const counted = (reply) => { const f = () => { f.calls++; if (reply instanceof Error) throw reply; return reply; }; f.calls = 0; return f; };
const base = { events: [], now: NOW, context: {} };
const cases = generate({ seed: 1, perCategory: 20, prefix: 't' });

test('hybrid-live takes the understanding from the model and lets core.mjs place the block', async () => {
  const u = counted({ kind: 'basic', title: 'Gym session', minutes: 45, day: 'tomorrow' });
  const r = await createHybridLive({ understander: u }).plan({ ...base, request: 'could you squeeze in some lifting for me tomorrow' });
  assert.equal(u.calls, 1);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].title, 'Gym session');
  assert.equal(Date.parse(r.blocks[0].end) - Date.parse(r.blocks[0].start), 45 * 60000);
  assert.ok(r.blocks[0].start >= '2026-11-10T00:00');
});

test('a model deadline becomes three ordered steps before the deadline', async () => {
  const u = counted({ kind: 'deadline', what: 'demo', deadline: '2026-11-13T15:00:00.000Z' });
  const r = await createHybridLive({ understander: u }).plan({ ...base, request: 'the demo lands on Friday afternoon, get me ready' });
  assert.equal(r.blocks.length, 3);
  assert.ok(r.blocks.every((b) => Date.parse(b.end) <= Date.parse('2026-11-13T15:00:00.000Z')));
  assert.equal(r.meta.deadlineAssumed, false);
});

test('a missing deadline gets one question and no blocks', async () => {
  const r = await createHybridLive({ understander: counted({ kind: 'ask-deadline', what: 'the pitch' }) }).plan({ ...base, request: 'help me get ready for the pitch' });
  assert.equal(r.blocks.length, 0);
  assert.match(r.question.text, /due/);
});

test('model failure or a bad reply falls back to the offline understanding', async () => {
  const request = 'Find time to work out for half an hour';
  for (const reply of [new Error('network down'), { kind: 'basic' }, { kind: 'deadline', what: 'x', deadline: 'nope' }, null, 'text']) {
    const r = await createHybridLive({ understander: counted(reply) }).plan({ ...base, request });
    assert.equal(r.blocks.length, 1, String(reply));
  }
  assert.equal(toIntent({ kind: 'basic', title: 'Run', minutes: 5000 }, { ...base, request: 'run' }).minutes, 30);
});

test('discovery makes no model call', async () => {
  const u = counted({ kind: 'basic', title: 'x' });
  const k = cases.find((c) => c.category === 'discovery' && c.context?.candidates?.length);
  assert.ok(k, 'a discovery case exists');
  const context = { ...k.context, source: { find: () => k.context.candidates } };
  const r = await createHybridLive({ understander: u }).plan({ request: k.request, events: k.events, now: NOW, context });
  assert.equal(u.calls, 0);
  assert.equal(r.meta.kind, 'discover');
});

test('related replans make no model call, ask one merged question, honor partial confirmation and remember refusals', async () => {
  const u = counted({ kind: 'none' }), p = createHybridLive({ understander: u });
  const k = cases.find((c) => c.category === 'related' && c.sub !== 'known' && c.expect.chain.length > 2);
  assert.ok(k, 'a related drag case exists');
  const events = k.events ?? [];
  const first = await p.replan({ plan: k.plan, change: k.change, events });
  assert.ok(first.question, 'one merged question');
  assert.ok(first.question.items.length >= 2);
  const keep = first.question.items.find((id) => id !== first.meta.pending.blockId);
  const done = await p.replan({ plan: first, events, answers: { confirm: [keep] } });
  assert.equal(done.question, undefined);
  assert.ok(done.blocks.filter((b) => b.moved).every((b) => b.id === keep));
  const skipped = first.meta.pending.items.filter((id) => id !== keep);
  assert.ok(skipped.every((id) => done.meta.declined?.includes(id)), 'unconfirmed items are remembered as declined');
  const none = await p.replan({ plan: first, events, answers: { confirm: [] } });
  assert.ok(none.meta.declined.length >= 2);
  assert.ok(none.blocks.every((b) => !b.moved));
  const again = await p.replan({ plan: none, change: k.change, events });
  assert.equal(again.question, undefined);
  assert.equal(u.calls, 0);
});

test('the live understander sends the key only as a header and fails without one', async () => {
  await assert.rejects(createGeminiUnderstander({ env: {}, fetch: () => assert.fail('no request') })({ request: 'x', now: NOW }));
  const placeholder = ['dummy', 'value', String(Date.now())].join('-');
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"kind":"none"}' }] } }] }) }; };
  const out = await createGeminiUnderstander({ env: { GEMINI_API_KEY: placeholder }, fetch })({ request: 'hello', now: NOW });
  assert.deepEqual(out, { kind: 'none' });
  assert.ok(!seen.url.includes(placeholder) && !seen.init.body.includes(placeholder));
  assert.match(seen.url, /gemini-3\.8-flash/);
});
