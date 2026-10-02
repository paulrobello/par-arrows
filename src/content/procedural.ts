import { advancedSpotHeading, hasStatefulSpots } from "../core/directionals";
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
  headingBetween,
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
  LockDefinition,
  MirrorDefinition,
  MoveResult,
  MoveTarget,
  WormholeDefinition,
} from "../core/types";
import {
  flipHeadingProbes,
  hasSoftLockState,
  hasStrandingState,
  interactionRegion,
  occupancyKeys,
  proveRegion,
  selfPassageError,
  solveLevel,
  solveLevelTargets,
  validateLevel,
} from "../core/validation";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "./intro";
import {
  dependencyFill,
  type FillNode,
  type FillResult,
} from "./dependency-fill";
import { clearShare, closureStats, meetsDepthGate } from "./difficulty";
import { DIRECTIONAL_INTRO_LEVEL } from "./directional-intro";
import { DOUBLE_INTRO_LEVEL } from "./double-intro";
import { FLIP_INTRO_LEVEL } from "./flip-intro";
import { FRAGILE_INTRO_LEVEL } from "./fragile-intro";
import { LOCK_INTRO_LEVEL } from "./lock-intro";
import { MIRROR_INTRO_LEVEL } from "./mirror-intro";
import { OVERLAP_INTRO_LEVEL } from "./overlap-intro";
import { ROTOR_INTRO_LEVEL } from "./rotor-intro";
import { STOP_INTRO_LEVEL } from "./stop-intro";
import { WORMHOLE_INTRO_LEVEL } from "./wormhole-intro";

export const GENERATOR_VERSION = 10;

/** Absolute arrow ceiling: the largest fill target `getLevelConfig` returns. */
export const MAX_GENERATED_ARROWS = 200;
export const MAX_LEVEL_ID = Number.MAX_SAFE_INTEGER - 1;

/** Authored teaching cubes; every other id is generated at runtime. */
export const AUTHORED_LEVEL_IDS: readonly number[] = [
  1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55,
];

const AUTHORED = new Set(AUTHORED_LEVEL_IDS);

/** True for the hand-authored teaching cubes. */
export function isAuthoredLevel(id: number): boolean {
  assertLevelId(id);
  return AUTHORED.has(id);
}

/**
 * The authored teaching cubes, indexed by id. Every authored-aware plan
 * helper reads its cube through this table so the plan and the actual cube
 * can never disagree; generated ids roll their own seeded streams instead.
 */
const AUTHORED_LEVELS: ReadonlyMap<number, LevelDefinition> = new Map([
  [1, LEVEL_ONE],
  [5, STOP_INTRO_LEVEL],
  [11, WRAP_INTRO_LEVEL],
  [15, OVERLAP_INTRO_LEVEL],
  [20, DIRECTIONAL_INTRO_LEVEL],
  [25, DOUBLE_INTRO_LEVEL],
  [30, FLIP_INTRO_LEVEL],
  [35, WORMHOLE_INTRO_LEVEL],
  [40, ROTOR_INTRO_LEVEL],
  [45, FRAGILE_INTRO_LEVEL],
  [50, LOCK_INTRO_LEVEL],
  [55, MIRROR_INTRO_LEVEL],
]);

/** The hand-authored cube for an authored id, or undefined for generated ids. */
export function authoredLevel(id: number): LevelDefinition | undefined {
  assertLevelId(id);
  return AUTHORED_LEVELS.get(id);
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
  if (id === 1) return "par-arrows:runtime:1:level:1";
  if (id === 5) return "par-arrows:runtime:4:level:5:stop-intro:1";
  if (id === 11) return "par-arrows:runtime:2:level:11:wrap-intro:1";
  if (id === 15) return "par-arrows:runtime:3:level:15:overlap-intro:1";
  if (id === 20) return "par-arrows:runtime:4:level:20:directional-intro:1";
  if (id === 25) return "par-arrows:runtime:7:level:25:double-intro:1";
  if (id === 30) return "par-arrows:runtime:7:level:30:flip-intro:1";
  if (id === 35) return "par-arrows:runtime:7:level:35:wormhole-intro:1";
  if (id === 40) return "par-arrows:runtime:7:level:40:rotor-intro:1";
  if (id === 45) return "par-arrows:runtime:7:level:45:fragile-intro:1";
  if (id === 50) return "par-arrows:runtime:7:level:50:lock-intro:1";
  if (id === 55) return "par-arrows:runtime:7:level:55:mirror-intro:1";
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
  const gridSize = Math.min(18, 10 + Math.floor(id / 4));
  // Through level 42 the count never falls below 0.075 arrows per cell,
  // which raises coverage toward the 0.78 floor; the certificate tiers'
  // coverage restart is what holds the floor.
  return {
    gridSize,
    arrowCount: Math.min(
      MAX_GENERATED_ARROWS,
      id <= 42
        ? Math.max(36 + 2 * id, Math.round(0.075 * 6 * gridSize * gridSize))
        : id <= 57
          ? 150 + 2 * (id - 43)
          : 178 + 2 * (id - 57),
    ),
    lives: id <= 3 ? 5 : id <= 6 ? 4 : 3,
    arrowScale: gridSize / (id <= 3 ? 8 : id <= 6 ? 10 : 14),
  };
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

/** True when a generated level plans a flip core, on its own stream. */
export function flipCorePlanned(id: number): boolean {
  return (
    flipCoreFrequency(id) > 0 &&
    coreStream(id, "flip-plan", 0).next() < flipCoreFrequency(id)
  );
}

/** First generated level that can embed a rotor core. */
const FIRST_ROTOR_LEVEL = 41;

/** Probability that a generated level without a flip plan draws a rotor core. */
export function rotorCoreFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_ROTOR_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_ROTOR_LEVEL) / (90 - FIRST_ROTOR_LEVEL),
  );
  return 0.25 + 0.3 * progress;
}

/**
 * True when a generated level plans a rotor core. Levels are flip-or-rotor:
 * a flip plan wins and the rotor stream is never drawn. A rotor core carries
 * its own load-bearing circle taken from `getStopCount`, so a level with no
 * circle budget plans none.
 */
export function rotorCorePlanned(id: number): boolean {
  if (rotorCoreFrequency(id) === 0 || flipCorePlanned(id)) return false;
  if (getStopCount(id) < 1) return false;
  return coreStream(id, "rotor-plan", 0).next() < rotorCoreFrequency(id);
}

/** First generated level that can embed a fragile core. */
const FIRST_FRAGILE_LEVEL = 46;

/** Probability that a generated level attempts a fragile core. */
export function fragileCoreFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_FRAGILE_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_FRAGILE_LEVEL) / (90 - FIRST_FRAGILE_LEVEL),
  );
  return 0.25 + 0.3 * progress;
}

/** True when a generated level plans a fragile core, on its own stream. */
export function fragileCorePlanned(id: number): boolean {
  return (
    fragileCoreFrequency(id) > 0 &&
    coreStream(id, "fragile-plan", 0).next() < fragileCoreFrequency(id)
  );
}

/** First generated level that can embed a lock core. */
const FIRST_LOCK_LEVEL = 51;

/** Probability that a generated level attempts a lock core. */
export function lockCoreFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_LOCK_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_LOCK_LEVEL) / (90 - FIRST_LOCK_LEVEL),
  );
  return 0.25 + 0.3 * progress;
}

/** True when a generated level plans a lock core, on its own stream. */
export function lockCorePlanned(id: number): boolean {
  return (
    lockCoreFrequency(id) > 0 &&
    coreStream(id, "lock-plan", 0).next() < lockCoreFrequency(id)
  );
}

/** First generated level that can embed a mirror core. */
const FIRST_MIRROR_LEVEL = 56;

/** Probability that a generated level attempts a mirror core. */
export function mirrorCoreFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_MIRROR_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_MIRROR_LEVEL) / (90 - FIRST_MIRROR_LEVEL),
  );
  return 0.25 + 0.3 * progress;
}

/** True when a generated level plans a mirror core, on its own stream. */
export function mirrorCorePlanned(id: number): boolean {
  return (
    mirrorCoreFrequency(id) > 0 &&
    coreStream(id, "mirror-plan", 0).next() < mirrorCoreFrequency(id)
  );
}

/** First generated level that can embed a wormhole core. */
const FIRST_WORMHOLE_LEVEL = 36;

/** Probability that a generated level attempts a wormhole core. */
export function wormholeFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_WORMHOLE_LEVEL || isAuthoredLevel(id)) return 0;
  return 0.25 + 0.35 * Math.min(1, (id - 36) / 54);
}

/**
 * How many wormholes the level tries for: the first draw beats the
 * frequency curve, and from level 50 a second draw on the same stream
 * upgrades a hit to two with probability 0.3. Plan zero draws nothing
 * else, so every zero-wormhole level constructs exactly as before.
 */
export function wormholePlan(id: number): 0 | 1 | 2 {
  assertLevelId(id);
  if (id < FIRST_WORMHOLE_LEVEL) return 0;
  const rng = coreStream(id, "wormhole-plan", 0);
  if (rng.next() >= wormholeFrequency(id)) return 0;
  if (id >= 50 && rng.next() < 0.3) return 2;
  return 1;
}

