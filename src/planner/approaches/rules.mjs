// Approach 1: a pure rule-based, template planner. No model, no network, fully deterministic.

import { DAY, HOUR, MINUTE, toIso, toMs } from '../interface.mjs';

const GRID = 15 * MINUTE;
const WORK_HOURS = { start: 9, end: 18 };
const STEP_TEMPLATE = [
  { name: 'outline', minutes: 60 },
  { name: 'production', minutes: 120 },
  { name: 'rehearsal', minutes: 60 },
];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const dayStart = (ms) => ms - (((ms % DAY) + DAY) % DAY);
const ceilGrid = (ms) => Math.ceil(ms / GRID) * GRID;
const floorGrid = (ms) => Math.floor(ms / GRID) * GRID;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clone = (x) => structuredClone(x);

function busyOf(events, blocks = [], skipId) {
  return [...events, ...blocks.filter((b) => b.id !== skipId)].map((x) => ({ s: toMs(x.start), e: toMs(x.end) }));
}

const isFree = (s, e, busy) => busy.every((b) => s >= b.e || e <= b.s);

function inHours(s, e, hours) {
  if (!hours) return true;
  const d = dayStart(s);
  return s >= d + hours.start * HOUR && e <= d + hours.end * HOUR;
}

// First (dir 'forward') or last (dir 'back') free slot of `dur` ms inside [from, to].
function findSlot({ dur, from, to, busy, hours, dir = 'forward' }) {
  if (dir === 'forward') {
    for (let t = ceilGrid(from); t + dur <= to; t += GRID) {
      if (inHours(t, t + dur, hours) && isFree(t, t + dur, busy)) return t;
    }
  } else {
    for (let t = floorGrid(to - dur); t >= from; t -= GRID) {
      if (inHours(t, t + dur, hours) && isFree(t, t + dur, busy)) return t;
    }
  }
  return null;
}

