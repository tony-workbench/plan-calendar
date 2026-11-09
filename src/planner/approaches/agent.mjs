// Approach 3: an Agent tool loop. A model chooses one tool call per turn; the loop runs the tool and feeds the result back.
// The default model is a scripted offline policy, so this file sends nothing anywhere. A live model can be passed to createAgent({ model }):
// src/planner/gemini.mjs and approaches/agent-live.mjs do that, and then the request, schedule and free windows go to the Gemini API.
// That happens only when the caller asks for it and GEMINI_API_KEY is set; offline tests use fake replies.
import { understand, basicResult, deadlineResult, discoverResult, replanWith, greedyFinder, STEP_VARIANTS, ceilTo, ms, iso, MIN, WINDOW } from '../core.mjs';
import { validatePlan } from '../../../benchmark/contract.mjs';

const finder = greedyFinder;

function tools(task) {
  const { events = [], now, context = {} } = task.input;
  return {
    read_schedule: () => ({ events, now }),
    find_slot: ({ from, minutes, limit, window }) => {
      const t = finder(ms(from), minutes * MIN, { events, limit: limit ? ms(limit) : undefined, window: window ?? WINDOW });
      return t === null ? null : iso(t);
    },
    list_candidates: () => discoverResult({ events, now, context }),
    apply_change: () => replanWith(task.input, { finder }),
    check_plan: ({ result }) => validatePlan(result, { events, deadline: result.meta?.deadline }).violations,
    submit: ({ result }) => { task.result = result; return 'ok'; },
    reject: ({ problem }) => ({ problem }),
  };
}

const submit = (result) => ({ tool: 'submit', args: { result } });

// Offline policy: reads the schedule, asks for slots one by one, checks its draft and submits.
function scriptedModel({ task, history }) {
  const done = (name) => history.filter((h) => h.call.tool === name);
  if (task.kind === 'replan') return done('apply_change').length ? submit(done('apply_change')[0].out) : { tool: 'apply_change', args: {} };
  const intent = task.intent, ctx = { events: task.input.events ?? [], now: task.input.now };
  if (!done('read_schedule').length) return { tool: 'read_schedule', args: {} };
  const finish = (result) => done('check_plan').length ? submit(result) : { tool: 'check_plan', args: { result } };
  const asks = done('find_slot'), starts = asks.map((a) => a.out && ms(a.out));
  if (intent.kind === 'discover') return done('list_candidates').length ? submit(done('list_candidates')[0].out) : { tool: 'list_candidates', args: {} };
  if (intent.kind === 'basic') {
    const pref = intent.pref;
    if (!asks.length) return { tool: 'find_slot', args: { from: iso(Math.max(ceilTo(ms(ctx.now)), pref?.from ?? 0)), minutes: intent.minutes, limit: pref && iso(pref.limit), window: pref?.window } };
    if (starts[0] === null && asks.length < 2) return { tool: 'find_slot', args: { from: ctx.now, minutes: intent.minutes } };
    let calls = 0;
    return finish(basicResult(intent, ctx, () => starts[pref ? calls++ : 0] ?? null));
  }
  if (intent.kind === 'deadline') {
    // One chain of find_slot calls per step-length variant; a chain that hits a null answer is abandoned for the next variant.
    const chains = STEP_VARIANTS.map((_, v) => asks.filter((a) => a.call.args.variant === v));
    const placed = (v) => chains[v].filter((a) => a.out !== null).map((a, i) => ({ s: ms(a.out), minutes: STEP_VARIANTS[v][i] }));
    for (const [v, chain] of chains.entries()) {
      const variant = STEP_VARIANTS[v];
      if (chain.length && chain.at(-1).out === null) continue;
      if (chain.length === variant.length) return finish(deadlineResult(intent, placed(v), ctx));
      const prevEnd = chain.length ? ms(chain.at(-1).out) + variant[chain.length - 1] * MIN : ceilTo(ms(ctx.now));
      return { tool: 'find_slot', args: { variant: v, from: iso(prevEnd), minutes: variant[chain.length], limit: iso(intent.deadline) } };
    }
    return finish(deadlineResult(intent, STEP_VARIANTS.map((_, v) => placed(v)).reduce((a, b) => b.length > a.length ? b : a, []), ctx));
  }
  if (intent.kind === 'ask-deadline') return submit({ blocks: [], notes: [], question: { text: `When is ${intent.what.toLowerCase()} due?`, items: [] }, meta: { kind: 'deadline', now: ctx.now } });
  return submit({ blocks: [], notes: [], meta: { kind: 'none' } });
}

export function createAgent({ model = scriptedModel, maxTurns = 12 } = {}) {
  async function run(task) {
    const toolbox = tools(task), history = [];
    for (let turn = 0; turn < maxTurns && !task.result; turn++) {
      const call = await model({ task, history, tools: Object.keys(toolbox) });
      if (!toolbox[call?.tool]) throw new Error(`Agent asked for an unknown tool: ${call?.tool}`);
      history.push({ call, out: await toolbox[call.tool](call.args ?? {}) });
    }
    if (!task.result) throw new Error('Agent ran out of turns without submitting a plan');
    return task.result;
  }
  return {
    plan: (input) => run({ kind: 'plan', input, intent: understand(input) }),
    replan: (input) => run({ kind: 'replan', input }),
  };
}

const agent = createAgent();
export const plan = (input) => agent.plan(input);
export const replan = (input) => agent.replan(input);
export default { plan, replan };
