import { advanceHead, simulateMove } from "./movement";
import { cellKey, headingForPath, linkKey, seamTransition } from "./topology";
import { overlappingArrowIds, sharedDirectedSegment } from "./overlap";
import type { ArrowDefinition, Cell, Endpoint, LevelDefinition } from "./types";

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
 * Replay a deterministic no-mistake solution under the same simulation used by
 * the game. Undefined means no legal full-clear sequence was found.
 */
export function solveLevel(
  level: LevelDefinition,
): readonly string[] | undefined {
  if (!validateLevel(level).valid) {
    return undefined;
  }
  const remainingIds = level.arrows.map((arrow) => arrow.id);
  const solution: string[] = [];
  while (remainingIds.length > 0) {
    const clearId = remainingIds.find(
      (arrowId) => simulateMove(level, remainingIds, arrowId).kind === "exit",
    );
    if (!clearId) {
      return undefined;
    }
    const cleared = simulateMove(level, remainingIds, clearId);
    const clearedIds = cleared.members?.map((member) => member.arrowId) ?? [
      clearId,
    ];
    solution.push(clearId);
    for (const id of clearedIds) {
      const index = remainingIds.indexOf(id);
      if (index >= 0) remainingIds.splice(index, 1);
    }
  }
  return solution;
}
