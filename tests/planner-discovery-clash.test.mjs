import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../benchmark/gen.mjs';
import rules from '../src/planner/approaches/rules.mjs';
import search from '../src/planner/approaches/search.mjs';
import hybrid from '../src/planner/approaches/hybrid.mjs';

const overlap = (a, b) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(a.end) > Date.parse(b.start);
const withSource = (k) => ({ ...k, context: { ...k.context, source: { find: () => k.context.candidates } } });
const baseId = (b) => String(b.id).replace(/^candidate-/, '');

// Public-split discovery cases where a planner offers a candidate outside the benchmark's validIds.
async function misses(planner) {
  const out = [];
  for (const k of generate({ seed: 1, perCategory: 50, prefix: 'pub' }).filter((c) => c.category === 'discovery')) {
    const r = await planner.plan(withSource(structuredClone(k)));
    for (const b of r.blocks) if (!k.expect.validIds.includes(baseId(b))) out.push({ caseId: k.id, cand: k.context.candidates.find((c) => c.id === baseId(b)), events: k.events });
  }
  return out;
}

test('every only-valid miss is a generator "clash" candidate that overlaps no event, and all offline planners miss the same ones', async () => {
  const found = {};
  for (const [name, p] of Object.entries({ rules, search, hybrid })) {
    const m = await misses(p);
    found[name] = m.map((x) => x.caseId);
    for (const x of m) {
      assert.match(x.cand.title, /^Clashing /, `${x.caseId}: miss is not a clash-kind candidate`);
      assert.ok(x.cand.source && x.cand.place && x.cand.reason, `${x.caseId}: candidate is not screenable`);
      assert.ok(!x.events.some((ev) => overlap(x.cand, ev)), `${x.caseId}: candidate really overlaps an event, planner bug`);
    }
  }
  assert.deepEqual(found.rules, ['pub-discovery-0011', 'pub-discovery-0018', 'pub-discovery-0044']);
  assert.deepEqual(found.search, found.rules);
  assert.deepEqual(found.hybrid, found.rules);
});

const approaches = new URL('../src/planner/approaches/', import.meta.url);

test('approaches/ holds the four approach modules; any other file there is an inert stub that is never imported', async () => {
  const files = readdirSync(approaches).filter((f) => f.endsWith('.mjs'));
  const live = [];
  for (const f of files) {
    const m = await import(new URL(f, approaches));
    if (m.default !== undefined) live.push(f.replace(/\.mjs$/, ''));
    else assert.ok(Object.keys(m).every((k) => k === 'adapt'), `${f} exports more than a re-export stub`);
  }
  assert.deepEqual(live.sort(), ['hybrid', 'llm-agent', 'rules', 'search']);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const self = fileURLToPath(import.meta.url);
  for (const f of [...walk(join(root, 'src')), ...walk(join(root, 'tests'))].filter((p) => /\.m?js$/.test(p) && p !== self)) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /approaches\/(adapt|core|slots)(\.mjs)?['"]/, `${f} imports a stub`);
  }
});

// Pins the limitation the comparison doc admits: on the shared engine, rules and search place blocks
// identically on every public deadline and related case, so the public split cannot separate them.
test('rules and search return identical blocks on the 400 public deadline and related cases', async () => {
  let n = 0;
  for (const k of generate({ seed: 1, perCategory: 200, prefix: 'pub' }).filter((c) => c.category === 'deadline' || c.category === 'related')) {
    const run = (p) => (k.plan ? p.replan({ plan: structuredClone(k.plan), change: k.change, events: k.events, answers: k.answers }) : p.plan({ request: k.request, events: k.events, now: k.now, context: k.context }));
    assert.deepEqual((await run(search)).blocks, (await run(rules)).blocks, k.id);
    n++;
  }
  assert.equal(n, 400);
});
