// node benchmark/run.mjs [--project <repo root, default: parent of this folder>] [--approach a,b] [--split public|hidden|all] [--per 250]
//              [--category basic,...] [--limit N] [--repeat 1] [--out results] [--timeout 60000]
// Hidden cases use the seed in BENCH_HIDDEN_SEED (kept on this machine, never committed).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from './gen.mjs';
import { scoreCase } from './score.mjs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const project = path.resolve(arg('project', path.join(path.dirname(new URL(import.meta.url).pathname), '..')));
const split = arg('split', 'public'), per = +arg('per', 250), limit = +arg('limit', 0), repeat = +arg('repeat', 1), out = arg('out', 'results');
const cats = arg('category', 'basic,deadline,discovery,related').split(',');
const PUBLIC_SEED = 1;

function cases() {
  let all = [];
  if (split === 'public' || split === 'all') all.push(...generate({ seed: PUBLIC_SEED, perCategory: per, prefix: 'pub' }));
  if (split === 'hidden' || split === 'all') {
    const s = +process.env.BENCH_HIDDEN_SEED; if (!s) { console.error('BENCH_HIDDEN_SEED is not set'); process.exit(2); }
    all.push(...generate({ seed: s, perCategory: per, prefix: 'hid' }));
  }
  all = all.filter((c) => cats.includes(c.category));
  if (limit) { const by = {}; all = all.filter((c) => (by[c.category] = (by[c.category] ?? 0) + 1) <= limit); }
  return all;
}
const prep = (k) => k.context?.candidates ? { ...k, context: { ...k.context, source: { find: () => k.context.candidates } } } : k;

const dir = path.join(project, 'src/planner/approaches');
const names = arg('approach') ? arg('approach').split(',') : fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
async function loadApproach(n) { try { const m = await import(pathToFileURL(path.join(dir, n + '.mjs')).href); const p = m.default; if (p && typeof p.plan === 'function' && typeof p.replan === 'function') return p; console.log(`${n}: not a planner (no default export with plan and replan)`); return null; } catch (err) { console.log(`${n}: cannot load: ${String(err.message).slice(0, 160)}`); return null; } }
const cs = cases();
fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  const planner = await loadApproach(name);
  if (!planner) { console.log(`${name}: skipped (cannot load)`); continue; }
  const file = path.join(out, `${name}.${split}.jsonl`); fs.writeFileSync(file, '');
  let pass = 0, n = 0;
  for (const k of cs) for (let rep = 0; rep < repeat; rep++) {
    const r = await scoreCase(planner, prep(structuredClone(k)), +arg('timeout', 60000));
    r.rep = rep; fs.appendFileSync(file, JSON.stringify(r) + '\n');
    n++; if (r.delivered && r.checks.length > 0 && r.checks.every((x) => x.ok)) pass++;
  }
  console.log(`${name}: ${pass}/${n} cases fully passed -> ${file}`);
}
