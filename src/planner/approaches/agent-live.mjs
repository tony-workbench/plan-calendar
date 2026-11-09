// Approach 3 with a live model: the same Agent loop, but each case sends one Gemini API call (free windows are in the prompt, so no tool turns).
// Run it only on purpose: node benchmark/run.mjs --approach agent-live. It needs GEMINI_API_KEY (and optionally GEMINI_MODEL) in the environment.
// Without a key it makes no request and every case fails with a clear error.
import { createAgent } from './agent.mjs';
import { createGeminiModel } from '../gemini.mjs';

const model = createGeminiModel();
const agent = createAgent({
  model: (args) => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set; agent-live makes no request without it');
    return model(args);
  },
  maxTurns: 3,
});
export const plan = (input) => agent.plan(input);
export const replan = (input) => agent.replan(input);
export default { plan, replan };
