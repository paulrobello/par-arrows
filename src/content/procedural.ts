import { advanceHead, simulateMove } from "../core/movement";
import { overlappingArrowIds } from "../core/overlap";
import {
  cellKey,
  oppositeHeading,
  seamTransition,
  stepSurface,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  EdgePolicyDefinition,
  FaceId,
  Heading,
  LevelDefinition,
} from "../core/types";
import { validateLevel } from "../core/validation";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "./intro";
import { OVERLAP_INTRO_LEVEL } from "./overlap-intro";

export const GENERATOR_VERSION = 3;
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
  if (id === 11) return "par-arrows:runtime:2:level:11:wrap-intro:1";
  if (id <= 10) return `par-arrows:runtime:1:level:${id}`;
  if (id <= 14) return `par-arrows:runtime:2:level:${id}`;
  if (id === 15) return "par-arrows:runtime:3:level:15:overlap-intro:1";
  return `par-arrows:runtime:${GENERATOR_VERSION}:level:${id}`;
}

export function getWrappingEdgeWeights(
  id: number,
): readonly [number, number, number, number] {
  assertLevelId(id);
  if (id <= 10) return [1, 0, 0, 0];
  if (id === 11) return [0, 1, 0, 0];
  if (id === 15) return [1, 0, 0, 0];
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
  if (id === 15) return [];
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
  if (id === 1 || id === 11) {
    return { gridSize: 4, arrowCount: 6, lives: 5, arrowScale: 1 };
  }
  if (id === 15) {
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
): readonly Cell[] | undefined {
  const size = level.gridSize;
  const head: Cell = {
    face: rng.pick(FACES),
    x: rng.int(size),
    y: rng.int(size),
  };
  const heading = rng.pick(HEADINGS);
  const ray = exitRay(level, head, heading);
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

function overlapStarter(
  id: number,
  size: number,
  rng: Rng,
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies">,
  occupied: ReadonlySet<string>,
): readonly ArrowDefinition[] | undefined {
  const trio = id % 3 === 0;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const face = rng.pick(shuffledFaces(rng));
    const x = 1 + rng.int(size - 5);
    const y = 1 + rng.int(size - 3);
    const paths: readonly (readonly Cell[])[] = [
      [
        { face, x, y },
        { face, x: x + 1, y },
        { face, x: x + 1, y: y - 1 },
        { face, x: x + 2, y: y - 1 },
      ],
      [
        { face, x, y },
        { face, x: x + 1, y },
        { face, x: x + 1, y: y + 1 },
        { face, x: x + 2, y: y + 1 },
      ],
      [
        { face, x, y },
        { face, x: x + 1, y },
        { face, x: x + 2, y },
        { face, x: x + 3, y },
      ],
    ];
    const selected = trio ? paths : [paths[0], paths[1]];
    if (
      selected.some(
        (path) => !path || path.some((cell) => occupied.has(cellKey(cell))),
      )
    )
      continue;
    const arrows = selected.map((path, index) => ({
      id: `r${id}-overlap-${index}`,
      path: path as readonly Cell[],
    }));
    const groupCells = new Set(
      arrows.flatMap((arrow) => arrow.path.map(cellKey)),
    );
    const hasClearTrajectories = arrows.every((arrow) => {
      const head = arrow.path[arrow.path.length - 1];
      if (!head) return false;
      const ray = exitRay(level, head, "east");
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

function validateGenerated(
  level: LevelDefinition,
  certificate: readonly string[],
): boolean {
  if (!validateLevel(level).valid) return false;
  let remaining = level.arrows.map((arrow) => arrow.id);
  for (const arrowId of certificate) {
    if (!remaining.includes(arrowId)) continue;
    if (simulateMove(level, remaining, arrowId).kind !== "exit") return false;
    const clearedIds = overlappingArrowIds(level, arrowId);
    remaining = remaining.filter((id) => !clearedIds.includes(id));
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
  if (id === 11) return WRAP_INTRO_LEVEL;
  if (id === 15) return OVERLAP_INTRO_LEVEL;
  const config = getLevelConfig(id);
  const baseSeed = hashSeed(seedForLevel(id));
  const edgePolicies = getWrappingEdgePolicies(id);
  construction: for (let restart = 0; restart < 8; restart += 1) {
    const rng = new Rng((baseSeed + Math.imul(restart + 1, 0x9e3779b9)) >>> 0);
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
    if (id >= 16) {
      const group = overlapStarter(
        id,
        config.gridSize,
        rng,
        candidateLevel,
        occupied,
      );
      if (!group || !validateLevel({ ...candidateLevel, arrows: group }).valid)
        continue;
      for (const arrow of group) {
        for (const cell of arrow.path) occupied.add(cellKey(cell));
        arrows.push(arrow);
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
        throw new Error("Could not choose a seeded straight-arrow starter.");
      const path = straightCandidate(
        rng,
        config.gridSize,
        face,
        heading,
        length,
        occupied,
      );
      if (!path) continue construction;
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
        if (ray.length === 0 || ray.some((cell) => occupied.has(cellKey(cell))))
          continue;
        const arrow: ArrowDefinition = { id: `r${id}-wrap-${index / 2}`, path };
        if (!validateLevel({ ...candidateLevel, arrows: [arrow] }).valid)
          continue;
        for (const cell of path) occupied.add(cellKey(cell));
        arrows.push(arrow);
        accepted = true;
        break;
      }
      if (!accepted) continue construction;
    }
    for (
      let attempt = 0;
      arrows.length < config.arrowCount && attempt < config.arrowCount * 900;
      attempt += 1
    ) {
      const path = candidate(
        rng,
        candidateLevel,
        occupied,
        Math.max(
          2,
          Math.floor(
            targetLength(rng, id, config) * (1 - edgePolicies.length * 0.05),
          ),
        ),
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
      ...candidateLevel,
      arrows,
    };
    const certificate = [...arrows].reverse().map((arrow) => arrow.id);
    if (validateGenerated(level, certificate)) return level;
  }
  throw new Error(`Could not deterministically construct runtime level ${id}.`);
}