export class Rng {
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
 * plain stream name; later attempts salt it, because a deterministic core
 * that fails its certificate replay would otherwise fail identically on
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

/** First generated id whose fill caps repeated shapes. */
const FIRST_SHAPE_CAPPED_LEVEL = 2;

/** Most copies of one canonical shape a level of `arrowCount` arrows may carry. */
export function shapeCap(arrowCount: number): number {
  return Math.max(6, Math.ceil(arrowCount * 0.03));
}

/**
 * A single-face path's shape as run lengths and relative turns, canonical
 * under rotation, mirroring and reversal. Paths shorter than four cells or
 * crossing a seam have no key: short paths have too few shapes to vary, and
 * seam crossings already break up the silhouette.
 */
export function canonicalShape(
  path: readonly Cell[],
  gridSize: number,
): string | undefined {
  if (path.length < 4) return undefined;
  const face = path[0]?.face;
  if (path.some((cell) => cell.face !== face)) return undefined;
  const headings: Heading[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const heading = headingForPath(
      [path[index - 1] as Cell, path[index] as Cell],
      gridSize,
    );
    if (!heading) return undefined;
    headings.push(heading);
  }
  const encode = (steps: readonly Heading[]): string => {
    const parts: string[] = [];
    let run = 1;
    for (let index = 1; index < steps.length; index += 1) {
      const turn =
        (HEADING_CYCLE.indexOf(steps[index] as Heading) -
          HEADING_CYCLE.indexOf(steps[index - 1] as Heading) +
          4) %
        4;
      if (turn === 0) {
        run += 1;
        continue;
      }
      parts.push(String(run), turn === 1 ? "R" : "L");
      run = 1;
    }
    parts.push(String(run));
    return parts.join("");
  };
  const mirror = (shape: string): string =>
    shape.replace(/[LR]/g, (turn) => (turn === "L" ? "R" : "L"));
  const forward = encode(headings);
  const backward = encode([...headings].reverse().map(oppositeHeading));
  return [forward, mirror(forward), backward, mirror(backward)].sort()[0];
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
 * on a third face, "staggered" members peel at different points, "lanes"
 * members run long parallel bodies far from the shared tail. "fork" members
 * turn their final legs outward, "seam-fork" parks one head on the start face
 * and the other past a seam, and "trident" is the trio fork: the fork pair
 * plus a member that runs straight on. All three send their heads different
 * ways.
 */
const PAIR_PATTERNS: readonly OverlapPattern[] = [
  {
    name: "classic",
    lead: false,
    members: [
      [
        { heading: "east", steps: 1 },
        { heading: "north", steps: 1 },
        { heading: "north", steps: 1 },
      ],
      [
        { heading: "east", steps: 1 },
        { heading: "south", steps: 1 },
        { heading: "south", steps: 1 },
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
  {
    name: "fork",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 3 },
      ],
    ],
  },
  {
    name: "seam-fork",
    lead: true,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "east", untilSeam: true, extra: 1, maxToSeam: 6 },
        { heading: "south", steps: 2 },
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
    name: "trident",
    lead: false,
    members: [
      [
        { heading: "east", steps: 2 },
        { heading: "north", steps: 3 },
      ],
      [
        { heading: "east", steps: 2 },
        { heading: "south", steps: 3 },
      ],
      [{ heading: "east", steps: 5 }],
    ],
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
 * arrows in reverse unwinding order: the certificate drives core arrows
 * last-placed-first right after the park legs, so the last listed arrow must
 * be the one that moves immediately after the park.
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

const PARK_CERTIFICATE_PREFIX = "park:";

interface ParkingCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly stops: readonly Cell[];
  /** Static spots the core's routes bend through. */
  readonly spots: readonly DirectionalSpotDefinition[];
  /** Certificate park entries, one per circle, naming each circle's parker. */
  readonly parkLegs: readonly string[];
}

/**
 * A required-use wormhole core: portal and gate plus the wormhole that
 * frees them, with the core-only certificate that leads the replay.
 */
interface WormholeCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly wormhole: WormholeDefinition;
  readonly certificate: readonly MoveTarget[];
}

interface DoubleCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly certificate: readonly MoveTarget[];
}

/**
 * A required-use two-headed core on one face. The double is a 5-10 cell
 * self-avoiding walk that turns like a fill arrow. Blocker `b` occupies the
 * two cells directly past its head and faces it, so the head end and `b`
 * block each other; blocker `a` aims from the side at a non-head body cell.
 * Only the tail end can move first, which the core's certificate must show.
 */
function doubleCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  restart: number,
): DoubleCore | undefined {
  const planned = coreStream(id, "double-plan", 0).next();
  if (id < 26 || planned >= doubleArrowFrequency(id)) return undefined;
  const rng = coreStream(id, "double-core", restart);
  const size = level.gridSize;
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  const offset = (cell: Cell, heading: Heading, steps: number): Cell => ({
    face: cell.face,
    x: cell.x + HEADING_VECTORS[heading].dx * steps,
    y: cell.y + HEADING_VECTORS[heading].dy * steps,
  });
  const faces = shuffledFaces(rng);
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const length = 5 + rng.int(6);
    const tail: Cell = { face, x: rng.int(size), y: rng.int(size) };
    if (occupied.has(cellKey(tail))) continue;
    const body: Cell[] = [tail];
    const used = new Set([cellKey(tail)]);
    let previous: Heading | undefined;
    for (let step = 1; step < length; step += 1) {
      const current = body[body.length - 1] as Cell;
      const options = HEADINGS.filter(
        (heading) => !previous || heading !== oppositeHeading(previous),
      )
        .map((heading) => ({ heading, cell: offset(current, heading, 1) }))
        .filter(
          ({ cell }) =>
            inBounds(cell) &&
            !used.has(cellKey(cell)) &&
            !occupied.has(cellKey(cell)),
        );
      if (options.length === 0) break;
      const turn = previous
        ? options.filter(({ heading }) => heading !== previous)
        : [];
      const pool = turn.length > 0 && rng.next() < 0.7 ? turn : options;
      const choice = rng.pick(pool);
      body.push(choice.cell);
      used.add(cellKey(choice.cell));
      previous = choice.heading;
    }
    if (body.length < length || !previous) continue;
    const head = body[body.length - 1] as Cell;
    const blockerB = [offset(head, previous, 2), offset(head, previous, 1)];
    const target = rng.int(body.length - 1);
    const aimed = body[target] as Cell;
    const link = headingBetween(aimed, body[target + 1] as Cell, size);
    if (!link) continue;
    const side = rng.pick(
      HEADINGS.filter(
        (heading) => heading !== link && heading !== oppositeHeading(link),
      ),
    );
    const blockerA = [offset(aimed, side, 2), offset(aimed, side, 1)];
    const arrows: ArrowDefinition[] = [
      { id: `r${id}-double-double`, kind: "double", path: body },
      { id: `r${id}-double-a`, path: blockerA },
      { id: `r${id}-double-b`, path: blockerB },
    ];
    const cells = arrows.flatMap((arrow) => arrow.path);
    const keys = cells.map(cellKey);
    if (
      new Set(keys).size !== keys.length ||
      cells.some((cell) => !inBounds(cell) || occupied.has(cellKey(cell)))
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
 * Level-35's two-arrow geometry relative to end A. The portal's lane runs
 * into A, so with the rings it jumps to B and exits along its entry heading
 * while its body vacates; without them the lane ends on the gate's body. The
 * gate's lane ends on the portal's head, so both deadlock until the portal
 * leaves. One quarter turn about A per placement attempt.
 */
const WORMHOLE_PATTERN = {
  portal: [
    [-2, 0],
    [-1, 0],
  ],
  gate: [
    [1, 0],
    [1, -1],
    [1, -2],
    [0, -2],
    [-1, -2],
    [-1, -1],
  ],
} as const;

/**
 * Place a required-use wormhole core on its own seeded stream, modeled on
 * `doubleCore`. The level-35 pattern rotates about end A on a candidate
 * face; end B lands on a random other face, and the corridor ahead of B
 * must run straight off that face through a non-wrapping edge, clear of
 * every reserved cell. The core proves required use on the core board alone
 * (solvable with the wormhole, deadlocked without it), every arrow already
 * on board keeps its route off both ends so only the portal ever jumps, and
 * no earlier body may sit on a core track, so the core's certificate
 * replays against the assembled cube. Undefined drops the core; the level
 * never restarts for a wormhole placement that fails.
 */
function wormholeCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  restart: number,
): WormholeCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "wormhole-core", restart);
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  const suffix = level.arrows.some((arrow) => arrow.id.includes("-wormhole-"))
    ? "-2"
    : "";
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const face = rng.pick(FACES);
    const rotation = rng.int(4);
    const a: Cell = {
      face,
      x: 2 + rng.int(size - 3),
      y: 2 + rng.int(size - 3),
    };
    const bFace = rng.pick(FACES.filter((entry) => entry !== face));
    const b: Cell = { face: bFace, x: rng.int(size), y: rng.int(size) };
    const arrows: ArrowDefinition[] = [
      {
        id: `r${id}-wormhole-portal${suffix}`,
        path: WORMHOLE_PATTERN.portal.map(([dx, dy]) =>
          patternCell(a, dx, dy, rotation),
        ),
      },
      {
        id: `r${id}-wormhole-gate${suffix}`,
        path: WORMHOLE_PATTERN.gate.map(([dx, dy]) =>
          patternCell(a, dx, dy, rotation),
        ),
      },
    ];
    const cells = arrows.flatMap((arrow) => arrow.path);
    if (
      cells.some((cell) => !inBounds(cell) || occupied.has(cellKey(cell))) ||
      occupied.has(cellKey(a)) ||
      occupied.has(cellKey(b))
    )
      continue;
    // The portal leaves B along its entry heading, so the corridor ahead of
    // B must run straight off the face through a non-wrapping edge and
    // dodge every reserved cell.
    const corridor: Cell[] = [];
    let corridorExits = false;
    let cursor = b;
    for (let step = 0; step <= size; step += 1) {
      const forward = advanceHead(
        level,
        cursor,
        rotateHeading("east", rotation),
      );
      if (forward.exits) {
        corridorExits = true;
        break;
      }
      const next = forward.next;
      if (!next || next.face !== b.face || occupied.has(cellKey(next))) break;
      corridor.push(next);
      cursor = next;
    }
    if (!corridorExits) continue;
    const wormhole: WormholeDefinition = {
      id: suffix ? "w2" : "w1",
      a,
      b,
    };
    const board: LevelDefinition = { ...level, arrows, wormholes: [wormhole] };
    if (!validateLevel(board).valid) continue;
    const certificate = solveLevelTargets(board);
    if (
      !certificate ||
      solveLevelTargets({ ...board, wormholes: [] }) !== undefined
    )
      continue;
    // Only the portal may ever jump: every arrow already on board keeps its
    // full route (both ends of a double) off both wormhole ends.
    const endKeys = new Set([cellKey(a), cellKey(b)]);
    const routesClear = level.arrows.every((arrow) => {
      const paths =
        arrow.kind === "double"
          ? [arrow.path, [...arrow.path].reverse()]
          : [arrow.path];
      return paths.every((path) =>
        arrowTrack(level, { ...arrow, path }).every(
          (cell) => !endKeys.has(cellKey(cell)),
        ),
      );
    });
    // No earlier body may sit on a core track, so the core's certificate
    // replays with every earlier arrow as a static blocker.
    const bodyKeys = new Set(
      level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
    );
    if (
      !routesClear ||
      arrows.some((arrow) =>
        arrowTrack(board, arrow).some((cell) => bodyKeys.has(cellKey(cell))),
      )
    )
      continue;
    const coreIds = new Set(arrows.map((arrow) => arrow.id));
    return {
      arrows,
      wormhole,
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

/**
 * Rotor-core layouts relative to the rotor at (0, 0), authored pointing
 * east, with the pattern's own circle. A rotor core without a circle can
 * never require its rotor to turn: with no park, a frozen rotor is a static
 * spot, and a route an arrow has cleared stays clear because the board only
 * loses arrows. So every pattern parks its first arrow on its circle.
 * "cycle-gate": the opener runs head-on into the rotor, reverses back over
 * its own body and parks on the circle, turning the rotor south; the
 * dropper then passes straight south, which the east aim would bend into the
 * parked opener, and turns the rotor west; the latch, whose lane crossed the
 * dropper's body, leaves; and the opener resumes past the latch's tail.
 * "lane-window": the same opener; the riser bounces off the south aim and
 * turns it west; the window arrow's exit is clear only at that west aim
 * (north sends it back into its capper, south into the riser, east into
 * the parked opener) and turns the rotor north; the capper then bounces off
 * north; the latch and the opener finish.
 */
export const ROTOR_PATTERNS: readonly {
  readonly name: "cycle-gate" | "lane-window";
  readonly heading: Heading;
  readonly stop: readonly [number, number];
  readonly arrows: readonly {
    readonly name: string;
    readonly cells: readonly (readonly [number, number])[];
  }[];
}[] = [
  {
    name: "cycle-gate",
    heading: "east",
    stop: [5, 0],
    arrows: [
      {
        name: "opener",
        cells: [
          [2, 0],
          [1, 0],
        ],
      },
      {
        name: "dropper",
        cells: [
          [0, -2],
          [0, -1],
        ],
      },
      {
        name: "latch",
        cells: [
          [6, 0],
          [6, -1],
          [5, -1],
        ],
      },
    ],
  },
  {
    name: "lane-window",
    heading: "east",
    stop: [5, 0],
    arrows: [
      {
        name: "opener",
        cells: [
          [2, 0],
          [1, 0],
        ],
      },
      {
        name: "riser",
        cells: [
          [0, 2],
          [0, 1],
        ],
      },
      {
        name: "window",
        cells: [
          [0, -2],
          [0, -1],
        ],
      },
      {
        name: "capper",
        cells: [
          [0, -4],
          [0, -3],
        ],
      },
      {
        name: "latch",
        cells: [
          [6, 0],
          [6, -1],
          [5, -1],
        ],
      },
    ],
  },
];

/** Every generated rotor-core arrow id carries this marker; seeds are found by it. */
const ROTOR_CORE_MARKER = "-rotor-";

/** Ids of a level's generated rotor-core arrows, the seeds of its region. */
export function rotorCoreIds(arrows: readonly ArrowDefinition[]): string[] {
  return arrows
    .filter((arrow) => arrow.id.includes(ROTOR_CORE_MARKER))
    .map((arrow) => arrow.id);
}

/**
 * Seeds of a level's stateful-spot region: its flip core or its rotor core.
 * A generated level carries at most one of the two.
 */
function regionCoreIds(arrows: readonly ArrowDefinition[]): string[] {
  return [...flipCoreIds(arrows), ...rotorCoreIds(arrows)];
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
 * The level-45 geometry relative to the fragile cell at (0, 0), rotated per
 * placement attempt. The crosser runs north over the cell. The double's head
 * end runs west over it too, and its tail end runs west into the crosser's
 * body, so the only zero-fall order is the crosser first, collapsing the
 * cell, then the double's tail. The other order crosses with the double's
 * head and leaves the crosser nothing but the hole. The double is six cells
 * and bends, like the generated double core.
 */
export const FRAGILE_PATTERN = {
  crosser: [
    [0, 2],
    [0, 1],
  ],
  double: [
    [1, 1],
    [2, 1],
    [3, 1],
    [3, 0],
    [2, 0],
    [1, 0],
  ],
} as const;

/** Every generated fragile-core arrow id carries this marker. */
export const FRAGILE_CORE_MARKER = "-fragile-";

interface FragileCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly cell: Cell;
  /** The core's zero-fall solution, which crosses and collapses the cell. */
  readonly certificate: readonly MoveTarget[];
  /** Bodies, lanes and the fragile cell, reserved from later placement. */
  readonly cells: ReadonlySet<string>;
}

/**
 * Place a fragile core on its own seeded stream. Every lane the two arrows
 * can travel (both ends of the double, under every flip and rotor state) and
 * the fragile cell itself must avoid every reserved cell and the parking
 * core's and groups' tracks, no lane may enter the cell twice, and no arrow
 * already placed may reach any core cell, so the core plays alone. On the
 * core board by itself the solver must find a zero-fall certificate that
 * collapses the cell, the other order must end in a fall, and no order may
 * soft-lock. The caller reserves the returned cells and keeps the fragile
 * cell off every later route.
 */
function fragileCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  forbiddenTracks: ReadonlySet<string>,
  restart: number,
): FragileCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "fragile-core", restart);
  const faces = shuffledFaces(rng);
  const margin = 4;
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  const existing = level.arrows.map((arrow) => occupancyKeys(level, arrow));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const fragile: Cell = {
      face,
      x: margin + rng.int(Math.max(1, size - 2 * margin)),
      y: margin + rng.int(Math.max(1, size - 2 * margin)),
    };
    const at = ([dx, dy]: readonly [number, number]): Cell =>
      patternCell(fragile, dx, dy, rotation);
    const crosserId = `r${id}${FRAGILE_CORE_MARKER}crosser`;
    const doubleId = `r${id}${FRAGILE_CORE_MARKER}double`;
    const arrows: ArrowDefinition[] = [
      { id: crosserId, path: FRAGILE_PATTERN.crosser.map(at) },
      { id: doubleId, kind: "double", path: FRAGILE_PATTERN.double.map(at) },
    ];
    const bodies = arrows.flatMap((arrow) => arrow.path);
    if (
      [...bodies, fragile].some(
        (cell) => !inBounds(cell) || occupied.has(cellKey(cell)),
      )
    )
      continue;
    const fragileKey = cellKey(fragile);
    const cells = new Set<string>([fragileKey, ...bodies.map(cellKey)]);
    let singlePass = true;
    for (const probe of flipHeadingProbes(level)) {
      for (const arrow of arrows) {
        const ends =
          arrow.kind === "double"
            ? [arrow.path, [...arrow.path].reverse()]
            : [arrow.path];
        for (const path of ends) {
          const keys = arrowTrack(probe, { ...arrow, path }).map(cellKey);
          if (keys.filter((key) => key === fragileKey).length > 1)
            singlePass = false;
          for (const key of keys) cells.add(key);
        }
      }
    }
    if (
      !singlePass ||
      [...cells].some((key) => occupied.has(key) || forbiddenTracks.has(key)) ||
      existing.some((keys) => [...cells].some((key) => keys.has(key)))
    )
      continue;
    const coreLevel: LevelDefinition = {
      id: level.id,
      title: level.title,
      gridSize: level.gridSize,
      lives: level.lives,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
      arrows,
      fragile: [fragile],
    };
    if (!validateLevel(coreLevel).valid) continue;
    const certificate = solveLevelTargets(coreLevel);
    if (!certificate) continue;
    // The certificate must actually cross and collapse the cell.
    let state = createGameState(coreLevel);
    for (const target of certificate) {
      state = applyMove(
        coreLevel,
        state,
        simulateGameMove(coreLevel, state, target.arrowId, target.endpoint),
      );
    }
    if (state.status !== "won" || !state.collapsed?.includes(fragileKey))
      continue;
    // The wrong order: the double's head crosses first and the crosser falls.
    const early = createGameState(coreLevel);
    const wrong = simulateGameMove(coreLevel, early, doubleId, "head");
    if (wrong.kind !== "exit" || !wrong.collapses?.length) continue;
    const after = applyMove(coreLevel, early, wrong);
    if (simulateGameMove(coreLevel, after, crosserId).kind !== "fall") continue;
    if (hasSoftLockState(coreLevel) !== false) continue;
    return { arrows, cell: fragile, certificate, cells };
  }
  return undefined;
}

/**
 * The level-50 geometry relative to the gate at (0, 0), rotated per
 * placement attempt. The opener's lane runs east straight into the gate.
 * The key arrow bends up and runs north over the key at (1, -2), crossing
 * the opener's lane one cell past the gate, so the only order is the key
 * arrow first, then the opener through the open gate.
 */
