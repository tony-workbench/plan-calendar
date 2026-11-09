import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange } from '../src/arrange/arrange.mjs';
import { overlaps, validatePlan } from '../benchmark/contract.mjs';

const intent = { title: 'Work out', durationMin: 30 };
const now = '2030-01-07T08:00:00.000Z'; // a Monday, before working hours
const ev = (id, s, e) => ({ id, title: id, start: `2030-01-07T${s}:00.000Z`, end: `2030-01-07T${e}:00.000Z`, fixed: true });
const mins = (b) => (Date.parse(b.end) - Date.parse(b.start)) / 60000;

test('empty calendar: exactly one 30-minute proposed block', () => {
  const r = arrange({ intent, events: [], now });
  assert.equal(r.blocks.length, 1);
  assert.equal(mins(r.blocks[0]), 30);
  assert.equal(r.blocks[0].kind, 'proposed');
  assert.equal(r.blocks[0].start, '2030-01-07T09:00:00.000Z');
});

test('lands in a free gap when the first slot is busy, touching edges included', () => {
  const events = [ev('a', '08:00', '10:00'), ev('b', '10:30', '12:00'), ev('c', '12:00', '18:00')];
  const r = arrange({ intent, events, now });
  assert.equal(r.blocks.length, 1);
  for (const e of events) assert.equal(overlaps(r.blocks[0], e), false);
  assert.ok(Date.parse(r.blocks[0].start) >= Date.parse(now));
  assert.ok(Date.parse(r.blocks[0].start) >= Date.parse('2030-01-08T09:00:00.000Z'), 'gaps are too small for a buffer, so next day');
  const gap = arrange({ intent, events: [ev('a', '09:00', '10:00'), ev('b', '11:00', '18:00')], now });
  assert.equal(gap.blocks[0].start, '2030-01-07T10:10:00.000Z');
  assert.equal(overlaps(gap.blocks[0], ev('b', '11:00', '18:00')), false);
});

test('busy days are skipped and fixed events keep their times', () => {
  const events = [ev('a', '09:00', '18:00'), ev('z', '07:00', '08:30')];
  const before = JSON.stringify(events);
  const r = arrange({ intent, events, now });
  assert.equal(JSON.stringify(events), before);
  assert.equal(JSON.stringify(r.events), before);
  assert.notEqual(r.events, events);
  for (const e of events) {
    const kept = r.events.find((x) => x.id === e.id);
    assert.equal(kept.start, e.start);
    assert.equal(kept.end, e.end);
    assert.equal(overlaps(r.blocks[0], e), false);
  }
  assert.ok(r.blocks[0].start.startsWith('2030-01-08'));
});

test('respects now inside working hours', () => {
  const r = arrange({ intent, events: [], now: '2030-01-07T13:02:00.000Z' });
  assert.equal(r.blocks[0].start, '2030-01-07T13:05:00.000Z');
});

test('fully booked window gives no block and a note', () => {
  const events = [];
  const day = (d) => `2030-01-${String(d).padStart(2, '0')}T00:00:00.000Z`;
  for (let d = 7; d < 10; d++) events.push({ id: `d${d}`, title: 'x', start: day(d), end: day(d + 1) });
  const r = arrange({ intent, events, now, windowDays: 3 });
  assert.equal(r.blocks.length, 0);
  assert.ok(r.notes.length >= 1);
  assert.equal(JSON.stringify(r.events), JSON.stringify(events));
});

test('deterministic', () => {
  const events = [ev('a', '09:00', '10:00')];
  assert.equal(JSON.stringify(arrange({ intent, events, now })), JSON.stringify(arrange({ intent, events, now })));
});

test('result passes validatePlan', () => {
  const events = [ev('a', '09:00', '10:00'), ev('b', '10:30', '11:00')];
  const r = arrange({ intent, events, now });
  const v = validatePlan({ blocks: r.blocks, notes: r.notes }, { events, eventsBefore: events });
  assert.deepEqual(v, { ok: true, violations: [] });
});
