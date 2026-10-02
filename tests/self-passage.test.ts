import { describe, expect, test } from "bun:test";
import { cachedLevel } from "./generated-levels";
import type { ArrowDefinition, Cell, LevelDefinition } from "../src/core/types";
import { selfPassageError, validateLevel } from "../src/core/validation";

const baseLevel: LevelDefinition = {
  id: 1,
  title: "Self-passage fixture",
  gridSize: 4,
  lives: 5,
  arrows: [],
};

const cell = (x: number, y: number): Cell => ({ face: "front", x, y });

const arrow = (id: string, path: readonly Cell[]): ArrowDefinition => ({
  id,
  path,
});

describe("self-passage placement rule", () => {
  test("a straight arrow never folds over its own body", () => {
    const level: LevelDefinition = {
      ...baseLevel,
      arrows: [arrow("a", [cell(0, 1), cell(1, 1), cell(2, 1)])],
    };
    expect(validateLevel(level).valid).toBe(true);
    expect(
      selfPassageError(level.arrows[0] as ArrowDefinition, level, "head"),
    ).toBeUndefined();
  });

  test("a head-on spot reversal folds over the body and stays legal", () => {
    // The spot at (3,1) faces the eastbound head; the bounce re-runs the
    // route and body in reverse to the tail edge, which is the mechanic the
    // pass-through rule exists for.
    const level: LevelDefinition = {
      ...baseLevel,
      arrows: [arrow("a", [cell(0, 1), cell(1, 1), cell(2, 1)])],
      directionals: [{ cell: cell(3, 1), heading: "west" }],
    };
    expect(validateLevel(level).valid).toBe(true);
    expect(
      selfPassageError(level.arrows[0] as ArrowDefinition, level, "head"),
    ).toBeUndefined();
  });

  test("a spot bend pointing the route back across the body is rejected", () => {
    // Route: east through wormhole end a at (3,1), out of end b at (0,2)
    // heading east, then a spot at (1,2) bending the head north onto the
    // body cell (1,1). The entry into the bend is a side entry, so the
    // crossing is not sanctioned.
    const level: LevelDefinition = {
      ...baseLevel,
      arrows: [arrow("a", [cell(0, 1), cell(1, 1), cell(2, 1)])],
      wormholes: [
        {
          id: "w",
          a: cell(3, 1),
          b: cell(0, 2),
        },
      ],
      directionals: [{ cell: cell(1, 2), heading: "north" }],
    };
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.includes("folds over its own body")),
    ).toBe(true);
  });

  test("every generated level keeps the self-passage rule", () => {
    for (let id = 2; id <= 200; id += 1) {
      const level = cachedLevel(id);
      for (const arrowInstance of level.arrows) {
        for (const endpoint of arrowInstance.kind === "double"
          ? (["head", "tail"] as const)
          : (["head"] as const)) {
          const problem = selfPassageError(arrowInstance, level, endpoint);
          if (problem) {
            throw new Error(`level ${id}: ${problem}`);
          }
        }
      }
    }
  }, 180_000);
});
