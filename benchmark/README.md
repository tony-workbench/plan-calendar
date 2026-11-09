# Plan Calendar benchmark

Scores a planner on the four situations: basic arrangement, deadline back-planning, proactive activity discovery and related-item adjustment.

## Run it

```
node benchmark/run.mjs --approach rules --per 50 --out benchmark-results
node benchmark/report.mjs benchmark-results/*.jsonl
node benchmark/report.mjs benchmark-results/*.jsonl --by-sub
```

`--by-sub` splits each situation into its sub-types, so a weak sub-type is visible.

- `--approach` is the file name in `src/planner/approaches/` without `.mjs`; leave it out to run all of them.
- `--per` is the number of cases per situation. The public split uses a fixed seed, so every run sees the same cases.
- Each case is scored by named checks. A check is either `commonsense` (a rule every sensible plan follows, such as no overlaps and no meals or sleep) or `hard` (what the user asked for in that case).
- The report shows the delivery rate, the commonsense and hard pass rates, the final pass rate with a 95% interval, the share of cases where something unrelated was moved, questions per case and time per case.

## Rules for seats

- This folder is read-only for seats. If you think a case or a check is wrong, say so in your review findings; the owner's agent changes it.
- Do not read the expected answers to make a planner pass. A planner must work from the request, the events and the context only.
- The contract a planner implements is in `contract.mjs`.

## Cases

`gen.mjs` builds cases from templates: each situation has several sub-types, and each case varies the events, free time, deadline, number of steps or candidates and the wording of the request. Hidden cases come from another seed that the owner keeps; they are not in this repository.

## Changes after the roundtable review (P2)

The checks `gap-shown`, `awake-hours` and `dependents-follow` were corrected, `collide` cases now reach the evening class, new cases cover back-to-back events, an event across midnight, a request naming a past day and a deadline today, the runner counts a pass the same way the report does and prints import errors, and the report can split by sub-type. The wording of requests in the hidden cases differs from the public wording, so a planner that only works for the public templates will not pass them.
