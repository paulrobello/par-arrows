import {
  flippedHeading,
  hasFlipSpots,
  spotHeadingAt,
} from "../core/directionals";
import {
  applyMove,
  createGameState,
  simulateMove as simulateGameMove,
} from "../core/game-state";
import { advanceHead, simulateMove } from "../core/movement";
import { overlappingArrowIds } from "../core/overlap";
import {
  arrowTrack,
  currentPath,
  maximumOffset,
  trackKeys,
} from "../core/stops";
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
  MoveResult,
  MoveTarget,
} from "../core/types";
import {
  flipHeadingProbes,
  hasStrandingState,
  interactionRegion,
  occupancyKeys,
  proveRegion,
  solveLevel,
  solveLevelTargets,
  validateLevel,
} from "../core/validation";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "./intro";
import { DIRECTIONAL_INTRO_LEVEL } from "./directional-intro";
import { DOUBLE_INTRO_LEVEL } from "./double-intro";
import { FLIP_INTRO_LEVEL } from "./flip-intro";
import { OVERLAP_INTRO_LEVEL } from "./overlap-intro";
import { STOP_INTRO_LEVEL } from "./stop-intro";

export const GENERATOR_VERSION = 8;
export const MAX_LEVEL_ID = Number.MAX_SAFE_INTEGER - 1;

/** Authored teaching cubes; every other id is generated at runtime. */
export const AUTHORED_LEVEL_IDS: readonly number[] = [1, 5, 11, 15, 20, 25, 30];

const AUTHORED = new Set(AUTHORED_LEVEL_IDS);

/** True for the hand-authored teaching cubes. */
export function isAuthoredLevel(id: number): boolean {
  assertLevelId(id);
  return AUTHORED.has(id);
}

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
  if (id === 25) return "par-arrows:runtime:7:level:25:double-intro:1";
  if (id === 30) return "par-arrows:runtime:7:level:30:flip-intro:1";
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
  if (id <= 4 || (isAuthoredLevel(id) && id > 10)) return [1, 0, 0, 0];
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
  if (isAuthoredLevel(id)) return [1, 0, 0, 0];
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
  if (isAuthoredLevel(id)) return [];
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
  if (isAuthoredLevel(id)) {
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

export interface BlockedStats {
  readonly blocked: number;
  readonly total: number;
}

/**
 * Tap units (a single arrow or one shared-tail group) whose immediate move at
 * the level's initial state is blocked. The denominator counts every unit.
 */
export function blockedStats(level: LevelDefinition): BlockedStats {
  const remaining = level.arrows.map((arrow) => arrow.id);
  const counted = new Set<string>();
  let blocked = 0;
  let total = 0;
  for (const arrow of level.arrows) {
    if (counted.has(arrow.id)) continue;
    for (const memberId of overlappingArrowIds(level, arrow.id)) {
      counted.add(memberId);
    }
    total += 1;
    if (simulateMove(level, remaining, arrow.id).kind === "blocked") {
      blocked += 1;
    }
  }
  return { blocked, total };
}

/**
 * Share of tap units that start blocked: 0 through the authored teaching ids,
 * then 0.30 at level 12 rising linearly to 0.55 at level 60 and holding.
 */
export function blockedTarget(id: number): number {
  assertLevelId(id);
  if (id <= 10 || isAuthoredLevel(id)) return 0;
  const progress = Math.min(1, (id - 12) / 48);
  return Math.min(0.55, 0.3 + 0.25 * progress);
}

/** Probability that a generated level attempts a required-use double-arrow core. */
export function doubleArrowFrequency(id: number): number {
  assertLevelId(id);
  if (id < 26) return 0;
  const progress = Math.min(1, (id - 26) / 34);
  return 0.2 + 0.25 * progress;
}

/** First generated level that can embed a flip core. */
const FIRST_FLIP_LEVEL = 31;

/** Probability that a generated level attempts a flip core. */
export function flipCoreFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_FLIP_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_FLIP_LEVEL) / (90 - FIRST_FLIP_LEVEL),
  );
  return 0.25 + 0.4 * progress;
}

