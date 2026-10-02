import { describe, expect, test } from "bun:test";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import { MIRROR_INTRO_LEVEL } from "../src/content/mirror-intro";
import {
  generateLevel,
  isAuthoredLevel,
  seedForLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { solveLevelTargets, validateLevel } from "../src/core/validation";
import { scriptForLevel } from "../src/tutorial";

const NORTH = "mirror-intro-north";
const SOUTH = "mirror-intro-south";

describe("mirror introduction", () => {
  test("level 55 is the authored mirror cube", () => {
    expect(generateLevel(55)).toBe(MIRROR_INTRO_LEVEL);
    expect(isAuthoredLevel(55)).toBe(true);
    expect(seedForLevel(55)).toBe(
      "par-arrows:runtime:7:level:55:mirror-intro:1",
    );
    expect(validateLevel(MIRROR_INTRO_LEVEL).errors).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.gridSize).toBe(4);
    expect(MIRROR_INTRO_LEVEL.lives).toBe(5);
    expect(MIRROR_INTRO_LEVEL.mirrors).toEqual([
      { cell: { face: "front", x: 1, y: 1 }, orientation: "/" },
    ]);
    expect(MIRROR_INTRO_LEVEL.stops ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.directionals ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.wormholes ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.fragile ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.locks ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
  });

  test("the face-off pair needs the mirror, and either order clears", () => {
    const initial = createGameState(MIRROR_INTRO_LEVEL);
    const north = simulateMove(MIRROR_INTRO_LEVEL, initial, NORTH);
    expect(north.kind).toBe("exit");
    const south = simulateMove(MIRROR_INTRO_LEVEL, initial, SOUTH);
    expect(south.kind).toBe("exit");
    const state = applyMove(MIRROR_INTRO_LEVEL, initial, north);
    const again = simulateMove(MIRROR_INTRO_LEVEL, state, SOUTH);
    expect(again.kind).toBe("exit");
    const solution = solveLevelTargets(MIRROR_INTRO_LEVEL);
    expect(solution?.[0]?.arrowId).toBe(NORTH);
    const stripped = { ...MIRROR_INTRO_LEVEL, mirrors: [] };
    expect(solveLevelTargets(stripped)).toBeUndefined();
  });

  test("the walkthrough gates the north arrow first", () => {
    const script = scriptForLevel(55);
    expect(script?.title).toBe("Use the mirror.");
    expect(script?.steps[0]?.highlightId).toBe(NORTH);
    expect(script?.steps[0]?.advance).toEqual({
      kind: "move",
      arrowIds: [NORTH],
      outcomes: ["exit"],
    });
    expect(script?.steps[1]?.highlightId).toBe(SOUTH);
  });

  test("?feature=mirror opens level 55 without changing campaign saves", () => {
    const parsed = parseLevelPreview("?feature=mirror");
    expect(parsed).toMatchObject({ active: true, feature: "mirror" });
    expect(resolveLevelPreview(parsed).resolvedLevelId).toBe(55);
    for (const alias of ["mirrors"]) {
      expect(parseLevelPreview(`?feature=${alias}`).feature).toBe("mirror");
    }
  });
});
