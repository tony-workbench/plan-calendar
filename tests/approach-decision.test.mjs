import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../docs/approach-decision.md', import.meta.url), 'utf8');
const SEATS = ['Claude', 'AdaL', 'Kylon', 'Prelint', 'AskTheW', 'Masky', 'n8n', 'Celesto'];

test('the decision names hybrid-live with the owner numbers and gains', () => {
  assert.match(doc, /Best approach: \*\*hybrid-live\*\*/);
  for (const s of ['233 / 240', '190 / 240', '161 / 240', '89 / 240', '+30 percentage points', '+18 percentage points']) assert.ok(doc.includes(s), s);
});

test('the decision records cost and what is not proven', () => {
  for (const s of ['one model call per request', '2.4 seconds', '0.6 cent', 'written by a model', '60 cases per situation', 'No real person']) assert.ok(doc.includes(s), s);
});

test('every seat has a vote line; no seat other than the author has vote text', () => {
  const votes = doc.split('## Votes')[1];
  const AUTHOR = 'Kylon';
  for (const seat of SEATS) {
    const line = votes.split('\n').find((l) => l.startsWith(`- ${seat}`));
    assert.ok(line, seat);
    if (seat !== AUTHOR) assert.match(line, new RegExp(`^- ${seat}: not recorded\\. ${seat} has not added its own text\\.$`), seat);
  }
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
    const row = doc.split('\n').find((l) => l.startsWith(`| ${name}`));
    assert.ok(row, name);
    const [lo, hi] = wilson(k, 240);
    assert.ok(row.includes(`${k} / 240`), name);
    assert.ok(row.includes(`${Math.round((k / 240) * 100)}% [${lo}-${hi}]`), name);
  }
});

test('the choice is marked proposed while seats have not voted', () => {
  const votes = doc.split('## Votes')[1];
  const pending = SEATS.filter((seat) => /not recorded/.test(votes.split('\n').find((l) => l.startsWith(`- ${seat}`)) ?? ''));
  if (pending.length) {
    assert.match(doc, /## Decision \(proposed\)/);
    assert.match(doc, /Status: proposed, not final/);
    assert.match(doc, /Best approach: \*\*hybrid-live\*\* \(proposed/);
  }
});

test('the scorecard records 95 percent intervals and public-wording numbers', () => {
  for (const s of ['97% [94-99]', '79% [74-84]', '67% [61-73]', '37% [31-43]', '200 of 200', 'Public wording']) assert.ok(doc.includes(s), s);
});
