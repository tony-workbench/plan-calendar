# Plan Calendar

A Preview Calendar and a Calendar Agent: the user says what she needs in Ask, the Calendar Agent plans it around her existing events, and nothing reaches Google Calendar until she confirms.

This repository was built by an AI roundtable and then assembled by its owner. The goal is in `docs/PRODUCT-DIRECTION.md`.

## What you need

- Node.js 20 or newer

## Run the demo

1. `npm start`
2. Open http://127.0.0.1:3000/demo

The page is a week Preview Calendar with an Ask bar at the bottom. Fixed events are grey and locked, proposed blocks are green with a dashed border, blocks that moved as a consequence of a change are marked `Moved`. Four situations can be clicked through:

The examples are written the way a person talks, and each one is a harder case of its situation:

1. **Basic arrangement**: "Ugh, I have been sitting all day. Can you find me 45 minutes for a walk after 8 tonight?" One 45-minute block appears after 20:00, clear of events; `Add it` saves it to a fake calendar, `Undo` takes it back.
2. **Deadline back-planning**: "My landlord needs the signed lease back by the 20th and I have not even opened it. Can you help me get it done?" The due date is inside a long sentence and the user never says "deadline". Three ordered steps appear before it. Drag a step and only the later steps are re-planned. Type `production needs an hour more` to lengthen a step, or `it is due Thursday at 3 pm` to correct the date.
3. **Proactive activity discovery**: "I am bored this weekend. Any ideas for something fun? I like live music and good food." A light prompt offers a few candidates with a question mark; click one to see the place, the reason and the source. Adding one does not register or book anything.
4. **Related-item adjustment**: "I can't shop that early, push my grocery run to the afternoon." The demo loads a day with Shopping, Cooking, Dinner and tomorrow's groceries and moves Shopping. One merged question names Shopping, Cooking and Dinner with three answers: all, only cooking, no. Only what you confirm moves, unrelated groceries never move, and after `no` the question is not asked again.

Nothing is written to Google Calendar, and nothing is bought or booked. All times are UTC.

## What you can try

Without a key, only the four example buttons work well; other sentences are read by a simple rules parser and may not be understood. With `GEMINI_API_KEY` set (see "How the demo works"), you can type your own sentence in the Ask bar. The calendar is a fixed fake week, not your real one.

Things to type, in your own words:

- **Find time for one thing.** "Can you find me an hour to call my mom tomorrow?", "I need 30 minutes to stretch after 9 tonight", "squeeze in a 20 minute walk". A stated length is used; without one, 30 minutes is assumed. Naming a day that has already passed still gives a block in the future.
- **Something is due.** "My thesis chapter is due next Friday, help me plan the prep", "I have to send the report by the 20th". You get three ordered steps before the due date. If you give no time, 17:00 is assumed and the page says so.
- **Then change it.** After a deadline plan is on screen: "production needs an hour more" (only that step grows, later steps follow), "it is due Thursday at 3 pm" (the whole plan is redone), or drag a step on the calendar (only later steps move).
- **Ask for ideas.** "I am bored this weekend, any ideas?", "what should I do Friday night?". You get a light prompt; `Show me` draws up to three question-mark candidates from a fixed list of events, and clicking one shows place, reason and source. Adding one books nothing.
- **Move related things.** Click the fourth example button (it loads a day with Shopping, Cooking, Dinner and tomorrow's groceries and moves Shopping), or drag the Shopping block yourself. You get one question: all, only cooking, or no. This one cannot be typed in Ask; it only works by dragging.
- **Say something that is not a task.** "Had hotpot last night, it was great" or "what is the capital of France?" should not create a plan; the page says it could not turn it into one.

What does not work: typing "move the first item later" and anything that needs your real calendar. Not tested: other languages, typos in dates, and several tasks in one sentence. Each request calls the model once, about 2 to 3 seconds and a fraction of a cent.

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
