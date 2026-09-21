import { advanceHead, simulateMove } from "../core/movement";
import { overlappingArrowIds } from "../core/overlap";
import { arrowTrack } from "../core/stops";
import {
  cellKey,
  forwardInfo,
  headingForPath,
  oppositeHeading,
  seamTransition,
  stepSurface,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  DirectionalSpotDefinition,
  EdgePolicyDefinition,
  FaceId,
  Heading,
  LevelDefinition,
} from "../core/types";
import { solveLevel, validateLevel } from "../core/validation";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "./intro";
import { DIRECTIONAL_INTRO_LEVEL } from "./directional-intro";
import { OVERLAP_INTRO_LEVEL } from "./overlap-intro";
import { STOP_INTRO_LEVEL } from "./stop-intro";

export const GENERATOR_VERSION = 5;
export const MAX_LEVEL_ID = Number.MAX_SAFE_INTEGER - 1;

const FACES: readonly FaceId[] = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
];
const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];

export interface LevelConfig {
  readonly gridSize: number;
  readonly arrowCount: number;
  readonly lives: number;
  readonly arrowScale: number;
}

/** The stable, inspectable input to the seeded layout generator. */
export function seedForLevel(id: number): string {
  assertLevelId(id);
  if (id === 5) return "par-arrows:runtime:4:level:5:stop-intro:1";
  if (id === 11) return "par-arrows:runtime:2:level:11:wrap-intro:1";
  if (id <= 4) return `par-arrows:runtime:1:level:${id}`;
  if (id === 15) return "par-arrows:runtime:3:level:15:overlap-intro:1";
  // Cubes this release leaves byte-identical keep their v4 seed strings so
  // existing saves still match metadata and resume instead of refreshing.
  if (id === 20) return "par-arrows:runtime:4:level:20:directional-intro:1";
  if (id <= 10) return `par-arrows:runtime:4:level:${id}`;
  return `par-arrows:runtime:${GENERATOR_VERSION}:level:${id}`;
}

/**
 * Stop-circle counts per level, drawn from the same weighted shape as wrapping
 * edges. Level 5 authors its own single circle, level 6 always carries one so
 * the lesson repeats immediately, and the authored teaching cubes stay focused
 * on their own mechanic.
 */
export function getStopCountWeights(
  id: number,
): readonly [number, number, number, number] {
  assertLevelId(id);
  if (id <= 4 || id === 11 || id === 15 || id === 20) return [1, 0, 0, 0];
  if (id === 5 || id === 6) return [0, 1, 0, 0];
  const progress = Math.min(1, (id - 6) / 94);
  return [
    0.2,
    0.5 - 0.2 * progress,
    0.2 + 0.1 * progress,
    0.1 + 0.1 * progress,
  ];
}

/** Circle selection has its own seeded stream, independent of layout retries. */
export function getStopCount(id: number): number {
  const weights = getStopCountWeights(id);
  const roll = new Rng(hashSeed(`${seedForLevel(id)}:stops`)).next();
  let count = 0;
  let threshold = weights[0] as number;
  while (count < 3 && roll >= threshold) {
    count += 1;
    threshold += weights[count] ?? 0;
  }
  return count;
}

export function getWrappingEdgeWeights(
  id: number,
): readonly [number, number, number, number] {
  assertLevelId(id);
  if (id <= 10) return [1, 0, 0, 0];
  if (id === 11) return [0, 1, 0, 0];
  if (id === 15 || id === 20) return [1, 0, 0, 0];
  const progress = Math.min(1, (id - 11) / 89);
  return [
    0.25,
    0.6 - 0.45 * progress,
    0.12 + 0.18 * progress,
    0.03 + 0.27 * progress,
  ];
}

/** Edge selection has its own seeded stream, independent of layout retries. */
export function getWrappingEdgePolicies(
  id: number,
): readonly EdgePolicyDefinition[] {
  if (id === 11) return WRAP_INTRO_LEVEL.edgePolicies ?? [];
  if (id === 15 || id === 20) return [];
  const weights = getWrappingEdgeWeights(id);
  if (id <= 10) return [];
  const rng = new Rng(hashSeed(`${seedForLevel(id)}:edges`));
  const roll = rng.next();
  let count = 0;
  let threshold = weights[0];
  while (count < 3 && roll >= threshold) {
    count += 1;
    threshold += weights[count] ?? 0;
  }
  if (count === 0) return [];

  const physicalEdges: EdgePolicyDefinition[][] = [];
  const seen = new Set<string>();
  for (const face of FACES) {
    for (const edge of HEADINGS) {
      const boundary: Cell = {
        face,
        x: edge === "east" ? 2 : edge === "west" ? 0 : 1,
        y: edge === "south" ? 2 : edge === "north" ? 0 : 1,
      };
      const next = seamTransition(boundary, edge, 3);
      const key = [face, next.cell.face].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      physicalEdges.push([
        {
          face,
          edge,
          policy: "continue",
          neighbor: { face: next.cell.face, entering: next.heading },
        },
        {
          face: next.cell.face,
          edge: oppositeHeading(next.heading),
          policy: "continue",
          neighbor: { face, entering: oppositeHeading(edge) },
        },
      ]);
    }
  }
  for (let index = physicalEdges.length - 1; index > 0; index -= 1) {
    const replacement = rng.int(index + 1);
    const current = physicalEdges[index] as EdgePolicyDefinition[];
    physicalEdges[index] = physicalEdges[replacement] as EdgePolicyDefinition[];
    physicalEdges[replacement] = current;
  }
  return physicalEdges.slice(0, count).flat();
}

export function getLevelConfig(id: number): LevelConfig {
  assertLevelId(id);
  if (id === 1 || id === 5 || id === 11 || id === 15 || id === 20) {
    return { gridSize: 4, arrowCount: 6, lives: 5, arrowScale: 1 };
  }
  const early = [0, 60, 84, 108, 132, 156, 168, 180, 180, 180];
  const earlyGrid = [0, 12, 13, 15, 16, 18, 18, 20, 21, 22];
  const index = id - 1;
  const arrowCount =
    id <= 10
      ? (early[index] ?? 180)
      : Math.min(264, 180 + Math.floor((id - 10) / 2) * 6);
  const gridSize =
    id <= 10
      ? (earlyGrid[index] ?? 22)
      : Math.min(26, 22 + Math.floor((id - 10) / 4));
  return {
    gridSize,
    arrowCount,
    lives: id <= 3 ? 5 : id <= 6 ? 4 : 3,
    arrowScale: gridSize / (id <= 3 ? 8 : id <= 6 ? 10 : 14),
  };
}

