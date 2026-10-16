import { applyMove, simulateMove } from "./game-state";
import type { GameState, LevelDefinition, MoveTarget } from "./types";

/** One move of gameplay history, deliberately excluding wallet/progression. */
export interface UndoSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly before: GameState;
  readonly target: MoveTarget;
  readonly tutorialComplete: boolean;
  readonly tutorialStep?: number;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Optional empty mechanic fields in older saves mean the same settled state. */
export function gameStateKey(
  state: GameState,
  includeRevision = false,
): string {
  return JSON.stringify(
    canonical({
      ...state,
      revision: includeRevision ? state.revision : 0,
      settledPaths: state.settledPaths ?? {},
      failedPositions: state.failedPositions ?? [],
      spotHeadings: state.spotHeadings ?? {},
      collapsed: state.collapsed ?? [],
      fallenIds: state.fallenIds ?? [],
      unlocked: state.unlocked ?? [],
    }),
  );
}

export function changesGameplay(before: GameState, after: GameState): boolean {
  return gameStateKey(before) !== gameStateKey(after);
}

/** Replay proves this snapshot restores exactly the last useful move. */
export function canUndo(
  level: LevelDefinition,
  current: GameState,
  snapshot: UndoSnapshot,
): boolean {
  const before = snapshot.before;
  if (
    before.levelId !== level.id ||
    current.levelId !== level.id ||
    before.status !== "playing" ||
    before.lives <= 0 ||
    before.revision >= current.revision ||
    !Number.isSafeInteger(current.revision + 1)
  )
    return false;
  const result = simulateMove(
    level,
    before,
    snapshot.target.arrowId,
    snapshot.target.endpoint,
  );
  const after = applyMove(level, before, result);
  return (
    changesGameplay(before, after) &&
    gameStateKey(after) === gameStateKey(current)
  );
}

export function undoState(
  current: GameState,
  snapshot: UndoSnapshot,
): GameState {
  // Logical contents go back; the revision advances to reject stale results.
  return { ...snapshot.before, revision: current.revision + 1 };
}
