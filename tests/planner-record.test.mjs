import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runBenchmark } from '../src/planner/benchmark.mjs';
import { createAgent, createFakeModel } from '../src/planner/approaches/llm-agent.mjs';

const doc = readFileSync(new URL('../docs/P1-approach-comparison.md', import.meta.url), 'utf8');

test('the record table matches the benchmark output', async () => {
  const rows = await runBenchmark();
  const names = Object.keys(rows);
  assert.ok(names.length >= 2);
  const cellsOf = (name, r) => [`\`${name}\``, `${r.passed}/4`, ...r.situations, r.violations, r.questions, r.moved, r.delay, r.shift].map(String);
  const docRows = doc.split('\n').filter((l) => /^\| `[a-z-]+` \|/.test(l)).map((l) => l.split('|').slice(1, 12).map((c) => c.trim()));
  assert.deepEqual(docRows, Object.entries(rows).map(([n, r]) => cellsOf(n, r)), 'record table differs from the benchmark');
  for (const [name, r] of Object.entries(rows)) {
    const cells = [`\`${name}\``, `${r.passed}/4`, ...r.situations, r.violations, r.questions, r.moved, r.delay, r.shift].map(String);
    const line = doc.split('\n').find((l) => l.startsWith(`| \`${name}\` |`));
    assert.ok(line, `${name} row missing from the record`);
    assert.deepEqual(line.split('|').slice(1, 12).map((c) => c.trim()), cells, `${name} row differs from the benchmark`);
  }
  const listed = doc.split('\n').filter((l) => /^\| `[a-z-]+` \|/.test(l)).map((l) => l.split('`')[1]);
  assert.deepEqual(listed.sort(), names.sort(), 'record lists exactly the benchmarked planners');
});

test('every planner module under approaches/ is benchmarked and the record is honest about the four-approach target', async () => {
  const dir = new URL('../src/planner/approaches/', import.meta.url);
  const found = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const m = await import(new URL(f, dir));
    if (typeof m.default?.plan === 'function' && typeof m.default?.replan === 'function') found.push(f.replace(/\.mjs$/, ''));
  }
  const names = Object.keys(await runBenchmark());
  assert.deepEqual(found.sort(), names.sort(), 'a planner module exists that the benchmark does not run (or the reverse)');
  if (names.length < 4) {
    assert.match(doc, /not built yet/, 'fewer than four approaches exist, so the record must say the rest are not built');
    assert.match(doc, /not recommended/, 'the record must not recommend an unbuilt approach');
  }
});

test('llm-agent fails loudly on an unrecorded request', async () => {
  const model = createFakeModel({});
  await assert.rejects(() => model.complete({ key: 'plan|never recorded' }), /no recorded reply/);
  await assert.rejects(
    () => createAgent({ model }).plan({ request: 'never recorded', events: [], now: new Date('2026-01-05T08:00:00Z') }),
    /no recorded reply/,
  );
});

test('llm-agent rejects a malformed model reply', async () => {
  const bad = { async complete() { return JSON.stringify({ notes: [] }); } };
  await assert.rejects(
    () => createAgent({ model: bad }).plan({ request: 'x', events: [], now: new Date('2026-01-05T08:00:00Z') }),
    /no blocks/,
  );
  const notJson = { async complete() { return 'not json'; } };
  await assert.rejects(
    () => createAgent({ model: notJson }).plan({ request: 'x', events: [], now: new Date('2026-01-05T08:00:00Z') }),
  );
});
