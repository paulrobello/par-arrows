import {
  cellKey,
  cellToWorld,
  edgePoint,
  faceHeadingVector,
  forwardInfo,
  headingForPath,
  seamTransition,
} from "./topology";
import type {
  ArrowDefinition,
  Cell,
  Endpoint,
  ForwardInfo,
  Heading,
  LevelDefinition,
  MoveResult,
} from "./types";

function orientedPath(
  arrow: ArrowDefinition,
  endpoint: Endpoint,
): readonly Cell[] {
  return endpoint === "head" ? arrow.path : [...arrow.path].reverse();
}

function invalid(
  arrowId: string,
  endpoint: Endpoint,
  stateRevision: number,
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
    reason,
  };
}

function edgePolicy(
  level: Pick<LevelDefinition, "edgePolicies">,
  cell: Cell,
  heading: "east" | "west" | "south" | "north",
) {
  return level.edgePolicies?.find(
    (rule) => rule.face === cell.face && rule.edge === heading,
  );
}

/** Resolve one head step, including a declared continuation across a seam. */
export function advanceHead(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies">,
  cell: Cell,
  heading: Heading,
): ForwardInfo {
  const forward = forwardInfo(cell, heading, level.gridSize);
  if (
    !forward.exits ||
    edgePolicy(level, cell, heading)?.policy !== "continue"
  ) {
    return forward;
  }
  const transition = seamTransition(cell, heading, level.gridSize);
  const neighbor = edgePolicy(level, cell, heading)?.neighbor;
  if (
    !neighbor ||
    neighbor.face !== transition.cell.face ||
    neighbor.entering !== transition.heading
  ) {
    return forward;
  }
  return { heading: transition.heading, next: transition.cell, exits: false };
}

/** Simulate one complete, renderer-independent arrow attempt without mutating state. */
export function simulateMove(
  level: LevelDefinition,
  remainingIds: readonly string[],
  arrowId: string,
  endpoint: Endpoint = "head",
  stateRevision = 0,
): MoveResult {
  const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
  if (!arrow || !remainingIds.includes(arrowId)) {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      "Arrow is not active in this level state.",
    );
  }
  if (endpoint === "tail" && arrow.kind !== "double") {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      "Single-ended arrows only accept their head endpoint.",
    );
  }
  const path = orientedPath(arrow, endpoint);
  const initialHead = path[path.length - 1];
  if (!initialHead) {
    return invalid(arrowId, endpoint, stateRevision, "Arrow has no head cell.");
  }
  const heading = headingForPath(path, level.gridSize);
  if (!heading) {
    return invalid(
      arrowId,
      endpoint,
      stateRevision,
      "Arrow needs two adjacent path cells to establish its heading.",
    );
  }

  const occupied = new Map<string, string>();
  for (const other of level.arrows) {
    if (other.id !== arrowId && remainingIds.includes(other.id)) {
      for (const cell of other.path) {
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
        "Move entered a nonterminating continuation cycle.",
      );
    }
    visited.add(stateKey);
    const forward = advanceHead(level, current, currentHeading);
    if (forward.exits) {
      const policy = edgePolicy(level, current, currentHeading);
      if (policy?.policy === "continue")
        return invalid(
          arrowId,
          endpoint,
          stateRevision,
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
        "Topology returned neither a next cell nor an exit.",
      );
    }
    distance += 1;
    const movingBody = [...path, ...route.slice(1)].slice(1 - path.length);
    if (movingBody.some((cell) => cellKey(cell) === cellKey(next))) {
      return invalid(
        arrowId,
        endpoint,
        stateRevision,
        "Move contacted its own moving body.",
      );
    }
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
    current = next;
    currentHeading = forward.heading;
  }
  return invalid(
    arrowId,
    endpoint,
    stateRevision,
    "Move exceeded the cube topology safety bound.",
  );
}
