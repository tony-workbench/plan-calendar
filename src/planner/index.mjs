// One interface, four approaches: every planner exports plan({ request, events, now, context }) and replan({ plan, change, events, answers }).
import rules from './approaches/rules.mjs';
import search from './approaches/search.mjs';
import agent from './approaches/agent.mjs';
import hybrid from './approaches/hybrid.mjs';

export const approaches = { rules, search, agent, hybrid };
export default approaches;
