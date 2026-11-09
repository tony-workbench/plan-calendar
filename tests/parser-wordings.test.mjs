import test from 'node:test';
import assert from 'node:assert/strict';
import { understand } from '../src/planner/core.mjs';
import approaches from '../src/planner/index.mjs';

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const u = (request, now = '2026-11-09T09:00:00.000Z') => understand({ request, now, context: {} });

test('"end of this week" is never in the past, also on a weekend', () => {
  // 2026-11-14 is a Saturday, 2026-11-15 a Sunday.
  for (const now of ['2026-11-14T09:00:00.000Z', '2026-11-15T09:00:00.000Z']) {
    const i = u('Finish the slides by end of this week', now);
    assert.equal(i.kind, 'deadline');
    assert.ok(i.deadline > Date.parse(now));
    assert.equal(day(i.deadline), '2026-11-20');
  }
  assert.equal(day(u('Finish the slides by end of this week').deadline), '2026-11-13');
});

test('tomorrow, in N days and ordinal days give the right deadline day', () => {
  assert.equal(day(u('The report is due tomorrow').deadline), '2026-11-10');
  assert.equal(day(u('The report is due in 3 days').deadline), '2026-11-12');
  assert.equal(day(u('The report is due on the 5th', '2026-11-20T09:00:00.000Z').deadline), '2026-12-05');
  assert.equal(day(u('The report is due by the 5th', '2026-12-20T09:00:00.000Z').deadline), '2027-01-05');
});

test('requests that are not calendar tasks still get no plan, in every approach', async () => {
  for (const request of ['Let me know what you think', 'Thanks, that looks great', 'What is the weather like?']) {
    assert.equal(u(request).kind, 'none', request);
    for (const [name, a] of Object.entries(approaches)) {
      const r = await a.plan({ request, events: [], now: '2026-11-09T09:00:00.000Z', context: {} });
      assert.equal(r.blocks.length, 0, `${name}: ${request}`);
      assert.equal(r.meta.kind, 'none', `${name}: ${request}`);
    }
  }
  assert.equal(u('The report is due').kind, 'ask-deadline');
});

test('the wider wordings reach every approach and a deadline is never before now', async () => {
  const now = '2026-11-14T09:00:00.000Z';
  for (const [name, a] of Object.entries(approaches)) {
    const d = await a.plan({ request: 'Finish the slides by end of this week', events: [], now, context: {} });
    assert.equal(d.meta.kind, 'deadline', name);
    assert.ok(Date.parse(d.meta.deadline) > Date.parse(now), name);
    assert.ok(d.blocks.length > 0, name);
    const g = await a.plan({ request: 'I want to hit the gym for 90 minutes', events: [], now, context: {} });
    assert.equal(g.blocks.length, 1, name);
    assert.equal(Date.parse(g.blocks[0].end) - Date.parse(g.blocks[0].start), 90 * 60000, name);
  }
});
