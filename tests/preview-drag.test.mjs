import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStore } from '../src/calendar/store.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const PX_H = 48;
const COL_W = 100;

// Runs the shipped page script against a minimal fake DOM so the real pointer handlers execute.
function boot() {
  const handlers = {};
  const els = {};
  const el = (id) => (els[id] ||= {
    id,
    innerHTML: '',
    textContent: '',
    disabled: false,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { (handlers[id + ':' + type] ||= []).push(fn); },
  });
  const document = {
    getElementById: el,
    addEventListener(type, fn) { (handlers['doc:' + type] ||= []).push(fn); },
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ left: 0, width: COL_W }) }],
  };
  const window = {};
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { window, document, Date, Math, Object, Array, isNaN, String });
  const cal = window.previewCalendar;

  // A fake block whose closest() honours the data-kind selector the page asks for.
  const block = (id) => {
    const kind = cal.getState().events.find((e) => e.id === id).kind;
    const b = {
      classes: new Set(),
      style: {},
      classList: { add: (c) => b.classes.add(c), remove: (c) => b.classes.delete(c) },
      getAttribute: (k) => (k === 'data-id' ? id : kind),
    };
    return {
      closest: (sel) => (sel.includes('data-kind="' + kind + '"') ? b : null),
      block: b,
    };
  };
  const fire = (key, ev) => (handlers[key] || []).forEach((fn) => fn({ preventDefault() {}, ...ev }));
  // Press on a block, move by (dx, dy) pixels, release.
  const drag = (id, dx, dy) => {
    const t = block(id);
    fire('cal:pointerdown', { target: t, clientX: 500, clientY: 500 });
    fire('doc:pointermove', { clientX: 500 + dx, clientY: 500 + dy });
    const transform = t.block.style.transform;
    fire('doc:pointerup', { clientX: 500 + dx, clientY: 500 + dy });
    return { transform, block: t.block };
  };
  return { cal, els, drag, fire };
}

const startOf = (cal, id) => cal.getState().events.find((e) => e.id === id).start;

test('dragging a proposed block down converts pixels to minutes and snaps to 15', () => {
  const { cal, drag } = boot();
  // p1 starts 2026-11-09 18:00. 1h = PX_H px; 10px is about 12.5 min and snaps to 15.
  const r = drag('p1', 0, PX_H + 10);
  assert.equal(startOf(cal, 'p1'), '2026-11-09T19:15:00.000Z');
  assert.equal(r.transform, 'translate(0px,' + (75 / 60) * PX_H + 'px)');
  assert.equal(r.block.classes.has('dragging'), false);
  assert.equal(cal.getState().canUndo, true);
});

test('dragging sideways moves whole days in week view and undo restores', () => {
  const { cal, drag } = boot();
  const before = cal.getState().events;
  drag('p2', 2 * COL_W + 20, -PX_H / 2);
  assert.equal(startOf(cal, 'p2'), '2026-11-12T09:30:00.000Z');
  cal.undo();
  assert.deepEqual(cal.getState().events, before);
});

test('day view ignores horizontal drag distance', () => {
  const { cal, drag } = boot();
  cal.setView('day');
  drag('p1', 3 * COL_W, 0);
  assert.equal(startOf(cal, 'p1'), '2026-11-09T18:00:00.000Z');
  assert.equal(cal.getState().canUndo, false);
});

test('fixed blocks do not start a drag', () => {
  const { cal, drag } = boot();
  const before = cal.getState().events;
  const r = drag('f1', COL_W, PX_H);
  assert.equal(r.transform, undefined);
  assert.deepEqual(cal.getState().events, before);
  assert.equal(cal.getState().canUndo, false);
});

test('a drag that lands on the same slot adds no history', () => {
  const { cal, drag } = boot();
  drag('p1', 0, 3);
  assert.equal(cal.getState().canUndo, false);
});

test('drag is clamped to the visible 07:00-21:00 hours and visible days', () => {
  const { cal, drag } = boot();
  drag('p1', 0, 10 * PX_H); // 18:00 + 10h would pass midnight
  assert.equal(startOf(cal, 'p1'), '2026-11-09T20:30:00.000Z'); // 30 min block ends at 21:00
  drag('p1', 0, -20 * PX_H);
  assert.equal(startOf(cal, 'p1'), '2026-11-09T07:00:00.000Z');
  drag('p1', -5 * COL_W, 0); // before Monday of the shown week
  assert.equal(startOf(cal, 'p1'), '2026-11-09T07:00:00.000Z');
  drag('p1', 20 * COL_W, 0); // past Sunday
  assert.equal(startOf(cal, 'p1'), '2026-11-15T07:00:00.000Z');
  assert.equal(cal.moveBlock('p1', '2026-11-30T22:00:00.000Z'), true);
  assert.equal(startOf(cal, 'p1'), '2026-11-15T20:30:00.000Z');
});

test('rendered page marks fixed and proposed blocks differently', () => {
  const { cal, els } = boot();
  cal.moveBlock('p1', '2026-11-09T19:00:00.000Z');
  const out = els.cal.innerHTML;
  assert.match(out, /data-kind="fixed"/);
  assert.match(out, /data-kind="proposed"/);
  assert.match(out, /Locked/);
  assert.match(out, /Proposed/);
});

// The page keeps its own copy of the move logic (the server serves one HTML file), so this
// parity check fails if it drifts from src/calendar/store.mjs.
test('page move/undo matches src/calendar/store.mjs', () => {
  const { cal } = boot();
  const events = cal.getState().events;
  const store = createStore({
    fixed: events.filter((e) => e.kind === 'fixed'),
    proposed: events.filter((e) => e.kind === 'proposed'),
  });
  const norm = (list) => [...list].sort((a, b) => a.id.localeCompare(b.id)).map((e) => ({ ...e }));
  for (const [id, to] of [['p1', '2026-11-10T08:00:00.000Z'], ['p3', '2026-11-12T13:15:00.000Z'], ['p1', '2026-11-11T09:00:00.000Z']]) {
    cal.moveBlock(id, to);
    store.moveBlock(id, to);
    assert.deepEqual(norm(cal.getState().events), norm(store.getState().items));
  }
  while (store.canUndo()) {
    cal.undo();
    store.undo();
    assert.deepEqual(norm(cal.getState().events), norm(store.getState().items));
  }
  assert.equal(cal.getState().canUndo, false);
});
