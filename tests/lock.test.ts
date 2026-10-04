import { describe, expect, test } from "bun:test";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import {
  closedGateKeys,
  gateAt,
  hasLocks,
  keyAt,
  keyFlightRoute,
} from "../src/core/locks";
import { cellKey, headingBetween } from "../src/core/topology";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  GameState,
  LevelDefinition,
  LockDefinition,
} from "../src/core/types";
import {
  hasSoftLockState,
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";

function cell(x: number, y: number, face: FaceId = "front"): Cell {
  return { face, x, y };
}

function lockLevel(
  arrows: readonly ArrowDefinition[],
  locks: readonly LockDefinition[],
  extra: Partial<LevelDefinition> = {},
): LevelDefinition {
  return {
    id: 904,
    title: "Lock fixture",
    gridSize: 5,
    lives: 3,
    arrows,
    locks,
    ...extra,
  };
}

// The opener runs east along row 2 into the gate at (3, 2). The key arrow
// runs north up column 2, crossing the opener's lane ahead of its head and
// the key at (2, 1).
const GATE = cell(3, 2);
const KEY = cell(2, 1);
const LOCK: LockDefinition = { id: "lock-a", key: KEY, lock: GATE };
const opener: ArrowDefinition = {
  id: "opener",
  path: [cell(0, 2), cell(1, 2)],
};
const keyArrow: ArrowDefinition = {
  id: "key-arrow",
  path: [cell(2, 4), cell(2, 3)],
};
const gateLevel = lockLevel([opener, keyArrow], [LOCK]);

function play(
  level: LevelDefinition,
  taps: readonly (string | [string, "head" | "tail"])[],
): GameState {
  let state = createGameState(level);
  for (const tap of taps) {
    const [id, endpoint] = typeof tap === "string" ? [tap, "head"] : tap;
    const result = simulateMove(level, state, id, endpoint as "head" | "tail");
    state = applyMove(level, state, result);
  }
  return state;
}

describe("lock lookup", () => {
  test("indexes gates and keys by cell", () => {
    expect(hasLocks(gateLevel)).toBe(true);
    expect(hasLocks({})).toBe(false);
    expect(gateAt(gateLevel, GATE)?.id).toBe("lock-a");
    expect(keyAt(gateLevel, KEY)?.id).toBe("lock-a");
    expect(gateAt(gateLevel, KEY)).toBeUndefined();
    expect([...closedGateKeys(gateLevel, [])]).toEqual([cellKey(GATE)]);
    expect([...closedGateKeys(gateLevel, ["lock-a"])]).toEqual([]);
  });
});

describe("closed gates", () => {
  test("a head entering a closed gate rewinds for free", () => {
    const state = createGameState(gateLevel);
    const result = simulateMove(gateLevel, state, "opener");
    expect(result.kind).toBe("gated");
    expect(result.gate).toEqual(GATE);
    expect(result.route.at(-1)).toEqual(GATE);
    expect(result.distance).toBe(1.5);
    const next = applyMove(gateLevel, state, result);
    expect(next).not.toBe(state);
    expect(next.revision).toBe(state.revision + 1);
    expect(next.lives).toBe(3);
    expect(next.failedIds).toEqual([]);
    expect(next.remainingIds).toEqual(state.remainingIds);
    expect(next.unlocked).toEqual([]);
  });

  test("repeated gate attempts stay free", () => {
    const state = play(gateLevel, ["opener", "opener", "opener"]);
    expect(state.lives).toBe(3);
    expect(state.failedIds).toEqual([]);
    expect(state.status).toBe("playing");
  });
});

describe("keys", () => {
  test("crossing a key opens its gate for the rest of the level", () => {
    const state = createGameState(gateLevel);
    const result = simulateMove(gateLevel, state, "key-arrow");
    expect(result.kind).toBe("exit");
    expect(result.unlocks).toEqual([{ id: "lock-a", cell: GATE, step: 2 }]);
    const next = applyMove(gateLevel, state, result);
    expect(next.unlocked).toEqual(["lock-a"]);
    const through = simulateMove(gateLevel, next, "opener");
    expect(through.kind).toBe("exit");
    expect(through.route.map(cellKey)).toContain(cellKey(GATE));
    const won = applyMove(gateLevel, next, through);
    expect(won.status).toBe("won");
    expect(won.lives).toBe(3);
  });

  test("keys are never consumed and a second crossing is idempotent", () => {
    const second: ArrowDefinition = {
      id: "second",
      path: [cell(4, 1), cell(3, 1)],
    };
    // The second arrow runs west along row 1 over the key at (2, 1).
    const level = lockLevel([opener, keyArrow, second], [LOCK]);
    const opened = play(level, ["key-arrow"]);
    const result = simulateMove(level, opened, "second");
    expect(result.kind).toBe("exit");
    expect(result.unlocks).toBeUndefined();
    const next = applyMove(level, opened, result);
    expect(next.unlocked).toEqual(["lock-a"]);
  });

  test("a head that crosses the key then its own gate passes in one move", () => {
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(0, 2), cell(1, 2)],
    };
    const level = lockLevel(
      [runner],
      [{ id: "lock-a", key: cell(2, 2), lock: cell(3, 2) }],
    );
    const result = simulateMove(level, createGameState(level), "runner");
    expect(result.kind).toBe("exit");
    expect(result.unlocks?.map((entry) => entry.step)).toEqual([1]);
  });

  test("a collision rewinds the unlock along with the arrow", () => {
    const wall: ArrowDefinition = {
      id: "wall",
      path: [cell(4, 0), cell(3, 0), cell(2, 0)],
    };
    // The key arrow crosses the key at (2, 1), then hits the wall at (2, 0).
    const level = lockLevel([opener, keyArrow, wall], [LOCK]);
    const state = createGameState(level);
    const result = simulateMove(level, state, "key-arrow");
    expect(result.kind).toBe("blocked");
    expect(result.unlocks?.map((entry) => entry.id)).toEqual(["lock-a"]);
    const next = applyMove(level, state, result);
    expect(next.unlocked).toEqual([]);
    expect(next.lives).toBe(2);
    expect(simulateMove(level, next, "opener").kind).toBe("gated");
  });

  test("a gate rewinds an unlock the same move made", () => {
    // The runner crosses lock-b's key, then runs into lock-a's closed gate.
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(0, 3), cell(1, 3)],
    };
    const level = lockLevel(
      [runner],
      [
        { id: "lock-a", key: cell(0, 0), lock: cell(3, 3) },
        { id: "lock-b", key: cell(2, 3), lock: cell(4, 0) },
      ],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "runner");
    expect(result.kind).toBe("gated");
    expect(result.unlocks?.map((entry) => entry.id)).toEqual(["lock-b"]);
    const next = applyMove(level, state, result);
    expect(next.unlocked).toEqual([]);
    expect(next.lives).toBe(3);
  });

  test("a park after a key writes the unlock", () => {
    const level = lockLevel([opener, keyArrow], [LOCK], {
      stops: [cell(2, 0)],
    });
    const state = createGameState(level);
    const result = simulateMove(level, state, "key-arrow");
    expect(result.kind).toBe("paused");
    const next = applyMove(level, state, result);
    expect(next.unlocked).toEqual(["lock-a"]);
    expect(simulateMove(level, next, "opener").kind).toBe("exit");
  });

  test("an arrow on an open gate collides like any other body", () => {
    const parker: ArrowDefinition = {
      id: "parker",
      path: [cell(0, 2), cell(1, 2)],
    };
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(3, 4), cell(3, 3)],
    };
    // The parker crosses the key at (2, 2), passes its gate at (3, 2), and
    // parks on the circle at (4, 2) with its body over the open gate.
    const level = lockLevel(
      [parker, runner],
      [{ id: "lock-a", key: cell(2, 2), lock: cell(3, 2) }],
      { stops: [cell(4, 2)] },
    );
    const parked = play(level, ["parker"]);
    expect(parked.unlocked).toEqual(["lock-a"]);
    const result = simulateMove(level, parked, "runner");
    expect(result.kind).toBe("blocked");
    expect(result.blockerId).toBe("parker");
    expect(applyMove(level, parked, result).lives).toBe(2);
  });
});

