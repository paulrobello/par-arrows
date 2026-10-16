import { applyMove, simulateMove } from "./game-state";
import { overlappingArrowIds } from "./overlap";
import { settledPathOf } from "./stops";
import { cellKey } from "./topology";
import type { GameState, LevelDefinition, MoveTarget } from "./types";
import { solveStateTargets, validateLevel } from "./validation";

export type DeletePlan =
  | { readonly eligible: true; readonly certificate: readonly MoveTarget[] }
  | { readonly eligible: false; readonly reason: string };

/** Cheap structural checks; the worker separately proves the remaining finish. */
export function deleteTargetUnavailable(
  level: LevelDefinition,
  state: GameState,
  target: MoveTarget,
): string | undefined {
  if (
    state.levelId !== level.id ||
    state.status !== "playing" ||
    state.lives <= 0
  )
    return "Recover a life or start a cube first";
  if (!Number.isSafeInteger(state.revision + 1))
    return "This move cannot be saved";
  const arrow = level.arrows.find((arrow) => arrow.id === target.arrowId);
  if (
    !arrow ||
    !state.remainingIds.includes(target.arrowId) ||
    (target.endpoint !== "head" && target.endpoint !== "tail") ||
    (target.endpoint === "tail" && arrow.kind !== "double")
  )
    return "Choose an arrow still on the cube";
  const ids = overlappingArrowIds(level, target.arrowId);
  if (ids.some((id) => !state.remainingIds.includes(id)))
    return "Choose a complete linked group";
  const covered = new Set(
    level.arrows
      .filter((arrow) => ids.includes(arrow.id))
      .flatMap((arrow) => settledPathOf(level, state, arrow).map(cellKey)),
  );
  if (
    (level.directionals ?? []).some(
      (spot) =>
        (spot.kind === "flip" || spot.kind === "rotor") &&
        covered.has(cellKey(spot.cell)),
    )
  )
    return "That arrow is holding a flip or rotor change. Choose another";
  if (
    (level.fragile ?? []).some(
      (cell) =>
        covered.has(cellKey(cell)) &&
        !(state.collapsed ?? []).includes(cellKey(cell)),
    )
  )
    return "That arrow is holding a fragile cell. Choose another";
  return undefined;
}

/** Remove a whole logical target, without movement, terrain triggers or a life refund. */
export function deleteArrowState(
  level: LevelDefinition,
  state: GameState,
  target: MoveTarget,
): GameState | undefined {
  if (deleteTargetUnavailable(level, state, target)) return undefined;
  const ids = new Set(overlappingArrowIds(level, target.arrowId));
  const remainingIds = state.remainingIds.filter((id) => !ids.has(id));
  const offsets = { ...state.offsets };
  const settledPaths = { ...state.settledPaths };
  for (const id of ids) {
    delete offsets[id];
    delete settledPaths[id];
  }
  return {
    ...state,
    remainingIds,
    offsets,
    settledPaths,
    status: remainingIds.length ? "playing" : "won",
    revision: state.revision + 1,
  };
}

/** Replay the worker's certificate before debiting; a search result alone is not trusted. */
export function verifiesDeleteFinish(
  level: LevelDefinition,
  state: GameState,
  certificate: readonly MoveTarget[],
): boolean {
  if (
    !Array.isArray(certificate) ||
    certificate.length > 4096 ||
    state.lives <= 0
  )
    return false;
  let current = state;
  for (const target of certificate) {
    if (
      !target ||
      typeof target.arrowId !== "string" ||
      !["head", "tail"].includes(target.endpoint)
    )
      return false;
    const result = simulateMove(
      level,
      current,
      target.arrowId,
      target.endpoint,
    );
    if (result.kind !== "exit" && result.kind !== "paused") return false;
    const next = applyMove(level, current, result);
    if (next === current || next.lives !== state.lives) return false;
    current = next;
  }
  return (
    current.status === "won" &&
    current.remainingIds.length === 0 &&
    current.lives === state.lives
  );
}

/** Runs off the UI thread. Unproved removals remain unavailable. */
export function planDelete(
  level: LevelDefinition,
  state: GameState,
  target: MoveTarget,
  nodeBudget = 256,
): DeletePlan {
  const reason = deleteTargetUnavailable(level, state, target);
  if (reason) return { eligible: false, reason };
  if (!validateLevel(level).valid)
    return { eligible: false, reason: "This cube cannot be checked safely" };
  const next = deleteArrowState(level, state, target);
  if (!next)
    return { eligible: false, reason: "Choose an arrow still on the cube" };
  const certificate =
    next.status === "won" ? [] : solveStateTargets(level, next, nodeBudget);
  if (!certificate || !verifiesDeleteFinish(level, next, certificate))
    return {
      eligible: false,
      reason: "Cannot verify a safe finish for that arrow. Choose another",
    };
  return { eligible: true, certificate };
}
