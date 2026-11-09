# Benchmark review (P2)

Review of `benchmark/` (generator, checks, runner, report, README) against the four situations: basic arrangement, deadline back-planning, proactive activity discovery, related-item adjustment. `benchmark/` is read-only for seats; the owner's agent applies the agreed changes.

Only a seat can cast its own vote. This record holds the verdict of each seat that has given one (Kylon, Claude and AdaL so far); a seat that has not yet given one is marked `not recorded` and must add its own section text. Nobody writes a verdict for another seat.

Files read (sha256 of the version reviewed; update when the owner's agent changes `benchmark/`):
- `benchmark/README.md` 3314bb49527fd80f0814b167d3782a02df91ccb35215fdd6de35a80f65520b86
- `benchmark/contract.mjs` 4f070080f426708bfad736153ba0973d46aa1a1a5c9d5df92a4092ee0eb42ec1
- `benchmark/gen.mjs` c6e179f5ba9a1031efda599c9f17dcf78875d66a71cc5ea7b0d1dbb818171929
- `benchmark/score.mjs` 6a80f03f24c35c6d232fa6ce0d5da09ba46f8c85a0bc09d7ac52243be3d4a680
- `benchmark/run.mjs` d0d624e70e90ce39a2ded7939f2528286b5b5b7d35b7bf8da48883599c778221
- `benchmark/report.mjs` 3aaf6b95173599f9141d26efb7d8269a75289c55c77ff5faf4d9afb3f476d39a

## Verdict: Kylon (coding seat)

Verdict: fair with changes. Each situation has several sub-types in `gen.mjs` (basic: simple, crowded, noduration, notplan, evening; deadline: normal, tight, drag, moretime; discovery: normal, fewvalid, novalid, thin, dismissed; related: unknown, known, collide), a fixed public seed, and every check is named and typed commonsense or hard. That covers the four situations. Three expectations are wrong or too weak, and several edge cases are not generated.

Findings, checks (`score.mjs`):
- F1 `gap-shown` (deadline, tight): the boolean is `steps.length > 0 && (all steps end before the deadline || notes || question) && (notes || question || steps.length >= minSteps)`. A plan with two or more steps before the deadline passes with no note and no question, so it does not require the plan to say the gap. A plan with no steps and a note saying the deadline cannot be met fails because of `steps.length > 0`.
- F2 `awake-hours` (all situations): the expression is `start >= 07:30 && end <= 23:30 || end === 00:00`, so a block ending at midnight passes whatever its start is (a block 03:00-00:00 passes). It also uses time of day only, never the date, so a block that crosses midnight and ends at 00:30 fails even though it is a legitimate late block, and a block spanning days is misjudged.

Findings, generator (`gen.mjs`):
- F3 `dependents-follow` (related, `known`): requires the dependent block to have moved. The generator draws the gap between chain blocks as 30 to 120 minutes and the drag as 60 to 150 minutes, so in some cases the dependent already starts after the dragged block's new end and a correct planner moves nothing. Measured over 400 cases per situation (seed 1): 22 of 64 `known` cases need no move (count reproduced by the test on the generator as it stands). The expectation is wrong for those.
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

On the open changes 9 to 12 (C4 to C7), which I had not voted on: I checked each against `gen.mjs` and `score.mjs` and support all four. C4: every case time is UTC and `awake-hours` and `not-in-meals` read UTC hours, so a fixed-hours planner is rewarded. C5: deadline requests name a weekday and `minSteps` is the same for every case. C6: the drag target in the replan check never goes past the deadline. C7: `refused-not-asked-again` only follows an explicit `none` answer. They stay `open`: they are not in the owner's applied list.

## Verdict: AdaL (coding seat)

Verdict: fair with changes. This is the AdaL seat's own vote. I read the six files under `benchmark/` (hashes above) and checked the owner's applied changes against the source in this tree. The four situations are covered, every check is named and typed commonsense or hard, and the seed is fixed. I agree with Kylon's and Claude's findings F1 to F10 and found nothing new in them.

What I checked in this tree:
- F1 `gap-shown` (`score.mjs` line 63) now reads `notes.length > 0 || !!question` for tight cases, and zero steps are allowed. Fair.
- F2 `awake-hours` (`score.mjs` line 28) compares against the day start of each block, so start and end are both bounded and a block ending exactly at the next midnight is allowed only when it starts after 07:30. Fair.
- F3 `dependents-follow` (`score.mjs` line 122) requires a move only when `needsMove` is true. Fair.
- F7 `run.mjs` line 42 uses `checks.length > 0`, the same rule as `casePass`; `loadApproach` prints `cannot load:` with the import error message. Fair.
- F9, F10 `report.mjs` groups by sub-type when run with `--by-sub` (the default is per category) and has a `cases with unrelated moves` column.

Remaining gaps, which are the open changes 9 to 12 below (C4, C5, C6, C7), not new findings: C4, cases carry no time zone, so the benchmark rewards fixed UTC hours; C5, no deadline case omits the day or uses a task other than a presentation; C6, no drag goes past the point where the deadline cannot be met; C7, no case drags again after an unanswered question. These are not in the owner's applied list, so I support them as `open`.

Fairness of the four situations: basic, discovery and related are fair after the applied changes. Deadline is fair for presentation-style goals only, until changes 10 and 11 are applied. Since the public set no longer separates the approaches (see the measured result below), I support selecting on the private wording set and the real-model approach.

## Verdict: Prelint

Verdict: not recorded. Prelint has not added its own section text.

## Verdict: AskTheW

Verdict: not recorded. AskTheW has not added its own section text.

## Verdict: Masky

Verdict: not recorded. Masky has not added its own section text. Masky's review comments on this record asked for each seat's verdict and the agreed changes; this revision records the verdicts that exist (Kylon, Claude, AdaL), and Masky's own verdict is still to be added.

## Verdict: n8n

Verdict: not recorded. n8n has not added its own section text.

## Verdict: Celesto

Verdict: not recorded. Celesto has not added its own section text.

## Open Prelint concerns that touch the benchmark

Each open concern was checked against `benchmark/` (same six files, same hashes). The question is only whether the benchmark's expectations are fair for it; the product fix itself belongs to other items. These are proposals from the Kylon seat, not votes of other seats.

- C4 UTC and fixed hours (Prelint 4): unfair as a benchmark gap. `gen.mjs` writes every time as UTC (`NOW` is `2026-11-09T09:00:00.000Z`) and `score.mjs` `awake-hours` and `not-in-meals` read UTC hour and minute, so the benchmark rewards the fixed 07:30 to 23:30 window and fixed meal hours for every user. No case has a user time zone. Proposed: add a time-zone field to cases and judge hours in that zone, or state in the README that the benchmark is UTC-only and offline.
- C5 default deadline and fixed three-step split (Prelint 5): under-tested. Every deadline request in `gen.mjs` names a weekday (`WEEKDAY_FORMS`), so the default of seven days is never exercised, and `expect.minSteps` is 2 for every case, so one fixed split passes whatever the task is. Proposed: add a deadline case with no named day and a case with a non-presentation task, and require the step names to fit the task.
- C6 deadline after a drag or more time (Prelint 6): partly covered, with a gap. After a drag or more-time change, `replan-valid` passes `deadline` to the violation check, so a late step is flagged. But the drag target is chosen with `dl - 3 * 3600000` in `score.mjs`, so the benchmark never drags a step so late that the deadline cannot be met, and no check asks for a visible note then. Proposed: add a drag past the point of no return and require a note or a question, as `gap-shown` does for tight cases (see F1).
- C7 refusal without an answer (Prelint 7): under-tested. `refused-not-asked-again` runs only after `answers: { confirm: 'none' }`. No case drags again after an unanswered question. Proposed: add that case; the direction says unanswered links are not asked again by default.
- C3 silent limit on dragged blocks (Prelint 3) and C10 calendar data sent to a model (Prelint 10): not benchmark expectations. `score.mjs` has no check for either, and the benchmark should not. They are not closed: C3 is handed to the preview/UI work (the drag limit must be shown, not silent) and C10 to the model-path work in P3/P4 (consent before a real user path sends calendar data to the model; the benchmark uses it only offline). Neither is a P2 item, so no change below covers them; the owner tracks them there.
- C11 (Prelint 11): already handled. The record says that two of eight seats have voted and does not vote for the others.

## Review evidence

What was reviewed and how to re-check it, so a reader without the benchmark in hand can verify the record:
- The reviewed source is the six files listed above, all under `benchmark/` in this repository, pinned by sha256.
- `node --test tests/benchmark-review.test.mjs` re-checks the record: each seat has a section, the cited findings reproduce from `gen.mjs` and `score.mjs` (for example the F3 count of `known` cases that need no move), every agreed change cites a finding, and `benchmark/` still matches the pinned hashes.
- `node benchmark/run.mjs` and `node benchmark/report.mjs` run the benchmark itself.
- Findings are in the Kylon, Claude and AdaL sections and in the Prelint concerns section above, with file and check names so a seat that has not seen the repository can still check them; each seat adds its own verdict text.
- Blocked on the seats' own votes: the sections of Prelint, AskTheW, Masky, n8n and Celesto read `not recorded` because only a seat can cast its own vote; no one else may write it. Until those five seats vote, the agreed changes cannot reach the roundtable agreement the acceptance asks for, and this record does not claim it.
- Rebase: the owner's fixed benchmark (F1 to F10) is in this tree and the hashes above pin it. The findings in the Kylon and Claude sections describe the version reviewed before the fix. When the owner's agent changes `benchmark/` again, it must update the six hashes and the statuses together.
- Status: the changes below are proposed, not agreed. Three of eight seats (Kylon, Claude, AdaL) have voted; a release needs seven of eight. The other six sections stay `not recorded` until each seat adds its own text.

## Agreed changes

Agreement status: changes 1 to 8 are proposed by Kylon and supported by Claude and AdaL; changes 9 to 12 come from the open Prelint concerns C4 to C7 and are proposed by Kylon and supported by Claude and AdaL (three of eight seats). Prelint, AskTheW, Masky, n8n and Celesto have recorded no vote, so the roundtable has not agreed beyond these two seats. Agreement covers only the seats that voted; it says nothing for the others. Each change carries a status: `applied` once `benchmark/` in the reviewed tree has the change and the hashes above are updated, `open` until then. The owner reports that F1 to F10 are applied in its benchmark (F1 gap-shown, F2 awake-hours with dates, F3 dependents-follow only when needed, F4 collide cases that reach the class, F5 new cases, F6 duplicate weight, F7/F8 runner pass rule and load errors, F9/F10 per-sub-type report and unrelated-move share, plus a fix for clash candidates that did not overlap). The `benchmark/` in this tree is that version (the hashes above pin it), so changes 1 to 8 say `applied` here; changes 9 to 12 are not in the owner's list and stay `open`. Two statuses are checked by `tests/benchmark-review.test.mjs`, which runs the real checks (a 03:00-00:00 block must fail `awake-hours`; a tight case with no note and no question must fail `gap-shown`) and requires F1 and F2 to read `applied` exactly when the benchmark behaves that way. When the fixed benchmark is rebased into this tree, the hashes above and these statuses must be updated together. A seat that disagrees adds its own section above.

Measured result on the owner's promoted code, which bears on these changes: with the public wording, rules, search and hybrid reach 91 to 100 percent, so the public set no longer separates the approaches. With wording the seats never saw (private), basic arrangement drops to 28 percent and deadline back-planning to 8 to 14 percent. Agreed consequence: selection between approaches uses the private wording set and the real-model approach, not the public set.

| Change | Finding | Status in this tree | Reported by owner |
|--------|---------|---------------------|-------------------|
| 1 | F1 | applied | applied |
| 2 | F2 | applied | applied |
| 3 | F3 | applied | applied |
| 4 | F4 | applied | applied |
| 5 | F5 | applied | applied |
| 6 | F6 | applied | applied |
| 7 | F7, F8 | applied | applied |
| 8 | F9, F10 | applied | applied |
| 9 to 12 | C4 to C7 | open | not reported |

1. (F1) Tighten `gap-shown` so a tight case passes only when the plan carries a note or the question; allow zero steps when it does. Status: applied.
2. (F2) Bracket `awake-hours` as `start >= 07:30 && (end <= 23:30 || end is midnight)` and compare dates, so both start and end are always checked. Status: applied.
3. (F3) In `known` cases, require `dependents-follow` only when the dependent would otherwise start before the dragged block's new end, or generate gaps that always force a move. Status: applied.
4. (F4) Generate `collide` cases so the shifted chain reaches the evening class. Status: applied.
5. (F5) Add cases: an event across midnight, targeted back-to-back events, a deadline today, a request naming a day already passed, and an ignored-once discovery case. Status: applied.
6. (F6) Remove the duplicate `unknown` weight entry or document it. Status: applied.
7. (F7, F8) Make `run.mjs` use the same pass rule as `report.mjs` and print the import error when an approach cannot load. Status: applied.
8. (F9, F10) Report pass rates per sub-type and the unrelated-move rate, and give the baseline gain an interval. Status: applied.
9. (C4) Add a time-zone field to cases and judge `awake-hours` and `not-in-meals` in that zone, or state in the README that the benchmark is UTC-only. Status: open.
10. (C5) Add a deadline case with no named day and a case with a non-presentation task; require the step names to fit the task. Status: open.
11. (C6) Add a drag past the point of no return (the deadline cannot be met) and require a note or a question, as `gap-shown` does. Status: open.
12. (C7) Add a case that drags again after a question that got no answer and require that the question is not asked again. Status: open.
