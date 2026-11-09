// Approach 1: plain rules planner.
// Places blocks with the shared first-fit/back-schedule helpers, then re-plans with fixed rules:
// set the changed block, push the steps that depend on it, nothing else. No related-item inference,
// so it never asks a question, and it does not re-check fixed events or the deadline after a change.
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }.

import { planWith } from './core.mjs';
import { adapt } from './adapt.mjs';
import { MIN, ms, iso } from './slots.mjs';

export function plan(input) {
  return planWith(input);
}

export function replan({ plan: prev, change = {} }) {
  const blocks = prev.blocks.map((b) => ({ ...b, start: ms(b.start), end: ms(b.end), moved: false }));
  const target = blocks.find((b) => b.id === change.blockId);
  if (!target) return { ...prev, error: `Unknown block: ${change.blockId}`, question: null };
  const dur = target.end - target.start + (change.minutes || change.extraMinutes || 0) * MIN;
  target.start = change.start != null ? ms(change.start) : target.start;
  target.end = target.start + dur;
  const chain = new Set([target.id]);
  let cursor = target.end;
  for (const b of [...blocks].sort((x, y) => x.start - y.start)) {
    if (chain.has(b.id) || !(b.after || []).some((a) => chain.has(a))) continue;
    chain.add(b.id);
    if (b.start < cursor) { const d = b.end - b.start; b.start = cursor; b.end = cursor + d; b.moved = true; }
    cursor = Math.max(cursor, b.end);
  }
  const { previous: _drop, ...prevClean } = prev;
  const out = blocks.sort((a, b) => a.start - b.start).map((b) => ({ ...b, start: iso(b.start), end: iso(b.end) }));
  return { ...prev, blocks: out, question: null, previous: prevClean };
}

export default adapt({ plan, replan });
