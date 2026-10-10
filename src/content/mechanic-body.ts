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

const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;

/** Connect a lane contact to a chosen neck on the surface, with seeded detours. */
export function connectMechanicBody(
  level: LevelDefinition,
  rng: Rng,
  start: Cell,
  goal: Cell,
  forbidden: ReadonlySet<string>,
): Cell[] | undefined {
  const queue = [start];
  const parents = new Map<string, Cell | undefined>([
    [cellKey(start), undefined],
  ]);
  // A different sparse obstacle field each time changes the route itself,
  // rather than transforming a completed gadget.
  const obstacles = new Set<string>();
  for (let i = 0; i < level.gridSize * level.gridSize; i += 1) {
    if (rng.next() < 0.6)
      obstacles.add(
        cellKey({
          face: rng.pick(FACES),
          x: rng.int(level.gridSize),
          y: rng.int(level.gridSize),
        }),
      );
  }
  for (
    let cursor = 0;
    cursor < queue.length && cursor < 6 * level.gridSize ** 2;
    cursor += 1
  ) {
    const cell = queue[cursor]!;
    if (cellKey(cell) === cellKey(goal)) {
      const path: Cell[] = [];
      let current: Cell | undefined = cell;
      while (current) {
        path.unshift(current);
        current = parents.get(cellKey(current));
      }
      return path.length <= 30 ? path : undefined;
    }
    const offset = rng.int(4);
    for (let h = 0; h < 4; h += 1) {
      const next = stepSurface(
        cell,
        HEADINGS[(h + offset) % 4]!,
        level.gridSize,
      );
      const key = cellKey(next);
      if (
        parents.has(key) ||
        forbidden.has(key) ||
        (key !== cellKey(goal) && obstacles.has(key))
      )
        continue;
      parents.set(key, cell);
      queue.push(next);
    }
  }
  return undefined;
}
