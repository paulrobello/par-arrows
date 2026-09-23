import {
  advanceHead,
  cellKey,
  cellToWorld,
  edgePoint,
  faceHeadingVector,
  headingForPath,
  isContinuationEdge,
} from "./topology";
import type { Cell, Endpoint, LevelDefinition, MoveResult } from "./types";
import { spotHeadingAt } from "./directionals";
import { overlappingArrowIds } from "./overlap";
import { offsetOf, settledPathOf, stopKeys } from "./stops";

export { advanceHead } from "./topology";

type SettledState = Readonly<{
  offsets: Readonly<Record<string, number>>;
  settledPaths?: Readonly<Record<string, readonly Cell[]>>;
}>;

function invalid(
  arrowId: string,
  endpoint: Endpoint,
  stateRevision: number,
  offset: number,
  reason: string,
): MoveResult {
  return {
    arrowId,
    endpoint,
    kind: "invalid",
    distance: 0,
    route: [],
    waypoints: [],
    stateRevision,
    offset,
    reason,
  };
}

/**
 * Simulate one complete, renderer-independent arrow attempt without mutating
 * state. A head that steps onto a stop circle parks there; a head resuming from
 * one never re-parks, because only cells it steps onto are tested.
 */
function simulateSingle(
  level: LevelDefinition,
  remainingIds: readonly string[],
  settledState: SettledState,
  arrowId: string,
  endpoint: Endpoint = "head",
  stateRevision = 0,
  ignoredIds: ReadonlySet<string> = new Set(),
  stepLimit = Number.POSITIVE_INFINITY,
): MoveResult {
  const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
  const offset = offsetOf(settledState.offsets, arrowId);
  if (!arrow || !remainingIds.includes(arrowId)) {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      offset,
      "Arrow is not active in this level state.",
    );
  }
  if (endpoint === "tail" && arrow.kind !== "double") {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      offset,
      "Single-ended arrows only accept their head endpoint.",
    );
  }
  const settled = settledPathOf(level, settledState, arrow);
  const path = endpoint === "head" ? settled : [...settled].reverse();
  const initialHead = path[path.length - 1];
  if (!initialHead) {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      offset,
      "Arrow has no head cell.",
    );
  }
  const heading = headingForPath(path, level.gridSize);
  if (!heading) {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      offset,
      "Arrow needs two adjacent path cells to establish its heading.",
    );
  }

  const stops = stopKeys(level);
  const occupied = new Map<string, string>();
  for (const other of level.arrows) {
    if (
      other.id !== arrowId &&
      !ignoredIds.has(other.id) &&
      remainingIds.includes(other.id)
    ) {
      for (const cell of settledPathOf(level, settledState, other)) {
        occupied.set(cellKey(cell), other.id);
      }
    }
  }

  const route: Cell[] = [initialHead];
  let current: Cell = initialHead;
  let currentHeading = heading;
  let distance = 0;
  const visited = new Set<string>();
  const maximumSteps = 6 * level.gridSize * level.gridSize * 4;
  for (let step = 1; step <= maximumSteps; step += 1) {
    const stateKey = `${cellKey(current)}:${currentHeading}`;
    if (visited.has(stateKey)) {
      return invalid(
        arrowId,
        endpoint,
        stateRevision,
        offset,
        "Move entered a nonterminating continuation cycle.",
      );
    }
    visited.add(stateKey);
    const forward = advanceHead(level, current, currentHeading);
    if (forward.exits) {
      if (isContinuationEdge(level, current, currentHeading))
        return invalid(
          arrowId,
          endpoint,
          stateRevision,
          offset,
          "Continuation edge does not match its cube seam transition.",
        );
      return {
        arrowId,
        endpoint,
        kind: "exit",
        distance: distance + 0.5,
        route,
        waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
        stateRevision,
        offset,
        exit: {
          edgePoint: edgePoint(current, currentHeading, level.gridSize),
          tangent: faceHeadingVector(current.face, currentHeading),
        },
      };
    }
    const next = forward.next;
    if (!next) {
      return invalid(
        arrowId,
        endpoint,
        stateRevision,
        offset,
        "Topology returned neither a next cell nor an exit.",
      );
    }
    distance += 1;
    route.push(next);
    const blockerId = occupied.get(cellKey(next));
    if (blockerId) {
      return {
        arrowId,
        endpoint,
        kind: "blocked",
        distance: distance - 0.5,
        route,
        waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
        stateRevision,
        offset,
        blockerId,
        contact: {
          cell: next,
          point:
            current.face !== next.face
              ? edgePoint(current, currentHeading, level.gridSize)
              : [
                  (cellToWorld(current, level.gridSize)[0] +
                    cellToWorld(next, level.gridSize)[0]) /
                    2,
                  (cellToWorld(current, level.gridSize)[1] +
                    cellToWorld(next, level.gridSize)[1]) /
                    2,
                  (cellToWorld(current, level.gridSize)[2] +
                    cellToWorld(next, level.gridSize)[2]) /
                    2,
                ],
          distance: distance - 0.5,
        },
      };
    }
    if (stops.has(cellKey(next)) || step >= stepLimit) {
      const settledPath = [...path, ...route.slice(1)].slice(-path.length);
      const authoredOrder =
        endpoint === "head" ? settledPath : [...settledPath].reverse();
      return {
        arrowId,
        endpoint,
        kind: "paused",
        distance,
        route,
        waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
        stateRevision,
        offset,
        pausedSteps: step,
        ...(arrow.kind === "double" ? { settledPath: authoredOrder } : {}),
      };
    }
    current = next;
    currentHeading = spotHeadingAt(level, next) ?? forward.heading;
  }
  return invalid(
    arrowId,
    endpoint,
    stateRevision,
    offset,
    "Move exceeded the cube topology safety bound.",
  );
}

