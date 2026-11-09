// Time helpers shared by the planners: a daily working window and first/last free slot search.
export const MIN = 60000;
const DAY = 24 * 60 * MIN;
const OPEN = 8 * 60 * MIN;
const CLOSE = 18 * 60 * MIN;

export const ms = (t) => (typeof t === 'number' ? t : Date.parse(t));
export const iso = (t) => new Date(t).toISOString();

const dayStart = (t) => Math.floor(t / DAY) * DAY;
const busyOf = (events) => events.map((e) => [ms(e.start), ms(e.end)]);

function freeIn(lo, hi, busy) {
  let free = hi > lo ? [[lo, hi]] : [];
  for (const [s, e] of busy) {
    free = free.flatMap(([a, b]) => (e <= a || s >= b ? [[a, b]] : [[a, Math.min(b, s)], [Math.max(a, e), b]].filter(([x, y]) => y > x)));
  }
  return free;
}

// Earliest slot of `minutes` at or after `from`, inside the working window, clear of `events`.
export function firstFit(events, from, minutes, days = 60) {
  const busy = busyOf(events);
  for (let d = dayStart(from), i = 0; i < days; d += DAY, i++) {
    for (const [a, b] of freeIn(Math.max(d + OPEN, from), d + CLOSE, busy)) {
      if (b - a >= minutes * MIN) return { start: a, end: a + minutes * MIN };
    }
  }
  return null;
}

// Latest slot of `minutes` that ends at or before `before` and starts at or after `from`.
export function lastFit(events, before, minutes, from, days = 60) {
  const busy = busyOf(events);
  for (let d = dayStart(before - 1), i = 0; i < days && d + CLOSE > from; d -= DAY, i++) {
    const free = freeIn(Math.max(d + OPEN, from), Math.min(d + CLOSE, before), busy);
    for (const [a, b] of free.reverse()) {
      if (b - a >= minutes * MIN) return { start: b - minutes * MIN, end: b };
    }
  }
  return null;
}
