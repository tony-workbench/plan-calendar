// Shared helpers for the planners. Result shape follows benchmark/contract.mjs:
//   { blocks, question?: { text, items }, notes, meta? }
export const toMs = (v) => {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid time: ${v}`);
  return ms;
};

export const toIso = (v) => new Date(toMs(v)).toISOString();

// Normalises a planner result so it passes the contract's checkResult: notes and question.items are arrays.
export function enforce(result) {
  if (!result || typeof result !== 'object') throw new TypeError('Planner result must be an object');
  if (!Array.isArray(result.blocks)) throw new TypeError('Planner result.blocks must be an array');
  const out = { ...result, notes: Array.isArray(result.notes) ? result.notes : [] };
  if (out.question == null) out.question = null;
  else out.question = { ...out.question, items: Array.isArray(out.question.items) ? out.question.items : [] };
  return out;
}
