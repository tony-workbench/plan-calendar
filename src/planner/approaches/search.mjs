// Approach 2: constraint search.
// The same constraints as the rules planner (fixed events, day window, meals, step order, deadline)
// are solved by depth-first search with backtracking, and re-plans keep the deadline as a hard bound.
// Contract: default export { plan({request, events, now, context}), replan({plan, change, events, answers}) }.

import { createPlanner, searchStrategy } from '../lib/engine.mjs';
import { adapt } from '../lib/adapt.mjs';

export default adapt(createPlanner(searchStrategy));
