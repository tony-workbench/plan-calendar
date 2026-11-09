import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAsk } from '../src/ask/ask.mjs';
import { createFakeCalendarAdapter } from '../src/calendar/adapter.mjs';

const events = [
  { id: 'e1', title: 'Standup', start: '2026-11-09T09:00:00', end: '2026-11-09T09:30:00', fixed: true },
  { id: 'e2', title: 'Lunch', start: '2026-11-09T12:00:00', end: '2026-11-09T13:00:00', fixed: true },
];
const now = new Date('2026-11-09T08:00:00');

const parse = (text) => ({ kind: 'task', title: 'Workout', durationMin: 30 });
const arrange = ({ intent, events }) => ({
  blocks: [{ id: 'b1', title: intent.title, start: '2026-11-09T10:00:00', end: '2026-11-09T10:30:00' }],
  events,
  notes: [],
});

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

test('handleAsk returns preview-only with one workout block and never writes', async () => {
  const adapter = createFakeCalendarAdapter(events);
  const before = JSON.stringify(events);
  const res = await handleAsk({ text: 'find time to work out for half an hour', adapter, now, parse, arrange });
  assert.equal(res.status, 'preview-only');
  const proposed = res.preview.items.filter((i) => i.source === 'proposed');
  assert.equal(proposed.length, 1);
  assert.equal((new Date(proposed[0].end) - new Date(proposed[0].start)) / 60000, 30);
  for (const e of res.preview.items.filter((i) => i.source === 'existing')) {
    assert.equal(overlaps(proposed[0], e), false);
  }
  assert.equal(res.preview.items.length, 3);
  assert.equal(new Set(res.preview.items.map((i) => i.id)).size, 3);
  for (const e of events) {
    const p = res.preview.items.find((i) => i.id === e.id);
    assert.equal(p.start, e.start);
    assert.equal(p.end, e.end);
  }
  assert.equal(JSON.stringify(events), before);
  assert.deepEqual(adapter.calls.map((c) => c.method), ['listEvents']);
});

test('real parse/arrange modules (when present) also stay read-only', async (t) => {
  let parseMod, arrangeMod;
  try {
    parseMod = await import('../src/arrange/parse.mjs');
    arrangeMod = await import('../src/arrange/arrange.mjs');
  } catch {
    return t.skip('arrange modules not present');
  }
  const adapter = createFakeCalendarAdapter(events);
  const res = await handleAsk({ text: 'find time to work out for half an hour', adapter, now });
  assert.equal(res.status, 'preview-only');
  assert.ok(parseMod.parseRequest && arrangeMod.arrange);
  assert.deepEqual(adapter.calls.map((c) => c.method), ['listEvents']);
});

// ---- Real parse -> arrange -> preview chain (no stubs) ----
const T = (s) => Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`);
const real = (evs, nowVal) => {
  const adapter = createFakeCalendarAdapter(evs);
  return handleAsk({ text: 'find time to work out for half an hour', adapter, now: nowVal }).then((res) => ({ res, adapter }));
};

for (const [label, evs, nowVal] of [
  ['zone-less fixtures', events, '2026-11-09T08:00:00'],
  ['UTC fixtures', events.map((e) => ({ ...e, start: `${e.start}Z`, end: `${e.end}Z` })), new Date('2026-11-09T08:00:00Z')],
  ['mixed zone-less and offset', [
    { id: 'e1', title: 'Standup', start: '2026-11-09T09:00:00', end: '2026-11-09T09:30:00', fixed: true },
    { id: 'e2', title: 'Block', start: '2026-11-09T09:30:00Z', end: '2026-11-09T12:00:00Z', fixed: true },
    { id: 'e3', title: 'Call', start: '2026-11-09T04:00:00-08:00', end: '2026-11-09T05:00:00-08:00', fixed: true },
  ], '2026-11-09T08:00:00Z'],
]) {
  test(`real chain: one 30-minute workout, no overlap, fixed events unchanged (${label})`, async () => {
    const before = JSON.stringify(evs);
    const { res, adapter } = await real(evs, nowVal);
    assert.equal(res.status, 'preview-only');
    const proposed = res.preview.items.filter((i) => i.source === 'proposed');
    assert.equal(proposed.length, 1);
    assert.match(proposed[0].title, /workout/i);
    assert.equal((T(proposed[0].end) - T(proposed[0].start)) / 60000, 30);
    assert.ok(T(proposed[0].start) >= T(typeof nowVal === 'string' ? nowVal : nowVal.toISOString()));
    const existing = res.preview.items.filter((i) => i.source === 'existing');
    assert.equal(existing.length, evs.length);
    for (const e of existing) assert.equal(T(proposed[0].start) < T(e.end) && T(e.start) < T(proposed[0].end), false);
    for (const e of evs) {
      const p = existing.find((i) => i.id === e.id);
      assert.ok(p && p.start === e.start && p.end === e.end && p.fixed === true);
    }
    assert.equal(res.preview.items.length, evs.length + 1);
    assert.equal(new Set(res.preview.items.map((i) => i.id)).size, evs.length + 1);
    assert.equal(JSON.stringify(evs), before);
    assert.deepEqual(adapter.calls.map((c) => c.method), ['listEvents']);
  });
}

test('real chain: write methods are never called', async () => {
  const { adapter } = await real(events, '2026-11-09T08:00:00');
  for (const m of ['createEvent', 'updateEvent', 'deleteEvent']) assert.equal(adapter.calls.some((c) => c.method === m), false);
});
