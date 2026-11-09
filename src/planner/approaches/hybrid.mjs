// Approach 4: hybrid. Gemini only reads the request (intent JSON); core.mjs plans, asks, remembers refusals and checks the rules.
// A hard-rule check judges the draft, and constraint search takes over when the draft fails.
// What the roundtable needs to see goes to meta.debug; `notes` only carries text that helps the user decide.
import rules, { solver as greedy } from './rules.mjs';
import search, { solver as searchSolver } from './search.mjs';
import { planWith } from '../core.mjs';
import { createUnderstander } from '../understand-live.mjs';
import { validatePlan } from '../../../benchmark/contract.mjs';

const problems = (result, input) => validatePlan(result, { events: input.events ?? [], deadline: result.meta?.deadline }).violations.map((v) => v.code);

export function createHybrid(opts) {
  const understand = createUnderstander(opts);
  const plan = async (input) => {
    const intent = await understand(input), first = planWith(input, greedy, intent), bad = problems(first, input);
    const used = intent.model ? 'model+rules' : 'rules';
    // A model call that fell back to the regex parser is marked, so the same sentence giving a different result is traceable.
    const parserFallback = Boolean(opts?.env?.GEMINI_API_KEY) && !intent.model && input.context?.mode !== 'discover';
    if (parserFallback) console.error('hybrid: the model reply was unusable or missing; the regex parser read this request.');
    if (!bad.length) return { ...first, meta: { ...first.meta, debug: { used, parserFallback, violations: [] } } };
    const second = planWith(input, searchSolver, intent);
    return { ...second, meta: { ...second.meta, debug: { used: 'search', parserFallback, violations: bad } } };
  };
  // Re-planning needs no understanding: the plan, the change and the answers are already structured.
  const replan = async (input) => {
    const first = await rules.replan(input), bad = problems(first, input);
    if (!bad.length) return { ...first, meta: { ...first.meta, debug: { used: 'rules', violations: [] } } };
    const second = await search.replan(input);
    return { ...second, meta: { ...second.meta, debug: { used: 'search', violations: bad } } };
  };
  return { plan, replan };
}

// Opt-in only: the registered hybrid sends request text to Gemini only when HYBRID_MODEL=1 and GEMINI_API_KEY are both set.
// A key alone changes nothing (a notice on stderr says so). It stays offline under node --test or with HYBRID_OFFLINE=1.
export const modelEnabled = (env) => Boolean(env.GEMINI_API_KEY) && env.HYBRID_MODEL === '1' && !env.NODE_TEST_CONTEXT && !env.HYBRID_OFFLINE;
let warned = false;
export const registeredOptions = (env = process.env) => {
  if (modelEnabled(env)) return { env };
  if (!warned && env.GEMINI_API_KEY && !env.NODE_TEST_CONTEXT) { warned = true; console.error('hybrid: running OFFLINE with the regex parser; no request text is sent. Set HYBRID_MODEL=1 to let Gemini read requests (or use --approach hybrid-live).'); }
  return undefined;
};
const registered = createHybrid(registeredOptions());
export const plan = registered.plan, replan = registered.replan;
export default { plan, replan };
