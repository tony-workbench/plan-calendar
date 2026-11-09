# Calendar Agent hand-off

The main Agent passes a calendar request to the Calendar Agent through `src/handoff/handoff.mjs`.

```js
import { handOffToCalendarAgent, isCalendarRequest } from './src/handoff/handoff.mjs';

if (isCalendarRequest(text)) {
  const plan = await handOffToCalendarAgent({ request: text, now: new Date().toISOString(), model });
  // plan = { ok, request, blocks, existingEvents, steps, error? }
}
```

- `model` is the Gemini-backed model in production and a scripted fake in tests (no key or network needed).
- `mcp` is optional. When omitted, the hand-off builds the MCP server over `adapter` (default: the fake calendar adapter) and a client over it.
- The result is a local plan. Nothing is written to Google Calendar; a sync happens only after the user confirms.
- On failure, `ok` is `false`, `blocks` is empty and `error` has the message.

Run the offline tests with `node --test tests/handoff.test.mjs`.
