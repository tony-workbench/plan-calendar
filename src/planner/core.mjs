// Shared building blocks for the four planners: time helpers, request understanding, result builders and re-planning.
// All times are UTC. The day window is 08:00-22:00 and meals (07:30, 12:00, 18:30) are protected at fixed UTC hours.
export const MIN = 60000, H = 3600000, D = 86400000;
export const TIMEZONE = 'UTC';
export const MEALS = [[450, 480], [720, 780], [1110, 1170]];
export const WINDOW = [480, 1320];
const AWAKE_END = 1410;
const NAMES = ['outline', 'production', 'rehearsal'];
// Full-length steps first; shorter variants are used only when the time left is too tight for them.
export const STEP_VARIANTS = [[60, 120, 60], [60, 60, 60], [30, 60, 30]];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export const iso = (t) => new Date(t).toISOString();
export const ms = (v) => Date.parse(v);
export const dayStart = (t) => Math.floor(t / D) * D;
export const ceilTo = (t, step = 15 * MIN) => Math.ceil(t / step) * step;
const minOfDay = (t) => (t - dayStart(t)) / MIN;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dur = (b) => ms(b.end) - ms(b.start);
const real = (blocks) => blocks.filter((b) => b.kind !== 'candidate');

export function isFree(s, e, { events = [], blocks = [], meals = true } = {}) {
  if ([...events, ...real(blocks)].some((x) => s < ms(x.end) && e > ms(x.start))) return false;
  if (!meals) return true;
  const a = minOfDay(s), b = a + (e - s) / MIN;
  return !MEALS.some(([x, y]) => a < y && b > x);
}

export function* slots(from, length, { window = WINDOW, limit = from + 30 * D, step = 15 * MIN } = {}) {
  for (let ds = dayStart(from); ds < limit; ds += D) {
    const hi = Math.min(ds + window[1] * MIN, limit);
    for (let t = Math.max(ds + window[0] * MIN, ceilTo(from, step)); t + length <= hi; t += step) yield t;
  }
}

export function greedyFinder(from, length, o = {}) {
  for (const t of slots(from, length, o)) if (isFree(t, t + length, o)) return t;
  return null;
}

// ---- understanding the request ----
export function parseMinutes(text) {
  const t = text.toLowerCase();
  if (/half an hour|half hour|half-hour/.test(t)) return 30;
  if (/\b(?:an?|one)\s+(?:hour|hr)\s+and\s+a\s+half\b/.test(t)) return 90;
  if (/\bquarter of an hour\b|\bquarter hour\b/.test(t)) return 15;
  let m = t.match(/(\d+)[\s-]*(?:minutes?|mins?)\b/);
  if (m) return +m[1];
  m = t.match(/(\d+(?:\.\d+)?)[\s-]*(?:hours?|hrs?)\b/);
  if (m) return Math.round(+m[1] * 60);
  m = t.match(/\b(an|a|one|two|three|four)\s+hours?\b/);
  return m ? { an: 1, a: 1, one: 1, two: 2, three: 3, four: 4 }[m[1]] * 60 : null;
}

