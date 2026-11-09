// Pure view geometry for the Preview Calendar day and week views. No DOM, no dependencies.
// Times are wall-clock ISO strings ("YYYY-MM-DDTHH:MM[:SS]"); any zone suffix is ignored.

const DEFAULTS = { startHour: 0, endHour: 24, pxPerHour: 48 };

const pad = (n) => String(n).padStart(2, '0');

function withDefaults(opts) {
  return { ...DEFAULTS, ...(opts || {}) };
}

function dayKeyOf(iso) {
  return String(iso).slice(0, 10);
}

function dayUtc(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function keyFromUtc(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Minutes since midnight of `dayKey` for an ISO wall-clock string (may be <0 or >1440).
function minutesOnDay(iso, dayKey) {
  const s = String(iso);
  const dayDiff = Math.round((dayUtc(dayKeyOf(s)) - dayUtc(dayKey)) / 86400000);
  const hh = Number(s.slice(11, 13)) || 0;
  const mm = Number(s.slice(14, 16)) || 0;
  return dayDiff * 1440 + hh * 60 + mm;
}

export function weekDays(dateIso) {
  const base = dayUtc(dayKeyOf(dateIso));
  const dow = new Date(base).getUTCDay(); // 0 = Sunday
  const monday = base - ((dow + 6) % 7) * 86400000;
  return Array.from({ length: 7 }, (_, i) => keyFromUtc(monday + i * 86400000));
}

export function layoutDay(items, dayKey, opts) {
  const { startHour, endHour, pxPerHour } = withDefaults(opts);
  const visStart = startHour * 60;
  const visEnd = endHour * 60;
  const pxPerMin = pxPerHour / 60;

  const clipped = [];
  for (const it of items || []) {
    const s = minutesOnDay(it.start, dayKey);
    const e = minutesOnDay(it.end, dayKey);
    const cs = Math.max(s, visStart);
    const ce = Math.min(e, visEnd);
    if (ce <= cs) continue; // not on this day or outside visible hours
    clipped.push({ id: it.id, kind: it.kind, cs, ce });
  }
  clipped.sort((a, b) => a.cs - b.cs || a.ce - b.ce || String(a.id).localeCompare(String(b.id)));

  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds = [];
    for (const c of cluster) {
      let col = colEnds.findIndex((end) => end <= c.cs);
      if (col === -1) col = colEnds.length;
      colEnds[col] = c.ce;
      c.col = col;
    }
    for (const c of cluster) {
      out.push({
        id: c.id,
        kind: c.kind,
        top: (c.cs - visStart) * pxPerMin,
        height: (c.ce - c.cs) * pxPerMin,
        col: c.col,
        cols: colEnds.length,
      });
    }
    cluster = [];
  };
  for (const c of clipped) {
    if (cluster.length && c.cs >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    cluster.push(c);
    clusterEnd = Math.max(clusterEnd, c.ce);
  }
  flush();
  return out;
}

export function layoutWeek(items, dateIso, opts) {
  const result = {};
  for (const day of weekDays(dateIso)) result[day] = layoutDay(items, day, opts);
  return result;
}

export function pxToStart(dayKey, yPx, opts, snapMinutes = 15) {
  const { startHour, endHour, pxPerHour } = withDefaults(opts);
  let minutes = startHour * 60 + (yPx / pxPerHour) * 60;
  minutes = Math.round(minutes / snapMinutes) * snapMinutes;
  minutes = Math.max(0, Math.min(minutes, 24 * 60 - snapMinutes));
  minutes = Math.max(startHour * 60, Math.min(minutes, Math.max(startHour * 60, endHour * 60 - snapMinutes)));
  return `${dayKey}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}

export function dayFromX(xPx, colWidth, dateIso) {
  const days = weekDays(dateIso);
  const idx = Math.floor(xPx / colWidth);
  return days[Math.max(0, Math.min(6, Number.isFinite(idx) ? idx : 0))];
}

const KIND_STYLES = {
  fixed: {
    className: 'cal-item cal-fixed',
    style: { background: '#3b6fd4', color: '#ffffff', border: '1px solid #2a56ad', borderStyle: 'solid', opacity: 1 },
  },
  proposed: {
    className: 'cal-item cal-proposed',
    style: { background: 'rgba(59, 111, 212, 0.15)', color: '#2a56ad', border: '2px dashed #3b6fd4', borderStyle: 'dashed', opacity: 0.9 },
  },
};

export function kindStyle(kind) {
  const spec = KIND_STYLES[kind] || KIND_STYLES.fixed;
  return { className: spec.className, style: { ...spec.style } };
}