class Rng {
  constructor(private state: number) {}

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }

  int(limit: number): number {
    return Math.floor(this.next() * limit);
  }

  pick<T>(items: readonly T[]): T {
    const value = items[this.int(items.length)];
    if (value === undefined) throw new Error("Cannot pick from an empty list.");
    return value;
  }
}

function assertLevelId(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_LEVEL_ID) {
    throw new RangeError(
      `Level id must be a safe integer from 1 through ${MAX_LEVEL_ID}.`,
    );
  }
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash || 1;
}

/**
 * Core-placement stream for one construction attempt. Attempt 0 hashes the
 * plain stream name so every id that constructs first try keeps its exact
 * historical layout; later attempts salt the stream, because a deterministic
 * core that fails its certificate replay would otherwise fail identically on
 * every restart and make the whole id unconstructible.
 */
function coreStream(id: number, name: string, restart: number): Rng {
  const suffix = restart > 0 ? `:retry-${restart}` : "";
  return new Rng(hashSeed(`${seedForLevel(id)}:${name}${suffix}`));
}

function exitRay(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies">,
  head: Cell,
  heading: Heading,
): readonly Cell[] {
  const ray: Cell[] = [];
  let current = head;
  for (let step = 0; step <= level.gridSize * 4; step += 1) {
    ray.push(current);
    const forward = advanceHead(level, current, heading);
    if (forward.exits) return ray;
    if (!forward.next) return [];
    current = forward.next;
    heading = forward.heading;
  }
  return [];
}

function targetLength(rng: Rng, id: number, config: LevelConfig): number {
  const floor = id <= 3 ? 6 : 8;
  const ceiling = Math.min(
    40,
    Math.max(floor + 2, Math.floor(config.gridSize * 1.65)),
  );
  const weighted =
    floor + Math.floor(rng.next() * rng.next() * (ceiling - floor + 1));
  return Math.max(2, weighted);
}

function straightCandidate(
  rng: Rng,
  size: number,
  face: FaceId,
  heading: Heading,
  length: number,
  occupied: ReadonlySet<string>,
): readonly Cell[] | undefined {
  const lane = rng.int(size);
  const path: readonly Cell[] =
    heading === "east"
      ? Array.from({ length }, (_, index) => ({
          face,
          x: size - length + index,
          y: lane,
        }))
      : heading === "west"
        ? Array.from({ length }, (_, index) => ({
            face,
            x: length - 1 - index,
            y: lane,
          }))
        : heading === "south"
          ? Array.from({ length }, (_, index) => ({
              face,
              x: lane,
              y: size - length + index,
            }))
          : Array.from({ length }, (_, index) => ({
              face,
              x: lane,
              y: length - 1 - index,
            }));
  return path.some((cell) => occupied.has(cellKey(cell))) ? undefined : path;
}

function shuffledFaces(rng: Rng): readonly FaceId[] {
  const faces = [...FACES];
  for (let index = faces.length - 1; index > 0; index -= 1) {
    const replacement = rng.int(index + 1);
    const current = faces[index];
    faces[index] = faces[replacement] as FaceId;
    faces[replacement] = current as FaceId;
  }
  return faces;
}

function candidate(
  rng: Rng,
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies">,
  occupied: ReadonlySet<string>,
  length: number,
  rayExempt?: ReadonlySet<string>,
): readonly Cell[] | undefined {
  const size = level.gridSize;
  const head: Cell = {
    face: rng.pick(FACES),
    x: rng.int(size),
    y: rng.int(size),
  };
  const heading = rng.pick(HEADINGS);
  const ray = exitRay(level, head, heading);
  if (
    ray.length === 0 ||
    ray.some(
      (cell) => occupied.has(cellKey(cell)) && !rayExempt?.has(cellKey(cell)),
    )
  )
    return undefined;

  const used = new Set<string>(occupied);
  for (const cell of ray) used.add(cellKey(cell));
  const backwards: Cell[] = [head];
  let current = head;
  let previousHeading = oppositeHeading(heading);
  for (let step = 1; step < length; step += 1) {
    const allowed =
      step === 1
        ? [previousHeading]
        : HEADINGS.filter((next) => next !== oppositeHeading(previousHeading));
    const options = allowed
      .map((next) => ({
        heading: next,
        cell: stepSurface(current, next, size),
      }))
      .filter(({ cell }) => !used.has(cellKey(cell)));
    if (options.length === 0) break;
    const seams = options.filter(({ cell }) => cell.face !== current.face);
    const turn = options.filter(
      ({ heading: next }) => next !== previousHeading,
    );
    const pool =
      seams.length > 0 && rng.next() < 0.38
        ? seams
        : turn.length > 0 && rng.next() < 0.7
          ? turn
          : options;
    const choice = rng.pick(pool);
    backwards.push(choice.cell);
    used.add(cellKey(choice.cell));
    current = choice.cell;
    previousHeading = choice.heading;
  }
  return backwards.length >= 2 ? backwards.reverse() : undefined;
}

/**
 * One leg of a group member's surface walk. Fixed legs step a set number of
 * cells; seam legs walk forward until the walk crosses a cube seam and then
 * continue a few cells on the new face. `toNearestEdge` aims the leg across
 * the closer perpendicular edge, which is what lets a member wrap onto a
 * third face from any seeded start.
 */
type OverlapSegment =
  | { readonly heading: Heading; readonly steps: number }
  | {
      readonly heading: Heading;
      readonly untilSeam: true;
      readonly extra: number;
      readonly maxToSeam: number;
      readonly toNearestEdge?: boolean;
    };

interface OverlapPattern {
  readonly name: string;
  /** Seed the start near the leading edge so seam legs cross promptly. */
  readonly lead: boolean;
  readonly members: readonly (readonly OverlapSegment[])[];
}

const HEADING_CYCLE: readonly Heading[] = ["east", "south", "west", "north"];

function rotateHeading(heading: Heading, quarterTurns: number): Heading {
  const index = HEADING_CYCLE.indexOf(heading);
  return HEADING_CYCLE[
    (index + quarterTurns) % HEADING_CYCLE.length
  ] as Heading;
}

/**
 * Shared-tail group shapes. Every member starts on the same cell heading the
 * same way, so pairwise overlaps are always common prefixes; patterns differ
 * in where members peel off and how far their own portions run. "seam"
 * members cross one cube seam, "wrap" members cross two and park their heads
 * on a third face, "staggered" members peel at different points, and "lanes"
 * members run long parallel bodies far from the shared tail.
 */
