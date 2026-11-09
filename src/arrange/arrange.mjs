// Basic arrangement: place one block in the earliest free slot. Pure and deterministic; no calendar adapter.
// Working hours are read in UTC so the result does not depend on the machine's time zone.
const MIN = 60000, DAY = 86400000, GRID = 5 * MIN, BUFFER = 10 * MIN;

// Timestamps without a zone ("2026-11-09T09:00:00") are read as UTC, never machine-local time.
const NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const toMs = (v) => {
  const ms = typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Date.parse(typeof v === 'string' && NO_ZONE.test(v.trim()) ? `${v.trim()}Z` : v);
  return Number.isFinite(ms) ? ms : NaN;
};
const clock = (s, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? fallback));
  const [h, mi] = m ? [Number(m[1]), Number(m[2])] : clock(fallback, fallback);
  return (h * 60 + mi) * MIN;
};
const ceilGrid = (ms) => Math.ceil(ms / GRID) * GRID;

export function arrange({ intent, events = [], now, windowDays = 7, dayStart = '09:00', dayEnd = '18:00' } = {}) {
  const title = String(intent?.title ?? 'Block');
  const durationMin = Number(intent?.durationMin ?? 30);
  if (!(durationMin > 0)) throw new TypeError('intent.durationMin must be positive');
  const nowMs = toMs(now);
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid time');
  const copy = JSON.parse(JSON.stringify(events));
  const notes = [];
  const busy = [];
  for (const ev of copy) {
    const s = toMs(ev?.start), e = toMs(ev?.end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) busy.push([s, e]);
    else notes.push(`Ignored event ${ev?.id ?? '?'} with an invalid time range.`);
  }
  busy.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const len = durationMin * MIN;
  const open = clock(dayStart, '09:00'), close = clock(dayEnd, '18:00');
  const firstDay = Math.floor(nowMs / DAY) * DAY;
  let found = null;
  for (let d = 0; d < windowDays && !found; d++) {
    const base = firstDay + d * DAY;
    const lo = base + open, hi = base + close;
    // Candidate starts: the opening of the window, plus the end of every event (with buffer).
    const starts = new Set([Math.max(lo, ceilGrid(nowMs))]);
    for (const [, e] of busy) starts.add(ceilGrid(e + BUFFER));
    for (const s of [...starts].sort((a, b) => a - b)) {
      if (s < lo || s < nowMs || s + len > hi) continue;
      // Keep a buffer on both sides of every event; this also rules out any overlap.
      if (busy.some(([bs, be]) => s < be + BUFFER && s + len > bs - BUFFER)) continue;
      found = s;
      break;
    }
  }
  if (found === null) {
    notes.push(`No free ${durationMin}-minute slot in the next ${windowDays} days within working hours.`);
    return { blocks: [], events: copy, notes };
  }
  const start = new Date(found).toISOString(), end = new Date(found + len).toISOString();
  notes.push(`Placed "${title}" at the earliest free slot with a ${BUFFER / MIN}-minute buffer.`);
  return { blocks: [{ id: `block-${start}`, title, start, end, kind: 'proposed' }], events: copy, notes };
}

export default arrange;