export function parseDay(text, nowMs) {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return dayStart(nowMs);
  if (/\btomorrow\b/.test(t)) return dayStart(nowMs) + D;
  const today0 = dayStart(nowMs), week0 = today0 - ((new Date(today0).getUTCDay() + 6) % 7) * D;
  const eow = t.match(/\bend of (?:the )?(this |next )?week\b/);
  if (eow) {
    // On a weekend this week's Friday is already past, so "end of this week" means the coming Friday.
    const friday = week0 + 4 * D + (eow[1] === 'next ' ? 7 * D : 0);
    return friday < today0 ? friday + 7 * D : friday;
  }
  const inDays = t.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return today0 + +inDays[1] * D;
  const ord = t.match(/\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?:\s+of\s+(\w+))?/) || t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (ord) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const named = /^\d/.test(ord[1]) ? months.indexOf(ord[2] ?? '') : months.indexOf(ord[1]);
    const dom = /^\d/.test(ord[1]) ? +ord[1] : +ord[2], base = new Date(today0);
    if (dom >= 1 && dom <= 31) {
      let month = named >= 0 ? named : base.getUTCMonth(), year = base.getUTCFullYear(), d = Date.UTC(year, month, dom);
      if (d < today0) d = named >= 0 ? Date.UTC(year + 1, month, dom) : Date.UTC(year, month + 1, dom);
      return d;
    }
  }
  const m = t.match(/\b(?:(this|next|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (!m) return null;
  const today = dayStart(nowMs), weekStart = today - ((new Date(today).getUTCDay() + 6) % 7) * D;
  let d = weekStart + DAYS.indexOf(m[2]) * D;
  if (m[1] === 'next') d += 7 * D; else if (d < today) d += 7 * D;
  return d;
}

export function parseDeadline(text, nowMs) {
  const day = parseDay(text, nowMs);
  if (day === null) return null;
  const m = text.toLowerCase().match(/\b(?:at|by|before)\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/);
  if (!m) return { ms: day + 17 * H, assumed: true };
  const hour = (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0);
  return { ms: day + hour * H + (+m[2] || 0) * MIN, assumed: false };
}

const INTENT = /\b(find|schedule|need to|have to|want to|put|book|block|fit|plan|set aside|make time|when can|can you|help me|remind|hit the|go for|go to|squeeze in|carve out|i'd like to|i would like to|time for)\b/i;
const DEADLINE = /\b(due|deadline|hand in|work back|submit|finish\b.*\bby|(?:ready|done|complete)\s+by)\b|\bby\s+(?:the\s+\d{1,2}(?:st|nd|rd|th)|end of)\b/i;
const CUT = /\s+(?:for\s+(?:\d|half|an?\s|one|two|three|four)|tonight|this evening|yesterday|today|tomorrow|after\s|before\s|at\s\d|on\s)|[,?.!]/i;

function activity(request) {
  const m = request.match(/\bso i can\s+(.+)$/i) || request.match(/\bto\s+(?!the\b)(.+)$/i) || request.match(/\b((?:hit|go to|go for|do|read|practice|call|clean|water|meditate)\b.+)$/i) || request.match(/\btime for\s+(.+)$/i) || request.match(/\bin\s+(?:a\s+)?(.+?)\s+session\b/i);
  if (!m) return 'Task';
  const cut = m[1].search(CUT);
  return cap((cut > -1 ? m[1].slice(0, cut) : m[1]).trim() || 'task');
}

function deliverable(request) {
  const m = request.match(/^(.*?)\s+(?:(?:is|are)\s+)?due\b/i) || request.match(/hand in\s+(.+?)\s+(?:today|this|next|on|by)\b/i) || request.match(/\b(?:finish|complete|submit)\s+(.+?)\s+by\b/i) || request.match(/prep(?:aration)? for\s+(.+?)[.?!]?$/i);
  const what = (m ? m[1] : 'your deadline').replace(/^(the|my)\s+/i, '').trim();
  return cap(what || 'Deadline');
}

export function understand({ request = '', now, context = {} }) {
  const nowMs = ms(now);
  if (context.mode === 'discover') return { kind: 'discover' };
  if (DEADLINE.test(request)) {
    const dl = parseDeadline(request, nowMs), what = deliverable(request);
    return dl ? { kind: 'deadline', what, deadline: dl.ms, assumed: dl.assumed } : { kind: 'ask-deadline', what };
  }
  if (!INTENT.test(request)) return { kind: 'none' };
  const t = request.toLowerCase(), today = dayStart(nowMs);
  const after = t.match(/\bafter\s+(\d{1,2})\s*(am|pm)\b/);
  let pref = null;
  if (after) pref = { from: today, window: [((+after[1] % 12) + (after[2] === 'pm' ? 12 : 0)) * 60, AWAKE_END], limit: today + D };
  else if (/\b(tonight|this evening)\b/.test(t)) pref = { from: today, window: [1020, AWAKE_END], limit: today + D };
  else if (/\btomorrow\b/.test(t)) pref = { from: today + D, window: WINDOW, limit: today + 2 * D };
  return { kind: 'basic', title: activity(request), minutes: parseMinutes(request) ?? 30, pref, past: /\byesterday\b/.test(t) };
}

// ---- result builders ----
const block = (id, title, s, minutes, extra = {}) => ({ id, title, start: iso(s), end: iso(s + minutes * MIN), kind: 'proposed', ...extra });
const fmtDay = (t) => `${DAYS[(new Date(t).getUTCDay() + 6) % 7]} ${iso(t).slice(0, 10)}`;

export function basicResult(intent, ctx, finder = greedyFinder) {
  const { events, now } = ctx, length = intent.minutes * MIN, from = ceilTo(ms(now));
  const notes = [], meta = { kind: 'basic', timezone: TIMEZONE };
  let s = null;
  if (intent.pref) s = finder(Math.max(from, intent.pref.from), length, { events, window: intent.pref.window, limit: intent.pref.limit });
  if (s === null) {
    s = finder(from, length, { events, window: WINDOW });
    if (intent.pref) notes.push('Nothing fits at that time, so I picked the next free time.');
  }
  if (intent.past) notes.unshift('That day has already passed, so I picked the next free time.');
  if (s === null) return { blocks: [], notes: ['I could not find free time in the next 30 days.'], meta };
  return { blocks: [block('block-1', intent.title, s, intent.minutes)], notes, meta };
}

export function deadlineResult(intent, placed, ctx) {
  const blocks = placed.map(({ s, minutes }, i) => block(`step-${i + 1}`, `${intent.what}: ${NAMES[i]}`, s, minutes, { step: i + 1, ...(i ? { dependsOn: [`step-${i}`] } : {}) }));
  const notes = [];
  if (blocks.length < NAMES.length) notes.push(blocks.length ? `Only ${blocks.length} of ${NAMES.length} prep steps fit before the deadline.` : `There is no free time before the deadline on ${fmtDay(intent.deadline)}.`);
  else if (placed.some((p, i) => p.minutes !== STEP_VARIANTS[0][i])) notes.push('Time is tight, so I shortened the prep steps.');
  if (intent.assumed) notes.push(`I assumed it is due at ${iso(intent.deadline).slice(11, 16)} UTC on ${fmtDay(intent.deadline)}. To change it, reply with the real date or time, for example "it is due Thursday at 3 pm".`);
  return { blocks, notes, meta: { kind: 'deadline', deadline: iso(intent.deadline), deadlineAssumed: intent.assumed, now: ctx.now, timezone: TIMEZONE } };
}

// Greedy back-planning: each step starts no earlier than its share of the time left and after the previous step.
export function greedySteps(intent, ctx, finder = greedyFinder) {
  const { events, now } = ctx, start = ceilTo(ms(now)), span = intent.deadline - start;
  if (span <= 0) return [];
  const run = (variant, spread) => {
    const placed = [];
    let prevEnd = start;
    for (const [i, minutes] of variant.entries()) {
      const length = minutes * MIN, o = { events, limit: intent.deadline };
      const t = finder(Math.max(spread ? start + (span * i) / variant.length : start, prevEnd), length, o) ?? finder(prevEnd, length, o);
      if (t === null) break;
      placed.push({ s: t, minutes });
      prevEnd = t + length;
    }
    return placed;
  };
  let best = [];
  for (const variant of STEP_VARIANTS) for (const spread of [true, false]) {
    const placed = run(variant, spread);
    if (placed.length === variant.length) return placed;
    if (placed.length > best.length) best = placed;
  }
  return best;
}

export function discoverResult(ctx) {
  const { events, now, context } = ctx, nowMs = ms(now);
  const empty = { blocks: [], notes: [], meta: { kind: 'discover', timezone: TIMEZONE } };
  if (context.dismissed) return empty;
  const interests = (context.interests ?? []).map((x) => x.toLowerCase());
  const found = typeof context.source?.find === 'function' ? context.source.find({ interests, city: context.city, now }) : context.candidates;
  const ok = (found ?? []).filter((c) => c.source && c.place && c.reason && ms(c.start) >= nowMs && (c.tags ?? []).some((t) => interests.includes(String(t).toLowerCase())) && !events.some((e) => ms(c.start) < ms(e.end) && ms(c.end) > ms(e.start)));
  const picked = ok.sort((a, b) => ms(a.start) - ms(b.start)).slice(0, 3);
  if (!picked.length) return empty;
  const blocks = picked.map((c) => ({ id: `candidate-${c.id}`, title: `${c.title}?`, start: c.start, end: c.end, kind: 'candidate', tentative: true, place: c.place, reason: c.reason, source: c.source }));
  const text = picked.length === 1 ? 'One activity fits you this week, want to see it?' : `${picked.length} activities fit you this week, want to see them?`;
  return { blocks, question: { text, items: blocks.map((b) => b.id) }, notes: ['Adding an activity to the calendar does not register or book it for you.'], meta: { kind: 'discover', timezone: TIMEZONE } };
}

export function planWith(input, solver) {
  const ctx = { events: input.events ?? [], now: input.now, context: input.context ?? {} };
  const intent = understand(input);
  switch (intent.kind) {
    case 'discover': return discoverResult(ctx);
    case 'basic': return basicResult(intent, ctx, solver.finder);
    case 'deadline': return deadlineResult(intent, solver.steps(intent, ctx), ctx);
    case 'ask-deadline': return { blocks: [], question: { text: `When is ${intent.what.toLowerCase()} due?`, items: [] }, notes: [], meta: { kind: 'deadline', now: ctx.now, timezone: TIMEZONE } };
    default: return { blocks: [], notes: [], meta: { kind: 'none', timezone: TIMEZONE } };
  }
}

// ---- re-planning ----
const clean = (plan) => ({ ...plan, blocks: plan.blocks.map(({ moved, ...b }) => ({ ...b })), notes: [], question: undefined });

// Re-place `order.slice(1)` after the anchor `order[0]`: a block stays where it is unless the order or a clash forces it to move.
export function cascade(blocks, order, { events, limit = Infinity, meals = true }) {
  const by = new Map(blocks.map((b) => [b.id, { ...b }]));
  const pending = new Set(order.slice(1)), unplaced = [];
  let prevEnd = ms(by.get(order[0]).end);
  for (const id of order.slice(1)) {
    const b = by.get(id), length = dur(b);
    pending.delete(id);
    const others = [...by.values()].filter((x) => x.id !== id && !pending.has(x.id));
    const s = ms(b.start);
    if (!(s >= prevEnd && s + length <= limit && isFree(s, s + length, { events, blocks: others, meals: false }))) {
      const t = greedyFinder(prevEnd, length, { events, blocks: others, meals, limit, window: meals ? WINDOW : [WINDOW[0], AWAKE_END] });
      if (t === null) { unplaced.push(id); by.delete(id); continue; }
      b.start = iso(t); b.end = iso(t + length); b.moved = true;
    }
    prevEnd = ms(b.end);
  }
  return { blocks: blocks.filter((b) => by.has(b.id)).map((b) => by.get(b.id)), unplaced };
}

const unplacedNote = (blocks, ids) => ids.length ? [`There is no room before the deadline for: ${ids.map((id) => blocks.find((b) => b.id === id).title).join(', ')}. Ask for more time or move the deadline.`] : [];

function followers(blocks, id) {
  const me = blocks.find((b) => b.id === id);
  if (Number.isFinite(me?.step)) return blocks.filter((b) => b.step > me.step).sort((a, b) => a.step - b.step).map((b) => b.id);
  const out = [], seen = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const b of blocks) if (!seen.has(b.id) && (b.dependsOn ?? []).some((d) => seen.has(d))) { seen.add(b.id); out.push(b.id); grew = true; }
  }
  return out.sort((a, b) => ms(blocks.find((x) => x.id === a).start) - ms(blocks.find((x) => x.id === b).start));
}

export function replanDeadline(plan, change, events, finder = greedyFinder) {
  const base = clean(plan), blocks = base.blocks, limit = plan.meta?.deadline ? ms(plan.meta.deadline) : Infinity;
  const steps = [...blocks].sort((a, b) => a.step - b.step), ids = steps.map((b) => b.id);
  const done = (r, meta) => ({ blocks: r.blocks, notes: unplacedNote(blocks, r.unplaced), meta: { ...plan.meta, ...meta } });
  const refuse = (note) => ({ ...base, notes: [note], meta: plan.meta });
  if (change.type === 'drag') {
    const i = ids.indexOf(change.blockId);
    if (i < 0) return refuse('That item is not part of this plan.');
    const moved = blocks.map((b) => b.id === change.blockId ? { ...b, start: change.start, end: iso(ms(change.start) + dur(b)) } : b);
    return done(cascade(moved, ids.slice(i), { events, limit }));
  }
  if (change.type === 'more-time') {
    const i = ids.indexOf(change.blockId);
    if (i < 0) return refuse('That item is not part of this plan.');
    const target = steps[i], length = dur(target) + change.minutes * MIN, fixed = blocks.filter((b) => !ids.slice(i).includes(b.id));
    let s = ms(target.start);
    if (!(s + length <= limit && isFree(s, s + length, { events, blocks: fixed }))) {
      s = finder(i ? ms(steps[i - 1].end) : ceilTo(ms(plan.meta?.now ?? target.start)), length, { events, blocks: fixed, limit });
    }
    if (s === null) return refuse('There is no room before the deadline for more time on this step.');
    const grown = blocks.map((b) => b.id === target.id ? { ...b, start: iso(s), end: iso(s + length), ...(s !== ms(target.start) ? { moved: true } : {}) } : b);
    return done(cascade(grown, ids.slice(i), { events, limit }));
  }
  if (change.type === 'set-deadline') {
    const dl = change.deadline ? { ms: ms(change.deadline) } : parseDeadline(change.text ?? '', ms(plan.meta?.now ?? steps[0]?.start));
    if (!dl || !Number.isFinite(dl.ms)) return { ...base, question: { text: 'I did not catch the date. When is it due?', items: [] }, meta: plan.meta };
    const r = ids.length ? cascade(base.blocks, ids, { events, limit: dl.ms }) : { blocks, unplaced: [] };
    return done(r, { deadline: iso(dl.ms), deadlineAssumed: false });
  }
  return { ...base, notes: plan.notes ?? [], meta: plan.meta };
}

const join = (xs) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

export function replanRelated(plan, change, events, answers) {
  const base = clean(plan), blocks = base.blocks, pend = plan.meta?.pending, declined = plan.meta?.declined ?? [];
  const find = (id) => blocks.find((b) => b.id === id);
  if (!change) {
    if (!pend) return { ...base, notes: plan.notes ?? [], meta: plan.meta };
    const c = answers?.confirm, ok = c === 'all' ? pend.items : Array.isArray(c) ? pend.items.filter((id) => c.includes(id)) : [];
    if (!ok.length) return { blocks, notes: ['Okay, I left the other items where they are.'], meta: { ...plan.meta, pending: undefined, declined: [...new Set([...declined, pend.blockId, ...pend.items])] } };
    const out = new Map(blocks.map((b) => [b.id, b])), waiting = new Set(ok);
    let prevEnd = ms(find(pend.blockId).end);
    for (const id of [...ok].sort((a, b) => ms(find(a).start) - ms(find(b).start))) {
      const b = out.get(id), length = dur(b);
      waiting.delete(id);
      const others = [...out.values()].filter((x) => x.id !== id && !waiting.has(x.id));
      let s = Math.max(ms(b.start) + pend.delta, prevEnd);
      if (!isFree(s, s + length, { events, blocks: others, meals: false })) s = greedyFinder(s, length, { events, blocks: others, meals: false, window: [WINDOW[0], AWAKE_END] }) ?? s;
      out.set(id, { ...b, start: iso(s), end: iso(s + length), moved: true });
      prevEnd = s + length;
    }
    const left = pend.items.filter((id) => !ok.includes(id));
    return { blocks: blocks.map((b) => out.get(b.id)), notes: [], meta: { ...plan.meta, pending: undefined, ...(left.length ? { declined: [...new Set([...declined, ...left])] } : {}) } };
  }
  const me = change.type === 'drag' ? find(change.blockId) : null;
  if (!me) return { ...base, notes: ['That item is not part of this plan.'], meta: plan.meta };
  const moved = blocks.map((b) => b.id === me.id ? { ...b, start: change.start, end: iso(ms(change.start) + dur(b)) } : b);
  const chain = followers(blocks, me.id);
  if (chain.length) return { blocks: cascade(moved, [me.id, ...chain], { events, meals: false }).blocks, notes: [], meta: { ...plan.meta, pending: undefined } };
  const group = me.group ? blocks.filter((b) => b.group === me.group && b.id !== me.id) : [];
  if (!group.length || group.every((b) => declined.includes(b.id))) return { blocks: moved, notes: [], meta: { ...plan.meta, pending: undefined } };
  const items = [me.id, ...group.map((b) => b.id)].sort((a, b) => ms(find(a).start) - ms(find(b).start));
  const text = `${join(items.map((id) => find(id).title))} may be part of the same plan. Adjust them together?`;
  const pending = { blockId: me.id, delta: ms(change.start) - ms(me.start), items: items.filter((id) => id !== me.id) };
  return { blocks: moved, question: { text, items }, notes: [], meta: { ...plan.meta, pending } };
}

export function replanWith(input, solver) {
  const { plan, change, answers } = input, events = input.events ?? [], kind = plan?.meta?.kind;
  if (kind === 'deadline' && change) return replanDeadline(plan, change, events, solver.finder);
  if (kind === 'deadline' || kind === 'basic' || kind === 'discover') return { ...clean(plan), notes: plan.notes ?? [], meta: plan.meta };
  return replanRelated(plan, change, events, answers);
}