/** Extra arrows the blocker pass may spend toward the blocked target. */
export function blockerReserve(id: number): number {
  assertLevelId(id);
  return Math.ceil(blockedTarget(id) * getLevelConfig(id).arrowCount);
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
 * both parks are spent. "twist" gives the freed arrow an L-shaped lane.
 * "crossfire" interleaves a four-arrow unwind around one circle. "twin"
 * stacks two independent one-circle deadlocks with two different parkers;
 * its optional `second` unit repeats the shape, and the certificate parks
 * both parkers before either unit unwinds. "bounce" starts the parker head-on
 * into a static spot, so it reaches its circle only by reversing back over
 * its own body; its spot counts against the cube's static-spot plan, so the
 * pattern is eligible only on a spot-plan pass. A pattern is eligible only
 * when the level's stop budget covers its circles. `others` lists the non-parker
 * arrows in reverse unwinding order: the certificate tail drives arrows
 * last-placed-first, so the last listed arrow must be the one that moves
 * immediately after the park.
 */
export const PARK_PATTERNS: readonly {
  readonly name: string;
  readonly parker: readonly ParkDelta[];
  readonly stops: readonly ParkDelta[];
  readonly others: readonly (readonly ParkDelta[])[];
  /** Static spots the core's routes bend through, in the pattern frame. */
  readonly spots?: readonly (ParkDelta & { readonly heading: Heading })[];
  /** Optional second independent deadlock: another parker with its own circle and followers. */
  readonly second?: {
    readonly parker: readonly ParkDelta[];
    readonly stops: readonly ParkDelta[];
    readonly others: readonly (readonly ParkDelta[])[];
  };
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
  {
    name: "twist",
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
        { dx: 2, dy: 2 },
        { dx: 1, dy: 2 },
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "crossfire",
    parker: [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    stops: [{ dx: 2, dy: 0 }],
    others: [
      [
        { dx: 6, dy: 0 },
        { dx: 6, dy: 1 },
        { dx: 5, dy: 1 },
      ],
      [
        { dx: 4, dy: 1 },
        { dx: 3, dy: 1 },
        { dx: 2, dy: 1 },
      ],
      [
        { dx: 1, dy: 2 },
        { dx: 0, dy: 2 },
        { dx: 0, dy: 1 },
      ],
    ],
  },
  {
    name: "twin",
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
    second: {
      parker: [
        { dx: 0, dy: 4 },
        { dx: 1, dy: 4 },
      ],
      stops: [{ dx: 2, dy: 4 }],
      others: [
        [
          { dx: 3, dy: 4 },
          { dx: 3, dy: 5 },
          { dx: 2, dy: 5 },
          { dx: 1, dy: 5 },
        ],
        [
          { dx: 0, dy: 6 },
          { dx: 0, dy: 5 },
        ],
      ],
    },
  },
  {
    name: "bounce",
    parker: [
      { dx: 2, dy: 0 },
      { dx: 1, dy: 0 },
    ],
    spots: [{ dx: 0, dy: 0, heading: "east" }],
    stops: [{ dx: 3, dy: 0 }],
    others: [
      [
        { dx: 4, dy: 0 },
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
const PARK_FOLLOWER_IDS = ["park-b", "park-f", "park-g", "park-h"] as const;

/** Patterns ids <= 10 draw from, so their layouts stay byte-identical. */
const LEGACY_PARK_PATTERN_COUNT = 4;

const PARK_CERTIFICATE_PREFIX = "park:";

interface ParkingCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly stops: readonly Cell[];
  /** Static spots the core's routes bend through. */
  readonly spots: readonly DirectionalSpotDefinition[];
  /** Certificate park entries, one per circle, naming each circle's parker. */
  readonly parkLegs: readonly string[];
}

interface DoubleCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly certificate: readonly MoveTarget[];
}

function doubleCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  restart: number,
): DoubleCore | undefined {
  const planned = coreStream(id, "double-plan", 0).next();
  if (id < 26 || planned >= doubleArrowFrequency(id)) return undefined;
  const rng = coreStream(id, "double-core", restart);
  const pattern = [
    {
      id: "double",
      kind: "double" as const,
      cells: [
        [0, 0],
        [1, 0],
      ],
    },
    {
      id: "a",
      cells: [
        [0, 2],
        [0, 1],
      ],
    },
    {
      id: "b",
      cells: [
        [3, 0],
        [2, 0],
      ],
    },
  ] as const;
  const faces = shuffledFaces(rng);
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const base: Cell = {
      face,
      x: 1 + rng.int(Math.max(1, level.gridSize - 5)),
      y: 1 + rng.int(Math.max(1, level.gridSize - 4)),
    };
    const arrows: ArrowDefinition[] = pattern.map((entry) => ({
      id: `r${id}-double-${entry.id}`,
      ...(entry.id === "double" ? { kind: "double" as const } : {}),
      path: entry.cells.map(([dx, dy]) => patternCell(base, dx, dy, rotation)),
    }));
    const cells = arrows.flatMap((arrow) => arrow.path);
    const keys = cells.map(cellKey);
    if (
      new Set(keys).size !== keys.length ||
      cells.some(
        (cell) =>
          cell.x < 0 ||
          cell.y < 0 ||
          cell.x >= level.gridSize ||
          cell.y >= level.gridSize ||
          occupied.has(cellKey(cell)),
      )
    )
      continue;
    const coreLevel: LevelDefinition = { ...level, arrows };
    if (!validateLevel(coreLevel).valid) continue;
    const certificate = solveLevelTargets(coreLevel);
    const doubleId = `r${id}-double-double`;
    if (
      !certificate ||
      !certificate.some(
        (target) => target.arrowId === doubleId && target.endpoint === "tail",
      )
    )
      continue;
    const coreIds = new Set(arrows.map((arrow) => arrow.id));
    return {
      arrows,
      certificate: certificate.filter((target) => coreIds.has(target.arrowId)),
    };
  }
  return undefined;
}

/**
 * Flip-core layouts relative to the spot cell at (2, 2). Every arrow's head
 * aims at the spot or passes it, so all of the core's routes run through or
 * beside it; the proven interaction region is reserved before other arrows
 * are placed. "gate": the opener turns north and flips the spot south, which
 * frees the waiter. "bounce": the reverser U-turns out of the spot, after
 * which the runner turns into the cap until it is cleared. "relay": two
 * passes in a row, so the east arrow's safety depends on the pass count.
 * "relay2": the traverser bends through two flip spots in sequence; the lid's
 * safety depends on both spots' states and the two lane arrows' on the
 * second's.
 */
export const FLIP_PATTERNS: readonly {
  readonly name: "gate" | "bounce" | "relay" | "relay2";
  readonly heading: Heading;
  /** Further flip spots beyond the one at (2, 2), in the same pattern frame. */
  readonly extraSpots?: readonly {
    readonly cell: readonly [number, number];
    readonly heading: Heading;
  }[];
  readonly arrows: readonly {
    readonly name: string;
    readonly cells: readonly (readonly [number, number])[];
  }[];
}[] = [
  {
    name: "gate",
    heading: "north",
    arrows: [
      {
        name: "opener",
        cells: [
          [0, 2],
          [1, 2],
        ],
      },
      {
        name: "waiter",
        cells: [
          [4, 2],
          [3, 2],
        ],
      },
      {
        name: "lid",
        cells: [
          [2, 1],
          [2, 0],
        ],
      },
    ],
  },
  {
    name: "bounce",
    heading: "south",
    arrows: [
      {
        name: "reverser",
        cells: [
          [2, 4],
          [2, 3],
        ],
      },
      {
        name: "runner",
        cells: [
          [4, 2],
          [3, 2],
        ],
      },
      {
        name: "cap",
        cells: [
          [1, 0],
          [2, 0],
        ],
      },
    ],
  },
  {
    name: "relay",
    heading: "north",
    arrows: [
      {
        name: "west",
        cells: [
          [0, 2],
          [1, 2],
        ],
      },
      {
        name: "east",
        cells: [
          [4, 2],
          [3, 2],
        ],
      },
      {
        name: "northcap",
        cells: [
          [1, 0],
          [2, 0],
        ],
      },
      {
        name: "southcap",
        cells: [
          [3, 4],
          [2, 4],
        ],
      },
    ],
  },
  {
    name: "relay2",
    heading: "south",
    extraSpots: [{ cell: [2, 4], heading: "east" }],
    arrows: [
      {
        name: "traverser",
        cells: [
          [0, 2],
          [1, 2],
        ],
      },
      {
        name: "lid",
        cells: [
          [2, 0],
          [2, 1],
        ],
      },
      {
        name: "west",
        cells: [
          [0, 4],
          [1, 4],
        ],
      },
      {
        name: "east",
        cells: [
          [4, 4],
          [3, 4],
        ],
      },
    ],
  },
];

/** Every generated flip-core arrow id carries this marker; seeds are found by it. */
const FLIP_CORE_MARKER = "-flip-";

/** Ids of a level's generated flip-core arrows, the seeds of its region. */
export function flipCoreIds(arrows: readonly ArrowDefinition[]): string[] {
  return arrows
    .filter((arrow) => arrow.id.includes(FLIP_CORE_MARKER))
    .map((arrow) => arrow.id);
}

interface FlipCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly spots: readonly DirectionalSpotDefinition[];
  /** Circles planned inside the region, taken from the decorative budget. */
  readonly stops: readonly Cell[];
  /** The proven interaction region's cells, reserved from later placement. */
  readonly cells: ReadonlySet<string>;
}

/**
 * Place a flip core on its own seeded streams and prove its interaction
 * region. The pattern rotates about its first spot, which keeps a two-cell
 * margin from every face edge so each rotation fits. Every cell a core arrow
 * can reach under any flip state must avoid every reserved cell and the
 * parking core's tracks, so the cores placed before it play exactly as they
 * were proven; the caller reserves the region's cells so nothing placed later
 * touches it. When the level has a circle to spare, a circle is planned on a
 * core arrow's lane first: up to two lanes whose park leaves a body on a flip
 * spot (a pending flip, proven strand-free by the region's enumeration), then
 * up to two lanes whose park keeps every core body off every other core track,
 * before the core is tried with no circle at all. A head that could re-enter a
 * flip spot through a wrapping edge is rejected, because the static probes
 * only bound a single pass.
 */
function flipCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  parkTracks: ReadonlySet<string>,
  stopBudget: number,
  restart: number,
): FlipCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "flip-core", restart);
  const pattern = FLIP_PATTERNS[
    rng.int(FLIP_PATTERNS.length)
  ] as (typeof FLIP_PATTERNS)[number];
  const faces = shuffledFaces(rng);
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const spotCell: Cell = {
      face,
      x: 2 + rng.int(Math.max(1, size - 4)),
      y: 2 + rng.int(Math.max(1, size - 4)),
    };
    const at = ([dx, dy]: readonly [number, number]): Cell =>
      patternCell(spotCell, dx - 2, dy - 2, rotation);
    const spots: DirectionalSpotDefinition[] = [
      {
        cell: spotCell,
        heading: rotateHeading(pattern.heading, rotation),
        kind: "flip",
      },
      ...(pattern.extraSpots ?? []).map((extra) => ({
        cell: at(extra.cell),
        heading: rotateHeading(extra.heading, rotation),
        kind: "flip" as const,
      })),
    ];
    const arrows: ArrowDefinition[] = pattern.arrows.map((entry) => ({
      id: `r${id}${FLIP_CORE_MARKER}${pattern.name}-${entry.name}`,
      path: entry.cells.map(at),
    }));
    const cells = [
      ...arrows.flatMap((arrow) => arrow.path),
      ...spots.map((spot) => spot.cell),
    ];
    if (cells.some((cell) => !inBounds(cell) || occupied.has(cellKey(cell))))
      continue;
    const board = {
      ...level,
      directionals: [...(level.directionals ?? []), ...spots],
    };
    const spotKeys = spots.map((spot) => cellKey(spot.cell));
    const reach = new Set<string>(spotKeys);
    let singlePass = true;
    for (const probe of flipHeadingProbes(board)) {
      for (const arrow of arrows) {
        const keys = arrowTrack(probe, arrow).map(cellKey);
        if (
          spotKeys.some(
            (spotKey) => keys.filter((key) => key === spotKey).length > 1,
          )
        )
          singlePass = false;
        for (const key of keys) reach.add(key);
      }
    }
    if (
      !singlePass ||
      [...reach].some((key) => occupied.has(key) || parkTracks.has(key))
    )
      continue;
    const coreLevel: LevelDefinition = {
      ...board,
      arrows,
      stops: [],
    };
    if (!validateLevel(coreLevel).valid) continue;
    const bodies = new Set(arrows.flatMap((arrow) => arrow.path.map(cellKey)));
    const lanes: Cell[] = [];
    const pendingLanes: Cell[] = [];
    if (stopBudget > 0) {
      const seen = new Set<string>();
      for (const arrow of arrows) {
        for (const cell of arrowTrack(board, arrow).slice(arrow.path.length)) {
          const key = cellKey(cell);
          if (seen.has(key) || bodies.has(key) || spotKeys.includes(key))
            continue;
          seen.add(key);
          if (!inBounds(cell) || cell.face !== face) continue;
          const withStop: LevelDefinition = { ...coreLevel, stops: [cell] };
          if (!validateLevel(withStop).valid) continue;
          if (parksOnFlipSpot(withStop, cell)) {
            pendingLanes.push(cell);
            continue;
          }
          if (parkCrossesTrack(withStop, cell)) continue;
          lanes.push(cell);
        }
      }
      for (const list of [lanes, pendingLanes]) {
        for (let index = list.length - 1; index > 0; index -= 1) {
          const replacement = rng.int(index + 1);
          const current = list[index] as Cell;
          list[index] = list[replacement] as Cell;
          list[replacement] = current;
        }
      }
    }
    const planned: (readonly Cell[])[] = [
      ...pendingLanes.slice(0, 2).map((cell) => [cell]),
      ...lanes.slice(0, 2).map((cell) => [cell]),
      [],
    ];
    const placed = [...level.arrows, ...arrows];
    for (const stops of planned) {
      const verdict = acceptFlipRegion(level, placed, board.directionals, [
        ...(level.stops ?? []),
        ...stops,
      ]);
      if (!verdict.ok) continue;
      return { arrows, spots, stops, cells: verdict.cells };
    }
  }
  return undefined;
}

