import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules from '../src/planner/approaches/rules.mjs';
import search from '../src/planner/approaches/search.mjs';

const at = (h) => `2026-11-10T${String(h).padStart(2, '0')}:00:00.000Z`;
const blk = (id, title, a, b, extra = {}) => ({ id, title, start: at(a), end: at(b), ...extra });

for (const [name, p] of Object.entries({ rules, search })) {
  test(`${name}: an ignored related-item question is not asked again after the next drag`, async () => {
    const plan = { blocks: [blk('shop', 'Shopping', 9, 10, { group: 'g' }), blk('cook', 'Cooking', 11, 12, { group: 'g' })], notes: [] };
    const ask = await p.replan({ plan, change: { type: 'drag', blockId: 'shop', start: at(10) }, events: [] });
    assert.ok(ask.question);
    const next = await p.replan({ plan: ask, change: { type: 'drag', blockId: 'shop', start: at(11) }, events: [] });
    assert.equal(next.question, null);
    assert.deepEqual(next.meta.declined, ['cook']);
    assert.equal(next.meta.pending, undefined);
  });

  test(`${name}: a dependent that already starts after the dragged block end is not pushed`, async () => {
    const plan = { blocks: [blk('a', 'A', 9, 10), blk('b', 'B', 15, 16, { dependsOn: ['a'] })], notes: [] };
    const r = await p.replan({ plan, change: { type: 'drag', blockId: 'a', start: at(11) }, events: [] });
    assert.equal(r.blocks.find((b) => b.id === 'b').start, at(15));
  });
}
