import { describe, expect, test } from "bun:test";
import { DIRECTIONAL_INTRO_LEVEL } from "../src/content/directional-intro";
import {
  AUTHORED_LEVEL_IDS,
  directionalFaceCount,
  generateLevel,
  hasDirectionalCore,
  isAuthoredLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type { Cell } from "../src/core/types";
import {
  solveLevel,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { cachedLevel } from "./generated-levels";

const OPENER = "dir-intro-opener";
const FREED = "dir-intro-freed";
const BLOCKER = "dir-intro-blocker";

describe("directional spot level content", () => {
  test("cube twenty has its own three-body bend lesson", () => {
    expect(DIRECTIONAL_INTRO_LEVEL.id).toBe(20);
    expect(DIRECTIONAL_INTRO_LEVEL.gridSize).toBe(6);
    expect(DIRECTIONAL_INTRO_LEVEL.lives).toBe(5);
    expect(DIRECTIONAL_INTRO_LEVEL.arrows).toHaveLength(3);
    expect(DIRECTIONAL_INTRO_LEVEL.directionals).toEqual([
      { cell: { face: "front", x: 4, y: 3 }, heading: "east" },
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

  test("its three front arrows deadlock until the spot bends the opener", () => {
    const initial = createGameState(DIRECTIONAL_INTRO_LEVEL);
    // Nothing on the front face can leave: each arrow blocks the next.
    expect(simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, FREED).kind).toBe(
      "blocked",
    );
    expect(simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, BLOCKER).kind).toBe(
      "blocked",
    );

    // The spot bends the opener north and out of the cube, which opens the
    // freed arrow's lane and then the blocker's.
    const bend = simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, OPENER);
    expect(bend.kind).toBe("exit");
    expect(bend.route.map(cellKey)).toEqual([
      cellKey({ face: "front", x: 4, y: 2 }),
      cellKey({ face: "front", x: 4, y: 3 }),
      cellKey({ face: "front", x: 5, y: 3 }),
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

  test("front arrows are dead while the opener still blocks the lane", () => {
    const initial = createGameState(DIRECTIONAL_INTRO_LEVEL);
    expect(simulateMove(DIRECTIONAL_INTRO_LEVEL, initial, OPENER).kind).toBe(
      "exit",
    );
    const stripped: typeof DIRECTIONAL_INTRO_LEVEL = {
      ...DIRECTIONAL_INTRO_LEVEL,
      directionals: [],
    };
    const dead = createGameState(stripped);
    expect(simulateMove(stripped, dead, OPENER).kind).toBe("blocked");
    expect(simulateMove(stripped, dead, FREED).kind).toBe("blocked");
    expect(simulateMove(stripped, dead, BLOCKER).kind).toBe("blocked");
  });

  test("its scripted solution clears the cube without losing a life", () => {
    let state = createGameState(DIRECTIONAL_INTRO_LEVEL);
    for (const arrowId of [OPENER, FREED, BLOCKER]) {
      const result = simulateMove(DIRECTIONAL_INTRO_LEVEL, state, arrowId);
      expect(result.kind).toBe("exit");
      state = applyMove(DIRECTIONAL_INTRO_LEVEL, state, result);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(5);
  });

  test("generated cubes draw 0-4 spot faces with 1-4 spots per face", () => {
    for (const id of [21, 22, 23, 24, 25, 26, 27, 28, 29]) {
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
      expect(solveLevelTargets(level)).toBeDefined();
      // A double arrow provides its own alternate solve path, so the
      // spots-required invariant only applies to spot cubes without doubles.
      if (!level.arrows.some((arrow) => arrow.kind === "double")) {
        expect(
          solveLevelTargets({ ...level, directionals: [] }),
        ).toBeUndefined();
      }
    }
  }, 60_000);

  test("most generated cubes carry the mechanic and the split is stable", () => {
    let carriers = 0;
    for (let id = 21; id <= 60; id += 1) {
      // Authored teaching cubes carry no spot plan of their own; their seed
      // streams are irrelevant.
      if (isAuthoredLevel(id)) continue;
      if (hasDirectionalCore(id)) carriers += 1;
    }
    // Uniform draw over 0-4 faces puts a spot plan on ~80% of cubes; the
    // seeded streams make the exact split deterministic per generator.
    // Re-rolled for generator v11.
    expect(carriers).toBe(29);
  });

  test("levels through nineteen are untouched by the directional plan", () => {
    expect(hasDirectionalCore(19)).toBe(false);
    expect(hasDirectionalCore(16)).toBe(false);
    expect(hasDirectionalCore(20)).toBe(true);
    const level = generateLevel(19);
    expect(level.directionals ?? []).toEqual([]);
  });

  test("the spot plan reads the authored cubes, not their seed streams", () => {
    for (const id of AUTHORED_LEVEL_IDS) {
      const level = generateLevel(id);
      expect(hasDirectionalCore(id)).toBe(
        (level.directionals?.length ?? 0) > 0,
      );
    }
    expect(hasDirectionalCore(25)).toBe(true);
  });

  test("directional cores draw varied layouts instead of one stamped shape", () => {
    const shapes = new Set<string>();
    let carriers = 0;
    let requiredUseChecked = 0;
    for (let id = 21; id <= 200; id += 1) {
      if (isAuthoredLevel(id) || !hasDirectionalCore(id)) continue;
      const level = cachedLevel(id);
      const coreA = level.arrows.find((arrow) => arrow.id === `r${id}-dir-a`);
      const coreB = level.arrows.find((arrow) => arrow.id === `r${id}-dir-b`);
      if (!coreA || !coreB) continue;
      carriers += 1;
      const bent = (path: readonly Cell[]): boolean => {
        for (let index = 2; index < path.length; index += 1) {
          const stepIn = {
            x: (path[index - 1] as Cell).x - (path[index - 2] as Cell).x,
            y: (path[index - 1] as Cell).y - (path[index - 2] as Cell).y,
          };
          const stepOut = {
            x: (path[index] as Cell).x - (path[index - 1] as Cell).x,
            y: (path[index] as Cell).y - (path[index - 1] as Cell).y,
          };
          if (stepIn.x !== stepOut.x || stepIn.y !== stepOut.y) return true;
        }
        return false;
      };
      shapes.add(
        `${coreA.path.length}:${coreB.path.length}:${bent(coreA.path)}:${bent(coreB.path)}`,
      );
      // Every fifth carrier also proves required use: the cube is unsolvable
      // with the static spots stripped, so the variant is never decorative.
      if (
        id % 5 === 0 &&
        !level.arrows.some((arrow) => arrow.kind === "double")
      ) {
        expect(
          solveLevelTargets({ ...level, directionals: [] }),
        ).toBeUndefined();
        requiredUseChecked += 1;
      }
    }
    expect(carriers).toBeGreaterThan(50);
    expect(shapes.size).toBeGreaterThanOrEqual(4);
    expect(requiredUseChecked).toBeGreaterThan(3);
  }, 180_000);
});
