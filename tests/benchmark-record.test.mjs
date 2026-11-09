import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase } from '../benchmark/score.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['rules', 'search', 'llm-agent', 'hybrid'];
const doc = readFileSync(path.join(root, 'docs/P1-approach-comparison.md'), 'utf8');
const cells = (name) => doc.split('\n').find((l) => l.startsWith(`| \`${name}\` |`))?.split('|').slice(2, 7).map((c) => c.trim());
const prep = (k) => (k.context?.candidates ? { ...k, context: { ...k.context, source: { find: () => k.context.candidates } } } : k);

// Same scoring as `node benchmark/run.mjs --split public`, in process.
async function runPublic(name, per) {
  const planner = (await import(pathToFileURL(path.join(root, 'src/planner/approaches', `${name}.mjs`)).href)).default;
  const by = {};
  let pass = 0, n = 0;
  for (const k of generate({ seed: 1, perCategory: per, prefix: 'pub' })) {
    const r = await scoreCase(planner, prep(structuredClone(k)), 20000);
    const ok = r.delivered && r.checks.every((x) => x.ok);
    n++;
    if (ok) pass++;
    (by[k.category] ??= { n: 0, pass: 0 }).n++;
    if (ok) by[k.category].pass++;
  }
  return { pass, n, by };
}

test('the record table matches the owner benchmark (public split, 50 per situation) for all four approaches', async () => {
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    for (const name of NAMES) {
      const { pass, n, by } = await runPublic(name, 50);
      const want = [`${pass}/${n}`, ...['basic', 'deadline', 'discovery', 'related'].map((c) => `${by[c].pass}/${by[c].n}`)];
      assert.deepEqual(cells(name), want, `${name} row differs from the benchmark`);
    }
  } finally {
    if (key !== undefined) process.env.GEMINI_API_KEY = key;
  }
});

test('node benchmark/run.mjs runs all four approaches through the CLI', () => {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  const out = execFileSync(process.execPath, ['benchmark/run.mjs', '--approach', NAMES.join(','), '--per', '2', '--out', mkdtempSync(path.join(tmpdir(), 'bench-'))], { cwd: root, env, encoding: 'utf8' });
  for (const name of NAMES) assert.match(out, new RegExp(`^${name}: \\d+/\\d+ cases fully passed`, 'm'), `${name} did not run`);
  assert.doesNotMatch(out, /skipped/);
});

test('the record states the owner benchmark exists and labels llm-agent as replay-only', () => {
  assert.doesNotMatch(doc, /not present in this tree/);
  assert.match(doc, /benchmark\/run\.mjs/);
  assert.match(doc, /Replay-only/);
  assert.doesNotMatch(doc, /Placeholder/);
});
