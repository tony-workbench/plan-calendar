import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPlanner, checkResult, enforce, validatePlan } from '../src/planner/interface.mjs';
import { listApproaches, loadAll, loadApproach } from '../src/planner/registry.mjs';

const t = (s) => `2026-11-10T${s}:00.000Z`;
const block = (id, from, to, extra = {}) => ({ id, title: id, start: t(from), end: t(to), kind: 'proposed', ...extra });
const event = (id, from, to) => ({ id, title: id, start: t(from), end: t(to) });
const codes = (r) => r.violations.map((v) => v.code);

test('assertPlanner requires plan and replan', () => {
  assert.throws(() => assertPlanner({ plan() {} }), /replan/);
  assert.throws(() => assertPlanner(null), TypeError);
  assert.ok(assertPlanner({ plan() {}, replan() {} }));
});

test('enforce rejects results that break the interface', async () => {
  const bad = enforce({ plan: () => ({ blocks: 'nope', notes: [] }), replan: () => ({ blocks: [], notes: [] }) });
  await assert.rejects(bad.plan({}), /interface/);
  assert.ok(await bad.replan({}));
  assert.ok(checkResult({ blocks: [block('a', '10:00', '09:00')], notes: [] }).length > 0);
  assert.ok(checkResult({ blocks: [block('a', '09:00', '10:00')], notes: [], question: { text: '' , items: [] } }).length > 0);
});

test('validatePlan accepts a clean plan', () => {
  const plan = { blocks: [block('a', '09:00', '10:00')], notes: [] };
  assert.deepEqual(validatePlan(plan, { events: [event('e', '10:00', '11:00')] }), { ok: true, violations: [] });
});

test('validatePlan flags overlap with a fixed event', () => {
  const plan = { blocks: [block('a', '09:30', '10:30')], notes: [] };
  assert.deepEqual(codes(validatePlan(plan, { events: [event('e', '10:00', '11:00')] })), ['overlap-event']);
});

test('validatePlan flags broken step order and dependencies', () => {
  const plan = { blocks: [block('a', '12:00', '13:00', { step: 1 }), block('b', '09:00', '10:00', { step: 2, dependsOn: ['a'] })], notes: [] };
  assert.ok(codes(validatePlan(plan)).includes('order'));
});

test('validatePlan flags a missed deadline', () => {
  const plan = { blocks: [block('a', '09:00', '10:00')], notes: [] };
  assert.deepEqual(codes(validatePlan(plan, { deadline: t('09:30') })), ['deadline']);
  assert.deepEqual(codes(validatePlan({ ...plan, meta: { deadline: t('09:30') } })), ['deadline']);
});

test('validatePlan flags moved fixed events and moved unrelated blocks', () => {
  const before = { blocks: [block('a', '09:00', '10:00'), block('b', '11:00', '12:00')] };
  const after = { blocks: [block('a', '09:30', '10:30'), block('b', '13:00', '14:00')], notes: [] };
  const r = validatePlan(after, { before, allowedMoves: ['a'], events: [event('e', '15:00', '16:00')], eventsBefore: [event('e', '14:00', '15:00')] });
  assert.deepEqual(codes(r).sort(), ['moved-event', 'moved-unrelated']);
  assert.equal(r.violations.find((v) => v.code === 'moved-unrelated').block, 'b');
});

test('validatePlan flags overlapping blocks but not tentative candidates', () => {
  const clash = { blocks: [block('a', '09:00', '10:00'), block('b', '09:30', '10:30')], notes: [] };
  assert.deepEqual(codes(validatePlan(clash)), ['overlap-block']);
  const alts = { blocks: [block('a', '09:00', '10:00', { kind: 'candidate' }), block('b', '09:30', '10:30', { kind: 'candidate' })], notes: [] };
  assert.equal(validatePlan(alts).ok, true);
});

test('registry skips missing approaches and loads only valid ones', async () => {
  assert.ok(listApproaches().includes('rules'));
  assert.equal(await loadApproach('does-not-exist'), null);
  assert.equal(await loadApproach('../interface'), null);
  const { planners, skipped } = await loadAll(['rules', 'does-not-exist']);
  assert.deepEqual([...planners.keys()], ['rules']);
  assert.deepEqual(skipped, [{ name: 'does-not-exist', reason: 'missing' }]);
});
