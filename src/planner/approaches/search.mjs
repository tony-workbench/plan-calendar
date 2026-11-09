// Approach 2: constraint search. Free slots are the domain, order and deadline are constraints, and a
// depth-first search with backtracking looks for a full set of steps; a soft cost prefers a little air around events.
import { planWith, replanWith, greedyFinder, greedySteps, isFree, slots, ceilTo, STEP_VARIANTS, ms, MIN } from '../core.mjs';

const cost = (t, length, events) => events.some((e) => t < ms(e.end) + 15 * MIN && t + length > ms(e.start) - 15 * MIN) ? 1 : 0;

function finder(from, length, o = {}) {
  let best = null, bestCost = Infinity, seen = 0;
  for (const t of slots(from, length, o)) {
    if (!isFree(t, t + length, o)) continue;
    const c = cost(t, length, o.events ?? []);
    if (c < bestCost) { best = t; bestCost = c; }
    if (c === 0 || ++seen >= 24) break;
  }
  return best;
}

function search(intent, ctx, lengths) {
  const start = ceilTo(ms(ctx.now)), span = intent.deadline - start;
  if (span <= 0) return null;
  const domains = lengths.map((length) => [...slots(start, length, { limit: intent.deadline })].filter((t) => isFree(t, t + length, { events: ctx.events })));
  let nodes = 0;
  const dfs = (i, prevEnd, left) => {
    if (i === lengths.length) return [];
    if (++nodes > 50000 || prevEnd + left > intent.deadline) return null;
    const share = start + (span * i) / lengths.length;
    const ok = domains[i].filter((t) => t >= prevEnd);
    for (const t of [...ok.filter((x) => x >= share), ...ok.filter((x) => x < share)]) {
      const rest = dfs(i + 1, t + lengths[i], left - lengths[i]);
      if (rest) return [t, ...rest];
    }
    return null;
  };
  return dfs(0, start, lengths.reduce((a, b) => a + b, 0));
}

function steps(intent, ctx) {
  for (const variant of STEP_VARIANTS) {
    const found = search(intent, ctx, variant.map((m) => m * MIN));
    if (found) return found.map((s, i) => ({ s, minutes: variant[i] }));
  }
  return greedySteps(intent, ctx, greedyFinder);
}

const solver = { finder, steps };
export const plan = async (input, intent) => planWith(input, solver, intent);
export const replan = async (input) => replanWith(input, solver);
export default { plan, replan };
