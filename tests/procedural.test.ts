import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { LevelDefinition } from "../src/core/types";
import { LEVEL_ONE } from "../src/content/intro";
import {
  GENERATOR_VERSION,
  MAX_LEVEL_ID,
  generateLevel,
  getLevelConfig,
  seedForLevel,
} from "../src/content/procedural";
import { simulateMove } from "../src/core/movement";
import { headingBetween } from "../src/core/topology";
import { solveLevel, validateLevel } from "../src/core/validation";

function geometryHash(level: LevelDefinition): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: level.id,
        gridSize: level.gridSize,
        lives: level.lives,
        arrowScale: level.arrowScale,
        arrows: level.arrows,
      }),
    )
    .digest("hex");
}

function diverseLevelIds(): readonly number[] {
  const ids = new Set<number>([
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    100,
    1_000,
    1_000_000,
    MAX_LEVEL_ID,
  ]);
  for (let index = 1; ids.size < 120; index += 1) {
    ids.add(2 + ((index * 77_777_777_777_777) % (MAX_LEVEL_ID - 1)));
  }
  return [...ids];
}

function straightLengths(level: LevelDefinition): readonly number[] {
  return level.arrows
    .filter((arrow) => {
      if (new Set(arrow.path.map((cell) => cell.face)).size !== 1) return false;
      return (
        new Set(arrow.path.map((cell) => cell.x)).size === 1 ||
        new Set(arrow.path.map((cell) => cell.y)).size === 1
      );
    })
    .map((arrow) => arrow.path.length);
}

function normalizedShapeSignature(
  level: LevelDefinition,
  arrow: LevelDefinition["arrows"][number],
): string {
  return arrow.path
    .slice(1)
    .map((cell, index) => {
      const previous = arrow.path[index];
      if (!previous) throw new Error("Arrow path was unexpectedly incomplete.");
      const heading = headingBetween(previous, cell, level.gridSize);
      if (!heading) throw new Error("Generated arrow path was not adjacent.");
      return `${previous.face === cell.face ? "" : "/"}${heading}`;
    })
    .join("");
}

describe("runtime campaign generator", () => {
  test("has a versioned stable seed and rejects unsafe ids", () => {
    expect(GENERATOR_VERSION).toBe(1);
    expect(seedForLevel(1_000_000)).toBe(seedForLevel(1_000_000));
    expect(seedForLevel(1_000_000)).not.toBe(seedForLevel(1_000_001));
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, MAX_LEVEL_ID + 1])
      expect(() => generateLevel(id)).toThrow(RangeError);
  });

  test("keeps level one unchanged and regenerates every later id identically", () => {
    expect(generateLevel(1)).toEqual(LEVEL_ONE);
    for (const id of [2, 10, 11, 100, 1_000, 1_000_000]) {
      expect(generateLevel(id)).toEqual(generateLevel(id));
    }
  });

  test("freezes representative generator version one geometry", () => {
    expect(geometryHash(generateLevel(2))).toBe(
      "9fb45c3beaf0cafeacb20f56ee1fdf45bcccb17769cbc2229a1521339e85b7fa",
    );
    expect(geometryHash(generateLevel(10))).toBe(
      "a1572c55ffc7ac95ef43344545191c17255a64a95a0a50169dd7a0ab85f3eec7",
    );
    expect(geometryHash(generateLevel(1_000))).toBe(
      "5d6ce4bbf6950f7b50089e670813f91e3468555aa39209ba79768d4a46700420",
    );
  });

  test("builds bounded valid levels with reverse construction certificates", () => {
    const layouts = [2, 3, 7, 10, 11, 1_000, 1_000_000].map(generateLevel);
    expect(
      new Set(layouts.map((level) => JSON.stringify(level.arrows))).size,
    ).toBe(layouts.length);
    for (const level of layouts) {
      expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
      expect(level.gridSize).toBeLessThanOrEqual(26);
      expect(level.arrows.length).toBeLessThanOrEqual(240);
      expect(
        Math.max(...level.arrows.map((arrow) => arrow.path.length)),
      ).toBeLessThanOrEqual(40);
      expect(
        new Set(
          level.arrows.flatMap((arrow) => arrow.path.map((cell) => cell.face)),
        ).size,
      ).toBe(6);
      expect(
        level.arrows.some(
          (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
        ),
      ).toBe(true);
      const lengths = straightLengths(level);
      for (const length of [2, 3, 4]) expect(lengths).toContain(length);
      const shapeCopies = new Map<string, number>();
      for (const arrow of level.arrows) {
        const signature = normalizedShapeSignature(level, arrow);
        shapeCopies.set(signature, (shapeCopies.get(signature) ?? 0) + 1);
      }
      expect(Math.max(...shapeCopies.values())).toBeLessThanOrEqual(
        Math.max(6, Math.ceil(level.arrows.length * 0.03)),
      );
      const remaining = level.arrows.map((arrow) => arrow.id);
      for (const arrow of [...level.arrows].reverse()) {
        expect(simulateMove(level, remaining, arrow.id).kind).toBe("exit");
        remaining.splice(remaining.indexOf(arrow.id), 1);
      }
      if ([2, 10, 11].includes(level.id))
        expect(solveLevel(level)).toHaveLength(level.arrows.length);
    }
  });

  test("keeps the intended early curve and continuing capped progression", () => {
    expect(
      [2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => getLevelConfig(id).arrowCount),
    ).toEqual([60, 84, 108, 132, 156, 168, 180, 180, 180]);
    expect(getLevelConfig(3).lives).toBe(5);
    expect(getLevelConfig(6).lives).toBe(4);
    expect(getLevelConfig(7).lives).toBe(3);
    expect(getLevelConfig(1_000_000).gridSize).toBe(26);
    expect(getLevelConfig(1_000_000).arrowCount).toBe(240);
  });

  test("constructs a broad deterministic seeded sweep without quality collapse", () => {
    for (const id of diverseLevelIds()) {
      const level = generateLevel(id);
      expect(seedForLevel(id)).toBe(`par-arrows:runtime:1:level:${id}`);
      expect(validateLevel(level).valid).toBe(true);
      expect(level.gridSize).toBeLessThanOrEqual(26);
      expect(level.arrows.length).toBeLessThanOrEqual(240);
      expect(
        Math.max(...level.arrows.map((arrow) => arrow.path.length)),
      ).toBeLessThanOrEqual(40);
      expect(
        level.arrows.some(
          (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
        ),
      ).toBe(true);
      const lengths = straightLengths(level);
      for (const length of [2, 3, 4]) expect(lengths).toContain(length);
    }
  }, 20_000);
});
