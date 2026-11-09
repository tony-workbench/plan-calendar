import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Minimal DOM stub: enough to run the page script and read what it shows.
function boot() {
  const els = {};
  const make = () => ({
    hidden: false, disabled: false, value: '', children: [], listeners: {}, className: '', id: '',
    _text: '',
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  });
  const initiallyHidden = ['status', 'success'];
  const document = {
    getElementById(id) {
      if (!els[id]) { els[id] = make(); els[id].hidden = initiallyHidden.includes(id); }
      return els[id];
    },
    createElement: () => make(),
  };
  for (const id of ['ask', 'ask-form', 'status', 'success', 'confirm', 'unsynced', 'preview-blocks']) document.getElementById(id);
  vm.runInNewContext(script, { document, Date, Promise, Math, Number, parseFloat });
  return els;
}

const ask = (els, text) => {
  els.ask.value = text;
  els['ask-form'].listeners.submit({ preventDefault() {} });
};

test('Ask fills the Preview Calendar and enables Confirm; nothing is synced yet', () => {
  const els = boot();
  ask(els, 'find time to work out for half an hour');
  assert.match(els['preview-blocks'].textContent, /Proposed: find time to work out/);
  assert.match(els['preview-blocks'].textContent, /No scheduling conflicts found/);
  assert.equal(els.status.hidden, true);
  assert.equal(els.confirm.disabled, false);
  assert.equal(els.unsynced.hidden, false);
  assert.equal(els.success.hidden, true);
});

test('deadline request shows ordered steps', () => {
  const els = boot();
  ask(els, 'Demo due next Friday, plan the prep');
  const text = els['preview-blocks'].textContent;
  assert.ok(text.indexOf('Outline') < text.indexOf('Production'));
  assert.ok(text.indexOf('Production') < text.indexOf('Rehearsal'));
});

test('after Confirm the page no longer says nothing has been synced', async () => {
  const els = boot();
  ask(els, 'find time to work out for half an hour');
  els.confirm.listeners.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(els.success.hidden, false);
  assert.equal(els.unsynced.hidden, true);
  assert.equal(els.confirm.disabled, true);
});

test('a new Ask after Confirm resets to the unsynced state', async () => {
  const els = boot();
  ask(els, 'find time to work out for half an hour');
  els.confirm.listeners.click();
  await new Promise((r) => setImmediate(r));
  ask(els, 'find time to read for an hour');
  assert.equal(els.success.hidden, true);
  assert.equal(els.unsynced.hidden, false);
});
