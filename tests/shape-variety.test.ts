import { describe, expect, test } from "bun:test";
import {
  canonicalShape,
  getLevelConfig,
  isAuthoredLevel,
  shapeCap,
} from "../src/content/procedural";
import type { Cell } from "../src/core/types";
import { cachedLevel } from "./generated-levels";

const at = (x: number, y: number): Cell => ({ face: "front", x, y });

describe("canonical shapes", () => {
  test("one key for every rotation, mirror and reversal of a path", () => {
    const zigzag = [at(0, 0), at(1, 0), at(1, 1), at(2, 1), at(2, 2)];
    const variants = [
      zigzag,
      zigzag.map(({ x, y }) => at(y, x)),
      zigzag.map(({ x, y }) => at(5 - x, y)),
      zigzag.map(({ x, y }) => at(5 - y, 5 - x)),
      [...zigzag].reverse(),
    ];
    const keys = new Set(variants.map((path) => canonicalShape(path, 8)));
    expect(keys.size).toBe(1);
    expect(
      canonicalShape([at(0, 0), at(1, 0), at(2, 0), at(2, 1)], 8),
    ).not.toBe([...keys][0]);
  });

  test("short and seam-crossing paths have no key", () => {
    expect(canonicalShape([at(0, 0), at(1, 0), at(1, 1)], 8)).toBeUndefined();
    expect(
      canonicalShape(
        [at(0, 0), at(0, 1), at(0, 2), { face: "left", x: 7, y: 2 }],
        8,
      ),
    ).toBeUndefined();
  });

  // Ids 2-10 keep their legacy layouts, so the cap binds from level 12 up.
  test("no generated level from 12 to 200 repeats one shape past its cap", () => {
    for (let id = 12; id <= 200; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      const copies = new Map<string, number>();
      for (const arrow of level.arrows) {
        const shape = canonicalShape(arrow.path, level.gridSize);
        if (shape) copies.set(shape, (copies.get(shape) ?? 0) + 1);
      }
      expect(Math.max(...copies.values()), `level ${id}`).toBeLessThanOrEqual(
        shapeCap(getLevelConfig(id).arrowCount),
      );
    }
  }, 600_000);
});