const PAIR_PATTERNS: readonly OverlapPattern[] = [
  {
    name: "classic",
    lead: false,
    members: [
      [
        { heading: "east", steps: 1 },
        { heading: "north", steps: 1 },
        { heading: "east", steps: 1 },
      ],
      [
        { heading: "east", steps: 1 },
        { heading: "south", steps: 1 },
        { heading: "east", steps: 1 },
      ],
    ],
  },
  {
    name: "staggered",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 2 },
      ],
      [{ heading: "east", steps: 6 }],
    ],
  },
  {
    name: "lanes",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 1 },
        { heading: "east", steps: 4 },
      ],
      [
        { heading: "east", steps: 3 },
        { heading: "south", steps: 1 },
        { heading: "east", steps: 4 },
      ],
    ],
  },
  {
    name: "seam",
    lead: true,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 1 },
        { heading: "east", steps: 2 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "east", untilSeam: true, extra: 2, maxToSeam: 6 },
      ],
    ],
  },
  {
    name: "wrap",
    lead: true,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 1 },
        { heading: "east", steps: 2 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "east", untilSeam: true, extra: 0, maxToSeam: 6 },
        {
          heading: "east",
          untilSeam: true,
          extra: 2,
          maxToSeam: 20,
          toNearestEdge: true,
        },
      ],
    ],
  },
];

const TRIO_PATTERNS: readonly OverlapPattern[] = [
  {
    name: "classic",
    lead: false,
    members: [...PAIR_PATTERNS[0]!.members, [{ heading: "east", steps: 3 }]],
  },
  {
    name: "staggered",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 2 },
      ],
      [
        { heading: "east", steps: 3 },
        { heading: "south", steps: 2 },
      ],
      [{ heading: "east", steps: 6 }],
    ],
  },
  {
    name: "seam",
    lead: true,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 1 },
        { heading: "east", steps: 2 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 1 },
        { heading: "east", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "east", untilSeam: true, extra: 1, maxToSeam: 6 },
      ],
    ],
  },
  {
    name: "wrap",
    lead: true,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 1 },
        { heading: "east", steps: 2 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 1 },
        { heading: "east", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "east", untilSeam: true, extra: 0, maxToSeam: 6 },
        {
          heading: "east",
          untilSeam: true,
          extra: 2,
          maxToSeam: 20,
          toNearestEdge: true,
        },
      ],
    ],
  },
];

/** On-face steps before walking `heading` leaves `cell`'s face. */
function stepsToEdge(cell: Cell, heading: Heading, size: number): number {
  let steps = 0;
  let current = cell;
  while (steps <= size) {
    const forward = forwardInfo(current, heading, size);
    if (forward.exits || !forward.next) return steps;
    current = forward.next;
    steps += 1;
  }
  return steps;
}

/**
 * Walk one member's concrete path from `start`. Seam crossings re-derive the
 * continuation heading from the topology core, never by hand; a walk that
 * revisits any claimed cell rejects the attempt.
 */
function walkOverlapMember(
  start: Cell,
  segments: readonly OverlapSegment[],
  rotation: number,
  size: number,
): readonly Cell[] | undefined {
  const cells: Cell[] = [start];
  const seen = new Set([cellKey(start)]);
  let current = start;
  const advance = (heading: Heading): Heading | undefined => {
    const previous = current;
    const next = stepSurface(previous, heading, size);
    if (seen.has(cellKey(next))) return undefined;
    seen.add(cellKey(next));
    cells.push(next);
    current = next;
    return next.face === previous.face
      ? heading
      : seamTransition(previous, heading, size).heading;
  };
  for (const segment of segments) {
    let heading = rotateHeading(segment.heading, rotation);
    if ("steps" in segment) {
      for (let step = 0; step < segment.steps; step += 1) {
        const continued = advance(heading);
        if (continued === undefined) return undefined;
        heading = continued;
      }
    } else {
      let legHeading = heading;
      if (segment.toNearestEdge) {
        const perpendicular = HEADING_CYCLE.filter(
          (candidate) =>
            candidate !== legHeading &&
            candidate !== oppositeHeading(legHeading),
        );
        const [firstSide, secondSide] = perpendicular;
        if (!firstSide || !secondSide) return undefined;
        legHeading =
          stepsToEdge(current, firstSide, size) <
          stepsToEdge(current, secondSide, size)
            ? firstSide
            : secondSide;
      }
      let crossed = false;
      for (let step = 0; step <= segment.maxToSeam && !crossed; step += 1) {
        const before = current;
        const continued = advance(legHeading);
        if (continued === undefined) return undefined;
        crossed = current.face !== before.face;
        legHeading = continued;
      }
      if (!crossed) return undefined;
      for (let step = 0; step < segment.extra; step += 1) {
        const continued = advance(legHeading);
        if (continued === undefined) return undefined;
        legHeading = continued;
      }
    }
  }
  return cells;
}

/** A start cell sitting `back` cells inside the leading edge of `heading`. */
function edgeOffsetCell(
  face: FaceId,
  heading: Heading,
  back: number,
  lateral: number,
  size: number,
): Cell {
  switch (heading) {
    case "east":
      return { face, x: size - 1 - back, y: lateral };
    case "west":
      return { face, x: back, y: lateral };
    case "south":
      return { face, x: lateral, y: size - 1 - back };
    case "north":
      return { face, x: lateral, y: back };
  }
}

