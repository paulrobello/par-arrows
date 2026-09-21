import { describe, expect, test } from "bun:test";
import {
  directionalFaceCount,
  generateLevel,
  hasDirectionalCore,
} from "../src/content/procedural";
import { DIRECTIONAL_INTRO_LEVEL } from "../src/content/directional-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import { solveLevel, validateLevel } from "../src/core/validation";

const EAST = "dir-intro-east";
const FREED = "dir-intro-freed";
const BLOCKER = "dir-intro-blocker";

describe("directional spot level content", () => {
  test("cube twenty is a level-one-style cube with a single spot", () => {
    expect(DIRECTIONAL_INTRO_LEVEL.id).toBe(20);
    expect(DIRECTIONAL_INTRO_LEVEL.gridSize).toBe(4);
    expect(DIRECTIONAL_INTRO_LEVEL.lives).toBe(5);
    expect(DIRECTIONAL_INTRO_LEVEL.arrows).toHaveLength(6);
    expect(DIRECTIONAL_INTRO_LEVEL.directionals).toEqual([
      { cell: { face: "front", x: 2, y: 1 }, heading: "north" },
    ]);
    expect(DIRECTIONAL_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
    expect(validateLevel(DIRECTIONAL_INTRO_LEVEL).valid).toBe(true);
    expect(generateLevel(20)).toBe(DIRECTIONAL_INTRO_LEVEL);
  });

  test("the spot is load-bearing: the same cube is unsolvable without it", () => {
    expect(solveLevel(DIRECTIONAL_INTRO_LEVEL)).toBeDefined();
    expect(
      solveLevel({ ...DIRECTIONAL_INTRO_LEVEL, directionals: [] }),
    ).toBeUndefined();
  });

  test("its three front arrows deadlock until the spot bends the east arrow", () => {
    const initial = createGameState(DIRECTIONAL_INTRO_LEVEL);
    // Nothing on the front face can leave: each arrow blocks the next.
    expect(simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, FREED).kind).toBe(
      "blocked",
    );
    expect(simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, BLOCKER).kind).toBe(
      "blocked",
    );

    // The spot bends the east arrow north and out of the cube, which opens the
    // freed arrow's lane and then the blocker's.
    const bend = simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, EAST);
    expect(bend.kind).toBe("exit");
    expect(bend.route.map(cellKey)).toEqual([
      cellKey({ face: "front", x: 1, y: 1 }),
      cellKey({ face: "front", x: 2, y: 1 }),
      cellKey({ face: "front", x: 2, y: 0 }),
    ]);

    let state = applyMove(DIRECTIONAL_INTRO_LEVEL, initial, bend);
    for (const arrowId of [FREED, BLOCKER]) {
      const result = simulateMove(DIRECTIONAL_INTRO_LEVEL, state, arrowId);
      expect(result.kind).toBe("exit");
      state = applyMove(DIRECTIONAL_INTRO_LEVEL, state, result);
    }
    expect(state.lives).toBe(5);
    expect(state.failedIds).toEqual([]);
  });

  test("front arrows are dead while the east arrow still blocks the lane", () => {
    const initial = createGameState(DIRECTIONAL_INTRO_LEVEL);
    expect(simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, EAST).kind).toBe(
      "exit",
    );
    const stripped: typeof DIRECTIONAL_INTRO_LEVEL = {
      ...DIRECTIONAL_INTRO_LEVEL,
      directionals: [],
    };
    const dead = createGameState(stripped);
    expect(simulateMove(stripped, dead, EAST).kind).toBe("blocked");
    expect(simulateMove(stripped, dead, FREED).kind).toBe("blocked");
    expect(simulateMove(stripped, dead, BLOCKER).kind).toBe("blocked");
  });

  test("its scripted solution clears the cube without losing a life", () => {
    let state = createGameState(DIRECTIONAL_INTRO_LEVEL);
    for (const arrowId of [
      EAST,
      FREED,
      BLOCKER,
      "dir-intro-back",
      "dir-intro-right",
      "dir-intro-top",
    ]) {
      const result = simulateMove(DIRECTIONAL_INTRO_LEVEL, state, arrowId);
      expect(result.kind).toBe("exit");
      state = applyMove(DIRECTIONAL_INTRO_LEVEL, state, result);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(5);
  });

  test("generated cubes draw 0-4 spot faces with 1-4 spots per face", () => {
    for (const id of [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]) {
      const planFaces = directionalFaceCount(id);
      const level = generateLevel(id);
      expect(validateLevel(level).valid).toBe(true);
      const spots = level.directionals ?? [];
      if (planFaces === 0) {
        expect(spots).toEqual([]);
        continue;
      }
      expect(hasDirectionalCore(id)).toBe(true);
      expect(spots.length).toBeGreaterThanOrEqual(1);
      expect(spots.length).toBeLessThanOrEqual(16);
      const perFace = new Map<string, number>();
      const cells = new Set<string>();
      for (const spot of spots) {
        const key = cellKey(spot.cell);
        expect(cells.has(key)).toBe(false);
        cells.add(key);
        perFace.set(spot.cell.face, (perFace.get(spot.cell.face) ?? 0) + 1);
      }
      expect(perFace.size).toBeLessThanOrEqual(4);
      for (const count of perFace.values()) {
        expect(count).toBeLessThanOrEqual(4);
      }
      expect(solveLevel(level)).toBeDefined();
      expect(solveLevel({ ...level, directionals: [] })).toBeUndefined();
    }
  }, 60_000);

  test("most generated cubes carry the mechanic and the split is stable", () => {
    let carriers = 0;
    for (let id = 21; id <= 60; id += 1) {
      if (hasDirectionalCore(id)) carriers += 1;
    }
    // Uniform draw over 0-4 faces puts a spot plan on ~80% of cubes; the
    // seeded streams make the exact split deterministic per generator.
    expect(carriers).toBe(31);
  });

  test("levels through nineteen are untouched by the directional plan", () => {
    expect(hasDirectionalCore(19)).toBe(false);
    expect(hasDirectionalCore(16)).toBe(false);
    expect(hasDirectionalCore(20)).toBe(true);
    const level = generateLevel(19);
    expect(level.directionals ?? []).toEqual([]);
    expect(level.stops ?? []).toHaveLength(3);
  });
});
