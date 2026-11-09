import test from 'node:test';
import assert from 'node:assert/strict';
import { weekDays, layoutDay, layoutWeek, pxToStart, dayFromX, kindStyle } from '../src/calendar/layout.mjs';

const opts = { startHour: 8, endHour: 18, pxPerHour: 60 };
const D = '2026-11-11'; // Wednesday

test('week starts on Monday', () => {
  const days = weekDays(D);
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-11-09');
  assert.equal(days[6], '2026-11-15');
  assert.equal(weekDays('2026-11-15')[0], '2026-11-09'); // Sunday
  assert.equal(weekDays('2026-11-09')[0], '2026-11-09');
});

test('vertical position and height', () => {
  const [r] = layoutDay([{ id: 'a', kind: 'fixed', start: `${D}T09:30`, end: `${D}T10:30` }], D, opts);
  assert.equal(r.top, 90);
  assert.equal(r.height, 60);
  assert.equal(r.kind, 'fixed');
  assert.equal(r.col, 0);
  assert.equal(r.cols, 1);
});

test('overlapping items get side-by-side columns', () => {
  const items = [
    { id: 'a', kind: 'fixed', start: `${D}T09:00`, end: `${D}T11:00` },
    { id: 'b', kind: 'proposed', start: `${D}T10:00`, end: `${D}T12:00` },
    { id: 'c', kind: 'fixed', start: `${D}T14:00`, end: `${D}T15:00` },
  ];
  const r = Object.fromEntries(layoutDay(items, D, opts).map((x) => [x.id, x]));
  assert.equal(r.a.cols, 2);
  assert.equal(r.b.cols, 2);
  assert.notEqual(r.a.col, r.b.col);
  assert.equal(r.c.cols, 1);
  assert.equal(r.b.kind, 'proposed');
});

test('items are clipped to visible hours and other days are skipped', () => {
  const items = [
    { id: 'early', kind: 'fixed', start: `${D}T06:00`, end: `${D}T09:00` },
    { id: 'late', kind: 'proposed', start: `${D}T17:00`, end: `${D}T20:00` },
    { id: 'out', kind: 'fixed', start: `${D}T19:00`, end: `${D}T20:00` },
    { id: 'other', kind: 'fixed', start: '2026-11-12T09:00', end: '2026-11-12T10:00' },
  ];
  const r = Object.fromEntries(layoutDay(items, D, opts).map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(r).sort(), ['early', 'late']);
  assert.equal(r.early.top, 0);
  assert.equal(r.early.height, 60);
  assert.equal(r.late.top, 540);
  assert.equal(r.late.height, 60);
});

test('layoutWeek maps each day key to its layout', () => {
  const items = [{ id: 'a', kind: 'fixed', start: '2026-11-12T09:00', end: '2026-11-12T10:00' }];
  const w = layoutWeek(items, D, opts);
  assert.equal(Object.keys(w).length, 7);
  assert.equal(w['2026-11-12'].length, 1);
  assert.equal(w['2026-11-11'].length, 0);
});

test('drop position snaps to 15 minutes', () => {
  assert.equal(pxToStart(D, 0, opts), `${D}T08:00:00`);
  assert.equal(pxToStart(D, 67, opts), `${D}T09:00:00`); // 67 min -> 60
  assert.equal(pxToStart(D, 68, opts), `${D}T09:15:00`); // 68 min -> 75
  assert.equal(pxToStart(D, 90, opts), `${D}T09:30:00`);
  assert.equal(pxToStart(D, 30, opts, 30), `${D}T08:30:00`);
});

test('day from x in the week', () => {
  assert.equal(dayFromX(0, 100, D), '2026-11-09');
  assert.equal(dayFromX(250, 100, D), '2026-11-11');
  assert.equal(dayFromX(699, 100, D), '2026-11-15');
  assert.equal(dayFromX(5000, 100, D), '2026-11-15');
  assert.equal(dayFromX(-5, 100, D), '2026-11-09');
});

test('fixed and proposed look different', () => {
  const f = kindStyle('fixed');
  const p = kindStyle('proposed');
  assert.notEqual(f.className, p.className);
  assert.notDeepEqual(f.style, p.style);
  assert.equal(f.style.borderStyle, 'solid');
  assert.equal(p.style.borderStyle, 'dashed');
});