describe("groups and doubles", () => {
  const north: ArrowDefinition = {
    id: "north",
    path: [cell(0, 2), cell(1, 2), cell(1, 1)],
  };
  const east: ArrowDefinition = {
    id: "east",
    path: [cell(0, 2), cell(1, 2), cell(2, 2)],
  };

  test("a shared-tail group rewinds together from a gate for free", () => {
    const level = lockLevel(
      [north, east],
      [{ id: "lock-a", key: cell(4, 4), lock: cell(3, 2) }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "north");
    expect(result.kind).toBe("gated");
    expect(result.gate).toEqual(cell(3, 2));
    expect(result.members?.map((member) => member.kind).sort()).toEqual([
      "exit",
      "gated",
    ]);
    const next = applyMove(level, state, result);
    expect(next.lives).toBe(3);
    expect(next.failedIds).toEqual([]);
    expect(next.remainingIds).toEqual(["north", "east"]);
  });

  test("a group collision on the same step as a gate wins the tie", () => {
    const wall: ArrowDefinition = {
      id: "wall",
      path: [cell(4, 4), cell(4, 3), cell(4, 2), cell(4, 1), cell(4, 0)],
    };
    const blocker: ArrowDefinition = {
      id: "blocker",
      path: [cell(0, 0), cell(1, 0)],
    };
    // North is blocked at (1, 0) on step 1; east reaches the gate at (3, 2)
    // on the same step.
    const level = lockLevel(
      [north, east, wall, blocker],
      [{ id: "lock-a", key: cell(3, 4), lock: cell(3, 2) }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "east");
    expect(result.kind).toBe("blocked");
    expect(applyMove(level, state, result).lives).toBe(2);
  });

  test("a member's key opens a gate only for later moves", () => {
    // North crosses the key at (1, 0) on the same step east meets the gate.
    const level = lockLevel(
      [north, east],
      [{ id: "lock-a", key: cell(1, 0), lock: cell(3, 2) }],
    );
    const state = createGameState(level);
    const result = simulateMove(level, state, "north");
    expect(result.kind).toBe("gated");
    expect(applyMove(level, state, result).unlocked).toEqual([]);
  });

  test("a group that crosses a key opens it for everyone", () => {
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(4, 4), cell(4, 3)],
    };
    // North crosses the key at (1, 0); the runner's lane north ends at the
    // gate on (4, 1).
    const level = lockLevel(
      [north, east, runner],
      [{ id: "lock-a", key: cell(1, 0), lock: cell(4, 1) }],
    );
    const state = createGameState(level);
    expect(simulateMove(level, state, "runner").kind).toBe("gated");
    const next = play(level, ["north"]);
    expect(next.unlocked).toEqual(["lock-a"]);
    expect(next.remainingIds).toEqual(["runner"]);
    expect(simulateMove(level, next, "runner").kind).toBe("exit");
  });

  test("either end of a double meets gates and keys", () => {
    const double: ArrowDefinition = {
      id: "double",
      kind: "double",
      path: [cell(1, 3), cell(2, 3), cell(3, 3)],
    };
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(4, 0), cell(4, 1)],
    };
    // The head end runs east into the gate at (4, 3), which the runner's
    // southward lane also crosses; the tail end runs west over the key.
    const level = lockLevel(
      [double, runner],
      [{ id: "lock-a", key: cell(0, 3), lock: cell(4, 3) }],
    );
    const state = createGameState(level);
    const head = simulateMove(level, state, "double", "head");
    expect(head.kind).toBe("gated");
    const afterHead = applyMove(level, state, head);
    expect(afterHead.lives).toBe(3);
    expect(afterHead.failedPositions).toEqual([]);
    expect(simulateMove(level, afterHead, "runner").kind).toBe("gated");
    const opened = play(level, [["double", "tail"]]);
    expect(opened.unlocked).toEqual(["lock-a"]);
    expect(simulateMove(level, opened, "runner").kind).toBe("exit");
  });
});

