// Command-line alias for the model path: node benchmark/run.mjs --approach hybrid-live. It forces the model understanding (GEMINI_API_KEY from the environment) even where the registered hybrid stays offline (no key, node --test, HYBRID_OFFLINE=1); with a key the registered hybrid takes the same route.
import { createHybrid } from './hybrid.mjs';

export const createHybridLive = (opts = {}) => createHybrid({ env: process.env, ...opts });
const live = createHybridLive();
export const plan = live.plan, replan = live.replan;
export default { plan, replan };
