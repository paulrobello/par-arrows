import { describe, expect, test } from "bun:test";
import {
  blockedStats,
  blockedTarget,
  blockerReserve,
  chainDepthLimit,
  generateLevel,
  PARK_PATTERNS,
} from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { ArrowDefinition, Cell, LevelDefinition } from "../src/core/types";
import { solveLevel, validateLevel } from "../src/core/validation";

function frontArrow(
  id: string,
  cells: readonly (readonly [number, number])[],
): ArrowDefinition {
  return {
    id,
    path: cells.map(([x, y]) => ({ face: "front" as const, x, y })),
  };
}

function plainLevel(arrows: readonly ArrowDefinition[]): LevelDefinition {
  return { id: 100, title: "test", gridSize: 12, lives: 3, arrows };
}

describe("generator variety helpers", () => {
  test("chain depth gate is 1 before 21, 2 through 39, and 3 from 40", () => {
    for (const id of [1, 5, 11, 15, 19, 20])
      expect(chainDepthLimit(id)).toBe(1);
    for (const id of [21, 22, 30, 39]) expect(chainDepthLimit(id)).toBe(2);
    for (const id of [40, 41, 60, 1_000_000])
      expect(chainDepthLimit(id)).toBe(3);
  });

  test("blocked target is zero through authored levels and ramps 0.30 to 0.55", () => {
    for (const id of [1, 2, 9, 10, 11, 15, 20])
      expect(blockedTarget(id)).toBe(0);
    expect(blockedTarget(12)).toBeCloseTo(0.3);
    expect(blockedTarget(24)).toBeCloseTo(0.3625);
    expect(blockedTarget(36)).toBeCloseTo(0.425);
    expect(blockedTarget(60)).toBeCloseTo(0.55);
    expect(blockedTarget(1_000)).toBeCloseTo(0.55);
  });

  test("blocker reserve scales the target over the level's arrow budget", () => {
    expect(blockerReserve(10)).toBe(0);
    for (const id of [11, 15, 20]) expect(blockerReserve(id)).toBe(0);
    expect(blockerReserve(12)).toBe(56); // ceil(0.30 * 186)
    expect(blockerReserve(60)).toBe(146); // ceil(0.55 * 264)
  });

  test("blockedStats disagrees between the bare board and the stop-assembled board", () => {
    // A stop circle parks the victim before it would collide with the
    // blocker, turning `blocked` into `paused` without changing the arrow
    // count. This is the exact class of split the acceptance gate must
    // measure on the assembled level rather than the bare board: gating on
    // `bare` here would report share 0.5 (on target) while the level
    // actually shipped is at share 0 (a below-target level shipped silently).
    const blocker = frontArrow("blocker", [
      [0, 0],
      [1, 0],
    ]);
    const victim = frontArrow("victim", [
      [1, 3],
      [1, 2],
    ]);
    const bare = plainLevel([blocker, victim]);
    expect(blockedStats(bare)).toEqual({ blocked: 1, total: 2 });
    const withStop: LevelDefinition = {
      ...bare,
      stops: [{ face: "front", x: 1, y: 1 }],
    };
    expect(blockedStats(withStop)).toEqual({ blocked: 0, total: 2 });
  });

  test("blockedStats counts tap units once and groups as one unit", () => {
    // straight's southward body runs into pair's head cell from above, so
    // straight is blocked while pair exits east unimpeded.
    const pair = frontArrow("pair-a", [
      [0, 0],
      [1, 0],
    ]);
    const straight = frontArrow("straight", [
      [1, 3],
      [1, 2],
    ]);
    const solo = plainLevel([pair, straight]);
    expect(blockedStats(solo)).toEqual({ blocked: 1, total: 2 });

    // pair-b and pair-a share the directed non-head link (0,0)>(1,0), so both
    // become one tap unit; the group exits (pair-b east, pair-a bending south,
    // siblings ignoring each other) and only straight — descending into
    // pair-b's head cell from above — is blocked. Two units, one blocked,
    // proves the group counted once. A 2-cell member cannot group at all:
    // its only link is the head link, which sharing excludes.
    const pairB = frontArrow("pair-b", [
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const pairA = frontArrow("pair-a", [
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    const groupedStraight = frontArrow("straight", [
      [2, 3],
      [2, 2],
    ]);
    const grouped = plainLevel([pairB, pairA, groupedStraight]);
    expect(blockedStats(grouped)).toEqual({ blocked: 1, total: 2 });
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
  return { id: 100, title: "pattern", gridSize: 14, lives: 3, arrows, stops };
}

describe("park pattern catalog", () => {
  test("carries the four legacy shapes plus twist, crossfire, and twin", () => {
    expect(PARK_PATTERNS.map((pattern) => pattern.name).sort()).toEqual([
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
    }
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

describe("blocked push", () => {
  test("share meets the target curve from level twelve onward", () => {
    for (const id of [12, 18, 30, 45, 80]) {
      const level = generateLevel(id);
      const stats = blockedStats(level);
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.blocked / stats.total).toBeGreaterThanOrEqual(
        blockedTarget(id) - 0.06,
      );
    }
  }, 180_000);

  test("overlap cubes stay structurally valid and meet the target curve", () => {
    for (const id of [16, 17, 18, 19]) {
      const level = generateLevel(id);
      expect(validateLevel(level).valid).toBe(true);
      const stats = blockedStats(level);
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.blocked / stats.total).toBeGreaterThanOrEqual(
        blockedTarget(id) - 0.06,
      );
    }
  }, 120_000);
});
