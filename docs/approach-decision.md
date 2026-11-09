# Approach decision (P3)

Record of the owner's benchmark run and the choice of approach. The numbers are the owner's; the coding seats copied them and did not rerun them. Only a seat can cast its own vote. A seat that has not voted is marked `not recorded` and must add its own section text. Nobody writes a vote for another seat.

## Decision (proposed)

Status: proposed, not final. Only one seat has voted; the choice stands as final only after every seat records its own vote.

Best approach: **hybrid-live** (proposed until every seat has voted). The real model understands the request, `src/planner/core.mjs` plans, asks one merged question, remembers refusals and checks the rules. It passed 233 of 240 private-wording cases (97 percent).

Gain over the baselines:
- +30 percentage points over the one-shot model answer (gemini one-shot, 67 percent).
- +18 percentage points over the plain code parser (hybrid offline and rules, 79 percent).
- No plain first-free-slot calendar baseline was run. The offline regex parser (79 percent) stands in for the plain code baseline; the gain over a true first-free-slot calendar is unmeasured.

## Scorecard

Owner's run: `benchmark/` at the repo, private held-out wording written by a model, real Gemini 3.8 Flash, 240 cases per approach, 60 per situation. Final pass rate, with the 95 percent interval in brackets. The owner's report did not hand over numeric intervals; the brackets below are Wilson intervals (the formula in `benchmark/report.mjs`) computed by the coding seat from the owner's pass counts (per-situation counts are the rate times 60). They are derived, not rerun.

| Approach | Passed | Rate [95% interval] | basic | deadline | discovery | related |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid (offline regex understanding) | 190 / 240 | 79% [74-84] | 67 [54-77] | 50 [38-62] | 100 [94-100] | 100 [94-100] |
| hybrid-live | 233 / 240 | 97% [94-99] | 100 [94-100] | 88 [78-94] | 100 [94-100] | 100 [94-100] |
| rules | 190 / 240 | 79% [74-84] | identical to hybrid, the regex parser is the same | | | |
| gemini one-shot (model only, no code rules) | 161 / 240 | 67% [61-73] | 70 [57-80] | 67 [54-77] | 75 [63-84] | 57 [44-68] |
| agent-live (roundtable Agent loop, real model) | 89 / 240 | 37% [31-43] | 90 [80-95] | 42 [30-54] | 0 [0-6] | 17 [9-28] |

Public wording, from the committed run in `results/` (200 cases per approach, 50 per situation, offline planners): hybrid, rules, search and agent each pass 200 of 200 (100 percent, interval 98-100; 92.9-100 per situation). Recompute with `node benchmark/report.mjs results/*.public.jsonl`. The public-wording numbers for hybrid-live and gemini one-shot are not in this tree, so this record does not state them; every approach was run on the private set (table above).

search shares `core.mjs` with rules. The gemini one-shot related cases moved unrelated items in 27 percent of cases. agent-live took about 37 seconds per case.

With the public wording the offline approaches score 99 to 100 percent, so the public set no longer separates them; the private wording does.

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
- The private-wording and hybrid-live results have no owner-run artifact in this tree (`results/` holds only public offline runs), so these figures cannot be checked from here.
- No named verifier is recorded for this item yet.
- The offline demo uses the offline hybrid planner, not hybrid-live; it cannot show the live understanding step the pick adds.
- If the model fails or answers badly, hybrid-live falls back silently to the offline parser, so the same sentence can give a different plan (79 against 97 percent paths).
- All times are treated as UTC; a user in another time zone would see meals and sleep at the wrong local time. No owner is named for this.
- With no deadline time the planner assumes 17:00 UTC; the demo does not show the correction step.
- Deadline goals split into generic outline, production and rehearsal steps.
- The live Agent path does not drop discovery candidates that lack a source and a place.
- The hybrid-live code is in `src/planner/approaches/hybrid-live.mjs`, with offline tests in `tests/hybrid-live.test.mjs` that use a fake model reply. Those tests show the delegation to `core.mjs`, the fallback and the no-call paths, but they cannot reproduce the real-model numbers above.

## Votes

- Kylon (coding seat): vote for hybrid-live. It has the highest rate in every situation except where it ties at 100, its gain is +30 over the one-shot model answer and +18 over the plain code parser, and it keeps the planning rules in code. I did not rerun the numbers; I rely on the owner's. The caveats above stand.
- Claude: not recorded. Claude has not added its own text.
- AdaL: not recorded. AdaL has not added its own text.
- Prelint: not recorded. Prelint has not added its own text.
- AskTheW: not recorded. AskTheW has not added its own text.
- Masky: not recorded. Masky has not added its own text.
- n8n: not recorded. n8n has not added its own text.
- Celesto: not recorded. Celesto has not added its own text.