/**
 * Accept a flip placement by proving its interaction region: seed arrows are
 * the flip core's, outside placed arrows block but are never tapped. `spots`
 * is every spot on the board, flip and static, so region tracks bend as they
 * will in play. Returns the region cells for occupancy; ok:false means the
 * caller must not reserve them and tries its next fallback. `reason` is the
 * prover's rejection, or "overflow" when the region closed past its cap.
 */
export function acceptFlipRegion(
  board: Pick<
    LevelDefinition,
    "id" | "title" | "gridSize" | "lives" | "edgePolicies"
  >,
  arrows: readonly ArrowDefinition[],
  spots: readonly DirectionalSpotDefinition[],
  stops: readonly Cell[],
): {
  ok: boolean;
  cells: ReadonlySet<string>;
  reason?: "stranded" | "uninteresting" | "unsolvable" | "overflow";
} {
  const level: LevelDefinition = {
    ...board,
    arrows: [...arrows],
    directionals: [...spots],
    ...(stops.length > 0 ? { stops } : {}),
  };
  const seeds = flipCoreIds(arrows);
  const region = interactionRegion(level, seeds);
  if (!region) return { ok: false, cells: new Set(), reason: "overflow" };
  const verdict = proveRegion(level, createGameState(level), region);
  return verdict.ok
    ? { ok: true, cells: region.cells }
    : {
        ok: false,
        cells: region.cells,
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      };
}

/**
 * True when parking onto `stop` moves some arrow's body onto another arrow's
 * track, among the arrows of `level` (the flip core's own, where it is used).
 */
function parkCrossesTrack(level: LevelDefinition, stop: Cell): boolean {
  const stopKey = cellKey(stop);
  const owners = new Map<string, Set<string>>();
  for (const arrow of level.arrows) {
    for (const key of trackKeys(level, arrow)) {
      owners.set(key, (owners.get(key) ?? new Set()).add(arrow.id));
    }
  }
  for (const arrow of level.arrows) {
    const track = arrowTrack(level, arrow).map(cellKey);
    const index = track.indexOf(stopKey, arrow.path.length);
    if (index < 0) continue;
    const own = new Set(arrow.path.map(cellKey));
    for (const cell of currentPath(
      level,
      arrow,
      index - arrow.path.length + 1,
    )) {
      const key = cellKey(cell);
      if (own.has(key)) continue;
      if ([...(owners.get(key) ?? [])].some((other) => other !== arrow.id))
        return true;
    }
  }
  return false;
}

/**
 * True when some arrow whose track reaches `stop` parks there with part of its
 * body still on a flip spot, leaving that spot's flip pending until it moves.
 */
function parksOnFlipSpot(level: LevelDefinition, stop: Cell): boolean {
  const stopKey = cellKey(stop);
  const flipKeys = new Set(
    (level.directionals ?? [])
      .filter((spot) => spot.kind === "flip")
      .map((spot) => cellKey(spot.cell)),
  );
  return level.arrows.some((arrow) => {
    const index = arrowTrack(level, arrow)
      .map(cellKey)
      .indexOf(stopKey, arrow.path.length);
    return (
      index >= 0 &&
      currentPath(level, arrow, index - arrow.path.length + 1).some((cell) =>
        flipKeys.has(cellKey(cell)),
      )
    );
  });
}

/**
 * Prove a finished level's flip region and build its certificate lead. The
 * region is re-derived on the assembled board — later spots, circles and
 * blockers can bend tracks into it — and every arrow outside it must keep
 * every track, under every flip state, off the region's cells. The region's
 * own solution, found on a board holding only its arrows and circles, then
 * replays first: by closure no outside body sits on a region track. A park
 * becomes a park leg; undefined means the region does not prove.
 */
