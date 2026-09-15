import { describe, expect, test } from "bun:test";
import { LEVELS } from "../src/content/levels";
import { validateLevel } from "../src/core/validation";
import { arrowDimensions } from "../src/render/renderer";

describe("arrow presentation sizing", () => {
  test("makes the introductory arrows 20 percent wider without lengthening their heads", () => {
    const dimensions = arrowDimensions(4);
    expect(dimensions.ribbonWidth).toBeCloseTo(0.075 * 1.2, 10);
    expect(dimensions.headLength).toBeCloseTo(0.175, 10);
  });

  test("preserves the 20 percent world-width increase when the logical grid becomes finer", () => {
    const oldGrids = [8, 9, 10, 11, 12, 12, 13, 14, 14];
    for (const [index, level] of LEVELS.slice(1).entries()) {
      const oldGrid = oldGrids[index];
      if (!oldGrid) throw new Error("Missing baseline arrow size.");
      const dimensions = arrowDimensions(level.gridSize, level.arrowScale);
      expect(dimensions.ribbonWidth).toBeCloseTo(
        (2 / oldGrid) * 0.15 * 1.2,
        10,
      );
      expect(dimensions.headLength).toBeCloseTo((2 / oldGrid) * 0.35, 10);
      expect(dimensions.ribbonWidth).toBeLessThan(2 / level.gridSize);
    }
  });

  test("rejects invalid display scales before rendering", () => {
    const level = LEVELS[0];
    if (!level) throw new Error("Missing introductory level.");
    for (const arrowScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateLevel({ ...level, arrowScale }).errors).toContain(
        "Arrow display scale must be a positive finite number.",
      );
    }
  });
});
