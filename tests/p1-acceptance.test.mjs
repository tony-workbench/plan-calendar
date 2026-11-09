// Guards the P1 acceptance criteria: a complete preview page, four planners behind one interface,
// the fixed four-situation comparison, and tests that exercise them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchmark, APPROACHES } from '../src/planner/benchmark.mjs';
import llmAgent from '../src/planner/approaches/llm-agent.mjs';
import { enforce, validatePlan } from '../benchmark/contract.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the preview page is complete: every tag is closed and the page ends with </html>', () => {
  const html = read('public/index.html').trim();
  assert.ok(html.endsWith('</html>'));
  const body = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  assert.equal((body.match(/</g) || []).length, (body.match(/>/g) || []).length);
  for (const id of ['btn-day', 'btn-week', 'btn-prev', 'btn-next', 'btn-undo']) {
    assert.match(html, new RegExp(`<button id="${id}"[^>]*>[^<]*</button>`));
  }
});

test('four approaches share one interface and the contract', () => {
  const planners = { ...APPROACHES, 'llm-agent': llmAgent };
  assert.deepEqual(Object.keys(planners).sort(), ['hybrid', 'llm-agent', 'rules', 'search']);
  for (const p of Object.values(planners)) {
    assert.equal(typeof p.plan, 'function');
    assert.equal(typeof p.replan, 'function');
    assert.doesNotThrow(() => enforce(p));
  }
});

test('the fixed comparison covers four situations for every offline approach', async () => {
  const rows = await runBenchmark();
  for (const name of ['rules', 'search', 'hybrid']) {
    assert.equal(rows[name].situations.length, 4, name);
    assert.deepEqual(rows[name].situations, ['pass', 'pass', 'pass', 'pass'], name);
    assert.equal(rows[name].violations, 0, `${name} broke a hard rule`);
  }
  const plan = await APPROACHES.rules.plan({ request: 'Find time to work out for half an hour', events: [], now: '2026-11-09T08:00:00.000Z', context: {} });
  assert.ok(validatePlan(plan, { events: [] }).ok);
});

test('the owner benchmark loads and scores all four approaches, llm-agent included', () => {
  const out = mkdtempSync(join(tmpdir(), 'p1-bench-'));
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../benchmark/run.mjs', import.meta.url)), '--approach', 'rules,search,llm-agent,hybrid', '--per', '2', '--out', out], { encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '' } });
  assert.equal(run.status, 0, run.stderr);
  for (const name of ['rules', 'search', 'hybrid']) assert.match(run.stdout, new RegExp(name + ': (\\d+)/\\1 cases fully passed'), name);
  // Offline, llm-agent has no model: it must still load and be scored on every case (empty plans, not a crash or a skip).
  assert.doesNotMatch(run.stdout, /skipped/);
  assert.match(run.stdout, /llm-agent: \d+\/8 cases fully passed/);
  assert.equal(readFileSync(join(out, 'llm-agent.public.jsonl'), 'utf8').trim().split('\n').length, 8);
});

test('the preview page has balanced tags throughout, not only at the end', () => {
  const html = read('public/index.html').replace(/<script[\s\S]*?<\/script>/g, '<script></script>').replace(/<style[\s\S]*?<\/style>/g, '<style></style>').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const voids = new Set(['meta', 'link', 'br', 'hr', 'img', 'input']);
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [, close, tag, selfClose] = m;
    if (voids.has(tag.toLowerCase()) || selfClose) continue;
    if (close) assert.equal(stack.pop(), tag.toLowerCase(), 'unexpected </' + tag + '>');
    else stack.push(tag.toLowerCase());
  }
  assert.deepEqual(stack, [], 'unclosed tags');
});

test('the fixed comparison lists all four approaches; llm-agent is scored (not skipped) offline', async () => {
  assert.deepEqual(Object.keys(APPROACHES).sort(), ['hybrid', 'llm-agent', 'rules', 'search']);
  const rows = await runBenchmark(APPROACHES);
  assert.equal(rows['llm-agent'].situations.length, 4);
  assert.equal(rows['llm-agent'].error, undefined);
});

test('the smoke check keeps the product-direction chain, the refusal and the later drag, and a 17:00 due-day deadline', () => {
  const src = read('src/planner/benchmark.mjs');
  assert.match(src, /\['Shopping', 'Cooking', 'Dinner'\]/);
  assert.match(src, /const again\b/);
  assert.match(src, /const r3\b/);
  assert.match(src, /2026-11-20T17:00:00\.000Z/);
});

test('planners ask once about shopping, cooking and dinner, and never re-ask a refused link', async () => {
  const at = (h) => `2026-11-10T${h}:00.000Z`;
  const blk = (id, title, a, b, group) => ({ id, title, start: at(a), end: at(b), group });
  const plan = { blocks: [blk('shop', 'Shopping', '09:00', '10:00', 'meal'), blk('groceries', 'Groceries', '11:00', '11:30', 'x'), blk('cook', 'Cooking', '14:00', '15:00', 'meal'), blk('dinner', 'Dinner', '15:00', '16:00', 'meal')], notes: [] };
  for (const [name, p] of Object.entries(APPROACHES)) {
    if (name === 'llm-agent') continue;
    const r1 = await p.replan({ plan, change: { type: 'drag', blockId: 'shop', start: at('13:00') }, events: [] });
    assert.deepEqual(r1.question.items, ['shop', 'cook', 'dinner'], name);
    assert.equal(r1.blocks.find((b) => b.id === 'groceries').start, at('11:00'), name);
    const r2 = await p.replan({ plan: r1, events: [], answers: { confirm: ['cook'] } });
    assert.equal(r2.question, null, name);
    assert.equal(r2.blocks.find((b) => b.id === 'dinner').start, at('15:00'), name);
    const r3 = await p.replan({ plan: r2, change: { type: 'drag', blockId: 'shop', start: at('13:30') }, events: [] });
    assert.equal(r3.blocks.find((b) => b.id === 'shop').start, at('13:30'), name);
    assert.ok(!(r3.question?.items ?? []).includes('dinner'), `${name} re-asked a refused link`);
  }
});

test('the llm-agent loop plans through its model, calls the activity tool and rejects an overlapping reply', async () => {
  const { createAgent, createFakeModel } = await import('../src/planner/approaches/llm-agent.mjs');
  const replies = JSON.parse(read('tests/fixtures/llm-replies.json'));
  const agent = createAgent({ model: createFakeModel(replies) });
  const input = { request: 'Find time to work out for half an hour', events: [], now: '2026-11-09T08:00:00.000Z', context: {} };
  const r = await agent.plan(input);
  assert.equal(r.blocks.length, 1);
  assert.ok(validatePlan(r, { events: [] }).ok);
  const clash = [{ id: 'e', title: 'x', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T10:00:00.000Z' }];
  await assert.rejects(agent.plan({ ...input, events: clash }), /overlaps a fixed event/);
  let called = 0;
  const source = { find: async () => { called++; return [{ id: 'run', title: 'Park run', start: '2026-11-10T07:00:00.000Z', end: '2026-11-10T08:00:00.000Z', place: 'Park', reason: 'r', source: 's' }]; } };
  const d = await createAgent({ model: createFakeModel({ 'discover|running|X': { tool: 'find_activities', args: {} }, 'discover|running|X|step1': { pick: ['run'], question: 'Want to see it?' } }) })
    .plan({ ...input, request: 'anything fun?', context: { mode: 'discover', interests: ['running'], city: 'X', source } });
  assert.equal(called, 1);
  assert.equal(d.blocks.length, 1);
  assert.ok(d.blocks[0].tentative && d.question);
});
