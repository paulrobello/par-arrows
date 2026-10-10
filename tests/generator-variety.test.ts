import { describe, expect, test } from "bun:test";
import { chainDepthLimit, generateLevel } from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { solveLevel } from "../src/core/validation";
import type { LevelDefinition } from "../src/core/types";

describe("generator variety helpers", () => {
  test("chain depth gate is 1 before 21, 2 through 39, and 3 from 40", () => {
    for (const id of [1, 5, 11, 15, 19, 20])
      expect(chainDepthLimit(id)).toBe(1);
    for (const id of [21, 22, 30, 39]) expect(chainDepthLimit(id)).toBe(2);
    for (const id of [40, 41, 60, 1_000_000])
      expect(chainDepthLimit(id)).toBe(3);
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
