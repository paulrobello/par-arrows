import { describe, expect, test } from "bun:test";
import {
  hasFlipSpots,
  isFlipSpot,
  spotHeadingAt,
} from "../src/core/directionals";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
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

describe("flip movement", () => {
  // Level-30 layout on a 4x4 front face.
  const intro = () =>
    flipLevel(
      [
        { id: "reverser", path: [cell(1, 3), cell(1, 2)] },
        { id: "guard", path: [cell(0, 0), cell(1, 0)] },
        { id: "runner", path: [cell(3, 1), cell(2, 1)] },
      ],
      [{ x: 1, y: 1, heading: "south" }],
      [],
      4,
    );

  test("a reversing arrow flips the spot once, after its last cell leaves", () => {
    const level = intro();
    const state = createGameState(level);
    const result = simulateMove(level, state, "reverser");
    expect(result.kind).toBe("exit");
    expect(result.spotFlips?.map((flip) => cellKey(flip.cell))).toEqual([
      cellKey(cell(1, 1)),
    ]);
    const next = applyMove(level, state, result);
    expect(next.spotHeadings).toEqual({ [cellKey(cell(1, 1))]: "north" });
  });

  test("the spot's current direction decides which arrow is safe", () => {
    const level = intro();
    let state = createGameState(level);
    expect(simulateMove(level, state, "runner").kind).toBe("blocked");
    state = applyMove(level, state, simulateMove(level, state, "reverser"));
    const runner = simulateMove(level, state, "runner");
    expect(runner.kind).toBe("blocked");
    expect(runner.blockerId).toBe("guard");
    state = applyMove(level, state, simulateMove(level, state, "guard"));
    expect(state.spotHeadings).toEqual({ [cellKey(cell(1, 1))]: "north" });
    const last = simulateMove(level, state, "runner");
    expect(last.kind).toBe("exit");
    state = applyMove(level, state, last);
    expect(state.status).toBe("won");
    expect(state.spotHeadings).toEqual({ [cellKey(cell(1, 1))]: "south" });
  });

  test("a collision with the tail still on the spot leaves it unflipped", () => {
    const level = flipLevel(
      [
        { id: "mover", path: [cell(0, 2), cell(1, 2), cell(2, 2)] },
        { id: "wall", path: [cell(4, 1), cell(3, 1)] },
      ],
      [{ x: 3, y: 2, heading: "north" }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "mover");
    expect(result.kind).toBe("blocked");
    expect(result.spotFlips ?? []).toEqual([]);
    const next = applyMove(level, state, result);
    expect(next.spotHeadings).toEqual({});
    expect(next.lives).toBe(level.lives - 1);
  });

  test("a collision after clearing the spot restores its direction", () => {
    const level = flipLevel(
      [
        { id: "mover", path: [cell(0, 3), cell(1, 3)] },
        { id: "wall", path: [cell(1, 0), cell(2, 0)] },
      ],
      [{ x: 2, y: 3, heading: "north" }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "mover");
    expect(result.kind).toBe("blocked");
    expect(result.spotFlips?.map((flip) => cellKey(flip.cell))).toEqual([
      cellKey(cell(2, 3)),
    ]);
    expect(applyMove(level, state, result).spotHeadings).toEqual({});
  });

  test("an arrow parked on a spot keeps the flip pending until it moves off", () => {
    const level = flipLevel(
      [{ id: "mover", path: [cell(0, 2), cell(1, 2)] }],
      [{ x: 2, y: 2, heading: "north" }],
      [cell(2, 1)],
    );
    let state = createGameState(level);
    const parked = simulateMove(level, state, "mover");
    expect(parked.kind).toBe("paused");
    expect(parked.spotFlips ?? []).toEqual([]);
    state = applyMove(level, state, parked);
    expect(state.spotHeadings).toEqual({});
    expect(state.settledPaths?.mover?.map(cellKey)).toEqual(
      [cell(2, 2), cell(2, 1)].map(cellKey),
    );
    const onward = simulateMove(level, state, "mover");
    expect(onward.kind).toBe("exit");
    state = applyMove(level, state, onward);
    expect(state.spotHeadings).toEqual({ [cellKey(cell(2, 2))]: "south" });
  });

  test("a parked arrow that collides keeps its pending flip", () => {
    const level = flipLevel(
      [
        { id: "mover", path: [cell(0, 2), cell(1, 2)] },
        { id: "wall", path: [cell(3, 0), cell(2, 0)] },
      ],
      [{ x: 2, y: 2, heading: "north" }],
      [cell(2, 1)],
    );
    let state = createGameState(level);
    state = applyMove(level, state, simulateMove(level, state, "mover"));
    const blocked = simulateMove(level, state, "mover");
    expect(blocked.kind).toBe("blocked");
    state = applyMove(level, state, blocked);
    expect(state.spotHeadings).toEqual({});
    expect(state.settledPaths?.mover?.map(cellKey)).toEqual(
      [cell(2, 2), cell(2, 1)].map(cellKey),
    );
  });

  test("a head that crosses a spot twice in one passage flips it once", () => {
    // The head enters the west spot at (4,2) head-on and reverses; the body
    // stays on (4,2) until the tail catches up, so the passage ends once.
    const level = flipLevel(
      [{ id: "long", path: [cell(1, 2), cell(2, 2), cell(3, 2)] }],
      [{ x: 4, y: 2, heading: "west" }],
    );
    const result = simulateMove(level, createGameState(level), "long");
    expect(result.kind).toBe("exit");
    expect(result.spotFlips).toHaveLength(1);
  });

  test("a head re-entering a spot its body still covers does not flip it", () => {
    // The static spot at (4,2) sends the head back over the flip spot at
    // (3,2) before the tail leaves it, so the passage never ends and the
    // head shuttles between the two spots. Flipping (3,2) mid-passage would
    // instead let the head escape west and exit.
    const level = flipLevel(
      [{ id: "long", path: [cell(0, 2), cell(1, 2), cell(2, 2)] }],
      [
        { x: 3, y: 2, heading: "east" },
        { x: 4, y: 2, heading: "west", kind: "static" },
      ],
    );
    const result = simulateMove(level, createGameState(level), "long");
    expect(result.kind).toBe("invalid");
    expect(result.reason).toContain("cycle");
  });
});