function flipRegionLead(
  level: LevelDefinition,
): readonly CertificateEntry[] | undefined {
  const seeds = flipCoreIds(level.arrows);
  if (seeds.length === 0) return [];
  const region = interactionRegion(level, seeds);
  if (!region) return undefined;
  // A shared-tail group moves on one offset along static tracks, so it may
  // never sit inside a region whose tracks depend on flip state.
  if (region.arrowIds.some((id) => overlappingArrowIds(level, id).length > 1))
    return undefined;
  if (!proveRegion(level, createGameState(level), region).ok) return undefined;
  const inside = new Set(region.arrowIds);
  for (const arrow of level.arrows) {
    if (inside.has(arrow.id)) continue;
    for (const key of occupancyKeys(level, arrow)) {
      if (region.cells.has(key)) return undefined;
    }
  }
  const regionStops = new Set(region.stopKeys);
  const stops = (level.stops ?? []).filter((stop) =>
    regionStops.has(cellKey(stop)),
  );
  const { stops: _allStops, ...bare } = level;
  const sub: LevelDefinition = {
    ...bare,
    arrows: level.arrows.filter((arrow) => inside.has(arrow.id)),
    ...(stops.length > 0 ? { stops } : {}),
  };
  const targets = solveLevelTargets(sub);
  if (!targets) return undefined;
  const lead: CertificateEntry[] = [];
  let state = createGameState(sub);
  for (const target of targets) {
    const result = simulateGameMove(
      sub,
      state,
      target.arrowId,
      target.endpoint,
    );
    if (result.kind === "paused") {
      if (target.endpoint !== "head") return undefined;
      lead.push(`${PARK_CERTIFICATE_PREFIX}${target.arrowId}`);
    } else if (result.kind === "exit") {
      lead.push(target);
    } else {
      return undefined;
    }
    state = applyMove(sub, state, result);
  }
  return lead;
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
  spotFaces: readonly FaceId[] = [],
  spotForbidden: ReadonlySet<string> = new Set(),
): ParkingCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "park-core", restart);
  // A pattern with its own spots spends the cube's static-spot plan, so it
  // is only drawn on a pass that plans spots, and only onto a planned face.
  const catalog = (
    id <= 10 ? PARK_PATTERNS.slice(0, LEGACY_PARK_PATTERN_COUNT) : PARK_PATTERNS
  ).filter((pattern) => !pattern.spots || spotFaces.length > 0);
  const patternCost = (pattern: (typeof PARK_PATTERNS)[number]): number =>
    pattern.stops.length + (pattern.second?.stops.length ?? 0);
  const eligible = catalog.filter(
    (pattern) => patternCost(pattern) <= stopCount,
  );
  const pattern = eligible[
    rng.int(eligible.length)
  ] as (typeof PARK_PATTERNS)[number];
  const faces = pattern.spots
    ? shuffledFaces(rng).filter((face) => spotFaces.includes(face))
    : shuffledFaces(rng);
  const units = [
    { parker: pattern.parker, stops: pattern.stops, others: pattern.others },
    ...(pattern.second
      ? [
          {
            parker: pattern.second.parker,
            stops: pattern.second.stops,
            others: pattern.second.others,
          },
        ]
      : []),
  ];
  const parkerIds = units.map((_, index) =>
    index === 0 ? `r${id}-park-p` : `r${id}-park-q`,
  );
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const base: Cell = {
      face,
      x: 1 + rng.int(Math.max(1, size - 2)),
      y: 1 + rng.int(Math.max(1, size - 2)),
    };
    const parkerPaths = units.map((unit) =>
      unit.parker.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
    );
    // A second unit's exit lanes cross the first unit's cells, so the first
    // unit must unwind first; the certificate drives arrows last-placed-first,
    // so the second unit's followers place before the first's. Single-unit
    // patterns are unaffected by the reversal.
    const followerPaths = [...units]
      .reverse()
      .flatMap((unit) =>
        unit.others.map((deltas) =>
          deltas.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
        ),
      );
    const stops = units.flatMap((unit) =>
      unit.stops.map(({ dx, dy }) => patternCell(base, dx, dy, rotation)),
    );
    const spots: DirectionalSpotDefinition[] = (pattern.spots ?? []).map(
      ({ dx, dy, heading }) => ({
        cell: patternCell(base, dx, dy, rotation),
        heading: rotateHeading(heading, rotation),
      }),
    );
    const cells = [
      ...parkerPaths.flat(),
      ...followerPaths.flat(),
      ...stops,
      ...spots.map((spot) => spot.cell),
    ];
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
      ) ||
      spots.some((spot) => spotForbidden.has(cellKey(spot.cell)))
    )
      continue;
    const rayClear = (path: readonly Cell[]): boolean => {
      if (spots.length > 0) {
        // A spot bends the route, so the arrow's whole solo drive is checked
        // instead of the straight ray from its head.
        const probe: LevelDefinition = {
          ...level,
          arrows: [{ id: "probe", path }],
          directionals: spots,
        };
        const alone = simulateMove(probe, ["probe"], "probe");
        return (
          alone.kind === "exit" &&
          alone.route
            .slice(1)
            .every(
              (cell) =>
                patternKeys.has(cellKey(cell)) || !occupied.has(cellKey(cell)),
            )
        );
      }
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
      ...parkerPaths.map((path, index) => ({
        id: parkerIds[index] as string,
        path,
      })),
      ...followerPaths.map((path, index) => ({
        id: `r${id}-${PARK_FOLLOWER_IDS[index]}`,
        path,
      })),
    ];
    if (!arrows.every((arrow) => rayClear(arrow.path))) continue;
    // The core drives last in the level's certificate, against an otherwise
    // empty cube with the park legs already applied; prove that tail here so
    // a hostile wrap config rejects this placement instead of the level.
    const coreLevel: LevelDefinition = {
      ...level,
      arrows,
      stops,
      ...(spots.length > 0 ? { directionals: spots } : {}),
    };
    const parkLegs = units.flatMap((unit, index) =>
      Array.from(
        { length: unit.stops.length },
        () => `${PARK_CERTIFICATE_PREFIX}${parkerIds[index]}`,
      ),
    );
    const certificate = [
      ...parkLegs,
      ...[...arrows].reverse().map((arrow) => arrow.id),
    ];
    if (!replayCertificate(coreLevel, certificate)) continue;
    // Core arrows may park into each other's lanes; every collision-free
    // order through the isolated core must still clear it.
    if (hasStrandingState(coreLevel) !== false) continue;
    return { arrows, stops, spots, parkLegs };
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
 * How many directional spots one traverser may bend through: single-bend
 * cubes before the chain ramp opens a second bend at level 21 and a third at
 * level 40.
 */
export function chainDepthLimit(id: number): 1 | 2 | 3 {
  assertLevelId(id);
  if (id < FIRST_DIRECTIONAL_LEVEL) return 1;
  if (id < 40) return 2;
  return 3;
}

/**
 * How many faces of a generated cube carry directional spots: the authored
 * intro carries exactly one spot-bearing face; from the level after it, every
 * cube draws zero through four on its own seeded stream (uniform), so the
 * split is stable across sessions.
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
  spotForbidden: ReadonlySet<string> = new Set(),
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
    if (spotForbidden.has(cellKey(spotCell))) continue;
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
 * the core. Candidates whose traversers have already bent through an earlier
 * placed spot are preferred first, so extra spots deliberately chain into
 * multi-bend routes up to the level's `chainDepthLimit`; plain single-bend
 * candidates fill in once the chain opportunities are exhausted. A candidate
 * is only placed if every traverser, simulated alone with the candidate in
 * place, still exits cleanly and its bent route avoids every arrow that
 * replays before it and the parking core's tracks; the certificate replay
 * below remains the final arbiter.
 */
