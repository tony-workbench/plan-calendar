// Time helpers shared by the constraint and hybrid planners. All times are UTC milliseconds;
// planning happens inside a daily window of 08:00-18:00 UTC.

import { MIN, HOUR, DAY, toMs, toIso } from '../interface.mjs';

export { MIN, HOUR, DAY };
export const ms = toMs;
export const iso = toIso;

const WINDOW_START = 8 * HOUR;
const WINDOW_END = 18 * HOUR;

export const startOfDay = (t) => Math.floor(ms(t) / DAY) * DAY;
export const roundUp = (t, step = 15 * MIN) => Math.ceil(t / step) * step;

export const normalize = (events = []) =>
  events.map((e) => ({ start: ms(e.start), end: ms(e.end) })).sort((a, b) => a.start - b.start);

export const hits = (busy, b) => busy.some((x) => ms(b.start) < ms(x.end) && ms(b.end) > ms(x.start));

// Free intervals inside the daily window between from and to, minus the busy intervals.
export function freeSlots(busy, from, to) {
  const taken = normalize(busy);
  const slots = [];
  for (let day = startOfDay(from); day < to; day += DAY) {
    let cur = Math.max(day + WINDOW_START, from);
    const end = Math.min(day + WINDOW_END, to);
    for (const b of taken) {
      if (b.end <= cur || b.start >= end) continue;
      if (b.start > cur) slots.push({ start: cur, end: b.start });
      cur = Math.max(cur, b.end);
    }
    if (end > cur) slots.push({ start: cur, end });
  }
  return slots;
}

// Earliest start >= bound that fits dur, or null.
export function firstFit(slots, dur, bound = -Infinity) {
  for (const s of slots) {
    const st = Math.max(s.start, bound);
    if (s.end - st >= dur) return st;
  }
  return null;
}

// Start of the latest block of dur that ends at or before bound, or null.
export function lastFit(slots, dur, bound = Infinity) {
  for (let i = slots.length - 1; i >= 0; i--) {
    const end = Math.min(slots[i].end, bound);
    if (end - slots[i].start >= dur) return end - dur;
  }
  return null;
}

// "half an hour", "90 minutes", "2 hours", "1.5h" -> minutes.
export function parseDuration(text, fallback = 60) {
  const s = String(text || '').toLowerCase();
  if (/half an? hour/.test(s)) return 30;
  if (/an hour and a half/.test(s)) return 90;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  const m = s.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (m) return parseInt(m[1], 10);
  if (/\b(an|one)\s+(?:extra\s+)?hour\b/.test(s)) return 60;
  return fallback;
}

const NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Start of the next given weekday after now; `next` pushes it a further week.
export function weekdayDate(name, nowMs, next = false) {
  const today = startOfDay(nowMs);
  const target = NAMES.indexOf(String(name).toLowerCase());
  const ahead = ((target - new Date(today).getUTCDay() + 6) % 7) + 1;
  return today + (ahead + (next ? 7 : 0)) * DAY;
}
