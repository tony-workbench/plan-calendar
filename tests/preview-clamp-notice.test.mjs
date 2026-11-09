import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function boot() {
  const els = {};
  const el = (id) => (els[id] ||= { id, innerHTML: '', textContent: '', disabled: false, setAttribute() {}, addEventListener() {} });
  const document = { getElementById: el, addEventListener() {}, querySelectorAll: () => [] };
  const window = {};
  vm.runInNewContext(script, { window, document, Date, Math, Object, Array, isNaN, String });
  return { els, cal: window.previewCalendar };
}

test('legend states the drag limit and the time zone', () => {
  assert.match(html, /between 07:00 and 21:00/);
  assert.match(html, /UTC/);
  assert.match(html, /id="notice"/);
});

test('a drop outside the visible hours explains where the block went', () => {
  const { els, cal } = boot();
  cal.moveBlock('p1', '2026-11-09T21:30:00.000Z');
  assert.match(els.notice.textContent, /07:00 and 21:00/);
  assert.match(cal.getState().notice, /Moved to 20:30/);
  cal.moveBlock('p1', '2026-11-09T19:00:00.000Z');
  assert.equal(els.notice.textContent, '');
});
