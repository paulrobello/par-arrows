import {
  cellKey,
  cellToWorld,
  edgePoint,
  faceHeadingVector,
  isContinuationEdge,
} from "./topology";
import type {
  Cell,
  CellCollapse,
  Endpoint,
  Heading,
  LevelDefinition,
  LockOpening,
  MoveResult,
  SpotFlip,
} from "./types";
import {
  advancedSpotHeading,
  hasStatefulSpots,
  isStatefulSpot,
  spotHeadingAt,
} from "./directionals";
import { fragileKeys } from "./fragile";
import { gateAt, keyAt } from "./locks";
import { mirrorHeadingAt } from "./mirrors";
import { overlappingArrowIds } from "./overlap";
import { offsetOf, settledPathOf, stopKeys } from "./stops";
import { advanceWithPortals, pathHeading } from "./wormholes";

export { advanceHead } from "./topology";

type SettledState = Readonly<{
  offsets: Readonly<Record<string, number>>;
  settledPaths?: Readonly<Record<string, readonly Cell[]>>;
  spotHeadings?: Readonly<Record<string, Heading>>;
  collapsed?: readonly string[];
  unlocked?: readonly string[];
}>;

/** Spot state as a loop-key fragment, independent of insertion order. */
function spotStateKey(spots: Readonly<Record<string, Heading>>): string {
  return JSON.stringify(
    Object.entries(spots).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

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
  fallAtLimit = false,
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
  const heading = pathHeading(level, path);
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
  // `body` is the arrow's occupied cells, tail first; `live` is the spot
  // state this move reads, so a spot advanced earlier in the move redirects
  // a later entry. Levels without flip or rotor spots or fragile cells skip
  // body tracking.
  const tracksFlips = hasStatefulSpots(level);
  const fragile = fragileKeys(level);
  const tracksBody = tracksFlips || fragile.size > 0;
  let body: Cell[] = [...path];
  const live: Record<string, Heading> = {
    ...(settledState.spotHeadings ?? {}),
  };
  // Holes read by this move. A cell this move collapses stays out: the
  // arrow never collides with its own body, and a head re-entering its own
  // crossing is the same passage.
  const holes = new Set(settledState.collapsed ?? []);
  // Locks open for this move: those already open plus any whose key the head
  // has crossed so far in it. A gate opened mid-move lets the same head pass.
  const opened = new Set(settledState.unlocked ?? []);
  const unlocks: LockOpening[] = [];
  const spotFlips: SpotFlip[] = [];
  const collapses: CellCollapse[] = [];
  const portals: { from: Cell; to: Cell; step: number }[] = [];
  const releaseTail = (step: number): void => {
    const leaving = body[0];
    body = body.slice(1);
    if (!leaving) return;
    const key = cellKey(leaving);
    const collapsible = fragile.has(key) && !holes.has(key);
    if (!collapsible && !isStatefulSpot(level, leaving)) return;
    if (body.some((cell) => cellKey(cell) === key)) return;
    if (collapsible) {
      if (!collapses.some((entry) => cellKey(entry.cell) === key))
        collapses.push({ cell: leaving, step });
      return;
    }
    live[key] = advancedSpotHeading(level, leaving, live) as Heading;
    spotFlips.push({ cell: leaving, step });
  };
  const flipResult = () => ({
    ...(spotFlips.length > 0 ? { spotFlips } : {}),
    ...(collapses.length > 0 ? { collapses } : {}),
    ...(unlocks.length > 0 ? { unlocks } : {}),
  });
  let current: Cell = initialHead;
  let currentHeading = heading;
  let distance = 0;
  const visited = new Set<string>();
  const maximumSteps = 6 * level.gridSize * level.gridSize * 4;
  for (let step = 1; step <= maximumSteps; step += 1) {
    // On flip and rotor levels the future also depends on the spot state and
    // on where the body is, because a pending advance fires when the tail leaves.
    const stateKey = tracksFlips
      ? `${cellKey(current)}:${currentHeading}:${spotStateKey(live)}:${body.map(cellKey).join("|")}`
      : `${cellKey(current)}:${currentHeading}`;
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
    const forward = advanceWithPortals(level, current, currentHeading);
    if (forward.exits) {
      if (isContinuationEdge(level, current, currentHeading))
        return invalid(
          arrowId,
          endpoint,
          stateRevision,
          offset,
          "Continuation edge does not match its cube seam transition.",
        );
      if (tracksBody) while (body.length > 0) releaseTail(0);
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
        ...flipResult(),
        ...(portals.length > 0 ? { portals } : {}),
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
    if (forward.portal) {
      portals.push({ from: forward.portal, to: next, step });
    }
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
          point: forward.portal
            ? cellToWorld(next, level.gridSize)
            : current.face !== next.face
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
        ...flipResult(),
        ...(portals.length > 0 ? { portals } : {}),
      };
    }
    // A closed gate is terrain, not an arrow: the head stops short of it and
    // the whole attempt rewinds at no cost. No arrow ever rests on a closed
    // gate, so an arrow collision there is impossible and never masked.
    const gate = gateAt(level, next);
    if (gate && !opened.has(gate.id)) {
      return {
        arrowId,
        endpoint,
        kind: "gated",
        distance: distance - 0.5,
        route,
        waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
        stateRevision,
        offset,
        gate: next,
        ...flipResult(),
        ...(portals.length > 0 ? { portals } : {}),
      };
    }
    const key = keyAt(level, next);
    if (key && !opened.has(key.id)) {
      opened.add(key.id);
      unlocks.push({ id: key.id, cell: key.lock, step });
    }
    // A head entering a collapsed cell turns into the cube and the body
    // follows it down, so, as for an exit, every cell it covered is cleared.
    // No arrow ever occupies a hole, so this never masks a collision.
    if (holes.has(cellKey(next))) {
      if (tracksBody) while (body.length > 0) releaseTail(step);
      return {
        arrowId,
        endpoint,
        kind: "fall",
        distance,
        route,
        waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
        stateRevision,
        offset,
        hole: next,
        ...flipResult(),
        ...(portals.length > 0 ? { portals } : {}),
      };
    }
    if (tracksBody) {
      body.push(next);
      releaseTail(step);
    }
    // A group member cut short by another member's fall goes down with it.
    if (fallAtLimit && step >= stepLimit) {
      if (tracksBody) while (body.length > 0) releaseTail(step);
      return {
        arrowId,
        endpoint,
        kind: "fall",
        distance,
        route,
        waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
        stateRevision,
        offset,
        ...flipResult(),
        ...(portals.length > 0 ? { portals } : {}),
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
        ...(arrow.kind === "double" || tracksFlips
          ? { settledPath: authoredOrder }
          : {}),
        ...flipResult(),
        ...(portals.length > 0 ? { portals } : {}),
      };
    }
    current = next;
    currentHeading =
      spotHeadingAt(level, next, live) ??
      mirrorHeadingAt(level, next, forward.heading) ??
      forward.heading;
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
  return member.kind === "blocked" ||
    member.kind === "gated" ||
    member.kind === "paused" ||
    member.kind === "fall"
    ? member.route.length - 1
    : Number.POSITIVE_INFINITY;
}

function firstStep(members: readonly MoveResult[], kind: string): number {
  return Math.min(
    ...members.map((member) =>
      member.kind === kind ? eventStep(member) : Number.POSITIVE_INFINITY,
    ),
  );
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
  spotHeadings: Readonly<Record<string, Heading>> = {},
  collapsed: readonly string[] = [],
  unlocked: readonly string[] = [],
): MoveResult {
  const settledState: SettledState = {
    offsets,
    settledPaths,
    spotHeadings,
    collapsed,
    unlocked,
  };
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
  const simulateMembers = (
    stepLimit: number,
    fallAtLimit = false,
  ): readonly MoveResult[] =>
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
        fallAtLimit,
      ),
    );
  let members = simulateMembers(Number.POSITIVE_INFINITY);
  const blockedStep = firstStep(members, "blocked");
  const gatedStep = firstStep(members, "gated");
  const fallStep = firstStep(members, "fall");
  const pausedStep = firstStep(members, "paused");
  // The earliest event decides the group. On one step a collision outranks a
  // closed gate, which outranks a fall, which outranks a stop: a collision
  // and a gate both rewind and keep the group, the collision is the
  // conservative reading of the two, and a stop never saves a falling group.
  // Members read the move-start lock state, so one member crossing a key
  // opens its gate only for later moves.
  const groupGated =
    Number.isFinite(gatedStep) &&
    gatedStep < blockedStep &&
    gatedStep <= fallStep &&
    gatedStep <= pausedStep;
  const groupFalls =
    !groupGated &&
    Number.isFinite(fallStep) &&
    fallStep < blockedStep &&
    fallStep <= pausedStep;
  const groupPauses =
    !groupGated &&
    !groupFalls &&
    Number.isFinite(pausedStep) &&
    (!Number.isFinite(blockedStep) || pausedStep < blockedStep);
  if (groupFalls) {
    members = simulateMembers(fallStep, true);
  } else if (groupPauses) {
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
  const hole = members.find((member) => member.hole)?.hole;
  const gate = members.find(
    (member) => member.kind === "gated" && eventStep(member) === gatedStep,
  )?.gate;
  const kind: MoveResult["kind"] = invalidMember
    ? "invalid"
    : groupGated
      ? "gated"
      : groupFalls
        ? "fall"
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
    ...(kind === "fall" && hole ? { hole } : {}),
    ...(kind === "gated" && gate ? { gate } : {}),
    distance:
      kind === "blocked" || kind === "gated"
        ? Math.min(
            ...members
              .filter((member) => member.kind === kind)
              .map((member) => member.distance),
          )
        : Math.max(...members.map((member) => member.distance)),
    members,
  };
}
