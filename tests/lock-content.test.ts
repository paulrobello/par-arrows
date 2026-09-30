import { describe, expect, test } from "bun:test";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
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
import type { FaceId, MoveTarget } from "../src/core/types";
import {
  hasSoftLockState,
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { TutorialRunner, scriptForLevel } from "../src/tutorial";

const OPENER = "lock-intro-opener";
const KEY_ARROW = "lock-intro-key";

describe("lock introduction", () => {
  test("level 50 is the authored lock cube", () => {
    expect(generateLevel(50)).toBe(LOCK_INTRO_LEVEL);
    expect(isAuthoredLevel(50)).toBe(true);
    expect(seedForLevel(50)).toBe("par-arrows:runtime:7:level:50:lock-intro:1");
    expect(validateLevel(LOCK_INTRO_LEVEL).errors).toEqual([]);
    expect(LOCK_INTRO_LEVEL.gridSize).toBe(4);
    expect(LOCK_INTRO_LEVEL.lives).toBe(5);
    expect(LOCK_INTRO_LEVEL.locks).toEqual([
      {
        id: "lock-intro",
        key: { face: "front", x: 3, y: 0 },
        lock: { face: "front", x: 2, y: 1 },
      },
    ]);
    expect(LOCK_INTRO_LEVEL.stops ?? []).toEqual([]);
    expect(LOCK_INTRO_LEVEL.directionals ?? []).toEqual([]);
    expect(LOCK_INTRO_LEVEL.wormholes ?? []).toEqual([]);
    expect(LOCK_INTRO_LEVEL.fragile ?? []).toEqual([]);
    expect(LOCK_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
  });

  test("the opener's short lane is barred until the key arrow crosses the key", () => {
    const initial = createGameState(LOCK_INTRO_LEVEL);
    const barred = simulateMove(LOCK_INTRO_LEVEL, initial, OPENER);
    expect(barred.kind).toBe("gated");
    const rewound = applyMove(LOCK_INTRO_LEVEL, initial, barred);
    expect(rewound.lives).toBe(LOCK_INTRO_LEVEL.lives);
    expect(rewound.failedIds).toEqual([]);
    const key = simulateMove(LOCK_INTRO_LEVEL, initial, KEY_ARROW);
    expect(key.kind).toBe("exit");
    expect(key.unlocks?.map((opening) => opening.id)).toEqual(["lock-intro"]);
    const opened = applyMove(LOCK_INTRO_LEVEL, initial, key);
    expect(simulateMove(LOCK_INTRO_LEVEL, opened, OPENER).kind).toBe("exit");
  });

  // Stripping the lock changes the required order: the opener can then leave
  // first, and the solver's greedy pass takes it first. With the lock, the
  // only certificate sends the key arrow ahead of it.
  test("the lock is what forces the key arrow first", () => {
    const order = (level: typeof LOCK_INTRO_LEVEL) =>
      (solveLevelTargets(level) ?? []).map((target) => target.arrowId);
    const locked = order(LOCK_INTRO_LEVEL);
    expect(locked.indexOf(KEY_ARROW)).toBeLessThan(locked.indexOf(OPENER));
    const stripped = { ...LOCK_INTRO_LEVEL, locks: [] };
    expect(simulateMove(stripped, createGameState(stripped), OPENER).kind).toBe(
      "exit",
    );
    const free = order(stripped);
    expect(free[0]).toBe(OPENER);
  });

  test("the certificate never runs into the gate and costs nothing", () => {
    const targets = solveLevelTargets(LOCK_INTRO_LEVEL) as MoveTarget[];
    let state = createGameState(LOCK_INTRO_LEVEL);
    for (const target of targets) {
      const result = simulateMove(
        LOCK_INTRO_LEVEL,
        state,
        target.arrowId,
        target.endpoint,
      );
      expect(result.kind).toBe("exit");
      state = applyMove(LOCK_INTRO_LEVEL, state, result);
    }
    expect(state.status).toBe("won");
    expect(state.unlocked).toEqual(["lock-intro"]);
    expect(state.lives).toBe(LOCK_INTRO_LEVEL.lives);
  });

  test("no order strands or soft-locks the cube", () => {
    expect(hasStrandingState(LOCK_INTRO_LEVEL)).toBe(false);
    expect(hasSoftLockState(LOCK_INTRO_LEVEL)).toBe(false);
  });

  test("the four free arrows leave their own faces without touching the front", () => {
    const initial = createGameState(LOCK_INTRO_LEVEL);
    for (const arrow of LOCK_INTRO_LEVEL.arrows) {
      if (arrow.id === OPENER || arrow.id === KEY_ARROW) continue;
      const face = arrow.path[0]?.face as FaceId;
      const result = simulateMove(LOCK_INTRO_LEVEL, initial, arrow.id);
      expect(result.kind).toBe("exit");
      for (const cell of result.route) expect(cell.face).toBe(face);
    }
  });

  test("the walkthrough gates the key arrow, then the opener, then free play", () => {
    const script = scriptForLevel(50);
    if (!script) throw new Error("Level 50 has no walkthrough.");
    const runner = new TutorialRunner(script);
    expect(runner.current.highlightId).toBe(KEY_ARROW);
    expect([...(runner.gate ?? [])]).toEqual([KEY_ARROW]);

    runner.onMove({ arrowId: OPENER, endpoint: "head", kind: "gated" });
    expect(runner.current.highlightId).toBe(KEY_ARROW);

    runner.onMove({ arrowId: KEY_ARROW, endpoint: "head", kind: "exit" });
    expect(runner.current.highlightId).toBe(OPENER);
    expect([...(runner.gate ?? [])]).toEqual([OPENER]);

    runner.onMove({ arrowId: OPENER, endpoint: "head", kind: "exit" });
    expect(runner.current.advance.kind).toBe("won");
    expect(runner.gate).toBeUndefined();
    runner.onWon();
    expect(runner.done).toBe(true);
  });

  test("a resumed board past the key skips to the opener", () => {
    const script = scriptForLevel(50);
    if (!script) throw new Error("Level 50 has no walkthrough.");
    const runner = new TutorialRunner(script);
    runner.attach(
      LOCK_INTRO_LEVEL.arrows
        .map((arrow) => arrow.id)
        .filter((id) => id !== KEY_ARROW),
    );
    expect(runner.current.highlightId).toBe(OPENER);
  });

  test.each(["lock", "locks", "keylock", "LOCK"])(
    "?feature=%s previews level 50",
    (name) => {
      const preview = parseLevelPreview(`?feature=${name}`);
      expect(preview).toEqual({ active: true, feature: "lock" });
      for (const from of [1, 49, 51, 500]) {
        expect(resolveLevelPreview(preview, from).resolvedLevelId).toBe(50);
      }
    },
  );

  test("the lock selector resolves without scanning campaign policies", () => {
    let scanned = 0;
    const resolved = resolveLevelPreview(
      parseLevelPreview("?feature=lock"),
      1,
      () => {
        scanned += 1;
        return [];
      },
    );
    expect(resolved.resolvedLevelId).toBe(50);
    expect(scanned).toBe(0);
  });
});
