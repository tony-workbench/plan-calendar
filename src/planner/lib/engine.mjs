// Shared planner engine. The approaches differ only in the strategy they pass to createPlanner():
//   strategy.backPlan({ busy, from, deadline, steps }) -> start times | null   (deadline back-planning)
//   strategy.reflow(tail, ctx)                         -> [{ id, start }] | null (re-place blocks after a change)
// Everything else (request parsing, discovery screening, related-item questions) is shared so that
// the numbers compare placement strategies, not parsers.
import { toMs, toIso } from '../interface.mjs';

export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const GRID = 15 * MIN;
const HORIZON = 21 * DAY;
const BRANCH = 12;
const MODES = { strict: { open: 8 * HOUR, close: 22 * HOUR, meals: true }, relaxed: { open: 450 * MIN, close: 1410 * MIN, meals: false } };
const MEALS = [[450, 480], [720, 780], [1110, 1170]].map(([a, b]) => [a * MIN, b * MIN]);

const dayStart = (t) => Math.floor(t / DAY) * DAY;
const span = (x) => [toMs(x.start), toMs(x.end)];
const clear = (s, e, busy) => busy.every(([a, b]) => e <= a || s >= b);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Start times on a 15-minute grid, ascending, for a block of `minutes` ending by `until`, inside the
// day window of `mode` and clear of `busy` ([start, end] pairs).
export function* slots({ busy, from, until, minutes, mode = 'strict' }) {
  const { open, close, meals } = MODES[mode], dur = minutes * MIN;
  let t = Math.ceil(from / GRID) * GRID;
  while (t + dur <= until) {
    const d = dayStart(t), tod = t - d;
    if (tod < open) { t = d + open; continue; }
    if (tod + dur > close) { t = d + DAY + open; continue; }
    const e = t + dur;
    if (clear(t, e, busy) && !(meals && MEALS.some(([a, b]) => t < d + b && e > d + a))) yield t;
    t += GRID;
  }
}

// ---- request parsing -------------------------------------------------------------------------
const WORDS = { one: 1, two: 2, three: 3, four: 4 };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const STEPS = [['outline', 60], ['production', 120], ['rehearsal', 60]];

export function minutesIn(text) {
  const t = text.toLowerCase();
  if (/half an hour|half hour/.test(t)) return 30;
  let m = t.match(/(\d+)\s*min(?:ute)?s?\b/);
  if (m) return +m[1];
  m = t.match(/\b(\d+|one|two|three|four)\s*hours?\b/);
  if (m) return (WORDS[m[1]] ?? +m[1]) * 60;
  return /\ban hour\b/.test(t) ? 60 : null;
}