function overlapStarter(
  id: number,
  size: number,
  rng: Rng,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
): readonly ArrowDefinition[] | undefined {
  const trio = id % 3 === 0;
  const catalog = trio ? TRIO_PATTERNS : PAIR_PATTERNS;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const pattern = rng.pick(catalog);
    const rotation = rng.int(HEADING_CYCLE.length);
    const face = rng.pick(shuffledFaces(rng));
    const leadIn = pattern.lead
      ? 2 + rng.int(3)
      : 9 + rng.int(Math.max(1, size - 18));
    const lateral = 4 + rng.int(Math.max(1, size - 9));
    const firstHeading = pattern.members[0]?.[0]?.heading;
    if (!firstHeading) continue;
    const start = edgeOffsetCell(
      face,
      rotateHeading(firstHeading, rotation),
      leadIn,
      lateral,
      size,
    );
    const paths = pattern.members.map((segments) =>
      walkOverlapMember(start, segments, rotation, size),
    );
    if (paths.some((path) => !path)) continue;
    const concrete = paths.filter((path): path is readonly Cell[] => !!path);
    if (concrete.length !== pattern.members.length) continue;
    if (concrete.some((path) => path.length > 40)) continue;
    const heads = new Set(
      concrete.map((path) => cellKey(path[path.length - 1]!)),
    );
    if (heads.size !== concrete.length) continue;
    if (
      concrete.some((path) => path.some((cell) => occupied.has(cellKey(cell))))
    )
      continue;
    // Cells shared between two members must be exactly their common prefix.
    let prefixesClean = true;
    for (let first = 0; first < concrete.length && prefixesClean; first += 1) {
      const left = concrete[first]!;
      for (let second = first + 1; second < concrete.length; second += 1) {
        const right = concrete[second]!;
        let prefix = 0;
        while (
          prefix < left.length &&
          prefix < right.length &&
          cellKey(left[prefix]!) === cellKey(right[prefix]!)
        ) {
          prefix += 1;
        }
        const shared = left.filter((cell) =>
          right.some((other) => cellKey(other) === cellKey(cell)),
        ).length;
        if (shared !== prefix) {
          prefixesClean = false;
          break;
        }
      }
    }
    if (!prefixesClean) continue;
    const arrows = concrete.map((path, index) => ({
      id: `r${id}-overlap-${index}`,
      path,
    }));
    const groupCells = new Set(
      arrows.flatMap((arrow) => arrow.path.map(cellKey)),
    );
    // Members' solo future routes must stay clear of sibling bodies and of
    // each other — the same contract validateLevel enforces, checked here so
    // a doomed shape retries locally instead of restarting the whole cube.
    const routes = arrows.map((arrow) =>
      simulateMove({ ...level, arrows }, [arrow.id], arrow.id),
    );
    if (routes.some((route) => route.kind !== "exit")) continue;
    let routesClean = true;
    for (let first = 0; first < arrows.length && routesClean; first += 1) {
      const left = arrows[first]!;
      const leftRoute = routes[first]!;
      for (let second = first + 1; second < arrows.length; second += 1) {
        const right = arrows[second]!;
        const rightRoute = routes[second]!;
        const leftKeys = new Set(leftRoute.route.map(cellKey));
        const rightKeys = new Set(rightRoute.route.map(cellKey));
        if (
          leftRoute.route.some((cell) =>
            right.path.some((other) => cellKey(other) === cellKey(cell)),
          ) ||
          rightRoute.route.some((cell) =>
            left.path.some((other) => cellKey(other) === cellKey(cell)),
          ) ||
          leftRoute.route.some((cell) => rightKeys.has(cellKey(cell)))
        ) {
          routesClean = false;
          break;
        }
      }
    }
    if (!routesClean) continue;
    const hasClearTrajectories = arrows.every((arrow) => {
      const head = arrow.path[arrow.path.length - 1];
      if (!head) return false;
      const heading = headingForPath(arrow.path, size);
      if (!heading) return false;
      const ray = exitRay(level, head, heading);
      return (
        ray.length > 0 &&
        ray.slice(1).every((cell) => !groupCells.has(cellKey(cell))) &&
        !ray.some((cell) => occupied.has(cellKey(cell)))
      );
    });
    if (!hasClearTrajectories) continue;
    return arrows;
  }
  return undefined;
}

/** Pattern-local offset resolved against a base cell and rotation. */
interface ParkDelta {
  readonly dx: number;
  readonly dy: number;
}

/**
 * Park-core deadlocks, relative to the parker's tail. Every pattern is a
 * closed cycle: with its circles stripped, each arrow's first route cell hits
 * another core arrow, so the cube provably needs parking; parking the parker
 * advances its tail off the next arrow's lane and the whole core unwinds in
 * the listed order. "classic" is the level-5 deadlock. "long" stretches the
 * same lanes. "cascade" adds a fourth arrow whose lane opens only after the
 * freed arrow leaves. "double" needs two parks: the blocker sits past the
 * second circle, so the parker's tail blocks the freed arrow's lane until
 * both parks are spent. A pattern is eligible only when the level's stop
 * budget covers its circles. `others` lists the non-parker arrows in reverse
 * unwinding order: the certificate tail drives arrows last-placed-first, so
 * the last listed arrow must be the one that moves immediately after the
 * park.
 */
