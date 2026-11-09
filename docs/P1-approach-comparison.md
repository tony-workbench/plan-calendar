# P1 approach comparison

Date: 2026-11-09

## TL;DR

Four planners are meant to sit behind one interface (`plan({request, events, now, context})` and `replan({plan, change, events, answers})`, defined in `src/planner/interface.mjs`). They are scored by one fixed benchmark, `src/planner/benchmark.mjs`, which runs every planner through `enforce()` so a result that breaks the interface fails its situation. All four planners now implement the shared interface (`constraint` and `hybrid` through a thin adapter in `src/planner/approaches/adapt.mjs`) and pass all four situations with no hard-rule violations, so the benchmark does not separate them on this fixture. The `llm-agent` row uses recorded replies from a fake model, so it shows that the tool loop and its guard rails work, not how well a real model plans. Real-model scores come from the coordinator (see the placeholder below).

## Benchmark

`node --test tests/planner-record.test.mjs` re-runs `runBenchmark` from `src/planner/benchmark.mjs` on all four approaches and fails if a row below differs from the measured numbers, or if any planner shows a hard-rule violation. There is no other benchmark.

Columns: situations passed out of 4; pass or FAIL for S1 basic arrangement, S2 deadline back-planning (including drag and more time), S3 proactive discovery, S4 related-item adjustment; then totals over the four situations of hard-rule violations (overlap with a fixed event or another block, order, deadline, moved fixed or unrelated item), questions asked, and other blocks that moved.

What the benchmark checks beyond the hard rules: one block of 30 minutes for S1; three ordered steps before the deadline, the dragged step left where the user put it and moved steps marked for S2; a few tentative candidates with place, reason and source, one light prompt, and nothing for thin information or an ignored prompt for S3; and for S4 one merged question naming shopping, cooking and dinner but not the unrelated groceries, nothing moved before the answer, only confirmed items moved, and a refused link not asked again.

| Approach | Passed | S1 | S2 | S3 | S4 | Violations | Questions | Moved | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rules` | 4/4 | pass | pass | pass | pass | 0 | 2 | 4 | Keyword intent plus fixed slot rules; no model. |
| `constraint` | 4/4 | pass | pass | pass | pass | 0 | 2 | 6 | Interval search with back-scheduling, behind an adapter onto the shared interface. Fully deterministic; no model. |
| `hybrid` | 4/4 | pass | pass | pass | pass | 0 | 2 | 6 | Same core as `constraint` with a placement scorer and hint-based related items; same adapter. |
| `llm-agent` | 4/4 | pass | pass | pass | pass | 0 | 2 | 5 | Fake model with recorded replies; no key, no network. Code enforces the rules around the model. |

Caveat: the `llm-agent` replies in `tests/fixtures/llm-replies.json` were written for this benchmark. They show that its tool loop, interface shape and guard rails hold, not how well a real model plans. A four-way tie means the fixture checks conformance and the hard rules; it is not evidence that the planners are equally good.

## Recommended base planner

Recommendation only: this is not a vote and does not decide the build.

Recommended: `llm-agent`. Reasons:

- The product direction has the Calendar Agent choose its own tool calls with Gemini, so P3 needs this loop anyway; picking it avoids building a second path.
- It implements the one interface and ties `rules` on the benchmark (4/4, no violations). The tie says only that both satisfy the checks; with recorded replies it is not evidence that it plans better.
- Its tools and wrapper enforce the hard rules in code: fixed events never move, deadline and order, one merged question that is never repeated for asked or refused items, and only the changed block, its dependents and confirmed items may move.
- Offline tests stay deterministic through the fake model.

Risk: its result rests on recorded replies. The real-model scores below must confirm it; the deterministic `rules`, `constraint` and `hybrid` planners pass the same benchmark and remain fallbacks when no model is available.

## Real-model scores

Placeholder: the coordinator adds the real-model scores (Gemini 3.8 Flash through `GEMINI_MODEL`, key from the environment) here. Nothing is filled in by this part. The approval vote on this build is not final until the coordinator fills in these scores.
