import { describe, expect, test } from "bun:test";
import {
  fragileKeys,
  hasFragileCells,
  pendingCollapseKeys,
} from "../src/core/fragile";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type {
  ArrowDefinition,
  Cell,
  FaceId,
  GameState,
  LevelDefinition,
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

function fragileLevel(
  arrows: readonly ArrowDefinition[],
  fragile: readonly Cell[],
  extra: Partial<LevelDefinition> = {},
  gridSize = 5,
): LevelDefinition {
  return {
    id: 903,
    title: "Fragile fixture",
    gridSize,
    lives: 3,
    arrows,
    fragile,
    ...extra,
  };
}

const BRIDGE = cell(1, 1);

// The crosser runs north up column 1 over the bridge. The double's head end
// runs west along row 1 over the same bridge; its tail end runs west along
// row 2 into the crosser's body.
const crosser: ArrowDefinition = {
  id: "crosser",
  path: [cell(1, 3), cell(1, 2)],
};
const double: ArrowDefinition = {
  id: "double",
  kind: "double",
  path: [cell(2, 2), cell(3, 2), cell(3, 1), cell(2, 1)],
};
const bridgeLevel = fragileLevel([crosser, double], [BRIDGE], {}, 4);

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

describe("fragile cell lookup", () => {
  test("indexes fragile cells by key", () => {
    expect(hasFragileCells(bridgeLevel)).toBe(true);
    expect([...fragileKeys(bridgeLevel)]).toEqual([cellKey(BRIDGE)]);
    expect(hasFragileCells({ ...bridgeLevel, fragile: [] })).toBe(false);
    expect(hasFragileCells({})).toBe(false);
  });
});

describe("crossing and collapse", () => {
  test("the first crossing passes clean and collapses the cell once cleared", () => {
    const state = createGameState(bridgeLevel);
    const result = simulateMove(bridgeLevel, state, "crosser");
    expect(result.kind).toBe("exit");
    expect(result.collapses?.map((entry) => cellKey(entry.cell))).toEqual([
      cellKey(BRIDGE),
    ]);
    const next = applyMove(bridgeLevel, state, result);
    expect(next.collapsed).toEqual([cellKey(BRIDGE)]);
    expect(next.lives).toBe(3);
  });

  test("a long body collapses the cell only once its last cell leaves", () => {
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(0, 4), cell(0, 3), cell(0, 2), cell(1, 2)],
    };
    // Heading east along row 2; the bridge sits at (2, 2).
    const level = fragileLevel([runner], [cell(2, 2)]);
    const result = simulateMove(level, createGameState(level), "runner");
    expect(result.kind).toBe("exit");
    // Three surface steps leave the bridge under the four-cell body; it
    // clears only as the body drains off the edge, reported at step 0 like
    // a flip spot cleared on exit.
    expect(result.collapses?.map((entry) => entry.step)).toEqual([0]);
  });

  test("a park with the body on the cell leaves the collapse pending", () => {
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(0, 2), cell(1, 2)],
    };
    // East along row 2: bridge at (2, 2), circle at (3, 2). Parked, the
    // body covers (2, 2) and (3, 2).
    const level = fragileLevel([runner], [cell(2, 2)], {
      stops: [cell(3, 2)],
    });
    const parkedState = play(level, ["runner"]);
    expect(parkedState.offsets.runner).toBe(2);
    expect(parkedState.collapsed ?? []).toEqual([]);
    expect([...pendingCollapseKeys(level, parkedState)]).toEqual([
      cellKey(cell(2, 2)),
    ]);
    const resumed = play(level, ["runner", "runner"]);
    expect(resumed.collapsed).toEqual([cellKey(cell(2, 2))]);
    expect(resumed.status).toBe("won");
  });

  test("a collision rewinds the collapse along with the arrow", () => {
    const runner: ArrowDefinition = {
      id: "runner",
      path: [cell(0, 2), cell(1, 2)],
    };
    const wall: ArrowDefinition = {
      id: "wall",
      path: [cell(5, 1), cell(5, 2)],
    };
    // The runner's two-cell body clears the bridge at (2, 2) on step 3 and
    // meets the wall at (5, 2) on step 4.
    const level = fragileLevel([runner, wall], [cell(2, 2)], {}, 6);
    const state = createGameState(level);
    const result = simulateMove(level, state, "runner");
    expect(result.kind).toBe("blocked");
    expect(result.collapses?.map((entry) => entry.step)).toEqual([3]);
    const next = applyMove(level, state, result);
    expect(next.collapsed ?? []).toEqual([]);
    expect(next.failedIds).toEqual(["runner"]);
  });
});

