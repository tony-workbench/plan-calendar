import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runDemo, render } from '../src/demo.mjs';

const ms = (v) => Date.parse(v);
const demo = await runDemo();

test('the demo uses the hybrid planner and stays offline, even with a key present', async () => {
  assert.equal(demo.approach, 'hybrid');
  assert.equal(demo.networkCalls, 0);
  const before = process.env.GEMINI_API_KEY;
  const neutral = 'x';
  process.env.GEMINI_API_KEY = neutral;
  try { assert.equal((await runDemo()).networkCalls, 0); } finally { if (before === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before; }
  const src = readFileSync(new URL('../src/demo.mjs', import.meta.url), 'utf8');
  assert.ok(!/googleapis|gemini\.mjs|agent-live/i.test(src));
});

test('situation 1: basic arrangement produces one scheduled block clear of existing events', () => {
  const { result, check, events } = demo.basic;
  assert.equal(result.blocks.length, 1);
  assert.equal(ms(result.blocks[0].end) - ms(result.blocks[0].start), 30 * 60000);
  assert.equal(check.ok, true, JSON.stringify(check.violations));
  assert.ok(events.length > 0);
});

test('situation 2: deadline back-planning makes ordered steps before the deadline and dragging moves dependents only on overlap', () => {
  const d = demo.deadline;
  assert.ok(d.plan.blocks.length >= 2);
  const steps = [...d.plan.blocks].sort((a, b) => a.step - b.step);
  for (let i = 0; i < steps.length; i++) {
    assert.ok(ms(steps[i].end) <= ms(d.deadline));
    if (i) assert.ok(ms(steps[i].start) >= ms(steps[i - 1].end));
  }
  assert.deepEqual(d.smallDrag.moved, []);
  assert.equal(d.smallDrag.check.ok, true, JSON.stringify(d.smallDrag.check.violations));
  assert.notEqual(d.smallDrag.result.blocks[0].start, steps[0].start);
  assert.ok(d.bigDrag.moved.includes(steps[1].id));
  assert.ok(!d.bigDrag.moved.includes(steps[0].id));
  assert.equal(d.bigDrag.check.ok, true, JSON.stringify(d.bigDrag.check.violations));
});

test('situation 3: discovery shows a few candidates with one light prompt and no model call', () => {
  const { result, ignored } = demo.discovery;
  assert.ok(result.blocks.length >= 1 && result.blocks.length <= 3);
  assert.ok(result.blocks.every((b) => b.kind === 'candidate' && b.tentative && b.title.endsWith('?') && b.place && b.reason && b.source));
  assert.ok(!result.blocks.some((b) => /Street food fair|Mystery gig|Maker market/.test(b.title)));
  assert.ok(result.question?.text);
  assert.equal(demo.networkCalls, 0);
  assert.equal(ignored.blocks.length, 0);
  assert.equal(ignored.question, undefined);
});

test('situation 4: related items get one merged question, a partial answer is honored and a refusal is remembered', () => {
  const r = demo.related;
  assert.deepEqual(r.dragged.question.items, ['shop', 'cook', 'dinner']);
  assert.match(r.dragged.question.text, /Shopping, Cooking and Dinner/);
  const at = (res, id) => res.blocks.find((b) => b.id === id);
  assert.deepEqual(r.partial.blocks.filter((b) => b.moved).map((b) => b.id), ['cook']);
  assert.equal(at(r.partial, 'dinner').start, at(r.plan, 'dinner').start);
  assert.equal(at(r.partial, 'other').start, at(r.plan, 'other').start);
  assert.equal(r.partial.question, undefined);
  assert.equal(at(r.refused, 'cook').start, at(r.plan, 'cook').start);
  assert.equal(r.askedAfterRefusal, false);
  assert.equal(r.questions, 2);
});

test('the script entrypoint runs offline and prints all four situations', () => {
  const out = execFileSync(process.execPath, [new URL('../src/demo.mjs', import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '' } });
  for (const h of ['1. Basic arrangement', '2. Deadline back-planning', '3. Proactive activity discovery', '4. Related-item adjustment', 'Network calls: 0']) assert.ok(out.includes(h), h);
  assert.equal(out, render(demo) + '\n');
});
