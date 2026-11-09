# Plan Calendar

A Preview Calendar and a Calendar Agent: the user says what she needs in Ask, the Calendar Agent plans it around her existing events, and nothing reaches Google Calendar until she confirms.

This repository is built by an AI roundtable; see `docs/PRODUCT-DIRECTION.md` for the goal and the work queue.

## What you need

- Node.js 20 or newer

## Run it

1. `npm start`
2. Open http://127.0.0.1:3000

## Four-situation demo

- Visual page: `node src/demo-server.mjs`, then open http://127.0.0.1:3001/demo (the default port is 3001; set `PORT` to change it). It uses recorded model replies, or the live model when `GEMINI_API_KEY` is set; with a key, the request text is sent to the model. Nothing is written to Google Calendar.
- Terminal script: `node src/demo.mjs`
- `handleDemo` in `src/demo-api.mjs` is the handler for `/demo`, `/demo.js` and `/api/*`. `server.mjs` (`npm start`, port 3000) does not mount it yet. The one-line change (`if (await handleDemo(req, res)) return;` at the top of its request handler) was not made because this round's task rules forbid editing `server.mjs`; until the owner adds it, `/demo` is served only by `node src/demo-server.mjs` on port 3001.

## Test it

`npm test`

## Docs

- [Product direction](docs/PRODUCT-DIRECTION.md)
- [Working rules](AGENTS.md)
