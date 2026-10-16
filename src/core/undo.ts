import { applyMove, simulateMove } from "./game-state";
import { deleteArrowState } from "./delete-arrow";
import type {
  GameState,
  LevelDefinition,
  MoveResult,
  MoveTarget,
} from "./types";

/** One move of gameplay history, deliberately excluding wallet/progression. */
export interface UndoSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly before: GameState;
  readonly target: MoveTarget;
  readonly kind?: "move" | "delete";
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
  const after =
    snapshot.kind === "delete"
      ? deleteArrowState(level, before, snapshot.target)
      : applyMove(
          level,
          before,
          simulateMove(
            level,
            before,
            snapshot.target.arrowId,
            snapshot.target.endpoint,
          ),
        );
  return (
    !!after &&
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

/** Reconstruct presentation of a fatal collision from verified, durable history. */
export function fatalCollisionForUndo(
  level: LevelDefinition,
  current: GameState,
  snapshot: UndoSnapshot | null,
): MoveResult | undefined {
  if (
    current.status !== "lost" ||
    current.lives !== 0 ||
    !snapshot ||
    snapshot.kind === "delete" ||
    snapshot.before.lives !== 1 ||
    !canUndo(level, current, snapshot)
  )
    return undefined;
  const result = simulateMove(
    level,
    snapshot.before,
    snapshot.target.arrowId,
    snapshot.target.endpoint,
  );
  return result.kind === "blocked" ? result : undefined;
}
