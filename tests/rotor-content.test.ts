import { describe, expect, test } from "bun:test";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import {
  generateLevel,
  isAuthoredLevel,
  seedForLevel,
} from "../src/content/procedural";
import { ROTOR_INTRO_LEVEL } from "../src/content/rotor-intro";
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
import { TutorialRunner, scriptForLevel } from "../src/tutorial";

const TURNER = "rotor-intro-turner";
const BENDER = "rotor-intro-bender";

describe("rotor introduction", () => {
  test("level 40 is the authored rotor cube", () => {
    expect(generateLevel(40)).toBe(ROTOR_INTRO_LEVEL);
    expect(isAuthoredLevel(40)).toBe(true);
    expect(seedForLevel(40)).toBe(
      "par-arrows:runtime:7:level:40:rotor-intro:1",
    );
    expect(validateLevel(ROTOR_INTRO_LEVEL).errors).toEqual([]);
    expect(solveLevelTargets(ROTOR_INTRO_LEVEL)).toBeDefined();
    expect(hasStrandingState(ROTOR_INTRO_LEVEL)).toBe(false);
    expect(flipInterest(ROTOR_INTRO_LEVEL)).toBe(true);
    const spots = ROTOR_INTRO_LEVEL.directionals ?? [];
    expect(spots.filter((spot) => spot.kind === "rotor")).toHaveLength(1);
    expect(spots).toHaveLength(1);
    expect(ROTOR_INTRO_LEVEL.stops ?? []).toEqual([]);
    expect(ROTOR_INTRO_LEVEL.wormholes ?? []).toEqual([]);
    expect(ROTOR_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
    expect(
      ROTOR_INTRO_LEVEL.arrows.every((arrow) => arrow.kind !== "double"),
    ).toBe(true);
  });

  test("the rotor is required: without it the two front arrows deadlock", () => {
    expect(
      solveLevelTargets({ ...ROTOR_INTRO_LEVEL, directionals: [] }),
    ).toBeUndefined();
  });

  // With one spot, no stop circle and no wrapping edge, a rotor frozen at its
  // authored heading is solvable in the same order: the first arrow through it
  // proves its ray clear, and occupancy only shrinks afterwards. The advance
  // is what the cube teaches, measured by flipInterest, not what makes it
  // solvable.
  test("the advance changes which tap is safe, not whether the cube clears", () => {
    const frozen: LevelDefinition = {
      ...ROTOR_INTRO_LEVEL,
      directionals: (ROTOR_INTRO_LEVEL.directionals ?? []).map((spot) => ({
        ...spot,
        kind: "static" as const,
      })),
    };
    expect(flipInterest(frozen)).toBe(false);
    expect(solveLevelTargets(frozen)).toBeDefined();
  });

  test("the turner reverses through the rotor and turns it, then the bender bends out", () => {
    const level = ROTOR_INTRO_LEVEL;
    let state = createGameState(level);
    const early = simulateMove(level, state, BENDER);
    expect(early.kind).toBe("blocked");
    expect(early.blockerId).toBe(TURNER);

    const turner = simulateMove(level, state, TURNER);
    expect(turner.kind).toBe("exit");
    expect(turner.spotFlips).toEqual([
      { cell: { face: "front", x: 2, y: 1 }, step: 3 },
    ]);
    state = applyMove(level, state, turner);
    expect(state.spotHeadings).toEqual({ "front:2:1": "north" });

    const bender = simulateMove(level, state, BENDER);
    expect(bender.kind).toBe("exit");
    expect(bender.route).toEqual([
      { face: "front", x: 3, y: 1 },
      { face: "front", x: 2, y: 1 },
      { face: "front", x: 2, y: 0 },
    ]);
    state = applyMove(level, state, bender);
    expect(state.spotHeadings).toEqual({ "front:2:1": "east" });

    for (const id of state.remainingIds) {
      state = applyMove(level, state, simulateMove(level, state, id));
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(level.lives);
  });

  test("the four free arrows leave their own faces without touching the front pair", () => {
    const level = ROTOR_INTRO_LEVEL;
    const initial = createGameState(level);
    for (const arrow of level.arrows) {
      if (arrow.id === TURNER || arrow.id === BENDER) continue;
      const face = arrow.path[0]?.face as FaceId;
      const result = simulateMove(level, initial, arrow.id);
      expect(result.kind).toBe("exit");
      for (const cell of result.route) expect(cell.face).toBe(face);
    }
  });

  test("the walkthrough gates the turner, then the bender, then free play", () => {
    const script = scriptForLevel(40);
    expect(script?.levelId).toBe(40);
    if (!script) throw new Error("Level 40 has no walkthrough.");
    const runner = new TutorialRunner(script);
    expect(runner.current.highlightId).toBe(TURNER);
    expect([...(runner.gate ?? [])]).toEqual([TURNER]);

    // A move by an arrow the step does not name leaves the gate in place.
    runner.onMove({ arrowId: BENDER, kind: "blocked" });
    expect([...(runner.gate ?? [])]).toEqual([TURNER]);

    runner.onMove({ arrowId: TURNER, kind: "exit" });
    expect(runner.current.highlightId).toBe(BENDER);
    expect([...(runner.gate ?? [])]).toEqual([BENDER]);

    runner.onMove({ arrowId: BENDER, kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    expect(runner.gate).toBeUndefined();
    runner.onWon();
    expect(runner.done).toBe(true);
  });

  test("a resumed board past the turn skips straight to the bender", () => {
    const script = scriptForLevel(40);
    if (!script) throw new Error("Level 40 has no walkthrough.");
    const runner = new TutorialRunner(script);
    runner.attach(
      ROTOR_INTRO_LEVEL.arrows
        .map((arrow) => arrow.id)
        .filter((id) => id !== TURNER),
    );
    expect(runner.current.highlightId).toBe(BENDER);
  });

  test.each(["rotor", "rotors", "ROTOR"])(
    "?feature=%s previews level 40",
    (name) => {
      const preview = parseLevelPreview(`?feature=${name}`);
      expect(preview).toEqual({ active: true, feature: "rotor" });
      for (const from of [1, 39, 41, 500]) {
        expect(resolveLevelPreview(preview, from).resolvedLevelId).toBe(40);
      }
    },
  );

  test("the rotor selector resolves without scanning campaign policies", () => {
    let scanned = 0;
    const resolved = resolveLevelPreview(
      parseLevelPreview("?feature=rotor"),
      1,
      () => {
        scanned += 1;
        return [];
      },
    );
    expect(resolved.resolvedLevelId).toBe(40);
    expect(scanned).toBe(0);
  });
});
