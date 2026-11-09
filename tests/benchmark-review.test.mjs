import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generate } from '../benchmark/gen.mjs';
import { scoreCase } from '../benchmark/score.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const doc = read('../docs/benchmark-review.md');
const score = read('../benchmark/score.mjs');
const SEATS = ['Claude', 'AdaL', 'Kylon', 'Prelint', 'AskTheW', 'Masky', 'n8n', 'Celesto'];
const section = (seat) => {
  const m = doc.match(new RegExp(`^## Verdict: ${seat}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  assert.ok(m, `section for ${seat}`);
  return m[1];
};
const VERDICT = /^Verdict: (fair with changes|fair|unfair|needs changes[^\n.]*|not recorded)\b/m;

test('every seat has a section with a verdict line; none is filler', () => {
  for (const seat of SEATS) {
    const s = section(seat);
    assert.match(s, VERDICT, `verdict line for ${seat}`);
    assert.doesNotMatch(s, /No separate findings/i, `${seat} section is filler`);
    if (/^Verdict: not recorded/m.test(s)) assert.match(s, /has not added|still to be added/, `${seat}: states why not recorded`);
    else assert.ok(s.length > 400, `${seat}: a recorded verdict needs reasoning and findings`);
  }
});

test('the record does not cast votes for other seats', () => {
  for (const seat of SEATS.filter((s) => !['Kylon', 'Claude', 'AdaL'].includes(s))) {
    const s = section(seat);
    if (!/^Verdict: not recorded/m.test(s)) assert.fail(`${seat} verdict recorded without evidence of its own vote`);
  }
});

test('Kylon findings cover checks, generator, runner and report', () => {
  const s = section('Kylon');
  assert.ok((s.match(/^- F\d+ /gm) || []).length >= 6);
  for (const f of ['gen.mjs', 'score.mjs', 'run.mjs', 'report.mjs']) assert.ok(s.includes(f), `mentions ${f}`);
  assert.match(s, /situations/);
});

test('every check named in a finding exists in score.mjs', () => {
  const names = [...section('Kylon').matchAll(/^- F\d+ `([a-z-]+)` \((?:deadline, tight|all situations|related, `known`)/gm)].map((m) => m[1]);
  assert.ok(names.includes('gap-shown') && names.includes('awake-hours'));
  for (const n of names) assert.ok(score.includes(`'${n}'`), `check ${n} exists in score.mjs`);
});

test('the related-case findings reproduce from gen.mjs', () => {
  const ms = Date.parse;
  const known = generate({ seed: 1, perCategory: 400 }).filter((k) => k.sub === 'known');
  const noMove = known.filter((k) => {
    const [a, b] = k.plan.blocks;
    return ms(b.start) >= ms(k.change.start) + (ms(a.end) - ms(a.start));
  });
  assert.ok(noMove.length > 0, 'F3: some known cases need no move');
  assert.match(doc, new RegExp(`${noMove.length} of ${known.length} .known. cases`));
});

test('every agreed change traces to a finding, and every finding is used', () => {
  const m = doc.match(/^## Agreed changes\n([\s\S]*)$/m);
  assert.ok(m, 'agreed changes section');
  const items = m[1].match(/^\d+\. .*$/gm) || [];
  assert.ok(items.length >= 3);
  const used = new Set();
  for (const it of items) {
    if (/^\d+\. \(C\d+\)/.test(it)) continue; // Prelint concern changes are checked in benchmark-review-concerns.test.mjs
    const refs = it.match(/\(F\d+(?:, F\d+)*\)/);
    assert.ok(refs, `change cites a finding: ${it.slice(0, 40)}`);
    for (const f of refs[0].match(/F\d+/g)) { used.add(f); assert.match(section('Kylon'), new RegExp(`^- ${f} `, 'm'), `${f} exists`); }
  }
  for (const f of section('Kylon').match(/^- F\d+/gm)) assert.ok(used.has(f.slice(2)), `${f.slice(2)} has an agreed change`);
  assert.match(m[1], /Agreement status/);
});

// Probes run the real checks on stub planners, so status and behaviour are judged on the benchmark in this tree.
const cases = generate({ seed: 1, perCategory: 200 });
const blk = (id, start, end) => ({ id, title: id, start, end });
const verdictOf = async (k, blocks, extra, name) => {
  const planner = { plan: async () => ({ blocks, notes: [], question: null, ...extra }), replan: async () => ({ blocks, notes: [], question: null }) };
  return (await scoreCase(planner, k)).checks.find((x) => x.name === name)?.ok;
};
const awakeOk = (start, end) => verdictOf(cases.find((k) => k.sub === 'simple'), [blk('b1', start, end)], {}, 'awake-hours');
const tight = cases.find((k) => k.sub === 'tight');
const tightBlocks = [blk('s1', '2026-11-09T13:00:00.000Z', '2026-11-09T14:00:00.000Z'), blk('s2', '2026-11-12T13:00:00.000Z', '2026-11-12T14:00:00.000Z')];
const gapOk = (extra) => verdictOf(tight, tightBlocks, extra, 'gap-shown');
const F2_APPLIED = (await awakeOk('2026-11-10T03:00:00.000Z', '2026-11-11T00:00:00.000Z')) === false;
const F1_APPLIED = (await gapOk({})) === false;

test('F2: a block 03:00-00:00 fails awake-hours; 20:00-00:00 and daytime blocks pass', { skip: !F2_APPLIED && 'F2 not applied in this tree (status open)' }, async () => {
  assert.equal(await awakeOk('2026-11-10T03:00:00.000Z', '2026-11-11T00:00:00.000Z'), false);
  assert.equal(await awakeOk('2026-11-10T20:00:00.000Z', '2026-11-11T00:00:00.000Z'), true);
  assert.equal(await awakeOk('2026-11-10T09:00:00.000Z', '2026-11-10T10:00:00.000Z'), true);
});

test('F1: a tight case with no note and no question fails gap-shown; a note or a question passes', { skip: !F1_APPLIED && 'F1 not applied in this tree (status open)' }, async () => {
  assert.equal(await gapOk({}), false);
  assert.equal(await gapOk({ notes: ['This does not fit before the deadline'] }), true);
  assert.equal(await gapOk({ question: { text: 'Which step can move?', items: ['s1'] } }), true);
});

const runSrc = read('../benchmark/run.mjs'), reportSrc = read('../benchmark/report.mjs'), genSrc = read('../benchmark/gen.mjs');
const crossDay = (e) => e.start.slice(0, 10) !== e.end.slice(0, 10);
const subs = (re) => cases.some((k) => re.test(k.sub || ''));
const F5_APPLIED = cases.some((k) => (k.events || []).some(crossDay)) && subs(/back-?to-?back|b2b/i) &&subs(/today/i) && subs(/past/i);
const F6_APPLIED = (genSrc.match(/\['unknown', \d+\]/g) || []).length === 1;
const F7_APPLIED = /checks\.length/.test(runSrc) && /cannot load[^\n]*\$\{/.test(runSrc);
const F9_APPLIED = /\.sub\b/.test(reportSrc);
const APPLIED = { 1: F1_APPLIED, 2: F2_APPLIED, 5: F5_APPLIED, 6: F6_APPLIED, 7: F7_APPLIED, 8: F9_APPLIED };

test('F5: cross-midnight event, back-to-back, deadline today and past-day cases exist', { skip: !F5_APPLIED && 'F5 not applied in this tree (status open)' }, () => {
  assert.ok(cases.some((k) => (k.events || []).some(crossDay)), 'cross-midnight event');
  for (const re of [/back-?to-?back|b2b/i, /today/i, /past/i]) assert.ok(subs(re), String(re));
});

test('F6: the related sub-type list names each sub-type once', { skip: !F6_APPLIED && 'F6 not applied in this tree (status open)' }, () => {
  assert.equal((genSrc.match(/\['unknown', \d+\]/g) || []).length, 1);
});

test('F7 to F10: runner pass rule, load errors and per-sub-type report', { skip: !(F7_APPLIED && F9_APPLIED) && 'F7 to F10 not applied in this tree (status open)' }, () => {
  assert.match(runSrc, /checks\.length/);
  assert.match(runSrc, /cannot load[^\n]*\$\{/);
  assert.match(reportSrc, /\.sub\b/);
});

test('every agreed change has a status that matches this tree, and agreement is limited to the seats that voted', () => {
  const m = doc.match(/^## Agreed changes\n([\s\S]*)$/m)[1];
  const items = m.match(/^\d+\. .*$/gm) || [];
  for (const it of items) assert.match(it, /Status: (applied|open)\.$/, it.slice(0, 40));
  const status = (n) => items.find((it) => it.startsWith(`${n}. `)).match(/Status: (applied|open)\.$/)[1];
  for (const [n, applied] of Object.entries(APPLIED)) assert.equal(status(n) === 'applied', applied, `change ${n} status matches the benchmark in this tree`);
  assert.match(m, /Agreement covers only the seats that voted/);
});

test('pinned hashes match the benchmark files in this tree', () => {
  const pins = [...doc.matchAll(/^- `(benchmark\/[^`]+)` ([0-9a-f]{64})$/gm)];
  assert.equal(pins.length, 6);
  for (const [, file, hash] of pins) assert.equal(createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex'), hash, `${file} hash is current`);
});

test('at least two seats have a real verdict, and agreement names who supports the changes', () => {
  const recorded = SEATS.filter((seat) => !/^Verdict: not recorded/m.test(section(seat)));
  assert.ok(recorded.length >= 2 && recorded.includes('Claude'), 'Claude and Kylon have recorded verdicts');
  const status = doc.match(/Agreement status: [^\n]*/)[0];
  for (const seat of recorded) assert.ok(status.includes(seat), `agreement status names ${seat}`);
  assert.doesNotMatch(status, /no other seat has recorded support/i);
});

test('regression: the AdaL seat has its own recorded verdict that covers every finding and the agreed changes', () => {
  const s = section('AdaL');
  assert.doesNotMatch(s, /^Verdict: not recorded/m);
  assert.match(s, /own vote/);
  for (const n of ['C4', 'C5', 'C6', 'C7']) assert.ok(s.includes(n), `AdaL names ${n}`);
  assert.match(doc.match(/Agreement status: [^\n]*/)[0], /AdaL/);
  assert.match(s, /F1 to F10/);
  assert.equal(section('Kylon').match(/^- F\d+/gm).length, 10, 'F1 to F10 is the full finding list');
});

test('AdaL claims about the code are true: line references, report option, load error', () => {
  const s = section('AdaL');
  const ref = (file, src, n, re) => {
    assert.ok(s.includes(`\`${file}\` line ${n}`), `AdaL cites ${file} line ${n}`);
    assert.match(src.split('\n')[n - 1], re, `${file} line ${n}`);
  };
  ref('score.mjs', score, 63, /gap-shown.*notes\.length > 0 \|\| !!r\.question/);
  ref('score.mjs', score, 28, /awake-hours.*dayStart/);
  ref('score.mjs', score, 122, /dependents-follow.*needsMove/);
  ref('run.mjs', runSrc, 42, /checks\.length > 0/);
  const srcs = { score, run: runSrc, report: reportSrc };
  for (const [, file, n] of s.matchAll(/`(score|run|report)\.mjs` line (\d+)/g)) assert.ok(+n <= srcs[file].split('\n').length, `${file}.mjs line ${n} exists`);
  const m = s.match(/`loadApproach` prints `([^`]+)`/);
  assert.ok(m, 'AdaL names the loadApproach message');
  assert.ok(runSrc.includes('`${n}: ' + m[1] + ' '), 'loadApproach prints that message with the import error');
  assert.match(s, /--by-sub/);
  assert.match(reportSrc, /process\.argv\.includes\('--by-sub'\)/);
  const col = s.match(/`(cases with unrelated moves)` column/);
  assert.ok(col && reportSrc.includes(col[1]), 'report has the unrelated-moves column');
});

test('the Claude verdict covers every Kylon finding; a not-recorded section does not claim to be addressed', () => {
  const c = section('Claude');
  for (const f of section('Kylon').match(/^- F\d+/gm)) assert.ok(c.includes(f.slice(2)), `Claude's verdict covers ${f.slice(2)}`);
  assert.doesNotMatch(section('Masky'), /are addressed in this revision/);
});

test('the record carries its own evidence and says the changes are only proposed', () => {
  const m = doc.match(/^## Review evidence\n([\s\S]*?)(?=^## )/m);
  assert.ok(m, 'review evidence section');
  assert.match(m[1], /node --test tests\/benchmark-review\.test\.mjs/);
  assert.match(m[1], /node benchmark\/run\.mjs/);
  assert.match(m[1], /proposed, not agreed/);
  assert.match(m[1], /three of eight/i);
  assert.match(m[1], /seven of eight/i);
  assert.ok(doc.indexOf('## Review evidence') < doc.indexOf('## Agreed changes'));
});

test('regression: evidence names every recorded seat and says the missing votes block agreement', () => {
  const m = doc.match(/^## Review evidence\n([\s\S]*?)(?=^## )/m)[1];
  const findings = m.match(/- Findings are in[^\n]*/)[0];
  const recorded = SEATS.filter((seat) => !/^Verdict: not recorded/m.test(section(seat)));
  for (const seat of recorded) assert.ok(findings.includes(seat), `evidence findings line names ${seat}`);
  const blocked = m.match(/- Blocked on the seats' own votes[^\n]*/);
  assert.ok(blocked, 'evidence says plainly which seats block agreement');
  for (const seat of SEATS.filter((s) => !recorded.includes(s))) assert.ok(blocked[0].includes(seat), `blocked line names ${seat}`);
});

test('regression: Claude records its own vote on changes 9 to 12, and agreement status counts three supporting seats', () => {
  assert.match(section('Claude'), /changes 9 to 12 \(C4 to C7\)[^\n]*support all four/);
  const status = doc.match(/Agreement status: [^\n]*/)[0];
  assert.match(status, /supported by Claude and AdaL \(three of eight seats\)/);
  assert.doesNotMatch(status, /Claude has not voted/);
});
