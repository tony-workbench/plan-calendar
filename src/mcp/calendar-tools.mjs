// Pure calendar tool handlers and JSON-schema definitions for the Calendar MCP server.
// Handlers take an injected adapter: { listEvents({start,end}) -> events[] } (sync or async).

export class ToolInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolInputError";
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE = 60000;

const ISO_STRING = { type: "string", description: "ISO 8601 date-time with a UTC offset, e.g. 2026-11-10T09:00:00Z" };

export const TOOL_DEFINITIONS = [
  {
    name: "read_events",
    description: "Read existing calendar events that overlap a time range.",
    inputSchema: {
      type: "object",
      properties: { start: ISO_STRING, end: ISO_STRING },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "find_free_time",
    description:
      "List free slots of at least the requested length inside a range, with existing events subtracted, optionally limited to a daily UTC time-of-day window. Each slot is a maximal free interval; pick a block of the needed length inside it.",
    inputSchema: {
      type: "object",
      properties: {
        start: ISO_STRING,
        end: ISO_STRING,
        durationMinutes: { type: "integer", minimum: 1 },
        earliestTime: { type: "string", description: "Daily earliest time, UTC HH:MM (default 00:00)" },
        latestTime: { type: "string", description: "Daily latest time, UTC HH:MM (default 24:00)" },
      },
      required: ["start", "end", "durationMinutes"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_blocks",
    description:
      "Validate proposed blocks: ISO times, start before end, no overlap with existing events or with each other. Nothing is written to the calendar.",
    inputSchema: {
      type: "object",
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              start: ISO_STRING,
              end: ISO_STRING,
              kind: { type: "string" },
            },
            required: ["title", "start", "end"],
            additionalProperties: false,
          },
        },
      },
      required: ["blocks"],
      additionalProperties: false,
    },
  },
];

function parseTime(value, name) {
  if (typeof value !== "string" || !ISO_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ToolInputError(`${name} must be an ISO 8601 date-time with a UTC offset`);
  }
  return Date.parse(value);
}

function parseRange(args) {
  const start = parseTime(args.start, "start");
  const end = parseTime(args.end, "end");
  if (start >= end) throw new ToolInputError("start must be before end");
  return { start, end };
}

function clockMinutes(value, name, fallback) {
  if (value === undefined) return fallback;
  if (value === "24:00" && name === "latestTime") return 1440;
  if (typeof value !== "string" || !CLOCK_RE.test(value)) throw new ToolInputError(`${name} must be HH:MM`);
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function requireObject(args) {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolInputError("arguments must be an object");
  }
  return args;
}

async function readEvents(adapter, args) {
  const { start, end } = parseRange(requireObject(args));
  const events = await adapter.listEvents({ start: args.start, end: args.end });
  return {
    events: events
      .filter((e) => Date.parse(e.start) < end && Date.parse(e.end) > start)
      .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, fixed: Boolean(e.fixed) }))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
  };
}

async function findFreeTime(adapter, args) {
  requireObject(args);
  const { start, end } = parseRange(args);
  const duration = args.durationMinutes;
  if (!Number.isInteger(duration) || duration < 1) {
    throw new ToolInputError("durationMinutes must be a positive integer");
  }
  const earliest = clockMinutes(args.earliestTime, "earliestTime", 0);
  const latest = clockMinutes(args.latestTime, "latestTime", 1440);
  if (earliest >= latest) throw new ToolInputError("earliestTime must be before latestTime");
  const busy = (await adapter.listEvents({ start: args.start, end: args.end }))
    .map((e) => [Date.parse(e.start), Date.parse(e.end)])
    .sort((a, b) => a[0] - b[0]);
  const slots = [];
  const dayMs = 1440 * MINUTE;
  for (let day = Math.floor(start / dayMs) * dayMs; day < end; day += dayMs) {
    let from = Math.max(start, day + earliest * MINUTE);
    const to = Math.min(end, day + latest * MINUTE);
    const push = (lo, hi) => {
      if (hi - lo >= duration * MINUTE) slots.push({ start: new Date(lo).toISOString(), end: new Date(hi).toISOString() });
    };
    for (const [bs, be] of busy) {
      if (be <= from || bs >= to) continue;
      push(from, Math.min(bs, to));
      from = Math.max(from, be);
    }
    if (from < to) push(from, to);
  }
  return { slots };
}

async function proposeBlocks(adapter, args) {
  requireObject(args);
  if (!Array.isArray(args.blocks)) throw new ToolInputError("blocks must be an array");
  const parsed = args.blocks.map((b, i) => {
    if (b === null || typeof b !== "object") throw new ToolInputError(`blocks[${i}] must be an object`);
    if (typeof b.title !== "string" || !b.title.trim()) throw new ToolInputError(`blocks[${i}].title is required`);
    if (b.kind !== undefined && typeof b.kind !== "string") throw new ToolInputError(`blocks[${i}].kind must be a string`);
    const start = parseTime(b.start, `blocks[${i}].start`);
    const end = parseTime(b.end, `blocks[${i}].end`);
    if (start >= end) throw new ToolInputError(`blocks[${i}].start must be before end`);
    return { start, end };
  });
  const blocks = args.blocks.map((b) => {
    const out = { title: b.title, start: b.start, end: b.end };
    if (b.kind !== undefined) out.kind = b.kind;
    return out;
  });
  const conflicts = [];
  if (parsed.length) {
    const lo = new Date(Math.min(...parsed.map((p) => p.start))).toISOString();
    const hi = new Date(Math.max(...parsed.map((p) => p.end))).toISOString();
    const events = await adapter.listEvents({ start: lo, end: hi });
    parsed.forEach((p, i) => {
      for (const e of events) {
        if (Date.parse(e.start) < p.end && Date.parse(e.end) > p.start) {
          conflicts.push({ type: "event", blockIndex: i, eventId: e.id, message: `blocks[${i}] overlaps event "${e.title}"` });
        }
      }
      for (let j = i + 1; j < parsed.length; j++) {
        if (parsed[j].start < p.end && parsed[j].end > p.start) {
          conflicts.push({ type: "block", blockIndex: i, otherIndex: j, message: `blocks[${i}] overlaps blocks[${j}]` });
        }
      }
    });
  }
  return { ok: conflicts.length === 0, blocks, conflicts };
}

export function createCalendarTools({ adapter }) {
  if (!adapter || typeof adapter.listEvents !== "function") throw new TypeError("adapter.listEvents is required");
  const handlers = {
    read_events: (args) => readEvents(adapter, args),
    find_free_time: (args) => findFreeTime(adapter, args),
    propose_blocks: (args) => proposeBlocks(adapter, args),
  };
  return {
    definitions: TOOL_DEFINITIONS,
    handlers,
    async callTool(name, args = {}) {
      const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
      if (!handler) throw new ToolInputError(`Unknown tool: ${name}`);
      return handler(args);
    },
  };
}
