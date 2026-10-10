import { constructWormhole } from "./wormhole";
import { growMechanicBody } from "./mechanic-body";
import {
  advancedSpotHeading,
  hasStatefulSpots,
  rotatedHeading,
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
import {
  dependencyFill,
  type FillNode,
  type FillResult,
} from "./dependency-fill";
import { clearShare, closureStats, meetsDepthGate } from "./difficulty";
import { DIRECTIONAL_INTRO_LEVEL } from "./directional-intro";
import { DOUBLE_INTRO_LEVEL } from "./double-intro";
import { constructFlip, growFlipLaneBlocker } from "./flip";
import { FLIP_INTRO_LEVEL } from "./flip-intro";
import { FRAGILE_INTRO_LEVEL } from "./fragile-intro";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "./intro";
import { LEAP_INTRO_LEVEL } from "./leap-intro";
import { LOCK_INTRO_LEVEL } from "./lock-intro";
import { MIRROR_INTRO_LEVEL } from "./mirror-intro";
import { OVERLAP_INTRO_LEVEL } from "./overlap-intro";
import { constructParking } from "./parking";
import { constructRotor } from "./rotor";
import { ROTOR_INTRO_LEVEL } from "./rotor-intro";
import { STOP_INTRO_LEVEL } from "./stop-intro";
import { WORMHOLE_INTRO_LEVEL } from "./wormhole-intro";

export const GENERATOR_VERSION = 11;

/** Absolute arrow ceiling: the largest fill target `getLevelConfig` returns. */
export const MAX_GENERATED_ARROWS = 200;
export const MAX_LEVEL_ID = Number.MAX_SAFE_INTEGER - 1;

/** Authored teaching cubes; every other id is generated at runtime. */
export const AUTHORED_LEVEL_IDS: readonly number[] = [
  1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
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
  [60, LEAP_INTRO_LEVEL],
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
  if (id === 60) return "par-arrows:runtime:7:level:60:leap-intro:1";
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

/** Probability that a placed flip core carries blocker arrows on its lanes. */
export function flipBlockFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_FLIP_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_FLIP_LEVEL) / (90 - FIRST_FLIP_LEVEL),
  );
  return 0.35 + 0.35 * progress;
}

/** First generated level that can embed a rotor core. */
const FIRST_ROTOR_LEVEL = 41;

/** First generated level that can embed a wormhole core. */
const FIRST_WORMHOLE_LEVEL = 36;

/** First generated level that can embed a fragile core. */
const FIRST_FRAGILE_LEVEL = 46;

/** First generated level that can embed a lock core. */
const FIRST_LOCK_LEVEL = 51;

/** First generated level that can embed a mirror core. */
const FIRST_MIRROR_LEVEL = 56;

/** First generated level that can embed a leap core. */
const FIRST_LEAP_LEVEL = 61;

const blockCurve =
  (first: number) =>
  (id: number): number => {
    assertLevelId(id);
    if (id < first || isAuthoredLevel(id)) return 0;
    const progress = Math.min(1, (id - first) / 59);
    return 0.35 + 0.35 * progress;
  };

const BLOCK_FREQUENCY: Record<
  "rotor" | "wormhole" | "fragile" | "lock" | "mirror" | "leap",
  (id: number) => number
> = {
  rotor: blockCurve(FIRST_ROTOR_LEVEL),
  wormhole: blockCurve(FIRST_WORMHOLE_LEVEL),
  fragile: blockCurve(FIRST_FRAGILE_LEVEL),
  lock: blockCurve(FIRST_LOCK_LEVEL),
  mirror: blockCurve(FIRST_MIRROR_LEVEL),
  leap: blockCurve(FIRST_LEAP_LEVEL),
};

export const rotorBlockFrequency = BLOCK_FREQUENCY.rotor;
export const wormholeBlockFrequency = BLOCK_FREQUENCY.wormhole;
export const fragileBlockFrequency = BLOCK_FREQUENCY.fragile;
export const lockBlockFrequency = BLOCK_FREQUENCY.lock;
export const mirrorBlockFrequency = BLOCK_FREQUENCY.mirror;
export const leapBlockFrequency = BLOCK_FREQUENCY.leap;

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

/** Probability that a generated level attempts a leap core. */
export function leapCoreFrequency(id: number): number {
  assertLevelId(id);
  if (id < FIRST_LEAP_LEVEL || isAuthoredLevel(id)) return 0;
  const progress = Math.min(
    1,
    (id - FIRST_LEAP_LEVEL) / (90 - FIRST_LEAP_LEVEL),
  );
  return 0.25 + 0.3 * progress;
}

/** True when a generated level plans a leap core, on its own stream. */
export function leapCorePlanned(id: number): boolean {
  return (
    leapCoreFrequency(id) > 0 &&
    coreStream(id, "leap-plan", 0).next() < leapCoreFrequency(id)
  );
}

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

const PARK_CERTIFICATE_PREFIX = "park:";

/**
 * A grown required-use wormhole circuit and its actual engine certificate.
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

/** Grow a required portal circuit on its independent construction stream. */
function wormholeCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  restart: number,
): WormholeCore | undefined {
  return constructWormhole(
    level,
    coreStream(id, "wormhole-topology-v1", restart),
    occupied,
    level.arrows.some((a) => a.id.includes("-wormhole-")) ? "-2" : "",
  );
}

/** Every generated flip-core arrow id carries this marker; seeds are found by it. */
const FLIP_CORE_MARKER = "-flip-";
const FLIP_BLOCK_MARKER = "-flipb-";

/** Ids of a level's generated flip-core arrows, the seeds of its region. */
export function flipCoreIds(arrows: readonly ArrowDefinition[]): string[] {
  return arrows
    .filter((arrow) => arrow.id.includes(FLIP_CORE_MARKER))
    .map((arrow) => arrow.id);
}

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
  /** Blockers seeded on core lanes; empty on an isolated core. */
  readonly blockers: readonly ArrowDefinition[];
  /** The region's proven dance order as consecutive arrow ids. */
  readonly dance: readonly string[];
}

/**
 * Place a flip core on its own seeded streams and prove its interaction
 * region. Paths, contact gaps and shared spot traversals grow before the
 * stateful proof; no coordinate catalog is used. Every cell a core arrow
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
  const rng = coreStream(id, "flip-topology-v1", restart);
  const core = constructFlip(level, rng, occupied, parkTracks, 32);
  if (!core) return undefined;
  const arrows = core.arrows;
  const spots = core.directionals ?? [];
  const board = {
    ...level,
    directionals: [...(level.directionals ?? []), ...spots],
  };
  const spotKeys = spots.map((spot) => cellKey(spot.cell));
  const coreLevel = { ...core, directionals: spots };
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
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
        if (!inBounds(cell)) continue;
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
    const seeded = flipBlockers(
      id,
      restart,
      level,
      board,
      arrows,
      stops,
      verdict.cells,
      occupied,
      parkTracks,
      inBounds,
    );
    const dance = regionDanceOrder(level, board.directionals, stops, [
      ...placed,
      ...seeded.blockers,
    ]);
    return {
      arrows,
      spots,
      stops,
      cells: seeded.cells,
      blockers: seeded.blockers,
      dance,
    };
  }
  return undefined;
}

/**
 * Grow blockers from sampled core-lane contacts, seeded stems and
 * self-avoiding tails. Their heads point off the lane, so that core arrow
 * cannot move until the blocker leaves. Fill arrows interleave around the region while the blocker's own
 * route stays reserved like the core's lanes, so the dance sits behind the
 * board's opening moves rather than an isolated vignette. Every placement
 * re-proves the interaction region with the blockers as members; closure
 * absorbs them. A failed re-proof keeps the proven prefix. The returned cells are the last
 * accepted region's cells.
 */
