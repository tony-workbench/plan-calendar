// Adapter that puts a constraint-style core (plan/replan with its own state) behind the shared
// planner interface in ../interface.mjs: notes and meta on every result, change objects of type
// 'drag' and 'more-time', answers { confirm: 'all' | 'none' | [ids] }, and context.mode === 'discover'.

import { DAY, toMs, toIso } from '../interface.mjs';

const CORE_KEYS = ['now', 'intent', 'hints', 'links', 'refused', 'asked', 'deadline', 'request'];

const isFree = (start, end, events) => !events.some((e) => start < toMs(e.end) && end > toMs(e.start));

function discover(events, now, context) {
  const meta = { kind: 'discover', now: toIso(now) };
  const interests = context.interests ?? [];
  if (context.dismissed) return { blocks: [], notes: ['prompt was ignored; not asking again'], meta };
  if (!interests.length || !context.city || !context.source) {
    return { blocks: [], notes: ['too little information to suggest activities'], meta };
  }
  return Promise.resolve(context.source.find({ interests, city: context.city, from: toIso(now), to: toIso(now + 7 * DAY) })).then((found) => {
    const seen = new Set();
    const blocks = (found ?? [])
      .filter((c) => c && c.id && c.title && c.start && c.end && c.place && c.reason && c.source)
      .filter((c) => !c.tags || c.tags.some((t) => interests.includes(t)))
      .filter((c) => toMs(c.start) >= now && isFree(toMs(c.start), toMs(c.end), events))
      .filter((c) => !seen.has(c.id) && seen.add(c.id))
      .sort((a, b) => toMs(a.start) - toMs(b.start))
      .slice(0, 3)
      .map((c) => ({
        id: `candidate-${c.id}`, title: c.title, start: toIso(toMs(c.start)), end: toIso(toMs(c.end)),
        kind: 'candidate', tentative: true, place: c.place, reason: c.reason, source: c.source,
      }));
    const words = ['', 'One activity fits', 'Two activities fit', 'Three activities fit'];
    return {
      blocks,
      question: blocks.length ? { text: `${words[blocks.length]} you this week, want to see ${blocks.length === 1 ? 'it' : 'them'}?`, items: blocks.map((b) => b.id) } : undefined,
      notes: blocks.length ? ['candidates screened from the source'] : ['no reliable candidate fits'],
      meta,
    };
  });
}

// Core result -> interface result.
function toResult(core, extra = {}) {
  const steps = core.intent === 'deadline';
  const blocks = (core.blocks || []).map(({ after, userMoved, pastDeadline, ...b }, i) => ({
    ...b,
    kind: b.kind || 'proposed',
    ...(after && after.length ? { dependsOn: after } : {}),
    ...(steps ? { step: i + 1 } : {}),
  }));
  const notes = [];
  if (core.error) notes.push(core.error);
  for (const u of core.unplaced || []) notes.push(`no free time for ${u.title}`);
  const meta = { kind: core.intent === 'deadline' ? 'deadline' : core.intent || 'basic', ...extra };
  if (core.deadline) meta.deadline = core.deadline;
  meta.core = Object.fromEntries(CORE_KEYS.filter((k) => core[k] !== undefined).map((k) => [k, core[k]]));
  const result = { blocks, notes, meta };
  if (core.question) result.question = { text: core.question.text, items: core.question.items };
  return result;
}

// Interface plan -> core plan.
function toCore(prev) {
  const stored = prev.meta?.core || {};
  const hints = stored.hints || [];
  if (!hints.length) {
    const groups = new Map();
    for (const b of prev.blocks) if (b.group) groups.set(b.group, [...(groups.get(b.group) || []), b.id]);
    for (const items of groups.values()) if (items.length > 1) hints.push({ items });
  }
  return {
    ...stored,
    hints,
    deadline: stored.deadline ?? prev.meta?.deadline,
    blocks: prev.blocks.map((b) => ({ ...b, after: b.dependsOn || [], goal: b.goal ?? b.group })),
  };
}

export function adapt({ plan: corePlan, replan: coreReplan }) {
  return {
    plan(input = {}) {
      const { events = [], now, context = {} } = input;
      if (context.mode === 'discover') return discover(events, toMs(now ?? Date.now()), context);
      return toResult(corePlan(input));
    },
    replan({ plan: prev, change, events = [], answers } = {}) {
      let core = toCore(prev);
      let coreChange;
      if (change) {
        coreChange = { blockId: change.blockId };
        if (change.type === 'drag') coreChange.start = change.start;
        else if (change.type === 'more-time') coreChange.extraMinutes = change.minutes;
      } else if (answers && prev.meta?.pending) {
        const { blockId, start } = prev.meta.pending;
        const cur = prev.blocks.find((b) => b.id === blockId);
        coreChange = { blockId, ...(start ? { start } : cur ? { start: cur.start } : {}) };
      } else {
        return { blocks: prev.blocks, notes: ['nothing to change'], meta: prev.meta };
      }
      const confirm = answers?.confirm;
      const coreAnswers = answers ? { confirmed: confirm === 'none' || confirm == null ? [] : confirm } : undefined;
      const result = coreReplan({ plan: core, change: coreChange, events, answers: coreAnswers });
      const out = toResult({ ...result, intent: prev.meta?.kind === 'deadline' ? 'deadline' : result.intent ?? prev.meta?.kind }, prev.meta?.kind ? { } : {});
      out.meta.kind = prev.meta?.kind ?? out.meta.kind;
      if (prev.meta?.deadline) out.meta.deadline = prev.meta.deadline;
      if (out.question) {
        out.meta.pending = { blockId: coreChange.blockId, ...(change?.type === 'drag' ? { start: change.start } : {}) };
      }
      return out;
    },
  };
}
