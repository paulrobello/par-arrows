import {
  applyMove,
  createGameState,
  simulateMove as simulateState,
} from "./game-state";
import { advanceHead, simulateMove } from "./movement";
import { cellKey, headingForPath, linkKey, seamTransition } from "./topology";
import { overlappingArrowIds, sharedDirectedSegment } from "./overlap";
import type {
  ArrowDefinition,
  Cell,
  Endpoint,
  GameState,
  LevelDefinition,
} from "./types";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function orientedPath(
  arrow: ArrowDefinition,
  endpoint: Endpoint,
): readonly Cell[] {
  return endpoint === "head" ? arrow.path : [...arrow.path].reverse();
}

function inBounds(cell: Cell, gridSize: number): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < gridSize && cell.y < gridSize;
}

function selfContactError(
  arrow: ArrowDefinition,
  level: LevelDefinition,
  endpoint: Endpoint,
): string | undefined {
  const path = orientedPath(arrow, endpoint);
  const initialHead = path[path.length - 1];
  if (!initialHead) {
    return `Arrow ${arrow.id} has no head cell.`;
  }
  const heading = headingForPath(path, level.gridSize);
  if (!heading) {
    return undefined;
  }
  let head: Cell = initialHead;
  let currentHeading = heading;
  const route: Cell[] = [initialHead];
  const visited = new Set<string>();
  const maximumSteps = 6 * level.gridSize * level.gridSize * 4;
  for (let step = 1; step <= maximumSteps; step += 1) {
    const stateKey = `${cellKey(head)}:${currentHeading}`;
    if (visited.has(stateKey)) {
      return `Arrow ${arrow.id} has a nonterminating continuation loop from its ${endpoint} endpoint.`;
    }
    visited.add(stateKey);
    const forward = advanceHead(level, head, currentHeading);
    if (forward.exits) {
      return undefined;
    }
    const next = forward.next;
    if (!next) {
      return `Arrow ${arrow.id} has an incomplete topology step.`;
    }
    const movingBody = [...path, ...route.slice(1)].slice(1 - path.length);
    if (movingBody.some((cell) => cellKey(cell) === cellKey(next))) {
      return `Arrow ${arrow.id} can contact its own body from its ${endpoint} endpoint.`;
    }
    route.push(next);
    head = next;
    currentHeading = forward.heading;
  }
  return `Arrow ${arrow.id} has a nonterminating continuation loop from its ${endpoint} endpoint.`;
}

