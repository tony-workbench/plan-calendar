// node report.mjs results/*.jsonl [--baseline name]
// Per approach and category: delivery rate, commonsense pass, hard pass, final pass (all checks), 95% interval,
// side-effect rate, mean questions, mean ms; plus gain over the baseline when given.
import fs from 'node:fs';
import path from 'node:path';
const files = process.argv.slice(2).filter((a) => a.endsWith('.jsonl'));
const bySub = process.argv.includes('--by-sub');
const bi = process.argv.indexOf('--baseline'); const baseline = bi > -1 ? process.argv[bi + 1] : null;
const wilson = (k, n) => { if (!n) return [0, 0]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
const pct = (x) => (100 * x).toFixed(1) + '%';
const rows = {};
for (const f of files) {
  const name = path.basename(f).split('.')[0];
  for (const line of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line); const cat = bySub ? r.category + '/' + r.sub : r.category; const key = name + '|' + cat; const a = rows[key] ??= { name, cat, n: 0, del: 0, cs: 0, hd: 0, fin: 0, side: 0, q: 0, ms: 0 };
    a.n++; a.del += r.delivered ? 1 : 0;
    a.cs += r.delivered && r.checks.filter((c) => c.type === 'commonsense').every((c) => c.ok) ? 1 : 0;
    a.hd += r.delivered && r.checks.filter((c) => c.type === 'hard').every((c) => c.ok) ? 1 : 0;
    a.fin += r.delivered && r.checks.length && r.checks.every((c) => c.ok) ? 1 : 0;
    a.side += r.sideEffects > 0 ? 1 : 0; a.q += r.questions; a.ms += r.ms;
  }
}
const finalOf = (name, cat) => { const a = rows[name + '|' + cat]; return a ? a.fin / a.n : null; };
console.log('| approach | category | n | delivered | commonsense | hard | final pass (95% interval) | cases with unrelated moves | questions/case | ms/case |' + (baseline ? ' vs baseline |' : ''));
console.log('|---|---|---|---|---|---|---|---|---|---|' + (baseline ? '---|' : ''));
for (const a of Object.values(rows).sort((x, y) => x.cat.localeCompare(y.cat) || x.name.localeCompare(y.name))) {
  const [lo, hi] = wilson(a.fin, a.n); const b = baseline ? finalOf(baseline, a.cat) : null;
  console.log(`| ${a.name} | ${a.cat} | ${a.n} | ${pct(a.del / a.n)} | ${pct(a.cs / a.n)} | ${pct(a.hd / a.n)} | ${pct(a.fin / a.n)} (${pct(lo)}–${pct(hi)}) | ${pct(a.side / a.n)} | ${(a.q / a.n).toFixed(2)} | ${Math.round(a.ms / a.n)} |` + (baseline ? ` ${b === null ? '-' : ((a.fin / a.n - b) * 100).toFixed(1) + ' pts'} |` : ''));
}
