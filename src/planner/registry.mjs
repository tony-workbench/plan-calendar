// Lists approaches by the path convention src/planner/approaches/<name>.mjs.
// Each file's default export implements the planner interface. Files load lazily,
// and a missing or broken file is skipped rather than failing the registry.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertPlanner } from './interface.mjs';

const dir = new URL('./approaches/', import.meta.url);

export function listApproaches() {
  try {
    return readdirSync(fileURLToPath(dir))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => f.slice(0, -4))
      .sort();
  } catch {
    return [];
  }
}

async function tryLoad(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return { reason: 'invalid name' };
  try {
    const mod = await import(new URL(`${name}.mjs`, dir).href);
    return { planner: assertPlanner(mod.default) };
  } catch (err) {
    return { reason: err.code === 'ERR_MODULE_NOT_FOUND' ? 'missing' : String(err.message) };
  }
}

// Returns the planner, or null when the approach is missing or does not implement the interface.
export async function loadApproach(name) {
  return (await tryLoad(name)).planner ?? null;
}

// -> { planners: Map(name -> planner), skipped: [{ name, reason }] }
export async function loadAll(names = listApproaches()) {
  const planners = new Map();
  const skipped = [];
  for (const name of names) {
    const { planner, reason } = await tryLoad(name);
    if (planner) planners.set(name, planner);
    else skipped.push({ name, reason });
  }
  return { planners, skipped };
}

// Loaded planners by name, for synchronous lookups (Map: name -> planner).
export const { planners: approaches } = await loadAll();