export const LOCK_PATTERN = {
  opener: [
    [-2, 0],
    [-1, 0],
  ],
  key: [
    [-1, 2],
    [0, 2],
    [1, 2],
    [1, 1],
  ],
  keyCell: [1, -2],
} as const;

/** Every generated lock-core arrow id carries this marker. */
export const LOCK_CORE_MARKER = "-lock-";

interface LockCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly lock: LockDefinition;
  /** The core's solution: the key arrow, then the opener. */
  readonly certificate: readonly MoveTarget[];
  /** Bodies, lanes, the gate and the key, reserved from later placement. */
  readonly cells: ReadonlySet<string>;
}

/**
 * Place a lock core on its own seeded stream. Every lane the two arrows can
 * travel (under every flip and rotor state), the gate and the key must avoid
 * every reserved cell and the parking core's and groups' tracks, and no
 * arrow already placed may reach any core cell, so the core plays alone.
 * The key arrow's lane must cross the key and never the gate, and the
 * opener's lane must reach the gate and never the key. On the core board by
 * itself the opener's first tap must meet the closed gate, the same board
 * with the lock stripped must let the opener leave first, the solver's
 * certificate must send the key arrow before the opener, and no order may
 * strand or soft-lock it.
 */
function lockCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  forbiddenTracks: ReadonlySet<string>,
  restart: number,
): LockCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "lock-core", restart);
  const faces = shuffledFaces(rng);
  const margin = 4;
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  const existing = level.arrows.map((arrow) => occupancyKeys(level, arrow));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const gate: Cell = {
      face,
      x: margin + rng.int(Math.max(1, size - 2 * margin)),
      y: margin + rng.int(Math.max(1, size - 2 * margin)),
    };
    const at = ([dx, dy]: readonly [number, number]): Cell =>
      patternCell(gate, dx, dy, rotation);
    const key = at(LOCK_PATTERN.keyCell);
    const openerId = `r${id}${LOCK_CORE_MARKER}opener`;
    const keyId = `r${id}${LOCK_CORE_MARKER}key`;
    const arrows: ArrowDefinition[] = [
      { id: openerId, path: LOCK_PATTERN.opener.map(at) },
      { id: keyId, path: LOCK_PATTERN.key.map(at) },
    ];
    const bodies = arrows.flatMap((arrow) => arrow.path);
    if (
      [...bodies, gate, key].some(
        (cell) => !inBounds(cell) || occupied.has(cellKey(cell)),
      )
    )
      continue;
    const gateKey = cellKey(gate);
    const keyKey = cellKey(key);
    const cells = new Set<string>([gateKey, keyKey, ...bodies.map(cellKey)]);
    let lanesFit = true;
    for (const probe of flipHeadingProbes(level)) {
      for (const arrow of arrows) {
        const keys = arrowTrack(probe, arrow).map(cellKey);
        const [wanted, banned] =
          arrow.id === keyId ? [keyKey, gateKey] : [gateKey, keyKey];
        if (!keys.includes(wanted) || keys.includes(banned)) lanesFit = false;
        for (const entry of keys) cells.add(entry);
      }
    }
    if (
      !lanesFit ||
      [...cells].some(
        (entry) => occupied.has(entry) || forbiddenTracks.has(entry),
      ) ||
      existing.some((keys) => [...cells].some((entry) => keys.has(entry)))
    )
      continue;
    const lock: LockDefinition = { id: `r${id}-lock`, key, lock: gate };
    const coreLevel: LevelDefinition = {
      id: level.id,
      title: level.title,
      gridSize: level.gridSize,
      lives: level.lives,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
      arrows,
      locks: [lock],
    };
    if (!validateLevel(coreLevel).valid) continue;
    const initial = createGameState(coreLevel);
    if (simulateGameMove(coreLevel, initial, openerId).kind !== "gated")
      continue;
    const stripped: LevelDefinition = { ...coreLevel, locks: [] };
    if (
      simulateGameMove(stripped, createGameState(stripped), openerId).kind !==
      "exit"
    )
      continue;
    const certificate = solveLevelTargets(coreLevel);
    if (!certificate) continue;
    const order = certificate.map((target) => target.arrowId);
    if (
      order.indexOf(keyId) < 0 ||
      order.indexOf(keyId) > order.indexOf(openerId)
    )
      continue;
    let state = initial;
    for (const target of certificate) {
      state = applyMove(
        coreLevel,
        state,
        simulateGameMove(coreLevel, state, target.arrowId, target.endpoint),
      );
    }
    if (state.status !== "won" || !state.unlocked?.includes(lock.id)) continue;
    if (hasStrandingState(coreLevel) !== false) continue;
    if (hasSoftLockState(coreLevel) !== false) continue;
    return { arrows, lock, certificate, cells };
  }
  return undefined;
}

/**
 * The mirror-core geometry relative to the mirror cell at (0, 0), rotated per
 * placement attempt. Two arrows face off along one lane through the mirror,
 * each straight lane ending on the other's head, so the stripped board is
 * deadlocked; the reflection sends the two approaches along the perpendicular
 * corridor to opposite sides, so the mirror is required.
 */
export const MIRROR_PATTERN = {
  north: [
    [0, 2],
    [0, 1],
  ],
  south: [
    [0, -2],
    [0, -1],
  ],
} as const;

/** Every generated mirror-core arrow id carries this marker. */
export const MIRROR_CORE_MARKER = "-mirror-";

interface MirrorCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly mirror: MirrorDefinition;
  /** The core's solution: the two face-off arrows through the mirror. */
  readonly certificate: readonly MoveTarget[];
  /** Bodies, lanes and the mirror cell, reserved from later placement. */
  readonly cells: ReadonlySet<string>;
}

/** A rotor spot frozen at its current heading: the static spot it would be. */
function frozenSpots(
  spots: readonly DirectionalSpotDefinition[],
): DirectionalSpotDefinition[] {
  return spots.map((spot) =>
    spot.kind === "rotor" ? { cell: spot.cell, heading: spot.heading } : spot,
  );
}

/**
 * Place a mirror core on its own seeded stream, modeled on `lockCore`. Every
 * lane the two face-off arrows can travel (under every flip and rotor state),
 * plus the mirror cell, must avoid every reserved cell and the parking core's
 * and groups' tracks, and no arrow already placed may reach any core cell, so
 * the core plays alone. On the core board by itself the solver must clear it,
 * the same board with the mirror stripped must be deadlocked, and no order
 * may strand or soft-lock it.
 */
function mirrorCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  forbiddenTracks: ReadonlySet<string>,
  restart: number,
): MirrorCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "mirror-core", restart);
  const faces = shuffledFaces(rng);
  const margin = 4;
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  // The mirror certificate leads the whole replay, so already-placed cores
  // move only after the face-off pair has fully exited and only their bodies
  // can block it; their tracks crossing a corridor are harmless. Everything
  // placed later keeps off the core's cells and lanes through the shared
  // reservations instead.
  const existing = level.arrows.map((arrow) => arrow.path.map(cellKey));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const mirrorCell: Cell = {
      face,
      x: margin + rng.int(Math.max(1, size - 2 * margin)),
      y: margin + rng.int(Math.max(1, size - 2 * margin)),
    };
    const at = ([dx, dy]: readonly [number, number]): Cell =>
      patternCell(mirrorCell, dx, dy, rotation);
    const northId = `r${id}${MIRROR_CORE_MARKER}north`;
    const southId = `r${id}${MIRROR_CORE_MARKER}south`;
    const arrows: ArrowDefinition[] = [
      { id: northId, path: MIRROR_PATTERN.north.map(at) },
      { id: southId, path: MIRROR_PATTERN.south.map(at) },
    ];
    const bodies = arrows.flatMap((arrow) => arrow.path);
    if (
      [...bodies, mirrorCell].some(
        (cell) => !inBounds(cell) || occupied.has(cellKey(cell)),
      )
    )
      continue;
    const mirrorKey = cellKey(mirrorCell);
    const cells = new Set<string>([mirrorKey, ...bodies.map(cellKey)]);
    // The lanes must be the POST-mechanic routes: a mirror bends its arrows
    // off their straight tracks, so unlike the lock and fragile cores the
    // reservation traces on a board that carries the mirror.
    let lanesFit = true;
    for (const probe of flipHeadingProbes(level)) {
      const mirrorBoard = {
        ...probe,
        mirrors: [{ cell: mirrorCell, orientation: "/" as const }],
      };
      for (const arrow of arrows) {
        const keys = arrowTrack(mirrorBoard, arrow).map(cellKey);
        if (!keys.includes(mirrorKey)) lanesFit = false;
        for (const entry of keys) cells.add(entry);
      }
    }
    if (
      !lanesFit ||
      [...cells].some(
        (entry) => occupied.has(entry) || forbiddenTracks.has(entry),
      ) ||
      existing.some((keys) =>
        [...cells].some((entry) => (keys as readonly string[]).includes(entry)),
      )
    )
      continue;
    const mirror: MirrorDefinition = { cell: mirrorCell, orientation: "/" };
    const coreLevel: LevelDefinition = {
      id: level.id,
      title: level.title,
      gridSize: level.gridSize,
      lives: level.lives,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
      arrows,
      mirrors: [mirror],
    };
    if (!validateLevel(coreLevel).valid) continue;
    const stripped = { ...coreLevel, mirrors: [] };
    if (solveLevelTargets(stripped) !== undefined) continue;
    const certificate = solveLevelTargets(coreLevel);
    if (!certificate) continue;
    let state = createGameState(coreLevel);
    for (const target of certificate) {
      state = applyMove(
        coreLevel,
        state,
        simulateGameMove(coreLevel, state, target.arrowId, target.endpoint),
      );
    }
    if (state.status !== "won") continue;
    if (hasStrandingState(coreLevel) !== false) continue;
    if (hasSoftLockState(coreLevel) !== false) continue;
    return { arrows, mirror, certificate, cells };
  }
  return undefined;
}

