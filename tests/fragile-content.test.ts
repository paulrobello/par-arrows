import { describe, expect, test } from "bun:test";
import { FRAGILE_INTRO_LEVEL } from "../src/content/fragile-intro";
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
import type {
  Endpoint,
  FaceId,
  GameState,
  LevelDefinition,
  MoveTarget,
} from "../src/core/types";
import {
  hasSoftLockState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { TutorialRunner, scriptForLevel } from "../src/tutorial";

const CROSSER = "fragile-intro-crosser";
const DOUBLE = "fragile-intro-double";
const BRIDGE = "front:1:1";

function play(
  level: LevelDefinition,
  taps: readonly (readonly [string, Endpoint])[],
): GameState {
  let state = createGameState(level);
  for (const [id, endpoint] of taps) {
    state = applyMove(level, state, simulateMove(level, state, id, endpoint));
  }
  return state;
}

function clearRest(level: LevelDefinition, from: GameState): GameState {
  let state = from;
  for (const id of state.remainingIds) {
    state = applyMove(level, state, simulateMove(level, state, id));
  }
  return state;
}

describe("fragile introduction", () => {
  test("level 45 is the authored fragile cube", () => {
    expect(generateLevel(45)).toBe(FRAGILE_INTRO_LEVEL);
    expect(isAuthoredLevel(45)).toBe(true);
    expect(seedForLevel(45)).toBe(
      "par-arrows:runtime:7:level:45:fragile-intro:1",
    );
    expect(validateLevel(FRAGILE_INTRO_LEVEL).errors).toEqual([]);
    expect(FRAGILE_INTRO_LEVEL.fragile).toEqual([
      { face: "front", x: 1, y: 1 },
    ]);
    expect(FRAGILE_INTRO_LEVEL.stops ?? []).toEqual([]);
    expect(FRAGILE_INTRO_LEVEL.directionals ?? []).toEqual([]);
    expect(FRAGILE_INTRO_LEVEL.wormholes ?? []).toEqual([]);
    expect(FRAGILE_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
  });

  test("the certificate crosses the bridge, collapses it, and falls nowhere", () => {
    const targets = solveLevelTargets(FRAGILE_INTRO_LEVEL) as MoveTarget[];
    expect(targets).toBeDefined();
    let state = createGameState(FRAGILE_INTRO_LEVEL);
    let crossed = false;
    for (const target of targets) {
      const result = simulateMove(
        FRAGILE_INTRO_LEVEL,
        state,
        target.arrowId,
        target.endpoint,
      );
      expect(result.kind).toBe("exit");
      if (result.collapses?.length) crossed = true;
      state = applyMove(FRAGILE_INTRO_LEVEL, state, result);
    }
    expect(crossed).toBe(true);
    expect(state.status).toBe("won");
    expect(state.collapsed).toEqual([BRIDGE]);
    expect(state.lives).toBe(FRAGILE_INTRO_LEVEL.lives);
  });

  // A fragile cell can only turn an exit into a fall, so any zero-fall
  // solution of this cube replays unchanged on the same cube with the crack
  // stripped to ordinary ground: stripped-unsolvable is impossible for any
  // fragile level. What the crack decides is which clear order costs a life.
  test("the crack costs a life only in the wrong order", () => {
    const stripped = { ...FRAGILE_INTRO_LEVEL, fragile: [] };
    const wrong = [
      [DOUBLE, "head"],
      [CROSSER, "head"],
    ] as const;
    const strippedWrong = clearRest(stripped, play(stripped, wrong));
    expect(strippedWrong.status).toBe("won");
    expect(strippedWrong.lives).toBe(stripped.lives);
    const realWrong = clearRest(
      FRAGILE_INTRO_LEVEL,
      play(FRAGILE_INTRO_LEVEL, wrong),
    );
    expect(realWrong.status).toBe("won");
    expect(realWrong.lives).toBe(FRAGILE_INTRO_LEVEL.lives - 1);
    expect(realWrong.fallenIds).toEqual([CROSSER]);
  });

  test("the double's tail is the only other way out, and the crosser blocks it", () => {
    const initial = createGameState(FRAGILE_INTRO_LEVEL);
    const tail = simulateMove(FRAGILE_INTRO_LEVEL, initial, DOUBLE, "tail");
    expect(tail.kind).toBe("blocked");
    expect(tail.blockerId).toBe(CROSSER);
    const crossed = play(FRAGILE_INTRO_LEVEL, [[CROSSER, "head"]]);
    expect(crossed.collapsed).toEqual([BRIDGE]);
    expect(
      simulateMove(FRAGILE_INTRO_LEVEL, crossed, DOUBLE, "head").kind,
    ).toBe("fall");
    expect(
      simulateMove(FRAGILE_INTRO_LEVEL, crossed, DOUBLE, "tail").kind,
    ).toBe("exit");
  });

  test("no order soft-locks the cube", () => {
    expect(hasSoftLockState(FRAGILE_INTRO_LEVEL)).toBe(false);
  });

  test("the four free arrows leave their own faces without touching the front", () => {
    const initial = createGameState(FRAGILE_INTRO_LEVEL);
    for (const arrow of FRAGILE_INTRO_LEVEL.arrows) {
      if (arrow.id === CROSSER || arrow.id === DOUBLE) continue;
      const face = arrow.path[0]?.face as FaceId;
      const result = simulateMove(FRAGILE_INTRO_LEVEL, initial, arrow.id);
      expect(result.kind).toBe("exit");
      for (const cell of result.route) expect(cell.face).toBe(face);
    }
  });

  test("the walkthrough gates the crosser, then the double's tail, then free play", () => {
    const script = scriptForLevel(45);
    if (!script) throw new Error("Level 45 has no walkthrough.");
    const runner = new TutorialRunner(script);
    expect(runner.current.highlightId).toBe(CROSSER);
    expect([...(runner.gate ?? [])]).toEqual([CROSSER]);

    runner.onMove({ arrowId: DOUBLE, endpoint: "head", kind: "exit" });
    expect([...(runner.gate ?? [])]).toEqual([CROSSER]);

    runner.onMove({ arrowId: CROSSER, endpoint: "head", kind: "exit" });
    expect(runner.current.highlightId).toBe(DOUBLE);
    expect(runner.gateTarget?.endpoint).toBe("tail");

    // A fall is not the lesson's outcome, so it does not advance the step.
    runner.onMove({ arrowId: DOUBLE, endpoint: "tail", kind: "fall" });
    expect(runner.current.highlightId).toBe(DOUBLE);

    runner.onMove({ arrowId: DOUBLE, endpoint: "tail", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    expect(runner.gate).toBeUndefined();
    runner.onWon();
    expect(runner.done).toBe(true);
  });

  test("a resumed board past the crossing skips to the double", () => {
    const script = scriptForLevel(45);
    if (!script) throw new Error("Level 45 has no walkthrough.");
    const runner = new TutorialRunner(script);
    runner.attach(
      FRAGILE_INTRO_LEVEL.arrows
        .map((arrow) => arrow.id)
        .filter((id) => id !== CROSSER),
    );
    expect(runner.current.highlightId).toBe(DOUBLE);
  });

  test.each(["fragile", "fragiles", "FRAGILE"])(
    "?feature=%s previews level 45",
    (name) => {
      const preview = parseLevelPreview(`?feature=${name}`);
      expect(preview).toEqual({ active: true, feature: "fragile" });
      for (const from of [1, 44, 46, 500]) {
        expect(resolveLevelPreview(preview, from).resolvedLevelId).toBe(45);
      }
    },
  );

  test("the fragile selector resolves without scanning campaign policies", () => {
    let scanned = 0;
    const resolved = resolveLevelPreview(
      parseLevelPreview("?feature=fragile"),
      1,
      () => {
        scanned += 1;
        return [];
      },
    );
    expect(resolved.resolvedLevelId).toBe(45);
    expect(scanned).toBe(0);
  });
});
