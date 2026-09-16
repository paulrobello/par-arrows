import { describe, expect, test } from "bun:test";
import { generateLevel } from "../src/content/procedural";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import { solveLevel, validateLevel } from "../src/core/validation";

const PARKER = "stop-intro-parker";
const FREED = "stop-intro-freed";
const BLOCKER = "stop-intro-blocker";

describe("stop-circle level content", () => {
  test("cube five is a level-one-style cube with a single circle", () => {
    expect(STOP_INTRO_LEVEL.id).toBe(5);
    expect(STOP_INTRO_LEVEL.gridSize).toBe(4);
    expect(STOP_INTRO_LEVEL.lives).toBe(5);
    expect(STOP_INTRO_LEVEL.arrows).toHaveLength(6);
    expect(STOP_INTRO_LEVEL.stops).toHaveLength(1);
    expect(STOP_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
    expect(validateLevel(STOP_INTRO_LEVEL)).toEqual({
      valid: true,
      errors: [],
    });
    expect(generateLevel(5)).toBe(STOP_INTRO_LEVEL);
  });

  test("the circle is load-bearing: the same cube is unsolvable without it", () => {
    expect(solveLevel(STOP_INTRO_LEVEL)).toBeDefined();
    expect(solveLevel({ ...STOP_INTRO_LEVEL, stops: [] })).toBeUndefined();
  });

  test("its three front arrows deadlock until one parks on the circle", () => {
    const initial = createGameState(STOP_INTRO_LEVEL);
    // Nothing on the front face can leave: each arrow blocks the next.
    expect(simulateMove(STOP_INTRO_LEVEL, initial, FREED).kind).toBe("blocked");
    expect(simulateMove(STOP_INTRO_LEVEL, initial, BLOCKER).kind).toBe(
      "blocked",
    );

    const park = simulateMove(STOP_INTRO_LEVEL, initial, PARKER);
    expect(park.kind).toBe("paused");
    const parked = applyMove(STOP_INTRO_LEVEL, initial, park);
    expect(parked.offsets).toEqual({ [PARKER]: 1 });
    expect(parked.lives).toBe(5);

    // Parking opened the freed arrow's lane, which in turn opens the blocker's.
    let state = parked;
    for (const arrowId of [FREED, BLOCKER, PARKER]) {
      const result = simulateMove(STOP_INTRO_LEVEL, state, arrowId);
      expect(result.kind).toBe("exit");
      state = applyMove(STOP_INTRO_LEVEL, state, result);
    }
    expect(state.remainingIds).toEqual([
      "stop-intro-back",
      "stop-intro-right",
      "stop-intro-top",
    ]);
    expect(state.lives).toBe(5);
    expect(state.failedIds).toEqual([]);
  });

  test("driving the parked arrow onward too early rebounds to the circle", () => {
    const initial = createGameState(STOP_INTRO_LEVEL);
    const parked = applyMove(
      STOP_INTRO_LEVEL,
      initial,
      simulateMove(STOP_INTRO_LEVEL, initial, PARKER),
    );

    const blocked = simulateMove(STOP_INTRO_LEVEL, parked, PARKER);
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blockerId).toBe(BLOCKER);
    const after = applyMove(STOP_INTRO_LEVEL, parked, blocked);
    expect(after.lives).toBe(4);
    expect(after.failedIds).toEqual([PARKER]);
    expect(after.offsets).toEqual({ [PARKER]: 1 });
  });

  test("its authored solution clears the cube without losing a life", () => {
    const solution = solveLevel(STOP_INTRO_LEVEL);
    if (!solution) throw new Error("Expected a solution for cube five.");
    let state = createGameState(STOP_INTRO_LEVEL);
    for (const arrowId of solution) {
      const result = simulateMove(STOP_INTRO_LEVEL, state, arrowId);
      expect(["exit", "paused"]).toContain(result.kind);
      state = applyMove(STOP_INTRO_LEVEL, state, result);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(STOP_INTRO_LEVEL.lives);
    // The parker is tapped twice: once to park, once to finish.
    expect(solution.filter((id) => id === PARKER)).toHaveLength(2);
  });

  test("generated cubes keep circles clear of arrow bodies and reachable", () => {
    for (const id of [6, 9, 17, 55]) {
      const level = generateLevel(id);
      expect(validateLevel(level).valid).toBe(true);
      const bodies = new Set(
        level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
      );
      for (const stop of level.stops ?? []) {
        expect(bodies.has(cellKey(stop))).toBe(false);
      }
      expect((level.stops ?? []).length).toBeLessThanOrEqual(3);
      expect(solveLevel(level)).toBeDefined();
    }
  }, 20_000);
});
