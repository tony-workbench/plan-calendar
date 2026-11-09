import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase, casePass } from '../benchmark/score.mjs';
import { validatePlan, checkResult } from '../benchmark/contract.mjs';

test('the same seed gives the same cases and another seed gives different ones', () => {
  const a = generate({ seed: 1, perCategory: 10 });
  assert.deepEqual(a, generate({ seed: 1, perCategory: 10 }));
  assert.notDeepEqual(a, generate({ seed: 2, perCategory: 10 }));
  assert.deepEqual([...new Set(a.map((c) => c.category))].sort(), ['basic', 'deadline', 'discovery', 'related']);
});

test('the contract flags overlaps and a missing notes array', () => {
  const ev = [{ id: 'e', title: 'x', start: '2026-11-09T10:00:00.000Z', end: '2026-11-09T11:00:00.000Z' }];
  const plan = { notes: [], blocks: [{ id: 'b', title: 'b', start: '2026-11-09T10:30:00.000Z', end: '2026-11-09T11:30:00.000Z' }] };
  assert.ok(validatePlan(plan, { events: ev }).violations.some((v) => v.code === 'overlap-event'));
  assert.ok(checkResult({ blocks: [] }).length > 0);
});

test('a planner that returns nothing is scored, not crashed, and does not pass', async () => {
  const empty = { plan: async () => ({ blocks: [], notes: [] }), replan: async () => ({ blocks: [], notes: [] }) };
  for (const k of generate({ seed: 1, perCategory: 2 })) {
    const r = await scoreCase(empty, k);
    assert.equal(typeof r.delivered, 'boolean');
    if (k.expect.blocks !== 0 && k.category === 'basic') assert.equal(casePass(r), false);
  }
});
