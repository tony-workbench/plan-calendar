import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const doc = fs.readFileSync(new URL('../docs/benchmark-review.md', import.meta.url), 'utf8');
const SEATS = ['Claude', 'AdaL', 'Kylon', 'Prelint', 'AskTheW', 'Masky', 'n8n', 'Celesto'];

const sections = () => {
  const out = {};
  for (const part of doc.split(/^## /m).slice(1)) out[part.split('\n')[0].trim()] = part;
  return out;
};

// Finding number -> [kind, benchmark file, key term]. These tests read the record only, so they
// stay valid after the owner's agent applies the agreed changes to benchmark/.
const FINDINGS = {
  1: ['Wrong check', 'score.mjs', 'awake-hours'],
  2: ['Wrong check', 'score.mjs', 'steps-ordered'],
  3: ['Wrong check', 'score.mjs', 'gap-shown'],
  4: ['Wrong expectation', 'gen.mjs', 'related'],
  5: ['Wrong expectation', 'gen.mjs', 'group'],
  6: ['Wrong expectation', 'gen.mjs', 'Clashing Event'],
  7: ['Wrong expectation', 'gen.mjs', 'thin'],
  8: ['Wrong expectation', 'gen.mjs', 'next Wednesday'],
  9: ['Missing case', 'gen.mjs', 'weekend'],
  10: ['Missing case', 'gen.mjs', 'partial-only'],
  11: ['Missing case', 'gen.mjs', 'booked'],
  12: ['Missing case', 'gen.mjs', 'minSteps'],
  13: ['Missing check', 'score.mjs', 'moved-marked'],
  14: ['Gaming', 'score.mjs', 'do-nothing baseline'],
  15: ['Silent skip', 'score.mjs', 'skipped'],
  16: ['Fragility', 'score.mjs', 'byId'],
  17: ['Runner', 'run.mjs', '--per'],
  18: ['Report', 'report.mjs', 'rules.public.jsonl'],
  19: ['Generator', 'gen.mjs', 'SUBS'],
  20: ['Baselines', 'README.md', 'first-free-slot'],
  21: ['Fairness of dimension', 'README', 'UTC'],
};

const findingsOf = (seat) => {
  const out = {};
  for (const m of sections()[`Seat: ${seat}`].matchAll(/^(\d+)\. (.*)$/gm)) out[Number(m[1])] = m[2];
  return out;
};

test('the review has one section per seat and each section states a verdict', () => {
  const s = sections();
  for (const seat of SEATS) {
    assert.ok(s[`Seat: ${seat}`], `missing section for ${seat}`);
    assert.match(s[`Seat: ${seat}`], /^Verdict: (fair with changes|not fair yet|fair|pending)\b/m, `${seat} needs a verdict line`);
  }
});

test('the Claude seat has voted', () => {
  assert.match(sections()['Seat: Claude'], /^Verdict: (fair with changes|not fair yet|fair)\b/m);
});

test('every Claude finding exists once, with its kind, file and key term', () => {
  const found = findingsOf('Claude');
  assert.deepEqual(Object.keys(found).map(Number), Object.keys(FINDINGS).map(Number));
  for (const [n, [kind, file, term]] of Object.entries(FINDINGS)) {
    assert.ok(found[n].startsWith(kind), `finding ${n} should be a ${kind} finding`);
    assert.ok(found[n].includes(file), `finding ${n} should name ${file}`);
    assert.ok(found[n].includes(term), `finding ${n} should mention ${term}`);
  }
});

test('every finding says what is wrong and which change is wanted', () => {
  for (const [n, text] of Object.entries(findingsOf('Claude'))) {
    assert.ok(text.length > 80 && /\.\s/.test(text), `finding ${n} is too thin to act on`);
  }
});

test('a seat that has not voted carries no findings', () => {
  for (const seat of SEATS.filter((x) => x !== 'Claude')) {
    if (/^Verdict: pending/m.test(sections()[`Seat: ${seat}`])) {
      assert.deepEqual(Object.keys(findingsOf(seat)), [], `${seat} has findings but no vote`);
    }
  }
});

test('a seat that wants changes lists findings', () => {
  for (const seat of SEATS) {
    if (/^Verdict: (fair with changes|not fair yet)/m.test(sections()[`Seat: ${seat}`])) {
      assert.ok(Object.keys(findingsOf(seat)).length > 0, `${seat} wants changes but lists none`);
    }
  }
});

test('agreed changes cite only findings that exist and cover every finding', () => {
  const items = [...sections()['Agreed changes'].matchAll(/^\d+\. (.*)$/gm)].map((m) => m[1]);
  assert.ok(items.length > 0);
  const cited = new Set();
  for (const item of items) {
    const nums = (item.match(/\d+/g) ?? []).map(Number);
    assert.ok(nums.length > 0, `agreed item cites no finding: ${item}`);
    for (const n of nums) {
      assert.ok(FINDINGS[n], `agreed item cites finding ${n}, which does not exist`);
      cited.add(n);
    }
  }
  for (const n of Object.keys(FINDINGS)) assert.ok(cited.has(Number(n)), `finding ${n} is in no agreed change`);
});

test('the record claims agreement only when every seat has voted', () => {
  const s = sections();
  const status = s['Agreed changes'].match(/^Status: (proposed|agreed)\b/m);
  assert.ok(status, 'Agreed changes needs a Status line');
  const voted = SEATS.filter((seat) => !/^Verdict: pending/m.test(s[`Seat: ${seat}`]));
  assert.ok(voted.includes('Claude'));
  if (status[1] === 'agreed') {
    assert.deepEqual(voted, SEATS, 'agreed needs a vote from every seat');
    for (const seat of SEATS) assert.doesNotMatch(s[`Seat: ${seat}`], /^Verdict: not fair yet/m, `${seat} has not accepted the benchmark`);
  }
});