/**
 * Place a rotor core on its own seeded stream and prove its interaction
 * region, modeled on `flipCore`. The pattern rotates about its rotor, which
 * keeps a six-cell margin from every face edge so each rotation fits. Every
 * cell a core arrow can reach under any rotor state must avoid every reserved
 * cell and the parking core's and groups' tracks, and no head may pass the
 * rotor twice. The core board alone (its arrows, rotor and circle) must be
 * solvable, strand-free, and unsolvable with the rotor frozen at its authored
 * heading, so the rotor's turning is required. The pattern's circle comes
 * out of the level's circle budget, and the proven region's cells are
 * reserved from later placement the way a flip region's are.
 */
function rotorCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  parkTracks: ReadonlySet<string>,
  restart: number,
): FlipCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "rotor-core", restart);
  const pattern = ROTOR_PATTERNS[
    rng.int(ROTOR_PATTERNS.length)
  ] as (typeof ROTOR_PATTERNS)[number];
  const faces = shuffledFaces(rng);
  const margin = 6;
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const rotor: Cell = {
      face,
      x: margin + rng.int(Math.max(1, size - 2 * margin)),
      y: margin + rng.int(Math.max(1, size - 2 * margin)),
    };
    const at = ([dx, dy]: readonly [number, number]): Cell =>
      patternCell(rotor, dx, dy, rotation);
    const spots: DirectionalSpotDefinition[] = [
      {
        cell: rotor,
        heading: rotateHeading(pattern.heading, rotation),
        kind: "rotor",
      },
    ];
    const stop = at(pattern.stop);
    const arrows: ArrowDefinition[] = pattern.arrows.map((entry) => ({
      id: `r${id}${ROTOR_CORE_MARKER}${pattern.name}-${entry.name}`,
      path: entry.cells.map(at),
    }));
    const cells = [...arrows.flatMap((arrow) => arrow.path), rotor, stop];
    if (cells.some((cell) => !inBounds(cell) || occupied.has(cellKey(cell))))
      continue;
    const board = {
      ...level,
      directionals: [...(level.directionals ?? []), ...spots],
    };
    const rotorKey = cellKey(rotor);
    const reach = new Set<string>([rotorKey, cellKey(stop)]);
    let singlePass = true;
    for (const probe of flipHeadingProbes(board)) {
      for (const arrow of arrows) {
        const keys = arrowTrack(probe, arrow).map(cellKey);
        if (keys.filter((key) => key === rotorKey).length > 1)
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
      ...level,
      arrows,
      directionals: spots,
      stops: [stop],
    };
    if (!validateLevel(coreLevel).valid) continue;
    if (!solveLevelTargets(coreLevel)) continue;
    if (
      solveLevelTargets({ ...coreLevel, directionals: frozenSpots(spots) }) !==
      undefined
    )
      continue;
    if (hasStrandingState(coreLevel) !== false) continue;
    const verdict = acceptFlipRegion(
      level,
      [...level.arrows, ...arrows],
      board.directionals,
      [...(level.stops ?? []), stop],
    );
    if (!verdict.ok) continue;
    return { arrows, spots, stops: [stop], cells: verdict.cells };
  }
  return undefined;
}

/**
 * Accept a flip placement by proving its interaction region: seed arrows are
 * the flip or rotor core's, outside placed arrows block but are never tapped. `spots`
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
  const seeds = regionCoreIds(arrows);
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
 * region is re-derived on the assembled board — later spots and circles
 * can bend tracks into it — and every arrow outside it must keep
 * every track, under every flip state, off the region's cells. The region's
 * own solution, found on a board holding only its arrows and circles, then
 * replays first: by closure no outside body sits on a region track. A park
 * becomes a park leg; undefined means the region does not prove.
 */
