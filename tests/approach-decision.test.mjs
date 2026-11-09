import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../docs/approach-decision.md', import.meta.url), 'utf8');

test('the decision names hybrid-live with the owner numbers and gains', () => {
  assert.match(doc, /Best approach: \*\*hybrid-live\*\*/);
  for (const s of ['233 / 240', '190 / 240', '161 / 240', '89 / 240', '239 / 240', '+36 percentage points', '+26 percentage points']) assert.ok(doc.includes(s), s);
});

test('the decision records cost and what is not proven', () => {
  for (const s of ['one model call per request', '2.4 seconds', '0.6 cent', 'written by a model', '60 cases per situation', 'No real person']) assert.ok(doc.includes(s), s);
});

test('the record has no votes section and no vote placeholders', () => {
  assert.doesNotMatch(doc, /^## Votes/m);
  assert.doesNotMatch(doc, /not recorded/);
  assert.match(doc, /^## Decision$/m);
  assert.doesNotMatch(doc, /only a seat|seats' vote|approval vote/);
  const decision = doc.split(/^## Decision$/m)[1].split(/^## /m)[0];
  assert.match(decision, /The choice is voted by all eight seats in the roundtable round that promotes this record\./);
});

test('public-wording rate is stated the same way everywhere', () => {
  assert.doesNotMatch(doc, /99 to 100 percent/);
});

test('scorecard rates and intervals match the owner counts', () => {
  const wilson = (k, n) => {
    const z = 1.96, p = k / n, d = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / d;
    const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
    return [Math.round((c - h) * 100), Math.round((c + h) * 100)];
  };
  const owner = { 'hybrid-live': 233, hybrid: 190, 'gemini one-shot': 161, 'agent-live': 89 };
  for (const [name, k] of Object.entries(owner)) {
    const row = doc.split('## Earlier scorecard')[1].split('\n').find((l) => l.startsWith(`| ${name}`));
    assert.ok(row, name);
    const [lo, hi] = wilson(k, 240);
    assert.ok(row.includes(`${k} / 240`), name);
    assert.ok(row.includes(`${Math.round((k / 240) * 100)}% [${lo}-${hi}]`), name);
  }
});

test('the scorecard records 95 percent intervals and public-wording numbers', () => {
  for (const s of ['97% [94-99]', '79% [74-84]', '67% [61-73]', '37% [31-43]', '200 of 200', 'Public wording']) assert.ok(doc.includes(s), s);
});
