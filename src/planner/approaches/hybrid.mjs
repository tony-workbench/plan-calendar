// Approach 3: hybrid planner.
// A small intent parser (reusing the constraint helpers) plus a scorer that picks among candidate
// placements. Re-planning touches only affected items and merges related items into one question.
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }.

import { planWith, replanCore, parseRequest } from './constraint.mjs';
import { adapt } from './adapt.mjs';
import { DAY, HOUR, startOfDay } from './slots.mjs';

export { parseRequest };

// Candidate start times for a block of dur inside the free slots.
export function candidateStarts(slots, dur, { dir, bound }) {
  const cands = [];
  for (const s of slots) {
    const lo = dir === 'fwd' ? Math.max(s.start, bound) : s.start;
    const hi = dir === 'back' ? Math.min(s.end, bound) : s.end;
    if (hi - lo < dur) continue;
    cands.push(lo, hi - dur); // flush with the start or the end of the free interval
  }
  return [...new Set(cands)];
}

// Higher is better.
export function score(start, dur, { dir, bound, busy = [], avoidDay = null }) {
  const end = start + dur;
  let s = 0;
  if (dir === 'fwd') s -= ((start - bound) / DAY) * 10; // sooner is better
  else s -= ((bound - end) / DAY) * 6; // close to, but before, the next step
  if (busy.some((b) => b.end === start || b.start === end)) s += 2; // keeps the day compact
  const day = startOfDay(start);
  if (start < day + 13 * HOUR && end > day + 12 * HOUR) s -= 8; // avoid lunch
  if (avoidDay != null && day === avoidDay) s -= 3; // spread prep steps over days
  s -= Math.abs(start - (day + 10 * HOUR)) / HOUR / 10; // mild preference for mid-morning
  return s;
}

const scorer = {
  pick(slots, dur, opts) {
    let best = null;
    for (const c of candidateStarts(slots, dur, opts)) {
      const sc = score(c, dur, opts);
      if (best == null || sc > best.sc || (sc === best.sc && c < best.c)) best = { c, sc };
    }
    return best ? best.c : null;
  },
};

export function plan(input) {
  return planWith(input, scorer);
}

export function replan(input) {
  return replanCore(input, { inferHints: true });
}

export default adapt({ plan, replan });
