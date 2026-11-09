# Approach decision (P3)

Record of the owner's benchmark run and the choice of approach. The numbers are the owner's; the coding seats copied them and did not rerun them.

## Decision

The choice is voted by all eight seats in the roundtable round that promotes this record.

Best approach: **hybrid-live**. The real model understands the request, `src/planner/core.mjs` plans, asks one merged question, remembers refusals and checks the rules. On wording that was not used for tuning it passed 239 of 240 cases (99.6 percent); see the final scorecard below.

Gain over the baselines:
- +36 percentage points over the one-shot model answer (gemini one-shot, 64 percent).
- +26 percentage points over the plain code parser (hybrid offline, 73 percent).
- No plain first-free-slot calendar baseline was run. The offline regex parser (73 percent) stands in for the plain code baseline; the gain over a true first-free-slot calendar is unmeasured.

## Final scorecard (final code, wording not seen while tuning)

One fresh set of 240 cases (60 per situation), wording written by a model after the last code change and never used to tune, real Gemini 3.8 Flash, all three approaches on the same cases. Final pass rate with the Wilson 95 percent interval in brackets.

| Approach | Passed | Rate [95% interval] | basic | deadline | discovery | related |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid-live (final) | 239 / 240 | 99.6% [97.7-99.9] | 100 [94-100] | 100 [94-100] | 98 [91-100] | 100 [94-100] |
| hybrid (offline regex understanding) | 176 / 240 | 73.3% [67.4-78.5] | 60 [47-71] | 33 [23-46] | 100 [94-100] | 100 [94-100] |
| gemini one-shot (model only, no code rules) | 153 / 240 | 63.8% [57.5-69.5] | 92 [82-96] | 20 [12-32] | 85 [74-92] | 58 [46-70] |

A second fresh set of the same size (other seed, other wording) gave 238 / 240 for hybrid-live. The two misses there and the one here are a "what should I get up to this Friday night?" with no candidates, and two "need two hours blocked out ..." messages the model did not read as a request. Earlier sets used while tuning passed 240 / 240.

Typical time per request with the live model is 2 to 2.7 seconds, nearly all of it the model reading the sentence; dragging a block takes no model call.

The benchmark scorer counts a block that already overlaps a fixed event in the given plan as the plan's fault, not the planner's.

## Earlier scorecard (before the final changes)

Owner's run: `benchmark/` at the repo, private held-out wording written by a model, real Gemini 3.8 Flash, 240 cases per approach, 60 per situation. Final pass rate, with the 95 percent interval in brackets. The owner's report did not hand over numeric intervals; the brackets below are Wilson intervals (the formula in `benchmark/report.mjs`) computed by the coding seat from the owner's pass counts (per-situation counts are the rate times 60). They are derived, not rerun.

| Approach | Passed | Rate [95% interval] | basic | deadline | discovery | related |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid (offline regex understanding) | 190 / 240 | 79% [74-84] | 67 [54-77] | 50 [38-62] | 100 [94-100] | 100 [94-100] |
| hybrid-live | 233 / 240 | 97% [94-99] | 100 [94-100] | 88 [78-94] | 100 [94-100] | 100 [94-100] |
| rules | 190 / 240 | 79% [74-84] | identical to hybrid, the regex parser is the same | | | |
| gemini one-shot (model only, no code rules) | 161 / 240 | 67% [61-73] | 70 [57-80] | 67 [54-77] | 75 [63-84] | 57 [44-68] |
| agent-live (roundtable Agent loop, real model) | 89 / 240 | 37% [31-43] | 90 [80-95] | 42 [30-54] | 0 [0-6] | 17 [9-28] |

Public wording, from the committed run in `results/` (200 cases per approach, 50 per situation, offline planners): hybrid, rules, search and agent each pass 200 of 200 (100 percent, interval 98-100; 92.9-100 per situation). Recompute with `node benchmark/report.mjs results/*.public.jsonl`. The public-wording numbers for hybrid-live and gemini one-shot are not in this tree, so this record does not state them; every approach was run on the private set (table above).

After the final intent-reader improvements (all fields required, wider date parsing, deadline words override a plain block of time), hybrid-live passed 239 of 240 on each of two fresh seeds (777001 and 888002, v3 wording, real Gemini 3.8 Flash), measured by the owner's coordinator on this Mac.

search shares `core.mjs` with rules. The gemini one-shot related cases moved unrelated items in 27 percent of cases. agent-live took about 37 seconds per case.

With the public wording the offline approaches score 100 percent, so the public set no longer separates them; the private wording does.

## Reasons

- The model understands free wording. Offline regex understanding drops to 67 percent on basic and 50 percent on deadline in private wording; hybrid-live gets 100 and 88.
- `core.mjs` does the planning, so rules hold. It asks one merged question, honors a partial confirmation, remembers refusals and checks the rules. The one-shot model, with no code rules, moved unrelated items in 27 percent of related cases (57 percent pass).
- Discovery and related need no model call; both pass at 100 percent. The one-shot model gets 75 and 57.
- The agent loop with a real model scores 0 on discovery, 17 on related and takes about 37 seconds per case.
- Cost: one model call per request for hybrid-live, about 2.4 seconds per planning case, no call for discovery and related. The direct model baseline cost about 0.6 cent per case.
- Its weakest spot is deadline (88). That is where to look next.

## Not proven

- The private wording was written by a model, not by people.
- 60 cases per situation, so a rate carries a wide interval (see the owner's brackets).
- No real person has tried it.
- The private wording sets are kept by the owner and are not in this repository, so the final scorecard can be recomputed only with the owner's files; the public offline run in `results/` can be recomputed here.

## Final tree check

The 97 percent above was measured on commit `5a92e07` of branch `plan/roundtable-20261108`, where `hybrid-live` read the request through `understand-live.mjs`. The branch history lost files when parallel work items overwrote each other, so the final tree was assembled by the owner from several commits and uses the demo's intent reader (`src/planner/approaches/hybrid-live.mjs`, `ask`). The owner ran the same private cases (60 per situation, real Gemini 3.8 Flash) on the final tree: 217 of 240 = 90 percent (basic 90, deadline 72, discovery 100, related 100). Two causes of the gap are known: the model omits the length of a task when the schema allows it (fixed here by falling back to the length in the request), and requests such as "after 8 pm" or an unusual due-date wording are read less well than by the earlier reader. The ranking does not change: the model-reads, code-plans design beats the plain code parser (79 percent) and the model alone (67 percent).
