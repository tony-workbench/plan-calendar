// Approach 4: a model-driven tool loop (Calendar-Agent style).
// The model chooses tool calls; code enforces the rules (no overlaps, fixed events,
// deadline, pinned user changes, one question at most, nothing moved that the change
// does not reach). The model is injected so tests use a deterministic fake with
// recorded replies and no network. Implements the one interface in ../interface.mjs.
import { readFileSync } from 'node:fs';
import { TOOL_DECLARATIONS, createToolState, runTool, toIso, toMs } from './llm-tools.mjs';
import { HOUR, weekdayDate } from './slots.mjs';

export const name = 'llm-agent';
const MAX_STEPS = 8;
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FIXTURE_URL = new URL('../../../tests/fixtures/llm-replies.json', import.meta.url);

const SYSTEM = [
  'You are a calendar planning agent. Use read_events, find_free_time, search_activities and propose_blocks.',
  'Never overlap fixed events, never move them, respect deadlines and the order of steps.',
  'Keep the block the user just changed exactly as they set it.',
  'Link items only when the user stated it or the plan makes the prerequisite clear; ask at most one merged question naming the items.',
  'Finish with a JSON object: {"summary": string, "prompt"?: string, "question"?: {"text": string, "items": string[]}}.',
].join(' ');

// ---- fake model (offline) ----

function matches(rule, meta) {
  if (rule.op && rule.op !== meta.op) return false;
  if (rule.request && !new RegExp(rule.request, 'i').test(meta.request ?? '')) return false;
  if (rule.changeType && rule.changeType !== meta.change?.type) return false;
  if (rule.blockId && rule.blockId !== meta.change?.blockId) return false;
  if (rule.confirmed !== undefined) {
    // 'absent' = no answer yet; otherwise the exact set of confirmed block ids
    const got = meta.confirmed === undefined ? 'absent' : [...meta.confirmed].sort().join(',');
    const want = Array.isArray(rule.confirmed) ? [...rule.confirmed].sort().join(',') : rule.confirmed;
    if (got !== want) return false;
  }
  return true;
}

export function createFakeModel(replies) {
  const data = replies ?? JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));
  return {
    async generate({ messages, meta }) {
      const scenario = data.scenarios.find((s) => matches(s.match, meta));
      if (!scenario) throw new Error(`no recorded reply matches ${JSON.stringify({ op: meta.op, request: meta.request, change: meta.change, confirmed: meta.confirmed })}`);
      const step = messages.filter((m) => m.role === 'tool').length;
      return scenario.steps[step] ?? { final: {} };
    },
  };
}

// ---- Gemini model (real; only used when a key is in the environment) ----

export function createGeminiModel({ apiKey, model = DEFAULT_MODEL, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const toContents = (messages) =>
    messages.map((m) => {
      if (m.role === 'user') return { role: 'user', parts: [{ text: m.content }] };
      if (m.role === 'assistant') return { role: 'model', parts: [{ functionCall: m.tool_call }] };
      return { role: 'user', parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] };
    });
  return {
    async generate({ system, messages, tools }) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: toContents(messages),
          tools: [{ functionDeclarations: tools }],
        }),
      });
      if (!res.ok) throw new Error(`Gemini request failed with status ${res.status}`);
      const body = await res.json();
      const parts = body?.candidates?.[0]?.content?.parts ?? [];
      const call = parts.find((p) => p.functionCall)?.functionCall;
      if (call) return { tool_call: { name: call.name, args: call.args ?? {} } };
      const text = parts.map((p) => p.text ?? '').join('').replace(/^```(?:json)?\s*|\s*```$/g, '');
      try {
        return { final: JSON.parse(text) };
      } catch {
        return { final: { summary: text } };
      }
    },
  };
}

function defaultModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return createFakeModel();
  return createGeminiModel({ apiKey, model: process.env.GEMINI_MODEL || DEFAULT_MODEL });
}

// ---- the loop ----

async function runLoop({ model, meta, user, state }) {
  const messages = [{ role: 'user', content: user }];
  const trace = [];
  for (let i = 0; i < MAX_STEPS; i++) {
    const reply = await model.generate({ system: SYSTEM, messages, tools: TOOL_DECLARATIONS, meta });
    if (!reply.tool_call) return { final: reply.final ?? {}, trace };
    const { name: tool, args } = reply.tool_call;
    const result = runTool(state, tool, args);
    trace.push(tool);
    messages.push({ role: 'assistant', tool_call: reply.tool_call }, { role: 'tool', name: tool, content: result });
  }
  return { final: {}, trace, truncated: true };
}

// ---- helpers ----

// "due next Friday" -> that Friday, 17:00 UTC; an explicit context deadline wins.
function parseDeadline(request = '', nowMs, context) {
  if (context.deadline) return toMs(context.deadline);
  if (!/\b(due|deadline)\b/i.test(request)) return undefined;
  const m = request.match(/(next\s+)?\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const day = m ? weekdayDate(m[2], nowMs, Boolean(m[1])) : null;
  return day === null ? undefined : day + 17 * HOUR;
}

// A proposed block in the interface shape: `after` becomes dependsOn, candidates are tentative.
function toBlock({ after, ...b }) {
  const out = { ...b, kind: b.tentative ? 'candidate' : 'proposed' };
  if (after?.length) out.dependsOn = after;
  return out;
}

const sameTime = (a, b) => a && a.start === b.start && a.end === b.end;

// Ids reached from `rootId` through dependsOn links.
function dependentsOf(blocks, rootId) {
  const found = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const b of blocks) {
      if (!found.has(b.id) && (b.dependsOn ?? []).some((d) => d === rootId || found.has(d))) {
        found.add(b.id);
        grew = true;
      }
    }
  }
  return found;
}

