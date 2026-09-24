import { describe, expect, test } from "bun:test";
import {
  hasFlipSpots,
  isFlipSpot,
  spotHeadingAt,
} from "../src/core/directionals";
import { createGameState } from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type { Cell, Heading, LevelDefinition } from "../src/core/types";

export function cell(x: number, y: number): Cell {
  return { face: "front", x, y };
}

export function flipLevel(
  arrows: LevelDefinition["arrows"],
  spots: { x: number; y: number; heading: Heading; kind?: "flip" | "static" }[],
  stops: Cell[] = [],
  gridSize = 6,
): LevelDefinition {
  return {
    id: 901,
    title: "Flip fixture",
    gridSize,
    lives: 3,
    arrows,
    directionals: spots.map((spot) => ({
      cell: cell(spot.x, spot.y),
      heading: spot.heading,
      kind: spot.kind ?? "flip",
    })),
    ...(stops.length > 0 ? { stops } : {}),
  };
}

describe("flip spot state", () => {
  test("reads the current direction from game state, else the authored one", () => {
    const level = flipLevel([], [{ x: 2, y: 2, heading: "north" }]);
    expect(spotHeadingAt(level, cell(2, 2))).toBe("north");
    expect(
      spotHeadingAt(level, cell(2, 2), { [cellKey(cell(2, 2))]: "south" }),
    ).toBe("south");
    expect(spotHeadingAt(level, cell(3, 3))).toBeUndefined();
  });

  test("static spots ignore any stored direction", () => {
    const level = flipLevel(
      [],
      [{ x: 2, y: 2, heading: "north", kind: "static" }],
    );
    expect(
      spotHeadingAt(level, cell(2, 2), { [cellKey(cell(2, 2))]: "south" }),
    ).toBe("north");
    expect(isFlipSpot(level, cell(2, 2))).toBe(false);
    expect(hasFlipSpots(level)).toBe(false);
  });

  test("a spread copy with new spots reads its own spots", () => {
    const level = flipLevel([], [{ x: 2, y: 2, heading: "north" }]);
    expect(spotHeadingAt(level, cell(2, 2))).toBe("north");
    const copy = { ...level, arrows: [] };
    expect(spotHeadingAt(copy, cell(2, 2))).toBe("north");
    const moved = {
      ...level,
      directionals: [{ cell: cell(2, 2), heading: "east" as Heading }],
    };
    expect(spotHeadingAt(moved, cell(2, 2))).toBe("east");
    expect(isFlipSpot(moved, cell(2, 2))).toBe(false);
    expect(hasFlipSpots({})).toBe(false);
  });

  test("a new game starts with no flipped spots", () => {
    const level = flipLevel([], [{ x: 2, y: 2, heading: "north" }]);
    expect(createGameState(level).spotHeadings).toEqual({});
    expect(isFlipSpot(level, cell(2, 2))).toBe(true);
    expect(hasFlipSpots(level)).toBe(true);
  });
});
