// Approach 4: hybrid. Rules draft the plan, a hard-rule check judges it, and constraint search takes over when the draft fails.
// What the roundtable needs to see goes to meta.debug; `notes` only carries text that helps the user decide.
import rules from './rules.mjs';
import search from './search.mjs';
import { validatePlan } from '../../../benchmark/contract.mjs';

const problems = (result, input) => validatePlan(result, { events: input.events ?? [], deadline: result.meta?.deadline }).violations.map((v) => v.code);

async function pick(run, input) {
  const first = await run(rules), bad = problems(first, input);
  if (!bad.length) return { ...first, meta: { ...first.meta, debug: { used: 'rules', violations: [] } } };
  const second = await run(search);
  return { ...second, meta: { ...second.meta, debug: { used: 'search', violations: bad } } };
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
