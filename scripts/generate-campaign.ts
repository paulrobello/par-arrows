import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  cellKey,
  forwardInfo,
  headingBetween,
  oppositeHeading,
  stepSurface,
} from "../src/core/topology";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  Heading,
  LevelDefinition,
} from "../src/core/types";
import { simulateMove } from "../src/core/movement";
import { solveLevel, validateLevel } from "../src/core/validation";

const output = resolve(
  import.meta.dirname,
  "../src/content/campaign-layouts.ts",
);
const FACES: readonly FaceId[] = [
  "front",
  "back",
  "right",
  "left",
  "top",
  "bottom",
];
const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];
const CONFIG = [
  {
    id: 2,
    size: 12,
    oldSize: 8,
    lives: 5,
    count: 60,
    cells: 540,
    seed: 0x24f1,
  },
  {
    id: 3,
    size: 13,
    oldSize: 9,
    lives: 5,
    count: 84,
    cells: 694,
    seed: 0x35f1,
  },
  {
    id: 4,
    size: 15,
    oldSize: 10,
    lives: 4,
    count: 108,
    cells: 892,
    seed: 0x46f1,
  },
  {
    id: 5,
    size: 16,
    oldSize: 11,
    lives: 4,
    count: 132,
    cells: 1090,
    seed: 0x57f1,
  },
  {
    id: 6,
    size: 18,
    oldSize: 12,
    lives: 4,
    count: 156,
    cells: 1308,
    seed: 0x68f1,
  },
  {
    id: 7,
    size: 18,
    oldSize: 12,
    lives: 3,
    count: 168,
    cells: 1330,
    seed: 0x79f1,
  },
  {
    id: 8,
    size: 20,
    oldSize: 13,
    lives: 3,
    count: 180,
    cells: 1556,
    seed: 0x8af1,
  },
  {
    id: 9,
    size: 21,
    oldSize: 14,
    lives: 3,
    count: 180,
    cells: 1662,
    seed: 0x9bf1,
  },
  {
    id: 10,
    size: 22,
    oldSize: 14,
    lives: 3,
    count: 180,
    cells: 1764,
    seed: 0xacf1,
  },
] as const;

class Rng {
  constructor(private state: number) {}
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
  int(limit: number): number {
    return Math.floor(this.next() * limit);
  }
  pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) throw new Error("Cannot pick from an empty list.");
    return item;
  }
}

function allCells(size: number): readonly Cell[] {
  return FACES.flatMap((face) =>
    Array.from({ length: size * size }, (_, index) => ({
      face,
      x: index % size,
      y: Math.floor(index / size),
    })),
  );
}

function exitRay(head: Cell, heading: Heading, size: number): readonly Cell[] {
  const ray: Cell[] = [];
  let current = head;
  for (let step = 0; step <= size; step += 1) {
    ray.push(current);
    if (forwardInfo(current, heading, size).exits) return ray;
    const next = forwardInfo(current, heading, size).next;
    if (!next) break;
    current = next;
  }
  return [];
}

function routeSteps(path: readonly Cell[], size: number): string {
  return path
    .slice(1)
    .map((cell, index) => {
      const previous = path[index];
      if (!previous) throw new Error("Missing route cell.");
      const heading = headingBetween(previous, cell, size);
      if (!heading) throw new Error("Non-adjacent generated route.");
      return heading[0]?.toUpperCase();
    })
    .join("");
}

function candidate(
  rng: Rng,
  size: number,
  occupied: ReadonlySet<string>,
  reservedFaces: ReadonlySet<FaceId>,
  targetLength: number,
): readonly Cell[] | undefined {
  const head = rng.pick(allCells(size));
  const heading = rng.pick(HEADINGS);
  const ray = exitRay(head, heading, size);
  if (ray.length === 0 || ray.some((cell) => occupied.has(cellKey(cell))))
    return undefined;
  const pathFromHead: Cell[] = [head];
  const used = new Set<string>([...occupied, ...ray.map(cellKey)]);
  let current = head;
  let last = heading;
  for (let step = 1; step < targetLength; step += 1) {
    const allowed =
      step === 1
        ? [oppositeHeading(heading)]
        : HEADINGS.filter((next) => next !== oppositeHeading(last));
    const options = allowed
      .map((next) => ({ next, cell: stepSurface(current, next, size) }))
      .filter(({ cell }) => !used.has(cellKey(cell)));
    if (options.length === 0) break;
    const crossFace = options.filter(({ cell }) => cell.face !== current.face);
    const choice =
      crossFace.length > 0 && rng.next() < 0.3
        ? rng.pick(crossFace)
        : rng.pick(options);
    pathFromHead.push(choice.cell);
    used.add(cellKey(choice.cell));
    current = choice.cell;
    last = choice.next;
  }
  if (pathFromHead.length < 2) return undefined;
  const path = [...pathFromHead].reverse();
  const faces = new Set(path.map((cell) => cell.face));
  if (
    reservedFaces.size > 0 &&
    [...reservedFaces].every((face) => !faces.has(face))
  )
    return undefined;
  return path;
}

