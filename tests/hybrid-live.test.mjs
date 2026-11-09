import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase, casePass } from '../benchmark/score.mjs';
import { createHybridLive } from '../src/planner/approaches/hybrid-live.mjs';
import { buildIntentRequest, intentFromReply } from '../src/planner/understand-live.mjs';
import { understand } from '../src/planner/core.mjs';

const NOW = '2026-11-09T09:00:00.000Z';
const env = { GEMINI_API_KEY: 'k' };
const model = (obj, log = []) => async (url, opts) => { log.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }) }; };

// Recorded intent replies for wording the regex parser does not read (the model sends an intent only: no blocks, times, questions or ids).
const RECORDED = {
  basic: { request: 'Any chance of a stretch of yoga somewhere this week?', reply: { kind: 'basic', activity: 'yoga', minutes: 50 } },
  deadline: { request: 'Our investor pitch lands on Friday week, help me get ready', reply: { kind: 'deadline', activity: 'investor pitch', deadline_text: 'next Friday' } },
};

test('recorded model reply: the intent minutes win over the default and the plan is made in code', async () => {
  const { request, reply } = RECORDED.basic;
  const input = { request, events: [], now: NOW, context: {} };
  assert.notEqual(understand(input).minutes, 50, 'the regex parser alone does not produce the model value');
  const log = [];
  const r = await createHybridLive({ fetch: model(reply, log), env }).plan(input);
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].title, 'Yoga');
  assert.equal(Date.parse(r.blocks[0].end) - Date.parse(r.blocks[0].start), 50 * 60000);
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(log[0].generationConfig.temperature, 0);
  assert.equal(log[0].tools, undefined);
});

test('recorded model deadline reply is back-planned in code into three ordered steps', async () => {
  const { request, reply } = RECORDED.deadline;
  const input = { request, events: [], now: NOW, context: {} };
  const fallback = await createHybridLive({ fetch: async () => { throw new Error('no'); }, env: {} }).plan(input);
  const r = await createHybridLive({ fetch: model(reply), env }).plan(input);
  assert.deepEqual(r.blocks.map((b) => b.id), ['step-1', 'step-2', 'step-3']);
  assert.ok(r.blocks.every((b) => Date.parse(b.end) <= Date.parse(r.meta.deadline)));
  assert.ok(r.meta.deadline, 'a deadline came from the model wording');
  assert.notEqual(r.meta.deadline, fallback.meta?.deadline, 'the model wording changed the outcome compared with the regex parser');
});

test('an invalid model reply, a failed call or a missing key falls back to the regex parser', async () => {
  const request = 'Find time to work out for half an hour';
  for (const [fetch, e] of [[model('not json'), env], [model({ kind: 'bogus' }), env], [async () => { throw new Error('down'); }, env], [async () => ({ ok: false }), env], [async () => { throw new Error('must not be called'); }, {}]]) {
    const r = await createHybridLive({ fetch, env: e }).plan({ request, events: [], now: NOW, context: {} });
    assert.equal(r.blocks.length, 1);
    assert.equal(r.blocks[0].title, 'Work out');
  }
});

test('discovery mode makes no model call', async () => {
  let called = 0;
  const h = createHybridLive({ fetch: async () => { called++; throw new Error('no'); }, env });
  await h.plan({ request: 'Anything fun?', events: [], now: NOW, context: { mode: 'discover', interests: ['music'], candidates: [] } });
  assert.equal(called, 0);
});

test('intent parsing rejects bad shapes and the prompt asks only for understanding', () => {
  assert.equal(intentFromReply('[]', 'x', NOW), null);
  assert.equal(intentFromReply('{"kind":"none"}', 'x', NOW).kind, 'none');
  assert.match(buildIntentRequest('hi').contents[0].parts[0].text, /Do not plan, choose times or write questions/);
});

// Related-item adjustment runs in code (single merged question, partial confirm, refusal memory) while the model is wired in and never consulted for replan.
const related = generate({ seed: 1, perCategory: 20, prefix: 'pub' }).filter((k) => k.category === 'related');

test('hybrid-live related-item adjustment keeps the rule scores and makes no model call', async () => {
  assert.ok(related.length > 0);
  let called = 0;
  const h = createHybridLive({ fetch: async () => { called++; throw new Error('replan must not call the model'); }, env });
  let pass = 0;
  for (const k of related) {
    const r = await scoreCase(h, structuredClone(k));
    assert.equal(r.delivered, true, `${k.id}: ${r.error}`);
    if (casePass(r)) pass++;
  }
  assert.ok(pass / related.length >= 0.9, `related ${pass}/${related.length}`);
  assert.equal(called, 0);
});

test('hybrid-live asks one merged question, honours a partial confirm and remembers a refusal', async () => {
  const k = related.find((c) => c.expect.partial && !c.expect.collide) ?? related[0];
  const h = createHybridLive({ fetch: async () => { throw new Error('no'); }, env });
  const events = k.events;
  const ask = await h.replan({ plan: structuredClone(k.plan), change: k.change, events });
  if (ask.question) {
    assert.ok(ask.question.items.length >= 2, 'one question names the items');
    const no = await h.replan({ plan: ask, change: null, events, answers: { confirm: 'none' } });
    const again = await h.replan({ plan: no, change: { ...k.change, start: new Date(Date.parse(k.change.start) + 30 * 60000).toISOString() }, events });
    assert.equal(again.question, undefined, 'a refused link is not asked again');
    if (k.expect.partial) {
      const part = await h.replan({ plan: ask, change: null, events, answers: { confirm: [k.expect.partial] } });
      const before = new Map(ask.blocks.map((b) => [b.id, b.start]));
      const other = part.blocks.find((b) => b.id === k.expect.other);
      assert.equal(other.start, before.get(k.expect.other), 'the unrelated item does not move');
    }
  }
});