function extraDirectionalSpots(
  id: number,
  level: LevelDefinition,
  arrows: readonly ArrowDefinition[],
  occupied: Set<string>,
  plan: readonly ExtraSpotPlanEntry[],
  coreFace: FaceId | undefined,
  spotForbidden: ReadonlySet<string> = new Set(),
): readonly DirectionalSpotDefinition[] {
  const limit = chainDepthLimit(id);
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
    const room = count - (coreFace === face ? 1 : 0);
    for (let placed = 0; placed < room; placed += 1) {
      const spotLevel: LevelDefinition = {
        ...level,
        ...(spots.length > 0
          ? { directionals: [...(level.directionals ?? []), ...spots] }
          : {}),
      };
      // Candidates from the post-spot tracks, each tagged with how many bends
      // its first traverser has already taken before the cell.
      const pool = new Map<
        string,
        {
          cell: Cell;
          heading: Heading;
          traversers: number[];
          depths: number[];
        }
      >();
      const spotCells = new Set(
        (spotLevel.directionals ?? []).map((spot) => cellKey(spot.cell)),
      );
      for (let index = 0; index < arrows.length; index += 1) {
        const arrow = arrows[index] as ArrowDefinition;
        if (arrow.id.startsWith(`r${id}-park-`)) continue;
        const track = arrowTrack(spotLevel, arrow);
        let bends = 0;
        for (let step = 1; step < track.length; step += 1) {
          const cell = track[step] as Cell;
          if (spotCells.has(cellKey(cell))) bends += 1;
          if (cell.face !== face) continue;
          const key = cellKey(cell);
          if (
            occupied.has(key) ||
            parkTrackKeys.has(key) ||
            spotForbidden.has(key)
          )
            continue;
          const heading = headingForPath(
            [track[step - 1] as Cell, cell],
            level.gridSize,
          );
          if (!heading) continue;
          const entry = pool.get(key) ?? {
            cell,
            heading,
            traversers: [],
            depths: [],
          };
          entry.traversers.push(index);
          entry.depths.push(bends);
          pool.set(key, entry);
        }
      }
      if (pool.size === 0) break;
      const entries = [...pool.values()];
      const shuffle = (list: typeof entries): typeof entries => {
        for (let index = list.length - 1; index > 0; index -= 1) {
          const replacement = rng.int(index + 1);
          const current = list[index] as (typeof entries)[number];
          list[index] = list[replacement] as typeof current;
          list[replacement] = current;
        }
        return list;
      };
      // Chain candidates first: corridor cells past an already-placed bend,
      // and only while every traverser stays inside the depth budget.
      const chained = entries.filter(
        (entry) =>
          entry.depths.some((depth) => depth >= 1) &&
          Math.max(...entry.depths) + 1 <= limit,
      );
      const plain = entries.filter((entry) =>
        entry.depths.every((depth) => depth === 0),
      );
      let accepted = false;
      for (const { cell, heading, traversers } of [
        ...shuffle(chained),
        ...shuffle(plain),
      ]) {
        const key = cellKey(cell);
        if (occupied.has(key)) continue;
        const turn = PERPENDICULAR[heading][rng.int(2)] as Heading;
        const trial: LevelDefinition = {
          ...spotLevel,
          directionals: [
            ...(spotLevel.directionals ?? []),
            { cell, heading: turn },
          ],
        };
        // The pre-trial depth tag only counts bends before this cell on the
        // OLD route; the new spot can redirect a traverser onto a path that
        // crosses spots the tag never saw (an earlier-placed spot further
        // along, or a spot on another face reached via the new turn). Recheck
        // each traverser's TOTAL bend count against the actual post-trial
        // track rather than trusting the tag.
        const trialSpots = new Set(
          (trial.directionals ?? []).map((spot) => cellKey(spot.cell)),
        );
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
          const totalBends = arrowTrack(trial, arrows[traverser]!!).filter(
            (routeCell) => trialSpots.has(cellKey(routeCell)),
          ).length;
          if (totalBends > limit) {
            fits = false;
            break;
          }
        }
        if (!fits) continue;
        occupied.add(key);
        spots.push({ cell, heading: turn });
        accepted = true;
        break;
      }
      if (!accepted) break;
    }
  }
  return spots;
}

/**
 * Head-on static spots that bounce a plain arrow back over its own body into
 * a lane another arrow's track uses, best-effort and after every core. Each
 * spot comes out of a planned face's remaining room. A candidate cell sits
 * on the bounced arrow's own route with its heading reversed, and is kept
 * only when the bounced lane — the new route past the arrow's own body —
 * meets exactly one other arrow's track, and every arrow that now crosses
 * the cell (the bounced one included) still exits alone, bends no more than
 * `chainDepthLimit` times, and keeps its route off every arrow that replays
 * before it and off `forbidden` (the parking core's tracks and the flip
 * region). The certificate replay remains the final arbiter.
 */
function reversalBlockers(
  id: number,
  level: LevelDefinition,
  arrows: readonly ArrowDefinition[],
  occupied: Set<string>,
  room: ReadonlyMap<FaceId, number>,
  forbidden: ReadonlySet<string>,
): readonly DirectionalSpotDefinition[] {
  const limit = chainDepthLimit(id);
  const rng = new Rng(hashSeed(`${seedForLevel(id)}:reversal`));
  const wanted = 1 + rng.int(2);
  const remaining = new Map(room);
  const cellsBefore: Set<string>[] = [];
  let running = new Set<string>();
  for (const arrow of arrows) {
    cellsBefore.push(running);
    running = new Set([...running, ...arrow.path.map(cellKey)]);
  }
  const plain = arrows.filter(
    (arrow) =>
      arrow.kind !== "double" &&
      /^r\d+-(\d+|block-\d+|straight-\d+|wrap-\d+)$/.test(arrow.id),
  );
  for (let index = plain.length - 1; index > 0; index -= 1) {
    const replacement = rng.int(index + 1);
    const current = plain[index] as ArrowDefinition;
    plain[index] = plain[replacement] as ArrowDefinition;
    plain[replacement] = current;
  }
  const spots: DirectionalSpotDefinition[] = [];
  for (const arrow of plain) {
    if (spots.length >= wanted) break;
    const board: LevelDefinition = {
      ...level,
      directionals: [...(level.directionals ?? []), ...spots],
    };
    const track = arrowTrack(board, arrow);
    for (let step = arrow.path.length; step < track.length; step += 1) {
      const cell = track[step] as Cell;
      const key = cellKey(cell);
      if ((remaining.get(cell.face) ?? 0) <= 0) continue;
      if (occupied.has(key) || forbidden.has(key)) continue;
      const arriving = headingForPath(
        [track[step - 1] as Cell, cell],
        level.gridSize,
      );
      if (!arriving) continue;
      const spot: DirectionalSpotDefinition = {
        cell,
        heading: oppositeHeading(arriving),
      };
      const trial: LevelDefinition = {
        ...board,
        directionals: [...(board.directionals ?? []), spot],
      };
      const trialSpots = new Set(
        (trial.directionals ?? []).map((entry) => cellKey(entry.cell)),
      );
      const traversers = arrows
        .map((candidate, position) => ({ candidate, position }))
        .filter(({ candidate }) => trackKeys(board, candidate).includes(key));
      if (traversers.some(({ candidate }) => candidate.kind === "double"))
        continue;
      const fits = traversers.every(({ candidate, position }) => {
        const alone = simulateMove(trial, [candidate.id], candidate.id);
        if (alone.kind !== "exit") return false;
        const own = new Set(candidate.path.map(cellKey));
        if (
          alone.route.some((routeCell) => {
            const routeKey = cellKey(routeCell);
            return (
              forbidden.has(routeKey) ||
              (!own.has(routeKey) &&
                (cellsBefore[position] as Set<string>).has(routeKey))
            );
          })
        )
          return false;
        return (
          arrowTrack(trial, candidate).filter((routeCell) =>
            trialSpots.has(cellKey(routeCell)),
          ).length <= limit
        );
      });
      if (!fits) continue;
      const own = new Set(arrow.path.map(cellKey));
      const bounced = arrowTrack(trial, arrow).slice(arrow.path.length);
      const turn = bounced.findIndex((routeCell) => cellKey(routeCell) === key);
      const lane = new Set(
        bounced
          .slice(turn + 1)
          .map(cellKey)
          .filter((laneKey) => !own.has(laneKey)),
      );
      if (lane.size === 0) continue;
      const crossed = arrows.filter(
        (other) =>
          other.id !== arrow.id &&
          trackKeys(trial, other).some((otherKey) => lane.has(otherKey)),
      );
      if (crossed.length !== 1) continue;
      if (!validateLevel({ ...trial, arrows: [...arrows] }).valid) continue;
      occupied.add(key);
      remaining.set(cell.face, (remaining.get(cell.face) ?? 0) - 1);
      spots.push(spot);
      break;
    }
  }
  return spots;
}

