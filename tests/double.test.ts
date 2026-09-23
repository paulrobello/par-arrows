import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { cellKey } from "../src/core/topology";
import type { Cell, FaceId, LevelDefinition } from "../src/core/types";
import { solveLevelTargets, validateLevel } from "../src/core/validation";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

function doubleLane(overrides: Partial<LevelDefinition> = {}): LevelDefinition {
  return {
    id: 950,
    title: "Double lane",
    gridSize: 7,
    lives: 4,
    arrows: [
      {
        id: "double",
        kind: "double",
        path: [cell("front", 2, 3), cell("front", 3, 3)],
      },
    ],
    ...overrides,
  };
}

function blocker(
  id: string,
  x: number,
  y: number,
): LevelDefinition["arrows"][number] {
  return {
    id,
    path: [cell("front", x, y - 1), cell("front", x, y)],
  };
}

describe("two-headed arrows", () => {
  test("parks toward the selected tail and resumes toward either endpoint", () => {
    const level = doubleLane({ stops: [cell("front", 1, 3)] });
    const initial = createGameState(level);

    const tailMove = simulateMove(level, initial, "double", "tail");
    expect(tailMove.endpoint).toBe("tail");
    expect(tailMove.kind).toBe("paused");
    const parked = applyMove(level, initial, tailMove);
    expect(parked.settledPaths?.double).toEqual(tailMove.settledPath);
    expect(parked.settledPaths?.double?.map(cellKey)).toEqual([
      cellKey(cell("front", 1, 3)),
      cellKey(cell("front", 2, 3)),
    ]);

    const towardHead = simulateMove(level, parked, "double", "head");
    expect(towardHead.kind).toBe("exit");
    expect(towardHead.route[0]).toEqual(parked.settledPaths?.double?.at(-1));

    const towardTail = simulateMove(level, parked, "double", "tail");
    expect(towardTail.kind).toBe("exit");
    expect(towardTail.route[0]).toEqual(parked.settledPaths?.double?.at(0));
  });

  test("reverses from the exact settled path after a directional bend", () => {
    const level = doubleLane({
      stops: [cell("front", 4, 2)],
      directionals: [{ cell: cell("front", 4, 3), heading: "north" }],
    });
    const initial = createGameState(level);
    const moved = simulateMove(level, initial, "double", "head");
    expect(moved.kind).toBe("paused");
    const parked = applyMove(level, initial, moved);
    expect(parked.settledPaths?.double?.map(cellKey)).toEqual([
      cellKey(cell("front", 4, 3)),
      cellKey(cell("front", 4, 2)),
    ]);

    const reverse = simulateMove(level, parked, "double", "tail");
    expect(reverse.kind).toBe("exit");
    expect(reverse.route[0]).toEqual(cell("front", 4, 3));
  });

  test("the selected blocked endpoint fails even when the other endpoint is clear", () => {
    const level = doubleLane({
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [cell("front", 2, 3), cell("front", 3, 3)],
        },
        blocker("east-wall", 4, 3),
      ],
    });
    const state = createGameState(level);

    expect(simulateMove(level, state, "double", "head").kind).toBe("blocked");
    expect(simulateMove(level, state, "double", "tail").kind).toBe("exit");
  });

  test("shares one paid failure across endpoints at the same settled position", () => {
    const level = doubleLane({
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [cell("front", 2, 3), cell("front", 3, 3)],
        },
        blocker("west-wall", 1, 3),
        blocker("east-wall", 4, 3),
      ],
    });
    const initial = createGameState(level);
    const afterHead = applyMove(
      level,
      initial,
      simulateMove(level, initial, "double", "head"),
    );
    expect(afterHead.lives).toBe(3);
    expect(afterHead.settledPaths).toEqual({});
    expect(afterHead.failedPositions).toHaveLength(1);

    const afterTail = applyMove(
      level,
      afterHead,
      simulateMove(level, afterHead, "double", "tail"),
    );
    expect(afterTail.lives).toBe(3);
    expect(afterTail.failedPositions).toEqual(afterHead.failedPositions);
  });

  test("charges a fresh first failure after parking at a new position", () => {
    const level = doubleLane({
      stops: [cell("front", 4, 3)],
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [cell("front", 2, 3), cell("front", 3, 3)],
        },
        blocker("west-wall", 1, 3),
        blocker("east-wall", 5, 3),
      ],
    });
    let state = createGameState(level);
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "double", "tail"),
    );
    expect(state.lives).toBe(3);

    state = applyMove(
      level,
      state,
      simulateMove(level, state, "double", "head"),
    );
    expect(state.settledPaths?.double?.map(cellKey)).toEqual([
      cellKey(cell("front", 3, 3)),
      cellKey(cell("front", 4, 3)),
    ]);

    state = applyMove(
      level,
      state,
      simulateMove(level, state, "double", "head"),
    );
    expect(state.lives).toBe(2);
    expect(state.failedPositions).toHaveLength(2);
  });

  test("stays independent when its tail overlaps a single arrow", () => {
    const level = doubleLane({
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [
            cell("front", 0, 3),
            cell("front", 1, 3),
            cell("front", 2, 3),
            cell("front", 3, 3),
          ],
        },
        {
          id: "single",
          path: [
            cell("front", 0, 3),
            cell("front", 1, 3),
            cell("front", 2, 2),
            cell("front", 3, 2),
          ],
        },
      ],
    });

    expect(overlappingArrowIds(level, "double")).toEqual(["double"]);
    expect(validateLevel(level).valid).toBe(false);
  });

  test("solves a mutual deadlock through the double arrow tail", () => {
    const level = doubleLane({
      directionals: [{ cell: cell("front", 2, 2), heading: "south" }],
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [cell("front", 2, 3), cell("front", 3, 3)],
        },
        {
          id: "blocker",
          path: [cell("front", 4, 3), cell("front", 4, 2), cell("front", 3, 2)],
        },
      ],
    });
    expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
    const solution = solveLevelTargets(level);
    expect(solution).toContainEqual({ arrowId: "double", endpoint: "tail" });
  });

  test("keeps numeric stop offsets for single arrows", () => {
    const level: LevelDefinition = {
      id: 951,
      title: "Single lane",
      gridSize: 6,
      lives: 3,
      stops: [cell("front", 3, 2)],
      arrows: [
        { id: "single", path: [cell("front", 0, 2), cell("front", 1, 2)] },
      ],
    };
    const initial = createGameState(level);
    const parked = applyMove(
      level,
      initial,
      simulateMove(level, initial, "single"),
    );
    expect(parked.offsets).toEqual({ single: 2 });
    expect(parked.settledPaths).toEqual({});
  });
});