const PARK_PATTERNS: readonly {
  readonly name: string;
  readonly parker: readonly ParkDelta[];
  readonly stops: readonly ParkDelta[];
  readonly others: readonly (readonly ParkDelta[])[];
}[] = [
  {
    name: "classic",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [{ dx: 2, dy: 0 }],
    others: [
      [
        { dx: 3, dy: 0 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
        { dx: 1, dy: 1 },
      ],
      [
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "long",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 2, dy: 0 },
    ],
    stops: [{ dx: 3, dy: 0 }],
    others: [
      [
        { dx: 5, dy: 0 },
        { dx: 5, dy: 1 },
        { dx: 4, dy: 1 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
        { dx: 1, dy: 1 },
      ],
      [
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "cascade",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [{ dx: 2, dy: 0 }],
    others: [
      [
        { dx: 4, dy: 0 },
        { dx: 4, dy: 1 },
        { dx: 3, dy: 1 },
      ],
      [
        { dx: 2, dy: 1 },
        { dx: 1, dy: 1 },
      ],
      [
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "double",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [
      { dx: 2, dy: 0 },
      { dx: 4, dy: 0 },
    ],
    others: [
      [
        { dx: 6, dy: 0 },
        { dx: 6, dy: 1 },
        { dx: 5, dy: 1 },
        { dx: 4, dy: 1 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
      ],
      [
        { dx: 1, dy: 2 },
        { dx: 1, dy: 1 },
      ],
    ],
  },
];

/** Ids for the non-parker core arrows, in pattern order. */
const PARK_FOLLOWER_IDS = ["park-b", "park-f", "park-g"] as const;

const PARK_CERTIFICATE_PREFIX = "park:";

interface ParkingCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly stops: readonly Cell[];
  readonly parkerId: string;
}

function patternCell(
  base: Cell,
  dx: number,
  dy: number,
  rotation: number,
): Cell {
  const turns = ((rotation % 4) + 4) % 4;
  const x =
    turns === 0
      ? base.x + dx
      : turns === 1
        ? base.x - dy
        : turns === 2
          ? base.x - dx
          : base.x + dy;
  const y =
    turns === 0
      ? base.y + dy
      : turns === 1
        ? base.y + dx
        : turns === 2
          ? base.y - dy
          : base.y - dx;
  return { face: base.face, x, y };
}

/**
 * Build a parking-required deadlock on its own seeded stream, independent of
 * layout retries. The stream first picks a catalog pattern whose circle count
 * fits the level's stop budget, then places it: pattern cells stay in bounds,
 * off occupied cells, and every arrow's exit ray must dodge occupied cells.
 * The core-only certificate — the park legs, then each arrow driven to exit in
 * reverse placement order — must replay through the real movement rules, so a
 * wrap or route crossing that would strand a core arrow rejects the placement
 * instead of failing the level's replay later. Undefined means no placement
 * fit and the level falls back to decorative circles only.
 */
function parkingCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  stopCount: number,
  restart: number,
): ParkingCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "park-core", restart);
  const eligible = PARK_PATTERNS.filter(
    (candidate) => candidate.stops.length <= stopCount,
  );
  const pattern = eligible[
    rng.int(eligible.length)
  ] as (typeof PARK_PATTERNS)[number];
  const faces = shuffledFaces(rng);
  const parkerId = `r${id}-park-p`;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const base: Cell = {
      face,
      x: 1 + rng.int(Math.max(1, size - 2)),
      y: 1 + rng.int(Math.max(1, size - 2)),
    };
    const parkerPath = pattern.parker.map(({ dx, dy }) =>
      patternCell(base, dx, dy, rotation),
    );
    const followerPaths = pattern.others.map((deltas) =>
      deltas.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
    );
    const stops = pattern.stops.map(({ dx, dy }) =>
      patternCell(base, dx, dy, rotation),
    );
    const cells = [...parkerPath, ...followerPaths.flat(), ...stops];
    const patternKeys = new Set(cells.map(cellKey));
    if (
      patternKeys.size !== cells.length ||
      cells.some(
        (cell) =>
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= size ||
          cell.y >= size ||
          occupied.has(cellKey(cell)),
      )
    )
      continue;
    const rayClear = (path: readonly Cell[]): boolean => {
      const head = path[path.length - 1];
      const heading = head ? headingForPath(path, size) : undefined;
      if (!head || !heading) return false;
      const ray = exitRay(level, head, heading);
      return (
        ray.length > 0 &&
        ray
          .slice(1)
          .every(
            (cell) =>
              patternKeys.has(cellKey(cell)) || !occupied.has(cellKey(cell)),
          )
      );
    };
    const arrows: ArrowDefinition[] = [
      { id: parkerId, path: parkerPath },
      ...followerPaths.map((path, index) => ({
        id: `r${id}-${PARK_FOLLOWER_IDS[index]}`,
        path,
      })),
    ];
    if (!arrows.every((arrow) => rayClear(arrow.path))) continue;
    // The core drives last in the level's certificate, against an otherwise
    // empty cube with the park legs already applied; prove that tail here so
    // a hostile wrap config rejects this placement instead of the level.
    const coreLevel: LevelDefinition = { ...level, arrows, stops };
    const certificate = [
      ...stops.map(() => `${PARK_CERTIFICATE_PREFIX}${parkerId}`),
      ...[...arrows].reverse().map((arrow) => arrow.id),
    ];
    if (!replayCertificate(coreLevel, certificate)) continue;
    return { arrows, stops, parkerId };
  }
  return undefined;
}

const HEADING_VECTORS: Record<
  Heading,
  { readonly dx: number; readonly dy: number }
> = {
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
  south: { dx: 0, dy: 1 },
  north: { dx: 0, dy: -1 },
};

const PERPENDICULAR: Record<Heading, readonly [Heading, Heading]> = {
  east: ["north", "south"],
  west: ["north", "south"],
  north: ["east", "west"],
  south: ["east", "west"],
};

/** First generated level that can embed the required directional core. */
const FIRST_DIRECTIONAL_LEVEL = 21;

/**
 * How many faces of a generated cube carry directional spots: the authored
 * intro carries exactly one spot-bearing face; from the level after it, every
 * cube draws zero through four on its own seeded stream (uniform), so the
 * split is stable across sessions. Levels with any spots never carry overlap
 * groups — the two mechanics never share a cube.
 */
export function directionalFaceCount(id: number): number {
  if (id === DIRECTIONAL_INTRO_LEVEL.id) return 1;
  if (id < FIRST_DIRECTIONAL_LEVEL) return 0;
  const roll = new Rng(hashSeed(`${seedForLevel(id)}:dir-plan`)).next();
  return Math.min(4, Math.floor(roll * 5));
}

/**
 * Spots requested per spot-bearing face, one entry per face in the order the
 * faces are drawn from the `:dir-faces` stream: one through four each.
 */
export function directionalFacePlan(id: number): readonly number[] {
  const faces = directionalFaceCount(id);
  if (faces === 0) return [];
  const rng = new Rng(hashSeed(`${seedForLevel(id)}:dir-counts`));
  return Array.from({ length: faces }, () => 1 + rng.int(4));
}

/** Whether a level carries any directional spot (and so its required core). */
export function hasDirectionalCore(id: number): boolean {
  return directionalFaceCount(id) > 0;
}

interface DirectionalCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly spot: DirectionalSpotDefinition;
}

/**
 * Build a head-on deadlock that only a directional spot can break, on its own
 * seeded stream. Two arrows face each other across the spot cell with a
 * perpendicular exit corridor behind it: without the spot each arrow's track
 * runs into the other's head cell, so neither can ever move; with it, each
 * bends into the corridor and leaves. The corridor must exit and stay clear of
 * everything placed before the core; everything placed after rejects these
 * cells, which keeps the certificate replay infallible. Undefined means no
 * placement fit and the level falls back to a layout without directionals.
 */
function directionalCore(
  id: number,
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies">,
  occupied: ReadonlySet<string>,
  preferredFace?: FaceId,
  parkTracks?: ReadonlySet<string>,
  restart = 0,
): DirectionalCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "dir-core", restart);
  const shuffled = shuffledFaces(rng);
  const faces = preferredFace
    ? [preferredFace, ...shuffled.filter((face) => face !== preferredFace)]
    : shuffled;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const lane = HEADINGS[rng.int(HEADINGS.length)] as Heading;
    const turn = PERPENDICULAR[lane][rng.int(2)] as Heading;
    const vector = HEADING_VECTORS[lane];
    const spotCell: Cell = {
      face,
      x: 2 + rng.int(Math.max(1, size - 4)),
      y: 2 + rng.int(Math.max(1, size - 4)),
    };
    const approachingPath: readonly Cell[] = [
      {
        face,
        x: spotCell.x - 2 * vector.dx,
        y: spotCell.y - 2 * vector.dy,
      },
      { face, x: spotCell.x - vector.dx, y: spotCell.y - vector.dy },
    ];
    const opposingPath: readonly Cell[] = [
      {
        face,
        x: spotCell.x + 2 * vector.dx,
        y: spotCell.y + 2 * vector.dy,
      },
      { face, x: spotCell.x + vector.dx, y: spotCell.y + vector.dy },
    ];
    const cells = [...approachingPath, ...opposingPath, spotCell];
    const patternKeys = new Set(cells.map(cellKey));
    const taken = (cell: Cell): boolean =>
      occupied.has(cellKey(cell)) || (parkTracks?.has(cellKey(cell)) ?? false);
    if (
      patternKeys.size !== cells.length ||
      cells.some(
        (cell) =>
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= size ||
          cell.y >= size ||
          taken(cell),
      )
    )
      continue;
    const corridor = exitRay(level, spotCell, turn).slice(1);
    if (
      corridor.length === 0 ||
      corridor.some(
        (cell) =>
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= size ||
          cell.y >= size ||
          patternKeys.has(cellKey(cell)) ||
          taken(cell),
      )
    )
      continue;
    return {
      arrows: [
        { id: `r${id}-dir-a`, path: approachingPath },
        { id: `r${id}-dir-b`, path: opposingPath },
      ],
      spot: { cell: spotCell, heading: turn },
    };
  }
  return undefined;
}

