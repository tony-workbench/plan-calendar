// Scores one planner on one case. Every check is named and typed, as in TravelPlanner:
//   commonsense = implicit rules a sensible plan always follows; hard = what this user explicitly asked for.
// Returns { delivered, checks: [{name, type, ok}], sideEffects, questions, ms, error? }.
import * as I from './contract.mjs';

const MIN = 60000;

const ms = (v) => Date.parse(v);
const hm = (v) => { const d = new Date(ms(v)); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const dayOf = (v) => Math.floor((ms(v) - Date.parse('2026-11-09T00:00:00.000Z')) / 86400000);
const MEALS = [[450, 480], [720, 780], [1110, 1170]]; // 7:30-8:00, 12:00-13:00, 18:30-19:30
const overlapsMin = (s, e, [a, b]) => s < b && e > a;
const mins = (b) => (ms(b.end) - ms(b.start)) / MIN;
const same = (a, b) => ms(a.start) === ms(b.start) && ms(a.end) === ms(b.end);

function C() {
  const checks = []; let sideEffects = 0, questions = 0;
  return { checks, get sideEffects() { return sideEffects; }, get questions() { return questions; },
    add: (name, type, ok) => checks.push({ name, type, ok: !!ok }),
    side: (n) => { sideEffects += n; }, q: (r) => { if (r && r.question) questions++; return r; } };
}
const viol = (plan, opts, codes) => I.validatePlan(plan, opts).violations.filter((v) => !codes || codes.includes(v.code));

function life(c, blocks, now) { // commonsense rules from the PRD: not in the past, awake hours, not in meals
  const real = blocks.filter((b) => b.kind !== 'candidate');
  c.add('not-in-past', 'commonsense', real.every((b) => ms(b.start) >= ms(now)));
  c.add('awake-hours', 'commonsense', real.every((b) => hm(b.start) >= 450 && hm(b.end) <= 1410 || (hm(b.end) === 0)));
  c.add('not-in-meals', 'commonsense', real.every((b) => !MEALS.some((m) => overlapsMin(hm(b.start), hm(b.end) || 1440, m))));
}

async function basic(p, k, c) {
  const r = c.q(await p.plan({ request: k.request, events: k.events, now: k.now, context: k.context }));
  const e = k.expect;
  c.add('block-count', 'hard', r.blocks.length === e.blocks);
  if (e.noQuestion) c.add('no-question', 'hard', !r.question);
  if (e.blocks === 0) return r;
  const [b] = r.blocks;
  if (b) {
    if (e.minutes) c.add('duration', 'hard', mins(b) === e.minutes);
    if (e.minMinutes) c.add('duration-sensible', 'hard', mins(b) >= e.minMinutes && mins(b) <= e.maxMinutes);
    if (e.notDay !== undefined) c.add('other-day', 'hard', dayOf(b.start) !== e.notDay);
    if (e.afterHour) c.add('after-requested-hour', 'hard', hm(b.start) >= e.afterHour * 60 && dayOf(b.start) === e.day);
  }
  c.add('no-overlap', 'commonsense', viol(r, { events: k.events }, ['overlap-event', 'overlap-block']).length === 0);
  life(c, r.blocks, k.now);
  return r;
}

const freeFrom = (events, blocks, from, dur, limit) => {
  for (let t = from; t + dur <= limit; t += 15 * MIN) {
    if ([...events, ...blocks].every((x) => t + dur <= ms(x.start) || t >= ms(x.end))) return t;
  }
  return null;
};

async function deadline(p, k, c) {
  const e = k.expect, dl = ms(e.deadline);
  const r = c.q(await p.plan({ request: k.request, events: k.events, now: k.now, context: k.context }));
  const steps = [...r.blocks].sort((a, b) => ms(a.start) - ms(b.start));
  c.add('enough-steps', 'hard', steps.length >= e.minSteps);
  c.add('before-deadline', 'hard', steps.every((b) => ms(b.end) <= dl));
  if (e.tight) c.add('gap-shown', 'hard', steps.length > 0 && (steps.every((b) => ms(b.end) <= dl) || r.notes.length > 0 || !!r.question) && (r.notes.length > 0 || !!r.question || steps.length >= e.minSteps));
  c.add('no-overlap', 'commonsense', viol(r, { events: k.events }, ['overlap-event', 'overlap-block']).length === 0);
  c.add('steps-ordered', 'commonsense', viol(r, {}, ['order']).length === 0);
  life(c, r.blocks, k.now);
  if (!e.change || steps.length < 2) return r;
  const ids = steps.map((b) => b.id);
  if (e.change.type === 'drag') {
    const first = steps[0], dur = ms(first.end) - ms(first.start);
    const others = steps.slice(1);
    const target = freeFrom(k.events, others, ms(first.start) + e.change.shiftDays * 86400000, dur, dl - 3 * 3600000);
    if (target === null) return r;
    const change = { type: 'drag', blockId: first.id, start: new Date(target).toISOString() };
    const d = c.q(await p.replan({ plan: r, change, events: k.events }));
    const dragged = d.blocks.find((b) => b.id === first.id);
    c.add('drag-respected', 'hard', !!dragged && dragged.start === change.start);
    const v = viol(d, { events: k.events, eventsBefore: k.events, before: r, allowedMoves: ids, deadline: e.deadline });
    c.side(v.filter((x) => x.code === 'moved-event' || x.code === 'moved-unrelated').length);
    c.add('replan-valid', 'commonsense', v.filter((x) => !['moved-event', 'moved-unrelated'].includes(x.code)).length === 0);
    const movedNow = d.blocks.filter((b) => b.id !== first.id && r.blocks.find((o) => o.id === b.id && !same(o, b)));
    c.add('moved-marked', 'hard', movedNow.every((b) => b.moved));
  } else {
    const prod = steps[1], plusMin = e.change.minutes;
    const m = c.q(await p.replan({ plan: r, change: { type: 'more-time', blockId: prod.id, minutes: plusMin }, events: k.events }));
    const after = m.blocks.find((b) => b.id === prod.id);
    c.add('longer', 'hard', !!after && mins(after) === mins(prod) + plusMin);
    c.add('earlier-untouched', 'hard', steps.slice(0, 1).every((o) => { const n = m.blocks.find((b) => b.id === o.id); return n && same(n, o); }));
    const v = viol(m, { events: k.events, eventsBefore: k.events, before: r, allowedMoves: ids.slice(1), deadline: e.deadline });
    c.side(v.filter((x) => x.code === 'moved-event' || x.code === 'moved-unrelated').length);
    c.add('replan-valid', 'commonsense', v.filter((x) => !['moved-event', 'moved-unrelated'].includes(x.code)).length === 0);
  }
  return r;
}

async function discovery(p, k, c) {
  const e = k.expect;
  const r = c.q(await p.plan({ request: k.request, events: k.events, now: k.now, context: k.context }));
  if (e.none) { c.add('nothing-offered', 'hard', r.blocks.length === 0); c.add('no-prompt', 'hard', !r.question); return r; }
  c.add('finds-some', 'hard', r.blocks.length >= 1);
  c.add('at-most-three', 'hard', r.blocks.length <= e.maxBlocks);
  c.add('only-valid', 'hard', r.blocks.every((b) => e.validIds.includes(String(b.id).replace(/^candidate-/, ''))));
  c.add('fields-shown', 'hard', r.blocks.every((b) => b.place && b.reason && b.source && b.tentative));
  c.add('one-light-prompt', 'hard', !!r.question && r.blocks.length > 0);
  c.add('no-clash', 'commonsense', viol(r, { events: k.events }, ['overlap-event']).length === 0);
  return r;
}

async function related(p, k, c) {
  const e = k.expect, base = k.plan, events = k.events;
  const chain = e.chain, byId = (x, id) => x.blocks.find((b) => b.id === id);
  const unchanged = (x, ids) => ids.every((id) => { const a = byId(base, id), b = byId(x, id); return b && same(a, b); });
  const moved = (x, ids) => ids.some((id) => { const a = byId(base, id), b = byId(x, id); return b && !same(a, b); });
  const sidecount = (x, allowed) => base.blocks.filter((o) => !allowed.includes(o.id) && !(byId(x, o.id) && same(o, byId(x, o.id)))).length;
  const ask = c.q(await p.replan({ plan: base, change: k.change, events }));
  const first = chain[0], rest = chain.slice(1);
  const evViol = (x) => viol(x, { events, eventsBefore: events }, ['moved-event', 'overlap-event']).length;
  if (e.known) {
    c.add('no-question', 'hard', !ask.question);
    c.add('dependents-follow', 'hard', moved(ask, rest.slice(0, 1)));
    c.add('unrelated-untouched', 'hard', unchanged(ask, [e.other]));
    c.side(sidecount(ask, chain));
    c.add('order-kept', 'commonsense', viol(ask, {}, ['order']).length === 0 && chain.every((id, i) => i === 0 || ms(byId(ask, id).start) >= ms(byId(ask, chain[i - 1]).end)));
    return ask;
  }
  c.add('one-merged-question', 'hard', !!ask.question && chain.every((id) => ask.question.items.includes(id)) && !ask.question.items.includes(e.other));
  c.add('nothing-moves-yet', 'hard', unchanged(ask, rest.concat([e.other])));
  c.side(sidecount(ask, [first]));
  const all = c.q(await p.replan({ plan: ask, change: null, events, answers: { confirm: 'all' } }));
  c.add('no-second-question', 'hard', !all.question);
  c.add('confirmed-follow', 'hard', moved(all, rest.slice(0, 1)));
  c.add('unrelated-untouched', 'hard', unchanged(all, [e.other]));
  c.side(sidecount(all, chain));
  c.add('order-kept', 'commonsense', chain.every((id, i) => !byId(all, id) || i === 0 || ms(byId(all, id).start) >= ms(byId(all, chain[i - 1]).end)));
  c.add('fixed-events-safe', 'commonsense', evViol(all) === 0);
  if (e.partial) {
    const part = c.q(await p.replan({ plan: ask, change: null, events, answers: { confirm: [e.partial] } }));
    const left = rest.filter((id) => id !== e.partial);
    c.add('partial-only', 'hard', unchanged(part, left) && unchanged(part, [e.other]));
    c.side(sidecount(part, [first, e.partial]));
  }
  const no = c.q(await p.replan({ plan: ask, change: null, events, answers: { confirm: 'none' } }));
  c.add('refusal-moves-nothing', 'hard', unchanged(no, rest.concat([e.other])));
  const again = c.q(await p.replan({ plan: no, change: { ...k.change, start: new Date(ms(k.change.start) + 30 * MIN).toISOString() }, events }));
  c.add('refused-not-asked-again', 'hard', !again.question);
  return all;
}

const RUN = { basic, deadline, discovery, related };

export async function scoreCase(planner, k, timeoutMs = 60000) {
  const c = C(), t0 = performance.now();
  let delivered = true, error;
  try {
    const checked = I.enforce(planner);
    let timer;
    try { await Promise.race([RUN[k.category](checked, k, c), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), timeoutMs); })]); } finally { clearTimeout(timer); }
  } catch (err) { delivered = false; error = String(err.message).slice(0, 200); }
  return { id: k.id, category: k.category, sub: k.sub, delivered, checks: c.checks, sideEffects: c.sideEffects, questions: c.questions, ms: Math.round(performance.now() - t0), ...(error ? { error } : {}) };
}
export const casePass = (r) => r.delivered && r.checks.length > 0 && r.checks.every((x) => x.ok);