const notesOf = (final, fallback) => [final.summary || fallback];

export function createLlmPlanner({ model } = {}) {
  const resolve = () => model ?? defaultModel();

  async function plan({ request, events = [], now, context = {} } = {}) {
    const nowMs = toMs(now);
    const deadlineMs = parseDeadline(request, nowMs, context);
    const discover = context.mode === 'discover';
    const meta = { kind: discover ? 'discover' : deadlineMs !== undefined ? 'deadline' : 'basic', now: toIso(nowMs) };
    if (deadlineMs !== undefined) meta.deadline = toIso(deadlineMs);

    // An ignored prompt is not repeated, and thin information suggests nothing: no model call.
    if (discover && (context.dismissed || !(context.interests ?? []).length)) {
      return { blocks: [], notes: [context.dismissed ? 'the prompt was ignored; not asking again' : 'too little information to suggest activities'], meta };
    }

    const state = createToolState({ events, now, deadline: meta.deadline, source: context.source });
    const { source, ...visible } = context;
    const user = JSON.stringify({ op: 'plan', request, now, deadline: meta.deadline, context: visible });
    const { final, trace } = await runLoop({ model: resolve(), meta: { op: 'plan', request, context: visible }, user, state });
    const blocks = state.proposed.map(toBlock);
    const result = { blocks, notes: notesOf(final, blocks.length ? 'planned by the model tool loop' : 'nothing was proposed'), meta: { ...meta, trace } };
    if (discover && blocks.length && final.prompt) result.question = { text: final.prompt, items: blocks.map((b) => b.id) };
    return result;
  }

  async function replan({ plan: current, change: given, events = [], answers, now } = {}) {
    const pending = current.meta?.pending;
    const change = given ?? pending?.change;
    if (!change) throw new Error('nothing to re-plan: no change and no pending question');
    const answering = !given && answers !== undefined;
    const base = current.blocks;
    const target = base.find((b) => b.id === change.blockId);
    if (!target) throw new Error(`unknown block ${change.blockId}`);
    const before = given ? { blocks: base, meta: current.meta } : current.before ?? { blocks: base, meta: current.meta };

    // Apply the user's change; when answering, the plan already holds it.
    const length = toMs(target.end) - toMs(target.start);
    let moved = target;
    if (given) {
      if (change.type === 'drag') moved = { ...target, start: toIso(toMs(change.start)), end: toIso(toMs(change.start) + length) };
      else if (change.type === 'more-time') moved = { ...target, end: toIso(toMs(target.end) + change.minutes * 60000) };
      else throw new Error(`unsupported change ${change.type}`);
    }
    const applied = base.map((b) => (b.id === target.id ? moved : b));
    const pinned = change.type === 'drag'
      ? { id: target.id, start: moved.start }
      : { id: target.id, minutes: (toMs(moved.end) - toMs(moved.start)) / 60000 };

    const meta = { ...(current.meta ?? {}) };
    delete meta.pending;
    meta.now = now ?? meta.now;
    const asked = new Set(meta.asked ?? []);
    const refused = new Set(meta.refused ?? []);

    let confirmed;
    if (answering) {
      const offered = (pending?.items ?? []).filter((id) => id !== target.id);
      confirmed = answers.confirm === 'all' ? offered : Array.isArray(answers.confirm) ? offered.filter((id) => answers.confirm.includes(id)) : [];
      for (const id of offered) if (!confirmed.includes(id)) refused.add(id); // a refusal never becomes a link
      meta.refused = [...refused];
      if (!confirmed.length) {
        return { blocks: applied.map(({ moved: _m, ...b }) => b), notes: ['no links confirmed; only the changed item moved'], meta, before };
      }
    }

    const state = createToolState({ events, now: meta.now ?? '1970-01-01T00:00:00.000Z', deadline: meta.deadline, pinned });
    const user = JSON.stringify({ op: 'replan', plan: { blocks: applied }, change, confirmed, refused: [...refused], asked: [...asked] });
    const { final, trace } = await runLoop({ model: resolve(), meta: { op: 'replan', change, confirmed }, user, state });

    // At most one question, merged, naming the items; never again for items already asked or refused.
    const q = !answering && final.question;
    const items = q ? [...new Set(q.items ?? [])].filter((id) => base.some((b) => b.id === id)) : [];
    if (q && items.length >= 2 && items.includes(target.id) && items.every((id) => !asked.has(id) && !refused.has(id))) {
      meta.pending = { change, items };
      meta.asked = [...asked, ...items];
      return {
        blocks: applied.map(({ moved: _m, ...b }) => b),
        question: { text: q.text, items },
        notes: notesOf(final, 'one question before linking items'),
        meta: { ...meta, trace },
        before,
      };
    }

    // Only the changed block, what depends on it and confirmed items may move; the rest is restored.
    const allowed = new Set([target.id, ...dependentsOf(applied, target.id), ...(confirmed ?? [])]);
    const proposed = new Map(state.proposed.map((b) => [b.id, b]));
    const blocks = applied.map((old) => {
      const { moved: _m, ...rest } = old;
      const p = allowed.has(old.id) && old.id !== target.id ? proposed.get(old.id) : undefined;
      if (!p) return rest;
      const next = { ...rest, start: p.start, end: p.end };
      if (p.after) next.dependsOn = p.after;
      return old.id !== target.id && !sameTime(base.find((b) => b.id === old.id), next) ? { ...next, moved: true } : next;
    });
    return { blocks, notes: notesOf(final, 'only the changed item moved'), meta: { ...meta, trace }, before };
  }

  return { name, plan, replan };
}

export const { plan, replan } = createLlmPlanner();
export default { name, plan, replan, createLlmPlanner };
