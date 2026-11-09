# Benchmark review (P2)

Review of `benchmark/` (generator `gen.mjs`, checks `score.mjs`, contract `contract.mjs`, runner `run.mjs`, report `report.mjs`, `README.md`) against `docs/PRODUCT-DIRECTION.md`. `benchmark/` is read-only for seats; the owner's agent applies the agreed changes.

Each seat adds its own section. A seat that has not voted yet is marked `Verdict: pending` and carries no findings; nobody writes a vote for another seat. `tests/benchmark-review.test.mjs` checks the record itself (sections, votes, findings, agreed changes), so it keeps passing after the owner's agent applies the changes.

## Seat: Claude

Verdict: fair with changes

The structure is sound: seeded cases, named checks split into commonsense and hard, Wilson intervals, a hidden split. All four situations are covered. Several checks and expectations are wrong or too weak, so pass rates would be distorted until they change.

1. Wrong check (`score.mjs`, `life`): `awake-hours` accepts a block that starts at 22:00 and ends at 01:00 the next day, because only the end's minute-of-day is compared. Compare absolute times, or reject any block that crosses midnight.
2. Wrong check (`score.mjs`, deadline `steps-ordered`): the order rule only fires when the planner sets `step` or `dependsOn`. A plan with rehearsal before outline and no metadata passes. Check the order of the preparation steps from their titles or roles in the case, not from planner-supplied fields.
3. Wrong check (`score.mjs`, deadline `gap-shown`): the expression is true for any valid plan with at least two steps. A tight case never requires the planner to say the time is short. Require a note or a question when the free time before the deadline is less than the work needs, and make the tight cases genuinely short (today only days 1 to 3 are blocked, so Monday and Friday morning stay free).
4. Wrong expectation (`gen.mjs`, `related`): the dragged item shifts by 60 to 150 minutes while the chain has gaps of 30 to 120 minutes, so in some cases the drag touches nothing. The cases still expect a question (unknown) or a follow-up move (known). Product rule 5 says to move others only when a necessary order is really affected, and rule 4 says with nothing to confirm to adjust directly. Choose the shift so the next item is clearly hit, and add cases where it is clearly not hit and expect no question and no move.
5. Wrong expectation (`gen.mjs`, `related`): every chain block carries `group: 'g1'` and the other item `group: 'g2'`. The link is visible in the plan data, so "unknown" links are not unknown, and rule 2 says shared grouping or similar titles are only hints. Remove `group` from the plan given to the planner, or give the unrelated item the same group so it cannot be used as proof.
6. Wrong expectation (`gen.mjs`, `discovery`): invalid candidates are titled "Clashing Event n". A planner can filter on the title. Use neutral titles for all kinds.
7. Wrong expectation (`gen.mjs`, `discovery`): a candidate counts as valid when it only avoids existing events. Candidates start between 17:00 and 20:00, so some land in the 18:30 to 19:30 meal window, which `life` treats as invalid for other situations. Apply the same commonsense rules to candidates. Also `thin` and `dismissed` expect nothing at all, while the direction says "few or none if information is thin"; accept zero or one candidate for `thin`.
8. Wrong expectation (`gen.mjs`, deadline wording): "next Wednesday", "next Thursday" and "next Friday" are mapped to days 9, 10 and 11 from Monday 9 Nov, but "next Wednesday" can also mean 11 Nov. The deadline time of 17:00 is not in the request. Use unambiguous wording ("on Friday 20 November") or accept both readings, and say the end of day is the limit.
9. Missing case (`gen.mjs`, basic): no case where the calendar has no free slot in the horizon (expect a note or one question, not an invented slot). Calendars are always 09:00 to 18:00 on weekdays, so there are always free evenings and weekends. Add busy-evening and weekend cases and a time-of-day request other than "after 8 pm" (morning, before lunch).
10. Missing case (`gen.mjs`, related): nothing covers a drag of an unrelated item (groceries for tomorrow, today's dinner), a relation stated by the user in Ask, a change made through Ask instead of a drag, a partial answer that confirms several items, or an unclear answer. `partial-only` also passes when nothing moves, because it never checks that the confirmed item moved.
11. Missing case (`gen.mjs`, discovery): after the click the user can open one candidate, confirm one, ask for another or add a preference; only the first prompt is scored. There is no check that adding is not described as registered or booked, and no case for one ignore followed by a later request (one ignore never means dislike).
12. Missing case (`gen.mjs`, deadline): rehearsal must come last and the plan must have outline, production and rehearsal. `minSteps: 2` is lower than the direction's three. Add a check that three steps are present and ordered.
13. Missing check (`score.mjs`, replan): no check that old positions are not shown (no duplicate block ids or ghosts), that moved items are marked in the related situation, or that the earlier state can be undone. `moved-marked` runs only for drags, not for more-time. The contract has no undo field, so the owner needs to say how undo is observed.
14. Gaming (`score.mjs`): a planner that returns nothing passes every `notplan` case and every discovery case that expects nothing. Pass rates for such categories should be reported with a do-nothing baseline row, and a case whose only checks are "returned nothing" should not count toward the final pass rate.
15. Silent skip (`score.mjs`, deadline drag): when no free target exists the case returns after the plan checks and counts as passed without testing the drag. Report such cases as skipped, or fix the case so a target exists.
16. Fragility (`score.mjs`, `related` known): `byId(ask, id).start` throws when the planner drops a block, which scores the case as undelivered instead of a failed check. Treat a missing block as a failed check.
17. Runner (`run.mjs`): the console summary on line 42 counts a case as passed when `r.delivered && r.checks.every(...)`, so a case with an empty `checks` list counts as a pass, while `casePass` in `score.mjs` requires `r.checks.length > 0`. Make the runner use `casePass` so both agree. The default `--per` is 250 while the README example and text use 50. `--repeat` writes repeated runs of the same case as separate rows.
18. Report (`report.mjs`): the approach name is the part of the file name before the first dot, so `rules.public.jsonl` and `rules.hidden.jsonl` merge into one row and hide the public/hidden difference. Repeated rows count as independent samples and shrink the interval. The report has no per-sub-type breakdown, so `tight`, `known` and `collide` cannot be read separately. "Side effects" are described as a rate but are a count per case.
19. Generator (`gen.mjs`, `SUBS`): `related` lists `unknown` twice, so the intended extra sub-type is missing; `collide` rarely reaches the 19:00 class because the chain ends around midday, so it seldom collides. Category seeds derive from name length and first letter and `discovery` and `related` share the same value. Hidden cases reuse the public templates and wording, so a planner can learn the five request forms; the hidden split should add held-out wording.
20. Baselines (`README.md`, `run.mjs`): P3 compares against a one-shot model answer and a first-free-slot calendar. Neither exists as an approach file, and the README does not say how they run. Add both so the gain is computed the same way as for the four approaches.
21. Fairness of dimension: all times are UTC with no time zone in the context, while the discovery context names a city. Say in the README that times are UTC and that planners are not expected to convert.

## Seat: AdaL

Verdict: pending

## Seat: Kylon

Verdict: pending

## Seat: Prelint

Verdict: pending

## Seat: AskTheW

Verdict: pending

## Seat: Masky

Verdict: pending

## Seat: n8n

Verdict: pending

## Seat: Celesto

Verdict: pending

## Agreed changes

Status: proposed. Only the Claude seat has voted; the seven `Verdict: pending` sections (AdaL, Kylon, Prelint, AskTheW, Masky, n8n, Celesto) stay pending until each seat reads `benchmark/` and records its own vote. This record does not vote for them, so nothing is agreed by the full roundtable yet. The Claude seat proposes these for the roundtable to accept or amend; the owner's agent applies only the items every seat has voted to accept. When the status becomes `agreed`, every seat must have a verdict other than pending.

1. Fix the wrong checks: Claude findings 1, 2, 3, 16.
2. Fix the wrong expectations: Claude findings 4, 5, 6, 7, 8.
3. Add the missing cases: Claude findings 9, 10, 11, 12.
4. Add the missing checks and stop the gaming and silent skips: Claude findings 13, 14, 15.
5. Fix the runner, the report and the generator: Claude findings 17, 18, 19 and the two baselines in 20.
6. Document the time convention in the README: Claude finding 21.