/**
 * The forward step at which an attempt stops advancing. Exits never interrupt a
 * group, so they report no event.
 */
function eventStep(member: MoveResult): number {
  return member.kind === "blocked" || member.kind === "paused"
    ? member.route.length - 1
    : Number.POSITIVE_INFINITY;
}

/** Simulate every member of a shared-tail group as one connected move. */
export function simulateMove(
  level: LevelDefinition,
  remainingIds: readonly string[],
  arrowId: string,
  endpoint: Endpoint = "head",
  stateRevision = 0,
  offsets: Readonly<Record<string, number>> = {},
  settledPaths: Readonly<Record<string, readonly Cell[]>> = {},
): MoveResult {
  const settledState: SettledState = { offsets, settledPaths };
  const ids = overlappingArrowIds(level, arrowId).filter((id) =>
    remainingIds.includes(id),
  );
  if (ids.length <= 1) {
    return simulateSingle(
      level,
      remainingIds,
      settledState,
      arrowId,
      endpoint,
      stateRevision,
    );
  }
  const ignored = new Set(ids);
  const simulateMembers = (stepLimit: number): readonly MoveResult[] =>
    ids.map((id) =>
      simulateSingle(
        level,
        remainingIds,
        settledState,
        id,
        id === arrowId ? endpoint : "head",
        stateRevision,
        ignored,
        stepLimit,
      ),
    );
  let members = simulateMembers(Number.POSITIVE_INFINITY);
  const blockedStep = Math.min(
    ...members.map((member) =>
      member.kind === "blocked" ? eventStep(member) : Number.POSITIVE_INFINITY,
    ),
  );
  const pausedStep = Math.min(
    ...members.map((member) =>
      member.kind === "paused" ? eventStep(member) : Number.POSITIVE_INFINITY,
    ),
  );
  // A collision on the same step as a stop still costs the group its life.
  const groupPauses =
    Number.isFinite(pausedStep) &&
    (!Number.isFinite(blockedStep) || pausedStep < blockedStep);
  if (groupPauses) {
    members = simulateMembers(pausedStep);
  }
  const clicked = members.find((member) => member.arrowId === arrowId);
  if (!clicked) {
    return simulateSingle(
      level,
      remainingIds,
      settledState,
      arrowId,
      endpoint,
      stateRevision,
    );
  }
  const invalidMember = members.find((member) => member.kind === "invalid");
  const kind: MoveResult["kind"] = invalidMember
    ? "invalid"
    : groupPauses
      ? "paused"
      : members.some((member) => member.kind === "blocked")
        ? "blocked"
        : "exit";
  return {
    ...clicked,
    kind,
    ...(invalidMember?.reason ? { reason: invalidMember.reason } : {}),
    ...(kind === "paused" ? { pausedSteps: pausedStep } : {}),
    distance:
      kind === "blocked"
        ? Math.min(
            ...members
              .filter((member) => member.kind === "blocked")
              .map((member) => member.distance),
          )
        : Math.max(...members.map((member) => member.distance)),
    members,
  };
}
