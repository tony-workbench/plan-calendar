// Wraps a planner's plan/replan so both are async and every result goes through enforce().
import { enforce } from '../interface.mjs';

export const adapt = ({ plan, replan }) => ({
  plan: async (input) => enforce(await plan(input)),
  replan: async (input) => enforce(await replan(input)),
});