function buildLevel(config: (typeof CONFIG)[number]): LevelDefinition {
  const rng = new Rng(config.seed);
  const occupied = new Set<string>();
  const arrows: ArrowDefinition[] = [];
  for (const [face, length, lane] of [
    ["front", 2, 0],
    ["back", 3, 1],
    ["right", 4, 2],
  ] as const) {
    const path = Array.from({ length }, (_, index) => ({
      face,
      x: config.size - length + index,
      y: lane,
    }));
    for (const cell of path) occupied.add(cellKey(cell));
    arrows.push({ id: `l${config.id}-straight-${length}`, path });
  }
  for (
    let attempt = 0;
    arrows.length < config.count && attempt < config.count * 5000;
    attempt += 1
  ) {
    const remaining = config.count - arrows.length;
    const targetLength = Math.max(
      2,
      Math.min(
        22,
        Math.round(config.cells / config.count + 3 + (rng.next() - 0.5) * 8),
      ),
    );
    const visible =
      arrows.length < 3
        ? new Set<FaceId>([FACES[arrows.length] ?? "front"])
        : new Set<FaceId>();
    const path = candidate(rng, config.size, occupied, visible, targetLength);
    if (!path) continue;
    const trial: LevelDefinition = {
      id: config.id,
      title: `Cube ${config.id}`,
      gridSize: config.size,
      lives: config.lives,
      arrows: [...arrows, { id: `l${config.id}-${arrows.length}`, path }],
    };
    if (!validateLevel(trial).valid) continue;
    const newest = trial.arrows.at(-1);
    if (
      !newest ||
      simulateMove(
        trial,
        trial.arrows.map((arrow) => arrow.id),
        newest.id,
      ).kind !== "exit"
    )
      continue;
    for (const cell of path) occupied.add(cellKey(cell));
    arrows.push(trial.arrows.at(-1) as ArrowDefinition);
    if (remaining === 1 && occupied.size < config.cells * 0.9) continue;
  }
  const level: LevelDefinition = {
    id: config.id,
    title: `Cube ${config.id}`,
    gridSize: config.size,
    lives: config.lives,
    arrowScale: config.size / config.oldSize,
    arrows,
  };
  if (
    arrows.length !== config.count ||
    !validateLevel(level).valid ||
    !solveLevel(level)
  )
    throw new Error(
      `Could not construct level ${config.id}: arrows=${arrows.length} cells=${occupied.size} valid=${validateLevel(level).valid} solved=${Boolean(solveLevel(level))}.`,
    );
  return level;
}

const layouts = CONFIG.map(buildLevel);
const data = layouts.map((level) => ({
  id: level.id,
  title: level.title,
  gridSize: level.gridSize,
  lives: level.lives,
  arrowScale: level.arrowScale,
  routes: level.arrows.map((arrow) => ({
    id: arrow.id,
    start: [arrow.path[0]?.face, arrow.path[0]?.x, arrow.path[0]?.y],
    steps: routeSteps(arrow.path, level.gridSize),
  })),
}));
const source = `import type { LevelDefinition } from "../core/types";\nimport { decodeRoute, type FrozenRoute } from "./route-codec";\nexport { decodeRoute, type FrozenRoute } from "./route-codec";\n\ninterface FrozenLayout { readonly id: number; readonly title: string; readonly gridSize: number; readonly lives: number; readonly arrowScale: number; readonly routes: readonly FrozenRoute[]; }\nconst FROZEN_LAYOUTS: readonly FrozenLayout[] = ${JSON.stringify(data)};\nexport const CAMPAIGN_LAYOUTS: readonly LevelDefinition[] = FROZEN_LAYOUTS.map((layout) => ({ ...layout, arrows: layout.routes.map((route) => ({ id: route.id, path: decodeRoute(route, layout.gridSize) })) }));\n`;
await writeFile(output, source);
const formatter = Bun.spawn([
  resolve(import.meta.dirname, "../node_modules/.bin/biome"),
  "format",
  "--write",
  output,
]);
if ((await formatter.exited) !== 0)
  throw new Error("Could not format frozen campaign output.");
