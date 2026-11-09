// Approach 4: hybrid. The model only reads the request (an intent); code plans, asks, remembers refusals and checks the hard rules.
// Rules draft the plan, a hard-rule check judges it, and constraint search takes over when the draft fails.
// What the roundtable needs to see goes to meta.debug; `notes` only carries text that helps the user decide.
import rules from './rules.mjs';
import search from './search.mjs';
import { parseDeadline, timePreference, cap, ms } from '../core.mjs';
import { modelIntent } from '../gemini.mjs';
import { validatePlan } from '../../../benchmark/contract.mjs';

const problems = (result, input) => validatePlan(result, { events: input.events ?? [], deadline: result.meta?.deadline }).violations.map((v) => v.code);

// Turn a checked model intent into the intent core.mjs plans from; null means fall back to the regex parser.
function toIntent(m, input) {
  const nowMs = ms(input.now);
  if (m.kind === 'basic') return { kind: 'basic', title: cap(m.activity), minutes: m.minutes ?? 30, pref: timePreference(input.request, nowMs), past: /\byesterday\b/i.test(input.request) };
  const dl = parseDeadline(m.deadlineText, nowMs);
  return dl ? { kind: 'deadline', what: cap(m.activity), deadline: dl.ms, assumed: dl.assumed } : null;
}

async function pick(run, input, used) {
  const first = await run(rules), bad = problems(first, input);
  if (!bad.length) return { ...first, meta: { ...first.meta, debug: { used, violations: [] } } };
  const second = await run(search);
  return { ...second, meta: { ...second.meta, debug: { used: used.replace('rules', 'search'), violations: bad } } };
}

export function createHybrid({ fetch: doFetch, env } = {}) {
  const live = Boolean(env?.GEMINI_API_KEY);
  return {
    async plan(input) {
      let intent;
      if (live && input.context?.mode !== 'discover') {
        const m = await modelIntent({ request: input.request ?? '', now: input.now, fetch: (...a) => (doFetch ?? globalThis.fetch)(...a), env });
        intent = m ? toIntent(m, input) ?? undefined : undefined;
      }
      return pick((p) => p.plan(input, intent), input, intent ? 'model+rules' : 'rules');
    },
    replan: (input) => pick((p) => p.replan(input), input, 'rules'),
  };
}

<<<<<<< newer
export const plan = (input) => pick((p) => p.plan(input), input);
export const replan = (input) => pick((p) => p.replan(input), input);
=======
// With GEMINI_API_KEY set, the registered hybrid sends the request text to Gemini (one call per request), so
// `node benchmark/run.mjs --approach hybrid` scores the model path. It stays offline without a key, under node --test, or with HYBRID_OFFLINE=1.
export const modelEnabled = (env) => Boolean(env.GEMINI_API_KEY) && !env.NODE_TEST_CONTEXT && !env.HYBRID_OFFLINE;
export const registeredOptions = (env = process.env) => (modelEnabled(env) ? { env } : undefined);
const registered = createHybrid(registeredOptions());
export const plan = registered.plan, replan = registered.replan;
>>>>>>> draft
export default { plan, replan };
