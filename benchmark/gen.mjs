// Seeded case generator. Same seed -> same cases. Cases are plain data (JSON-safe).
const MIN = 60000, H = 3600000, D = 86400000;
export const NOW = '2026-11-09T09:00:00.000Z'; // a Monday
const NOW_MS = Date.parse(NOW);
const iso = (ms) => new Date(ms).toISOString();

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  const next = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (xs) => xs[Math.floor(next() * xs.length)], chance: (p) => next() < p };
}

const dayMs = (d) => Date.parse('2026-11-09T00:00:00.000Z') + d * D; // d=0 Monday Nov 9
const at = (d, hour, min = 0) => dayMs(d) + hour * H + min * MIN;
const TITLES = ['Team sync', 'Client call', 'Workshop', 'Dentist', 'Planning', 'Review meeting', 'Lunch with Sam', 'Seminar', 'Interview', 'Standup', '1:1', 'Design review'];

// n non-overlapping fixed events across days [d0, d1], each 30-240 min, 09:00-18:00 local grid of 30 min.
function makeEvents(r, d0, d1, n, tag = 'e') {
  const evs = [];
  let tries = 0;
  while (evs.length < n && tries++ < 200) {
    const d = r.int(d0, d1);
    if (new Date(dayMs(d)).getUTCDay() === 0 || new Date(dayMs(d)).getUTCDay() === 6) continue; // weekdays only
    const dur = r.pick([30, 60, 60, 90, 120, 180, 240]) * MIN;
    const s = at(d, 9) + r.int(0, 16 - Math.ceil(dur / H)) * 30 * MIN;
    const e = s + dur;
    if (e > at(d, 18)) continue;
    if (evs.some((x) => s < Date.parse(x.end) && e > Date.parse(x.start))) continue;
    evs.push({ id: `${tag}${evs.length + 1}`, title: r.pick(TITLES), start: iso(s), end: iso(e) });
  }
  return evs.sort((a, b) => a.start.localeCompare(b.start));
}
const fullDay = (d, tag) => [{ id: `${tag}-full`, title: 'All-day offsite', start: iso(at(d, 7, 30)), end: iso(at(d, 23, 0)) }];

const ACTS = [['work out', 'exercise'], ['call my mom', 'call'], ['do the laundry', 'chores'], ['read a book', 'reading'], ['go grocery shopping', 'shopping'], ['practice guitar', 'guitar'], ['go for a run', 'run'], ['clean the apartment', 'cleaning'], ['water the plants', 'plants'], ['meditate', 'meditation']];
const DURS = [['half an hour', 30], ['an hour', 60], ['45 minutes', 45], ['90 minutes', 90], ['two hours', 120], ['20 minutes', 20]];
const BASIC_FORMS = [
  (a, d) => `Find time to ${a} for ${d}`,
  (a, d) => `I need to ${a} for ${d}, when can I fit it in?`,
  (a, d) => `Can you schedule ${d} to ${a}?`,
  (a, d) => `Put ${d} in my calendar so I can ${a}`,
  (a, d) => `help me find ${d} to ${a}`,
];
const NOTPLAN = ['Last night we had hotpot, so happy', 'I just finished a great run this morning', 'Yesterday I called my mom and it was lovely', 'That movie was amazing, I cried twice', 'I walked the dog an hour ago'];
const DELIVS = ['the demo', 'the quarterly report', 'the grant application', 'my thesis chapter', 'the pitch deck', 'the design spec'];
const WEEKDAY_FORMS = [['this Friday', 4], ['next Wednesday', 9], ['next Thursday', 10], ['next Friday', 11]]; // day index from Monday Nov 9 = 0
const INTERESTS = ['crafts', 'music', 'food', 'tech', 'sports', 'film'];
const CITY = 'Springfield';
const MEAL_CHAINS = [
  [['shop', 'Shopping', 60], ['cook', 'Cooking', 60], ['dinner', 'Dinner', 60]],
  [['buy', 'Buy supplies', 45], ['prep', 'Prepare the meal', 60], ['eat', 'Family dinner', 90]],
  [['groc', 'Pick up groceries', 30], ['bake', 'Bake the cake', 90], ['party', 'Birthday party', 120], ['tidy', 'Tidy up after', 30]],
];

