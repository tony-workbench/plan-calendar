// Hand-off from the main Agent to the Calendar Agent. Read-only: nothing is written to Google Calendar.
import { runCalendarAgent } from '../agent/calendar-agent.mjs';
import { createCalendarMcpServer } from '../mcp/server.mjs';
import { createInProcessClient } from '../mcp/client.mjs';
import { createFakeCalendarAdapter } from '../mcp/fake-calendar-adapter.mjs';

const KEYWORDS = /\b(calendar|schedule|reschedule|appointment|meeting|event|free time|time to|find time|find a slot|block|remind|plan|due|deadline|prep|workout|work out)\b/i;

export function isCalendarRequest(text) {
  return typeof text === 'string' && KEYWORDS.test(text);
}

function buildMcp(adapter) {
  return createInProcessClient(createCalendarMcpServer({ adapter: adapter ?? createFakeCalendarAdapter() }));
}

// Tool results may be plain values or MCP-style { structuredContent } / { content: [{ text }] }.
function unwrap(result) {
  if (result && result.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.[0]?.text;
  if (typeof text === 'string') {
    try { return JSON.parse(text); } catch { return result; }
  }
  return result;
}

function eventsFrom(value) {
  const v = unwrap(value);
  if (Array.isArray(v)) return v;
  return Array.isArray(v?.events) ? v.events : [];
}

export async function handOffToCalendarAgent({ request, now, model, mcp, adapter } = {}) {
  const plan = { ok: false, request, blocks: [], existingEvents: [], steps: 0 };
  if (typeof request !== 'string' || !request.trim()) return { ...plan, error: 'request must be a non-empty string' };
  try {
    const client = mcp ?? buildMcp(adapter);
    const when = now ?? new Date().toISOString();
    const run = await runCalendarAgent({ request, now: when, model, mcp: client });
    if (run?.error) return { ...plan, error: run.error, steps: run.steps ?? 0 };
    const blocks = Array.isArray(run?.blocks) ? run.blocks : [];
    let existingEvents = [];
    try {
      const start = new Date(when);
      const end = new Date(start.getTime() + 14 * 24 * 3600 * 1000);
      existingEvents = eventsFrom(await client.callTool('read_events', { start: start.toISOString(), end: end.toISOString() }));
    } catch {
      existingEvents = [];
    }
    return { ...plan, ok: true, blocks, existingEvents, steps: run?.steps ?? 0 };
  } catch (err) {
    return { ...plan, error: err?.message ?? String(err) };
  }
}
