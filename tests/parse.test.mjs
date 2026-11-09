import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRequest } from '../src/arrange/parse.mjs';

const now = new Date('2026-11-09T08:00:00Z');

test('half-hour workout gives exactly one 30-minute workout intent', () => {
  const r = parseRequest('find time to work out for half an hour', { now });
  assert.deepEqual(r, { kind: 'basic-arrangement', activity: 'workout', title: 'Workout', durationMin: 30 });
});

test('duration phrasings', () => {
  const d = (s) => parseRequest(s, { now }).durationMin;
  assert.equal(d('Find time to work out for 30 minutes'), 30);
  assert.equal(d('find time to work out for an hour'), 60);
  assert.equal(d('find time to work out for 1.5 hours'), 90);
  assert.equal(d('find time to work out for 45 min'), 45);
  assert.equal(d('find time to work out'), 30);
});

test('case and punctuation do not matter', () => {
  const r = parseRequest('  FIND TIME to Work-out, for HALF an hour!!! ', { now });
  assert.equal(r.kind, 'basic-arrangement');
  assert.equal(r.durationMin, 30);
});

test('unrelated text is unsupported', () => {
  assert.deepEqual(parseRequest('what is the weather', { now }), { kind: 'unsupported' });
  assert.deepEqual(parseRequest('', { now }), { kind: 'unsupported' });
  assert.deepEqual(parseRequest(undefined, { now }), { kind: 'unsupported' });
});

test('parser is offline and never touches a calendar adapter', () => {
  const src = readFileSync(new URL('../src/arrange/parse.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bimport\b|\brequire\b|fetch\(|https?:|calendar\./i);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network used'); };
  try {
    assert.equal(parseRequest('find time to work out for half an hour', { now }).durationMin, 30);
  } finally {
    globalThis.fetch = realFetch;
  }
});
