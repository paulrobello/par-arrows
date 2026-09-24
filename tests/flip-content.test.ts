import { describe, expect, test } from "bun:test";
import { FLIP_INTRO_LEVEL } from "../src/content/flip-intro";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import { generateLevel, seedForLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import type { FaceId, LevelDefinition } from "../src/core/types";
import {
  flipInterest,
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { scriptForLevel } from "../src/tutorial";

describe("flip introduction", () => {
  test("level 30 is the authored flip cube", () => {
    expect(generateLevel(30)).toBe(FLIP_INTRO_LEVEL);
    expect(seedForLevel(30)).toBe("par-arrows:runtime:7:level:30:flip-intro:1");
    expect(validateLevel(FLIP_INTRO_LEVEL).valid).toBe(true);
    expect(solveLevelTargets(FLIP_INTRO_LEVEL)).toBeDefined();
    expect(hasStrandingState(FLIP_INTRO_LEVEL)).toBe(false);
    expect(flipInterest(FLIP_INTRO_LEVEL)).toBe(true);
  });

  test("the flip is what makes the cube interesting, not what makes it solvable", () => {
    const staticCopy: LevelDefinition = {
      ...FLIP_INTRO_LEVEL,
      directionals: (FLIP_INTRO_LEVEL.directionals ?? []).map(
        ({ cell, heading }) => ({ cell, heading }),
      ),
    };
    expect(flipInterest(staticCopy)).toBe(false);
    expect(solveLevelTargets(staticCopy)).toBeDefined();
  });

  test("the scripted order teaches reversal, then reading the flipped spot", () => {
    const level = FLIP_INTRO_LEVEL;
    let state = createGameState(level);
    expect(simulateMove(level, state, "flip-intro-runner").kind).toBe(
      "blocked",
    );
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "flip-intro-reverser"),
    );
    expect(state.spotHeadings).toEqual({ "front:1:1": "north" });
    const runner = simulateMove(level, state, "flip-intro-runner");
    expect(runner.kind).toBe("blocked");
    expect(runner.blockerId).toBe("flip-intro-guard");
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "flip-intro-guard"),
    );
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "flip-intro-runner"),
    );
    for (const id of state.remainingIds) {
      state = applyMove(level, state, simulateMove(level, state, id));
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(level.lives);
  });

  test("the five free arrows leave their own faces without touching the front trio", () => {
    const level = FLIP_INTRO_LEVEL;
    const initial = createGameState(level);
    for (const arrow of level.arrows) {
      const face = arrow.path[0]?.face;
      if (face === "front") continue;
      const result = simulateMove(level, initial, arrow.id);
      expect(result.kind).toBe("exit");
      for (const cell of result.route) {
        expect(cell.face).toBe(face as FaceId);
      }
    }
  });

  test("has a walkthrough and a preview selector", () => {
    expect(scriptForLevel(30)?.levelId).toBe(30);
    expect(
      resolveLevelPreview(parseLevelPreview("?feature=flip"), 1)
        .resolvedLevelId,
    ).toBe(30);
  });
});
