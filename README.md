# Plan Calendar

A Preview Calendar and a Calendar Agent: the user says what she needs in Ask, the Calendar Agent plans it around her existing events, and nothing reaches Google Calendar until she confirms.

This repository is built by an AI roundtable; see `docs/PRODUCT-DIRECTION.md` for the goal and the work queue.

## What you need

- Node.js 20 or newer

## Run it

1. `npm start`
2. Open http://127.0.0.1:3000

## Four-situation demo

- Visual page: `node src/demo-server.mjs`, then open http://127.0.0.1:3000/demo (set `PORT` to change the port). It uses recorded model replies, or the live model when `GEMINI_API_KEY` is set. Nothing is written to Google Calendar.
- Terminal script: `node src/demo.mjs`
- `handleDemo` in `src/demo-api.mjs` is the handler for `/demo`, `/demo.js` and `/api/*`. Mounting it in `server.mjs` (`if (await handleDemo(req, res)) return;` at the top of the request handler) is a one-line change the coding rules do not let this change make, so `/demo` is not yet available after `npm start`.

## Test it

`npm test`

## Docs

- [Product direction](docs/PRODUCT-DIRECTION.md)
- [Working rules](AGENTS.md)
