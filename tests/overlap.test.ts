import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import { solveLevel, validateLevel } from "../src/core/validation";

function level(
  arrows: readonly ArrowDefinition[],
  gridSize = 5,
): LevelDefinition {
  return { id: 900, title: "Overlap fixture", gridSize, lives: 2, arrows };
}

const pair: readonly ArrowDefinition[] = [
  {
    id: "north",
    path: [
      { face: "front", x: 0, y: 2 },
      { face: "front", x: 1, y: 2 },
      { face: "front", x: 1, y: 1 },
    ],
  },
  {
    id: "east",
    path: [
      { face: "front", x: 0, y: 2 },
      { face: "front", x: 1, y: 2 },
      { face: "front", x: 2, y: 2 },
    ],
  },
];

describe("overlapping arrow groups", () => {
  test("finds staggered same-direction shared tail segments and ordinary singletons", () => {
    const staggered = level([
      {
        id: "early",
        path: [
          { face: "front", x: 0, y: 1 },
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
          { face: "front", x: 2, y: 0 },
        ],
      },
      {
        id: "late",
        path: [
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
          { face: "front", x: 3, y: 1 },
          { face: "front", x: 3, y: 0 },
        ],
      },
      {
        id: "alone",
        path: [
          { face: "back", x: 0, y: 1 },
          { face: "back", x: 1, y: 1 },
        ],
      },
    ]);
    expect(overlappingArrowIds(staggered, "late")).toEqual(["early", "late"]);
    expect(overlappingArrowIds(staggered, "alone")).toEqual(["alone"]);
    expect(validateLevel(staggered).valid).toBe(true);
  });

  test("a tap on either member exits and clears the whole group", () => {
    const fixture = level(pair);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "east");
    expect(result.kind).toBe("exit");
    expect(result.arrowId).toBe("east");
    expect(result.members?.map((member) => member.arrowId)).toEqual([
      "north",
      "east",
    ]);
    expect(result.members?.every((member) => member.kind === "exit")).toBe(
      true,
    );
    const settled = applyMove(fixture, initial, result);
    expect(settled.remainingIds).toEqual([]);
    expect(settled.status).toBe("won");
    expect(solveLevel(fixture)).toEqual(["north"]);
  });

  test("a blocked nonclicked member blocks and marks the group with one life", () => {
    const fixture = level([
      ...pair,
      {
        id: "wall",
        path: [
          { face: "front", x: 3, y: 2 },
          { face: "front", x: 3, y: 3 },
        ],
      },
    ]);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "north");
    expect(result.kind).toBe("blocked");
    expect(
      result.members?.find((member) => member.arrowId === "north")?.kind,
    ).toBe("exit");
    expect(
      result.members?.find((member) => member.arrowId === "east")?.kind,
    ).toBe("blocked");
    const first = applyMove(fixture, initial, result);
    expect(first.failedIds).toEqual(["north", "east"]);
    expect(first.lives).toBe(1);
    const retry = applyMove(
      fixture,
      first,
      simulateMove(fixture, first, "east"),
    );
    expect(retry.failedIds).toEqual(["north", "east"]);
    expect(retry.lives).toBe(1);
    expect(applyMove(fixture, retry, result)).toBe(retry);
  });

  test("an invalid member prevents a blocked sibling from charging a life", () => {
    const fixture = level([
      {
        id: "east",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 3, y: 2 },
        ],
      },
      {
        id: "invalid",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 4, y: 4 },
        ],
      },
      {
        id: "wall",
        path: [
          { face: "front", x: 3, y: 2 },
          { face: "front", x: 3, y: 3 },
        ],
      },
    ]);
    const initial = createGameState(fixture);
    const result = simulateMove(fixture, initial, "east");
    expect(result.kind).toBe("invalid");
    expect(applyMove(fixture, initial, result)).toBe(initial);
  });

  test("rejects opposite-direction shared links and shared heads", () => {
    const opposite = level([
      {
        id: "forward",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 2, y: 2 },
        ],
      },
      {
        id: "reverse",
        path: [
          { face: "front", x: 2, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 0, y: 2 },
        ],
      },
    ]);
    expect(validateLevel(opposite).valid).toBe(false);
    const sharedHead = level([
      {
        id: "one",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 2, y: 2 },
        ],
      },
      {
        id: "two",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 2, y: 2 },
          { face: "front", x: 2, y: 1 },
        ],
      },
    ]);
    expect(validateLevel(sharedHead).valid).toBe(false);
    const [firstMember, secondMember] = pair;
    if (!firstMember || !secondMember)
      throw new Error("Overlap fixture is incomplete.");
    const doubleMember = level([
      { ...firstMember, kind: "double" },
      secondMember,
    ]);
    expect(validateLevel(doubleMember).valid).toBe(false);
  });

  test("rejects future travel paths that meet after members leave the shared segment", () => {
    const fixture = level([
      {
        id: "eastbound",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
        ],
      },
      {
        id: "northbound",
        path: [
          { face: "front", x: 0, y: 2 },
          { face: "front", x: 1, y: 2 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 3, y: 3 },
          { face: "front", x: 3, y: 2 },
        ],
      },
    ]);
    expect(validateLevel(fixture).valid).toBe(false);
  });

  test("rejects groups larger than three", () => {
    const fixture = level([
      {
        id: "one",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 3, y: 3 },
        ],
      },
      {
        id: "two",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 2, y: 2 },
        ],
      },
      {
        id: "three",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 2, y: 4 },
        ],
      },
      {
        id: "four",
        path: [
          { face: "front", x: 0, y: 3 },
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
          { face: "front", x: 3, y: 3 },
          { face: "front", x: 4, y: 3 },
        ],
      },
    ]);
    expect(validateLevel(fixture).errors).toContain(
      "Shared-tail group four|one|three|two has more than three arrows.",
    );
  });
});
