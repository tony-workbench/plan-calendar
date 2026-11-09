# Benchmark review (P2)

Review of `benchmark/` (generator, checks, runner, report, README) against the four situations: basic arrangement, deadline back-planning, proactive activity discovery, related-item adjustment. `benchmark/` is read-only for seats; the owner's agent applies the agreed changes.

Only a seat can cast its own vote. This record holds the verdict of each seat that has given one (Kylon and Claude so far); a seat that has not yet given one is marked `not recorded` and must add its own section text. Nobody writes a verdict for another seat.

Files read (sha256 of the version reviewed; update when the owner's agent changes `benchmark/`):
- `benchmark/README.md` 5aa3510531d99be4e3df4338d8952c57ed4c6f05506e747f929fc340f4b165ca
- `benchmark/contract.mjs` 4f070080f426708bfad736153ba0973d46aa1a1a5c9d5df92a4092ee0eb42ec1
- `benchmark/gen.mjs` fad632ddb0056635aa8a406a1ec1fba44cd9949fd957b713d4917d3977947d8f
- `benchmark/score.mjs` 21ad04eba8bf77653c368d7dfac3129e7c44df6712bfe402739ee8811a2d013f
- `benchmark/run.mjs` 99c3a25e846f4992915b6931784af72f1a170f48b605201900b9b3378f0cdace
- `benchmark/report.mjs` b94323a498404f58ea2876bea8e417cf456131548a84d54f61b79fdd945176ec

## Verdict: Kylon (coding seat)

Verdict: fair with changes. Each situation has several sub-types in `gen.mjs` (basic: simple, crowded, noduration, notplan, evening; deadline: normal, tight, drag, moretime; discovery: normal, fewvalid, novalid, thin, dismissed; related: unknown, known, collide), a fixed public seed, and every check is named and typed commonsense or hard. That covers the four situations. Three expectations are wrong or too weak, and several edge cases are not generated.

Findings, checks (`score.mjs`):
- F1 `gap-shown` (deadline, tight): the boolean is `steps.length > 0 && (all steps end before the deadline || notes || question) && (notes || question || steps.length >= minSteps)`. A plan with two or more steps before the deadline passes with no note and no question, so it does not require the plan to say the gap. A plan with no steps and a note saying the deadline cannot be met fails because of `steps.length > 0`.
- F2 `awake-hours` (all situations): the expression is `start >= 07:30 && end <= 23:30 || end === 00:00`, so a block ending at midnight passes whatever its start is (a block 03:00-00:00 passes). It also uses time of day only, never the date, so a block that crosses midnight and ends at 00:30 fails even though it is a legitimate late block, and a block spanning days is misjudged.

Findings, generator (`gen.mjs`):
- F3 `dependents-follow` (related, `known`): requires the dependent block to have moved. The generator draws the gap between chain blocks as 30 to 120 minutes and the drag as 60 to 150 minutes, so in some cases the dependent already starts after the dragged block's new end and a correct planner moves nothing. Measured over 400 cases per situation (seed 1): 27 of 86 `known` cases need no move. The expectation is wrong for those.
- F4 `collide` (related): the sub-type is meant to make the dragged chain run into the 19:00 evening class, but only 20 of 62 generated `collide` cases push any chain block past 19:00, so most do not test the collision.
- F5 Missing cases, confirmed against `gen.mjs`: no event crosses midnight (0 of the generated events; all-day offsites end 23:00), no deadline today (`WEEKDAY_FORMS` starts at day 4 and every generated deadline is Nov 13 or later), no request names a day already passed. Back-to-back events occur only by chance on the 30-minute grid (143 cases) and are never targeted. Discovery has a `dismissed` case but none where the user ignored once and is offered again later, which the direction says must not auto-open.
- F6 `SUBS.related` lists `unknown` twice (weights 5 and 1), so it is weighted 6 of 10, not 5 of 9 as the other lists read.

Findings, runner and report (`run.mjs`, `report.mjs`):
- F7 `run.mjs` counts a case as passed with `checks.every(...)`, which is true for a case with no checks; `report.mjs` and `casePass` require at least one check. The two pass counts can disagree.
- F8 `run.mjs` `loadApproach` swallows every import error and prints `skipped (cannot load)`, so a typo in an approach hides as a skip, not a failure.
- F9 `report.mjs` groups by approach and category only. The weak sub-types above (tight, collide, known) cannot be seen, and the baseline gain has no interval.
- F10 The README says the report shows how often something unrelated was moved; the report prints side effects per case, a count, not a rate.

Fairness of the four situations: basic and discovery checks are fair. Deadline is unfair in `gap-shown` (F1) and the late-evening window (F2). Related is unfair in `dependents-follow` (F3) and under-tests collisions (F4).

## Verdict: Claude (coding seat)

Verdict: fair with changes. I read all six files under `benchmark/` (hashes above) and re-checked Kylon's findings against the source before voting. The four situations are covered: `gen.mjs` has sub-types for each, a fixed public seed, and `score.mjs` names and types every check as commonsense or hard. Basic and discovery checks are fair. Deadline and related are not yet fair.

Findings I confirm from the source (same numbering as Kylon's):
- F1 `gap-shown` (`score.mjs` line 62): confirmed. With every step ending before the deadline and `steps.length >= minSteps`, the case passes with no note and no question, so the check does not require the plan to say there is a gap. It also fails a plan with no steps and a note, because of `steps.length > 0`.
- F2 `awake-hours` (`score.mjs` line 27): confirmed. `a && b || c` lets any block that ends at 00:00 pass whatever its start is, and it uses time of day only, never the date.
- F3 `dependents-follow` (`score.mjs` line 119): confirmed. It demands a move of the first dependent without checking whether the dragged block's new end already clears it, so a correct planner that moves nothing fails.
- F4 `collide`: confirmed as a weak test; most generated cases never push the chain to the 19:00 class.
- F5 missing cases: confirmed; no cross-midnight event, deadline today, past-day request, targeted back-to-back events, or ignored-once-then-offered-again discovery case.
- F6 `SUBS.related` lists `unknown` twice (`gen.mjs` line 108): confirmed.
- F7 `run.mjs` line 42 counts a case with zero checks as passed while `casePass` in `score.mjs` requires at least one check: confirmed.
- F8, F9: confirmed.
- F10: partly. The report prints side effects per case (a mean), but the README promises how often something unrelated was moved, a share of cases. I support making the report print the share.

I found nothing beyond Kylon's list, and I did not change anything in `benchmark/`.

## Verdict: AdaL (coding seat)

Verdict: not recorded. AdaL has not added its own section text.

## Verdict: Prelint

Verdict: not recorded. Prelint has not added its own section text.

## Verdict: AskTheW

Verdict: not recorded. AskTheW has not added its own section text.

## Verdict: Masky

Verdict: not recorded. Masky has not added its own section text. Masky's review comments on this record asked for each seat's verdict and the agreed changes; this revision records the verdicts that exist (Kylon, Claude), and Masky's own verdict is still to be added.

## Verdict: n8n

Verdict: not recorded. n8n has not added its own section text.

## Verdict: Celesto

Verdict: not recorded. Celesto has not added its own section text.

## Agreed changes

Agreement status: changes 1 to 8 are proposed by Kylon and supported by Claude (two of eight seats). AdaL, Prelint, AskTheW, Masky, n8n and Celesto have recorded no vote, so the roundtable has not agreed beyond these two seats; a seat that disagrees adds its own section above. The owner's agent applies a change once the roundtable agrees on it.
1. (F1) Tighten `gap-shown` so a tight case passes only when the plan carries a note or the question; allow zero steps when it does.
2. (F2) Bracket `awake-hours` as `start >= 07:30 && (end <= 23:30 || end is midnight)` and compare dates, so both start and end are always checked.
3. (F3) In `known` cases, require `dependents-follow` only when the dependent would otherwise start before the dragged block's new end, or generate gaps that always force a move.
4. (F4) Generate `collide` cases so the shifted chain reaches the evening class.
5. (F5) Add cases: an event across midnight, targeted back-to-back events, a deadline today, a request naming a day already passed, and an ignored-once discovery case.
6. (F6) Remove the duplicate `unknown` weight entry or document it.
7. (F7, F8) Make `run.mjs` use the same pass rule as `report.mjs` and print the import error when an approach cannot load.
8. (F9, F10) Report pass rates per sub-type and the unrelated-move rate, and give the baseline gain an interval.
