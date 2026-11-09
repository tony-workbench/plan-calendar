import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import approaches from '../src/planner/index.mjs';
import { createHybrid } from '../src/planner/approaches/hybrid.mjs';

const NOW = '2026-11-09T09:00:00.000Z';
const rec = JSON.parse(readFileSync(new URL('./fixtures/model-replies.json', import.meta.url), 'utf8'));
const env = { GEMINI_API_KEY: 'test' };
const replay = (text, log = []) => async (url, opts) => { log.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }; };
const hybrid = (name, log) => createHybrid({ fetch: replay(rec[name].reply, log), env });
const mins = (b) => (Date.parse(b.end) - Date.parse(b.start)) / 60000;

test('the hybrid approach reads private wording through the recorded model reply (basic)', async () => {
  const log = [];
  const r = await hybrid('basic', log).plan({ request: rec.basic.request, events: [], now: NOW, context: {} });
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].title, 'Yoga');
  assert.equal(mins(r.blocks[0]), 45);
  assert.equal(log.length, 1);
  assert.equal(log[0].generationConfig.temperature, 0);
  assert.deepEqual(log[0].generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(log[0].tools, undefined);
  assert.equal(r.meta.debug.used, 'model+rules');
});

test('the registered hybrid uses the request parser when no key is set', async () => {
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const r = await approaches.hybrid.plan({ request: 'Find time to work out for half an hour', events: [], now: NOW, context: {} });
    assert.equal(r.blocks[0].title, 'Work out');
  } finally { if (saved !== undefined) process.env.GEMINI_API_KEY = saved; }
});

test('a fenced model reply with a time preference is honoured', async () => {
  const r = await hybrid('basic-fenced').plan({ request: rec['basic-fenced'].request, events: [], now: NOW, context: {} });
  assert.equal(mins(r.blocks[0]), 60);
  assert.ok(Date.parse(r.blocks[0].start) >= Date.parse('2026-11-10T00:00:00Z'));
});

test('a model deadline intent is back-planned by code into ordered steps before the deadline', async () => {
  const r = await hybrid('deadline').plan({ request: rec.deadline.request, events: [], now: NOW, context: {} });
  assert.deepEqual(r.blocks.map((b) => b.id), ['step-1', 'step-2', 'step-3']);
  assert.equal(r.meta.deadline, '2026-11-13T15:00:00.000Z');
  assert.ok(r.blocks.every((b) => Date.parse(b.end) <= Date.parse(r.meta.deadline)));
});

test('discovery gives the light prompt from core without a model call', async () => {
  let called = 0;
  const h = createHybrid({ fetch: async () => { called++; throw new Error('no'); }, env });
  const cand = { id: 'c1', title: 'Jazz night', start: '2026-11-11T19:00:00.000Z', end: '2026-11-11T21:00:00.000Z', place: 'Blue Room', reason: 'Matches music', source: 'city guide', tags: ['music'] };
  const r = await h.plan({ request: rec.discover.request, events: [], now: NOW, context: { mode: 'discover', interests: ['music'], candidates: [cand] } });
  assert.equal(called, 0);
  assert.equal(r.blocks.length, 1);
  assert.match(r.question.text, /want to see it/);
});

test('related items: one merged question, partial confirm honoured, refusal remembered; no model call', async () => {
  let called = 0;
  const h = createHybrid({ fetch: async () => { called++; throw new Error('no'); }, env });
  const b = (id, title, h0) => ({ id, title, start: `2026-11-10T${h0}:00.000Z`, end: `2026-11-10T${String(+h0.slice(0, 2) + 1).padStart(2, '0')}:00:00.000Z`, kind: 'proposed', group: 'meal' });
  const plan = { blocks: [b('a', 'Shopping', '09:00'), b('b', 'Cooking', '10:00'), b('c', 'Dinner', '16:00'), { ...b('z', 'Dentist', '14:00'), group: undefined }], notes: [], meta: { kind: 'related', timezone: 'UTC' } };
  const q = await h.replan({ plan, change: { type: 'drag', blockId: 'a', start: '2026-11-10T09:30:00.000Z' }, events: [] });
  assert.ok(q.question && q.question.items.length === 3);
  assert.match(q.question.text, /Shopping/);
  const done = await h.replan({ plan: q, answers: { confirm: ['b'] }, events: [] });
  const by = Object.fromEntries(done.blocks.map((x) => [x.id, x]));
  assert.equal(by.c.start, plan.blocks[2].start);
  assert.equal(by.z.start, plan.blocks[3].start);
  assert.equal(by.b.moved, true);
  const refused = await h.replan({ plan: q, answers: { confirm: [] }, events: [] });
  const again = await h.replan({ plan: refused, change: { type: 'drag', blockId: 'a', start: '2026-11-10T09:45:00.000Z' }, events: [] });
  assert.equal(again.question, undefined);
  assert.equal(called, 0);
});

test('the registered hybrid stays offline even when a key is set; only an explicit opt-in calls the model', async () => {
  const savedKey = process.env.GEMINI_API_KEY, savedFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test';
  let called = 0;
  globalThis.fetch = async () => { called++; throw new Error('no network'); };
  try {
    const r = await approaches.hybrid.plan({ request: 'Find time to work out for half an hour', events: [], now: NOW, context: {} });
    assert.equal(r.blocks[0].title, 'Work out');
    assert.equal(called, 0);
    await createHybrid({ env: process.env }).plan({ request: 'Find time to work out for half an hour', events: [], now: NOW, context: {} });
    assert.equal(called, 1);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
  }
});

test('the deadline comes from the model due-date wording, not from the request text', async () => {
  const request = 'The pitch goes live at the end of the working week, help me get ready';
  const input = { request, events: [], now: NOW, context: {} };
  const offline = await createHybrid({ fetch: async () => { throw new Error('no'); }, env: {} }).plan(input);
  assert.equal(offline.meta?.deadline, undefined, 'the regex parser alone finds no date in this wording');
  const r = await createHybrid({ fetch: replay('{"kind":"deadline","activity":"pitch","deadline_text":"Friday at 3 pm"}'), env }).plan(input);
  assert.equal(r.meta.deadline, '2026-11-13T15:00:00.000Z');
  assert.equal(r.meta.debug.used, 'model+rules');
  const bad = await createHybrid({ fetch: replay('{"kind":"deadline","activity":"pitch","deadline_text":"soon-ish"}'), env }).plan({ ...input, request: 'Demo due next Friday at 3 pm, plan the prep' });
  assert.equal(bad.meta.debug.used, 'rules', 'an unusable due-date wording falls back to the regex parser');
});
