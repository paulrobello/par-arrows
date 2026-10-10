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
const EAST = "mirror-intro-east";
const RELEASE = "mirror-intro-release";

describe("mirror introduction", () => {
  test("level 55 is the authored mirror cube", () => {
    expect(generateLevel(55)).toBe(MIRROR_INTRO_LEVEL);
    expect(isAuthoredLevel(55)).toBe(true);
    expect(seedForLevel(55)).toBe(
      "par-arrows:runtime:7:level:55:mirror-intro:2",
    );
    expect(validateLevel(MIRROR_INTRO_LEVEL).errors).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.gridSize).toBe(5);
    expect(MIRROR_INTRO_LEVEL.lives).toBe(5);
    expect(MIRROR_INTRO_LEVEL.mirrors).toEqual([
      { cell: { face: "front", x: 2, y: 2 }, orientation: "/" },
    ]);
    expect(MIRROR_INTRO_LEVEL.stops ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.directionals ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.wormholes ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.fragile ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.locks ?? []).toEqual([]);
    expect(MIRROR_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
  });

  test("perpendicular approaches use distinct reflected exits and a required release", () => {
    let state = createGameState(MIRROR_INTRO_LEVEL);
    expect(simulateMove(MIRROR_INTRO_LEVEL, state, EAST).blockerId).toBe(
      RELEASE,
    );
    expect(
      simulateMove({ ...MIRROR_INTRO_LEVEL, mirrors: [] }, state, EAST).kind,
    ).toBe("exit");
    const north = simulateMove(MIRROR_INTRO_LEVEL, state, NORTH);
    expect(north.kind).toBe("exit");
    expect(north.route).toEqual([
      { face: "front", x: 2, y: 3 },
      { face: "front", x: 2, y: 2 },
      { face: "front", x: 3, y: 2 },
      { face: "front", x: 4, y: 2 },
    ]);
    state = applyMove(MIRROR_INTRO_LEVEL, state, north);
    expect(simulateMove(MIRROR_INTRO_LEVEL, state, EAST).kind).toBe("blocked");
    const release = simulateMove(MIRROR_INTRO_LEVEL, state, RELEASE);
    expect(release.kind).toBe("exit");
    state = applyMove(MIRROR_INTRO_LEVEL, state, release);
    const east = simulateMove(MIRROR_INTRO_LEVEL, state, EAST);
    expect(east.kind).toBe("exit");
    expect(east.route).toEqual([
      { face: "front", x: 1, y: 2 },
      { face: "front", x: 2, y: 2 },
      { face: "front", x: 2, y: 1 },
      { face: "front", x: 2, y: 0 },
    ]);
    state = applyMove(MIRROR_INTRO_LEVEL, state, east);
    expect(state.status).toBe("won");
    expect(state.lives).toBe(5);
    expect(
      solveLevelTargets(MIRROR_INTRO_LEVEL)?.map((t) => t.arrowId),
    ).toEqual([NORTH, RELEASE, EAST]);
    expect(
      solveLevelTargets({ ...MIRROR_INTRO_LEVEL, mirrors: [] }),
    ).toBeUndefined();
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
    expect(script?.steps[1]?.highlightId).toBe(RELEASE);
    expect(script?.steps[2]?.highlightId).toBe(EAST);
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
