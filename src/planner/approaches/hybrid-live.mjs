// Opt-in model path for the command line: node benchmark/run.mjs --approach hybrid-live. It reads GEMINI_API_KEY from the environment; the registered hybrid stays offline.
import { createHybrid } from './hybrid.mjs';

export const createHybridLive = (opts = {}) => createHybrid({ env: process.env, ...opts });
const live = createHybridLive();
export const plan = live.plan, replan = live.replan;
export default { plan, replan };
