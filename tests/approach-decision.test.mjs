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

test('every seat has a vote line; only Kylon and Claude have voted', () => {
  const votes = doc.split('## Votes')[1];
  for (const seat of SEATS) {
    const line = votes.split('\n').find((l) => l.startsWith(`- ${seat}`));
    assert.ok(line, seat);
    assert.equal(/not recorded/.test(line), !['Kylon', 'Claude'].includes(seat), seat);
  }
});

test('the scorecard records 95 percent intervals and public-wording numbers', () => {
  for (const s of ['97% [94-99]', '79% [74-84]', '67% [61-73]', '37% [31-43]', '200 of 200', 'Public wording']) assert.ok(doc.includes(s), s);
});
