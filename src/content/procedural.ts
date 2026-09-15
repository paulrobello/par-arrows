import {
  cellKey,
  forwardInfo,
  oppositeHeading,
  stepSurface,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  Heading,
  LevelDefinition,
} from "../core/types";
import { simulateMove } from "../core/movement";
import { validateLevel } from "../core/validation";
import { LEVEL_ONE } from "./intro";

export const GENERATOR_VERSION = 1;
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
  return `par-arrows:runtime:${GENERATOR_VERSION}:level:${id}`;
}

export function getLevelConfig(id: number): LevelConfig {
  assertLevelId(id);
  if (id === 1) {
    return { gridSize: 4, arrowCount: 6, lives: 5, arrowScale: 1 };
  }
  const early = [0, 60, 84, 108, 132, 156, 168, 180, 180, 180];
  const earlyGrid = [0, 12, 13, 15, 16, 18, 18, 20, 21, 22];
  const index = id - 1;
  const arrowCount =
    id <= 10
      ? (early[index] ?? 180)
      : Math.min(240, 180 + Math.floor((id - 10) / 3) * 6);
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

function exitRay(head: Cell, heading: Heading, size: number): readonly Cell[] {
  const ray: Cell[] = [];
  let current = head;
  for (let step = 0; step <= size; step += 1) {
    ray.push(current);
    const forward = forwardInfo(current, heading, size);
    if (forward.exits) return ray;
    if (!forward.next) return [];
    current = forward.next;
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
  size: number,
  occupied: ReadonlySet<string>,
  length: number,
): readonly Cell[] | undefined {
  const head: Cell = {
    face: rng.pick(FACES),
    x: rng.int(size),
    y: rng.int(size),
  };
  const heading = rng.pick(HEADINGS);
  const ray = exitRay(head, heading, size);
  if (ray.length === 0 || ray.some((cell) => occupied.has(cellKey(cell))))
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

function validateGenerated(
  level: LevelDefinition,
  certificate: readonly string[],
): boolean {
  if (!validateLevel(level).valid) return false;
  let remaining = level.arrows.map((arrow) => arrow.id);
  for (const arrowId of certificate) {
    if (simulateMove(level, remaining, arrowId).kind !== "exit") return false;
    remaining = remaining.filter((id) => id !== arrowId);
  }
  return remaining.length === 0;
}

/**
 * Build a pure, reproducible level. Insertion is reverse construction: each
 * arrow has an exit unobstructed by earlier arrows, so reverse insertion is a
 * real no-mistake solution certificate.
 */
export function generateLevel(id: number): LevelDefinition {
  assertLevelId(id);
  if (id === 1) return LEVEL_ONE;
  const config = getLevelConfig(id);
  const baseSeed = hashSeed(seedForLevel(id));
  for (let restart = 0; restart < 8; restart += 1) {
    const rng = new Rng((baseSeed + Math.imul(restart + 1, 0x9e3779b9)) >>> 0);
    const occupied = new Set<string>();
    const arrows: ArrowDefinition[] = [];
    const candidateLevel = {
      id,
      title: `Cube ${id}`,
      gridSize: config.gridSize,
      lives: config.lives,
      arrowScale: config.arrowScale,
    } as const;
    const faces = shuffledFaces(rng);
    const headingOffset = rng.int(HEADINGS.length);
    for (const [index, length] of [2, 3, 4].entries()) {
      const face = faces[index];
      const heading = HEADINGS[(headingOffset + index) % HEADINGS.length];
      if (!face || !heading)
        throw new Error("Could not choose a seeded straight-arrow starter.");
      const path = straightCandidate(
        rng,
        config.gridSize,
        face,
        heading,
        length,
        occupied,
      );
      if (!path)
        throw new Error(
          "Seeded straight-arrow starters unexpectedly overlapped.",
        );
      const arrow: ArrowDefinition = {
        id: `r${id}-straight-${length}`,
        path,
      };
      if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
        throw new Error("Seeded straight-arrow starter was invalid.");
      for (const cell of path) occupied.add(cellKey(cell));
      arrows.push(arrow);
    }
    for (
      let attempt = 0;
      arrows.length < config.arrowCount && attempt < config.arrowCount * 900;
      attempt += 1
    ) {
      const path = candidate(
        rng,
        config.gridSize,
        occupied,
        targetLength(rng, id, config),
      );
      if (!path) continue;
      const arrow: ArrowDefinition = { id: `r${id}-${arrows.length}`, path };
      if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
        continue;
      for (const cell of path) occupied.add(cellKey(cell));
      arrows.push(arrow);
    }
    if (arrows.length !== config.arrowCount) continue;
    const level: LevelDefinition = {
      id,
      title: `Cube ${id}`,
      gridSize: config.gridSize,
      lives: config.lives,
      arrowScale: config.arrowScale,
      arrows,
    };
    const certificate = [...arrows].reverse().map((arrow) => arrow.id);
    if (validateGenerated(level, certificate)) return level;
  }
  throw new Error(`Could not deterministically construct runtime level ${id}.`);
}