interface ExtraSpotPlanEntry {
  readonly face: FaceId;
  readonly count: number;
}

/**
 * Extra spots beyond the required core, best-effort. Candidates come from the
 * cells each arrow's head actually travels on a planned face — walked on the
 * post-core tracks, so the core's bends already count — minus every reserved
 * cell and the parking core's own routes, which must keep their straight
 * replay. Each spot turns traversers perpendicular to their travel, mirroring
 * the core. A candidate is only placed if every traverser, simulated alone
 * with the candidate in place, still exits cleanly and its bent route avoids
 * every arrow that replays before it and the parking core's tracks; the
 * certificate replay below remains the final arbiter.
 */
function extraDirectionalSpots(
  id: number,
  level: LevelDefinition,
  arrows: readonly ArrowDefinition[],
  occupied: Set<string>,
  plan: readonly ExtraSpotPlanEntry[],
  coreFace: FaceId | undefined,
): readonly DirectionalSpotDefinition[] {
  const parkTrackKeys = new Set<string>();
  for (const arrow of arrows) {
    if (!arrow.id.startsWith(`r${id}-park-`)) continue;
    for (const cell of arrowTrack(level, arrow)) {
      parkTrackKeys.add(cellKey(cell));
    }
  }
  const cellsBefore: Set<string>[] = [];
  let running = new Set<string>();
  for (const arrow of arrows) {
    cellsBefore.push(running);
    running = new Set([...running, ...arrow.path.map(cellKey)]);
  }
  const spots: DirectionalSpotDefinition[] = [];
  const rng = new Rng(hashSeed(`${seedForLevel(id)}:dir-cells`));
  for (const { face, count } of plan) {
    let room = count - (coreFace === face ? 1 : 0);
    if (room <= 0) continue;
    const candidates = new Map<
      string,
      { cell: Cell; heading: Heading; traversers: number[] }
    >();
    for (let index = 0; index < arrows.length; index += 1) {
      const arrow = arrows[index] as ArrowDefinition;
      if (arrow.id.startsWith(`r${id}-park-`)) continue;
      const track = arrowTrack(level, arrow);
      for (let step = 1; step < track.length; step += 1) {
        const cell = track[step] as Cell;
        if (cell.face !== face) continue;
        const key = cellKey(cell);
        if (occupied.has(key) || parkTrackKeys.has(key)) continue;
        const heading = headingForPath(
          [track[step - 1] as Cell, cell],
          level.gridSize,
        );
        if (!heading) continue;
        const entry = candidates.get(key) ?? { cell, heading, traversers: [] };
        entry.traversers.push(index);
        candidates.set(key, entry);
      }
    }
    const choices = [...candidates.values()];
    for (let index = choices.length - 1; index > 0; index -= 1) {
      const replacement = rng.int(index + 1);
      const current = choices[index] as {
        cell: Cell;
        heading: Heading;
        traversers: number[];
      };
      choices[index] = choices[replacement] as typeof current;
      choices[replacement] = current;
    }
    for (const { cell, heading, traversers } of choices) {
      if (room <= 0) break;
      const key = cellKey(cell);
      if (occupied.has(key)) continue;
      const turn = PERPENDICULAR[heading][rng.int(2)] as Heading;
      const trial: LevelDefinition = {
        ...level,
        directionals: [...(level.directionals ?? []), { cell, heading: turn }],
      };
      let fits = true;
      for (const traverser of traversers) {
        const alone = simulateMove(
          trial,
          [arrows[traverser]!!.id],
          arrows[traverser]!!.id,
        );
        if (alone.kind !== "exit") {
          fits = false;
          break;
        }
        const blocked = alone.route.some(
          (routeCell) =>
            parkTrackKeys.has(cellKey(routeCell)) ||
            cellsBefore[traverser]!!.has(cellKey(routeCell)),
        );
        if (blocked) {
          fits = false;
          break;
        }
      }
      if (!fits) continue;
      occupied.add(key);
      spots.push({ cell, heading: turn });
      room -= 1;
    }
  }
  return spots;
}

/**
 * Choose decorative circles on cells some arrow's head actually travels
 * through, so a circle is always reachable rather than decorative. The
 * load-bearing circle arrives with the parking core; these extras never change
 * whether a level can be cleared, because a head sweeps the same cells whether
 * or not it parks along the way.
 */
function chooseStops(
  id: number,
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies" | "directionals">,
  arrows: readonly ArrowDefinition[],
  occupied: ReadonlySet<string>,
  decorativeCount: number,
): readonly Cell[] {
  if (decorativeCount <= 0) return [];
  const candidates: Cell[] = [];
  const seen = new Set<string>();
  const bent = (level.directionals?.length ?? 0) > 0;
  for (const arrow of arrows) {
    // On spot cubes the rays are bent by the spots, so circles must come from
    // the tracks arrows actually travel; spot-free levels keep the straight
    // rays, which are identical there and preserve those layouts.
    const swept = bent
      ? arrowTrack(level, arrow).slice(arrow.path.length)
      : (() => {
          const head = arrow.path[arrow.path.length - 1];
          const heading = headingForPath(arrow.path, level.gridSize);
          return !head || !heading
            ? []
            : exitRay(level, head, heading).slice(1);
        })();
    for (const cell of swept) {
      const key = cellKey(cell);
      if (occupied.has(key) || seen.has(key)) continue;
      seen.add(key);
      candidates.push(cell);
    }
  }
  const rng = new Rng(hashSeed(`${seedForLevel(id)}:stop-cells`));
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const replacement = rng.int(index + 1);
    const current = candidates[index] as Cell;
    candidates[index] = candidates[replacement] as Cell;
    candidates[replacement] = current;
  }
  return candidates.slice(0, decorativeCount);
}

