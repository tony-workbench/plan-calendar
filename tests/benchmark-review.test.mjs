import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generate, NOW } from '../benchmark/gen.mjs';

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
  for (const seat of SEATS.filter((s) => s !== 'Kylon' && s !== 'Claude')) {
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

test('missing cases cited as absent are absent from gen.mjs output', () => {
  const cases = generate({ seed: 1, perCategory: 200 });
  const day = (v) => v.slice(0, 10);
  assert.equal(cases.flatMap((k) => k.events).filter((e) => day(e.start) !== day(e.end)).length, 0, 'no event crosses midnight');
  const dls = cases.filter((k) => k.category === 'deadline').map((k) => k.expect.deadline);
  assert.ok(dls.length > 0 && dls.every((d) => Date.parse(d) > Date.parse(NOW) + 86400000), 'no deadline today or past');
  assert.ok(cases.filter((k) => k.sub !== 'notplan').every((k) => !/yesterday|last (week|friday|monday)|already passed/i.test(k.request)), 'no past-day request');
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

test('score.mjs still has the flagged expressions (F1, F2)', () => {
  assert.match(score, /hm\(b\.end\) <= 1410 \|\| \(hm\(b\.end\) === 0\)/);
  assert.match(score, /'gap-shown'/);
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

test('benchmark/ is unmodified from the version the review read', () => {
  for (const [, file, hash] of doc.matchAll(/^- `(benchmark\/[^`]+)` ([0-9a-f]{64})$/gm)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex'), hash, `${file} changed`);
  }
  assert.equal([...doc.matchAll(/^- `benchmark\//gm)].length, 6, 'all six benchmark files listed');
});

test('at least two seats have a real verdict, and agreement names who supports the changes', () => {
  const recorded = SEATS.filter((seat) => !/^Verdict: not recorded/m.test(section(seat)));
  assert.ok(recorded.length >= 2 && recorded.includes('Claude'), 'Claude and Kylon have recorded verdicts');
  const status = doc.match(/Agreement status: [^\n]*/)[0];
  for (const seat of recorded) assert.ok(status.includes(seat), `agreement status names ${seat}`);
  assert.doesNotMatch(status, /no other seat has recorded support/i);
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
  assert.match(m[1], /two of eight/i);
  assert.match(m[1], /seven of eight/i);
  assert.ok(doc.indexOf('## Review evidence') < doc.indexOf('## Agreed changes'));
});
