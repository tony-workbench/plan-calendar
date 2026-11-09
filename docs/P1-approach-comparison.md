# P1 approach comparison

Date: 2026-11-09

## TL;DR

All four approaches are built behind one interface (`plan({request, events, now, context})` and `replan({plan, change, events, answers})`, as defined in `benchmark/contract.mjs`) in `src/planner/approaches/`: `rules`, `search` (constraint search), `llm-agent` (model-driven) and `hybrid` (rules first, search repair). They were scored on the owner's shared benchmark, public split, 50 cases per situation (200 cases). `rules`, `search` and `hybrid` each pass 197/200; `llm-agent` has no live run yet, so its number is not a quality score. This is not a ranking: the public split cannot separate the three offline planners, and the choice belongs to P3 with hidden cases and the real model.

## Benchmark

Owner's benchmark: `node benchmark/run.mjs --approach rules,search,llm-agent,hybrid --per 50` (public split, seed 1). `tests/benchmark-record.test.mjs` runs the same generator and scorer in process for all four approaches (no key set), fails if a row below differs, and checks that the CLI runs all four.

A case counts as passed when the planner delivered and every named check (hard and commonsense) held. The earlier self-written benchmark (`src/planner/benchmark.mjs`) is supplementary only (it does not cover `llm-agent`); it produces none of the numbers below.

| Approach | Passed | basic | deadline | discovery | related | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `rules` | 197/200 | 50/50 | 50/50 | 47/50 | 50/50 | Fixed rules on the shared engine: first free slot, steps back-scheduled one per day, later blocks pushed to the first free slot, deadline not re-checked after a push. |
| `search` | 197/200 | 50/50 | 50/50 | 47/50 | 50/50 | Same constraints solved by depth-first search with backtracking; re-plans keep the deadline as a hard bound. |
| `llm-agent` | 19/200 | 1/50 | 0/50 | 18/50 | 0/50 | Replay-only: with no `GEMINI_API_KEY` the default export delivers an empty "model unavailable" result, so the benchmark runs it offline. The passes are only cases that expect no suggestion or no change. No live run exists, so this row says nothing about model quality. |
| `hybrid` | 197/200 | 50/50 | 50/50 | 47/50 | 50/50 | Rules answer first; a result that breaks a hard rule is redone by search. An optional injected model reads requests the parser cannot. |

All three offline planners miss the same 3 discovery cases: `pub-discovery-0011`, `pub-discovery-0018` and `pub-discovery-0044`. In each, the offered candidate is a generator "clash" candidate (title `Clashing Event n`) that overlaps no event (it starts exactly when a 30-minute event ends) and has a source, place and reason. `benchmark/gen.mjs` leaves it out of `validIds` because of its internal kind label, not because of an overlap, so the `only-valid` hard check fails when a planner offers a candidate that is clear of the schedule. A planner cannot know the label without reading generator internals, so no planner change is made. `tests/planner-discovery-clash.test.mjs` reproduces this: it lists the failing ids and asserts that each miss has no overlap with any event and is fully screenable, so a real overlap bug in the engine would fail the build. `benchmark/` is read-only for seats; this is raised for P2.

## Notes

- The shared engine (`src/planner/lib/engine.mjs`) holds request parsing, discovery screening and the related-item question for every approach, so the table compares placement strategies, not parsers. That also explains why the three offline approaches tie on the public split: `rules` and `search` return identical blocks on all 400 public deadline and related cases (pinned in `tests/planner-discovery-clash.test.mjs`), so no public case shows search behaving differently. The strategies differ in code (greedy push without a deadline bound versus backtracking with the deadline as a bound), and the split does not exercise that difference.
- The recorded model replies (`tests/fixtures/llm-replies.json`) are loaded only by tests, which inject them with `createFakeModel(replies)`. Fake-model runs prove the interface and reply validation, not live behaviour; they are replay-only until a live run exists.
- The `adapt` helper now lives in `src/planner/lib/adapt.mjs`. `adapt.mjs`, `core.mjs` and `slots.mjs` remain in `src/planner/approaches/` only as empty or re-export stubs (seats may not delete files); they have no default export, so the runner skips them, and nothing imports them. `tests/planner-discovery-clash.test.mjs` asserts that exactly the four approach modules have a default export, that the stubs export nothing but `adapt`, and that no source or test file imports them, so they cannot turn back into approaches. `tests/tmp-numbers.test.mjs` is an empty comment-only file for the same reason; the numbers are pinned by `tests/benchmark-record.test.mjs`. All of these can be deleted by the owner.

## Real-model scores

Not run yet. The owner's agent adds the real-model numbers (Gemini 3.8 Flash through `GEMINI_MODEL`, key from the environment) in P3.
