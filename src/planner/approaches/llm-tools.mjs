// Tool helpers for the llm-agent approach: read_events, find_free_time, propose_blocks.
// Pure functions over an in-memory state, so a fake model can drive them offline.

const MIN = 60000;
const DAY = 24 * 60 * MIN;

export const TOOL_DECLARATIONS = [
  {
    name: 'read_events',
    description: 'Read fixed calendar events that overlap a time range.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
    },
  },
  {
    name: 'find_free_time',
    description: 'List free slots of at least duration_minutes between fixed events and proposed blocks.',
    parameters: {
      type: 'object',
      properties: {
        duration_minutes: { type: 'number' },
        from: { type: 'string' },
        to: { type: 'string' },
        day_start_hour: { type: 'number' },
        day_end_hour: { type: 'number' },
      },
      required: ['duration_minutes'],
    },
  },
  {
    name: 'search_activities',
    description: 'List activities from the activity source. A candidate needs a place, reason and source to be proposed.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'propose_blocks',
    description: 'Propose the complete set of blocks for the plan. Rejected as a whole if any block is invalid.',
    parameters: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              start: { type: 'string' },
              end: { type: 'string' },
              after: { type: 'array', items: { type: 'string' } },
              tentative: { type: 'boolean' },
              place: { type: 'string' },
              reason: { type: 'string' },
              source: { type: 'string' },
            },
            required: ['id', 'title', 'start', 'end'],
          },
        },
      },
      required: ['blocks'],
    },
  },
];

export const toMs = (value) => Date.parse(value);
export const toIso = (ms) => new Date(ms).toISOString();

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

function span(item) {
  return { start: toMs(item.start), end: toMs(item.end) };
}

export function createToolState({ events = [], now, deadline, pinned, source } = {}) {
  return {
    events,
    source, // optional { find() } activity source
    nowMs: toMs(now),
    deadlineMs: deadline ? toMs(deadline) : undefined,
    pinned, // { id, start?, minutes? } the block the user changed; it must stay as the user set it
    proposed: [],
  };
}

export function readEvents(state, { from, to } = {}) {
  const range = {
    start: from ? toMs(from) : -Infinity,
    end: to ? toMs(to) : Infinity,
  };
  return {
    events: state.events.filter((event) => overlaps(span(event), range)).map(({ id, title, start, end }) => ({ id, title, start, end })),
  };
}

export function findFreeTime(state, args = {}) {
  const need = Number(args.duration_minutes) * MIN;
  if (!(need > 0)) return { error: 'duration_minutes must be a positive number' };
  const from = Math.max(args.from ? toMs(args.from) : state.nowMs, state.nowMs);
  const to = args.to ? toMs(args.to) : from + 7 * DAY;
  const startHour = args.day_start_hour ?? 9;
  const endHour = args.day_end_hour ?? 18;
  const busy = [...state.events, ...state.proposed].map(span).sort((a, b) => a.start - b.start);
  const slots = [];
  for (let day = Math.floor(from / DAY) * DAY; day < to && slots.length < 10; day += DAY) {
    let cursor = Math.max(day + startHour * 60 * MIN, from);
    const close = Math.min(day + endHour * 60 * MIN, to);
    for (const item of busy) {
      if (item.end <= cursor || item.start >= close) continue;
      if (item.start - cursor >= need) slots.push({ start: cursor, end: item.start });
      cursor = Math.max(cursor, item.end);
    }
    if (close - cursor >= need) slots.push({ start: cursor, end: close });
  }
  return { slots: slots.slice(0, 10).map((s) => ({ start: toIso(s.start), end: toIso(s.end) })) };
}

function normalize(block) {
  const out = { id: block.id, title: block.title, start: toIso(toMs(block.start)), end: toIso(toMs(block.end)), kind: 'proposed' };
  for (const key of ['after', 'tentative', 'place', 'reason', 'source', 'group']) {
    if (block[key] !== undefined) out[key] = block[key];
  }
  return out;
}

export function validateBlocks(state, blocks) {
  const rejected = [];
  const reject = (id, reason) => rejected.push({ id, reason });
  const seen = new Map();
  for (const block of blocks) {
    if (!block || typeof block.id !== 'string' || typeof block.title !== 'string') {
      reject(block?.id, 'a block needs a string id and title');
      continue;
    }
    const s = span(block);
    if (Number.isNaN(s.start) || Number.isNaN(s.end) || s.end <= s.start) {
      reject(block.id, 'start and end must be valid times with end after start');
      continue;
    }
    if (block.tentative && !(block.place && block.reason && block.source)) reject(block.id, 'a candidate needs a place, reason and source');
    if (seen.has(block.id)) reject(block.id, 'duplicate id');
    seen.set(block.id, s);
    if (s.start < state.nowMs) reject(block.id, 'starts in the past');
    if (state.deadlineMs !== undefined && s.end > state.deadlineMs) reject(block.id, 'ends after the deadline');
    const hit = state.events.find((event) => overlaps(span(event), s));
    if (hit) reject(block.id, `overlaps fixed event ${hit.id}`);
  }
  const list = blocks.filter((b) => seen.has(b?.id));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlaps(seen.get(list[i].id), seen.get(list[j].id))) reject(list[j].id, `overlaps block ${list[i].id}`);
    }
  }
  for (const block of list) {
    for (const prior of block.after ?? []) {
      const p = seen.get(prior);
      if (!p) reject(block.id, `needs ${prior} before it, but ${prior} is not in the plan`);
      else if (seen.get(block.id).start < p.end) reject(block.id, `must start after ${prior} ends`);
    }
  }
  const pin = state.pinned;
  if (pin) {
    const s = seen.get(pin.id);
    if (!s) reject(pin.id, 'the block the user changed must stay in the plan');
    else if (pin.start !== undefined && s.start !== toMs(pin.start)) reject(pin.id, 'the user set this start time; keep it');
    else if (pin.minutes !== undefined && s.end - s.start !== pin.minutes * MIN) reject(pin.id, `the user set this length to ${pin.minutes} minutes; keep it`);
  }
  return rejected;
}

export function proposeBlocks(state, { blocks } = {}) {
  if (!Array.isArray(blocks)) return { error: 'blocks must be an array' };
  const rejected = validateBlocks(state, blocks);
  if (rejected.length) return { accepted: [], rejected };
  state.proposed = blocks.map(normalize);
  return { accepted: state.proposed.map((b) => b.id), rejected: [] };
}

export function searchActivities(state) {
  const found = state.source?.find?.() ?? [];
  return { activities: found.map(({ id, title, start, end, place, reason, source }) => ({ id, title, start, end, place, reason, source })) };
}

const TOOLS = { read_events: readEvents, find_free_time: findFreeTime, search_activities: searchActivities, propose_blocks: proposeBlocks };

export function runTool(state, name, args) {
  const tool = TOOLS[name];
  if (!tool) return { error: `unknown tool ${name}` };
  try {
    return tool(state, args ?? {});
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}