describe("validation", () => {
  const errorsFor = (level: LevelDefinition): readonly string[] =>
    validateLevel(level).errors;

  test("accepts a well-formed lock", () => {
    expect(errorsFor(gateLevel)).toEqual([]);
  });

  test("bans lock cells on arrows, stops, spots, wormhole ends and fragile cells", () => {
    const onArrow = lockLevel(
      [opener, keyArrow],
      [{ id: "lock-a", key: KEY, lock: cell(1, 2) }],
    );
    expect(errorsFor(onArrow).join()).toContain("arrow's starting cell");
    const keyOnArrow = lockLevel(
      [opener, keyArrow],
      [{ id: "lock-a", key: cell(2, 4), lock: GATE }],
    );
    expect(errorsFor(keyOnArrow).join()).toContain("key");
    const onStop = lockLevel([opener, keyArrow], [LOCK], { stops: [KEY] });
    expect(errorsFor(onStop).join()).toContain("stop circle");
    const onSpot = lockLevel([opener, keyArrow], [LOCK], {
      directionals: [{ cell: GATE, heading: "east" }],
    });
    expect(errorsFor(onSpot).join()).toContain("directional spot");
    const onPortal = lockLevel([opener, keyArrow], [LOCK], {
      wormholes: [{ id: "w", a: KEY, b: cell(0, 0, "back") }],
    });
    expect(errorsFor(onPortal).join()).toContain("wormhole end");
    const onFragile = lockLevel([opener, keyArrow], [LOCK], {
      fragile: [GATE],
    });
    expect(errorsFor(onFragile).join()).toContain("fragile cell");
  });

  test("a lock level still rejects a spot loop", () => {
    // Two facing spots trap the runner in a loop. The loop check is topology
    // only, so a lock on the cube neither hides nor changes it, and the
    // runtime tap stays invalid rather than costing a life.
    const looped = lockLevel(
      [{ id: "ping", path: [cell(0, 2), cell(1, 2)] }],
      [{ id: "lock-a", key: cell(0, 0), lock: cell(4, 4) }],
      {
        directionals: [
          { cell: cell(3, 2), heading: "west" },
          { cell: cell(2, 2), heading: "east" },
        ],
      },
    );
    expect(errorsFor(looped)).toContain(
      "Arrow ping has a nonterminating continuation loop from its head endpoint.",
    );
    const state = createGameState(looped);
    expect(simulateMove(looped, state, "ping").kind).toBe("invalid");
  });

  test("rejects duplicate ids, shared cells, out-of-bounds cells and a third lock", () => {
    const duplicate = lockLevel(
      [opener, keyArrow],
      [LOCK, { id: "lock-a", key: cell(0, 0), lock: cell(4, 4) }],
    );
    expect(errorsFor(duplicate).join()).toContain("unique");
    const shared = lockLevel(
      [opener, keyArrow],
      [{ id: "lock-a", key: GATE, lock: GATE }],
    );
    expect(errorsFor(shared).join()).toContain("more than once");
    const outside = lockLevel(
      [opener, keyArrow],
      [{ id: "lock-a", key: cell(9, 9), lock: GATE }],
    );
    expect(errorsFor(outside).join()).toContain("out of bounds");
    const three = lockLevel(
      [opener, keyArrow],
      [
        LOCK,
        { id: "lock-b", key: cell(0, 0), lock: cell(4, 4) },
        { id: "lock-c", key: cell(0, 4), lock: cell(4, 0) },
      ],
    );
    expect(errorsFor(three).join()).toContain("at most 2 locks");
  });
});

