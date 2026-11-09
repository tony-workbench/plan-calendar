// Placement core used by the rules planner: first-fit for a single block, back-scheduling from a
// deadline for prep steps, and candidate screening for discovery.
import { firstFit, lastFit, ms, iso } from './slots.mjs';

const STEPS = [['demo-outline', 'Demo outline', 60], ['demo-production', 'Demo production', 120], ['demo-rehearsal', 'Demo rehearsal', 60]];

// "next Friday": 00:00 UTC of the Friday of the following week.
function nextFriday(now) {
  const d = new Date(now);
  const day = d.getUTCDay();
  const toFriday = ((5 - day + 7) % 7) + (day === 5 ? 7 : 0) + (day >= 1 && day <= 4 ? 7 : 0);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + toFriday);
}

export async function planWith({ request = '', events = [], now, context = {} }) {
  const from = ms(now);
  if (context.mode === 'discover') {
    const meta = { kind: 'discover', now: iso(from) };
    if (context.dismissed || !context.interests?.length || !context.source) return { blocks: [], notes: ['nothing to suggest'], meta };
    const found = (await context.source.find({ interests: context.interests, city: context.city })) ?? [];
    const fits = found.filter((c) => ms(c.start) >= from && !events.some((e) => ms(c.start) < ms(e.end) && ms(c.end) > ms(e.start))).slice(0, 3);
    const blocks = fits.map((c) => ({ id: `candidate-${c.id}`, title: c.title, start: c.start, end: c.end, kind: 'candidate', tentative: true, place: c.place, reason: c.reason, source: c.source }));
    const out = { blocks, notes: ['candidates screened against the schedule'], meta };
    if (blocks.length) out.question = { text: `${blocks.length === 1 ? 'One activity fits' : `${blocks.length} activities fit`} you this week, want to see ${blocks.length === 1 ? 'it' : 'them'}?`, items: blocks.map((b) => b.id) };
    return out;
  }
  if (/\b(due|deadline)\b/i.test(request)) {
    const deadline = nextFriday(from);
    const meta = { kind: 'plan', now: iso(from), deadline: iso(deadline) };
    const blocks = [];
    let before = deadline;
    for (const [id, title, minutes] of [...STEPS].reverse()) {
      const slot = lastFit(events, before, minutes, from);
      if (!slot) return { blocks: [], notes: ['no room before the deadline'], meta };
      blocks.unshift({ id, title, start: iso(slot.start), end: iso(slot.end) });
      before = slot.start;
    }
    blocks.forEach((b, i) => { b.after = i ? [blocks[i - 1].id] : []; });
    return { blocks, notes: [], meta };
  }
  const minutes = /half an hour|30 min/i.test(request) ? 30 : 60;
  const slot = firstFit(events, from, minutes);
  return { blocks: slot ? [{ id: 'block-1', title: 'Work out', start: iso(slot.start), end: iso(slot.end) }] : [], notes: [], meta: { kind: 'plan', now: iso(from) } };
}
