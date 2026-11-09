import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

function makeEl(id) {
  const attrs = new Map();
  const classes = new Set();
  return {
    id, innerHTML: '', textContent: '', disabled: id === 'btn-undo', style: {}, listeners: {},
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k),
    addEventListener(t, f) { this.listeners[t] = f; },
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) },
  };
}

// Minimal fake DOM: render() writes an HTML string; the test parses it back.
function boot() {
  const els = {};
  for (const id of ['cal', 'range', 'btn-day', 'btn-week', 'btn-prev', 'btn-next', 'btn-undo']) els[id] = makeEl(id);
  const docListeners = {};
  const document = {
    getElementById: (id) => els[id],
    addEventListener: (t, f) => { docListeners[t] = f; },
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ left: 0, width: 100 }) }],
  };
  const window = {};
  vm.runInNewContext(script, { window, document, Date, Math, Object, Array, isNaN, String });
  return { els, docListeners, cal: window.previewCalendar };
}

function parse(cal) {
  const h = cal.innerHTML;
  const cols = (h.match(/class="col"/g) || []).length;
  const blocks = [...h.matchAll(/<div class="block" data-kind="(\w+)" data-id="(\w+)" style="([^"]*)">(.*?)<\/div>/g)]
    .map((m) => ({ kind: m[1], id: m[2], style: m[3], inner: m[4] }));
  return { cols, blocks };
}

function blockEl(b) {
  const el = makeEl(b.id);
  el.setAttribute('data-id', b.id);
  el.closest = (sel) => (sel.includes(`data-kind="${b.kind}"`) ? el : null);
  return el;
}

function pointer(el, x, y) { return { target: el, clientX: x, clientY: y, pointerId: 1, preventDefault() {} }; }

test('week view renders seven columns with both kinds styled differently; day view renders one', () => {
  const { els, cal } = boot();
  let p = parse(els.cal);
  assert.equal(p.cols, 7);
  assert.equal(p.blocks.filter((b) => b.kind === 'fixed').length, 5);
  assert.equal(p.blocks.filter((b) => b.kind === 'proposed').length, 4);
  const fixed = p.blocks.find((b) => b.kind === 'fixed');
  const prop = p.blocks.find((b) => b.kind === 'proposed');
  assert.match(fixed.inner, /Locked/);
  assert.match(prop.inner, /Proposed/);
  const rule = (k) => css.match(new RegExp(`\\.block\\[data-kind="${k}"\\]\\s*\\{([^}]*)\\}`))[1];
  assert.notEqual(rule('fixed'), rule('proposed'));
  assert.match(rule('proposed'), /dashed/);
  assert.doesNotMatch(rule('fixed'), /dashed/);
  assert.equal(els['btn-week'].getAttribute('aria-pressed'), 'true');

  cal.setView('day');
  p = parse(els.cal);
  assert.equal(p.cols, 1);
  assert.deepEqual(p.blocks.map((b) => b.id).sort(), ['f1', 'p1']);
  assert.equal(els['btn-day'].getAttribute('aria-pressed'), 'true');
  assert.match(els.range.textContent, /Mon 11\/9/);
});

test('Undo button enables after a move and disables after undo; click undoes', () => {
  const { els, cal } = boot();
  assert.equal(els['btn-undo'].disabled, true);
  cal.moveBlock('p1', '2026-11-09T19:00:00.000Z');
  assert.equal(els['btn-undo'].disabled, false);
  els['btn-undo'].listeners.click();
  assert.equal(els['btn-undo'].disabled, true);
  assert.equal(cal.getState().events.find((e) => e.id === 'p1').start, '2026-11-09T18:00:00.000Z');
});

test('dragging a proposed block moves it by snapped minutes and days; undo restores', () => {
  const { els, docListeners, cal } = boot();
  const before = cal.getState().events;
  const b = parse(els.cal).blocks.find((x) => x.id === 'p1');
  const el = blockEl(b);
  els.cal.listeners.pointerdown(pointer(el, 50, 200));
  assert.ok(el.classList.has('dragging'));
  docListeners.pointermove(pointer(el, 260, 300));
  assert.match(el.style.transform, /200px,96px/);
  docListeners.pointerup(pointer(el, 260, 300));
  assert.ok(!el.classList.has('dragging'));
  // +100px = 125 min -> snapped to 120; +210px = 2 columns.
  const moved = cal.getState().events.find((e) => e.id === 'p1');
  assert.equal(moved.start, '2026-11-11T20:00:00.000Z');
  assert.equal(moved.end, '2026-11-11T20:30:00.000Z');
  assert.equal(els['btn-undo'].disabled, false);
  assert.match(els.cal.innerHTML, /data-id="p1"/);
  cal.undo();
  assert.deepEqual(cal.getState().events, before);
});

test('dragging in day view moves only in time; a click without movement changes nothing', () => {
  const { els, docListeners, cal } = boot();
  cal.setView('day');
  const el = blockEl(parse(els.cal).blocks.find((x) => x.id === 'p1'));
  els.cal.listeners.pointerdown(pointer(el, 0, 0));
  docListeners.pointerup(pointer(el, 500, -48));
  assert.equal(cal.getState().events.find((e) => e.id === 'p1').start, '2026-11-09T17:00:00.000Z');
  cal.undo();
  els.cal.listeners.pointerdown(pointer(el, 0, 0));
  docListeners.pointerup(pointer(el, 3, 3));
  assert.equal(cal.getState().canUndo, false);
});

test('fixed blocks are not draggable in the DOM', () => {
  const { els, docListeners, cal } = boot();
  const before = cal.getState().events;
  const el = blockEl(parse(els.cal).blocks.find((x) => x.kind === 'fixed'));
  els.cal.listeners.pointerdown(pointer(el, 0, 0));
  assert.ok(!el.classList.has('dragging'));
  docListeners.pointermove(pointer(el, 300, 300));
  docListeners.pointerup(pointer(el, 300, 300));
  assert.deepEqual(cal.getState().events, before);
  assert.equal(cal.getState().canUndo, false);
});
