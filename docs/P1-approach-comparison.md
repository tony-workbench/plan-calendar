# P1 approach comparison

Date: 2026-11-09

## TL;DR

Two of the four planned approaches are built and benchmarked: `rules` and `llm-agent`. Constraint search and the hybrid are not built yet, so they are not in the table and are not recommended. Both built planners sit behind the shared interface (`plan({request, events, now, context})` and `replan({plan, change, events, answers})`, defined in `src/planner/interface.mjs`) and are scored by one fixed benchmark, `src/planner/benchmark.mjs`, which runs each through `enforce()` so a result that breaks the interface fails its situation. `rules` fails S4 (it never asks about related items); `llm-agent` passes all four, and the two quality scores (delay, shift) are reported separately. The `llm-agent` score comes from a fake model replaying recorded replies (`tests/fixtures/llm-replies.json`, no key), so it shows that the interface and reply validation work, not how a live model would do. Real-model scores come from the coordinator (see the placeholder below).

## Benchmark

`node --test tests/planner-record.test.mjs` re-runs `runBenchmark` from `src/planner/benchmark.mjs` and fails if a row below differs from the measured numbers or if the table lists a planner that is not benchmarked.

Not used: the owner's shared benchmark (`benchmark/run.mjs`) is not present in this tree, so these numbers are not from it. They come only from the self-written benchmark above. Re-run the owner's benchmark when it is available; its numbers would replace these.

Columns: situations passed out of 4; pass or FAIL for S1 basic arrangement, S2 deadline back-planning (including drag and more time), S3 proactive discovery, S4 related-item adjustment; then totals over the four situations of hard-rule violations (overlap with a fixed event or another block, order, deadline, moved fixed or unrelated item), questions asked, and other blocks that moved. Two quality scores, lower is better: Delay is the minutes from now to the S1 block (slot quality); Shift is the minutes that other blocks moved from their earlier start during re-plans in S2 and S4 (minimal moves).

What the benchmark checks beyond the hard rules: one block of 30 minutes for S1; three ordered steps before the deadline, the dragged step left where the user put it and moved steps marked, and a step made one hour longer for S2; a few tentative candidates with place, reason and source, one light prompt, and nothing for thin information or an ignored prompt for S3; and for S4 one merged question naming shopping, cooking and dinner but not the unrelated groceries, nothing moved before the answer, only confirmed items moved, and a refused link not asked again.

| Approach | Passed | S1 | S2 | S3 | S4 | Violations | Questions | Moved | Delay | Shift | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rules` | 3/4 | pass | pass | pass | FAIL | 2 | 1 | 3 | 0 | 240 | Fixed rules: shared first-fit and back-scheduling, then set the changed block and push its dependent steps. Deterministic; no model. Never asks about related items, so S4 fails. |
| `llm-agent` | 4/4 | pass | pass | pass | pass | 0 | 2 | 2 | 0 | 180 | A model places the blocks; the planner builds the prompt, calls the activity source as a tool and validates the reply (JSON, block shape, no overlap with fixed events). Fake model replaying recorded replies, no key. The score reflects the recordings, not a live model. |

## Recommended base planner

Recommendation only: this is not a vote and does not decide the build.

Recommended: `rules`, from the two planners benchmarked, as the deterministic, key-free base to extend. It passes S1 to S3 and its offline results are stable. It must still gain related-item questions to pass S4, where it currently fails.

Limits: `llm-agent` passes 4/4 with 0 violations, but its replies were recorded for these exact situations, so the result says nothing about live-model quality; a live adapter (`createGeminiModel`) exists but has not been run here. With two planners this is not a comparison of four approaches; constraint search and the hybrid are not built yet and are not recommended. The real-model scores below may change this.

## Real-model scores

Placeholder: the coordinator adds the real-model scores (Gemini 3.8 Flash through `GEMINI_MODEL`, key from the environment) here. Nothing is filled in by this part. The approval vote on this build is not final until the coordinator fills in these scores.
