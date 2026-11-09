# Plan Calendar

A Preview Calendar and a Calendar Agent: the user says what she needs in Ask, the Calendar Agent plans it around her existing events, and nothing reaches Google Calendar until she confirms.

This repository was built by an AI roundtable and then assembled by its owner. The goal is in `docs/PRODUCT-DIRECTION.md`.

## What you need

- Node.js 20 or newer

## See the demo

1. `npm start`
2. Open http://127.0.0.1:3000/demo

The page shows a week Preview Calendar with four situations you can click through: basic arrangement, deadline back-planning (drag a step), proactive activity discovery, and related-item adjustment (one merged question). Nothing is written to Google Calendar.

By default the demo replays recorded model replies, so it works offline with no key. To use the live model, start it with `GEMINI_API_KEY` set in the environment (and optionally `GEMINI_MODEL`, default `gemini-3.8-flash`); the badge on the page then says `Model: live`.

## Which approach was chosen

`hybrid-live`: a model only understands the request, and `src/planner/core.mjs` plans, asks, remembers refusals and checks the rules. The numbers and the reasons are in `docs/approach-decision.md`.

## Test it

`npm test`

## Benchmark

`node benchmark/run.mjs --approach hybrid --per 50` runs the public cases, and `node benchmark/report.mjs benchmark-results/*.jsonl` prints the table. See `benchmark/README.md`.

## Docs

- [Product direction](docs/PRODUCT-DIRECTION.md)
- [Approach decision](docs/approach-decision.md)
- [Benchmark review](docs/benchmark-review.md)
- [Working rules](AGENTS.md)
