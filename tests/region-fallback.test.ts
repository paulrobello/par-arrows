import { describe, expect, test } from "bun:test";
import { acceptFlipRegion } from "../src/content/procedural";
import type { Cell } from "../src/core/types";

function cell(x: number, y: number): Cell {
  return { face: "front", x, y };
}

const flipCore = (id: number) => [
  { id: `r${id}-flip-bounce-reverser`, path: [cell(1, 3), cell(1, 2)] },
  { id: `r${id}-flip-bounce-runner`, path: [cell(3, 1), cell(2, 1)] },
  { id: `r${id}-flip-bounce-cap`, path: [cell(1, 0), cell(2, 0)] },
];

describe("flip region acceptance", () => {
  test("accepts the bounce core with a stop inside the region", () => {
    // A stop may not sit on an authored cell — the brief's (2,1) is the
    // runner's head cell, which validateLevel rejects — so the stop goes on
    // the reverser's bounce lane past the spot, the same legal placement
    // tests/region.test.ts pins.
    const board = {
      id: 910,
      title: "t",
      gridSize: 6,
      lives: 3,
      arrows: flipCore(31),
    };
    const spot = {
      cell: cell(1, 1),
      heading: "south" as const,
      kind: "flip" as const,
    };
    const verdict = acceptFlipRegion(board as never, board.arrows, spot, [
      cell(1, 4),
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.cells.has("front:1:1")).toBe(true);
    expect(verdict.cells.has("front:1:4")).toBe(true);
  });

  test("rejects and reports when the region cannot prove", () => {
    // A north-heading wall across the reverser's southern exit lane: the
    // reverser cannot exit through the wall, the wall cannot exit through
    // the reverser, and the closure recruits the wall, so the region strands
    // and acceptance fails, letting the caller fall back. (The brief's wall
    // at (2,2)-(2,3) touches no cell any region arrow occupies, so the region
    // would prove fine without it.)
    const blocked = [
      ...flipCore(32),
      { id: "r32-wall", path: [cell(1, 5), cell(1, 4)] },
    ];
    const board = {
      id: 911,
      title: "t",
      gridSize: 6,
      lives: 3,
      arrows: blocked,
    };
    const spot = {
      cell: cell(1, 1),
      heading: "south" as const,
      kind: "flip" as const,
    };
    const verdict = acceptFlipRegion(board as never, blocked, spot, []);
    expect(verdict.ok).toBe(false);
  });

  test("overflows past the arrow cap return not-ok", () => {
    // Extras chained into the region: extra-0 shares the cap's exit lane,
    // the column-4 pairs chain down extra-0's track, and the lane pair
    // shares the reverser's bounce lane, so the closure recruits a seventh
    // member and overflows the six-arrow cap. (The brief's (5,index) second
    // cells repeat their first cell and none of them touch the region, so
    // the closure would stop at four members and pass.)
    const many = [...flipCore(33)];
    many.push({ id: "r33-extra-0", path: [cell(4, 0), cell(4, 1)] });
    many.push({ id: "r33-extra-1", path: [cell(4, 2), cell(4, 3)] });
    many.push({ id: "r33-extra-2", path: [cell(4, 4), cell(4, 5)] });
    many.push({ id: "r33-extra-3", path: [cell(1, 4), cell(1, 5)] });
    const board = {
      id: 912,
      title: "t",
      gridSize: 6,
      lives: 3,
      arrows: many,
    };
    const spot = {
      cell: cell(1, 1),
      heading: "south" as const,
      kind: "flip" as const,
    };
    const verdict = acceptFlipRegion(board as never, many, spot, []);
    expect(verdict.ok).toBe(false);
    expect(verdict.cells.size).toBe(0);
  });
});
