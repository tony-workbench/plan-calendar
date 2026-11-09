// Approach 2: constraint and search planner.
// Builds free-slot intervals from the events, places blocks greedily (deadline work is
// back-scheduled from the deadline), keeps ordering constraints and re-plans with minimal moves.
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }.

import {
  DAY, MIN, ms, iso, normalize, freeSlots, firstFit, lastFit, hits,
  parseDuration, weekdayDate, startOfDay, roundUp,
} from './slots.mjs';

const STEPS = [
  { key: 'outline', title: 'Outline', minutes: 60 },
  { key: 'production', title: 'Production', minutes: 120 },
  { key: 'rehearsal', title: 'Rehearsal', minutes: 60 },
];

const WEEKDAY = /\b(next\s+|this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export function parseRequest(request, nowMs) {
  const text = String(request || '');
  const day = text.match(WEEKDAY);
  if (/\b(due|deadline)\b/i.test(text) && day) {
    const goalMatch = text.match(/(?:the\s+)?([a-z][\w-]*)\s+(?:is\s+)?(?:due|deadline)/i);
    const goal = goalMatch ? goalMatch[1].toLowerCase() : 'goal';
    const extra = text.match(/(\w+)\s+needs\s+(.+?)\s+more/i);
    return {
      kind: 'deadline',
      goal,
      deadline: weekdayDate(day[2], nowMs, /next/i.test(day[1] || '')),
      extra: extra ? { key: extra[1].toLowerCase(), minutes: parseDuration(extra[2]) } : null,
    };
  }
  const t = text.match(/(?:time\s+(?:to|for)|to)\s+(.+?)(?:\s+for\s+|\s*$)/i);
  const title = t ? t[1].trim() : text.trim() || 'Planned block';
  return { kind: 'basic', title, minutes: parseDuration(text, 60) };
}

const defaultStrategy = {
  // dir 'fwd': earliest start >= bound; dir 'back': latest block ending <= bound.
  pick(slots, dur, { dir, bound }) {
    return dir === 'back' ? lastFit(slots, dur, bound) : firstFit(slots, dur, bound);
  },
};

const out = (b) => ({ ...b, start: iso(b.start), end: iso(b.end) });

export function planWith({ request, events = [], now, context = {} }, strategy = defaultStrategy) {
  const nowMs = roundUp(ms(now ?? Date.now()));
  const fixed = normalize(events);
  const intent = parseRequest(request, nowMs);
  const base = { request, now: iso(nowMs), intent: intent.kind, question: null, hints: context.hints || [], links: [], refused: [], asked: [], unplaced: [], blocks: [] };

  if (intent.kind === 'basic') {
    const slots = freeSlots(fixed, nowMs, nowMs + 14 * DAY);
    const dur = intent.minutes * MIN;
    const st = strategy.pick(slots, dur, { dir: 'fwd', bound: nowMs, busy: fixed, now: nowMs });
    if (st == null) return { ...base, unplaced: [{ id: 'block-1', title: intent.title }] };
    return { ...base, blocks: [out({ id: 'block-1', title: intent.title, start: st, end: st + dur, goal: intent.title, after: [], kind: 'proposed', moved: false })] };
  }

  // Deadline back-scheduling: the last step is placed as late as possible before the deadline,
  // then each earlier step before the start of the one after it.
  const deadline = intent.deadline;
  const placed = [];
  const unplaced = [];
  let cursor = deadline;
  let avoidDay = null;
  const ids = STEPS.map((s) => `${intent.goal}-${s.key}`);
  for (let i = STEPS.length - 1; i >= 0; i--) {
    const s = STEPS[i];
    const minutes = s.minutes;
    const dur = minutes * MIN;
    const slots = freeSlots([...fixed, ...placed], nowMs, cursor);
    const st = strategy.pick(slots, dur, { dir: 'back', bound: cursor, busy: [...fixed, ...placed], now: nowMs, avoidDay });
    if (st == null) { unplaced.push({ id: ids[i], title: `${cap(intent.goal)} ${s.title.toLowerCase()}` }); continue; }
    placed.push({ id: ids[i], title: `${cap(intent.goal)} ${s.title.toLowerCase()}`, start: st, end: st + dur, goal: intent.goal, after: i > 0 ? [ids[i - 1]] : [], kind: 'proposed', moved: false });
    cursor = st;
    avoidDay = startOfDay(st);
  }
  placed.sort((a, b) => a.start - b.start);
  return { ...base, deadline: iso(deadline), blocks: placed.map(out), unplaced };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function plan(input) {
  return planWith(input);
}

function listNames(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Shared re-plan: moves the changed block, then the minimum number of others needed to keep order.
// opts.inferHints: also treat unlinked blocks with the same goal as something to confirm.
export function replanCore({ plan: prev, change = {}, events = [], answers }, opts = {}) {
  const nowMs = ms(prev.now ?? Date.now());
  const blocks = prev.blocks.map((b) => ({ ...b, start: ms(b.start), end: ms(b.end), moved: false, userMoved: false }));
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const target = byId.get(change.blockId);
  if (!target) return { ...prev, error: `Unknown block: ${change.blockId}`, question: null };
  const fixed = normalize(events);

  const sameGoal = (a, b) => (a.goal || null) === (b.goal || null);
  const buildChain = (links) => {
    const adj = new Map();
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b); adj.get(b).add(a);
    };
    for (const b of blocks) for (const a of b.after || []) if (byId.has(a) && sameGoal(byId.get(a), b)) link(a, b.id);
    for (const l of links) { const items = (l.items || l).filter((i) => byId.has(i)); for (const i of items) for (const j of items) if (i !== j) link(i, j); }
    const seen = new Set([target.id]);
    const queue = [target.id];
    while (queue.length) for (const n of adj.get(queue.shift()) || []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    return seen;
  };

  let links = [...(prev.links || [])];
  let chain = buildChain(links);
  const refused = new Set(prev.refused || []);
  const asked = new Set(prev.asked || []);

  const hintIds = new Set();
  for (const g of prev.hints || []) if ((g.items || []).includes(target.id)) (g.items).forEach((i) => hintIds.add(i));
  if (opts.inferHints) for (const b of blocks) if (b.goal && b.goal === target.goal) hintIds.add(b.id);
  const cands = [...hintIds].filter((id) => id !== target.id && byId.has(id) && !chain.has(id) && !refused.has(id));

  let question = null;
  if (answers) {
    const yes = answers.confirmed === 'all' ? cands : (answers.confirmed || []).filter((id) => cands.includes(id));
    // Anything not confirmed (refused, unanswered or unclear) never becomes a link and is not asked again.
    cands.filter((id) => !yes.includes(id)).forEach((id) => refused.add(id));
    (answers.refused || []).forEach((id) => refused.add(id));
    if (yes.length) { links.push({ items: [target.id, ...yes] }); chain = buildChain(links); }
  } else {
    const fresh = cands.filter((id) => !asked.has(id));
    if (fresh.length) {
      fresh.forEach((id) => asked.add(id));
      const names = [target.title, ...fresh.map((id) => byId.get(id).title)];
      question = { text: `${listNames(names)} look related, adjust them together?`, items: [target.id, ...fresh], options: ['all', 'some', 'none'] };
    }
  }

  const affected = blocks.filter((b) => chain.has(b.id)).sort((a, b) => a.start - b.start);
  const pos = affected.findIndex((b) => b.id === target.id);
  const preds = affected.slice(0, pos).reverse();
  const succs = affected.slice(pos + 1);
  const busy = [...fixed, ...blocks.filter((b) => !chain.has(b.id)).map((b) => ({ start: b.start, end: b.end }))];
  const unplaced = [];
  const deadline = prev.deadline ? ms(prev.deadline) : null;
  const horizon = Math.max(deadline || 0, nowMs + 30 * DAY, (change.start != null ? ms(change.start) : target.start) + 30 * DAY);

  let dur = target.end - target.start + (change.extraMinutes || 0) * MIN;
  let desired = change.start != null ? ms(change.start) : target.start;
  if (change.start != null && change.end != null) dur = ms(change.end) - ms(change.start);
  const tStart = firstFit(freeSlots(busy, Math.max(desired, nowMs), horizon), dur, desired);
  if (tStart == null) return { ...prev, error: 'No free time for that change', question: null, previous: prev };
  target.start = tStart; target.end = tStart + dur; target.userMoved = true;
  busy.push({ start: target.start, end: target.end });

  const dropped = new Set();
  let cursor = target.end;
  for (const b of succs) {
    const d = b.end - b.start;
    if (b.start >= cursor && !hits(busy, b)) { cursor = b.end; busy.push({ start: b.start, end: b.end }); continue; }
    const st = firstFit(freeSlots(busy, cursor, horizon), d, cursor);
    if (st == null) { unplaced.push({ id: b.id, title: b.title }); dropped.add(b.id); continue; }
    b.start = st; b.end = st + d; b.moved = true; cursor = b.end; busy.push({ start: b.start, end: b.end });
  }
  cursor = target.start;
  for (const b of preds) {
    const d = b.end - b.start;
    if (b.end <= cursor && !hits(busy, b)) { cursor = b.start; busy.push({ start: b.start, end: b.end }); continue; }
    const st = lastFit(freeSlots(busy, nowMs, cursor), d, cursor);
    if (st == null) { unplaced.push({ id: b.id, title: b.title }); dropped.add(b.id); continue; }
    b.start = st; b.end = st + d; b.moved = true; cursor = b.start; busy.push({ start: b.start, end: b.end });
  }

  const result = blocks.filter((b) => !dropped.has(b.id)).sort((a, b) => a.start - b.start)
    .map((b) => ({ ...out(b), pastDeadline: deadline != null && b.end > deadline }));
  const { previous: _drop, ...prevClean } = prev;
  return { ...prev, blocks: result, question, links, refused: [...refused], asked: [...asked], unplaced, previous: prevClean };
}

export function replan(input) {
  return replanCore(input);
}

export default { plan, replan };