/** Structural validation and independent full-motion self-contact checks. */
export function validateLevel(level: LevelDefinition): ValidationResult {
  const errors: string[] = [];
  if (!Number.isInteger(level.id) || level.id < 0) {
    errors.push("Level id must be a nonnegative integer.");
  }
  if (!Number.isInteger(level.gridSize) || level.gridSize < 2) {
    errors.push("Grid size must be an integer of at least 2.");
  }
  if (!Number.isInteger(level.lives) || level.lives < 1) {
    errors.push("Lives must be a positive integer.");
  }
  if (
    level.arrowScale !== undefined &&
    (!Number.isFinite(level.arrowScale) || level.arrowScale <= 0)
  ) {
    errors.push("Arrow display scale must be a positive finite number.");
  }
  const edgePolicies = new Set<string>();
  for (const edge of level.edgePolicies ?? []) {
    const key = `${edge.face}:${edge.edge}`;
    if (edgePolicies.has(key)) {
      errors.push(`Edge policy ${key} is declared more than once.`);
    }
    edgePolicies.add(key);
    if (edge.policy === "exit" && edge.neighbor) {
      errors.push(`Exit edge ${key} must not declare a continuation neighbor.`);
    }
    if (edge.policy === "continue" && !edge.neighbor) {
      errors.push(`Continuation edge ${key} needs an oriented neighbor.`);
    }
    if (edge.policy === "continue" && edge.neighbor) {
      const boundary: Cell =
        edge.edge === "east" || edge.edge === "west"
          ? {
              face: edge.face,
              x: edge.edge === "east" ? level.gridSize - 1 : 0,
              y: 0,
            }
          : {
              face: edge.face,
              x: 0,
              y: edge.edge === "south" ? level.gridSize - 1 : 0,
            };
      const expected = seamTransition(boundary, edge.edge, level.gridSize);
      if (
        expected.cell.face !== edge.neighbor.face ||
        expected.heading !== edge.neighbor.entering
      ) {
        errors.push(
          `Continuation edge ${key} does not match the cube seam transition.`,
        );
      }
    }
  }

  const ids = new Set<string>();
  const cells = new Map<string, string[]>();
  const links = new Map<string, string[]>();
  for (const arrow of level.arrows) {
    if (!arrow.id || ids.has(arrow.id)) {
      errors.push(
        `Arrow ids must be nonempty and unique: ${arrow.id || "<empty>"}.`,
      );
    }
    ids.add(arrow.id);
    if (arrow.kind && arrow.kind !== "single" && arrow.kind !== "double") {
      errors.push(
        `Arrow ${arrow.id} has unsupported kind ${String(arrow.kind)}.`,
      );
    }
    if (arrow.path.length < 2) {
      errors.push(`Arrow ${arrow.id} needs at least two path cells.`);
      continue;
    }
    for (const cell of arrow.path) {
      if (!inBounds(cell, level.gridSize)) {
        errors.push(
          `Arrow ${arrow.id} has an out-of-bounds cell ${cellKey(cell)}.`,
        );
      }
      const key = cellKey(cell);
      const owners = cells.get(key) ?? [];
      if (owners.includes(arrow.id)) {
        errors.push(`Arrow ${arrow.id} overlaps its own cell ${key}.`);
      }
      for (const owner of owners) {
        const previous = level.arrows.find(
          (candidate) => candidate.id === owner,
        );
        const segment = previous
          ? sharedDirectedSegment(previous, arrow)
          : undefined;
        if (!segment?.cells.has(key)) {
          errors.push(
            `Arrow ${arrow.id} overlaps cell ${key} already used by ${owner}.`,
          );
        }
      }
      cells.set(key, [...owners, arrow.id]);
    }
    for (let index = 1; index < arrow.path.length; index += 1) {
      const previous = arrow.path[index - 1];
      const current = arrow.path[index];
      if (
        !previous ||
        !current ||
        !headingForPath([previous, current], level.gridSize)
      ) {
        errors.push(
          `Arrow ${arrow.id} has non-adjacent path cells at link ${index}.`,
        );
        continue;
      }
      const key = linkKey(previous, current);
      const owners = links.get(key) ?? [];
      if (owners.includes(arrow.id)) {
        errors.push(`Arrow ${arrow.id} overlaps its own link ${key}.`);
      }
      for (const owner of owners) {
        const sharedOwner = level.arrows.find(
          (candidate) => candidate.id === owner,
        );
        const segment = sharedOwner
          ? sharedDirectedSegment(sharedOwner, arrow)
          : undefined;
        const directed = `${cellKey(previous)}>${cellKey(current)}`;
        if (!segment?.links.has(directed)) {
          errors.push(
            `Arrow ${arrow.id} overlaps link ${key} already used by ${owner}.`,
          );
        }
      }
      links.set(key, [...owners, arrow.id]);
    }
    for (const endpoint of arrow.kind === "double"
      ? (["head", "tail"] as const)
      : (["head"] as const)) {
      const selfError = selfContactError(arrow, level, endpoint);
      if (selfError) {
        errors.push(selfError);
      }
    }
  }
  const stopCells = new Set<string>();
  const arrowCells = new Set(
    level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
  );
  for (const stop of level.stops ?? []) {
    const key = cellKey(stop);
    if (!inBounds(stop, level.gridSize)) {
      errors.push(`Stop circle ${key} is out of bounds.`);
    }
    if (stopCells.has(key)) {
      errors.push(`Stop circle ${key} is declared more than once.`);
    }
    stopCells.add(key);
    if (arrowCells.has(key)) {
      errors.push(`Stop circle ${key} sits on an arrow's starting cell.`);
    }
  }

  const checkedGroups = new Set<string>();
  for (const arrow of level.arrows) {
    const group = overlappingArrowIds(level, arrow.id);
    if (group.length < 2) continue;
    const groupKey = [...group].sort().join("|");
    if (checkedGroups.has(groupKey)) continue;
    checkedGroups.add(groupKey);
    if (group.length > 3) {
      errors.push(`Shared-tail group ${groupKey} has more than three arrows.`);
    }
    const members = level.arrows.filter((candidate) =>
      group.includes(candidate.id),
    );
    if (members.some((member) => member.kind === "double")) {
      errors.push(
        `Shared-tail group ${groupKey} cannot contain double-ended arrows.`,
      );
    }
    for (let firstIndex = 0; firstIndex < members.length; firstIndex += 1) {
      const first = members[firstIndex];
      if (!first) continue;
      for (const second of members.slice(firstIndex + 1)) {
        const firstRoute = simulateMove(level, [first.id], first.id);
        const secondRoute = simulateMove(level, [second.id], second.id);
        const firstTravel = firstRoute.route.map(cellKey);
        const secondTravel = secondRoute.route.map(cellKey);
        const secondBody = second.path.map(cellKey);
        const firstBody = first.path.map(cellKey);
        if (
          firstTravel.some((key) => secondBody.includes(key)) ||
          secondTravel.some((key) => firstBody.includes(key)) ||
          firstTravel.some((key) => secondTravel.includes(key))
        ) {
          errors.push(
            `Shared-tail group ${groupKey} has crossing or contacting travel paths.`,
          );
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Drive one arrow from its settled position to an exit, parking on every stop
 * circle along the way. Undefined means some leg of that drive was blocked.
 */
function driveThrough(
  level: LevelDefinition,
  state: GameState,
  arrowId: string,
): { readonly state: GameState; readonly taps: readonly string[] } | undefined {
  const maximumTaps = level.gridSize * 6 + 2;
  const taps: string[] = [];
  let current = state;
  for (let tap = 0; tap < maximumTaps; tap += 1) {
    const result = simulateState(level, current, arrowId);
    if (result.kind !== "exit" && result.kind !== "paused") return undefined;
    const next = applyMove(level, current, result);
    if (next === current) return undefined;
    taps.push(arrowId);
    current = next;
    if (result.kind === "exit") return { state: current, taps };
  }
  return undefined;
}

/**
 * Remove every arrow that can currently reach its exit. Removing an arrow only
 * ever frees cells, so clearing greedily can never strand another arrow and
 * needs no backtracking.
 */
function clearWhatExits(
  level: LevelDefinition,
  state: GameState,
): { readonly state: GameState; readonly taps: readonly string[] } {
  const taps: string[] = [];
  let current = state;
  for (let pass = 0; pass <= level.arrows.length; pass += 1) {
    const before = current.remainingIds.length;
    for (const arrowId of [...current.remainingIds]) {
      if (!current.remainingIds.includes(arrowId)) continue;
      const cleared = driveThrough(level, current, arrowId);
      if (!cleared) continue;
      current = cleared.state;
      taps.push(...cleared.taps);
    }
    if (current.remainingIds.length === before) break;
  }
  return { state: current, taps };
}

function solveKey(state: GameState): string {
  const parked = Object.entries(state.offsets)
    .filter(([, value]) => value > 0)
    .map(([id, value]) => `${id}@${value}`)
    .sort()
    .join(",");
  return `${[...state.remainingIds].sort().join("|")}#${parked}`;
}

const SOLVER_NODE_BUDGET = 4000;

/**
 * Parking an arrow on a stop circle occupies new cells, so unlike clearing it
 * can strand other arrows and has to be explored with backtracking. Reverse
 * construction gives generated levels a drive-through certificate, so they
 * finish in the greedy pass and never reach this search.
 */
function searchSolution(
  level: LevelDefinition,
  state: GameState,
  visited: Set<string>,
  budget: { remaining: number },
): readonly string[] | undefined {
  const cleared = clearWhatExits(level, state);
  if (cleared.state.remainingIds.length === 0) return cleared.taps;
  const key = solveKey(cleared.state);
  if (visited.has(key)) return undefined;
  visited.add(key);
  for (const arrowId of cleared.state.remainingIds) {
    if (budget.remaining <= 0) return undefined;
    budget.remaining -= 1;
    const result = simulateState(level, cleared.state, arrowId);
    if (result.kind !== "paused") continue;
    const parked = applyMove(level, cleared.state, result);
    if (parked === cleared.state) continue;
    const rest = searchSolution(level, parked, visited, budget);
    if (rest) return [...cleared.taps, arrowId, ...rest];
  }
  return undefined;
}

/**
 * Replay a deterministic no-mistake solution under the same simulation used by
 * the game. The result lists taps in order, so an arrow that parks on a stop
 * circle appears once per leg. Undefined means no legal full-clear sequence was
 * found.
 */
export function solveLevel(
  level: LevelDefinition,
): readonly string[] | undefined {
  if (!validateLevel(level).valid) {
    return undefined;
  }
  return searchSolution(level, createGameState(level), new Set(), {
    remaining: SOLVER_NODE_BUDGET,
  });
}
