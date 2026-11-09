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

The four situations run end to end in an offline demo (`npm start`, then `/demo`): a week Preview Calendar where proposed blocks are dashed, fixed events are locked and consequential moves are marked. Nothing is written to Google Calendar. The planner is `hybrid-live`: a model only reads the request into a small intent, and `src/planner/core.mjs` plans, asks one merged question, remembers refusals and checks the rules. The choice and its numbers are in `docs/approach-decision.md`; the benchmark that produced them is in `benchmark/`.

## Model and tools

The Calendar Agent calls Gemini 3.8 Flash (`gemini-3.8-flash`) through the Gemini API. The model id is read from `GEMINI_MODEL` and defaults to `gemini-3.8-flash`; the key comes from the environment (`GEMINI_API_KEY`) and is never committed or printed. Offline tests use recorded or fake model replies and must pass without a key.

## What was built

| Part | Where |
| --- | --- |
| Four approaches behind one interface (rules, constraint search, Agent tool loop, hybrid) | `src/planner/approaches/` |
| Shared benchmark with public and private-wording cases | `benchmark/`, review in `docs/benchmark-review.md` |
| Choice of the best approach with numbers | `docs/approach-decision.md` |
| Visual demo | `public/demo.html`, `public/demo.js`, `src/demo-api.mjs`, `server.mjs` |

## Later

Each needs its own decision: real Google Calendar writes, cross-device sync, public deployment, a wider parser for due-date wordings, and a trial with real people.
