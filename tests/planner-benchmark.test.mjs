import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITUATIONS, runBenchmark } from '../src/planner/benchmark.mjs';
import { loadAll } from '../src/planner/registry.mjs';

test('the benchmark covers the four situations and reports numbers', async () => {
  const { planners } = await loadAll();
  assert.ok(planners.size >= 1);
  assert.equal(SITUATIONS.length, 4);
  for (const [name, planner] of planners) {
    const r = await runBenchmark(planner);
    assert.deepEqual(r.situations.map((s) => s.id), ['basic', 'deadline', 'discovery', 'related'], name);
    for (const s of r.situations) {
      for (const k of ['violations', 'questions', 'moved', 'ms']) assert.equal(typeof s[k], 'number', `${name} ${s.id} ${k}`);
      assert.equal(typeof s.pass, 'boolean');
    }
    assert.equal(r.totals.total, 4);
  }
});

test('the benchmark is deterministic apart from timing', async () => {
  const { planners } = await loadAll();
  const strip = (r) => r.situations.map(({ ms, ...rest }) => rest);
  const [planner] = planners.values();
  assert.deepEqual(strip(await runBenchmark(planner)), strip(await runBenchmark(planner)));
});

test('a planner that breaks the interface or throws fails its situations', async () => {
  const broken = { plan: () => ({ blocks: [{ id: 'x' }], notes: [] }), replan: () => { throw new Error('boom'); } };
  const r = await runBenchmark(broken);
  assert.equal(r.totals.passed, 0);
  assert.ok(r.situations.every((s) => s.failures.length > 0));
});

test('a planner that ignores fixed events is caught as a constraint violation', async () => {
  const careless = {
    plan: () => ({ blocks: [{ id: 'b', title: 'Workout', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T09:30:00.000Z', kind: 'proposed' }], notes: [] }),
    replan: () => ({ blocks: [], notes: [] }),
  };
  const r = await runBenchmark(careless);
  const basic = r.situations.find((s) => s.id === 'basic');
  assert.equal(basic.pass, false);
  assert.ok(basic.violations >= 1);
});
