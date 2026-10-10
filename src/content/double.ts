import { createGameState, simulateMove } from "../core/game-state";
import { arrowTrack } from "../core/stops";
import { cellKey } from "../core/topology";
import type { LevelDefinition, MoveTarget } from "../core/types";
import {
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../core/validation";
import { growMechanicBody } from "./mechanic-body";
import { constructParking } from "./parking";
import type { Rng } from "./procedural";

export interface DoubleConstruction {
  readonly arrows: LevelDefinition["arrows"];
  readonly certificate: readonly MoveTarget[];
}

/** Grow a blocked body circuit, then release it through the opener's tail.
 * Contacts, branches and connector bodies come from actual surface walks;
 * neither endpoint receives a fixed adjacent blocker or a stamped fallback. */
export function constructDouble(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  limit = 16,
): DoubleConstruction | undefined {
  const bare: LevelDefinition = {
    id: level.id,
    title: level.title,
    lives: level.lives,
    gridSize: level.gridSize,
    arrows: [],
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  for (let attempt = 0; attempt < limit; attempt++) {
    // Native-cycle mode installs no circle and proves that removing the
    // opener's whole body releases the remaining sampled dependencies.
    const native = constructParking(bare, rng, occupied, 1, false, true);
    if (!native) continue;
    const opener = native.arrows[0]!;
    const nativeBoard = { ...bare, arrows: native.arrows };
    const forbidden = new Set([
      ...occupied,
      ...native.arrows
        .slice(1)
        .flatMap((a) => arrowTrack(nativeBoard, a).map(cellKey)),
    ]);
    const path = growMechanicBody(
      bare,
      rng,
      [...opener.path],
      forbidden,
      5 + rng.int(6),
    );
    if (path.length < 5) continue;
    const arrows = native.arrows.map((a, i) =>
      i === 0
        ? { id: `r${level.id}-double-double`, path, kind: "double" as const }
        : { ...a, id: `r${level.id}-double-c${i}` },
    );
    const board = { ...bare, arrows };
    const state = createGameState(board);
    if (
      !validateLevel(board).valid ||
      simulateMove(board, state, arrows[0]!.id, "tail").kind !== "exit" ||
      simulateMove(board, state, arrows[0]!.id).kind !== "blocked"
    )
      continue;
    // Both endpoint reaches must respect earlier reservations, even though
    // only the certificate's tail route enters the removal graph.
    if (
      arrows.some((a) =>
        (a.kind === "double" ? [a.path, [...a.path].reverse()] : [a.path]).some(
          (path) =>
            arrowTrack(board, { ...a, path }).some((c) =>
              occupied.has(cellKey(c)),
            ),
        ),
      )
    )
      continue;
    const certificate = solveLevelTargets(board);
    const single = {
      ...board,
      arrows: arrows.map((a) => ({ id: a.id, path: a.path })),
    };
    if (
      !certificate ||
      solveLevelTargets(single) ||
      hasStrandingState(board) !== false
    )
      continue;
    return { arrows, certificate };
  }
  return undefined;
}
