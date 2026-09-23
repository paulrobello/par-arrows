import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { scriptForLevel } from "../src/tutorial";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import { solveLevelTargets, validateLevel } from "../src/core/validation";

function clearsWithHeadOnly(): boolean {
  let state = createGameState(DOUBLE_INTRO_LEVEL);
  for (let pass = 0; pass < DOUBLE_INTRO_LEVEL.arrows.length * 2; pass += 1) {
    const before = state.remainingIds.length;
    for (const arrowId of [...state.remainingIds]) {
      const result = simulateMove(DOUBLE_INTRO_LEVEL, state, arrowId, "head");
      if (result.kind !== "exit" && result.kind !== "paused") continue;
      state = applyMove(DOUBLE_INTRO_LEVEL, state, result);
    }
    if (state.status === "won") return true;
    if (state.remainingIds.length === before) return false;
  }
  return false;
}

describe("double-arrow introduction", () => {
  test("authors a valid level 25 with a required tail action", () => {
    expect(DOUBLE_INTRO_LEVEL.id).toBe(25);
    expect(DOUBLE_INTRO_LEVEL.gridSize).toBe(4);
    expect(DOUBLE_INTRO_LEVEL.lives).toBe(5);
    expect(validateLevel(DOUBLE_INTRO_LEVEL)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      DOUBLE_INTRO_LEVEL.arrows.some((arrow) => arrow.kind === "double"),
    ).toBe(true);
    const solution = solveLevelTargets(DOUBLE_INTRO_LEVEL);
    expect(solution).toBeDefined();
    expect(solution).toContainEqual({
      arrowId: "double-intro-choice",
      endpoint: "tail",
    });
    expect(clearsWithHeadOnly()).toBe(false);
  });

  test("provides an endpoint-specific walkthrough", () => {
    const script = scriptForLevel(25);
    expect(script?.steps[0]?.advance).toMatchObject({
      kind: "move",
      arrowIds: ["double-intro-choice"],
      endpoint: "tail",
      outcomes: ["exit"],
    });
    expect(script?.steps[0]?.copy).toContain("colored half");
  });

  test("resolves the double preview directly to level 25", () => {
    const parsed = parseLevelPreview("?feature=double");
    expect(parsed).toMatchObject({ active: true, feature: "double" });
    expect(resolveLevelPreview(parsed)).toMatchObject({
      active: true,
      feature: "double",
      resolvedLevelId: 25,
    });
  });
});
