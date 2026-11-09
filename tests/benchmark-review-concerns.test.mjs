import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate } from '../benchmark/gen.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const doc = read('../docs/benchmark-review.md');
const score = read('../benchmark/score.mjs');
const m = doc.match(/^## Open Prelint concerns that touch the benchmark\n([\s\S]*?)(?=^## )/m);
const agreed = doc.match(/^## Agreed changes\n([\s\S]*)$/m)[1];
const cases = ['basic', 'deadline', 'discovery', 'related'].flatMap((c) => generate({ seed: 1, perCategory: 200 }).filter((k) => k.category === c));

test('the record says whether the benchmark is fair for the open concerns', () => {
  assert.ok(m, 'concerns section exists');
  for (const c of ['C3', 'C4', 'C5', 'C6', 'C7', 'C10', 'C11']) assert.match(m[1], new RegExp(`\\b${c}\\b`), c);
});

test('every benchmark concern C4 to C7 has a numbered change in the agreed list', () => {
  for (const c of ['C4', 'C5', 'C6', 'C7']) assert.match(agreed, new RegExp(`^\\d+\\. \\(${c}\\)`, 'm'), c);
});

test('C3 and C10 name where they are tracked', () => {
  assert.match(m[1], /C3[^\n]*handed to[^\n]*(UI|preview)/);
  assert.match(m[1], /C10[^\n]*handed to[^\n]*model/);
});

test('the claims in the concerns section reproduce from the generated cases', () => {
  assert.ok(cases.length > 100);
  assert.ok(cases.every((k) => !/timeZone|tz/i.test(JSON.stringify(k))), 'C4: no case has a time zone');
  const dl = cases.filter((k) => k.category === 'deadline');
  assert.ok(dl.length > 0 && dl.every((k) => /this Friday|next (Wednesday|Thursday|Friday)/.test(k.request)), 'C5: every deadline request names a day');
  assert.ok(dl.every((k) => k.expect.minSteps === 2), 'C5: one minimum step count for every task');
  assert.ok(cases.every((k) => !/ignor|unanswered/i.test(k.sub || '')), 'C7: no ignore-then-drag sub-type');
  assert.match(score, /dl - 3 \* 3600000/, 'C6: drag target keeps the deadline reachable');
  assert.ok(!/answers: undefined|answers: \{\}/.test(score), 'C7: refusal only after an answer');
});

test('the record does not vote for the seats that have not voted', () => {
  assert.match(m[1], /not votes of other seats/);
});