function flipRegionLead(
  level: LevelDefinition,
): readonly CertificateEntry[] | undefined {
  const seeds = regionCoreIds(level.arrows);
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
  const catalog = PARK_PATTERNS.filter(
    (pattern) => !pattern.spots || spotFaces.length > 0,
  );
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
    // The core drives right after its park legs, with every graph node still
    // on the board; that is safe because every lead track is reserved against
    // fill bodies. Prove the core alone here so a hostile wrap config rejects
    // this placement instead of the level.
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
 * How many faces of a cube carry directional spots. Authored cubes answer
 * from their own content, so a preview search over them never rolls a stream
 * the cube never consumes; generated cubes draw zero through four on their
 * own seeded stream (uniform), so the split is stable across sessions.
 */
export function directionalFaceCount(id: number): number {
  const authored = authoredLevel(id);
  if (authored) {
    return new Set((authored.directionals ?? []).map((spot) => spot.cell.face))
      .size;
  }
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
 * cells, which keeps the certificate replay infallible. Each placement draws
 * a variant from the stream: each flanker's tail distance from the spot (2-4),
 * the head-to-spot gap (1-2), and which tails bend off the lane. Variants are
 * cosmetic to the contract; the corridor reservation and mutual deadlock proof
 * are unchanged. Undefined means no
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
    // Seeded variant: each flanker's reach (tail distance from the spot), the
    // gap between its head and the spot, and which tails bend off the lane.
    // Every draw keeps the required-use contract — two heads on one lane
    // facing the spot, so each stripped track runs into the other's head cell
    // and the spot bends each into the perpendicular corridor.
    const approachTail = 2 + rng.int(3);
    const opposingTail = 2 + rng.int(3);
    const approachGap = 1 + rng.int(Math.min(2, approachTail - 1));
    const opposingGap = 1 + rng.int(Math.min(2, opposingTail - 1));
    const approachBend = rng.int(2) === 1 && approachTail - approachGap >= 2;
    const opposingBend = rng.int(2) === 1 && opposingTail - opposingGap >= 2;
    const approachLegSide = PERPENDICULAR[lane][rng.int(2)] as Heading;
    const opposingLegSide = PERPENDICULAR[lane][rng.int(2)] as Heading;
    const vector = HEADING_VECTORS[lane];
    const spotCell: Cell = {
      face,
      x: 2 + rng.int(Math.max(1, size - 4)),
      y: 2 + rng.int(Math.max(1, size - 4)),
    };
    const flanker = (
      side: 1 | -1,
      gap: number,
      tail: number,
      bend: boolean,
      legSide: Heading,
    ): readonly Cell[] => {
      const cells: Cell[] = [];
      const laneTail = bend ? tail - 1 : tail;
      for (let distance = laneTail; distance >= gap; distance -= 1) {
        cells.push({
          face,
          x: spotCell.x + side * distance * vector.dx,
          y: spotCell.y + side * distance * vector.dy,
        });
      }
      if (bend) {
        cells.unshift({
          face,
          x:
            spotCell.x +
            side * (tail - 1) * vector.dx +
            HEADING_VECTORS[legSide].dx,
          y:
            spotCell.y +
            side * (tail - 1) * vector.dy +
            HEADING_VECTORS[legSide].dy,
        });
      }
      return cells;
    };
    const approachingPath = flanker(
      -1,
      approachGap,
      approachTail,
      approachBend,
      approachLegSide,
    );
    const opposingPath = flanker(
      1,
      opposingGap,
      opposingTail,
      opposingBend,
      opposingLegSide,
    );
    // A head resting two cells from the spot keeps the cell between them on
    // both deadlocked routes, so it must hold empty like the spot itself.
    const gapCells: Cell[] = [];
    for (let distance = 1; distance < approachGap; distance += 1) {
      gapCells.push({
        face,
        x: spotCell.x - distance * vector.dx,
        y: spotCell.y - distance * vector.dy,
      });
    }
    for (let distance = 1; distance < opposingGap; distance += 1) {
      gapCells.push({
        face,
        x: spotCell.x + distance * vector.dx,
        y: spotCell.y + distance * vector.dy,
      });
    }
    const cells = [...approachingPath, ...opposingPath, ...gapCells, spotCell];
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
  trackForbidden: ReadonlySet<string> = new Set(),
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
        // Try the seeded turn first, then the other perpendicular turn.
        const first = rng.int(2);
        let turn: Heading | undefined;
        for (const side of [first, 1 - first]) {
          const option = PERPENDICULAR[heading][side] as Heading;
          const trial: LevelDefinition = {
            ...spotLevel,
            directionals: [
              ...(spotLevel.directionals ?? []),
              { cell, heading: option },
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
            // The bend must never fold a traverser back over its own body:
            // self-passage is legal only as a head-on bounce off a spot, so a
            // candidate whose bent route slides into the body is rejected here
            // and by the matching validation rule.
            const passage = selfPassageError(
              arrows[traverser]!!,
              trial,
              "head",
            );
            if (passage) {
              fits = false;
              break;
            }
            const blocked = alone.route.some(
              (routeCell) =>
                parkTrackKeys.has(cellKey(routeCell)) ||
                trackForbidden.has(cellKey(routeCell)) ||
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
          if (fits) {
            turn = option;
            break;
          }
        }
        if (!turn) continue;
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
      /^r\d+-(\d+|straight-\d+|wrap-\d+)$/.test(arrow.id),
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
 * through its pauses until it exits before the next arrow is tried. Flip and
 * rotor directions carry from move to move, as they do in play.
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
  const collapsed: string[] = [];
  const unlocked: string[] = [];
  const statefulLevel = hasStatefulSpots(level);
  const maximumLegs = level.gridSize * 6 + 2;
  const foldFlips = (result: MoveResult): void => {
    for (const member of result.members ?? [result]) {
      for (const flip of member.spotFlips ?? []) {
        spotHeadings[cellKey(flip.cell)] = advancedSpotHeading(
          level,
          flip.cell,
          spotHeadings,
        ) as Heading;
      }
      for (const collapse of member.collapses ?? []) {
        collapsed.push(cellKey(collapse.cell));
      }
      for (const opening of member.unlocks ?? []) {
        if (!unlocked.includes(opening.id)) unlocked.push(opening.id);
      }
    }
  };
  // Mirrors `applyMove`: a double, or a lone single on a flip or rotor level,
  // parks by its exact settled path; everything else advances its group's
  // offsets.
  const park = (arrowId: string, result: MoveResult): void => {
    const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
    const group = overlappingArrowIds(level, arrowId);
    if (
      result.settledPath &&
      (arrow?.kind === "double" || (statefulLevel && group.length === 1))
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
      collapsed,
      unlocked,
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
 * Build a pure, reproducible level. Cores lead; every other arrow is a node
 * in an acyclic "must leave first" graph built by `dependencyFill`, and
 * `level.arrows` lists those nodes in reverse removal order ahead of the
 * cores, so the core certificates followed by the reversed node section are
 * a real no-mistake solution certificate. Levels carrying stop circles also
 * embed the parking core, whose circles and tracks are reserved from every
 * fill body so the park legs can never fail. A flip core's proven
 * interaction region is reserved the same way, and the region's own solution
 * leads the certificate.
 */
export function generateLevel(id: number): LevelDefinition {
  assertLevelId(id);
  const authored = authoredLevel(id);
  if (authored) return authored;
  const config = getLevelConfig(id);
  const baseSeed = hashSeed(seedForLevel(id));
  const edgePolicies = getWrappingEdgePolicies(id);
  let skip = "never-entered";
  // The ordinary passes: the first builds the planned directional layout; if
  // every restart of that pass fails its replay, the second rebuilds the same
  // id with the plan forced empty — a cube without spots is always legal, and
  // generation must never give up on an id.
  const plannedSpotPlan = directionalFacePlan(id);
  // Acceptance tiers, tried strictly in order. Both certificate tiers are
  // exact-count, certificate-replayed construction. The last tier only sees
  // an id that every earlier tier rejected across both spot plans and all
  // eight restarts: it trades the certificate for a solver-proven level
  // instead of throwing.
  const tiers = [
    { certificate: true },
    { certificate: true },
    { certificate: false },
  ];
  // A planned flip core gets its own pass ahead of every tier's ordinary
  // passes. The flip pass shares no stream with them, so a level that ends
  // without a flip core comes out of the ordinary passes exactly as it would
  // with no flip plan at all.
  const flipPlanned = flipCorePlanned(id);
  // A planned rotor core gets its own pass the same way, but only on the
  // certificate tiers; like the flip pass it shares no stream with the
  // ordinary passes, so a level that ends without a rotor core is the exact
  // plan-zero construction.
  const rotorPlanned = rotorCorePlanned(id);
  // A planned fragile core gets its own pass on the certificate tiers: a
  // copy of the tier's first pass with the core added, ahead of every pass
  // below. It shares no stream with them, so a level whose fragile pass
  // gives up is the exact plan-zero construction.
  const fragilePlanned = fragileCorePlanned(id);
  // A planned lock core gets its own pass the same way, a copy of whatever
  // pass would otherwise run first (so on a fragile-planned id it carries the
  // fragile core too, and a fragile give-up drops the lock with it); a level
  // whose lock pass gives up is the exact plan-zero construction.
  const lockPlanned = lockCorePlanned(id);
  // A planned mirror core gets its own pass after the lock's, a copy of the
  // pass ahead of it (so on a lock-planned id it carries the lock and fragile
  // cores too); a level whose mirror pass gives up is the exact plan-zero
  // construction.
  const mirrorPlanned = mirrorCorePlanned(id);
  const wormholeSlots = wormholePlan(id);
  for (const [tierIndex, tier] of tiers.entries()) {
    const basePasses = [
      ...(flipPlanned
        ? [{ spotPlan: plannedSpotPlan, flipPass: true, rotorPass: false }]
        : []),
      ...(rotorPlanned && tier.certificate
        ? [{ spotPlan: plannedSpotPlan, flipPass: false, rotorPass: true }]
        : []),
      { spotPlan: plannedSpotPlan, flipPass: false, rotorPass: false },
      {
        spotPlan: [] as readonly number[],
        flipPass: false,
        rotorPass: false,
      },
    ].map((pass) => ({
      ...pass,
      fragilePass: false,
      lockPass: false,
      mirrorPass: false,
    }));
    const fragilePasses = [
      ...(fragilePlanned && tier.certificate
        ? [
            {
              ...(basePasses[0] as (typeof basePasses)[number]),
              fragilePass: true,
            },
          ]
        : []),
      ...basePasses,
    ];
    const lockPasses = [
      ...(lockPlanned && tier.certificate
        ? [
            {
              ...(fragilePasses[0] as (typeof fragilePasses)[number]),
              lockPass: true,
            },
          ]
        : []),
      ...fragilePasses,
    ];
    const passes = [
      ...(mirrorPlanned && tier.certificate
        ? [
            {
              ...(lockPasses[0] as (typeof lockPasses)[number]),
              mirrorPass: true,
            },
          ]
        : []),
      ...lockPasses,
    ];
    for (const {
      spotPlan,
      flipPass,
      rotorPass,
      fragilePass,
      lockPass,
      mirrorPass,
    } of passes) {
      // The rotor core's own circle comes out of the circle budget first.
      const parkBudget = getStopCount(id) - (rotorPass ? 1 : 0);
      // Wormhole slots, like the double core, exist only on certificate
      // tiers; a give-up below withdraws them so the pass rebuilds as the
      // exact plan-zero construction.
      let slots = tier.certificate ? wormholeSlots : 0;
      construction: for (let restart = 0; restart < 8; restart += 1) {
        // Tier 0 keeps the unsalted construction seeds; each later tier salts
        // the construction RNG so it never replays a rejected earlier tier.
        // Core streams stay keyed by `restart` alone.
        const rng = new Rng(
          (baseSeed + Math.imul(restart + 1 + tierIndex * 8, 0x9e3779b9)) >>> 0,
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
        let groupArrows: readonly ArrowDefinition[] = [];
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
          groupArrows = group;
          for (const arrow of group) {
            for (const cell of arrow.path) occupied.add(cellKey(cell));
            for (const cell of arrowTrack(candidateLevel, arrow)) {
              groupTracks.add(cellKey(cell));
            }
            arrows.push(arrow);
          }
        }
        const core =
          parkBudget >= 1
            ? parkingCore(
                id,
                { ...candidateLevel, arrows },
                occupied,
                parkBudget,
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
            if (!validateLevel({ ...parkBoard, arrows: [arrow] }).valid) {
              // A lone core arrow can wrap-fold over its own body, which the
              // self-passage rule rejects; rebuild instead of crashing.
              skip = "park-core";
              continue construction;
            }
            for (const cell of arrow.path) occupied.add(cellKey(cell));
            arrows.push(arrow);
          }
          for (const stop of core.stops) occupied.add(cellKey(stop));
          for (const spot of parkSpots) occupied.add(cellKey(spot.cell));
        }
        // The park core leaves right after its legs, ahead of every graph
        // node, so no later body may sit on its tracks: starters and wrap
        // arrows redraw off them and the fill treats them as forbidden
        // bodies. Fill routes may not cross them either: the park core's
        // circles must stay strand-safe, and `strandSafeCircle` rejects a
        // parked window that lands on any other arrow's track.
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
            if (
              !validateLevel({
                ...candidateLevel,
                directionals: [directionalSpot.spot],
                arrows: [arrow],
              }).valid
            ) {
              // A lone core arrow can wrap-fold over its own body, which the
              // self-passage rule rejects; rebuild instead of crashing.
              skip = "dir-core";
              continue construction;
            }
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
        // A planned wormhole core gets its slots right after the double
        // core, on its own stream. A placement that fails drops the hole
        // and never restarts the level.
        const wormholes: WormholeCore[] = [];
        const wormholeExempt = new Set<string>();
        for (let slot = 0; slot < slots; slot += 1) {
          const spotsSoFar = [
            ...(directionalSpot ? [directionalSpot.spot] : []),
            ...parkSpots,
          ];
          const coreBoard = {
            ...candidateLevel,
            arrows,
            ...(spotsSoFar.length > 0 ? { directionals: spotsSoFar } : {}),
          };
          const wormhole = wormholeCore(id, coreBoard, occupied, restart);
          if (!wormhole) break;
          const holeBoard = { ...coreBoard, wormholes: [wormhole.wormhole] };
          const reserved = new Set<string>([
            cellKey(wormhole.wormhole.a),
            cellKey(wormhole.wormhole.b),
          ]);
          for (const arrow of wormhole.arrows) {
            for (const cell of arrowTrack(holeBoard, arrow)) {
              reserved.add(cellKey(cell));
            }
          }
          // The reservation must stay off the shared-tail groups' tracks.
          if ([...reserved].some((key) => groupTracks.has(key))) break;
          wormholes.push(wormhole);
          for (const key of reserved) occupied.add(key);
          // Every core track cell is vacated before any plain arrow flies
          // (the core's certificate leads the replay), so later exit rays
          // may cross them the way they cross the directional corridor.
          for (const key of reserved) wormholeExempt.add(key);
          for (const arrow of wormhole.arrows) arrows.push(arrow);
        }
        // The ends themselves must never be crossed by a route — entering
        // one teleports — so they stay ray-forbidden and are the ends the
        // route-vetting passes below keep off every later arrow's route.
        const portalKeys = new Set(
          wormholes.flatMap((entry) => [
            cellKey(entry.wormhole.a),
            cellKey(entry.wormhole.b),
          ]),
        );
        for (const key of portalKeys) wormholeExempt.delete(key);
        const rayExemptCells: ReadonlySet<string> | undefined =
          wormholes.length > 0
            ? new Set([...dirCells, ...wormholeExempt])
            : directional
              ? dirCells
              : undefined;
        // The flip or rotor core, whichever this pass plans. Both are
        // stateful-spot regions and every step below treats them alike:
        // proven region, reserved cells, region circles, certificate lead.
        const regionBoard: LevelDefinition = {
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
        };
        const regionTracks = new Set([...parkTrackKeys, ...groupTracks]);
        const flip = flipPass
          ? flipCore(
              id,
              regionBoard,
              occupied,
              regionTracks,
              getStopCount(id) - (core ? core.stops.length : 0),
              restart,
            )
          : rotorPass
            ? rotorCore(id, regionBoard, occupied, regionTracks, restart)
            : undefined;
        if (flipPass && !flip) {
          skip = "flip-core";
          continue construction;
        }
        if (rotorPass && !flip) {
          skip = "rotor-core";
          continue construction;
        }
        if (flip) {
          for (const arrow of flip.arrows) arrows.push(arrow);
          for (const key of flip.cells) occupied.add(key);
        }
        // The fragile core comes after every other core, so their reserved
        // cells and any stateful-spot region fence it, and its own lanes and
        // cell are reserved from everything placed after it.
        const fragile = fragilePass
          ? fragileCore(
              id,
              {
                ...regionBoard,
                arrows,
                directionals: [
                  ...(regionBoard.directionals ?? []),
                  ...(flip ? flip.spots : []),
                ],
              },
              occupied,
              regionTracks,
              restart,
            )
          : undefined;
        if (fragilePass && !fragile) {
          skip = "fragile-core";
          continue construction;
        }
        const fragileKey = fragile ? cellKey(fragile.cell) : undefined;
        if (fragile) {
          for (const arrow of fragile.arrows) arrows.push(arrow);
          for (const key of fragile.cells) occupied.add(key);
        }
        // The lock core comes last of all, fenced the same way.
        const lock = lockPass
          ? lockCore(
              id,
              {
                ...regionBoard,
                arrows,
                directionals: [
                  ...(regionBoard.directionals ?? []),
                  ...(flip ? flip.spots : []),
                ],
              },
              occupied,
              regionTracks,
              restart,
            )
          : undefined;
        if (lockPass && !lock) {
          skip = "lock-core";
          continue construction;
        }
        if (lock) {
          for (const arrow of lock.arrows) arrows.push(arrow);
          for (const key of lock.cells) occupied.add(key);
        }
        // The mirror core comes after the lock core, fenced the same way.
        const mirror = mirrorPass
          ? mirrorCore(
              id,
              {
                ...regionBoard,
                arrows,
                directionals: [
                  ...(regionBoard.directionals ?? []),
                  ...(flip ? flip.spots : []),
                ],
              },
              occupied,
              regionTracks,
              restart,
            )
          : undefined;
        if (mirrorPass && !mirror) {
          skip = "mirror-core";
          continue construction;
        }
        if (mirror) {
          for (const arrow of mirror.arrows) arrows.push(arrow);
          for (const key of mirror.cells) occupied.add(key);
        }
        const lockKeys = lock
          ? [cellKey(lock.lock.lock), cellKey(lock.lock.key)]
          : [];
        const mirrorKeys = mirror ? [cellKey(mirror.mirror.cell)] : [];
        // Straight and wrap starters: graph nodes placed ahead of the fill.
        const starterArrows: ArrowDefinition[] = [];
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
          const laneBlocked = new Set([...occupied, ...parkTrackKeys]);
          let path = straightCandidate(
            rng,
            config.gridSize,
            face,
            heading,
            length,
            laneBlocked,
          );
          // A lane that touches a reserved cell or a park track redraws; only
          // thirty-two misses give up the restart.
          for (let redraw = 0; !path && redraw < 32; redraw += 1) {
            path = straightCandidate(
              rng,
              config.gridSize,
              face,
              heading,
              length,
              laneBlocked,
            );
          }
          // A wormhole end reserved ahead of the starters must stay off
          // every later route: a starter whose straight lane runs over an
          // end draws another lane, and only sixteen straight misses give
          // up the restart.
          for (
            let redraw = 0;
            portalKeys.size > 0 &&
            path &&
            exitRay(
              candidateLevel,
              path[path.length - 1] as Cell,
              heading,
            ).some((cell) => portalKeys.has(cellKey(cell)));
            redraw += 1
          ) {
            if (redraw >= 16) {
              // Withdraw the plan instead of restarting on shifted streams:
              // the pass rebuilds from restart 0 with zero slots, which is
              // the plan-zero construction, so a planned hole can never
              // change a zero-hole layout.
              skip = "wormhole";
              slots = 0;
              restart = -1;
              continue construction;
            }
            path = straightCandidate(
              rng,
              config.gridSize,
              face,
              heading,
              length,
              laneBlocked,
            );
          }
          if (!path) {
            skip = "starter";
            continue construction;
          }
          const arrow: ArrowDefinition = {
            id: `r${id}-straight-${length}`,
            path,
          };
          if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid) {
            // A lone starter can wrap-fold over its own body, which the
            // self-passage rule rejects; rebuild instead of crashing.
            skip = "starter";
            continue construction;
          }
          for (const cell of path) occupied.add(cellKey(cell));
          arrows.push(arrow);
          starterArrows.push(arrow);
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
              new Set([...occupied, ...parkTrackKeys]),
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
                  occupied.has(cellKey(cell)) &&
                  !rayExemptCells?.has(cellKey(cell)),
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
            starterArrows.push(arrow);
            accepted = true;
            break;
          }
          if (!accepted) {
            skip = "wrap";
            continue construction;
          }
        }
        // Fill arrows may not push any canonical shape past the level's cap,
        // so no short zigzag gets stamped across the cube.
        const shapeCounts = new Map<string, number>();
        const capShapes = id >= FIRST_SHAPE_CAPPED_LEVEL;
        const cap = shapeCap(config.arrowCount);
        const shapeOf = (path: readonly Cell[]) =>
          capShapes ? canonicalShape(path, config.gridSize) : undefined;
        for (const arrow of arrows) {
          const shape = shapeOf(arrow.path);
          if (shape) shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
        }
        const shapeFull = (path: readonly Cell[]): boolean => {
          const shape = shapeOf(path);
          return shape !== undefined && (shapeCounts.get(shape) ?? 0) >= cap;
        };
        const countShape = (path: readonly Cell[]): void => {
          const shape = shapeOf(path);
          if (shape) shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1);
        };
        const uncountShape = (path: readonly Cell[]): void => {
          const shape = shapeOf(path);
          if (shape) shapeCounts.set(shape, (shapeCounts.get(shape) ?? 1) - 1);
        };
        // Lead arrows clear first, in certificate order; they are not graph
        // nodes. Their bodies are never fill cells. A fill route may cross a
        // double, directional or wormhole lead body, which is gone before
        // the fill moves; park and flip bodies stay ray-forbidden through
        // the park tracks and the flip region below.
        const leadIds = new Set<string>([
          ...(core?.arrows ?? []).map((arrow) => arrow.id),
          ...(directionalSpot?.arrows ?? []).map((arrow) => arrow.id),
          ...(double?.arrows ?? []).map((arrow) => arrow.id),
          ...wormholes.flatMap((entry) =>
            entry.arrows.map((arrow) => arrow.id),
          ),
          ...(flip?.arrows ?? []).map((arrow) => arrow.id),
          ...(fragile?.arrows ?? []).map((arrow) => arrow.id),
          ...(lock?.arrows ?? []).map((arrow) => arrow.id),
          ...(mirror?.arrows ?? []).map((arrow) => arrow.id),
        ]);
        const leadBodies = new Set(
          arrows
            .filter((arrow) => leadIds.has(arrow.id))
            .flatMap((arrow) => arrow.path.map(cellKey)),
        );
        // The board every pre-fill route runs on: wrap edges plus every spot
        // placed so far. Fill routes come from `routeFrom`, which sees only
        // wrap edges, so every spot cell and portal end is ray-forbidden
        // below and a fill route never reaches a cell that would bend it.
        const nodeBoard = {
          ...candidateLevel,
          directionals: [
            ...(directionalSpot ? [directionalSpot.spot] : []),
            ...parkSpots,
            ...(flip ? flip.spots : []),
          ],
        };
        // Reserved cells no fill body may use: everything `occupied` holds
        // that is not a placed body, plus the parking core's tracks, which
        // must stay clear because the park core leaves before any fill.
        const bodyKeys = new Set(
          arrows.flatMap((arrow) => arrow.path.map(cellKey)),
        );
        const forbiddenBody = new Set<string>([
          ...[...occupied].filter((key) => !bodyKeys.has(key)),
          ...parkTrackKeys,
        ]);
        // Cells no fill route may cross: circles, which stop a route; spots
        // placed so far, which bend it; portal ends, which move it; the flip
        // region, whose closure counts every cell an arrow can reach; and
        // the park tracks, which must stay off every other arrow's track for
        // the core circles to stay strand-safe. Every other lead body and
        // track is empty by the time any fill arrow moves, so routes may
        // cross them.
        const forbiddenRay = new Set<string>([
          ...(core ? core.stops : []).map(cellKey),
          ...(flip ? flip.stops : []).map(cellKey),
          ...nodeBoard.directionals.map((spot) => cellKey(spot.cell)),
          ...(flip?.cells ?? []),
          ...portalKeys,
          ...parkTrackKeys,
          ...(fragileKey ? [fragileKey] : []),
          // A gate stops a route while locked, and a key would open it for
          // an arrow the core's proof never saw.
          ...lockKeys,
          // A mirror bends a route off its authored line, so no fill route
          // may cross it.
          ...mirrorKeys,
        ]);
        // Every lead arrow replays while the whole fill is still on the
        // board, so no fill body may sit anywhere a lead can travel: both
        // ends of a double, and every flip state for the flip core.
        const leadBoard = {
          ...nodeBoard,
          ...(wormholes.length > 0
            ? { wormholes: wormholes.map((entry) => entry.wormhole) }
            : {}),
        };
        const flipIds = new Set((flip?.arrows ?? []).map((arrow) => arrow.id));
        for (const arrow of arrows) {
          if (!leadIds.has(arrow.id)) continue;
          const keys = flipIds.has(arrow.id)
            ? occupancyKeys(leadBoard, arrow)
            : trackKeys(leadBoard, arrow);
          for (const key of keys) forbiddenBody.add(key);
        }
        // Graph nodes placed before the fill leave after every lead, so no
        // lead may still need a cell they sit on.
        const nodeArrows = [...groupArrows, ...starterArrows];
        if (
          nodeArrows.some((arrow) =>
            arrow.path.some((cell) => parkTrackKeys.has(cellKey(cell))),
          )
        ) {
          skip = "park-track";
          continue construction;
        }
        const nodeRoute = (arrow: ArrowDefinition): readonly string[] =>
          arrowTrack(nodeBoard, arrow).slice(arrow.path.length).map(cellKey);
        const graphNodes: FillNode[] = [
          ...(groupArrows.length > 0
            ? [
                {
                  id: (groupArrows[0] as ArrowDefinition).id,
                  arrows: groupArrows,
                  routeKeys: new Set(groupArrows.flatMap(nodeRoute)),
                },
              ]
            : []),
          ...starterArrows.map((arrow) => ({
            id: arrow.id,
            arrows: [arrow],
            routeKeys: new Set(nodeRoute(arrow)),
          })),
        ];
        const prefilled = arrows.length;
        let fill: FillResult;
        try {
          fill = dependencyFill({
            level: candidateLevel,
            rng,
            idPrefix: `r${id}-`,
            firstIndex: prefilled,
            target: config.arrowCount - prefilled,
            attempts: config.arrowCount * (900 + 400 * wormholes.length),
            clearShare: clearShare(id),
            length: () =>
              Math.max(
                2,
                Math.floor(
                  targetLength(rng, id, config) *
                    (1 - edgePolicies.length * 0.05),
                ),
              ),
            nodes: graphNodes,
            leadBodies,
            forbiddenBody,
            forbiddenRay,
            maxPathLength: 40,
            shapeFull,
            countShape,
            uncountShape,
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== "Dependency fill input nodes contain a cycle."
          )
            throw error;
          skip = "fill-cycle";
          continue construction;
        }
        if (fill.placed < config.arrowCount - prefilled) {
          skip = "count";
          continue;
        }
        // Emit graph nodes in reverse removal order, then the leads: the
        // certificate's reversed array is then a valid removal order, and
        // `cellsBefore` in the spot passes means "bodies still present when
        // this arrow moves". `arrows` stays the same array object.
        const leads = arrows.filter((arrow) => leadIds.has(arrow.id));
        arrows.length = 0;
        for (const node of [...fill.order].reverse())
          arrows.push(...node.arrows);
        arrows.push(...leads);
        for (const arrow of arrows) {
          for (const cell of arrow.path) occupied.add(cellKey(cell));
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
                new Set([
                  ...(flip ? flip.cells : []),
                  ...portalKeys,
                  ...(fragile ? fragile.cells : []),
                  ...(lock ? lock.cells : []),
                ]),
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
              new Set([
                ...parkTrackKeys,
                ...(flip ? flip.cells : []),
                ...portalKeys,
                ...(fragile ? fragile.cells : []),
                ...(lock ? lock.cells : []),
              ]),
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
          ...(wormholes.length > 0
            ? { wormholes: wormholes.map((entry) => entry.wormhole) }
            : {}),
          ...(fragile ? { fragile: [fragile.cell] } : {}),
          ...(lock ? { locks: [lock.lock] } : {}),
          ...(mirror ? { mirrors: [mirror.mirror] } : {}),
        });
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
        if (
          core &&
          !core.stops.every(
            strandSafeCircle(stopBoard, arrows, coreIds, "core"),
          )
        ) {
          skip = "strand";
          continue;
        }
        // Certificate tiers restart a board short of its depth floors; the
        // last tier accepts it rather than throwing.
        const statsBoard =
          wormholes.length > 0 ? { ...level, wormholes: [] } : level;
        if (tier.certificate && !meetsDepthGate(id, closureStats(statsBoard))) {
          skip = "depth";
          continue;
        }
        // Certificate tiers restart a board whose bodies cover less than
        // 0.78 of a cube of grid 13 or larger; the final tier accepts it, and
        // the depth sweep pins the floor.
        if (
          tier.certificate &&
          config.gridSize >= 13 &&
          new Set(arrows.flatMap((arrow) => arrow.path.map(cellKey))).size <
            0.78 * 6 * config.gridSize ** 2
        ) {
          skip = "coverage";
          continue;
        }
        // Only the core crosses its fragile cell: a second lane over it would
        // be an uncertified fall. Starter rays and spots placed after the
        // core are the placements its reservation cannot fence.
        if (
          fragileKey &&
          level.arrows.some(
            (arrow) =>
              !arrow.id.includes(FRAGILE_CORE_MARKER) &&
              occupancyKeys(level, arrow).has(fragileKey),
          )
        ) {
          skip = "fragile";
          continue;
        }
        // Only the core reaches its gate and key: an outside arrow over the
        // key would open the gate outside the core's proof. Starter rays and
        // spots placed after the core are what its reservation cannot fence.
        if (
          lockKeys.length > 0 &&
          level.arrows.some((arrow) => {
            if (arrow.id.includes(LOCK_CORE_MARKER)) return false;
            const reach = occupancyKeys(level, arrow);
            return lockKeys.some((key) => reach.has(key));
          })
        ) {
          skip = "lock";
          continue;
        }
        // Only the core reaches its mirror: an outside arrow bending through
        // it would route outside the core's proof. Starter rays and spots
        // placed after the core are what its reservation cannot fence.
        if (
          mirrorKeys.length > 0 &&
          level.arrows.some((arrow) => {
            if (arrow.id.includes(MIRROR_CORE_MARKER)) return false;
            const reach = occupancyKeys(level, arrow);
            return mirrorKeys.some((key) => reach.has(key));
          })
        ) {
          skip = "mirror";
          continue;
        }
        // The flip region is proven again on the assembled level: later
        // spots and circles can bend tracks toward it, and nothing outside
        // it may ever reach its cells. Its own solution leads.
        const flipLead = flip ? flipRegionLead(level) : [];
        // Leads replay first, each core in the order its own proof uses; the
        // park core unwinds in reverse placement order right after its legs.
        // The graph section follows in removal order.
        // The fragile core touches no other arrow's reach, so its crossing
        // certificate may lead wherever it sits.
        const certificate: CertificateEntry[] = [
          ...(fragile ? fragile.certificate : []),
          ...(lock ? lock.certificate : []),
          ...(mirror ? mirror.certificate : []),
          ...wormholes.flatMap((entry) => entry.certificate),
          ...(double ? double.certificate : []),
          ...(core ? core.parkLegs : []),
          ...(core ? [...core.arrows].reverse().map((arrow) => arrow.id) : []),
          ...(directionalSpot
            ? directionalSpot.arrows.map((arrow) => arrow.id)
            : []),
          ...[...arrows]
            .reverse()
            .filter((arrow) => !leadIds.has(arrow.id))
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
          // core alone replays against the same certificate. Drop optional
          // spots from the end until the rest replays, down to the core alone.
          // Only prefixes are tried: each spot was vetted against the spots
          // placed before it, so a prefix keeps every kept spot's checks true.
          // Fewer spots change the tracks, so circles are chosen again.
          const optional = [...extraSpots, ...reversalSpots];
          for (let keep = optional.length - 1; keep >= 0; keep -= 1) {
            const trimmedBoard = {
              ...candidateLevel,
              directionals: [
                directionalSpot.spot,
                ...optional.slice(0, keep),
                ...parkSpots,
                ...(flip ? flip.spots : []),
              ],
              ...(wormholes.length > 0
                ? { wormholes: wormholes.map((entry) => entry.wormhole) }
                : {}),
              ...(fragile ? { fragile: [fragile.cell] } : {}),
              ...(lock ? { locks: [lock.lock] } : {}),
              ...(mirror ? { mirrors: [mirror.mirror] } : {}),
            };
            const trimmedStops = [
              ...(core ? core.stops : []),
              ...regionStops,
              ...chooseStops(
                id,
                trimmedBoard,
                arrows,
                occupied,
                getStopCount(id) -
                  (core ? core.stops.length : 0) -
                  regionStops.length,
                coreIds,
              ),
            ];
            const trimmed: LevelDefinition = {
              ...trimmedBoard,
              arrows,
              ...(trimmedStops.length > 0 ? { stops: trimmedStops } : {}),
            };
            const trimmedLead = flip ? flipRegionLead(trimmed) : [];
            // Fewer spots change routes, so closure is measured again; the
            // arrows are unchanged, so coverage is too.
            const trimmedSafe =
              trimmedLead !== undefined &&
              (!core ||
                core.stops.every(
                  strandSafeCircle(trimmedBoard, arrows, coreIds, "core"),
                )) &&
              (!tier.certificate ||
                meetsDepthGate(
                  id,
                  closureStats(
                    wormholes.length > 0
                      ? { ...trimmed, wormholes: [] }
                      : trimmed,
                  ),
                ));
            const trimmedAccepted =
              trimmedSafe &&
              (tier.certificate
                ? validateGenerated(trimmed, [
                    ...(trimmedLead ?? []),
                    ...certificate,
                  ])
                : validateLevel(trimmed).valid &&
                  solveLevelTargets(trimmed) !== undefined);
            if (trimmedAccepted) return trimmed;
          }
        }
      }
    }
  }
  throw new Error(
    `Could not deterministically construct runtime level ${id} (last skip: ${skip}).`,
  );
}
