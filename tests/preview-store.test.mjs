import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/calendar/store.mjs';

const make = () =>
  createStore({
    fixed: [{ id: 'f1', title: 'Standup', start: '2026-11-10T09:00:00.000Z', end: '2026-11-10T09:30:00.000Z' }],
    proposed: [{ id: 'p1', title: 'Workout', start: '2026-11-10T12:00:00.000Z', end: '2026-11-10T12:30:00.000Z' }],
  });
const byId = (s, id) => s.getState().items.find((i) => i.id === id);

test('state holds both kinds, tagged', () => {
  const s = make();
  assert.equal(byId(s, 'f1').kind, 'fixed');
  assert.equal(byId(s, 'p1').kind, 'proposed');
});

test('fixed events cannot be moved', () => {
  const s = make();
  assert.throws(() => s.moveBlock('f1', '2026-11-10T10:00:00.000Z'));
  assert.throws(() => s.moveBlock('nope', '2026-11-10T10:00:00.000Z'));
  assert.equal(byId(s, 'f1').start, '2026-11-10T09:00:00.000Z');
  assert.equal(s.canUndo(), false);
});

test('dragging a proposed block changes only its start and end', () => {
  const s = make();
  const fixedBefore = byId(s, 'f1');
  s.moveBlock('p1', '2026-11-10T15:00:00.000Z');
  const p = byId(s, 'p1');
  assert.equal(p.start, '2026-11-10T15:00:00.000Z');
  assert.equal(p.end, '2026-11-10T15:30:00.000Z');
  assert.equal(p.title, 'Workout');
  assert.equal(p.kind, 'proposed');
  assert.deepEqual(byId(s, 'f1'), fixedBefore);
});

test('a move that changes nothing creates no history', () => {
  const s = make();
  s.moveBlock('p1', '2026-11-10T12:00:00.000Z');
  assert.equal(s.canUndo(), false);
});

test('undo restores the exact earlier state', () => {
  const s = make();
  const before = s.getState();
  s.moveBlock('p1', '2026-11-10T15:00:00.000Z');
  assert.equal(s.canUndo(), true);
  s.undo();
  assert.deepEqual(s.getState(), before);
  assert.equal(s.canUndo(), false);
});

test('several undos step back in order', () => {
  const s = make();
  const s0 = s.getState();
  s.moveBlock('p1', '2026-11-10T13:00:00.000Z');
  const s1 = s.getState();
  s.moveBlock('p1', '2026-11-10T14:00:00.000Z');
  s.undo();
  assert.deepEqual(s.getState(), s1);
  s.undo();
  assert.deepEqual(s.getState(), s0);
});

test('undo on empty history is a no-op', () => {
  const s = make();
  const before = s.getState();
  s.undo();
  assert.deepEqual(s.getState(), before);
});

test('a snapshot is not mutated by later moves', () => {
  const s = make();
  const snap = s.getState();
  const copy = JSON.parse(JSON.stringify(snap));
  s.moveBlock('p1', '2026-11-10T15:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), copy);
  assert.throws(() => {
    snap.items[0].start = 'x';
  });
});
