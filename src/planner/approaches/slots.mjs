// Shared slot and interval helpers for the constraint and hybrid planners.
// All times are handled as epoch milliseconds in UTC; callers pass ISO strings or numbers.

export const MIN = 60000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const ms = (v) => (typeof v === 'number' ? v : Date.parse(v));
export const iso = (n) => new Date(n).toISOString();
export const startOfDay = (t) => Math.floor(t / DAY) * DAY;
export const roundUp = (t, step = 15 * MIN) => Math.ceil(t / step) * step;

export const overlaps = (a, b) => a.start < b.end && b.start < a.end;

export function normalize(list = []) {
  return list
    .filter((e) => e && e.start != null && e.end != null)
    .map((e) => ({ ...e, start: ms(e.start), end: ms(e.end) }));
}

export function mergeIntervals(list) {
  const sorted = list.map((i) => ({ start: i.start, end: i.end })).sort((a, b) => a.start - b.start);
  const out = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push(i);
  }
  return out;
}

// Free intervals inside working hours (UTC) between from and to, minus busy intervals.
export function freeSlots(busy, from, to, { dayStart = 9, dayEnd = 18 } = {}) {
  const merged = mergeIntervals(busy);
  const out = [];
  for (let d = startOfDay(from); d < to; d += DAY) {
    const lo = Math.max(d + dayStart * HOUR, from);
    const hi = Math.min(d + dayEnd * HOUR, to);
    if (lo >= hi) continue;
    let cur = lo;
    for (const b of merged) {
      if (b.end <= cur) continue;
      if (b.start >= hi) break;
      if (b.start > cur) out.push({ start: cur, end: b.start });
      cur = Math.max(cur, b.end);
      if (cur >= hi) break;
    }
    if (cur < hi) out.push({ start: cur, end: hi });
  }
  return out;
}

// Earliest start >= notBefore where a block of dur fits, or null.
export function firstFit(slots, dur, notBefore = -Infinity) {
  for (const s of slots) {
    const st = Math.max(s.start, notBefore);
    if (st + dur <= s.end) return st;
  }
  return null;
}

// Latest start such that the block ends <= notAfter, or null.
export function lastFit(slots, dur, notAfter = Infinity) {
  for (let i = slots.length - 1; i >= 0; i--) {
    const en = Math.min(slots[i].end, notAfter);
    if (en - dur >= slots[i].start) return en - dur;
  }
  return null;
}

export function hits(busy, iv) {
  return busy.some((b) => overlaps(b, iv));
}

export function parseDuration(text, fallback = 60) {
  const t = String(text || '').toLowerCase();
  if (/half an hour|half hour/.test(t)) return 30;
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = t.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (m) return parseInt(m[1], 10);
  if (/\b(an|one) hour\b/.test(t)) return 60;
  return fallback;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Start (00:00 UTC) of the named weekday. "next X" is X in the following calendar week (Mon-Sun).
export function weekdayDate(name, nowMs, next) {
  const t = DAYS.indexOf(name.toLowerCase());
  if (t < 0) return null;
  const idx = (new Date(nowMs).getUTCDay() + 6) % 7;
  const ahead = next ? 7 - idx + t : (t - idx + 7) % 7 || 7;
  return startOfDay(nowMs) + ahead * DAY;
}
