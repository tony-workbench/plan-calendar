import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function load() {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const window = {};
  vm.runInNewContext(script, { window, Date, Math, Object, Array, isNaN, String });
  return window.previewCalendar;
}

test('page has Day/Week controls, Undo, both block kinds and the test surface', () => {
  assert.match(html, /id="btn-day"[^>]*>Day</);
  assert.match(html, /id="btn-week"[^>]*>Week</);
  assert.match(html, /id="btn-undo"[^>]*disabled/);
  assert.match(html, /data-kind="fixed"/);
  assert.match(html, /data-kind="proposed"/);
  assert.match(html, /window\.previewCalendar\s*=/);
  assert.match(html, /pointerdown/);
});

test('demo data has fixed events and proposed blocks', () => {
  const s = load().getState();
  assert.ok(s.events.some((e) => e.kind === 'fixed'));
  assert.ok(s.events.some((e) => e.kind === 'proposed'));
  assert.equal(s.canUndo, false);
});

test('moving a proposed block snaps to 15 minutes, crosses days, and undo restores', () => {
  const cal = load();
  const before = cal.getState();
  const p = before.events.find((e) => e.id === 'p1');
  assert.equal(cal.moveBlock('p1', '2026-11-11T08:07:00.000Z'), true);
  const moved = cal.getState();
  const m = moved.events.find((e) => e.id === 'p1');
  assert.equal(m.start, '2026-11-11T08:00:00.000Z');
  assert.equal(Date.parse(m.end) - Date.parse(m.start), Date.parse(p.end) - Date.parse(p.start));
  assert.equal(moved.canUndo, true);
  assert.equal(cal.undo(), true);
  assert.deepEqual(cal.getState().events, before.events);
  assert.equal(cal.getState().canUndo, false);
  assert.equal(cal.undo(), false);
});

test('fixed events cannot move and add no history; one step per change', () => {
  const cal = load();
  const before = cal.getState().events;
  assert.equal(cal.moveBlock('f1', '2026-11-10T09:00:00.000Z'), false);
  assert.deepEqual(cal.getState().events, before);
  assert.equal(cal.getState().canUndo, false);
  cal.moveBlock('p1', '2026-11-09T19:00:00.000Z');
  cal.moveBlock('p1', '2026-11-09T20:00:00.000Z');
  cal.undo();
  assert.equal(cal.getState().events.find((e) => e.id === 'p1').start, '2026-11-09T19:00:00.000Z');
  cal.undo();
  assert.deepEqual(cal.getState().events, before);
});

test('setView switches between day and week', () => {
  const cal = load();
  assert.equal(cal.getState().view, 'week');
  cal.setView('day');
  assert.equal(cal.getState().view, 'day');
  assert.equal(cal.setView('month'), false);
});
