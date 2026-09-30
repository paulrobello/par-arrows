import { advancedSpotHeading, hasStatefulSpots } from "./directionals";
import { simulateMove as simulate } from "./movement";
import { overlappingArrowIds } from "./overlap";
import {
  failurePositionKey,
  maximumOffset,
  offsetOf,
  settledPathOf,
} from "./stops";
import { cellKey } from "./topology";
import type {
  Endpoint,
  GameState,
  Heading,
  LevelDefinition,
  MoveResult,
} from "./types";

export function createGameState(level: LevelDefinition): GameState {
  return {
    levelId: level.id,
    remainingIds: level.arrows.map((arrow) => arrow.id),
    failedIds: [],
    settledPaths: {},
    failedPositions: [],
    lives: level.lives,
    status: "playing",
    revision: 0,
    offsets: {},
    spotHeadings: {},
    collapsed: [],
    fallenIds: [],
    unlocked: [],
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
      offset: offsetOf(state.offsets, arrowId),
      reason: "Level state is not accepting moves.",
    };
  }
  return simulate(
    level,
    state.remainingIds,
    arrowId,
    endpoint,
    state.revision,
    state.offsets,
    state.settledPaths,
    state.spotHeadings,
    state.collapsed,
    state.unlocked,
  );
}

function afterFlips(
  level: LevelDefinition,
  state: GameState,
  result: MoveResult,
): Readonly<Record<string, Heading>> {
  const next = { ...(state.spotHeadings ?? {}) };
  for (const member of result.members ?? [result]) {
    for (const flip of member.spotFlips ?? []) {
      const key = cellKey(flip.cell);
      next[key] = advancedSpotHeading(level, flip.cell, next) as Heading;
    }
  }
  return next;
}

/** Collapsed cells after a successful move; a collision never reaches here. */
function afterCollapses(
  state: GameState,
  result: MoveResult,
): readonly string[] {
  const next = [...(state.collapsed ?? [])];
  for (const member of result.members ?? [result]) {
    for (const collapse of member.collapses ?? []) {
      const key = cellKey(collapse.cell);
      if (!next.includes(key)) next.push(key);
    }
  }
  return next;
}

/** Opened locks after a successful move; a collision or a gate never reaches here. */
function afterUnlocks(state: GameState, result: MoveResult): readonly string[] {
  const next = [...(state.unlocked ?? [])];
  for (const member of result.members ?? [result]) {
    for (const opening of member.unlocks ?? []) {
      if (!next.includes(opening.id)) next.push(opening.id);
    }
  }
  return next;
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
  const groupIds = overlappingArrowIds(level, result.arrowId);
  if (groupIds.some((id) => !state.remainingIds.includes(id))) {
    return state;
  }
  if (
    result.members &&
    (result.members.length !== groupIds.length ||
      result.members.some((member) => !groupIds.includes(member.arrowId)))
  ) {
    return state;
  }
  if (result.kind === "paused") {
    const steps = result.pausedSteps ?? 0;
    if (steps <= 0) return state;
    const clicked = level.arrows.find(
      (candidate) => candidate.id === result.arrowId,
    );
    if (!clicked) return state;
    if (clicked.kind === "double") {
      if (
        groupIds.length !== 1 ||
        result.settledPath?.length !== clicked.path.length
      ) {
        return state;
      }
      return {
        ...state,
        settledPaths: {
          ...(state.settledPaths ?? {}),
          [clicked.id]: result.settledPath,
        },
        spotHeadings: afterFlips(level, state, result),
        collapsed: afterCollapses(state, result),
        unlocked: afterUnlocks(state, result),
        revision: state.revision + 1,
      };
    }
    if (
      hasStatefulSpots(level) &&
      groupIds.length === 1 &&
      result.settledPath?.length === clicked.path.length
    ) {
      return {
        ...state,
        settledPaths: {
          ...(state.settledPaths ?? {}),
          [clicked.id]: result.settledPath,
        },
        spotHeadings: afterFlips(level, state, result),
        collapsed: afterCollapses(state, result),
        unlocked: afterUnlocks(state, result),
        revision: state.revision + 1,
      };
    }
    const offsets = { ...state.offsets };
    for (const id of groupIds) {
      const arrow = level.arrows.find((candidate) => candidate.id === id);
      if (!arrow) return state;
      const next = offsetOf(state.offsets, id) + steps;
      if (next > maximumOffset(level, arrow)) return state;
      offsets[id] = next;
    }
    return {
      ...state,
      offsets,
      spotHeadings: afterFlips(level, state, result),
      collapsed: afterCollapses(state, result),
      unlocked: afterUnlocks(state, result),
      revision: state.revision + 1,
    };
  }
  if (result.kind === "exit" || result.kind === "fall") {
    const remainingIds = state.remainingIds.filter(
      (id) => !groupIds.includes(id),
    );
    const offsets = { ...state.offsets };
    const settledPaths = { ...(state.settledPaths ?? {}) };
    for (const id of groupIds) {
      delete offsets[id];
      delete settledPaths[id];
    }
    // A fall removes the arrow or whole group like an exit and costs one
    // life, which every fall pays: there is no repeat of a removal.
    const falls = result.kind === "fall";
    const lives = falls ? Math.max(0, state.lives - 1) : state.lives;
    return {
      ...state,
      remainingIds,
      offsets,
      settledPaths,
      spotHeadings: afterFlips(level, state, result),
      collapsed: afterCollapses(state, result),
      unlocked: afterUnlocks(state, result),
      ...(falls
        ? { fallenIds: [...(state.fallenIds ?? []), ...groupIds], lives }
        : {}),
      status:
        lives === 0 ? "lost" : remainingIds.length === 0 ? "won" : "playing",
      revision: state.revision + 1,
    };
  }
  // A closed gate is terrain: the arrow rewinds with no life, no red mark
  // and every unlock and spot change of the attempt undone. The revision
  // still advances so the rewind is an accepted, animated outcome.
  if (result.kind === "gated") {
    return { ...state, revision: state.revision + 1 };
  }
  const clicked = level.arrows.find(
    (candidate) => candidate.id === result.arrowId,
  );
  if (clicked?.kind === "double") {
    const key = failurePositionKey(
      clicked.id,
      settledPathOf(level, state, clicked),
    );
    const previousFailures = state.failedPositions ?? [];
    const hasFailed = previousFailures.includes(key);
    const failedPositions = hasFailed
      ? previousFailures
      : [...previousFailures, key];
    const lives = hasFailed ? state.lives : Math.max(0, state.lives - 1);
    return {
      ...state,
      failedPositions,
      lives,
      status: lives === 0 ? "lost" : "playing",
      revision: state.revision + 1,
    };
  }
  const failedGroup = groupIds;
  const hasFailed = failedGroup.every((id) => state.failedIds.includes(id));
  const failedIds = hasFailed
    ? state.failedIds
    : [
        ...state.failedIds,
        ...failedGroup.filter((id) => !state.failedIds.includes(id)),
      ];
  const lives = hasFailed ? state.lives : Math.max(0, state.lives - 1);
  return {
    ...state,
    failedIds,
    lives,
    status: lives === 0 ? "lost" : "playing",
    revision: state.revision + 1,
  };
}
