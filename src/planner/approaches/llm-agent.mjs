// Approach 4: LLM-agent planner.
// The model decides the placement; the planner builds the prompt, calls the activity source as a
// tool for discovery, and validates the reply. The default export uses the live Gemini model (key
// from the environment; without one it returns an empty "model unavailable" result). Tests inject createFakeModel(replies) with
// replies loaded from tests/fixtures/llm-replies.json, so the recordings never ship with the planner.
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }
// (both async).

import { toIso } from '../interface.mjs';

export function createFakeModel(replies = {}) {
  return {
    async complete({ key }) {
      if (!(key in replies)) throw new Error(`no recorded reply for: ${key}`);
      return JSON.stringify(replies[key]);
    },
  };
}

// Live adapter for the same `complete({ key, prompt })` shape. The key comes from the environment
// and is never logged. Offline tests never call it.
export function createGeminiModel({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const apiKey = env.GEMINI_API_KEY;
  const id = env.GEMINI_MODEL || 'gemini-3.8-flash';
  return {
    async complete({ prompt }) {
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
      const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }),
      });
      if (!res.ok) throw new Error(`model request failed: ${res.status}`);
      return (await res.json()).candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    },
  };
}

// Rejects a reply that is not JSON, has malformed blocks, or overlaps a fixed event.
export function validateReply(r, events = []) {
  const bad = (m) => { throw new Error(`model reply rejected: ${m}`); };
  if (!r || !Array.isArray(r.blocks)) bad('no blocks');
  const seen = new Set();
  for (const b of r.blocks) {
    if (!b || typeof b.id !== 'string' || !b.id || seen.has(b.id)) bad('block id missing or duplicated');
    seen.add(b.id);
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) bad(`bad times for ${b.id}`);
    if (events.some((ev) => s < Date.parse(ev.end) && e > Date.parse(ev.start))) bad(`${b.id} overlaps a fixed event`);
  }
  if (r.question != null && typeof r.question !== 'string') bad('question must be text');
  return r;
}

const fromReply = (text, meta, events) => {
  let r;
  try { r = JSON.parse(text); } catch { throw new Error('model reply rejected: not JSON'); }
  validateReply(r, events);
  const result = { blocks: r.blocks, notes: r.notes ?? [], meta: { ...meta, ...(r.deadline ? { deadline: r.deadline } : {}) } };
  if (r.question) result.question = { text: r.question, items: r.blocks.map((b) => b.id) };
  return result;
};

export function createAgent({ model = createGeminiModel() } = {}) {
  return {
    async plan({ request, events = [], now, context = {} }) {
      if (context.mode === 'discover') {
        const meta = { kind: 'discover', now: toIso(now) };
        if (context.dismissed || !context.interests?.length || !context.city || !context.source) {
          return { blocks: [], notes: ['nothing to suggest'], meta };
        }
        const found = (await context.source.find({ interests: context.interests, city: context.city })) ?? [];
        const key = `discover|${found.map((c) => c.id).join(',')}`;
        const reply = JSON.parse(await model.complete({ key, prompt: JSON.stringify({ request, now, interests: context.interests, found, events }) }));
        const blocks = (reply.pick ?? []).map((id) => found.find((c) => c.id === id)).filter(Boolean).map((c) => ({
          id: `candidate-${c.id}`, title: c.title, start: c.start, end: c.end, kind: 'candidate',
          tentative: true, place: c.place, reason: c.reason, source: c.source,
        }));
        const result = { blocks, notes: ['candidates chosen by the model'], meta };
        if (blocks.length && reply.question) result.question = { text: reply.question, items: blocks.map((b) => b.id) };
        return result;
      }
      const text = await model.complete({ key: `plan|${request}`, prompt: JSON.stringify({ request, now, events }) });
      return fromReply(text, { kind: 'plan', now: toIso(now) }, events);
    },
    async replan({ plan: prev, change, events = [], answers }) {
      const key = `replan|${JSON.stringify(change ?? null)}|${JSON.stringify(answers ?? null)}|${prev.question ? 'asked' : 'fresh'}`;
      const text = await model.complete({ key, prompt: JSON.stringify({ plan: prev.blocks, change, answers, events }) });
      return fromReply(text, prev.meta ?? { kind: 'plan' }, events);
    },
  };
}

// Without GEMINI_API_KEY the default export still honours the contract: it delivers an empty result
// whose note says the model was unavailable, instead of throwing, so the shared benchmark can run it
// offline. That result is not a quality score.
const live = createAgent();
const unavailable = (kind, now) => ({ blocks: [], notes: ['model unavailable: GEMINI_API_KEY is not set'], meta: { kind, ...(now ? { now: toIso(now) } : {}) } });
export default {
  plan: (input) => (process.env.GEMINI_API_KEY ? live.plan(input) : Promise.resolve(unavailable('plan', input.now))),
  replan: (input) => (process.env.GEMINI_API_KEY ? live.replan(input) : Promise.resolve({ ...unavailable('plan'), blocks: input.plan?.blocks ?? [], meta: input.plan?.meta ?? { kind: 'plan' } })),
};
