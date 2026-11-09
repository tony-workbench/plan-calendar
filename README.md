# Plan Calendar

A Preview Calendar and a Calendar Agent: the user says what she needs in Ask, the Calendar Agent plans it around her existing events, and nothing reaches Google Calendar until she confirms.

This repository was built by an AI roundtable and then assembled by its owner. The goal is in `docs/PRODUCT-DIRECTION.md`.

## What you need

- Node.js 20 or newer

## Run the demo

1. `npm start`
2. Open http://127.0.0.1:3000/demo

The page is a week Preview Calendar with an Ask bar at the bottom. Fixed events are grey and locked, proposed blocks are green with a dashed border, blocks that moved as a consequence of a change are marked `Moved`. Four situations can be clicked through:

1. **Basic arrangement**: click the first example (find time to work out for half an hour). One block appears; `Add it` saves it to a fake calendar, `Undo` takes it back.
2. **Deadline back-planning**: click the second example (the demo is due next Friday). Three ordered steps appear before the deadline. Drag a step to another time and only the later steps are re-planned. Type `production needs an hour more` to lengthen a step.
3. **Proactive activity discovery**: click the third example (anything fun this week?). A light prompt offers a few candidates with a question mark; click one to see the place, the reason and the source. Adding one does not register or book anything.
4. **Related-item adjustment**: click the fourth example, then drag the Shopping block later. One merged question names Shopping, Cooking and Dinner with three answers: all, only cooking, no. Only what you confirm moves, unrelated groceries never move, and after `no` the question is not asked again.

Nothing is written to Google Calendar, and nothing is bought or booked. All times are UTC.

## How the demo works

- `public/demo.html` and `public/demo.js` draw the page. They call two routes: `POST /api/plan` for a request typed in Ask and `POST /api/replan` for a drag or an answer.
- `src/demo-api.mjs` holds the routes. The sample calendar is in `src/demo.mjs`; the activity candidates and the meal plan are in `src/demo-api.mjs`. `server.mjs` mounts the routes next to `/health`.
- A request goes to `src/planner/approaches/hybrid-live.mjs`. A model only **reads** the text into a small intent (kind, task, length, due date). `src/planner/core.mjs` then plans, asks the single merged question, remembers refusals and checks the rules. If the model reply is unusable, a rules parser reads the request.
- **Recorded or live model.** Without a key, the demo replays the recorded replies in `tests/fixtures/model-replies.json`, so it works offline and gives the same result every time; the badge on the page says `Model: recorded`. With `GEMINI_API_KEY` in the environment (and optionally `GEMINI_MODEL`, default `gemini-3.8-flash`) it calls the live model and the badge says `Model: live`. The key is read from the environment only.
- **Record the replies again** with the live model: `GEMINI_API_KEY=... npm run record-replies`. It sends the example requests through the same reader and rewrites `tests/fixtures/model-replies.json`. To add an example, add the text to the list in `src/record-replies.mjs` and add a chip in `public/demo.html`.

## Which approach was chosen

`hybrid-live`: the model understands, the code plans and checks. The numbers and the reasons are in `docs/approach-decision.md`; the benchmark that produced them is in `benchmark/`.

## Test it

`npm test`

## Benchmark

`node benchmark/run.mjs --approach hybrid --per 50 --out benchmark-results` runs the public cases; `node benchmark/report.mjs benchmark-results/*.jsonl` prints the table. See `benchmark/README.md`.

## Docs

- [Product direction](docs/PRODUCT-DIRECTION.md)
- [Approach decision](docs/approach-decision.md)
- [Benchmark review](docs/benchmark-review.md)
- [Working rules](AGENTS.md)
