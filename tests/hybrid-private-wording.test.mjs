import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase, casePass } from '../benchmark/score.mjs';
import { createHybrid } from '../src/planner/approaches/hybrid.mjs';
import rules from '../src/planner/approaches/rules.mjs';
import { understand } from '../src/planner/core.mjs';

// Requests reworded so the regex parser cannot read them. The model reply for each is recorded in `replies`
// (an intent only: kind, activity, minutes, due-date wording); the test never gives the model blocks, times or ids.
const WORDS = { 20: 'twenty minutes', 30: 'half an hour or so', 45: 'three quarters of an hour', 60: 'a full hour', 90: 'ninety minutes', 120: 'a couple of hours' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DELIV = /(the demo|the quarterly report|the grant application|my thesis chapter|the pitch deck|the design spec)/i;
const replies = new Map();
const reword = (k) => {
  if (k.category === 'basic' && ['simple', 'crowded', 'backtoback'].includes(k.sub)) {
    const { title, minutes } = understand({ request: k.request, now: k.now, context: {} });
    const request = `Any room in my week for ${title.toLowerCase()}? ${WORDS[minutes]}, please.`;
    replies.set(request, { kind: 'basic', activity: title.toLowerCase(), minutes });
    return { ...k, request };
  }
  if (k.category === 'deadline' && !k.expect.change && !k.expect.tight && !k.expect.today) {
    const d = new Date(k.expect.deadline), what = k.request.match(DELIV)[1];
    const when = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}th at 5 pm`;
    const request = `${what[0].toUpperCase()}${what.slice(1)} goes out on ${when}. Get me ready, please.`;
    replies.set(request, { kind: 'deadline', activity: what.replace(/^(the|my) /i, ''), deadline_text: when });
    return { ...k, request };
  }
  return null;
};
const modelFetch = async (url, opts) => {
  const request = JSON.parse(JSON.parse(opts.body).contents[0].parts[0].text.split('Request: ')[1]);
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(replies.get(request)) }] } }] }) };
};

const cases = generate({ seed: 7, perCategory: 60, prefix: 'priv' });
const reworded = cases.map(reword).filter(Boolean);
const score = async (planner, list) => {
  let pass = 0;
  for (const k of list) if (casePass(await scoreCase(planner, structuredClone(k)))) pass++;
  return pass / (list.length || 1);
};

test('on reworded requests the hybrid beats the regex parser for basic and deadline', async () => {
  const hybrid = createHybrid({ fetch: modelFetch, env: { GEMINI_API_KEY: 'k' } });
  for (const category of ['basic', 'deadline']) {
    const list = reworded.filter((k) => k.category === category);
    assert.ok(list.length >= 15, `${category}: ${list.length} reworded cases`);
    const withModel = await score(hybrid, list), without = await score(rules, list);
    assert.ok(withModel >= 0.85, `${category}: hybrid ${withModel}`);
    assert.ok(withModel >= without + 0.4, `${category}: hybrid ${withModel} vs regex ${without}`);
  }
});

test('the hybrid keeps the rule score on related-item adjustment while the model is wired in', async () => {
  const list = cases.filter((k) => k.category === 'related');
  const hybrid = createHybrid({ fetch: async () => { throw new Error('replan must not call the model'); }, env: { GEMINI_API_KEY: 'k' } });
  const h = await score(hybrid, list), r = await score(rules, list);
  assert.ok(h >= 0.95 && h >= r, `related hybrid ${h} vs rules ${r}`);
});