function parseMinutes(text) {
  const t = text.toLowerCase();
  if (/half an hour|half hour/.test(t)) return 30;
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (h) return Math.round(parseFloat(h[1]) * 60);
  const m = t.match(/(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (m) return parseInt(m[1], 10);
  return 60;
}

function parseDeadline(text, now, context) {
  if (context.deadline) return toMs(context.deadline);
  const m = text.toLowerCase().match(/(next\s+)?\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (!m) return null;
  const wd = WEEKDAYS.indexOf(m[2]);
  const today = dayStart(now);
  const dow = new Date(now).getUTCDay();
  const day = m[1]
    ? today - ((dow + 6) % 7) * DAY + 7 * DAY + ((wd + 6) % 7) * DAY // that weekday of next calendar week
    : today + (((wd - dow + 7) % 7) || 7) * DAY;
  return day + 17 * HOUR;
}

function topicOf(text, context) {
  if (context.topic) return cap(context.topic);
  const m = text.match(/^(?:the\s+)?(.+?)\s+(?:is\s+)?(?:due|by)\b/i);
  return m ? cap(m[1].trim()) : 'Deadline';
}

function detectKind(request, context) {
  if (context.mode) return context.mode;
  if (/\b(activities|something fun|what'?s on)\b/i.test(request)) return 'discover';
  if (context.deadline || /\b(due|deadline)\b/i.test(request)) return 'deadline';
  return 'basic';
}

function planBasic(request, events, now, context) {
  const dur = parseMinutes(request) * MINUTE;
  const hours = context.workHours ?? WORK_HOURS;
  const start = findSlot({ dur, from: now, to: now + 7 * DAY, busy: busyOf(events), hours });
  const meta = { kind: 'basic', workHours: hours, now: toIso(now) };
  if (start === null) {
    return {
      blocks: [],
      question: { text: 'I could not find a free slot this week. What other time would work?', items: [] },
      notes: ['no free slot in the next 7 days'],
      meta,
    };
  }
  const title = /work\s?out|exercise|gym/i.test(request)
    ? 'Workout'
    : cap(request.replace(/^(please\s+)?(find|get|make)( me)?( some)? time (to|for)\s+/i, '').replace(/\s+for .*$/i, '').trim()) || 'Task';
  return {
    blocks: [{ id: 'block-1', title, start: toIso(start), end: toIso(start + dur), kind: 'proposed' }],
    notes: ['first free slot inside working hours'],
    meta,
  };
}

function planDeadline(request, events, now, context) {
  const hours = context.workHours ?? WORK_HOURS;
  const deadline = parseDeadline(request, now, context);
  const meta = { kind: 'deadline', workHours: hours, now: toIso(now) };
  if (deadline === null) {
    return { blocks: [], question: { text: 'When is it due?', items: [] }, notes: ['no deadline found'], meta };
  }
  meta.deadline = toIso(deadline);
  const topic = topicOf(request, context);
  const steps = STEP_TEMPLATE.map((s, i) => ({ ...s, minutes: context.stepMinutes?.[i] ?? s.minutes }));
  const busy = busyOf(events);
  const placed = [];
  const notes = [];
  let ceiling = deadline;
  for (let i = steps.length - 1; i >= 0; i--) {
    const dur = steps[i].minutes * MINUTE;
    const search = (to) => findSlot({ dur, from: ceilGrid(now), to, busy, hours, dir: 'back' });
    // Prefer one step per day: stay before the day of the step that follows.
    let start = i < steps.length - 1 ? search(dayStart(ceiling)) : null;
    start ??= search(ceiling);
    if (start === null) {
      notes.push(`no room for ${steps[i].name} before the deadline`);
      break;
    }
    busy.push({ s: start, e: start + dur });
    ceiling = start;
    placed.unshift({
      id: `prep-${i + 1}`,
      title: `${topic}: ${steps[i].name}`,
      start: toIso(start),
      end: toIso(start + dur),
      kind: 'proposed',
      step: i + 1,
      group: 'prep',
    });
  }
  placed.forEach((b, i) => {
    if (i > 0) b.dependsOn = [placed[i - 1].id];
  });
  const missing = placed.length < steps.length;
  return {
    blocks: placed,
    question: missing ? { text: 'There is not enough free time before the deadline. Can the deadline move or can some work be dropped?', items: [] } : undefined,
    notes: missing ? notes : ['steps back-planned from the deadline, in order'],
    meta,
  };
}

async function planDiscovery(events, now, context) {
  const meta = { kind: 'discover', now: toIso(now) };
  const interests = context.interests ?? [];
  if (context.dismissed) return { blocks: [], notes: ['prompt was ignored; not asking again'], meta };
  if (!interests.length || !context.city || !context.source) {
    return { blocks: [], notes: ['too little information to suggest activities'], meta };
  }
  const found = await context.source.find({ interests, city: context.city, from: toIso(now), to: toIso(now + 7 * DAY) });
  const busy = busyOf(events);
  const seen = new Set();
  const blocks = (found ?? [])
    .filter((c) => c && c.id && c.title && c.start && c.end && c.place && c.reason && c.source)
    .filter((c) => !c.tags || c.tags.some((t) => interests.includes(t)))
    .filter((c) => toMs(c.start) >= now && isFree(toMs(c.start), toMs(c.end), busy))
    .filter((c) => !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => toMs(a.start) - toMs(b.start))
    .slice(0, 3)
    .map((c) => ({
      id: `candidate-${c.id}`,
      title: c.title,
      start: toIso(toMs(c.start)),
      end: toIso(toMs(c.end)),
      kind: 'candidate',
      tentative: true,
      place: c.place,
      reason: c.reason,
      source: c.source,
    }));
  const words = ['', 'One activity fits', 'Two activities fit', 'Three activities fit'];
  return {
    blocks,
    question: blocks.length ? { text: `${words[blocks.length]} you this week, want to see ${blocks.length === 1 ? 'it' : 'them'}?`, items: blocks.map((b) => b.id) } : undefined,
    notes: blocks.length ? ['candidates screened from the source'] : ['no reliable candidate fits'],
    meta,
  };
}

async function plan({ request = '', events = [], now, context = {} } = {}) {
  const t = toMs(now);
  const kind = detectKind(request, context);
  if (kind === 'discover') return planDiscovery(events, t, context);
  if (kind === 'deadline') return planDeadline(request, events, t, context);
  return planBasic(request, events, t, context);
}

function dependentsOf(blocks, rootId) {
  const found = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of blocks) {
      if (found.has(b.id)) continue;
      if ((b.dependsOn ?? []).some((d) => d === rootId || found.has(d))) {
        found.add(b.id);
        grew = true;
      }
    }
  }
  return found;
}

function replan({ plan: prev, change, events = [], answers } = {}) {
  const next = clone(prev);
  const { blocks } = next;
  const meta = (next.meta ??= {});
  const notes = [];
  const hours = meta.workHours;
  const deadline = meta.deadline ? toMs(meta.deadline) : null;
  const byId = (id) => blocks.find((b) => b.id === id);
  const before = clone({ blocks: prev.blocks, meta: prev.meta });
  const origStart = new Map(blocks.map((b) => [b.id, toMs(b.start)]));
  for (const b of blocks) delete b.moved;
  delete next.question;

  if (change) delete meta.pending;
  const pending = change ?{ dragged: change.blockId } : meta.pending;
  const target = pending ? byId(pending.dragged) : null;
  if (change && !target) throw new Error(`Unknown block ${change.blockId}`);

  if (change?.type === 'drag') {
    const dur = toMs(target.end) - toMs(target.start);
    let s = toMs(change.start);
    const busy = busyOf(events);
    if (!isFree(s, s + dur, busy)) {
      s = findSlot({ dur, from: s, to: s + 14 * DAY, busy, hours });
      notes.push(`${target.title} would overlap a fixed event, so it was placed in the next free slot`);
    }
    target.start = toIso(s);
    target.end = toIso(s + dur);
  } else if (change?.type === 'more-time') {
    const dur = toMs(target.end) - toMs(target.start) + change.minutes * MINUTE;
    const s = toMs(target.start);
    const busy = busyOf(events, blocks, target.id);
    let start = isFree(s, s + dur, busy) && inHours(s, s + dur, hours) && (deadline === null || s + dur <= deadline) ? s : null;
    if (start === null) {
      const from = Math.max(toMs(meta.now ?? target.start), ...(target.dependsOn ?? []).map((d) => toMs(byId(d).end)));
      start = findSlot({ dur, from, to: deadline ?? from + 14 * DAY, busy, hours });
    }
    if (start === null) {
      notes.push(`no room to extend ${target.title} before the deadline`);
      start = s;
    }
    target.start = toIso(start);
    target.end = toIso(start + dur);
  }

  // Related items: hints (same group) become links only after the user confirms them.
  if (target && target.group) {
    const asked = new Set(meta.asked ?? []);
    const refused = new Set(meta.refused ?? []);
    const hinted = blocks
      .filter((b) => b.group === target.group && b.id !== target.id && !(b.dependsOn ?? []).length)
      .filter((b) => origStart.get(b.id) >= origStart.get(target.id))
      .filter((b) => !asked.has(b.id) && !refused.has(b.id))
      .sort((a, b) => origStart.get(a.id) - origStart.get(b.id));
    if (answers && pending) {
      const ids = new Set(pending.items ?? []);
      const offered = blocks.filter((b) => ids.has(b.id)).sort((a, b) => origStart.get(a.id) - origStart.get(b.id));
      const chosen = answers.confirm === 'all' ? offered
        : Array.isArray(answers.confirm) ? offered.filter((b) => answers.confirm.includes(b.id)) : [];
      let prevId = target.id;
      for (const b of chosen) {
        b.dependsOn = [prevId];
        prevId = b.id;
      }
      meta.refused = [...refused, ...offered.filter((b) => !chosen.includes(b)).map((b) => b.id)];
      delete meta.pending;
    } else if (change && hinted.some((b) => origStart.get(b.id) < toMs(target.end))) {
      const names = [target, ...hinted].map((b) => b.title.toLowerCase());
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
      meta.pending = { dragged: target.id, items: hinted.map((b) => b.id) };
      meta.asked = [...asked, ...hinted.map((b) => b.id)];
      next.question = {
        text: `${cap(list)} look like the same activity, adjust them together?`,
        items: [target.id, ...hinted.map((b) => b.id)],
      };
    }
  }

  // Cascade along confirmed or clear prerequisites only; everything else stays put.
  if (target) {
    const followers = blocks.filter((b) => dependentsOf(blocks, target.id).has(b.id)).sort((a, b) => origStart.get(a.id) - origStart.get(b.id));
    for (const f of followers) {
      const minStart = Math.max(...f.dependsOn.map((d) => toMs(byId(d).end)));
      if (toMs(f.start) >= minStart) continue;
      const dur = toMs(f.end) - toMs(f.start);
      const busy = busyOf(events, blocks, f.id);
      const s = findSlot({ dur, from: minStart, to: deadline ?? minStart + 14 * DAY, busy, hours })
        ?? findSlot({ dur, from: minStart, to: minStart + 14 * DAY, busy, hours });
      if (s === null) {
        notes.push(`no room to move ${f.title}`);
        continue;
      }
      f.start = toIso(s);
      f.end = toIso(s + dur);
      f.moved = true;
    }
  }

  if (deadline !== null) {
    for (const b of blocks) if (toMs(b.end) > deadline) notes.push(`deadline at risk: ${b.title} ends after the deadline`);
  }
  if (!notes.length) notes.push(blocks.some((b) => b.moved) ? 'later items moved because of the change' : 'only the changed item moved');
  next.notes = notes;
  next.before = before;
  if (!next.question) delete next.question;
  return next;
}

export default { name: 'rules', plan, replan };
