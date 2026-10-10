import { createGameState, simulateMove } from "../core/game-state";
import { overlappingArrowIds } from "../core/overlap";
import { arrowTrack } from "../core/stops";
import {
  cellKey,
  HEADINGS,
  headingForPath,
  stepSurface,
} from "../core/topology";
import type { ArrowDefinition, Cell, LevelDefinition } from "../core/types";
import { validateLevel } from "../core/validation";
import { growMechanicBody } from "./mechanic-body";
import type { Rng } from "./procedural";

const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;

/** Grow a common surface spine and independently sampled member peel points.
 * Bodies turn and cross seams through topology; no catalog of completed leg
 * plans, orientation transforms or stamped fallback supplies a group. */
export function constructOverlap(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  count: 2 | 3,
  limit = 256,
): readonly ArrowDefinition[] | undefined {
  for (let attempt = 0; attempt < limit; attempt++) {
    const cell: Cell = {
      face: rng.pick(FACES),
      x: rng.int(level.gridSize),
      y: rng.int(level.gridSize),
    };
    const neck = stepSurface(cell, rng.pick(HEADINGS), level.gridSize);
    if ([neck, cell].some((c) => occupied.has(cellKey(c)))) continue;
    const spine = growMechanicBody(
      level,
      rng,
      [neck, cell],
      occupied,
      2 + rng.int(5),
    );
    const arrows: ArrowDefinition[] = [];
    let failed = false;
    for (let member = 0; member < count; member++) {
      const peel = 1 + rng.int(spine.length - 1);
      const path = spine.slice(0, peel + 1);
      const used = new Set([
        ...occupied,
        ...spine.map(cellKey),
        ...arrows.flatMap((a) => a.path.map(cellKey)),
      ]);
      const initialLength = path.length;
      for (let step = 0, length = 3 + rng.int(8); step < length; step++) {
        const choices = HEADINGS.map((h) =>
          stepSurface(path.at(-1)!, h, level.gridSize),
        ).filter((c) => !used.has(cellKey(c)));
        if (!choices.length) break;
        // Keep sampled runs as well as turns: unrestricted short random walks
        // fold back into the same small head forks despite varied tails.
        const heading = headingForPath(path, level.gridSize);
        if (!heading) {
          failed = true;
          break;
        }
        const forward = stepSurface(path.at(-1)!, heading, level.gridSize);
        const straight = choices.find((c) => cellKey(c) === cellKey(forward));
        const next =
          straight && rng.next() < 0.72 ? straight : rng.pick(choices);
        path.push(next);
        used.add(cellKey(next));
      }
      if (failed || path.length < initialLength + 3) {
        failed = true;
        break;
      }
      arrows.push({ id: `r${level.id}-overlap-${member}`, path });
    }
    if (failed) continue;
    const board = { ...level, arrows };
    // The validator proves contiguous directed sharing, distinct heads and
    // nonintersecting future travel for every member on the actual wrap cube.
    if (
      !validateLevel(board).valid ||
      overlappingArrowIds(board, arrows[0]!.id).length !== count ||
      simulateMove(board, createGameState(board), arrows[0]!.id).kind !== "exit"
    )
      continue;
    if (
      new Set(
        arrows.map(
          (a) =>
            `${a.path.at(-1)!.face}:${headingForPath(a.path, level.gridSize)}`,
        ),
      ).size < 2 ||
      arrows.some((a) =>
        arrowTrack(board, a).some((c) => occupied.has(cellKey(c))),
      )
    )
      continue;
    return arrows;
  }
  return undefined;
}
