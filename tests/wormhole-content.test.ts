import { describe, expect, test } from "bun:test";
import { WORMHOLE_INTRO_LEVEL } from "../src/content/wormhole-intro";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
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
import {
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { scriptForLevel } from "../src/tutorial";

describe("wormhole introduction", () => {
  test("level 35 is the authored wormhole cube", () => {
    expect(generateLevel(35)).toBe(WORMHOLE_INTRO_LEVEL);
    expect(isAuthoredLevel(35)).toBe(true);
    expect(seedForLevel(35)).toBe(
      "par-arrows:runtime:7:level:35:wormhole-intro:1",
    );
    expect(validateLevel(WORMHOLE_INTRO_LEVEL).errors).toEqual([]);
    expect(solveLevelTargets(WORMHOLE_INTRO_LEVEL)).toBeDefined();
    expect(hasStrandingState(WORMHOLE_INTRO_LEVEL)).toBe(false);
  });

  test("the wormhole is required", () => {
    expect(
      solveLevelTargets({ ...WORMHOLE_INTRO_LEVEL, wormholes: [] }),
    ).toBeUndefined();
  });

  test("the portal arrow goes first, then the gate", () => {
    const level = WORMHOLE_INTRO_LEVEL;
    let state = createGameState(level);
    expect(simulateMove(level, state, "wormhole-intro-gate").kind).toBe(
      "blocked",
    );
    const portal = simulateMove(level, state, "wormhole-intro-portal");
    expect(portal.kind).toBe("exit");
    expect(portal.portals?.length).toBe(1);
    state = applyMove(level, state, portal);
    expect(simulateMove(level, state, "wormhole-intro-gate").kind).toBe("exit");
  });

  test("the walkthrough gates the portal arrow first", () => {
    const script = scriptForLevel(35);
    expect(script?.steps[0]?.highlightId).toBe("wormhole-intro-portal");
  });

  test.each(["wormhole", "portal", "wormholes"])(
    "?feature=%s previews level 35",
    (name) => {
      expect(
        resolveLevelPreview(parseLevelPreview(`?feature=${name}`), 1)
          .resolvedLevelId,
      ).toBe(35);
    },
  );
});
