import { simulateMove as simulate } from "./movement";
import type { Endpoint, GameState, LevelDefinition, MoveResult } from "./types";

export function createGameState(level: LevelDefinition): GameState {
  return {
    levelId: level.id,
    remainingIds: level.arrows.map((arrow) => arrow.id),
    failedIds: [],
    lives: level.lives,
    status: "playing",
    revision: 0,
  };
}

export function simulateMove(
  level: LevelDefinition,
  state: GameState,
  arrowId: string,
  endpoint: Endpoint = "head",
): MoveResult {
  if (state.levelId !== level.id || state.status !== "playing") {
    return {
      arrowId,
      endpoint,
      kind: "invalid",
      distance: 0,
      route: [],
      waypoints: [],
      stateRevision: state.revision,
      reason: "Level state is not accepting moves.",
    };
  }
  return simulate(level, state.remainingIds, arrowId, endpoint, state.revision);
}

/** Apply an already-simulated result once, producing a complete settled snapshot. */
export function applyMove(
  level: LevelDefinition,
  state: GameState,
  result: MoveResult,
): GameState {
  if (
    state.levelId !== level.id ||
    state.status !== "playing" ||
    result.kind === "invalid" ||
    result.stateRevision !== state.revision
  ) {
    return state;
  }
  if (!state.remainingIds.includes(result.arrowId)) {
    return state;
  }
  if (result.kind === "exit") {
    const remainingIds = state.remainingIds.filter(
      (id) => id !== result.arrowId,
    );
    return {
      ...state,
      remainingIds,
      status: remainingIds.length === 0 ? "won" : "playing",
      revision: state.revision + 1,
    };
  }
  const hasFailed = state.failedIds.includes(result.arrowId);
  const failedIds = hasFailed
    ? state.failedIds
    : [...state.failedIds, result.arrowId];
  const lives = hasFailed ? state.lives : Math.max(0, state.lives - 1);
  return {
    ...state,
    failedIds,
    lives,
    status: lives === 0 ? "lost" : "playing",
    revision: state.revision + 1,
  };
}
