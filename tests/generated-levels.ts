import { generateLevel } from "../src/content/procedural";
import type { LevelDefinition } from "../src/core/types";

// Bun runs every test file in one process, so the generation sweeps in
// separate files share these levels instead of regenerating them.
const cache = new Map<number, LevelDefinition>();

/** `generateLevel(id)`, generated once per test process. */
export function cachedLevel(id: number): LevelDefinition {
  let level = cache.get(id);
  if (!level) {
    level = generateLevel(id);
    cache.set(id, level);
  }
  return level;
}
