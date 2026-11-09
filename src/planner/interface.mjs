// The one planner interface every approach implements.
//
//   plan({ request, events, now, context }) -> { blocks, question?, notes, meta? }
//   replan({ plan, change, events, answers }) -> { blocks, question?, notes, meta?, before? }
//
// Both may be sync or async. Times are ISO-8601 strings (UTC).
//
// Event: { id, title, start, end }              fixed, never moved by a planner
// Block: { id, title, start, end, kind, step?, dependsOn?, group?, moved?, ... }
//   kind: 'proposed' (a block the planner suggests) | 'candidate' (tentative, shown with a question mark)
//   dependsOn: ids of blocks that must end before this one starts (a usable link)
//   group: a hint that blocks belong to one activity; a hint is never proof of a link
//   moved: true when the block moved as a consequence of the user's change
// Question: { text, items: [blockId, ...] }     at most one per result
// change: { type: 'drag', blockId, start } | { type: 'more-time', blockId, minutes }
// answers: { confirm: 'all' | 'none' | [blockId, ...] } for the pending question
// plan.meta: { kind, deadline?, workHours?, pending?, asked?, refused?, ... } is planner state
//   that travels with the plan so replan needs nothing else.

export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function toMs(value) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid time: ${value}`);
  return ms;
}

export const toIso = (ms) => new Date(ms).toISOString();
export const overlaps = (a, b) => toMs(a.start) < toMs(b.end) && toMs(a.end) > toMs(b.start);

export function assertPlanner(planner) {
  for (const fn of ['plan', 'replan']) {
    if (!planner || typeof planner[fn] !== 'function') {
      throw new TypeError(`Planner must implement ${fn}()`);
    }
  }
  return planner;
}

// Problems with the shape of a plan() / replan() result; [] when well formed.
export function checkResult(result) {
  const problems = [];
  if (!result || typeof result !== 'object') return ['result must be an object'];
  if (!Array.isArray(result.blocks)) return ['result.blocks must be an array'];
  if (!Array.isArray(result.notes)) problems.push('result.notes must be an array');
  const q = result.question;
  if (q !== undefined && q !== null) {
    if (typeof q.text !== 'string' || !q.text) problems.push('question.text must be a non-empty string');
    if (!Array.isArray(q.items)) problems.push('question.items must be an array');
  }
  const ids = new Set();
  for (const b of result.blocks) {
    if (!b || typeof b.id !== 'string' || typeof b.title !== 'string') {
      problems.push('block needs string id and title');
      continue;
    }
    if (ids.has(b.id)) problems.push(`duplicate block id ${b.id}`);
    ids.add(b.id);
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) problems.push(`block ${b.id} has an invalid time range`);
  }
  return problems;
}

// Wrap a planner so every result is shape-checked; a bad result throws.
export function enforce(planner) {
  assertPlanner(planner);
  const check = async (name, call) => {
    const result = await call();
    const problems = checkResult(result);
    if (problems.length) throw new TypeError(`${name}() broke the interface: ${problems.join('; ')}`);
    return result;
  };
  return {
    plan: (input) => check('plan', () => planner.plan(input)),
    replan: (input) => check('replan', () => planner.replan(input)),
  };
}

const sameTime = (a, b) => toMs(a.start) === toMs(b.start) && toMs(a.end) === toMs(b.end);

// validatePlan(plan, opts) -> { ok, violations: [{ code, ... }] }
//   opts.events        fixed events the plan must not overlap
//   opts.deadline      defaults to plan.meta.deadline
//   opts.eventsBefore  the events before the change; they must be unchanged in opts.events
//   opts.before        the plan before the change (a result or { blocks })
//   opts.allowedMoves  ids that may differ from `before` (the changed block and its dependents)
// codes: shape, overlap-event, overlap-block, order, deadline, moved-event, moved-unrelated
export function validatePlan(plan, opts = {}) {
  const violations = [];
  const problems = checkResult({ notes: [], ...plan });
  for (const message of problems) violations.push({ code: 'shape', message });
  if (problems.length) return { ok: false, violations };

  const { blocks } = plan;
  const events = opts.events ?? [];
  const deadline = opts.deadline ?? plan.meta?.deadline;
  const byId = new Map(blocks.map((b) => [b.id, b]));

  for (const b of blocks) {
    for (const ev of events) {
      if (overlaps(b, ev)) violations.push({ code: 'overlap-event', block: b.id, event: ev.id });
    }
    if (deadline && toMs(b.end) > toMs(deadline)) violations.push({ code: 'deadline', block: b.id });
    for (const dep of b.dependsOn ?? []) {
      const d = byId.get(dep);
      if (d && toMs(d.end) > toMs(b.start)) violations.push({ code: 'order', block: b.id, after: dep });
    }
  }

  const real = blocks.filter((b) => b.kind !== 'candidate');
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      if (overlaps(real[i], real[j])) violations.push({ code: 'overlap-block', block: real[i].id, other: real[j].id });
    }
  }

  const steps = blocks.filter((b) => Number.isFinite(b.step)).sort((a, b) => a.step - b.step);
  for (let i = 1; i < steps.length; i++) {
    if (toMs(steps[i].start) < toMs(steps[i - 1].end)) {
      violations.push({ code: 'order', block: steps[i].id, after: steps[i - 1].id });
    }
  }

  if (opts.eventsBefore) {
    const now = new Map(events.map((e) => [e.id, e]));
    for (const ev of opts.eventsBefore) {
      const cur = now.get(ev.id);
      if (!cur || !sameTime(cur, ev)) violations.push({ code: 'moved-event', event: ev.id });
    }
  }

  if (opts.before && opts.allowedMoves) {
    const allowed = new Set(opts.allowedMoves);
    for (const old of opts.before.blocks) {
      const cur = byId.get(old.id);
      if (cur && !allowed.has(old.id) && !sameTime(cur, old)) violations.push({ code: 'moved-unrelated', block: old.id });
    }
  }

  return { ok: violations.length === 0, violations };
}
