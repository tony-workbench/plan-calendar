import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/planner/approaches/rules.mjs';
import search from '../src/planner/approaches/search.mjs';

const now = '2026-11-09T08:00:00.000Z';

test('an invented deadline is announced in the plan notes', async () => {
  for (const p of [rules, search]) {
    const r = await p.plan({ request: 'The tax return is due, help me work back', events: [], now, context: {} });
    assert.ok(r.notes.some((n) => /assumed the deadline/.test(n)), JSON.stringify(r.notes));
    const named = await p.plan({ request: 'The tax return is due next Friday, help me work back', events: [], now, context: {} });
    assert.ok(!named.notes.some((n) => /assumed the deadline/.test(n)));
  }
});

test('pushing a step past the deadline is reported, not silent', async () => {
  for (const p of [rules, search]) {
    const plan = await p.plan({ request: 'The tax return is due next Friday, help me work back', events: [], now, context: {} });
    const first = plan.blocks[0];
    const r = await p.replan({ plan, change: { type: 'move', blockId: first.id, start: '2026-11-20T15:00:00.000Z' }, events: [] });
    assert.ok(r.notes.some((n) => /deadline/.test(n)), `${p === rules ? 'rules' : 'search'}: ${JSON.stringify(r.notes)}`);
  }
});
