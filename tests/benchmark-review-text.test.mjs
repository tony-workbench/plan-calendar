import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('benchmark review record has no doubled words', () => {
  const text = readFileSync(new URL('../docs/benchmark-review.md', import.meta.url), 'utf8');
  const hits = [...text.matchAll(/\b([A-Za-z]+) \1\b/gi)].map((m) => m[0]);
  assert.deepEqual(hits, []);
});
