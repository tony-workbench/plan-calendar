// Shared planner interface: plan({request, events, now, context}) and
// replan({plan, change, events, answers}), both returning { blocks, notes, meta, question? }.

export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const toMs = (v) => (typeof v === 'number' ? v : Date.parse(v));
export const toIso = (v) => new Date(toMs(v)).toISOString();

// Throws when a planner result breaks the interface.
export function enforce(result) {
  const fail = (msg) => { throw new Error(`planner interface: ${msg}`); };
  if (!result || typeof result !== 'object') fail('result must be an object');
  if (!Array.isArray(result.blocks)) fail('blocks must be an array');
  if (!Array.isArray(result.notes)) fail('notes must be an array');
  if (!result.meta || typeof result.meta !== 'object') fail('meta must be an object');
  for (const b of result.blocks) {
    if (!b.id || Number.isNaN(toMs(b.start)) || Number.isNaN(toMs(b.end))) fail(`bad block ${b.id}`);
  }
  if (result.question != null && typeof result.question.text !== 'string') fail('question needs text');
  return result;
}