describe("falling into the cube", () => {
  test("a head entering a collapsed cell falls and the arrow is removed", () => {
    const afterCrossing = play(bridgeLevel, ["crosser"]);
    const result = simulateMove(bridgeLevel, afterCrossing, "double", "head");
    expect(result.kind).toBe("fall");
    expect(result.hole).toEqual(BRIDGE);
    expect(cellKey(result.route.at(-1) as Cell)).toBe(cellKey(BRIDGE));
    const next = applyMove(bridgeLevel, afterCrossing, result);
    expect(next.remainingIds).toEqual([]);
    expect(next.fallenIds).toEqual(["double"]);
    expect(next.failedIds).toEqual([]);
    expect(next.lives).toBe(2);
    expect(next.status).toBe("won");
  });

  test("crossing order saves the life", () => {
    const safe = play(bridgeLevel, ["crosser", ["double", "tail"]]);
    expect(safe.status).toBe("won");
    expect(safe.lives).toBe(3);
    const costly = play(bridgeLevel, [["double", "head"], "crosser"]);
    expect(costly.status).toBe("won");
    expect(costly.lives).toBe(2);
    expect(costly.fallenIds).toEqual(["crosser"]);
  });

  test("a fall that spends the last life loses the level", () => {
    const level = { ...bridgeLevel, lives: 1 };
    const state = play(level, [["double", "head"], "crosser"]);
    expect(state.status).toBe("lost");
    expect(state.lives).toBe(0);
  });

  test("a failed arrow that later falls pays for both", () => {
    // The tail is blocked by the crosser first; after the crosser leaves,
    // the head falls into the hole.
    const state = play(bridgeLevel, [
      ["double", "tail"],
      "crosser",
      ["double", "head"],
    ]);
    expect(state.failedPositions).toHaveLength(1);
    expect(state.fallenIds).toEqual(["double"]);
    expect(state.lives).toBe(1);
  });

  test("a shared-tail group falls together for one life", () => {
    const pair: readonly ArrowDefinition[] = [
      { id: "north", path: [cell(0, 2), cell(1, 2), cell(1, 1)] },
      { id: "east", path: [cell(0, 2), cell(1, 2), cell(2, 2)] },
    ];
    const level = fragileLevel(pair, [cell(1, 0)]);
    expect(validateLevel(level).errors).toEqual([]);
    const holed: GameState = {
      ...createGameState(level),
      collapsed: [cellKey(cell(1, 0))],
    };
    const result = simulateMove(level, holed, "east");
    expect(result.kind).toBe("fall");
    const next = applyMove(level, holed, result);
    expect(next.remainingIds).toEqual([]);
    expect([...(next.fallenIds ?? [])].sort()).toEqual(["east", "north"]);
    expect(next.lives).toBe(2);
  });

  test("a group collision on the same step as a fall wins the tie", () => {
    const pair: readonly ArrowDefinition[] = [
      { id: "north", path: [cell(0, 2), cell(1, 2), cell(1, 1)] },
      { id: "east", path: [cell(0, 2), cell(1, 2), cell(2, 2)] },
      { id: "wall", path: [cell(3, 4), cell(3, 3), cell(3, 2)] },
    ];
    const level = fragileLevel(pair, [cell(1, 0)]);
    const holed: GameState = {
      ...createGameState(level),
      collapsed: [cellKey(cell(1, 0))],
    };
    const result = simulateMove(level, holed, "north");
    expect(result.kind).toBe("blocked");
    const next = applyMove(level, holed, result);
    expect(next.remainingIds).toContain("north");
    expect(next.fallenIds ?? []).toEqual([]);
  });
});

describe("fragile validation", () => {
  test("accepts a fragile cell on arrow routes", () => {
    expect(validateLevel(bridgeLevel).errors).toEqual([]);
  });

  test("rejects shared cells and out-of-bounds cells", () => {
    const errors = (level: LevelDefinition) => validateLevel(level).errors;
    expect(errors({ ...bridgeLevel, fragile: [cell(1, 2)] })).toContain(
      "Fragile cell front:1:2 sits on an arrow's starting cell.",
    );
    expect(errors({ ...bridgeLevel, fragile: [BRIDGE, BRIDGE] })).toContain(
      "Fragile cell front:1:1 is declared more than once.",
    );
    expect(errors({ ...bridgeLevel, fragile: [cell(9, 0)] })).toContain(
      "Fragile cell front:9:0 is out of bounds.",
    );
    expect(errors({ ...bridgeLevel, stops: [BRIDGE] })).toContain(
      "Fragile cell front:1:1 shares its cell with a stop circle.",
    );
    expect(
      errors({
        ...bridgeLevel,
        directionals: [{ cell: BRIDGE, heading: "north" }],
      }),
    ).toContain(
      "Fragile cell front:1:1 shares its cell with a directional spot.",
    );
    expect(
      errors({
        ...bridgeLevel,
        wormholes: [{ id: "w", a: BRIDGE, b: cell(0, 0, "back") }],
      }),
    ).toContain("Fragile cell front:1:1 shares its cell with a wormhole end.");
  });
});

describe("fragile solving", () => {
  test("certificates clear the cube with zero falls", () => {
    const targets = solveLevelTargets(bridgeLevel);
    expect(targets).toEqual([
      { arrowId: "crosser", endpoint: "head" },
      { arrowId: "double", endpoint: "tail" },
    ]);
  });

  test("a cube whose every clear costs a fall has no certificate", () => {
    const first: ArrowDefinition = {
      id: "first",
      path: [cell(1, 3), cell(1, 2)],
    };
    const second: ArrowDefinition = {
      id: "second",
      path: [cell(3, 1), cell(2, 1)],
    };
    const level = fragileLevel([first, second], [BRIDGE], {}, 4);
    expect(solveLevelTargets(level)).toBeUndefined();
    expect(solveLevelTargets({ ...level, fragile: [] })).toBeDefined();
    // A fall removes the arrow, so no order ever soft-locks the cube.
    expect(hasSoftLockState(level)).toBe(false);
  });

  test("stranding keeps its collision-and-fall-free meaning", () => {
    // After the double's head crosses first, the crosser can only fall.
    expect(hasStrandingState(bridgeLevel)).toBe(true);
    expect(hasSoftLockState(bridgeLevel)).toBe(false);
  });
});
