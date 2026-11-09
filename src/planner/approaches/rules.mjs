// Approach 1: rules planner.
// Fixed rules on the shared engine: the first free slot for one block, steps back-scheduled one per
// day before the deadline, and later blocks pushed to the first free slot after a change. It never
// backtracks and does not re-check the deadline when it pushes blocks.
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }.

import { createPlanner, rulesStrategy } from '../lib/engine.mjs';
import { adapt } from '../lib/adapt.mjs';

export default adapt(createPlanner(rulesStrategy));
