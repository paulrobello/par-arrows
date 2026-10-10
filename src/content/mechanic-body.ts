import { cellKey, HEADINGS, stepSurface } from "../core/topology";
import type { Cell, LevelDefinition } from "../core/types";
import type { Rng } from "./procedural";

/** Grow a seeded self-avoiding surface walk backwards from its head. */
export function growMechanicBody(
  level: LevelDefinition,
  rng: Rng,
  path: Cell[],
  forbidden: ReadonlySet<string>,
  length: number,
): Cell[] {
  const seen = new Set(path.map(cellKey));
  while (path.length < length) {
    const choices = HEADINGS.map((h) =>
      stepSurface(path[0]!, h, level.gridSize),
    ).filter((c) => !seen.has(cellKey(c)) && !forbidden.has(cellKey(c)));
    if (!choices.length) break;
    const cell = rng.pick(choices);
    path.unshift(cell);
    seen.add(cellKey(cell));
  }
  return path;
}
