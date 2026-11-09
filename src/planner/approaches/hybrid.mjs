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

export const plan = (input) => pick((p) => p.plan(input), input);
export const replan = (input) => pick((p) => p.replan(input), input);
export default { plan, replan };
