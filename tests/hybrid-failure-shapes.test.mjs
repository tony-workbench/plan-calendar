import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHybrid } from '../src/planner/approaches/hybrid.mjs';

const NOW = '2026-11-09T09:00:00.000Z';
const rec = JSON.parse(readFileSync(new URL('./fixtures/model-replies.json', import.meta.url), 'utf8'));
const env = { GEMINI_API_KEY: 'test' };
const replay = (text) => async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const run = (name, request = rec[name].request) => createHybrid({ fetch: replay(rec[name].reply), env }).plan({ request, events: [], now: NOW, context: {} });

test('recorded reply with a missing due date falls back to the parser, which finds the deadline', async () => {
  const r = await run('missing-deadline-date');
  assert.equal(r.meta.deadline, '2026-11-13T15:00:00.000Z');
  assert.equal(r.blocks.length, 3);
  assert.equal(r.meta.debug.used, 'rules');
});

test('recorded "none" on a plan request does not hide the plan', async () => {
  const r = await run('none-on-plan');
  assert.equal(r.blocks.length, 3);
});

test('recorded "discover" on a plan request does not produce a discovery answer', async () => {
  const r = await run('discover-on-plan');
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].title, 'Work out');
  assert.equal(r.question, undefined);
});

test('recorded wrong kind (deadline without a date for a basic request) falls back to the parser', async () => {
  const r = await run('wrong-kind');
  assert.equal(r.blocks.length, 1);
  assert.equal(r.blocks[0].title, 'Yoga');
});
