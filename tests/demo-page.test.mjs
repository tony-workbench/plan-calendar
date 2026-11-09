import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRoute, replanRoute, state, shoppingPlan, PAGE_EVENTS } from '../src/demo-api.mjs';
import { startDemoServer } from '../src/demo-server.mjs';
import { validatePlan } from '../benchmark/contract.mjs';

const OFFLINE = {};
const noFetch = () => { throw new Error('no network in this test'); };
const ask = (request, extra = {}) => planRoute({ request, ...extra }, { env: OFFLINE, fetch: noFetch }).then((r) => r.body);
const at = (res, id) => res.blocks.find((b) => b.id === id);

test('the page has the Ask bar, the calendar, the four chips and the no-write banner', () => {
  const html = readFileSync(new URL('../public/demo.html', import.meta.url), 'utf8');
  assert.match(html, /id="ask-input"/);
  assert.match(html, /id="calendar"/);
  assert.equal((html.match(/class="chip"/g) ?? []).length, 4);
  for (const t of ['Find time to work out for half an hour', 'The demo is due next Friday, help me plan the prep', 'Anything fun this week?', 'Drag shopping later is not an Ask message, use the calendar drag']) assert.ok(html.includes(t), t);
  assert.match(html, /Nothing is written to Google Calendar/);
  assert.match(html, /id="model-badge"/);
  assert.match(readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'), /Saved to the fake calendar/);
});

test('the server serves /demo, /demo.js and the state with the recorded badge', async () => {
  const server = await startDemoServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/demo`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="ask-input"/);
    assert.match((await fetch(`${base}/demo.js`)).headers.get('content-type'), /javascript/);
    const s = await (await fetch(`${base}/api/state`)).json();
    assert.equal(s.writesToGoogleCalendar, false);
    assert.ok(['live', 'recorded'].includes(s.model));
    const out = await (await fetch(`${base}/api/plan`, { method: 'POST', body: JSON.stringify({ request: '' }) })).json();
    assert.ok(out.error);
  } finally { server.close(); }
});

test('model badge: recorded without a key, live with one', () => {
  assert.equal(state({}).model, 'recorded');
  assert.equal(state({ GEMINI_API_KEY: 'k' }).model, 'live');
});

test('scene 1: one proposed block clear of events, from a recorded reply', async () => {
  const out = await ask('Find time to work out for half an hour');
  assert.equal(out.model, 'recorded');
  assert.equal(out.source, 'recorded');
  assert.equal(out.plan.blocks.length, 1);
  assert.equal(validatePlan(out.plan, { events: PAGE_EVENTS }).ok, true);
});

test('scene 2: three ordered steps, a drag re-plans only later steps, more time and a deadline correction work', async () => {
  const out = await ask('The demo is due next Friday, help me plan the prep');
  const plan = out.plan, steps = plan.blocks;
  assert.equal(steps.length, 3);
  assert.match(plan.notes.join(' '), /assumed it is due at 17:00 UTC/);
  const drag = (await replanRoute({ plan, change: { type: 'drag', blockId: 'step-1', start: steps[1].start } })).body.plan;
  assert.ok(at(drag, 'step-2').moved);
  assert.ok(!at(drag, 'step-1').moved);
  assert.equal(at(drag, 'step-3').start, steps[2].start);
  const more = await ask('production needs an hour more', { plan });
  assert.equal(more.mode, 'replan');
  const len = (p, id) => Date.parse(at(p, id).end) - Date.parse(at(p, id).start);
  assert.equal(len(more.plan, 'step-2'), len(plan, 'step-2') + 3600000);
  const fixed = await ask('it is due Thursday at 3 pm', { plan });
  assert.equal(fixed.mode, 'replan');
  assert.equal(fixed.plan.meta.deadline, '2026-11-12T15:00:00.000Z');
  assert.equal(fixed.plan.meta.deadlineAssumed, false);
});

test('scene 3: two question-mark candidates with a light prompt, ignoring never re-asks', async () => {
  const out = await ask('Anything fun this week?');
  const { blocks, question } = out.plan;
  assert.ok(blocks.length >= 1 && blocks.length <= 3);
  assert.ok(blocks.every((b) => b.kind === 'candidate' && b.title.endsWith('?') && b.place && b.reason && b.source));
  assert.match(question.text, /fit you this week, want to see/);
  const again = await ask('Anything fun this week?', { dismissed: true });
  assert.equal(again.plan.blocks.length, 0);
  assert.equal(again.plan.question, undefined);
});

test('scene 4: one merged question, only the confirmed item moves, a refusal is not asked again', async () => {
  const plan = shoppingPlan();
  const shop = at(plan, 'shop');
  const shifted = (p, min) => ({ type: 'drag', blockId: 'shop', start: new Date(Date.parse(at(p, 'shop').start) + min * 60000).toISOString() });
  const q = (await replanRoute({ plan, change: shifted(plan, 60) })).body.plan;
  assert.match(q.question.text, /Shopping, Cooking and Dinner/);
  const partial = (await replanRoute({ plan: q, answers: { confirm: ['cook'] } })).body.plan;
  assert.deepEqual(partial.blocks.filter((b) => b.moved).map((b) => b.id), ['cook']);
  assert.equal(at(partial, 'dinner').start, at(plan, 'dinner').start);
  assert.equal(at(partial, 'other').start, at(plan, 'other').start);
  assert.deepEqual(partial.meta.declined, ['dinner']);
  const no = (await replanRoute({ plan: q, answers: { confirm: [] } })).body.plan;
  const next = (await replanRoute({ plan: no, change: shifted(no, 30) })).body.plan;
  assert.equal(next.question, undefined);
  assert.equal(at(next, 'cook').start, at(plan, 'cook').start);
  assert.ok(shop);
});

test('a request that is not a calendar task gets a short line, not silence', async () => {
  const out = await ask('What is the capital of France?');
  assert.equal(out.plan.blocks.length, 0);
  assert.match(out.plan.notes[0], /could not turn that into a calendar plan/);
});

test('live mode uses the model reply; a failing model falls back and says so', async () => {
  const reply = { kind: 'basic', title: 'Run', minutes: 45 };
  const okFetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }) });
  const live = (await planRoute({ request: 'anything at all' }, { env: { GEMINI_API_KEY: 'test' }, fetch: okFetch })).body;
  assert.equal(live.model, 'live');
  assert.equal(live.plan.blocks[0].title, 'Run');
  const down = (await planRoute({ request: 'Find time to work out for half an hour' }, { env: { GEMINI_API_KEY: 'test' }, fetch: async () => ({ ok: false, status: 500 }) })).body;
  assert.equal(down.model, 'recorded');
  assert.match(down.fallback, /live model did not answer/);
  assert.equal(down.plan.blocks.length, 1);
});