/**
 * A test for circles that can never strand a level. Parking moves an arrow
 * onto new cells, and a new cell on another arrow's track can block that
 * arrow while its body blocks the parked one. A circle passes only when every
 * unit that can park on it reaches it before any member leaves and keeps
 * every new cell off every other arrow's track, so parking there only ever
 * frees cells for the rest of the board. Double arrows never park on a
 * passing circle. Parking-core arrows may block one another on the core's own
 * circles, which `parkingCore` proves safe by enumeration; any other circle
 * on a core track is rejected so the core behaves exactly as enumerated.
 */
function strandSafeCircle(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies" | "directionals">,
  arrows: readonly ArrowDefinition[],
  coreIds: ReadonlySet<string>,
  role: "decorative" | "core",
): (cell: Cell) => boolean {
  const board: LevelDefinition = {
    ...level,
    id: 0,
    title: "",
    lives: 1,
    arrows,
  };
  const owners = new Map<string, Set<string>>();
  const visits = new Map<string, { arrow: ArrowDefinition; index: number }[]>();
  for (const arrow of arrows) {
    const paths =
      arrow.kind === "double"
        ? [arrow.path, [...arrow.path].reverse()]
        : [arrow.path];
    for (const path of paths) {
      const track = arrowTrack(level, { ...arrow, path });
      track.forEach((cell, index) => {
        const key = cellKey(cell);
        owners.set(key, (owners.get(key) ?? new Set()).add(arrow.id));
        if (index < arrow.path.length) return;
        visits.set(key, [...(visits.get(key) ?? []), { arrow, index }]);
      });
    }
  }
  return (cell) =>
    (visits.get(cellKey(cell)) ?? []).every(({ arrow, index }) => {
      if (arrow.kind === "double") return false;
      const core = coreIds.has(arrow.id);
      if (core && role === "decorative") return false;
      const unit = overlappingArrowIds(board, arrow.id);
      const members = arrows.filter((candidate) => unit.includes(candidate.id));
      const offset = index - arrow.path.length + 1;
      if (members.some((member) => offset > maximumOffset(level, member)))
        return false;
      const own = new Set(
        members.flatMap((member) => member.path.map(cellKey)),
      );
      return members.every((member) =>
        currentPath(level, member, offset).every((moved) => {
          const key = cellKey(moved);
          if (own.has(key)) return true;
          return [...(owners.get(key) ?? [])].every(
            (id) => unit.includes(id) || (core && coreIds.has(id)),
          );
        }),
      );
    });
}

/**
 * Choose decorative circles on cells some arrow's head actually travels
 * through, so a circle is always reachable rather than decorative. The
 * load-bearing circle arrives with the parking core; the extras must pass
 * `strandSafeCircle`, and a level places fewer of them when too few cells do.
 */
function chooseStops(
  id: number,
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies" | "directionals">,
  arrows: readonly ArrowDefinition[],
  occupied: ReadonlySet<string>,
  decorativeCount: number,
  coreIds: ReadonlySet<string>,
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
  return candidates
    .filter(strandSafeCircle(level, arrows, coreIds, "decorative"))
    .slice(0, decorativeCount);
}

/**
 * Replay a construction certificate. A park entry advances the named arrow to
 * its next circle and leaves it parked there; every other entry is driven
 * through its pauses until it exits before the next arrow is tried. Flip-spot
 * directions carry from move to move, as they do in play.
 */
type CertificateEntry = string | MoveTarget;

function replayCertificate(
  level: LevelDefinition,
  certificate: readonly CertificateEntry[],
): boolean {
  let remaining = level.arrows.map((arrow) => arrow.id);
  const offsets: Record<string, number> = {};
  const settledPaths: Record<string, readonly Cell[]> = {};
  const spotHeadings: Record<string, Heading> = {};
  const flipLevel = hasFlipSpots(level);
  const maximumLegs = level.gridSize * 6 + 2;
  const foldFlips = (result: MoveResult): void => {
    for (const member of result.members ?? [result]) {
      for (const flip of member.spotFlips ?? []) {
        spotHeadings[cellKey(flip.cell)] = flippedHeading(
          spotHeadingAt(level, flip.cell, spotHeadings) as Heading,
        );
      }
    }
  };
  // Mirrors `applyMove`: a double, or a lone single on a flip level, parks by
  // its exact settled path; everything else advances its group's offsets.
  const park = (arrowId: string, result: MoveResult): void => {
    const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
    const group = overlappingArrowIds(level, arrowId);
    if (
      result.settledPath &&
      (arrow?.kind === "double" || (flipLevel && group.length === 1))
    ) {
      settledPaths[arrowId] = result.settledPath;
    } else {
      for (const id of group) {
        offsets[id] = (offsets[id] ?? 0) + (result.pausedSteps ?? 0);
      }
    }
    foldFlips(result);
  };
  const attempt = (arrowId: string, endpoint: MoveTarget["endpoint"]) =>
    simulateMove(
      level,
      remaining,
      arrowId,
      endpoint,
      0,
      offsets,
      settledPaths,
      spotHeadings,
    );
  for (const entry of certificate) {
    const encoded = typeof entry === "string" ? entry : entry.arrowId;
    const endpoint = typeof entry === "string" ? "head" : entry.endpoint;
    const parkLeg = encoded.startsWith(PARK_CERTIFICATE_PREFIX);
    const arrowId = parkLeg
      ? encoded.slice(PARK_CERTIFICATE_PREFIX.length)
      : encoded;
    if (!remaining.includes(arrowId)) continue;
    if (parkLeg) {
      const result = attempt(arrowId, endpoint);
      if (result.kind !== "paused" || !result.pausedSteps) return false;
      park(arrowId, result);
      continue;
    }
    let cleared = false;
    for (let leg = 0; leg < maximumLegs && !cleared; leg += 1) {
      const result = attempt(arrowId, endpoint);
      if (result.kind === "exit") {
        foldFlips(result);
        cleared = true;
      } else if (result.kind === "paused" && result.pausedSteps) {
        park(arrowId, result);
      } else {
        return false;
      }
    }
    if (!cleared) return false;
    const clearedIds = overlappingArrowIds(level, arrowId);
    remaining = remaining.filter((id) => !clearedIds.includes(id));
    for (const id of clearedIds) {
      delete offsets[id];
      delete settledPaths[id];
    }
  }
  return remaining.length === 0;
}

/** Replay the certificate of a level that passes validation. */
function validateGenerated(
  level: LevelDefinition,
  certificate: readonly CertificateEntry[],
): boolean {
  return validateLevel(level).valid && replayCertificate(level, certificate);
}

/**
 * Build a pure, reproducible level. Insertion is reverse construction: each
 * arrow has an exit unobstructed by earlier arrows, so reverse insertion is a
 * real no-mistake solution certificate. Levels carrying stop circles also embed
 * the parking core, whose circles are reserved from every later arrow so the
 * replayed certificate — the park legs, then the reverse drive — can never
 * fail because of parking. A flip core's proven interaction region is
 * reserved the same way, and the region's own solution leads the certificate.
 */
