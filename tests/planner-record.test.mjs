// The comparison record in docs/ must hold the numbers of the one fixed benchmark
// (src/planner/benchmark.mjs), measured now on all four approaches through the registry.
// Set PRINT_BENCH=1 to print the measured rows (used to fill docs/P1-approach-comparison.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBenchmark } from '../src/planner/benchmark.mjs';
import { loadApproach } from '../src/planner/registry.mjs';

const APPROACHES = ['rules', 'constraint', 'hybrid', 'llm-agent'];
const SITUATION_IDS = ['basic', 'deadline', 'discovery', 'related'];
const doc = readFileSync(new URL('../docs/P1-approach-comparison.md', import.meta.url), 'utf8');

// Numbers only (no timing): passed/4, pass or FAIL per situation, then summed violations, questions, moved.
function cells(result) {
  const { situations, totals } = result;
  return [
    `${totals.passed}/${totals.total}`,
    ...situations.map((s) => (s.pass ? 'pass' : 'FAIL')),
    String(totals.violations),
    String(totals.questions),
    String(totals.moved),
  ];
}

async function measure() {
  delete process.env.GEMINI_API_KEY; // the benchmark must never reach the network
  const table = {};
  for (const name of APPROACHES) {
    const planner = await loadApproach(name);
    assert.ok(planner, `approach ${name} must load and implement the interface`);
    table[name] = await runBenchmark(planner);
  }
  return table;
}

function recorded(name) {
  const row = doc.split('\n').find((line) => line.startsWith('|') && line.includes(`\`${name}\``));
  assert.ok(row, `record has no table row for ${name}`);
  return row.split('|').slice(2, 10).map((c) => c.trim());
}

test('every approach is scored on the same four situations by the fixed benchmark', async () => {
  const table = await measure();
  for (const name of APPROACHES) {
    assert.deepEqual(table[name].situations.map((s) => s.id), SITUATION_IDS, name);
    assert.equal(table[name].totals.total, 4, name);
    if (process.env.PRINT_BENCH) {
      console.log(`| \`${name}\` | ${cells(table[name]).join(' | ')} |`);
      for (const s of table[name].situations) if (!s.pass) console.log(`  ${name} ${s.id}: ${s.failures.join('; ')}`);
    }
  }
});

test('the planners still meet the hard rules the record names', async () => {
  // A regression in any planner on the real benchmark must fail here, not only change the record.
  const table = await measure();
  for (const name of APPROACHES) {
    assert.equal(table[name].totals.violations, 0, `${name} broke a hard rule (overlap, order, deadline, moved fixed or unrelated item)`);
  }
});

test('the comparison record holds the measured benchmark numbers', async () => {
  const table = await measure();
  const measured = APPROACHES.map((name) => `| \`${name}\` | ${cells(table[name]).join(' | ')} |`);
  const written = APPROACHES.map((name) => `| \`${name}\` | ${recorded(name).join(' | ')} |`);
  assert.deepEqual(written, measured, 'the record rows must hold the numbers measured by src/planner/benchmark.mjs');
});

test('the record has a date, a labelled recommendation naming a measured approach, and no votes', () => {
  assert.match(doc, /\b20\d\d-\d\d-\d\d\b/, 'record needs a date');
  assert.match(doc, /TL;DR/i);
  assert.match(doc, /recommendation only/i, 'the recommendation must be labelled as a recommendation');
  const pick = doc.match(/^Recommended: `([a-z-]+)`/m);
  assert.ok(pick && APPROACHES.includes(pick[1]), 'the record must name one of the four approaches as recommended');
  assert.match(doc, /Real-model scores/i, 'record needs the placeholder for real-model scores');
  assert.doesNotMatch(doc, /not measured|provisional/i);
  assert.doesNotMatch(doc, /voted for|my vote|votes? cast/i, 'the record must not contain votes');
});