function basic(r, i, sub) {
  const [act] = r.pick(ACTS); const [dtxt, dmin] = r.pick(DURS);
  let events, request, expect = { blocks: 1, minutes: dmin, noQuestion: true };
  if (sub === 'simple') { events = makeEvents(r, 0, 4, r.int(2, 5)); request = r.pick(BASIC_FORMS)(act, dtxt); }
  else if (sub === 'crowded') { events = [...fullDay(0, 'x'), ...makeEvents(r, 1, 3, 2, 'y')]; request = r.pick(BASIC_FORMS)(act, dtxt); expect.notDay = 0; }
  else if (sub === 'noduration') { events = makeEvents(r, 0, 4, r.int(1, 4)); request = `I need to ${act}`; expect = { blocks: 1, minMinutes: 15, maxMinutes: 180, noQuestion: true }; }
  else if (sub === 'notplan') { events = makeEvents(r, 0, 4, 2); request = r.pick(NOTPLAN); expect = { blocks: 0, noQuestion: true }; }
  else { events = makeEvents(r, 0, 2, 6); request = `${r.pick(BASIC_FORMS)(act, dtxt)} this evening after 8 pm`; expect.afterHour = 20; expect.day = 0; }
  return { category: 'basic', sub, request, events, context: {}, expect };
}

function deadline(r, i, sub) {
  const [when, dIdx] = r.pick(sub === 'drag' || sub === 'moretime' ? WEEKDAY_FORMS.slice(1) : WEEKDAY_FORMS);
  const dl = at(dIdx, 17);
  const what = r.pick(DELIVS);
  const request = r.pick([`${what[0].toUpperCase() + what.slice(1)} is due ${when}, help me plan the prep`, `I have to hand in ${what} ${when}. Plan my prep time.`, `Work back from ${when} and schedule the prep for ${what}`]);
  const events = sub === 'tight' ? [...fullDay(1, 'a'), ...fullDay(2, 'b'), ...fullDay(3, 'c'), ...makeEvents(r, 0, dIdx, 2, 'd')].filter((e) => Date.parse(e.start) < dl) : makeEvents(r, 0, dIdx, r.int(2, 6));
  return { category: 'deadline', sub, request, events, context: {}, expect: { deadline: iso(dl), minSteps: 2, change: sub === 'drag' ? { type: 'drag', shiftDays: r.int(1, 2) } : sub === 'moretime' ? { type: 'more-time', minutes: 60 } : null, tight: sub === 'tight' } };
}

function discovery(r, i, sub) {
  const events = makeEvents(r, 0, 5, r.int(2, 5));
  const cands = []; const n = sub === 'novalid' ? r.int(2, 4) : r.int(4, 8);
  const interests = r.pick([['crafts', 'music'], ['food', 'tech'], ['sports', 'film'], ['music', 'food']]);
  for (let k = 0; k < n; k++) {
    const d = r.int(0, 5), s = at(d, r.int(17, 20)) , e = s + r.pick([1, 2]) * H;
    const kind = sub === 'novalid' ? r.pick(['clash', 'nosource', 'offtopic']) : r.pick(['ok', 'ok', 'ok', 'clash', 'nosource', 'offtopic']);
    let start = s, end = e;
    if (kind === 'clash' && events.length) { const ev = r.pick(events); start = Date.parse(ev.start) + 30 * MIN; end = start + H; }
    cands.push({ id: `a${k + 1}`, title: `${kind === 'clash' ? 'Clashing ' : ''}Event ${k + 1}`, start: iso(start), end: iso(end), place: 'Hall ' + (k + 1), reason: `Matches ${r.pick(interests)}`, source: kind === 'nosource' ? undefined : 'listing', tags: kind === 'offtopic' ? ['combat'] : [r.pick(interests)], _kind: kind });
  }
  if (sub === 'fewvalid') { let ok = 0; for (const c of cands) if (c._kind === 'ok' && ++ok > 2) { c._kind = 'nosource'; delete c.source; } }
  const validIds = cands.filter((c) => c._kind === 'ok' && !events.some((ev) => Date.parse(c.start) < Date.parse(ev.end) && Date.parse(c.end) > Date.parse(ev.start))).map((c) => c.id);
  const ctx = { mode: 'discover', interests: sub === 'thin' ? [] : interests, city: CITY, ...(sub === 'dismissed' ? { dismissed: true } : {}), candidates: cands.map(({ _kind, ...c }) => c) };
  return { category: 'discovery', sub, request: r.pick(['Anything fun this week?', 'What is going on this week that I might like?', 'Any good events coming up?']), events, context: ctx, expect: { validIds, maxBlocks: 3, none: sub === 'thin' || sub === 'dismissed' || validIds.length === 0 } };
}

