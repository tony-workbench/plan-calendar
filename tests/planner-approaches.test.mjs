import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase } from '../benchmark/score.mjs';
import { enforce } from '../benchmark/contract.mjs';
import { createHybrid } from '../src/planner/approaches/hybrid.mjs';

const dir = new URL('../src/planner/approaches/', import.meta.url);
const NAMES = ['rules', 'search', 'llm-agent', 'hybrid'];
const load = async (n) => (await import(new URL(`${n}.mjs`, dir))).default;
const prep = (k) => (k.context?.candidates ? { ...k, context: { ...k.context, source: { find: () => k.context.candidates } } } : k);

// Same scoring as `node benchmark/run.mjs --split public`, in process.
export async function runPublic(name, per) {
  const planner = await load(name), by = {};
  let pass = 0, n = 0;
  for (const k of generate({ seed: 1, perCategory: per, prefix: 'pub' })) {
    const r = await scoreCase(planner, prep(structuredClone(k)), 20000);
    n++;
    const ok = r.delivered && r.checks.every((x) => x.ok);
    if (ok) pass++;
    (by[k.category] ??= { n: 0, pass: 0, undelivered: 0 }).n++;
    if (ok) by[k.category].pass++;
    if (!r.delivered) by[k.category].undelivered++;
  }
  return { pass, n, by };
}

test('every approach module default-exports plan and replan and is registered', async () => {
  const found = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const m = await import(new URL(f, dir));
    if (typeof m.default?.plan === 'function' && typeof m.default?.replan === 'function') found.push(f.replace(/\.mjs$/, ''));
  }
  assert.deepEqual(found.sort(), [...NAMES].sort());
});

test('rules, search and hybrid deliver on every public case and pass most of them', async () => {
  for (const name of ['rules', 'search', 'hybrid']) {
    const { pass, n, by } = await runPublic(name, 12);
    console.log(name, `${pass}/${n}`, JSON.stringify(by));
    for (const [cat, s] of Object.entries(by)) assert.equal(s.undelivered, 0, `${name} failed to deliver on ${cat}`);
    assert.ok(pass / n >= 0.8, `${name} passed only ${pass}/${n}`);
  }
});

test('the planners do not read expected answers', () => {
  for (const f of ['rules', 'search', 'hybrid']) {
    const src = readFileSync(new URL(`${f}.mjs`, dir), 'utf8');
    assert.doesNotMatch(src, /\.expect\b|benchmark\//);
  }
  assert.doesNotMatch(readFileSync(new URL('../src/planner/lib/engine.mjs', import.meta.url), 'utf8'), /\.expect\b|benchmark\//);
});

test('related items: one merged question, partial confirmation, refusal is not asked again', async () => {
  const p = await load('search');
  const at = (h) => `2026-11-10T${String(h).padStart(2, '0')}:00:00.000Z`;
  const blk = (id, title, a, b, group) => ({ id, title, start: at(a), end: at(b), group });
  const plan = { blocks: [blk('shop', 'Shopping', 9, 10, 'g'), blk('cook', 'Cooking', 11, 12, 'g'), blk('dinner', 'Dinner', 15, 16, 'g'), blk('other', 'Other errand', 13, 14, 'x')], notes: [] };
  const ask = await p.replan({ plan, change: { type: 'drag', blockId: 'shop', start: at(10) }, events: [] });
  assert.deepEqual(ask.question.items, ['shop', 'cook', 'dinner']);
  assert.equal(ask.blocks.find((b) => b.id === 'cook').start, at(11));
  const some = await p.replan({ plan: ask, change: null, events: [], answers: { confirm: ['cook'] } });
  assert.equal(some.question, null);
  assert.equal(some.blocks.find((b) => b.id === 'cook').moved, true);
  assert.equal(some.blocks.find((b) => b.id === 'dinner').start, at(15));
  assert.equal(some.blocks.find((b) => b.id === 'other').start, at(13));
  const no = await p.replan({ plan: ask, change: null, events: [], answers: { confirm: 'none' } });
  const again = await p.replan({ plan: no, change: { type: 'drag', blockId: 'shop', start: at(11) }, events: [] });
  assert.equal(again.question, null);
});

test('a drag that would push steps past the deadline is repaired by search and by the hybrid', async () => {
  const events = [{ id: 'e', title: 'Offsite', start: '2026-11-18T08:00:00.000Z', end: '2026-11-18T23:00:00.000Z' }];
  const input = { request: 'The demo is due next Friday, plan the prep', events, now: '2026-11-09T09:00:00.000Z', context: {} };
  for (const name of ['search', 'hybrid']) {
    const p = await load(name);
    const plan = await p.plan(input);
    assert.equal(plan.blocks.length, 3);
    const more = await p.replan({ plan, change: { type: 'more-time', blockId: plan.blocks[1].id, minutes: 60 }, events });
    const prod = more.blocks[1];
    assert.equal(Date.parse(prod.end) - Date.parse(prod.start), 180 * 60000);
    assert.ok(more.blocks.every((b) => Date.parse(b.end) <= Date.parse(plan.meta.deadline)));
  }
});

test('hybrid reads an unparsed request through an injected model and ignores a bad reply', async () => {
  const input = { request: 'Gym session please', events: [], now: '2026-11-09T09:00:00.000Z', context: {} };
  const ok = createHybrid({ model: { complete: async () => JSON.stringify({ minutes: 45, title: 'Gym' }) } });
  const r = await ok.plan(input);
  assert.equal(r.blocks.length, 1);
  assert.equal(Date.parse(r.blocks[0].end) - Date.parse(r.blocks[0].start), 45 * 60000);
  const bad = createHybrid({ model: { complete: async () => 'nope' } });
  assert.equal((await bad.plan(input)).blocks.length, 0);
});

test('results satisfy the owner contract', async () => {
  const p = enforce(await load('hybrid'));
  const r = await p.plan({ request: 'Find time to work out for half an hour', events: [], now: '2026-11-09T09:00:00.000Z', context: {} });
  assert.equal(r.blocks.length, 1);
});
