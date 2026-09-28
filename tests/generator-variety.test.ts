import { describe, expect, test } from "bun:test";
import {
  chainDepthLimit,
  generateLevel,
  PARK_PATTERNS,
} from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { ArrowDefinition, Cell, LevelDefinition } from "../src/core/types";
import {
  hasStrandingState,
  solveLevel,
  validateLevel,
} from "../src/core/validation";

describe("generator variety helpers", () => {
  test("chain depth gate is 1 before 21, 2 through 39, and 3 from 40", () => {
    for (const id of [1, 5, 11, 15, 19, 20])
      expect(chainDepthLimit(id)).toBe(1);
    for (const id of [21, 22, 30, 39]) expect(chainDepthLimit(id)).toBe(2);
    for (const id of [40, 41, 60, 1_000_000])
      expect(chainDepthLimit(id)).toBe(3);
  });
});

function patternLevel(
  pattern: (typeof PARK_PATTERNS)[number],
): LevelDefinition {
  const build = (
    deltas: readonly { readonly dx: number; readonly dy: number }[],
    id: string,
  ): ArrowDefinition => ({
    id,
    path: deltas.map(({ dx, dy }) => ({
      face: "front" as const,
      x: 2 + dx,
      y: 2 + dy,
    })),
  });
  const arrows = [
    build(pattern.parker, "p"),
    ...pattern.others.map((deltas, index) => build(deltas, `f${index}`)),
    ...(pattern.second
      ? [
          build(pattern.second.parker, "q"),
          ...pattern.second.others.map((deltas, index) =>
            build(deltas, `g${index}`),
          ),
        ]
      : []),
  ];
  const stops = [...pattern.stops, ...(pattern.second?.stops ?? [])].map(
    ({ dx, dy }): Cell => ({ face: "front", x: 2 + dx, y: 2 + dy }),
  );
  const spots = (pattern.spots ?? []).map(({ dx, dy, heading }) => ({
    cell: { face: "front" as const, x: 2 + dx, y: 2 + dy },
    heading,
  }));
  return {
    id: 100,
    title: "pattern",
    gridSize: 14,
    lives: 3,
    arrows,
    stops,
    ...(spots.length > 0 ? { directionals: spots } : {}),
  };
}

describe("park pattern catalog", () => {
  test("carries the eight park patterns, each with at most three circles", () => {
    expect(PARK_PATTERNS.map((pattern) => pattern.name).sort()).toEqual([
      "bounce",
      "cascade",
      "classic",
      "crossfire",
      "double",
      "long",
      "twin",
      "twist",
    ]);
    for (const pattern of PARK_PATTERNS) {
      const circles =
        pattern.stops.length + (pattern.second?.stops.length ?? 0);
      expect(circles).toBeLessThanOrEqual(3);
    }
  });

  test("every pattern solves by parking and is deadlocked without circles", () => {
    for (const pattern of PARK_PATTERNS) {
      const level = patternLevel(pattern);
      expect(validateLevel(level).valid, pattern.name).toBe(true);
      expect(solveLevel(level), pattern.name).toBeDefined();
      expect(solveLevel({ ...level, stops: [] }), pattern.name).toBeUndefined();
      expect(hasStrandingState(level), pattern.name).toBe(false);
    }
  });

  test("the bounce parker reaches its circle only by reversing over its body", () => {
    const pattern = PARK_PATTERNS.find((entry) => entry.name === "bounce");
    expect(pattern).toBeDefined();
    if (!pattern) return;
    const level = patternLevel(pattern);
    const parker = level.arrows[0] as ArrowDefinition;
    const track = arrowTrack(level, parker).map(cellKey);
    const own = parker.path.map(cellKey);
    // Head-on into the spot, then back across its own tail cells.
    expect(track.slice(parker.path.length, parker.path.length + 3)).toEqual([
      "front:2:2",
      own[1] as string,
      own[0] as string,
    ]);
    expect(track).toContain(cellKey((level.stops ?? [])[0] as Cell));
  });
});

function maximumBends(level: LevelDefinition): number {
  const spotCells = new Set(
    (level.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  let maximum = 0;
  for (const arrow of level.arrows) {
    let bends = 0;
    for (const cell of arrowTrack(level, arrow)) {
      if (spotCells.has(cellKey(cell))) bends += 1;
    }
    maximum = Math.max(maximum, bends);
  }
  return maximum;
}

describe("spot chains", () => {
  test("bends respect the depth gate and chains appear on both ramp bands", () => {
    let depthTwo = 0;
    for (let id = 21; id <= 39; id += 1) {
      const level = generateLevel(id);
      if ((level.directionals ?? []).length === 0) continue;
      const bends = maximumBends(level);
      expect(bends).toBeLessThanOrEqual(2);
      if (bends >= 2) depthTwo += 1;
    }
    expect(depthTwo).toBeGreaterThan(0);
    let depthThree = 0;
    for (let id = 40; id <= 58; id += 1) {
      const level = generateLevel(id);
      if ((level.directionals ?? []).length === 0) continue;
      const bends = maximumBends(level);
      expect(bends).toBeLessThanOrEqual(3);
      if (bends >= 3) depthThree += 1;
    }
    expect(depthThree).toBeGreaterThan(0);
  }, 180_000);

  test("chain cubes still require their spots to clear", () => {
    for (const id of [21, 22, 23, 24, 25]) {
      const level = generateLevel(id);
      if ((level.directionals ?? []).length === 0) continue;
      expect(solveLevel({ ...level, directionals: [] })).toBeUndefined();
    }
  }, 60_000);
});