function related(r, i, sub) {
  const chain = r.pick(MEAL_CHAINS); const day = r.int(1, 3);
  const slotStart = at(day, r.int(9, 11));
  let t = slotStart; const blocks = chain.map(([id, title, mins], k) => { const s = t + (k === 0 ? 0 : r.int(0, 3) * 30 * MIN); const e = s + mins * MIN; t = e + 30 * MIN; return { id, title, start: iso(s), end: iso(e), kind: 'proposed', group: 'g1', ...(sub === 'known' && k > 0 ? { dependsOn: [chain[k - 1][0]] } : {}) }; });
  const other = { id: 'other', title: "Tomorrow's groceries", start: iso(at(day, 14)), end: iso(at(day, 14, 30)), kind: 'proposed', group: 'g2' };
  const evs = [{ id: 'f1', title: 'Dentist', start: iso(at(day, 8)), end: iso(at(day, 9)) }];
  if (sub === 'collide') evs.push({ id: 'f2', title: 'Evening class', start: iso(at(day, 19)), end: iso(at(day, 21)) });
  const shift = r.int(2, 5) * 30 * MIN; const first = blocks[0];
  const change = { type: 'drag', blockId: first.id, start: iso(Date.parse(first.start) + shift) };
  return { category: 'related', sub, request: 'Move the first item later', events: evs, context: {}, plan: { blocks: [...blocks, other], notes: [], meta: { kind: 'related' } }, change, expect: { chain: chain.map((c) => c[0]), other: 'other', known: sub === 'known', collide: sub === 'collide', partial: chain.length > 2 ? chain[1][0] : null } };
}

const SUBS = {
  basic: [['simple', 4], ['crowded', 2], ['noduration', 2], ['notplan', 1], ['evening', 1]],
  deadline: [['normal', 4], ['tight', 2], ['drag', 2], ['moretime', 2]],
  discovery: [['normal', 5], ['fewvalid', 2], ['novalid', 1], ['thin', 1], ['dismissed', 1]],
  related: [['unknown', 5], ['known', 2], ['collide', 2], ['unknown', 1]],
};
const MAKE = { basic, deadline, discovery, related };

export function generate({ seed, perCategory, prefix = 'c' }) {
  const out = [];
  for (const cat of Object.keys(MAKE)) {
    const r = rng(seed * 1000 + cat.length * 7 + cat.charCodeAt(0));
    const weights = SUBS[cat]; const total = weights.reduce((n, [, w]) => n + w, 0);
    for (let i = 0; i < perCategory; i++) {
      let x = r.next() * total, sub = weights[0][0];
      for (const [s, w] of weights) { if ((x -= w) < 0) { sub = s; break; } }
      out.push({ id: `${prefix}-${cat}-${String(i + 1).padStart(4, '0')}`, now: NOW, ...MAKE[cat](r, i, sub) });
    }
  }
  return out;
}