/**
 * Replay a construction certificate. A park entry advances the named arrow to
 * its next circle and leaves it parked there; every other entry is driven
 * through its pauses until it exits before the next arrow is tried.
 */
function replayCertificate(
  level: LevelDefinition,
  certificate: readonly string[],
): boolean {
  let remaining = level.arrows.map((arrow) => arrow.id);
  const offsets: Record<string, number> = {};
  const maximumLegs = level.gridSize * 6 + 2;
  for (const entry of certificate) {
    const park = entry.startsWith(PARK_CERTIFICATE_PREFIX);
    const arrowId = park ? entry.slice(PARK_CERTIFICATE_PREFIX.length) : entry;
    if (!remaining.includes(arrowId)) continue;
    if (park) {
      const result = simulateMove(
        level,
        remaining,
        arrowId,
        "head",
        0,
        offsets,
      );
      if (result.kind !== "paused" || !result.pausedSteps) return false;
      for (const memberId of overlappingArrowIds(level, arrowId)) {
        offsets[memberId] = (offsets[memberId] ?? 0) + result.pausedSteps;
      }
      continue;
    }
    let cleared = false;
    for (let leg = 0; leg < maximumLegs && !cleared; leg += 1) {
      const result = simulateMove(
        level,
        remaining,
        arrowId,
        "head",
        0,
        offsets,
      );
      if (result.kind === "exit") {
        cleared = true;
      } else if (result.kind === "paused" && result.pausedSteps) {
        for (const id of overlappingArrowIds(level, arrowId)) {
          offsets[id] = (offsets[id] ?? 0) + result.pausedSteps;
        }
      } else {
        return false;
      }
    }
    if (!cleared) return false;
    const clearedIds = overlappingArrowIds(level, arrowId);
    remaining = remaining.filter((id) => !clearedIds.includes(id));
    for (const id of clearedIds) delete offsets[id];
  }
  return remaining.length === 0;
}

/** Replay the certificate of a level that passes validation. */
function validateGenerated(
  level: LevelDefinition,
  certificate: readonly string[],
): boolean {
  return validateLevel(level).valid && replayCertificate(level, certificate);
}

/**
 * Build a pure, reproducible level. Insertion is reverse construction: each
 * arrow has an exit unobstructed by earlier arrows, so reverse insertion is a
 * real no-mistake solution certificate. Levels carrying stop circles also embed
 * the parking core, whose circles are reserved from every later arrow so the
 * replayed certificate — the park legs, then the reverse drive — can never
 * fail because of parking.
 */
