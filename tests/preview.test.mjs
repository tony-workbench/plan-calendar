import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreview, renderPreviewHtml } from '../src/preview/preview.mjs';
import { createFakeCalendarAdapter, createGuardedAdapter } from '../src/calendar/adapter.mjs';

const events = [
  { id: 'e1', title: 'Standup', start: '2026-11-09T09:00:00', end: '2026-11-09T09:30:00', fixed: true },
  { id: 'e2', title: 'Lunch <b>', start: '2026-11-09T12:00:00', end: '2026-11-09T13:00:00', fixed: true },
];
const blocks = [{ id: 'b1', title: 'Workout', start: '2026-11-09T10:00:00', end: '2026-11-09T10:30:00' }];

test('preview has proposed block and all existing events, sorted, no mutation', () => {
  const snap = JSON.stringify({ events, blocks });
  const p = buildPreview({ events, blocks });
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items.map((i) => i.id), ['e1', 'b1', 'e2']);
  assert.equal(p.items.find((i) => i.id === 'b1').source, 'proposed');
  assert.equal(p.days.length, 1);
  assert.equal(JSON.stringify({ events, blocks }), snap);
});

test('preview dedupes by id', () => {
  const p = buildPreview({ events: [...events, events[0]], blocks: [...blocks, blocks[0]] });
  assert.equal(p.items.length, 3);
});

test('preview renders escaped HTML', () => {
  const html = renderPreviewHtml(buildPreview({ events, blocks }));
  assert.match(html, /Workout/);
  assert.match(html, /Lunch &lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test('guarded adapter throws on writes unless confirmed', async () => {
  const fake = createFakeCalendarAdapter(events);
  const g = createGuardedAdapter(fake);
  await assert.rejects(() => g.createEvent(blocks[0]));
  await assert.rejects(() => g.updateEvent('e1', {}));
  await assert.rejects(() => g.deleteEvent('e1'));
  assert.deepEqual(fake.calls, []);
  assert.equal((await g.listEvents()).length, 2);
  const ok = createGuardedAdapter(fake, { confirm: () => true });
  await ok.createEvent(blocks[0]);
  assert.equal(fake.calls.at(-1).method, 'createEvent');
});
