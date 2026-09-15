import { simulateMove } from "./movement";
import {
  cellKey,
  forwardInfo,
  headingForPath,
  linkKey,
  seamTransition,
} from "./topology";
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
  for (let step = 1; step <= level.gridSize; step += 1) {
    const forward = forwardInfo(head, heading, level.gridSize);
    if (forward.exits) {
      return undefined;
    }
    const next = forward.next;
    if (!next) {
      return `Arrow ${arrow.id} has an incomplete topology step.`;
    }
    // The tail has already advanced `step` links, so its vacated cells are safe.
    if (path.slice(step).some((cell) => cellKey(cell) === cellKey(next))) {
      return `Arrow ${arrow.id} can contact its own body from its ${endpoint} endpoint.`;
    }
    head = next;
  }
  return `Arrow ${arrow.id} did not reach an ordinary cube exit.`;
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
  const cells = new Map<string, string>();
  const links = new Map<string, string>();
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
      const owner = cells.get(key);
      if (owner) {
        errors.push(
          `Arrow ${arrow.id} overlaps cell ${key} already used by ${owner}.`,
        );
      } else {
        cells.set(key, arrow.id);
      }
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
      const owner = links.get(key);
      if (owner) {
        errors.push(
          `Arrow ${arrow.id} overlaps link ${key} already used by ${owner}.`,
        );
      } else {
        links.set(key, arrow.id);
      }
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
    solution.push(clearId);
    remainingIds.splice(remainingIds.indexOf(clearId), 1);
  }
  return solution;
}
