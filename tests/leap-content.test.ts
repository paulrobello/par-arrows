import { describe, expect, test } from "bun:test";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import { LEAP_INTRO_LEVEL } from "../src/content/leap-intro";
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

const LEAPER = "leap-intro-leaper";
const BARRED = "leap-intro-barred";

describe("leap introduction", () => {
  test("level 60 is the authored leap cube", () => {
    expect(generateLevel(60)).toBe(LEAP_INTRO_LEVEL);
    expect(isAuthoredLevel(60)).toBe(true);
    expect(seedForLevel(60)).toBe("par-arrows:runtime:7:level:60:leap-intro:1");
    expect(validateLevel(LEAP_INTRO_LEVEL).errors).toEqual([]);
    expect(LEAP_INTRO_LEVEL.gridSize).toBe(4);
    expect(LEAP_INTRO_LEVEL.lives).toBe(5);
    expect(LEAP_INTRO_LEVEL.leaps).toEqual([{ face: "front", x: 1, y: 1 }]);
    expect(LEAP_INTRO_LEVEL.stops ?? []).toEqual([]);
    expect(LEAP_INTRO_LEVEL.directionals ?? []).toEqual([]);
    expect(LEAP_INTRO_LEVEL.wormholes ?? []).toEqual([]);
    expect(LEAP_INTRO_LEVEL.fragile ?? []).toEqual([]);
    expect(LEAP_INTRO_LEVEL.mirrors ?? []).toEqual([]);
    expect(LEAP_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
  });

  test("the leaper needs the pad, and the key opens the barred lane", () => {
    const initial = createGameState(LEAP_INTRO_LEVEL);
    const leaper = simulateMove(LEAP_INTRO_LEVEL, initial, LEAPER);
    expect(leaper.kind).toBe("exit");
    expect(leaper.leaps?.length).toBe(1);
    expect(leaper.unlocks?.map((opening) => opening.id)).toEqual([
      "leap-intro-lock",
    ]);
    const after = applyMove(LEAP_INTRO_LEVEL, initial, leaper);
    const barred = simulateMove(LEAP_INTRO_LEVEL, after, BARRED);
    expect(barred.kind).toBe("exit");
    const solution = solveLevelTargets(LEAP_INTRO_LEVEL);
    expect(solution?.[0]?.arrowId).toBe(LEAPER);
    const stripped = { ...LEAP_INTRO_LEVEL, leaps: [] };
    expect(validateLevel(stripped).valid).toBe(true);
    expect(solveLevelTargets(stripped)).toBeUndefined();
  });

  test("the walkthrough gates the leaper first", () => {
    const script = scriptForLevel(60);
    expect(script?.title).toBe("Leap the barrier.");
    expect(script?.steps[0]?.highlightId).toBe(LEAPER);
    expect(script?.steps[0]?.advance).toEqual({
      kind: "move",
      arrowIds: [LEAPER],
      outcomes: ["exit"],
    });
    expect(script?.steps[1]?.highlightId).toBe(BARRED);
  });

  test("?feature=leap opens level 60 without changing campaign saves", () => {
    const parsed = parseLevelPreview("?feature=leap");
    expect(parsed).toMatchObject({ active: true, feature: "leap" });
    expect(resolveLevelPreview(parsed).resolvedLevelId).toBe(60);
    for (const alias of ["leaps", "leappad"]) {
      expect(parseLevelPreview(`?feature=${alias}`).feature).toBe("leap");
    }
  });
});
