import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase, casePass } from '../benchmark/score.mjs';
import { enforce } from '../benchmark/contract.mjs';
import { approaches } from '../src/planner/index.mjs';
import { createAgent } from '../src/planner/approaches/agent.mjs';

const prep = (k) => k.context?.candidates ? { ...k, context: { ...k.context, source: { find: () => k.context.candidates } } } : k;
const cases = generate({ seed: 1, perCategory: 20, prefix: 'pub' });
const NOW = '2026-11-09T09:00:00.000Z';

test('every approach implements plan and replan as the contract defines', () => {
  assert.deepEqual(Object.keys(approaches).sort(), ['agent', 'hybrid', 'rules', 'search']);
  for (const p of Object.values(approaches)) assert.doesNotThrow(() => enforce(p));
});

for (const [name, planner] of Object.entries(approaches)) {
  test(`${name} passes most public benchmark cases in every situation`, async () => {
    const by = {};
    for (const k of cases) {
      const r = await scoreCase(planner, prep(structuredClone(k)));
      assert.equal(r.delivered, true, `${k.id}: ${r.error}`);
      const s = (by[k.category] ??= { pass: 0, n: 0 });
      s.n++; if (casePass(r)) s.pass++;
    }
    for (const [cat, s] of Object.entries(by)) assert.ok(s.pass / s.n >= 0.9, `${name} ${cat}: ${s.pass}/${s.n}`);
  });
}

test('the planners do not read the benchmark answers', () => {
  for (const f of ['core', 'approaches/rules', 'approaches/search', 'approaches/agent', 'approaches/hybrid']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/planner/${f}.mjs`, import.meta.url), 'utf8'), /\.expect\b|gen\.mjs|score\.mjs/, f);
  }
});

test('hybrid keeps its internal steps out of the notes the user sees', async () => {
  const input = { request: 'Find time to work out for half an hour', events: [], now: NOW, context: {} };
  const r = await approaches.hybrid.plan(input);
  assert.equal(r.blocks.length, 1);
  assert.ok(r.meta.debug && typeof r.meta.debug.used === 'string');
  for (const n of r.notes) assert.doesNotMatch(n, /rules|hard-rule|check|search/i);
});

test('an assumed deadline can be corrected by a reply', async () => {
  for (const p of Object.values(approaches)) {
    const first = await p.plan({ request: 'The demo is due next Friday, help me plan the prep', events: [], now: NOW, context: {} });
    assert.ok(first.notes.some((n) => /assumed/.test(n) && /reply/.test(n)));
    assert.match(first.blocks[0].title, /outline/);
    const second = await p.replan({ plan: first, change: { type: 'set-deadline', text: 'it is due Wednesday at 3 pm' }, events: [] });
    assert.equal(second.meta.deadline, '2026-11-11T15:00:00.000Z');
    assert.equal(second.meta.deadlineAssumed, false);
    assert.equal(second.blocks.length, 3);
    assert.ok(second.blocks.every((b) => Date.parse(b.end) <= Date.parse('2026-11-11T15:00:00.000Z')));
  }
});

test('the offline agent never touches the network and a live model must be passed in explicitly', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network used'); };
  try {
    const r = await approaches.agent.plan({ request: 'Find time to read a book for an hour', events: [], now: NOW, context: {} });
    assert.equal(r.blocks.length, 1);
    const seen = [];
    const model = ({ task, history }) => { seen.push(history.length); return history.length ? { tool: 'submit', args: { result: { blocks: [], notes: [] } } } : { tool: 'read_schedule' }; };
    await createAgent({ model }).plan({ request: 'Find time to read', events: [], now: NOW, context: {} });
    assert.deepEqual(seen, [0, 1]);
  } finally { globalThis.fetch = real; }
});

test('the page says that times are shown in UTC', () => {
  assert.match(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), /UTC/);
});
