// Approach 4: hybrid. A model only UNDERSTANDS the request (one call, intent JSON); core.mjs plans, asks, remembers refusals and checks rules.
// A hard-rule check judges the draft and constraint search repairs it when it fails. An invalid reply or a missing key falls back to the regex parser.
// What the roundtable needs to see goes to meta.debug; `notes` only carries text that helps the user decide.
import rules from './rules.mjs';
import searchApproach, { solver as searchSolver } from './search.mjs';
import { planWith, greedyFinder, greedySteps } from '../core.mjs';
import { createUnderstander } from '../understand-live.mjs';
import { validatePlan } from '../../../benchmark/contract.mjs';

const greedy = { finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };
const problems = (result, input) => validatePlan(result, { events: input.events ?? [], deadline: result.meta?.deadline }).violations.map((v) => v.code);

export function createHybrid(opts) {
  const understand = createUnderstander(opts);
  const plan = async (input) => {
    const intent = await understand(input), first = planWith(input, greedy, intent), bad = problems(first, input);
    const used = intent.model ? 'model+rules' : 'rules';
    if (!bad.length) return { ...first, meta: { ...first.meta, debug: { used, violations: [] } } };
    const second = planWith(input, searchSolver, intent);
    return { ...second, meta: { ...second.meta, debug: { used: 'search', violations: bad } } };
  };
  // Re-planning needs no understanding: the plan, the change and the answers are already structured.
  const replan = async (input) => {
    const first = await rules.replan(input), bad = problems(first, input);
    if (!bad.length) return { ...first, meta: { ...first.meta, debug: { used: 'rules', violations: [] } } };
    const second = await searchApproach.replan(input);
    return { ...second, meta: { ...second.meta, debug: { used: 'search', violations: bad } } };
  };
  return { plan, replan };
}

// The registered hybrid is offline (regex understanding). The model is an opt-in: createHybrid({ env: process.env }), used by hybrid-live.
const offline = createHybrid();
export const plan = offline.plan, replan = offline.replan;
export default { plan, replan };
