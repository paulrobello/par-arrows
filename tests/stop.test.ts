import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack, currentPath, maximumOffset } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { Cell, FaceId, LevelDefinition } from "../src/core/types";
import { solveLevel, validateLevel } from "../src/core/validation";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** One eastbound arrow on an otherwise empty face, with a circle in its lane. */
function laneLevel(stops: readonly Cell[]): LevelDefinition {
  return {
    id: 900,
    title: "Lane",
    gridSize: 6,
    lives: 3,
    arrows: [
      { id: "runner", path: [cell("front", 0, 2), cell("front", 1, 2)] },
    ],
    ...(stops.length > 0 ? { stops } : {}),
  };
}

describe("stop circles", () => {
  test("a head parks on a circle instead of running straight off the cube", () => {
    const level = laneLevel([cell("front", 3, 2)]);
    const state = createGameState(level);

    const parked = simulateMove(level, state, "runner");
    expect(parked.kind).toBe("paused");
    expect(parked.pausedSteps).toBe(2);
    expect(parked.route.map(cellKey)).toEqual([
      cellKey(cell("front", 1, 2)),
      cellKey(cell("front", 2, 2)),
      cellKey(cell("front", 3, 2)),
    ]);

    const after = applyMove(level, state, parked);
    expect(after.offsets).toEqual({ runner: 2 });
    expect(after.remainingIds).toEqual(["runner"]);
    expect(after.lives).toBe(3);
    expect(after.failedIds).toEqual([]);
    expect(after.revision).toBe(1);
  });

  test("resuming from a circle never re-parks on the cell it is leaving", () => {
    const level = laneLevel([cell("front", 3, 2)]);
    const parked = applyMove(
      level,
      createGameState(level),
      simulateMove(level, createGameState(level), "runner"),
    );

    const resumed = simulateMove(level, parked, "runner");
    expect(resumed.kind).toBe("exit");
    expect(applyMove(level, parked, resumed).status).toBe("won");
  });

  test("a head parks once per circle when several sit in its lane", () => {
    const level = laneLevel([cell("front", 2, 2), cell("front", 4, 2)]);
    let state = createGameState(level);
    const kinds: string[] = [];
    for (let tap = 0; tap < 3; tap += 1) {
      const result = simulateMove(level, state, "runner");
      kinds.push(result.kind);
      state = applyMove(level, state, result);
    }
    expect(kinds).toEqual(["paused", "paused", "exit"]);
    expect(state.status).toBe("won");
    expect(state.lives).toBe(3);
  });

  test("a parked arrow occupies its new cells and frees the ones it left", () => {
    const level: LevelDefinition = {
      id: 901,
      title: "Occupancy",
      gridSize: 6,
      lives: 3,
      stops: [cell("front", 3, 2)],
      arrows: [
        { id: "runner", path: [cell("front", 0, 2), cell("front", 1, 2)] },
        { id: "crosser", path: [cell("front", 1, 5), cell("front", 1, 4)] },
      ],
    };
    const initial = createGameState(level);
    // The crosser heads north up column one and meets the runner's body.
    expect(simulateMove(level, initial, "crosser").kind).toBe("blocked");

    const parked = applyMove(
      level,
      initial,
      simulateMove(level, initial, "runner"),
    );
    expect(
      currentPath(
        level,
        level.arrows[0] as LevelDefinition["arrows"][number],
        parked.offsets.runner ?? 0,
      ).map(cellKey),
    ).toEqual([cellKey(cell("front", 2, 2)), cellKey(cell("front", 3, 2))]);
    expect(simulateMove(level, parked, "crosser").kind).toBe("exit");
  });

  test("a collision after a circle costs one life and rebounds to the circle", () => {
    const level: LevelDefinition = {
      id: 902,
      title: "Rebound",
      gridSize: 6,
      lives: 3,
      stops: [cell("front", 3, 2)],
      arrows: [
        { id: "runner", path: [cell("front", 0, 2), cell("front", 1, 2)] },
        { id: "wall", path: [cell("front", 5, 1), cell("front", 5, 2)] },
      ],
    };
    const parked = applyMove(
      level,
      createGameState(level),
      simulateMove(level, createGameState(level), "runner"),
    );

    const blocked = simulateMove(level, parked, "runner");
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blockerId).toBe("wall");
    expect(blocked.offset).toBe(2);

    const after = applyMove(level, parked, blocked);
    expect(after.lives).toBe(2);
    expect(after.failedIds).toEqual(["runner"]);
    // The rebound returns to the circle, not to the authored start.
    expect(after.offsets).toEqual({ runner: 2 });

    // A repeat failure by the same red arrow stays free.
    const again = applyMove(level, after, simulateMove(level, after, "runner"));
    expect(again.lives).toBe(2);
    expect(again.offsets).toEqual({ runner: 2 });
  });

  test("a track ends at the last surface cell and bounds the parked offset", () => {
    const level = laneLevel([]);
    const runner = level.arrows[0] as LevelDefinition["arrows"][number];
    expect(arrowTrack(level, runner).map(cellKey)).toEqual(
      [0, 1, 2, 3, 4, 5].map((x) => cellKey(cell("front", x, 2))),
    );
    expect(maximumOffset(level, runner)).toBe(4);
    expect(currentPath(level, runner, 99).map(cellKey)).toEqual([
      cellKey(cell("front", 4, 2)),
      cellKey(cell("front", 5, 2)),
    ]);
  });

  test("validation rejects circles that are out of bounds, repeated, or on an arrow", () => {
    expect(validateLevel(laneLevel([cell("front", 9, 9)])).errors).toContain(
      "Stop circle front:9:9 is out of bounds.",
    );
    expect(
      validateLevel(laneLevel([cell("front", 3, 2), cell("front", 3, 2)]))
        .errors,
    ).toContain("Stop circle front:3:2 is declared more than once.");
    expect(validateLevel(laneLevel([cell("front", 1, 2)])).errors).toContain(
      "Stop circle front:1:2 sits on an arrow's starting cell.",
    );
    expect(validateLevel(laneLevel([cell("front", 3, 2)])).valid).toBe(true);
  });

  test("the solver drives an arrow through its circles and counts one tap per leg", () => {
    expect(solveLevel(laneLevel([cell("front", 3, 2)]))).toEqual([
      "runner",
      "runner",
    ]);
    expect(solveLevel(laneLevel([]))).toEqual(["runner"]);
  });

  test("a shared-tail group parks together at its earliest circle", () => {
    const level: LevelDefinition = {
      id: 903,
      title: "Group park",
      gridSize: 8,
      lives: 3,
      stops: [cell("front", 5, 3)],
      arrows: [
        {
          id: "pair-a",
          path: [
            cell("front", 1, 4),
            cell("front", 2, 4),
            cell("front", 2, 3),
            cell("front", 3, 3),
          ],
        },
        {
          id: "pair-b",
          path: [
            cell("front", 1, 4),
            cell("front", 2, 4),
            cell("front", 2, 5),
            cell("front", 3, 5),
          ],
        },
      ],
    };
    expect(validateLevel(level).valid).toBe(true);
    const state = createGameState(level);

    const parked = simulateMove(level, state, "pair-b");
    expect(parked.kind).toBe("paused");
    expect(parked.pausedSteps).toBe(2);
    // Every member travels the same distance, including the one with no circle.
    expect(parked.members?.map((member) => member.kind)).toEqual([
      "paused",
      "paused",
    ]);
    expect(parked.members?.map((member) => member.route.length)).toEqual([
      3, 3,
    ]);

    const after = applyMove(level, state, parked);
    expect(after.offsets).toEqual({ "pair-a": 2, "pair-b": 2 });
    expect(after.remainingIds).toHaveLength(2);
    expect(after.lives).toBe(3);

    const resumed = applyMove(
      level,
      after,
      simulateMove(level, after, "pair-a"),
    );
    expect(resumed.status).toBe("won");
    expect(resumed.offsets).toEqual({});
  });
});
