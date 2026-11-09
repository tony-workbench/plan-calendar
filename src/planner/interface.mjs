// Shared planner interface: plan({request, events, now, context}) and replan({plan, change, events, answers})
// return { blocks, notes, question?, meta? }. enforce() rejects a result that breaks that shape.

export const toMs = (t) => {
  const n = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
  if (Number.isNaN(n)) throw new Error(`bad time: ${t}`);
  return n;
};
export const toIso = (t) => new Date(toMs(t)).toISOString();

export function enforce(result) {
  const bad = (m) => { throw new Error(`planner result rejected: ${m}`); };
  if (!result || !Array.isArray(result.blocks)) bad('no blocks array');
  const seen = new Set();
  const blocks = result.blocks.map((b) => {
    if (!b || typeof b.id !== 'string' || !b.id || seen.has(b.id)) bad('block id missing or duplicated');
    seen.add(b.id);
    const start = toMs(b.start);
    const end = toMs(b.end);
    if (end <= start) bad(`block ${b.id} ends before it starts`);
    return { ...b, start: toIso(start), end: toIso(end) };
  });
  const q = result.question ?? null;
  if (q !== null && (typeof q !== 'object' || typeof q.text !== 'string' || !q.text)) bad('question must be { text }');
  return { ...result, blocks, notes: result.notes ?? [], question: q };
}