export function generateLevel(id: number): LevelDefinition {
  assertLevelId(id);
  if (id === 1) return LEVEL_ONE;
  if (id === 5) return STOP_INTRO_LEVEL;
  if (id === 11) return WRAP_INTRO_LEVEL;
  if (id === 15) return OVERLAP_INTRO_LEVEL;
  if (id === 20) return DIRECTIONAL_INTRO_LEVEL;
  if (id === 25) return DOUBLE_INTRO_LEVEL;
  if (id === 30) return FLIP_INTRO_LEVEL;
  const config = getLevelConfig(id);
  const baseSeed = hashSeed(seedForLevel(id));
  const edgePolicies = getWrappingEdgePolicies(id);
  let skip = "never-entered";
  // The ordinary passes: the first builds the planned directional layout; if
  // every restart of that pass fails its replay, the second rebuilds the same
  // id with the plan forced empty — a cube without spots is always legal, and
  // generation must never give up on an id.
  const plannedSpotPlan = directionalFacePlan(id);
  // Acceptance tiers, tried strictly in order. Tier one's ordinary passes are
  // the historical exact-count, certificate-replayed construction. A later
  // tier only sees an id that every earlier tier rejected across both spot
  // plans and all eight restarts: it trades exact density and, in the last
  // tier, the reverse-construction certificate for a solver-proven level
  // instead of throwing.
  const reserve = blockerReserve(id);
  const tiers = [
    { minArrows: config.arrowCount, certificate: true },
    { minArrows: config.arrowCount - 12, certificate: true },
    { minArrows: config.arrowCount - 12, certificate: false },
  ];
  // A planned flip core gets its own pass ahead of every tier's ordinary
  // passes. The flip pass shares no stream with them, so a level that ends
  // without a flip core comes out of the ordinary passes exactly as it would
  // with no flip plan at all.
  const flipPlanned =
    flipCoreFrequency(id) > 0 &&
    coreStream(id, "flip-plan", 0).next() < flipCoreFrequency(id);
  for (const tier of tiers) {
    const passes = [
      ...(flipPlanned ? [{ spotPlan: plannedSpotPlan, flipPass: true }] : []),
      { spotPlan: plannedSpotPlan, flipPass: false },
      { spotPlan: [] as readonly number[], flipPass: false },
    ];
    for (const { spotPlan, flipPass } of passes) {
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
        let double: DoubleCore | undefined;
        const planFaceIds =
          spotPlan.length > 0
            ? shuffledFaces(
                new Rng(hashSeed(`${seedForLevel(id)}:dir-faces`)),
              ).slice(0, spotPlan.length)
            : [];
        const directional = spotPlan.length > 0;
        // Every cell a shared-tail member's track reaches. A group moves on
        // one shared offset along those static tracks, so no spot, static or
        // flip, may ever land on one of them.
        const groupTracks = new Set<string>();
        if (id >= 16) {
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
            for (const cell of arrowTrack(candidateLevel, arrow)) {
              groupTracks.add(cellKey(cell));
            }
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
                planFaceIds,
                groupTracks,
              )
            : undefined;
        // Spots that ship with the parking core; they bend only the core's
        // own routes, because every later arrow keeps its straight ray off
        // their reserved cells.
        const parkSpots = core?.spots ?? [];
        const parkBoard = {
          ...candidateLevel,
          ...(parkSpots.length > 0 ? { directionals: parkSpots } : {}),
        };
        if (core) {
          for (const arrow of core.arrows) {
            if (!validateLevel({ ...parkBoard, arrows: [arrow] }).valid)
              throw new Error("Seeded parking-core arrow was invalid.");
            for (const cell of arrow.path) occupied.add(cellKey(cell));
            arrows.push(arrow);
          }
          for (const stop of core.stops) occupied.add(cellKey(stop));
          for (const spot of parkSpots) occupied.add(cellKey(spot.cell));
        }
        // The park legs lead the certificate replay, so the parked windows along
        // the park core's routes block everything that drives after them. The
        // directional core checks these tracks in addition to `occupied`; they are
        // deliberately NOT reserved globally, which would shift every circle
        // cube's layout.
        const parkTrackKeys = new Set<string>();
        if (core) {
          for (const arrow of core.arrows) {
            for (const cell of arrowTrack(parkBoard, arrow)) {
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
              groupTracks,
            )
          : undefined;
        // A parking core's own spot is part of the static-spot plan, which
        // always carries the required head-on core as well.
        if (parkSpots.length > 0 && !directionalSpot) {
          skip = "park-spot";
          continue construction;
        }
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
        double = tier.certificate
          ? doubleCore(id, { ...candidateLevel, arrows }, occupied, restart)
          : undefined;
        if (double) {
          for (const arrow of double.arrows) {
            arrows.push(arrow);
            for (const path of [arrow.path, [...arrow.path].reverse()]) {
              for (const cell of arrowTrack(candidateLevel, {
                ...arrow,
                path,
              })) {
                occupied.add(cellKey(cell));
              }
            }
          }
        }
        const flip = flipPass
          ? flipCore(
              id,
              {
                ...candidateLevel,
                arrows,
                ...(directionalSpot || parkSpots.length > 0
                  ? {
                      directionals: [
                        ...(directionalSpot ? [directionalSpot.spot] : []),
                        ...parkSpots,
                      ],
                    }
                  : {}),
                ...(core ? { stops: core.stops } : {}),
              },
              occupied,
              new Set([...parkTrackKeys, ...groupTracks]),
              getStopCount(id) - (core ? core.stops.length : 0),
              restart,
            )
          : undefined;
        if (flipPass && !flip) {
          skip = "flip-core";
          continue construction;
        }
        if (flip) {
          for (const arrow of flip.arrows) arrows.push(arrow);
          for (const key of flip.cells) occupied.add(key);
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
        // Shared-tail members may never have another arrow on their travel
        // route, so blockers avoid every group member's solo route. Computed
        // lazily and memoized: cheap relative to construction, but only
        // needed when a blocker pass actually runs.
        let blockerScaffold:
          | { groupRouteCells: Set<string>; aheadKeys: string[][] }
          | undefined;
        const ensureBlockerScaffold = () => {
          if (blockerScaffold) return blockerScaffold;
          const groupRouteCells = new Set<string>();
          for (const arrow of arrows) {
            const group = overlappingArrowIds(
              { ...candidateLevel, arrows },
              arrow.id,
            );
            if (group.length < 2) continue;
            for (const memberId of group) {
              const route = simulateMove(
                { ...candidateLevel, arrows },
                [memberId],
                memberId,
              );
              for (const cell of route.route) {
                groupRouteCells.add(cellKey(cell));
              }
            }
          }
          const aheadKeys = arrows.map((arrow) =>
            arrowTrack(candidateLevel, arrow)
              .slice(arrow.path.length)
              .map(cellKey),
          );
          blockerScaffold = { groupRouteCells, aheadKeys };
          return blockerScaffold;
        };
        let blockedUnits = 0;
        let totalUnits = 0;
        let placed = 0;
        // Places up to the remaining reserve, scored against `boardForScoring`
        // — the object whose `blocked`/`paused` split decides whether a
        // candidate actually helps. The bare board (first call, below) is a
        // cheap estimate; once stops and directionals are known, a second
        // call re-scores against the fully assembled level, since a stop can
        // turn `blocked` into `paused` and a spot can bend a route clear.
        const runBlockerPass = (
          boardForScoring: Pick<
            LevelDefinition,
            "gridSize" | "edgePolicies" | "directionals" | "stops"
          >,
        ): void => {
          const { groupRouteCells, aheadKeys } = ensureBlockerScaffold();
          for (
            let attempt = 0;
            placed < reserve && arrows.length < 264 && attempt < reserve * 60;
            attempt += 1
          ) {
            if (
              totalUnits > 0 &&
              blockedUnits / totalUnits >= blockedTarget(id) - 0.06
            )
              break;
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
            if (path.some((cell) => groupRouteCells.has(cellKey(cell))))
              continue;
            const blocker: ArrowDefinition = {
              id: `r${id}-block-${placed}`,
              path,
            };
            if (!validateLevel({ ...candidateLevel, arrows: [blocker] }).valid)
              continue;
            const pathKeys = new Set(path.map(cellKey));
            const affected: number[] = [];
            aheadKeys.forEach((keys, index) => {
              if (keys.some((key) => pathKeys.has(key))) affected.push(index);
            });
            if (affected.length === 0) continue;
            const blockedAmong = (board: readonly ArrowDefinition[]): number =>
              affected.filter(
                (index) =>
                  simulateMove(
                    { ...candidateLevel, ...boardForScoring, arrows: board },
                    board.map((entry) => entry.id),
                    arrows[index]!.id,
                  ).kind === "blocked",
              ).length;
            const before = blockedAmong(arrows);
            const after = blockedAmong([...arrows, blocker]);
            if (after <= before) continue;
            for (const cell of path) occupied.add(cellKey(cell));
            arrows.push(blocker);
            aheadKeys.push(
              arrowTrack(candidateLevel, blocker)
                .slice(blocker.path.length)
                .map(cellKey),
            );
            blockedUnits += after - before;
            totalUnits += 1;
            placed += 1;
          }
        };
        const naturalStats = blockedStats({ ...candidateLevel, arrows });
        if (
          reserve > 0 &&
          naturalStats.total > 0 &&
          naturalStats.blocked / naturalStats.total < blockedTarget(id) - 0.06
        ) {
          blockedUnits = naturalStats.blocked;
          totalUnits = naturalStats.total;
          runBlockerPass(candidateLevel);
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
                  directionals: [directionalSpot.spot, ...parkSpots],
                },
                arrows,
                occupied,
                bearingFaces
                  .filter((face) => face !== coreFace)
                  .map((face) => ({
                    face,
                    count:
                      (spotPlan[planFaceIds.indexOf(face)] as number) -
                      parkSpots.filter((spot) => spot.cell.face === face)
                        .length,
                  })),
                coreFace,
                groupTracks,
              )
            : [];
        // Reversal blockers spend whatever room the plan's faces have left.
        const planned = [
          ...(directionalSpot ? [directionalSpot.spot, ...extraSpots] : []),
          ...parkSpots,
        ];
        const reversalRoom = new Map<FaceId, number>(
          bearingFaces.map((face) => [
            face,
            (spotPlan[planFaceIds.indexOf(face)] ?? 1) -
              planned.filter((spot) => spot.cell.face === face).length,
          ]),
        );
        const reversalSpots = directionalSpot
          ? reversalBlockers(
              id,
              {
                ...candidateLevel,
                arrows,
                directionals: [...planned, ...(flip ? flip.spots : [])],
              },
              arrows,
              occupied,
              reversalRoom,
              new Set([...parkTrackKeys, ...(flip ? flip.cells : [])]),
            )
          : [];
        const spots = [
          ...(directionalSpot
            ? [directionalSpot.spot, ...extraSpots, ...reversalSpots]
            : []),
          ...parkSpots,
          ...(flip ? flip.spots : []),
        ];
        const coreIds = new Set(core?.arrows.map((arrow) => arrow.id) ?? []);
        const stopBoard = {
          ...candidateLevel,
          ...(spots.length > 0 ? { directionals: spots } : {}),
        };
        // Circles the flip region was proven with come out of the decorative
        // budget, so the level still carries exactly `getStopCount(id)`.
        const regionStops = flip ? flip.stops : [];
        const placeStops = (): readonly Cell[] => {
          const decorative = chooseStops(
            id,
            stopBoard,
            arrows,
            occupied,
            getStopCount(id) -
              (core ? core.stops.length : 0) -
              regionStops.length,
            coreIds,
          );
          return [...(core ? core.stops : []), ...regionStops, ...decorative];
        };
        const assemble = (stops: readonly Cell[]): LevelDefinition => ({
          ...candidateLevel,
          arrows,
          ...(stops.length > 0 ? { stops } : {}),
          ...(spots.length > 0 ? { directionals: spots } : {}),
        });
        // `level.arrows` is the SAME array as `arrows`: a later push (the
        // assembled-board top-up below) is visible through `level` without
        // rebuilding it.
        let level = assemble(placeStops());
        if (
          directional &&
          !level.arrows.some(
            (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
          )
        ) {
          skip = "faces";
          continue;
        }
        let assembledStats = blockedStats(level);
        if (
          reserve > 0 &&
          placed < reserve &&
          assembledStats.total > 0 &&
          assembledStats.blocked / assembledStats.total <
            blockedTarget(id) - 0.06
        ) {
          // The bare-board estimate above said the natural fill already met
          // target (or never ran the pass at all), but stops turn `blocked`
          // into `paused` and spots bend routes, so the assembled level can
          // still fall short. Top up against the real board rather than
          // silently accepting a below-target level — including in the
          // no-certificate fallback tier, which has no share gate of its own
          // and must not thrash into silent under-target acceptance.
          blockedUnits = assembledStats.blocked;
          totalUnits = assembledStats.total;
          const placedBefore = placed;
          runBlockerPass(level);
          // A new blocker's track can cross a circle's parked window, so the
          // circles are chosen again against the final arrows.
          if (placed > placedBefore) level = assemble(placeStops());
          assembledStats = blockedStats(level);
        }
        if (
          core &&
          !core.stops.every(
            strandSafeCircle(stopBoard, arrows, coreIds, "core"),
          )
        ) {
          skip = "strand";
          continue;
        }
        if (
          tier.certificate &&
          assembledStats.total > 0 &&
          assembledStats.blocked / assembledStats.total <
            blockedTarget(id) - 0.06
        ) {
          skip = "blockers";
          continue;
        }
        // Built after any assembled-board top-up so newly placed blockers —
        // always the latest-pushed `arrows` entries — lead the reversed
        // replay, matching the reverse-construction safety argument.
        const doubleIds = new Set(
          double?.arrows.map((arrow) => arrow.id) ?? [],
        );
        // The flip region is proven again on the assembled level: later
        // spots, circles and blockers can bend tracks toward it, and nothing
        // outside it may ever reach its cells. Its own solution leads.
        const flipLead = flip ? flipRegionLead(level) : [];
        const certificate: CertificateEntry[] = [
          ...(double ? double.certificate : []),
          ...(core ? core.parkLegs : []),
          ...(directionalSpot
            ? directionalSpot.arrows.map((arrow) => arrow.id)
            : []),
          ...[...arrows]
            .reverse()
            .filter((arrow) => !doubleIds.has(arrow.id))
            .map((arrow) => arrow.id),
        ];
        const accepted =
          flipLead !== undefined &&
          (tier.certificate
            ? validateGenerated(level, [...flipLead, ...certificate])
            : validateLevel(level).valid &&
              solveLevelTargets(level) !== undefined);
        if (accepted) return level;
        skip = flipLead ? "replay" : "flip";
        if (extraSpots.length + reversalSpots.length > 0 && directionalSpot) {
          // Extra spots bend real routes and can break the replay; the required
          // core alone replays against the same certificate, so fall back to it
          // rather than dropping directionals entirely.
          // Fewer spots change the tracks, so circles are chosen again.
          const coreBoard = {
            ...candidateLevel,
            directionals: [
              directionalSpot.spot,
              ...parkSpots,
              ...(flip ? flip.spots : []),
            ],
          };
          const coreStops = [
            ...(core ? core.stops : []),
            ...regionStops,
            ...chooseStops(
              id,
              coreBoard,
              arrows,
              occupied,
              getStopCount(id) -
                (core ? core.stops.length : 0) -
                regionStops.length,
              coreIds,
            ),
          ];
          const coreOnly: LevelDefinition = {
            ...coreBoard,
            arrows,
            ...(coreStops.length > 0 ? { stops: coreStops } : {}),
          };
          const coreLead = flip ? flipRegionLead(coreOnly) : [];
          const coreSafe =
            coreLead !== undefined &&
            (!core ||
              core.stops.every(
                strandSafeCircle(coreBoard, arrows, coreIds, "core"),
              ));
          const coreAccepted =
            coreSafe &&
            (tier.certificate
              ? validateGenerated(coreOnly, [
                  ...(coreLead ?? []),
                  ...certificate,
                ])
              : validateLevel(coreOnly).valid &&
                solveLevelTargets(coreOnly) !== undefined);
          if (coreAccepted) return coreOnly;
        }
      }
    }
  }
  throw new Error(
    `Could not deterministically construct runtime level ${id} (last skip: ${skip}).`,
  );
}
