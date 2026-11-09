# Product direction

What Plan Calendar should do and the order of the work. Read it before you vote or pick work. It is for the roundtable: the AI agents and review tools (seats: Claude, AdaL, Kylon, Prelint, AskTheW, Masky, n8n, Celesto) that build, review and vote on each build.

## Goal

A user tells the Ask bar what she needs ("find time to work out for half an hour", "the demo is due next Friday, help me plan the prep"). The main Agent recognises a calendar task and hands it to the Calendar Agent through MCP. The Calendar Agent understands the goal, looks at the existing schedule, decides how to arrange it and which tools to call, and puts the result into the Preview Calendar. The user drags items or keeps talking in Ask; the Calendar Agent re-plans. Nothing reaches Google Calendar until the user confirms.

The first build is a local, English-only, offline-testable prototype. Real Google Calendar writes stay behind an adapter; tests use a fake one.

## The flow

1. The user speaks in Ask.
2. The main Agent recognises a calendar task and passes it to the Calendar Agent over MCP.
3. The Calendar Agent reads the existing events, understands the goal, and chooses its own tool calls.
4. The plan appears in the Preview Calendar next to the existing events. It stays local.
5. The user drags an item or asks for a change in Ask. The Calendar Agent re-plans, marks items that moved as a consequence, does not show old positions, keeps the pre-change state in the background and lets the user undo the whole change.
6. Only on confirmation is the plan synced to Google Calendar. Abandoning leaves Google Calendar unchanged.

## Four situations

| # | Situation | Behaviour |
| --- | --- | --- |
| 1 | Basic arrangement | "Find time to work out for half an hour": find a fitting slot from the known schedule and the request; show the suggested block with existing events; keep it in the local preview. |
| 2 | Deadline back-planning | "Demo due next Friday, plan the prep": split into preparation steps (outline, production, rehearsal), keep the necessary order, fixed events and the deadline, show all blocks, keep them local. Dragging one step re-plans the later steps; asking for more time re-plans the remaining work. |
| 3 | Proactive activity discovery | When an activity matches known interests, city and free time, the Calendar Agent screens a few reliable candidates ahead of time (few or none if information is thin), prepares the preview, and gives one light prompt in Ask ("two activities fit you this week, want to see them?"). Ignoring or closing does not auto-open anything or ask again; repeated feedback tunes the frequency, one ignore never means dislike. Clicking opens the Preview Calendar on the candidates, shown as a few items with a question mark. The user can open one to see content, time, place, reason and source, then confirm (only the chosen activity is synced), ask for another, add preferences in Ask, or abandon. Adding to the calendar does not mean registered, ticketed or booked. |
| 4 | Related-item adjustment | See the rules below. |

### Related-item rules

1. When to check: only when the user drags an item or changes one through Ask. Do not interview the user to build links in advance.
2. Links usable directly: relations the user stated, or prerequisites already clear in the current plan, naming the specific items and the same activity or goal. Similar titles, adjacent times or common order are only hints, never proof.
3. Ask at most once: look at the whole chain first, merge what needs confirming into one Ask question that names the items ("Shopping, cooking and dinner are the same meal, adjust them together?"). The user can confirm all or part ("only cook, leave dinner"). Never five questions for five items, never a different page.
4. After the answer: use only what was confirmed, re-plan only affected items, update the local preview. Refused, unanswered or unclear links do not become links and are not asked again. With nothing to confirm, produce the adjustment directly.
5. Showing the result: move others only when a necessary order is really affected; never move fixed or unrelated events. Show the full current plan with markers for consequential moves, no original positions. Keep the earlier state in the background, support undoing the whole change, sync only after final confirmation. Example: buying tomorrow's groceries and eating today's dinner are not linked; only if they are clearly for the same meal and depend on it, consider the effect.

## Where the build stands

Nothing exists yet. The tests in `tests/` will show the state once the first item lands.

## Model and tools

The Calendar Agent calls Gemini 3.8 Flash (`gemini-3.8-flash`) through the Gemini API. The model id is read from `GEMINI_MODEL` and defaults to `gemini-3.8-flash`; the key comes from the environment (`GEMINI_API_KEY`) and is never committed or printed. Offline tests use recorded or fake model replies and must pass without a key.

## Work queue

Take items in order. Coding seats are Claude, AdaL and Kylon's Claude agent; reviewing seats check the items named for them.

| # | Goal | Acceptance | Who |
| --- | --- | --- | --- |
| P1 | Choose the implementation approach | Build the same small planner four ways behind one interface, and compare them on a fixed benchmark of the four situations (see "Implementation approaches"). The seats vote for the best version, with the numbers written in a record; the winner is the base for P3 onward | Coding seats each own one approach; every seat votes |
| P2 | Preview Calendar | A day and week view showing existing events and local preview blocks, two visually different kinds (fixed existing events and proposed blocks); drag to move a block; undo restores the state before the last change; tests cover drag and undo | Coding seats; AdaL and Masky verify |
| P3 | Calendar Agent core over MCP | An MCP server exposes tools (read events, find free time, propose blocks); a Calendar Agent loop calls the Gemini API, picks tools and returns blocks; a fake model makes the tests offline; a hand-off function lets the main Agent pass a request and get the plan back | Coding seats; Kylon verifies |
| P4 | Basic arrangement from Ask | "find time to work out for half an hour" yields one block in a free slot that overlaps nothing and does not move fixed events; the preview shows it with the existing events and nothing is written to Google Calendar | Coding seats; AdaL verifies |
| P5 | Deadline back-planning | "demo due next Friday" yields ordered steps (outline, production, rehearsal) before the deadline around fixed events; dragging one step re-plans only the later steps; "production needs an hour more" re-plans the remaining work | Coding seats; Kylon verifies |
| P6 | Related-item adjustment | The five rules above, covered by tests: ask once, merge into one question, partial answers, refusals not re-asked, fixed events never moved, undo of the whole change | Coding seats; AdaL and Masky verify |
| P7 | Confirm, then sync | A Google Calendar adapter interface with a fake used in tests; confirm writes only the confirmed blocks; abandon writes nothing; real writes need the owner's OAuth and stay off | Coding seats |
| P8 | Proactive activity discovery | Candidates come from a source interface with a fake; few or none when information is thin; one light prompt; ignoring does not reopen or re-ask; confirming syncs only the chosen item; each candidate shows content, time, place, reason, source | Coding seats; AdaL verifies |
| P9 | Continuous roundtable | One unattended run completes two of P1–P4 | Claude coordinator |

Later, each needing its own decision: real Google Calendar writes, cross-device sync, public deployment.

## How the roundtable keeps working

- Every round carries one goal from the work queue, not only fixes for rejections.
- After a promotion, the next round starts from the queue. The previous build keeps running on the private local port until a new one passes.
- The release rules (kept outside this repo) are unchanged: at least 7 of 8 approvals, private loopback only, at most 2 hours per round, at most 3 revisions. If an item still fails, record why and move to the next item.
- Non-coding seats review proposals, re-check the promoted build, add tests and update the Prelint ledger.
- No check may need a real person; a part of an item that does, is the owner's own check.
- Stop when the queue is empty, the time or round limit is reached, or the owner says stop. Then shut down the n8n checks and the cloud machines so nothing bills idly.