function flipBlockers(
  id: number,
  restart: number,
  level: LevelDefinition,
  board: LevelDefinition,
  coreArrows: readonly ArrowDefinition[],
  stops: readonly Cell[],
  regionCells: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  parkTracks: ReadonlySet<string>,
  inBounds: (cell: Cell) => boolean,
): { blockers: readonly ArrowDefinition[]; cells: ReadonlySet<string> } {
  const rng = coreStream(id, "flip-block", restart);
  if (flipBlockFrequency(id) === 0 || rng.next() >= flipBlockFrequency(id))
    return { blockers: [], cells: regionCells };
  const maxBlockers = id >= 60 && rng.next() < 0.3 ? 2 : 1;
  const size = level.gridSize;
  const spotKeys = new Set(
    (board.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  const stopKeys = new Set([...(level.stops ?? []), ...stops].map(cellKey));
  const placed = [...level.arrows, ...coreArrows];
  const blockers: ArrowDefinition[] = [];
  let cells = regionCells;
  const blockerKeys = new Set<string>();
  for (
    let attempt = 0;
    attempt < 48 && blockers.length < maxBlockers;
    attempt += 1
  ) {
    const owner = coreArrows[rng.int(coreArrows.length)] as ArrowDefinition;
    const track = arrowTrack(board, owner).slice(owner.path.length);
    const candidates = track;
    if (candidates.length === 0) continue;
    const entangle = candidates[rng.int(candidates.length)] as Cell;
    const entangleKey = cellKey(entangle);
    // The entangle cell sits inside the region by definition; the blocker's
    // head and route cells must not, or a blocker route would cross a core
    // body and cycle the graph.
    const offLane = (cell: Cell): boolean => {
      const key = cellKey(cell);
      return (
        !inBounds(cell) ||
        occupied.has(key) ||
        parkTracks.has(key) ||
        spotKeys.has(key) ||
        stopKeys.has(key) ||
        regionCells.has(key) ||
        blockerKeys.has(key)
      );
    };
    if (
      !inBounds(entangle) ||
      occupied.has(entangleKey) ||
      parkTracks.has(entangleKey) ||
      spotKeys.has(entangleKey) ||
      stopKeys.has(entangleKey) ||
      blockerKeys.has(entangleKey)
    )
      continue;
    const trackKeysSet = new Set(track.map(cellKey));
    const routeBlocked = (key: string): boolean =>
      occupied.has(key) ||
      parkTracks.has(key) ||
      stopKeys.has(key) ||
      spotKeys.has(key) ||
      regionCells.has(key) ||
      blockerKeys.has(key);
    const options = (["east", "west", "south", "north"] as const)
      .map((heading) => ({
        heading,
        cell: stepSurface(entangle, heading, size),
      }))
      .filter(({ cell }) => !trackKeysSet.has(cellKey(cell)) && !offLane(cell))
      .map(({ cell, heading }) => {
        const path = [entangle, cell];
        for (let step = 0, gap = rng.int(3); step < gap; step++) {
          const next = stepSurface(path.at(-1)!, heading, size);
          if (offLane(next) || path.some((c) => cellKey(c) === cellKey(next)))
            break;
          path.push(next);
        }
        return {
          id: `r${id}${FLIP_BLOCK_MARKER}${blockers.length}`,
          path: growFlipLaneBlocker(
            level,
            rng,
            path,
            new Set([
              ...occupied,
              ...parkTracks,
              ...stopKeys,
              ...spotKeys,
              ...cells,
              ...blockerKeys,
            ]),
          ),
        };
      })
      .filter(
        (candidate) =>
          candidate.path.length >= 3 &&
          !arrowTrack(board, candidate)
            .slice(candidate.path.length)
            .some((cell) => routeBlocked(cellKey(cell))),
      );
    if (options.length === 0) continue;
    const blocker = options[rng.int(options.length)] as ArrowDefinition;
    const verdict = acceptFlipRegion(
      level,
      [...placed, ...blockers, blocker],
      board.directionals ?? [],
      [...(level.stops ?? []), ...stops],
    );
    if (!verdict.ok) continue;
    blockers.push(blocker);
    for (const cell of blocker.path) blockerKeys.add(cellKey(cell));
    cells = verdict.cells;
  }
  return { blockers, cells };
}

const XBLOCK_MARKER = "-xblock-";
const LANE_KINDS = ["wormhole", "fragile", "lock", "mirror", "leap"] as const;
type LaneKind = (typeof LANE_KINDS)[number];

interface LaneBlockerInput {
  kind: LaneKind;
  id: number;
  restart: number;
  /** The board with the mechanic and spots, for track derivation. */
  board: LevelDefinition;
  coreArrows: readonly ArrowDefinition[];
  certificate: readonly CertificateEntry[];
  /** The mechanic's core-board literal, for the replay proof. */
  coreBoard: LevelDefinition;
  occupied: ReadonlySet<string>;
  parkTracks: ReadonlySet<string>;
  /** Every reserved cell: mechanic cells, portal ends, region cells. */
  reservedCells: ReadonlySet<string>;
  /** Reserved cells a blocker route may cross: lead cells that are empty
   * by the time any graph node moves. */
  crossable: ReadonlySet<string>;
  inBounds: (cell: Cell) => boolean;
}

/**
 * Seed blocker arrows on a certificate-led core's lanes: the per-lane
 * sibling of `flipBlockers`. Wormhole blockers grow their bodies; the other
 * lane mechanics still use two-cell arrows whose tail
 * covers a late track cell of some core arrow and whose head points off the
 * lane; the mechanic's certificate must still replay on the core board with
 * the blockers as members. A failed replay keeps the proven prefix. Blocker
 * routes stay reserved like the core's lanes, so the caller must add their
 * track keys to `forbiddenBody` and `forbiddenRay`. A certificate whose
 * chain repeats an arrow id is a multi-leg dance the removal graph cannot
 * express, so it seeds nothing and draws nothing from the stream.
 */
function seedLaneBlockers(input: LaneBlockerInput): readonly ArrowDefinition[] {
  const { kind, id, restart } = input;
  const chain = certificateToChain(input.certificate);
  if (new Set(chain).size !== chain.length) return [];
  const rng = coreStream(id, `${kind}-block`, restart);
  const frequency = BLOCK_FREQUENCY[kind];
  const grownFlip = (input.board.directionals ?? []).some(
    (spot) => spot.kind === "flip",
  );
  const grownWormhole = kind === "wormhole";
  if (frequency(id) === 0) return [];
  const placementDraw = rng.next();
  // A grown layout may need more construction restarts. Preserve the
  // original blocker-presence plan; only its placement geometry retries.
  const planDraw =
    grownFlip || grownWormhole
      ? coreStream(id, `${kind}-block`, 0).next()
      : placementDraw;
  if (planDraw >= frequency(id)) return [];
  const first = { wormhole: 36, fragile: 46, lock: 51, mirror: 56, leap: 61 }[
    kind
  ] as number;
  const maxBlockers = id >= first + 29 && rng.next() < 0.3 ? 2 : 1;
  const size = input.board.gridSize;
  const spotKeys = new Set(
    (input.board.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  const stopKeys = new Set((input.coreBoard.stops ?? []).map(cellKey));
  const blockers: ArrowDefinition[] = [];
  const blockerKeys = new Set<string>();
  // The core's own lanes are already in `occupied`. A blocker tail may sit
  // on a late lane cell (that is the entanglement), but its head and route
  // must stay off every lane, or the blocker would cross a core body.
  const laneKeys = new Set(
    input.coreArrows.flatMap((arrow) =>
      arrowTrack(input.board, arrow).map(cellKey),
    ),
  );
  const coreBodyKeys = new Set(
    input.coreArrows.flatMap((arrow) => arrow.path.map(cellKey)),
  );
  const bannedKey = (key: string): boolean =>
    input.occupied.has(key) ||
    input.parkTracks.has(key) ||
    spotKeys.has(key) ||
    stopKeys.has(key) ||
    input.reservedCells.has(key) ||
    blockerKeys.has(key);
  const bannedEntangle = (key: string): boolean =>
    coreBodyKeys.has(key) ||
    input.parkTracks.has(key) ||
    spotKeys.has(key) ||
    stopKeys.has(key) ||
    input.reservedCells.has(key) ||
    blockerKeys.has(key) ||
    (input.occupied.has(key) && !laneKeys.has(key));
  const bannedRoute = (key: string): boolean =>
    coreBodyKeys.has(key) ||
    input.parkTracks.has(key) ||
    spotKeys.has(key) ||
    stopKeys.has(key) ||
    input.reservedCells.has(key) ||
    blockerKeys.has(key) ||
    (input.occupied.has(key) && !input.crossable.has(key));
  // On changed flip boards, search the whole lane instead of repeatedly
  // sampling a fenced final four-cell window. Unrelated boards retain their
  // original draws and bounds; every candidate still replays the certificate.
  for (
    let attempt = 0;
    attempt < (grownFlip || grownWormhole ? 24 : 6) &&
    blockers.length < maxBlockers;
    attempt += 1
  ) {
    // Keep the original successful prefix. Broader contacts are a fallback
    // for an empty result, not another way to crowd later mechanic lanes.
    const broader = grownWormhole || (grownFlip && attempt >= 6);
    if (broader && !grownWormhole && blockers.length > 0) break;
    const owner = input.coreArrows[
      rng.int(input.coreArrows.length)
    ] as ArrowDefinition;
    const track = arrowTrack(input.board, owner).slice(owner.path.length);
    const candidates = broader
      ? track.filter((cell) => !bannedEntangle(cellKey(cell)))
      : track.slice(Math.max(0, track.length - 4));
    if (candidates.length === 0) continue;
    const entangle = candidates[rng.int(candidates.length)] as Cell;
    if (!input.inBounds(entangle) || bannedEntangle(cellKey(entangle)))
      continue;
    const trackKeySet = new Set(track.map(cellKey));
    const options = (["east", "west", "south", "north"] as const)
      .map((heading) => ({
        heading,
        cell: stepSurface(entangle, heading, size),
      }))
      .filter(
        ({ cell }) =>
          !trackKeySet.has(cellKey(cell)) &&
          input.inBounds(cell) &&
          !bannedKey(cellKey(cell)),
      );
    if (options.length === 0) continue;
    const clearOptions = broader
      ? options.filter(
          (option) =>
            !arrowTrack(input.board, {
              id: "candidate",
              path: [entangle, option.cell],
            })
              .slice(2)
              .some((cell) => bannedRoute(cellKey(cell))),
        )
      : options;
    if (!clearOptions.length) continue;
    const shortest = broader
      ? Math.min(
          ...clearOptions.map(
            (option) =>
              arrowTrack(input.board, {
                id: "candidate",
                path: [entangle, option.cell],
              }).length,
          ),
        )
      : undefined;
    const choices = broader
      ? clearOptions.filter(
          (option) =>
            arrowTrack(input.board, {
              id: "candidate",
              path: [entangle, option.cell],
            }).length === shortest,
        )
      : clearOptions;
    const choice = choices[rng.int(choices.length)] as {
      heading: Heading;
      cell: Cell;
    };
    let path = [entangle, choice.cell];
    if (grownWormhole) {
      let stemFits = true;
      for (let step = 0, gap = rng.int(3); step < gap; step++) {
        const heading = headingForPath(path, size);
        if (!heading) {
          stemFits = false;
          break;
        }
        const next = stepSurface(path[path.length - 1]!, heading, size);
        if (
          bannedKey(cellKey(next)) ||
          path.some((c) => cellKey(c) === cellKey(next))
        ) {
          stemFits = false;
          break;
        }
        path.push(next);
      }
      if (!stemFits) continue;
      path = growMechanicBody(
        input.board,
        rng,
        path,
        new Set([
          ...input.occupied,
          ...input.parkTracks,
          ...input.reservedCells,
          ...spotKeys,
          ...stopKeys,
          ...blockerKeys,
          ...laneKeys,
        ]),
        Math.max(path.length, 3 + rng.int(6)),
      );
      if (path.length < 3) continue;
    }
    const blocker: ArrowDefinition = {
      id: `r${id}${XBLOCK_MARKER}${kind}${blockers.length}`,
      path,
    };
    const routeKeys = arrowTrack(input.board, blocker)
      .slice(blocker.path.length)
      .map(cellKey);
    // The route may cross a core's lane cells, which are empty by the time
    // the blocker leaves, but never a core body or any other reserve.
    if (routeKeys.some(bannedRoute)) continue;
    const proofBoard: LevelDefinition = {
      ...input.coreBoard,
      arrows: [...input.coreBoard.arrows, ...blockers, blocker],
    };
    // A blocker sits on a core lane, so it leaves first: the fill graph's
    // body edges order it ahead of the core arrow it covers.
    const proofCertificate = [
      ...blockers.map((placed) => placed.id),
      blocker.id,
      ...input.certificate,
    ];
    if (!validateGenerated(proofBoard, proofCertificate)) {
      if (grownFlip || grownWormhole) continue;
      break;
    }
    blockers.push(blocker);
    for (const cell of blocker.path) blockerKeys.add(cellKey(cell));
  }
  return blockers;
}

/**
 * The proven dance order: solve the region on a board holding only its own
 * arrows and circles, exactly as `flipRegionLead` does, and keep the
 * consecutive arrow ids as fill-graph precedence constraints. Empty on a
 * failed derivation — the graph then falls back to body-blocker edges only.
 */
function regionDanceOrder(
  level: LevelDefinition,
  spots: readonly DirectionalSpotDefinition[],
  stops: readonly Cell[],
  placed: readonly ArrowDefinition[],
): readonly string[] {
  const seeds = regionCoreIds(placed);
  const allStops = [...(level.stops ?? []), ...stops];
  const probe: LevelDefinition = {
    ...level,
    arrows: [...placed],
    directionals: [...spots],
    ...(allStops.length > 0 ? { stops: allStops } : {}),
  };
  const region = interactionRegion(probe, seeds);
  if (!region) return [];
  const regionStops = new Set(region.stopKeys);
  const regionStopsList = (probe.stops ?? []).filter((stop) =>
    regionStops.has(cellKey(stop)),
  );
  const { stops: _allStops, ...bare } = probe;
  const sub: LevelDefinition = {
    ...bare,
    arrows: probe.arrows.filter((arrow) => region.arrowIds.includes(arrow.id)),
    ...(regionStopsList.length > 0 ? { stops: regionStopsList } : {}),
  };
  const targets = solveLevelTargets(sub);
  if (!targets) return [];
  const dance: string[] = [];
  for (const target of targets) {
    if (dance[dance.length - 1] !== target.arrowId) dance.push(target.arrowId);
  }
  return dance;
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
 * strand or soft-lock it. A seeded coin prefers the cross-face variant, which
 * routes the key lane across a seam so the key cell lands on a neighboring
 * face; a cross aspirant that cannot fit falls back to the same-face pattern.
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
  const openerId = `r${id}${LOCK_CORE_MARKER}opener`;
  const keyId = `r${id}${LOCK_CORE_MARKER}key`;
  // A seeded coin on its own stream PREFERS the cross-face variant: each
  // attempt evaluates the cross geometry first and falls back to the
  // same-face pattern through the full validation chain, so placement never
  // regresses and only ids that actually place cross-face change fingerprint.
  const crossRng = coreStream(id, "lock-core-cross", restart);
  const crossFace = crossRng.int(2) === 0;
  const parkingPresent = level.arrows.some((arrow) =>
    arrow.id.includes("-park-"),
  );
  const axis = HEADINGS[crossRng.int(4)]!;
  const side = rotatedHeading(axis);
  /** Build one variant's geometry for this attempt's face, gate, rotation. */
  const buildVariant = (
    cross: boolean,
    face: FaceId,
    gate: Cell,
    at: (delta: readonly [number, number]) => Cell,
  ): { arrows: readonly ArrowDefinition[]; key: Cell } | undefined => {
    if (!cross) {
      return {
        arrows: [
          { id: openerId, path: LOCK_PATTERN.opener.map(at) },
          { id: keyId, path: LOCK_PATTERN.key.map(at) },
        ],
        key: at(LOCK_PATTERN.keyCell),
      };
    }
    // The key lane runs from the gate's side across a seam, putting the key
    // cell on the neighbor face two cells past the seam; the opener sits
    // opposite the lane, aimed at the gate.
    const laneBase = stepSurface(gate, side, size);
    let edge = laneBase;
    let depth = 0;
    while (depth < size) {
      if (stepSurface(edge, axis, size).face !== edge.face) break;
      edge = stepSurface(edge, axis, size);
      depth += 1;
    }
    if (depth < 3) return undefined;
    const lane: Cell[] = [edge];
    for (let back = 0; back < 3; back += 1) {
      lane.unshift(stepSurface(lane[0]!, oppositeHeading(axis), size));
    }
    const keyCandidate = stepSurface(stepSurface(edge, axis, size), axis, size);
    const o1 = stepSurface(gate, oppositeHeading(side), size);
    const o2 = stepSurface(o1, oppositeHeading(side), size);
    if (o2.face !== face || keyCandidate.face === face) return undefined;
    return {
      arrows: [
        { id: openerId, path: [o2, o1] },
        { id: keyId, path: lane },
      ],
      key: keyCandidate,
    };
  };
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
    const variants: {
      arrows: readonly ArrowDefinition[];
      key: Cell;
    }[] = [];
    const cross = buildVariant(true, face, gate, at);
    if (cross) variants.push(cross);
    const same = buildVariant(false, face, gate, at);
    // Parking walks occupy more varied topology than the old small stamps.
    // Give the existing cross-face geometry a bounded placement search before
    // accepting the same-face fallback; otherwise its first miss erases it.
    if (same && !(parkingPresent && crossFace && attempt < 8))
      variants.push(same);
    for (const { arrows, key } of variants) {
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
      if (state.status !== "won" || !state.unlocked?.includes(lock.id))
        continue;
      if (hasStrandingState(coreLevel) !== false) continue;
      if (hasSoftLockState(coreLevel) !== false) continue;
      return { arrows, lock, certificate, cells };
    }
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
 * The leap-core geometry relative to the pad at (0, 0), rotated per placement
 * attempt. The leaper faces a bent blocker: the blocker's body covers the
 * pad's skip cell, and its head points back at the leaper's head, so each
 * lane ends on the other's body. The pad alone breaks the deadlock: the
 * leaper leaps over the blocker's body and exits past it, and the blocker
 * then leaps the same pad in the other direction over the vacated cells.
 */
export const LEAP_PATTERN = {
  leaper: [
    [-2, 0],
    [-1, 0],
  ],
  blocker: [
    [1, 0],
    [1, -1],
    [0, -1],
    [0, -2],
    [-1, -2],
    [-1, -1],
  ],
} as const;

/** Every generated leap-core arrow id carries this marker. */
export const LEAP_CORE_MARKER = "-leap-";

interface LeapCore {
  readonly arrows: readonly ArrowDefinition[];
  readonly pad: Cell;
  /** The core's solution: the leaper, then the blocker. */
  readonly certificate: readonly MoveTarget[];
  /** Bodies, the pad, and both lanes, reserved from later placement. */
  readonly cells: ReadonlySet<string>;
}

/**
 * Place a leap core on its own seeded stream, modeled on `mirrorCore`. Every
 * lane the two arrows can travel (under every flip and rotor state), plus the
 * pad, must avoid every reserved cell and the parking core's and groups'
 * tracks, and no arrow already placed may reach any core cell, so the core
 * plays alone. On the core board by itself the solver must clear it, the same
 * board with the pad stripped must be deadlocked, and no order may strand or
 * soft-lock it, with the leaper leaving before the blocker. Only the
 * leaper's lane crosses the pad; the blocker's lane is the plain run it
 * drives once the leaper has vacated its head cell.
 */
function leapCore(
  id: number,
  level: LevelDefinition,
  occupied: ReadonlySet<string>,
  forbiddenTracks: ReadonlySet<string>,
  restart: number,
): LeapCore | undefined {
  const size = level.gridSize;
  const rng = coreStream(id, "leap-core", restart);
  const faces = shuffledFaces(rng);
  const margin = 3;
  const inBounds = (cell: Cell): boolean =>
    cell.x >= 0 && cell.y >= 0 && cell.x < size && cell.y < size;
  // The leap certificate leads the whole replay, so already-placed cores move
  // only after the leaper and blocker have fully exited and only their bodies
  // can block them; their tracks crossing a lane are harmless. Everything
  // placed later keeps off the core's cells and lanes through the shared
  // reservations.
  const existing = level.arrows.map((arrow) => arrow.path.map(cellKey));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const face = faces[attempt % faces.length] as FaceId;
    const rotation = rng.int(4);
    const padCell: Cell = {
      face,
      x: margin + rng.int(Math.max(1, size - 2 * margin)),
      y: margin + rng.int(Math.max(1, size - 2 * margin)),
    };
    const at = ([dx, dy]: readonly [number, number]): Cell =>
      patternCell(padCell, dx, dy, rotation);
    const leaperId = `r${id}${LEAP_CORE_MARKER}leaper`;
    const blockerId = `r${id}${LEAP_CORE_MARKER}blocker`;
    const arrows: ArrowDefinition[] = [
      { id: leaperId, path: LEAP_PATTERN.leaper.map(at) },
      { id: blockerId, path: LEAP_PATTERN.blocker.map(at) },
    ];
    const bodies = arrows.flatMap((arrow) => arrow.path);
    if (
      [...bodies, padCell].some(
        (cell) => !inBounds(cell) || occupied.has(cellKey(cell)),
      )
    )
      continue;
    const padKey = cellKey(padCell);
    const cells = new Set<string>([padKey, ...bodies.map(cellKey)]);
    // The lanes must be the POST-mechanic routes: the pad's skip remaps the
    // leaper's lane, so the reservation traces on a board that carries the
    // pad.
    let lanesFit = true;
    for (const probe of flipHeadingProbes(level)) {
      const leapBoard = { ...probe, leaps: [padCell] };
      for (const arrow of arrows) {
        const keys = arrowTrack(leapBoard, arrow).map(cellKey);
        if (arrow.id === leaperId && !keys.includes(padKey)) lanesFit = false;
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
    const coreLevel: LevelDefinition = {
      id: level.id,
      title: level.title,
      gridSize: level.gridSize,
      lives: level.lives,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
      arrows,
      leaps: [padCell],
    };
    if (!validateLevel(coreLevel).valid) continue;
    const stripped = { ...coreLevel, leaps: [] };
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
    const order = certificate.map((target) => target.arrowId);
    if (
      order.indexOf(leaperId) < 0 ||
      order.indexOf(leaperId) > order.indexOf(blockerId)
    )
      continue;
    return { arrows, pad: padCell, certificate, cells };
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
  const core = constructRotor(
    level,
    coreStream(id, "rotor-topology-v1", restart),
    occupied,
    parkTracks,
    // Each level already has independent construction restarts. Keep this
    // optional path search cheap when a prior mechanic closes its lanes.
    32,
  );
  if (!core) return undefined;
  const verdict = acceptFlipRegion(
    level,
    [...level.arrows, ...core.arrows],
    [...(level.directionals ?? []), ...core.spots],
    [...(level.stops ?? []), ...core.stops],
  );
  if (verdict.ok) {
    return {
      arrows: core.arrows,
      spots: core.spots,
      stops: core.stops,
      cells: verdict.cells,
      blockers: [],
      dance: [],
    };
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
              [arrows[traverser]!.id],
              arrows[traverser]!.id,
            );
            if (alone.kind !== "exit") {
              fits = false;
              break;
            }
            // The bend must never fold a traverser back over its own body:
            // self-passage is legal only as a head-on bounce off a spot, so a
            // candidate whose bent route slides into the body is rejected here
            // and by the matching validation rule.
            const passage = selfPassageError(arrows[traverser]!, trial, "head");
            if (passage) {
              fits = false;
              break;
            }
            const blocked = alone.route.some(
              (routeCell) =>
                parkTrackKeys.has(cellKey(routeCell)) ||
                trackForbidden.has(cellKey(routeCell)) ||
                cellsBefore[traverser]!.has(cellKey(routeCell)),
            );
            if (blocked) {
              fits = false;
              break;
            }
            const totalBends = arrowTrack(trial, arrows[traverser]!).filter(
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
 * circles, which `constructParking` proves safe by enumeration; any other circle
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
 * Replay a construction certificate. A park entry advances the named arrow to
 * its next circle and leaves it parked there; every other entry is driven
 * through its pauses until it exits before the next arrow is tried. Flip and
 * rotor directions carry from move to move, as they do in play.
 */
type CertificateEntry = string | MoveTarget;

/**
 * The arrow ids a certificate taps, in order, consecutive repeats merged.
 * A core whose chain repeats an id non-consecutively is a multi-leg dance
 * the one-exit removal graph cannot express.
 */
function certificateToChain(
  certificate: readonly CertificateEntry[],
): readonly string[] {
  const chain: string[] = [];
  for (const entry of certificate) {
    const arrowId =
      typeof entry === "string"
        ? entry.startsWith(PARK_CERTIFICATE_PREFIX)
          ? entry.slice(PARK_CERTIFICATE_PREFIX.length)
          : entry
        : entry.arrowId;
    if (chain[chain.length - 1] !== arrowId) chain.push(arrowId);
  }
  return chain;
}

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
 * Build a pure, reproducible level. The flip or rotor region leads; other
 * arrows participate in the acyclic removal graph. A synthesized parking
 * cycle enters as one atomic node: its multi-leg certificate runs after its
 * ordinary lane blockers, then the rest of the graph continues. Only its
 * parked windows and circle stay body-reserved. Outside routes stay off its
 * tracks so an early park cannot strand an outside arrow.
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
  // A planned leap core gets its own pass after the mirror's, a copy of the
  // pass ahead of it (so on a mirror-planned id it carries the mirror, lock
  // and fragile cores too); a level whose leap pass gives up is the exact
  // plan-zero construction.
  const leapPlanned = leapCorePlanned(id);
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
      leapPass: false,
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
    const mirrorPasses = [
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
    const passes = [
      ...(leapPlanned && tier.certificate
        ? [
            {
              ...(mirrorPasses[0] as (typeof mirrorPasses)[number]),
              leapPass: true,
            },
          ]
        : []),
      ...mirrorPasses,
    ];
    for (const {
      spotPlan,
      flipPass,
      rotorPass,
      fragilePass,
      lockPass,
      mirrorPass,
      leapPass,
    } of passes) {
      // The rotor core's own circle comes out of the circle budget first.
      const parkBudget = getStopCount(id) - (rotorPass ? 1 : 0);
      // Wormhole slots, like the double core, exist only on certificate
      // tiers; a give-up below withdraws them so the pass rebuilds as the
      // exact plan-zero construction.
      let slots = tier.certificate ? wormholeSlots : 0;
      // Lane blockers are optional: their reserved routes fence the fill, so
      // a restart that seeded any and then failed is retried once at the
      // same restart with lane seeding off. Lane streams share nothing with
      // construction, so the retry is the exact no-seeded-blocker construction
      // (cores stay graph nodes) and
      // entanglement never costs a core placement (measured 2026-10-05:
      // without the retry, blocker-fenced restarts failed coverage or depth
      // and the next restart dropped its wormholes, 0.789 to 0.706 placed).
      let lanesOff = false;
      let lanesSingle = false;
      let lanesSeeded = false;
      let restart = 0;
      const nextRestart = (): void => {
        if (lanesSeeded && !lanesOff) {
          // Grown flip regions can crowd a second optional blocker. Keep
          // one proven blocker per mechanic before dropping every lane.
          if (flipPass && !lanesSingle) {
            lanesSingle = true;
            return;
          }
          lanesOff = true;
          return;
        }
        lanesOff = false;
        lanesSingle = false;
        restart += 1;
      };
      construction: for (; restart < 8; nextRestart()) {
        lanesSeeded = false;
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
            continue;
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
            ? constructParking(
                { ...candidateLevel, arrows },
                coreStream(id, "park-topology-v1", restart),
                occupied,
                parkBudget,
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
        // Earlier mechanic placements and starters avoid the parking
        // tracks. The fill can put bodies on its lanes through the atomic
        // parking node; outside routes remain fenced for strand safety.
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
          continue;
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
              // The region circle is only worth proving when the level also
              // carries its parking core: every circle must sit on a
              // required-use structure, so a park-core-less level plans none.
              core ? getStopCount(id) - core.stops.length : 0,
              restart,
            )
          : rotorPass
            ? rotorCore(id, regionBoard, occupied, regionTracks, restart)
            : undefined;
        if (flipPass && !flip) {
          skip = "flip-core";
          continue;
        }
        if (rotorPass && !flip) {
          skip = "rotor-core";
          continue;
        }
        if (flip) {
          for (const arrow of flip.arrows) arrows.push(arrow);
          for (const key of flip.cells) occupied.add(key);
        }
        // A planned wormhole core searches around the proved stateful region
        // on its own stream. A placement that fails drops the hole
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
          const wormhole = wormholeCore(
            id,
            coreBoard,
            new Set([...occupied, ...groupTracks]),
            restart,
          );
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
          continue;
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
          continue;
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
          continue;
        }
        if (mirror) {
          for (const arrow of mirror.arrows) arrows.push(arrow);
          for (const key of mirror.cells) occupied.add(key);
        }
        // The leap core comes after the mirror core, fenced the same way.
        const leap = leapPass
          ? leapCore(
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
        if (leapPass && !leap) {
          skip = "leap-core";
          continue;
        }
        if (leap) {
          for (const arrow of leap.arrows) arrows.push(arrow);
          for (const key of leap.cells) occupied.add(key);
        }
        const lockKeys = lock
          ? [cellKey(lock.lock.lock), cellKey(lock.lock.key)]
          : [];
        const mirrorKeys = mirror ? [cellKey(mirror.mirror.cell)] : [];
        const leapKeys = leap ? [cellKey(leap.pad)] : [];
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
        // Independently placed cores can already repeat a shape past the cap
        // before the fill runs, and the fill can only refuse more copies.
        // Certificate tiers restart; the final tier accepts the board rather
        // than throwing, like the depth and coverage gates.
        if (
          tier.certificate &&
          [...shapeCounts.values()].some((count) => count > cap)
        ) {
          skip = "shape";
          continue;
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
        // nodes. Their bodies are never fill cells. Only the flip or rotor
        // region leads. The parking cycle is one atomic graph node; every
        // other core is a per-arrow graph node, so
        // its body blocks fill cells as an owner cell and its lane is
        // fill-blockable like any starter's.
        const leadIds = new Set<string>([
          ...(flip?.arrows ?? []).map((arrow) => arrow.id),
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
        // Entangled cores: the region core (only when it seeded blockers)
        // and every lane core, whether or not blockers seeded. Their arrows
        // and blockers are graph nodes, so they leave the lead set for
        // emission and the certificate.
        const laneCores: {
          kind: LaneKind;
          arrows: readonly ArrowDefinition[];
          certificate: readonly CertificateEntry[];
          coreBoard: LevelDefinition;
          cellKeys: ReadonlySet<string>;
        }[] = [
          ...(wormholes.length > 0
            ? [
                {
                  kind: "wormhole" as const,
                  arrows: wormholes.flatMap((entry) => entry.arrows),
                  certificate: wormholes.flatMap((entry) => entry.certificate),
                  coreBoard: {
                    ...candidateLevel,
                    arrows: [] as ArrowDefinition[],
                    wormholes: wormholes.map((entry) => entry.wormhole),
                  },
                  cellKeys: portalKeys,
                },
              ]
            : []),
          ...(fragile && fragileKey
            ? [
                {
                  kind: "fragile" as const,
                  arrows: fragile.arrows,
                  certificate: fragile.certificate,
                  coreBoard: {
                    ...candidateLevel,
                    arrows: [] as ArrowDefinition[],
                    fragile: [fragile.cell],
                  },
                  cellKeys: new Set([fragileKey]),
                },
              ]
            : []),
          ...(lock
            ? [
                {
                  kind: "lock" as const,
                  arrows: lock.arrows,
                  certificate: lock.certificate,
                  coreBoard: {
                    ...candidateLevel,
                    arrows: [] as ArrowDefinition[],
                    locks: [lock.lock],
                  },
                  cellKeys: new Set(lockKeys),
                },
              ]
            : []),
          ...(mirror
            ? [
                {
                  kind: "mirror" as const,
                  arrows: mirror.arrows,
                  certificate: mirror.certificate,
                  coreBoard: {
                    ...candidateLevel,
                    arrows: [] as ArrowDefinition[],
                    mirrors: [mirror.mirror],
                  },
                  cellKeys: new Set(mirrorKeys),
                },
              ]
            : []),
          ...(leap
            ? [
                {
                  kind: "leap" as const,
                  arrows: leap.arrows,
                  certificate: leap.certificate,
                  coreBoard: {
                    ...candidateLevel,
                    arrows: [] as ArrowDefinition[],
                    leaps: [leap.pad],
                  },
                  cellKeys: new Set(leapKeys),
                },
              ]
            : []),
        ];
        const entangled: {
          kind: string;
          arrows: readonly ArrowDefinition[];
          blockers: readonly ArrowDefinition[];
          chain: readonly string[];
        }[] = [];
        if (flip && flip.blockers.length > 0)
          entangled.push({
            kind: "region",
            arrows: flip.arrows,
            blockers: flip.blockers,
            chain: flip.dance,
          });
        const entangledTargets = new Map<string, MoveTarget>();
        const priorBlockerKeys = new Set<string>();
        for (const lane of laneCores) {
          const laneBoard: LevelDefinition = {
            ...lane.coreBoard,
            arrows: [...lane.arrows],
            ...(nodeBoard.directionals.length > 0
              ? { directionals: nodeBoard.directionals }
              : {}),
            ...(core ? { stops: core.stops } : {}),
          };
          const seededBlockers = lanesOff
            ? []
            : seedLaneBlockers({
                kind: lane.kind,
                id,
                restart,
                board: laneBoard,
                coreArrows: lane.arrows,
                certificate: lane.certificate,
                coreBoard: laneBoard,
                occupied,
                parkTracks: parkTrackKeys,
                // Earlier lanes' blockers are not in `occupied`, so their bodies
                // and routes are reserved here to keep lanes from colliding.
                reservedCells: new Set([
                  ...lane.cellKeys,
                  ...portalKeys,
                  ...(fragileKey ? [fragileKey] : []),
                  ...lockKeys,
                  ...mirrorKeys,
                  ...leapKeys,
                  ...priorBlockerKeys,
                ]),
                // Lead bodies and tracks are gone before any graph node moves,
                // so a blocker route may cross them; the flip region stays fenced.
                crossable: new Set(
                  [...occupied].filter(
                    (key) => !(flip?.cells ?? new Set()).has(key),
                  ),
                ),
                inBounds: (cell) =>
                  cell.x >= 0 &&
                  cell.y >= 0 &&
                  cell.x < candidateLevel.gridSize &&
                  cell.y < candidateLevel.gridSize,
              });
          const blockers = lanesSingle
            ? seededBlockers.slice(0, 1)
            : seededBlockers;
          for (const blocker of blockers) {
            for (const cell of blocker.path)
              priorBlockerKeys.add(cellKey(cell));
            for (const cell of arrowTrack(nodeBoard, blocker).slice(
              blocker.path.length,
            ))
              priorBlockerKeys.add(cellKey(cell));
          }
          entangled.push({
            kind: lane.kind,
            arrows: lane.arrows,
            blockers,
            chain: certificateToChain(lane.certificate),
          });
          // A core tap may name an endpoint (a double leaving by its tail),
          // so the graph section replays the core's own entry, not its id.
          for (const entry of lane.certificate) {
            if (typeof entry !== "string")
              entangledTargets.set(entry.arrowId, entry);
          }
        }
        if (double)
          entangled.push({
            kind: "double",
            arrows: double.arrows,
            blockers: [],
            chain: certificateToChain(double.certificate),
          });
        if (directionalSpot)
          entangled.push({
            kind: "directional",
            arrows: directionalSpot.arrows,
            blockers: [],
            chain: directionalSpot.arrows.map((arrow) => arrow.id),
          });
        for (const entry of double ? double.certificate : []) {
          if (typeof entry !== "string")
            entangledTargets.set(entry.arrowId, entry);
        }
        lanesSeeded = entangled.some(
          (entry) => entry.kind !== "region" && entry.blockers.length > 0,
        );
        const entangledKinds = new Set(entangled.map((entry) => entry.kind));
        const flipEntangled = entangledKinds.has("region");
        const entangledBlockers = entangled.flatMap((entry) => entry.blockers);
        // Grown blockers can have capped shapes too; account for them before
        // ordinary fill chooses its bodies. The old two-cell blockers had no
        // canonical shape and did not expose this omission.
        for (const blocker of entangledBlockers) countShape(blocker.path);
        if (
          tier.certificate &&
          [...shapeCounts.values()].some((count) => count > cap)
        ) {
          skip = "shape";
          continue;
        }
        const emissionExcluded = new Set(
          entangled.flatMap((entry) => entry.arrows.map((arrow) => arrow.id)),
        );
        const emissionLeads = new Set(
          [...leadIds].filter((arrowId) => !emissionExcluded.has(arrowId)),
        );
        // Release parking lanes to fill bodies, then reserve every parked
        // window and the circle. The atomic node orders lane blockers before
        // the park; window protection also keeps arbitrary early parks safe.
        const bodyKeys = new Set(
          arrows.flatMap((arrow) => arrow.path.map(cellKey)),
        );
        const forbiddenBody = new Set<string>([
          ...[...occupied].filter((key) => !bodyKeys.has(key)),
        ]);
        for (const key of parkTrackKeys) forbiddenBody.delete(key);
        for (const arrow of core?.arrows ?? []) {
          const track = arrowTrack(parkBoard, arrow);
          for (const stop of core?.stops ?? []) {
            const index = track.findIndex(
              (cell) => cellKey(cell) === cellKey(stop),
            );
            if (index < arrow.path.length) continue;
            for (const cell of currentPath(
              parkBoard,
              arrow,
              index - arrow.path.length + 1,
            ))
              forbiddenBody.add(cellKey(cell));
          }
        }
        for (const stop of core?.stops ?? []) forbiddenBody.add(cellKey(stop));
        // Lane cores are graph nodes, so their lanes are ordinary routes a
        // fill body may block. Only the mechanic cells stay reserved; lead
        // tracks and blocker routes are re-added below. The flip or rotor
        // region and every spot cell stay reserved too: a fill body's cells
        // come from the backwards walk and tail growth, which check
        // `forbiddenBody` but never `forbiddenRay`, so a released cell
        // inside the region or on a spot would take a fill body outside
        // every proof that reserved it.
        {
          const laneBoard = {
            ...nodeBoard,
            ...(wormholes.length > 0
              ? { wormholes: wormholes.map((entry) => entry.wormhole) }
              : {}),
            ...(fragile ? { fragile: [fragile.cell] } : {}),
            ...(lock ? { locks: [lock.lock] } : {}),
            ...(mirror ? { mirrors: [mirror.mirror] } : {}),
            ...(leap ? { leaps: [leap.pad] } : {}),
          };
          const mechanicCells = new Set(
            laneCores.flatMap((lane) => [...lane.cellKeys]),
          );
          const regionKeys = flip?.cells ?? new Set<string>();
          const spotKeys = new Set(
            nodeBoard.directionals.map((spot) => cellKey(spot.cell)),
          );
          for (const lane of laneCores)
            for (const arrow of lane.arrows)
              for (const probe of flipHeadingProbes(laneBoard))
                for (const cell of arrowTrack(probe, arrow)) {
                  const key = cellKey(cell);
                  if (
                    !mechanicCells.has(key) &&
                    !parkTrackKeys.has(key) &&
                    !regionKeys.has(key) &&
                    !spotKeys.has(key)
                  )
                    forbiddenBody.delete(key);
                }
          // The double and directional cores are graph nodes too, so their
          // tracks (both ends of a double) release the same way.
          for (const arrow of [
            ...(double?.arrows ?? []),
            ...(directionalSpot?.arrows ?? []),
          ])
            for (const path of arrow.kind === "double"
              ? [arrow.path, [...arrow.path].reverse()]
              : [arrow.path])
              for (const probe of flipHeadingProbes(laneBoard))
                for (const cell of arrowTrack(probe, { ...arrow, path })) {
                  const key = cellKey(cell);
                  if (
                    !mechanicCells.has(key) &&
                    !parkTrackKeys.has(key) &&
                    !regionKeys.has(key) &&
                    !spotKeys.has(key)
                  )
                    forbiddenBody.delete(key);
                }
        }
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
          // A pad skips a route's next cell, so no fill route may cross it.
          ...leapKeys,
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
        // A blocker's route stays reserved like a core lane: no fill body
        // sits on it and no fill route crosses it.
        for (const blocker of entangledBlockers) {
          for (const key of arrowTrack(nodeBoard, blocker)
            .slice(blocker.path.length)
            .map(cellKey)) {
            forbiddenBody.add(key);
            forbiddenRay.add(key);
          }
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
          continue;
        }
        const nodeRoute = (arrow: ArrowDefinition): readonly string[] =>
          arrowTrack(nodeBoard, arrow).slice(arrow.path.length).map(cellKey);
        // An entangled core's routes must be traced with its mechanic in
        // place: a mirror or pad bends a lane off the stripped line, which
        // would otherwise run into the partner core arrow's body and close a
        // cycle against the certificate's precedence. It carries every
        // mechanic's cells, which is a no-op for cores it does not trace,
        // because those cells are reserved or ray-forbidden to other arrows.
        const entangledBoard = {
          ...leadBoard,
          ...(fragile ? { fragile: [fragile.cell] } : {}),
          ...(lock ? { locks: [lock.lock] } : {}),
          ...(mirror ? { mirrors: [mirror.mirror] } : {}),
          ...(leap ? { leaps: [leap.pad] } : {}),
        };
        // New wormhole boards reserve the proved stateful region first.
        // Its heading-dependent internal edges are one atomic multi-leg node,
        // not a union of mutually exclusive static dependencies. Unplanned
        // wormhole boards keep their preceding generator construction exactly.
        const atomicMembers =
          slots > 0 && flipEntangled && flip
            ? [...flip.arrows, ...flip.blockers]
            : [];
        const atomicIds = new Set(atomicMembers.map((a) => a.id));
        const atomicLead = atomicMembers.length
          ? flipRegionLead({
              ...entangledBoard,
              arrows: atomicMembers,
              stops: flip?.stops ?? [],
            })
          : [];
        if (atomicMembers.length && !atomicLead) {
          skip = "region-certificate";
          continue;
        }
        const graphNodes: FillNode[] = [
          ...(core
            ? [
                {
                  id: core.arrows[0]!.id,
                  arrows: core.arrows,
                  routeKeys: new Set(core.arrows.flatMap(nodeRoute)),
                },
              ]
            : []),
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
          ...entangled.flatMap((entry) =>
            slots > 0 && entry.kind === "region"
              ? [
                  {
                    id: atomicMembers[0]!.id,
                    arrows: atomicMembers,
                    routeKeys: new Set(
                      atomicMembers.flatMap((arrow) =>
                        flipHeadingProbes(entangledBoard).flatMap((probe) =>
                          arrowTrack(probe, arrow)
                            .slice(arrow.path.length)
                            .map(cellKey),
                        ),
                      ),
                    ),
                  },
                ]
              : [
                  ...entry.arrows.map((arrow) => ({
                    id: arrow.id,
                    arrows: [arrow],
                    routeKeys: new Set(
                      (arrow.kind === "double"
                        ? entangledTargets.get(arrow.id)?.endpoint === "tail"
                          ? [[...arrow.path].reverse()]
                          : entangledTargets.get(arrow.id)?.endpoint === "head"
                            ? [arrow.path]
                            : [arrow.path, [...arrow.path].reverse()]
                        : [arrow.path]
                      ).flatMap((path) =>
                        flipHeadingProbes(entangledBoard).flatMap((probe) =>
                          arrowTrack(probe, { ...arrow, path })
                            .slice(path.length)
                            .map(cellKey),
                        ),
                      ),
                    ),
                  })),
                  ...entry.blockers.map((arrow) => ({
                    id: arrow.id,
                    arrows: [arrow],
                    routeKeys: new Set(nodeRoute(arrow)),
                  })),
                ],
          ),
        ];
        const nodeIds = new Set(graphNodes.map((node) => node.id));
        // Blockers enter the board as graph nodes, so they spend the budget.
        const prefilled = arrows.length + entangledBlockers.length;
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
            ...(entangled.length > 0
              ? {
                  // A core can hold lead arrows that are not graph nodes.
                  precedence: entangled.flatMap((entry) => {
                    const kept = entry.chain.filter((arrowId) =>
                      nodeIds.has(arrowId),
                    );
                    return kept
                      .slice(1)
                      .map((afterId, index): [string, string] => [
                        kept[index] as string,
                        afterId,
                      ]);
                  }),
                }
              : {}),
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
          continue;
        }
        if (fill.placed < config.arrowCount - prefilled) {
          skip = "count";
          continue;
        }
        // Emit graph nodes in reverse removal order, then the leads: the
        // certificate's reversed array is then a valid removal order, and
        // `cellsBefore` in the spot passes means "bodies still present when
        // this arrow moves". `arrows` stays the same array object.
        const leads = arrows.filter((arrow) => emissionLeads.has(arrow.id));
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
        // Circles the flip region was proven with; the rotor's own
        // load-bearing circle arrives the same way. Only proven cores carry
        // circles now, so a level with no required parking places none.
        const regionStops = flip ? flip.stops : [];
        const placeStops = (): readonly Cell[] => [
          ...(core ? core.stops : []),
          ...regionStops,
        ];
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
          ...(leap ? { leaps: [leap.pad] } : {}),
        });
        const level = assemble(placeStops());
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
        // Only the core reaches its pad: an outside arrow entering it would
        // leap outside the core's proof. Starter rays and spots placed after
        // the core are what its reservation cannot fence.
        if (
          leapKeys.length > 0 &&
          level.arrows.some((arrow) => {
            if (arrow.id.includes(LEAP_CORE_MARKER)) return false;
            const reach = occupancyKeys(level, arrow);
            return leapKeys.some((key) => reach.has(key));
          })
        ) {
          skip = "leap";
          continue;
        }
        // The flip region is proven again on the assembled level: later
        // spots and circles can bend tracks toward it, and nothing outside
        // it may ever reach its cells. Its own solution leads.
        const flipLead = flip ? flipRegionLead(level) : [];
        // Leads replay first, each core in the order its own proof uses; the
        // parking node injects its park legs at its position in the graph,
        // then unwinds in reverse placement order after its lane blockers.
        // The fragile core touches no other arrow's reach, so its crossing
        // certificate may lead wherever it sits.
        const certificate: CertificateEntry[] = [
          // An entangled core replays in the graph section, after its
          // blockers, so its own certificate must not lead.
          ...(fragile && !entangledKinds.has("fragile")
            ? fragile.certificate
            : []),
          ...(lock && !entangledKinds.has("lock") ? lock.certificate : []),
          ...(mirror && !entangledKinds.has("mirror")
            ? mirror.certificate
            : []),
          ...(leap && !entangledKinds.has("leap") ? leap.certificate : []),
          ...(entangledKinds.has("wormhole")
            ? []
            : wormholes.flatMap((entry) => entry.certificate)),
          ...(double && !entangledKinds.has("double")
            ? double.certificate
            : []),
          ...(directionalSpot && !entangledKinds.has("directional")
            ? directionalSpot.arrows.map((arrow) => arrow.id)
            : []),
          ...[...arrows]
            .reverse()
            .filter((arrow) => !emissionLeads.has(arrow.id))
            .flatMap((arrow): CertificateEntry[] => {
              if (atomicIds.has(arrow.id))
                return arrow.id === atomicMembers[atomicMembers.length - 1]?.id
                  ? [...(atomicLead ?? [])]
                  : [];
              return [
                ...(core && arrow.id === core.arrows[core.arrows.length - 1]!.id
                  ? core.parkLegs
                  : []),
                entangledTargets.get(arrow.id) ?? arrow.id,
              ];
            }),
        ];
        const accepted =
          flipLead !== undefined &&
          (tier.certificate
            ? validateGenerated(
                level,
                flipEntangled ? certificate : [...flipLead, ...certificate],
              )
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
              ...(leap ? { leaps: [leap.pad] } : {}),
            };
            const trimmedStops = [...(core ? core.stops : []), ...regionStops];
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
                ? validateGenerated(
                    trimmed,
                    flipEntangled
                      ? certificate
                      : [...(trimmedLead ?? []), ...certificate],
                  )
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