function deadlineOf(request, now) {
  const base = dayStart(toMs(now));
  const m = request.toLowerCase().match(/\b(this|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!m) return base + 7 * DAY + 17 * HOUR;
  const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * DAY;
  let d = monday + ((DAYS.indexOf(m[2]) + 6) % 7 + (m[1] === 'next' ? 7 : 0)) * DAY + 17 * HOUR;
  if (d <= toMs(now)) d += 7 * DAY;
  return d;
}

const subjectOf = (r) => (r.match(/\b(?:the|my)\s+(.+?)\s+is due/i) || r.match(/hand in\s+(?:the|my)?\s*(.+?)\s+(?:this|next)\b/i) || r.match(/prep for\s+(?:the|my)?\s*(.+?)\s*$/i))?.[1]?.toLowerCase() ?? 'project';
const activityOf = (r) => (r.match(/\bso I can ([a-z ]+?)(?: for | this |[.,?]|$)/i) || r.match(/\bto ([a-z ]+?)(?: for (?:\d|half|an? |one|two|three)| this |[.,?]|$)/i))?.[1] ?? 'task';

// -> { kind: 'none' } | { kind: 'basic', ... } | { kind: 'deadline', ... }
export function parseRequest(request = '', now) {
  if (/\b(due|deadline|hand in|work back)\b/i.test(request)) return { kind: 'deadline', subject: subjectOf(request), deadline: deadlineOf(request, now) };
  if (!/\b(find time|need to|schedule|in my calendar|help me find|when can i|can you)\b/i.test(request)) return { kind: 'none' };
  const after = request.match(/after\s+(\d{1,2})\s*(am|pm)/i);
  const hour = after ? (+after[1] % 12) + (after[2].toLowerCase() === 'pm' ? 12 : 0) : null;
  return { kind: 'basic', title: cap(activityOf(request)), minutes: minutesIn(request) ?? 30, afterHour: hour, sameDay: hour !== null || /this evening|tonight|today/i.test(request) };
}

// ---- strategies ------------------------------------------------------------------------------
const backCandidates = (busy, from, bound, minutes, nextStart, mode = 'strict') => {
  const all = [...slots({ busy, from, until: bound, minutes, mode })];
  const nextDay = nextStart == null ? null : dayStart(nextStart);
  const spread = all.filter((s) => nextDay == null || dayStart(s) < nextDay).reverse();
  return [...spread, ...all.filter((s) => nextDay != null && dayStart(s) >= nextDay).reverse()];
};

// Re-places `tail` ([{ id, minutes, floor, deps }], in order). Each block starts no earlier than
// `floor` and the end of its deps. Greedy takes the first slot; with backtrack it tries alternatives.
function placeTail(tail, { busy, ends }, { bound, backtrack, mode }) {
  const out = [];
  const endOf = (id) => ends.get(id) ?? (() => { const o = out.find((x) => x?.id === id); return o ? o.start + o.minutes * MIN : -Infinity; })();
  const go = (i) => {
    if (i === tail.length) return true;
    const it = tail[i], floor = Math.max(it.floor, ...it.deps.map(endOf));
    const taken = out.map((o) => [o.start, o.start + o.minutes * MIN]);
    let n = 0;
    for (const start of slots({ busy: busy.concat(taken), from: floor, until: Math.min(bound, floor + HORIZON), minutes: it.minutes, mode })) {
      if (++n > (backtrack ? BRANCH : 1)) break;
      out[i] = { id: it.id, start, minutes: it.minutes };
      if (go(i + 1)) return true;
    }
    out.length = i;
    return false;
  };
  return go(0) ? out.map(({ id, start }) => ({ id, start })) : null;
}

export const rulesStrategy = {
  name: 'rules',
  // Fixed rules: each step goes in the latest slot before the next one, a day earlier when possible; no backtracking.
  backPlan({ busy, from, deadline, steps }) {
    const starts = [];
    let bound = deadline, next = null;
    for (let i = steps.length - 1; i >= 0; i--) {
      const [s] = backCandidates(busy, from, bound, steps[i].minutes, next);
      if (s === undefined) return null;
      starts[i] = bound = next = s;
    }
    return starts;
  },
  // Pushes later blocks to the first free slot, never looking at the deadline.
  reflow: (tail, ctx) => ['strict', 'relaxed'].map((mode) => placeTail(tail, ctx, { bound: Infinity, backtrack: false, mode })).find(Boolean) ?? null,
};

export const searchStrategy = {
  name: 'search',
  // Depth-first search over slot choices with backtracking, so a bad late choice is undone.
  backPlan({ busy, from, deadline, steps }) {
    for (const mode of ['strict', 'relaxed']) {
      const starts = [];
      const go = (i, bound, next) => {
        if (i < 0) return true;
        let n = 0;
        for (const s of backCandidates(busy, from, bound, steps[i].minutes, next, mode)) {
          if (++n > BRANCH) break;
          starts[i] = s;
          if (go(i - 1, s, s)) return true;
        }
        return false;
      };
      if (go(steps.length - 1, deadline, null)) return starts;
    }
    return null;
  },
  // Keeps the deadline as a hard bound while it can; only then gives it up.
  reflow(tail, ctx) {
    const bounds = Number.isFinite(ctx.deadline) ? [ctx.deadline, Infinity] : [Infinity];
    for (const bound of bounds) for (const mode of ['strict', 'relaxed']) {
      const r = placeTail(tail, ctx, { bound, backtrack: true, mode });
      if (r) return r;
    }
    return null;
  },
};

// ---- planner ---------------------------------------------------------------------------------
const toBlock = (b) => ({ ...b, start: toIso(b.start), end: toIso(b.end) });

function discover({ events, from, context, meta }) {
  if (context.dismissed || !context.interests?.length || !context.source) return { blocks: [], notes: ['nothing to suggest'], meta };
  return Promise.resolve(context.source.find({ interests: context.interests, city: context.city })).then((found = []) => {
    const busy = events.map(span), picked = [];
    for (const c of [...(found ?? [])].sort((a, b) => toMs(a.start) - toMs(b.start))) {
      const [s, e] = span(c);
      if (s < from || !c.source || !c.place || !c.reason || !clear(s, e, busy)) continue;
      if (!(c.tags ?? []).some((t) => context.interests.includes(t))) continue;
      busy.push([s, e]); picked.push(c);
      if (picked.length === 3) break;
    }
    const blocks = picked.map((c) => ({ id: `candidate-${c.id}`, title: c.title, start: c.start, end: c.end, kind: 'candidate', tentative: true, place: c.place, reason: c.reason, source: c.source }));
    const out = { blocks, notes: ['candidates screened against interests and the schedule'], meta };
    if (blocks.length) out.question = { text: `${blocks.length === 1 ? 'One activity fits' : `${blocks.length} activities fit`} you this week, want to see ${blocks.length === 1 ? 'it' : 'them'}?`, items: blocks.map((b) => b.id) };
    return out;
  });
}

async function planWith(strategy, interpret, { request = '', events = [], now, context = {} }) {
  const from = toMs(now), meta = { kind: 'plan', now: toIso(from) };
  if (context.mode === 'discover') return discover({ events, from, context, meta: { ...meta, kind: 'discover' } });
  let intent = parseRequest(request, now);
  if (intent.kind === 'none' && interpret) intent = (await interpret(request, now)) ?? intent;
  if (intent.kind === 'none') return { blocks: [], notes: ['no scheduling request found'], meta };
  const busy = events.map(span);
  if (intent.kind === 'deadline') {
    const subject = intent.subject, slug = subject.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
    const steps = STEPS.map(([key, minutes]) => ({ id: `${slug}-${key}`, title: `${cap(subject)} ${key}`, minutes }));
    const m = { ...meta, deadline: toIso(intent.deadline) };
    const starts = strategy.backPlan({ busy, from, deadline: intent.deadline, steps });
    if (!starts) return { blocks: [], notes: ['no room before the deadline'], meta: m };
    const blocks = steps.map((s, i) => ({ id: s.id, title: s.title, start: toIso(starts[i]), end: toIso(starts[i] + s.minutes * MIN), kind: 'proposed', step: i + 1, dependsOn: i ? [steps[i - 1].id] : [] }));
    return { blocks, notes: [], meta: m };
  }
  const lo = intent.afterHour == null ? from : Math.max(from, dayStart(from) + intent.afterHour * HOUR);
  const until = intent.sameDay ? dayStart(from) + DAY : from + HORIZON;
  const [start] = slots({ busy, from: lo, until, minutes: intent.minutes });
  if (start === undefined) return { blocks: [], notes: ['no free slot found'], meta };
  return { blocks: [{ id: 'block-1', title: intent.title, start: toIso(start), end: toIso(start + intent.minutes * MIN), kind: 'proposed' }], notes: [], meta };
}

function replanWith(strategy, { plan: prev, change, events = [], answers }) {
  const blocks = prev.blocks.map((b) => ({ ...b, start: toMs(b.start), end: toMs(b.end) }));
  const meta = { ...(prev.meta ?? {}) }, notes = [], evBusy = events.map(span);
  const pending = meta.pending;
  delete meta.pending;
  blocks.forEach((b) => { delete b.moved; });
  const done = (extra = {}) => ({ blocks: blocks.map(toBlock), notes, meta, ...extra });
  const byId = (id) => blocks.find((b) => b.id === id);
  const deadline = meta.deadline ? toMs(meta.deadline) : Infinity;

  // Re-places `moving` (blocks) with the given floors; the rest of the plan and the events stay put.
  const reflow = (moving, floors, depsOf, extraTail = []) => {
    const ids = new Set([...moving, ...extraTail].map((b) => b.id));
    const fixed = blocks.filter((b) => !ids.has(b.id) && b.kind !== 'candidate');
    const ctx = { busy: [...evBusy, ...fixed.map((b) => [b.start, b.end])], ends: new Map(fixed.map((b) => [b.id, b.end])), deadline };
    const tail = [...extraTail, ...moving].map((b) => ({ id: b.id, minutes: (b.end - b.start) / MIN, floor: floors.get(b.id), deps: depsOf(b) }));
    const placed = strategy.reflow(tail, ctx);
    if (!placed) { notes.push('no room to re-plan'); return; }
    for (const { id, start } of placed) { const b = byId(id), dur = b.end - b.start; if (start !== b.start) b.moved = true; b.start = start; b.end = start + dur; }
  };

  if (change) {
    const target = byId(change.blockId);
    if (!target) { notes.push(`unknown block ${change.blockId}`); return done(); }
    const oldStart = target.start, dur = target.end - target.start + (change.minutes ?? change.extraMinutes ?? 0) * MIN;
    if (change.start != null) target.start = toMs(change.start);
    target.end = target.start + dur;
    const delta = Math.max(target.start - oldStart, 0), minimal = blocks.some((b) => Number.isFinite(b.step));
    const seen = new Set([target.id]), dependents = [];
    for (let grew = true; grew;) {
      grew = false;
      for (const b of blocks) if (!seen.has(b.id) && (b.dependsOn ?? []).some((d) => seen.has(d))) { seen.add(b.id); dependents.push(b); grew = true; }
    }
    dependents.sort((a, b) => a.start - b.start);
    const floors = new Map(dependents.map((b) => [b.id, minimal ? b.start : b.start + delta]));
    const grows = change.type === 'more-time' || !!(change.minutes ?? change.extraMinutes);
    if (grows) floors.set(target.id, oldStart);
    reflow(dependents, floors, (b) => b.dependsOn ?? [], grows ? [target] : []);
    if (grows) target.moved = false;
    // Related items that were never linked: ask once, name the whole chain, move nothing else yet.
    const declined = new Set(meta.declined ?? []);
    const mates = target.group ? blocks.filter((b) => b.group === target.group && !seen.has(b.id) && b.start >= oldStart && !declined.has(b.id)).sort((a, b) => a.start - b.start) : [];
    if (!mates.length) return done();
    const items = [target, ...mates];
    meta.pending = { target: target.id, delta, mates: mates.map((b) => b.id) };
    const names = items.map((b) => b.title);
    return done({ question: { text: `${names.slice(0, -1).join(', ')} and ${names.at(-1)} look like the same activity. Adjust them together?`, items: items.map((b) => b.id) } });
  }

  if (pending && answers) {
    const mates = pending.mates.map(byId).filter(Boolean).sort((a, b) => a.start - b.start);
    const yes = answers.confirm === 'all' ? mates : Array.isArray(answers.confirm) ? mates.filter((b) => answers.confirm.includes(b.id)) : [];
    meta.declined = [...(meta.declined ?? []), ...mates.filter((b) => !yes.includes(b)).map((b) => b.id)];
    const floors = new Map(yes.map((b) => [b.id, b.start + pending.delta]));
    const order = [pending.target, ...yes.map((b) => b.id)];
    reflow(yes, floors, (b) => [...(b.dependsOn ?? []), order[order.indexOf(b.id) - 1]]);
  }
  return done();
}

export function createPlanner(strategy, { interpret } = {}) {
  return {
    plan: async (input) => planWith(strategy, interpret, input),
    replan: async (input) => replanWith(strategy, input),
  };
}

// Hard-rule check used by the hybrid: overlaps with events or other blocks, step order, deadline.
export function violations(result, events = []) {
  const real = result.blocks.filter((b) => b.kind !== 'candidate').map((b) => ({ ...b, s: toMs(b.start), e: toMs(b.end) }));
  const dl = result.meta?.deadline ? toMs(result.meta.deadline) : Infinity;
  let n = 0;
  real.forEach((b, i) => {
    n += events.filter((ev) => b.s < toMs(ev.end) && b.e > toMs(ev.start)).length + (b.e > dl ? 1 : 0);
    n += real.slice(i + 1).filter((o) => b.s < o.e && b.e > o.s).length;
    n += (b.dependsOn ?? []).filter((d) => (real.find((x) => x.id === d)?.e ?? -Infinity) > b.s).length;
  });
  return n;
}
