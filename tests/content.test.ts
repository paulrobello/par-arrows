import { describe, expect, test } from "bun:test";
import {
  DEMO_BLOCKED_ID,
  DEMO_LEVEL,
  DEMO_SUCCESS_ID,
  LEVELS,
} from "../src/content/levels";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { solveLevel, validateLevel } from "../src/core/validation";

describe("curated campaign", () => {
  test("contains ten valid, face-spanning levels with the configured life curve", () => {
    expect(LEVELS).toHaveLength(10);
    for (const level of LEVELS) {
      expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
      expect(
        new Set(
          level.arrows.flatMap((arrow) => arrow.path.map((cell) => cell.face)),
        ).size,
      ).toBe(6);
      expect(level.lives).toBe(level.id <= 3 ? 5 : level.id <= 6 ? 4 : 3);
    }
  });

  test("replays a complete no-mistake solution for every campaign level", () => {
    for (const level of LEVELS) {
      const solution = solveLevel(level);
      expect(solution).toHaveLength(level.arrows.length);
      let state = createGameState(level);
      for (const arrowId of solution ?? []) {
        const result = simulateMove(level, state, arrowId);
        expect(result.kind).toBe("exit");
        state = applyMove(level, state, result);
      }
      expect(state.status).toBe("won");
      expect(state.remainingIds).toEqual([]);
    }
  });

  test("introduces long wrapped routes and a three-step removal dependency later", () => {
    const lateLevel = LEVELS[4];
    if (!lateLevel) throw new Error("Expected level 5.");
    const longRoute = lateLevel?.arrows.find((arrow) =>
      arrow.id.endsWith("three-face-route"),
    );
    expect(longRoute?.path.length).toBeGreaterThan(6);
    expect(new Set(longRoute?.path.map((cell) => cell.face)).size).toBe(3);
    const solution = solveLevel(lateLevel);
    const a = solution?.indexOf("l5-depth-three-a") ?? -1;
    const b = solution?.indexOf("l5-depth-three-b") ?? -1;
    const c = solution?.indexOf("l5-depth-three-c") ?? -1;
    expect(c).toBeLessThan(b);
    expect(b).toBeLessThan(a);
  });
});

describe("onboarding fixture", () => {
  test("fails first and then removes the failed arrow's blocker on the front face", () => {
    expect(validateLevel(DEMO_LEVEL)).toEqual({ valid: true, errors: [] });
    const initial = createGameState(DEMO_LEVEL);
    const failure = simulateMove(DEMO_LEVEL, initial, DEMO_BLOCKED_ID);
    const afterFailure = applyMove(DEMO_LEVEL, initial, failure);
    expect(failure.kind).toBe("blocked");
    expect(afterFailure.failedIds).toEqual([DEMO_BLOCKED_ID]);
    const success = simulateMove(DEMO_LEVEL, afterFailure, DEMO_SUCCESS_ID);
    expect(success.kind).toBe("exit");
    expect(success.route.every((cell) => cell.face === "front")).toBe(true);
  });
});
