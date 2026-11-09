// Approach 4: hybrid.
// Rules answer first because they are cheap and predictable. Every rules result is checked against the
// hard rules (fixed events, overlaps, step order, deadline); a result that breaks one is redone by
// constraint search. An optional model only reads requests the parser cannot (createHybrid({ model })).
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }.

import { createPlanner, rulesStrategy, searchStrategy, violations } from '../lib/engine.mjs';
import { adapt } from '../lib/adapt.mjs';

// model.complete({ prompt }) -> JSON text { "minutes": number, "title": string } for a one-off task.
export function createHybrid({ model } = {}) {
  const interpret = model && (async (request) => {
    try {
      const r = JSON.parse(await model.complete({ prompt: JSON.stringify({ task: 'Read a scheduling request', request }) }));
      return Number.isFinite(r?.minutes) && r.minutes > 0 ? { kind: 'basic', title: String(r.title || 'Task'), minutes: r.minutes, afterHour: null, sameDay: false } : null;
    } catch { return null; }
  });
  const rules = createPlanner(rulesStrategy, { interpret });
  const search = createPlanner(searchStrategy, { interpret });
  const pick = async (input, call) => {
    const first = await rules[call](input);
    const empty = call === 'plan' && !first.blocks.length && input.context?.mode !== 'discover' && /\b(due|deadline)\b/i.test(input.request ?? '');
    if (violations(first, input.events) === 0 && !empty) return { ...first, notes: [...first.notes, 'rules result passed the hard-rule check'] };
    const second = await search[call](input);
    return { ...second, notes: [...second.notes, 'rules result failed the hard-rule check, redone by search'] };
  };
  return adapt({ plan: (input) => pick(input, 'plan'), replan: (input) => pick(input, 'replan') });
}

export default createHybrid();
