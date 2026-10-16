import { cellKey, HEADINGS, stepSurface } from "../core/topology";
import type { Cell, FaceId, LevelDefinition } from "../core/types";
import type { Rng } from "./procedural";

/** Grow a seeded self-avoiding surface walk backwards from its head. */
export function growMechanicBody(
  level: LevelDefinition,
  rng: Rng,
  path: Cell[],
  forbidden: ReadonlySet<string>,
  length: number,
): Cell[] {
  const seen = new Set(path.map(cellKey));
  while (path.length < length) {
    const choices = HEADINGS.map((h) =>
      stepSurface(path[0]!, h, level.gridSize),
    ).filter((c) => !seen.has(cellKey(c)) && !forbidden.has(cellKey(c)));
    if (!choices.length) break;
    const cell = rng.pick(choices);
    path.unshift(cell);
    seen.add(cellKey(cell));
  }
  return path;
}

const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;
const FACE_INDEX: Readonly<Record<FaceId, number>> = {
  front: 0,
  back: 1,
  left: 2,
  right: 3,
  top: 4,
  bottom: 5,
};

interface SurfaceGraph {
  readonly cells: readonly Cell[];
  readonly indices: ReadonlyMap<string, number>;
  readonly neighbors: Uint32Array;
}

// Only immutable topology is shared. Reservations, obstacles, parents and the
// queue remain local to each search, including searches on the same grid.
const SURFACE_GRAPHS = new Map<number, SurfaceGraph>();

function surfaceIndex(cell: Cell, gridSize: number): number {
  return (FACE_INDEX[cell.face] * gridSize + cell.y) * gridSize + cell.x;
}

function surfaceGraph(gridSize: number): SurfaceGraph {
  const cached = SURFACE_GRAPHS.get(gridSize);
  if (cached) return cached;
  const cells: Cell[] = [];
  const indices = new Map<string, number>();
  for (const face of FACES) {
    for (let y = 0; y < gridSize; y += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        const cell = { face, x, y };
        indices.set(cellKey(cell), cells.length);
        cells.push(cell);
      }
    }
  }
  const neighbors = new Uint32Array(cells.length * HEADINGS.length);
  for (const [index, cell] of cells.entries()) {
    for (const [headingIndex, heading] of HEADINGS.entries()) {
      neighbors[index * HEADINGS.length + headingIndex] = surfaceIndex(
        stepSurface(cell, heading, gridSize),
        gridSize,
      );
    }
  }
  const graph = { cells, indices, neighbors };
  SURFACE_GRAPHS.set(gridSize, graph);
  return graph;
}

/** Connect a lane contact to a chosen neck on the surface, with seeded detours. */
export function connectMechanicBody(
  level: LevelDefinition,
  rng: Rng,
  start: Cell,
  goal: Cell,
  forbidden: ReadonlySet<string>,
): Cell[] | undefined {
  const graph = surfaceGraph(level.gridSize);
  const startIndex = graph.indices.get(cellKey(start));
  const goalIndex = graph.indices.get(cellKey(goal));
  if (startIndex === undefined || goalIndex === undefined) return undefined;
  const queue = new Uint32Array(graph.cells.length);
  queue[0] = startIndex;
  let queued = 1;
  const parents = new Int32Array(graph.cells.length).fill(-2);
  parents[startIndex] = -1;
  // Bit 1 is an earlier reservation; bit 2 is this search's sampled obstacle.
  const blocked = new Uint8Array(graph.cells.length);
  for (const key of forbidden) {
    const index = graph.indices.get(key);
    if (index !== undefined) blocked[index] = 1;
  }
  // A different sparse obstacle field each time changes the route itself,
  // rather than transforming a completed gadget.
  for (let i = 0; i < level.gridSize * level.gridSize; i += 1) {
    if (rng.next() < 0.6) {
      const index = surfaceIndex(
        {
          face: rng.pick(FACES),
          x: rng.int(level.gridSize),
          y: rng.int(level.gridSize),
        },
        level.gridSize,
      );
      blocked[index] = (blocked[index] ?? 0) | 2;
    }
  }
  for (let cursor = 0; cursor < queued; cursor += 1) {
    const cell = queue[cursor]!;
    if (cell === goalIndex) {
      const path: number[] = [];
      for (let current = cell; current >= 0; current = parents[current]!)
        path.push(current);
      if (path.length > 30) return undefined;
      return path
        .reverse()
        .map((index) =>
          index === startIndex ? start : { ...graph.cells[index]! },
        );
    }
    const offset = rng.int(4);
    for (let h = 0; h < 4; h += 1) {
      const next = graph.neighbors[cell * 4 + ((h + offset) % 4)]!;
      const mask = blocked[next] ?? 0;
      if (
        parents[next] !== -2 ||
        (mask & 1) !== 0 ||
        (next !== goalIndex && (mask & 2) !== 0)
      )
        continue;
      parents[next] = cell;
      queue[queued] = next;
      queued += 1;
    }
  }
  return undefined;
}
