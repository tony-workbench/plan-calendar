import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { handleAsk } from '../src/ask/ask.mjs';
import { createFakeCalendarAdapter } from '../src/calendar/adapter.mjs';

const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
const strip = (src) =>
  src.split('\n').filter((l) => !l.startsWith('import ') && !l.startsWith('export default')).map((l) => l.replace(/^export /, '')).join('\n').trim();
const load = () => {
  const ctx = vm.createContext({});
  vm.runInContext(script, ctx);
  return (name) => vm.runInContext(name, ctx);
};

const events = [
  { id: 'e1', title: 'Standup', start: '2026-11-09T09:00:00.000Z', end: '2026-11-09T09:30:00.000Z', fixed: true },
  { id: 'e2', title: 'Lunch', start: '2026-11-09T12:00:00.000Z', end: '2026-11-09T13:00:00.000Z', fixed: true },
];
const now = new Date('2026-11-09T08:00:00.000Z');

test('the page embeds the current parse, arrange and preview sources', async () => {
  for (const f of ['arrange/parse', 'arrange/arrange', 'preview/preview']) {
    const src = strip(await readFile(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8'));
    assert.ok(script.includes(src), `${f}.mjs is out of sync with public/index.html`);
  }
});

test('the page has an Ask input and shows the workout block with the existing events', () => {
  const g = load();
  assert.match(page, /id="ask-input"/);
  const res = g('handleAskLocal')({ text: 'find time to work out for half an hour', events, now });
  assert.equal(res.status, 'preview-only');
  const proposed = res.preview.items.filter((i) => i.source === 'proposed');
  assert.equal(proposed.length, 1);
  assert.equal((Date.parse(proposed[0].end) - Date.parse(proposed[0].start)) / 60000, 30);
  assert.equal(res.preview.items.length, 3);
  const html = g('renderPreviewHtml')(res.preview);
  assert.match(html, /Workout/);
  assert.match(html, /\(proposed\)/);
  assert.match(html, /Standup/);
  assert.match(html, /Lunch/);
});

test('unrelated Ask text gets no proposed block, in handleAsk and in the page', async () => {
  const adapter = createFakeCalendarAdapter(events);
  const res = await handleAsk({ text: 'what is the weather like', adapter, now });
  assert.equal(res.status, 'unsupported');
  assert.deepEqual(res.plan.blocks, []);
  assert.equal(res.preview.items.filter((i) => i.source === 'proposed').length, 0);
  assert.equal(res.preview.items.length, 2);
  assert.deepEqual(adapter.calls.map((c) => c.method), ['listEvents']);

  const local = load()('handleAskLocal')({ text: 'what is the weather like', events, now });
  assert.equal(local.status, 'unsupported');
  assert.equal(local.preview.items.length, 2);
});