export function generateLevel(id: number): LevelDefinition {
  assertLevelId(id);
  if (id === 1) return LEVEL_ONE;
  if (id === 5) return STOP_INTRO_LEVEL;
  if (id === 11) return WRAP_INTRO_LEVEL;
  if (id === 15) return OVERLAP_INTRO_LEVEL;
  if (id === 20) return DIRECTIONAL_INTRO_LEVEL;
  const config = getLevelConfig(id);
  const baseSeed = hashSeed(seedForLevel(id));
  const edgePolicies = getWrappingEdgePolicies(id);
  let skip = "never-entered";
  // Pass one builds the planned directional layout; if every restart of that
  // pass fails its replay, pass two rebuilds the same id with the plan forced
  // empty — a cube without spots is always legal, and generation must never
  // give up on an id.
  const plannedSpotPlan = directionalFacePlan(id);
  // Acceptance tiers, tried strictly in order. Tier one is the historical
  // exact-count, certificate-replayed construction, so every level that
  // constructs today stays byte-identical. A later tier only sees an id that
  // every earlier tier rejected across both spot plans and all eight
  // restarts: it trades exact density and, in the last tier, the
  // reverse-construction certificate for a solver-proven level instead of
  // throwing.
  const tiers = [
    { minArrows: config.arrowCount, certificate: true },
    { minArrows: config.arrowCount - 12, certificate: true },
    { minArrows: config.arrowCount - 12, certificate: false },
  ];
  for (const tier of tiers) {
    for (const spotPlan of [plannedSpotPlan, [] as number[]]) {
      construction: for (let restart = 0; restart < 8; restart += 1) {
        const rng = new Rng(
          (baseSeed + Math.imul(restart + 1, 0x9e3779b9)) >>> 0,
        );
        const occupied = new Set<string>();
        const arrows: ArrowDefinition[] = [];
        const candidateLevel = {
          id,
          title: `Cube ${id}`,
          gridSize: config.gridSize,
          lives: config.lives,
          arrowScale: config.arrowScale,
          ...(edgePolicies.length > 0 ? { edgePolicies } : {}),
        } as const;
        const faces = shuffledFaces(rng);
        const headingOffset = rng.int(HEADINGS.length);
        const planFaceIds =
          spotPlan.length > 0
            ? shuffledFaces(
                new Rng(hashSeed(`${seedForLevel(id)}:dir-faces`)),
              ).slice(0, spotPlan.length)
            : [];
        const directional = spotPlan.length > 0;
        if (!directional && id >= 16) {
          const group = overlapStarter(
            id,
            config.gridSize,
            rng,
            { ...candidateLevel, arrows: [] },
            occupied,
          );
          if (
            !group ||
            !validateLevel({ ...candidateLevel, arrows: group }).valid
          ) {
            skip = "overlap";
            continue construction;
          }
          for (const arrow of group) {
            for (const cell of arrow.path) occupied.add(cellKey(cell));
            arrows.push(arrow);
          }
        }
        const core =
          getStopCount(id) >= 1
            ? parkingCore(
                id,
                { ...candidateLevel, arrows },
                occupied,
                getStopCount(id),
                restart,
              )
            : undefined;
        if (core) {
          for (const arrow of core.arrows) {
            if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
              throw new Error("Seeded parking-core arrow was invalid.");
            for (const cell of arrow.path) occupied.add(cellKey(cell));
            arrows.push(arrow);
          }
          for (const stop of core.stops) occupied.add(cellKey(stop));
        }
        // The park legs lead the certificate replay, so the parked windows along
        // the park core's routes block everything that drives after them. The
        // directional core checks these tracks in addition to `occupied`; they are
        // deliberately NOT reserved globally, which would shift every circle
        // cube's layout.
        const parkTrackKeys = new Set<string>();
        if (core) {
          for (const arrow of core.arrows) {
            for (const cell of arrowTrack(candidateLevel, arrow)) {
              parkTrackKeys.add(cellKey(cell));
            }
          }
        }
        const directionalSpot = directional
          ? directionalCore(
              id,
              candidateLevel,
              occupied,
              planFaceIds[0],
              parkTrackKeys,
              restart,
            )
          : undefined;
        const dirCells = new Set<string>();
        if (directionalSpot) {
          for (const arrow of directionalSpot.arrows) {
            if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
              throw new Error("Seeded directional-core arrow was invalid.");
            for (const cell of arrow.path) occupied.add(cellKey(cell));
            arrows.push(arrow);
          }
          occupied.add(cellKey(directionalSpot.spot.cell));
          for (const cell of exitRay(
            candidateLevel,
            directionalSpot.spot.cell,
            directionalSpot.spot.heading,
          ).slice(1)) {
            dirCells.add(cellKey(cell));
            occupied.add(cellKey(cell));
          }
        }
        for (const [index, length] of [2, 3, 4].entries()) {
          const face = faces[index];
          const heading = HEADINGS.map(
            (_, offset) =>
              HEADINGS[(headingOffset + index + offset) % HEADINGS.length],
          ).find(
            (direction) =>
              !edgePolicies.some(
                (rule) => rule.face === face && rule.edge === direction,
              ),
          );
          if (!face || !heading)
            throw new Error(
              "Could not choose a seeded straight-arrow starter.",
            );
          const path = straightCandidate(
            rng,
            config.gridSize,
            face,
            heading,
            length,
            occupied,
          );
          if (!path) {
            skip = "starter";
            continue construction;
          }
          const arrow: ArrowDefinition = {
            id: `r${id}-straight-${length}`,
            path,
          };
          if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
            throw new Error("Seeded straight-arrow starter was invalid.");
          for (const cell of path) occupied.add(cellKey(cell));
          arrows.push(arrow);
        }
        for (let index = 0; index < edgePolicies.length; index += 2) {
          let accepted = false;
          for (let attempt = 0; attempt < config.gridSize * 4; attempt += 1) {
            const rule = edgePolicies[index + (attempt % 2)];
            if (!rule) continue;
            const path = straightCandidate(
              rng,
              config.gridSize,
              rule.face,
              rule.edge,
              5 + index / 2,
              occupied,
            );
            const head = path?.[path.length - 1];
            if (!path || !head) continue;
            const ray = exitRay(candidateLevel, head, rule.edge);
            // The directional core's legs lead the certificate replay, so plain
            // arrows drive only after the core has left: crossing the reserved
            // corridor is harmless and must not starve wrap placement.
            if (
              ray.length === 0 ||
              ray.some(
                (cell) =>
                  occupied.has(cellKey(cell)) && !dirCells.has(cellKey(cell)),
              )
            )
              continue;
            const arrow: ArrowDefinition = {
              id: `r${id}-wrap-${index / 2}`,
              path,
            };
            if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
              continue;
            for (const cell of path) occupied.add(cellKey(cell));
            arrows.push(arrow);
            accepted = true;
            break;
          }
          if (!accepted) {
            skip = "wrap";
            continue construction;
          }
        }
        for (
          let attempt = 0;
          arrows.length < config.arrowCount &&
          attempt < config.arrowCount * 900;
          attempt += 1
        ) {
          const path = candidate(
            rng,
            candidateLevel,
            occupied,
            Math.max(
              2,
              Math.floor(
                targetLength(rng, id, config) *
                  (1 - edgePolicies.length * 0.05),
              ),
            ),
            directional ? dirCells : undefined,
          );
          if (!path) continue;
          const arrow: ArrowDefinition = {
            id: `r${id}-${arrows.length}`,
            path,
          };
          if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
            continue;
          for (const cell of path) occupied.add(cellKey(cell));
          arrows.push(arrow);
        }
        if (arrows.length < tier.minArrows) {
          skip = "count";
          continue;
        }
        const coreFace = directionalSpot?.spot.cell.face;
        const bearingFaces = (
          coreFace
            ? [coreFace, ...planFaceIds.filter((face) => face !== coreFace)]
            : planFaceIds
        ).slice(0, 4);
        const extraSpots =
          directionalSpot && planFaceIds.length > 0
            ? extraDirectionalSpots(
                id,
                {
                  ...candidateLevel,
                  arrows,
                  directionals: [directionalSpot.spot],
                },
                arrows,
                occupied,
                bearingFaces
                  .filter((face) => face !== coreFace)
                  .map((face) => ({
                    face,
                    count: spotPlan[planFaceIds.indexOf(face)] as number,
                  })),
                coreFace,
              )
            : [];
        const spots = directionalSpot
          ? [directionalSpot.spot, ...extraSpots]
          : [];
        const decorative = chooseStops(
          id,
          {
            ...candidateLevel,
            ...(spots.length > 0 ? { directionals: spots } : {}),
          },
          arrows,
          occupied,
          getStopCount(id) - (core ? core.stops.length : 0),
        );
        const stops = core ? [...core.stops, ...decorative] : decorative;
        const level: LevelDefinition = {
          ...candidateLevel,
          arrows,
          ...(stops.length > 0 ? { stops } : {}),
          ...(spots.length > 0 ? { directionals: spots } : {}),
        };
        const certificate = [
          ...(core
            ? core.stops.map(() => `${PARK_CERTIFICATE_PREFIX}${core.parkerId}`)
            : []),
          ...(directionalSpot
            ? directionalSpot.arrows.map((arrow) => arrow.id)
            : []),
          ...[...arrows].reverse().map((arrow) => arrow.id),
        ];
        if (
          directional &&
          !level.arrows.some(
            (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
          )
        ) {
          skip = "faces";
          continue;
        }
        const accepted = tier.certificate
          ? validateGenerated(level, certificate)
          : validateLevel(level).valid && solveLevel(level) !== undefined;
        if (accepted) return level;
        skip = "replay";
        if (spots.length > 1 && directionalSpot) {
          // Extra spots bend real routes and can break the replay; the required
          // core alone replays against the same certificate, so fall back to it
          // rather than dropping directionals entirely.
          const coreOnly: LevelDefinition = {
            ...candidateLevel,
            arrows,
            ...(stops.length > 0 ? { stops } : {}),
            directionals: [directionalSpot.spot],
          };
          const coreAccepted = tier.certificate
            ? validateGenerated(coreOnly, certificate)
            : validateLevel(coreOnly).valid &&
              solveLevel(coreOnly) !== undefined;
          if (coreAccepted) return coreOnly;
        }
      }
    }
  }
  throw new Error(
    `Could not deterministically construct runtime level ${id} (last skip: ${skip}).`,
  );
}
