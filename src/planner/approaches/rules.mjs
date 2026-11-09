// Approach 1: plain rules. Parse the request, then place each block in the first free slot.
import { planWith, replanWith, greedyFinder, greedySteps } from '../core.mjs';

const solver = { finder: greedyFinder, steps: (intent, ctx) => greedySteps(intent, ctx, greedyFinder) };

export const plan = async (input) => planWith(input, solver);
export const replan = async (input) => replanWith(input, solver);
export default { plan, replan };