describe("solver", () => {
  test("certificates cross the key before the opener passes its gate", () => {
    const targets = solveLevelTargets(gateLevel);
    expect(targets?.map((target) => target.arrowId)).toEqual([
      "key-arrow",
      "opener",
    ]);
    const unlockedLevel = { ...gateLevel, locks: [] };
    expect(
      solveLevelTargets(unlockedLevel)?.map((target) => target.arrowId),
    ).toEqual(["opener", "key-arrow"]);
  });

  test("certificates never include a gated tap", () => {
    let state = createGameState(gateLevel);
    for (const target of solveLevelTargets(gateLevel) ?? []) {
      const result = simulateMove(
        gateLevel,
        state,
        target.arrowId,
        target.endpoint,
      );
      expect(["exit", "paused"]).toContain(result.kind);
      state = applyMove(gateLevel, state, result);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(3);
  });

  test("a level whose only key sits behind its own gate is unsolvable", () => {
    // The key arrow's only lane now runs through the gate before the key.
    const trapped = lockLevel(
      [opener],
      [{ id: "lock-a", key: cell(4, 2), lock: GATE }],
    );
    expect(solveLevelTargets(trapped)).toBeUndefined();
  });

  test("lock levels enumerate with no stranded or soft-locked state", () => {
    expect(hasStrandingState(gateLevel)).toBe(false);
    expect(hasSoftLockState(gateLevel)).toBe(false);
  });
});

describe("key flight route", () => {
  test("a same-face pair routes directly across the face", () => {
    const route = keyFlightRoute(
      LOCK_INTRO_LEVEL,
      LOCK_INTRO_LEVEL.locks![0]!.id,
    );
    const start = LOCK_INTRO_LEVEL.locks![0]!.key;
    const goal = LOCK_INTRO_LEVEL.locks![0]!.lock;
    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(goal);
    // front(3,0) to front(2,1): BFS with the fixed heading order gives a
    // shortest surface route of two steps.
    expect(route.length).toBe(3);
    for (let index = 1; index < route.length; index += 1) {
      expect(
        headingBetween(
          route[index - 1]!,
          route[index]!,
          LOCK_INTRO_LEVEL.gridSize,
        ),
      ).toBeDefined();
    }
  });

  test("a cross-face pair routes across the seam and stays on the surface", () => {
    const level: LevelDefinition = {
      ...LOCK_INTRO_LEVEL,
      locks: [
        {
          id: "x",
          key: { face: "front", x: 0, y: 0 },
          lock: { face: "back", x: 3, y: 3 },
        },
      ],
    };
    const route = keyFlightRoute(level, "x");
    expect(route[0]).toEqual({ face: "front", x: 0, y: 0 });
    expect(route[route.length - 1]).toEqual({ face: "back", x: 3, y: 3 });
    // Every consecutive pair is one surface step; front(0,0) to back(3,3) on
    // a 4x4 cube crosses two seams by way of an adjacent face.
    expect(route.length).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < route.length; index += 1) {
      expect(
        headingBetween(route[index - 1]!, route[index]!, level.gridSize),
      ).toBeDefined();
    }
  });

  test("an unknown lock id routes nowhere", () => {
    expect(keyFlightRoute(LOCK_INTRO_LEVEL, "missing")).toEqual([]);
  });
});
