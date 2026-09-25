import { describe, expect, test } from "bun:test";
import { generateLevel } from "../src/content/procedural";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { arrowTrack, currentPath } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { LevelDefinition } from "../src/core/types";
import {
  hasStrandingState,
  solveLevel,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";

/**
 * Pairs where parking a non-core unit on a circle moves one of its bodies
 * onto a cell another arrow's track uses. Parking-core arrows are excluded
 * because their own interplay is checked by enumeration.
 */
function crossingParks(level: LevelDefinition): readonly string[] {
  const stops = new Set((level.stops ?? []).map(cellKey));
  const owners = new Map<string, Set<string>>();
  for (const arrow of level.arrows) {
    const paths =
      arrow.kind === "double"
        ? [arrow.path, [...arrow.path].reverse()]
        : [arrow.path];
    for (const path of paths) {
      for (const cell of arrowTrack(level, { ...arrow, path })) {
        const key = cellKey(cell);
        owners.set(key, (owners.get(key) ?? new Set()).add(arrow.id));
      }
    }
  }
  const found: string[] = [];
  for (const arrow of level.arrows) {
    if (arrow.kind === "double" || arrow.id.includes("-park-")) continue;
    const unit = overlappingArrowIds(level, arrow.id);
    const track = arrowTrack(level, arrow).map(cellKey);
    for (let index = arrow.path.length; index < track.length; index += 1) {
      if (!stops.has(track[index] as string)) continue;
      const offset = index - arrow.path.length + 1;
      for (const memberId of unit) {
        const member = level.arrows.find((entry) => entry.id === memberId);
        if (!member) continue;
        const own = new Set(member.path.map(cellKey));
        for (const cell of currentPath(level, member, offset)) {
          const key = cellKey(cell);
          if (own.has(key)) continue;
          for (const other of owners.get(key) ?? []) {
            if (!unit.includes(other)) found.push(`${memberId}->${other}`);
          }
        }
      }
    }
  }
  return found;
}

const PARKER = "stop-intro-parker";
const FREED = "stop-intro-freed";
const BLOCKER = "stop-intro-blocker";

describe("stop-circle level content", () => {
  test("cube five is a level-one-style cube with a single circle", () => {
    expect(STOP_INTRO_LEVEL.id).toBe(5);
    expect(STOP_INTRO_LEVEL.gridSize).toBe(4);
    expect(STOP_INTRO_LEVEL.lives).toBe(5);
    expect(STOP_INTRO_LEVEL.arrows).toHaveLength(6);
    expect(STOP_INTRO_LEVEL.stops).toHaveLength(1);
    expect(STOP_INTRO_LEVEL.edgePolicies ?? []).toEqual([]);
    expect(validateLevel(STOP_INTRO_LEVEL)).toEqual({
      valid: true,
      errors: [],
    });
    expect(generateLevel(5)).toBe(STOP_INTRO_LEVEL);
  });

  test("the circle is load-bearing: the same cube is unsolvable without it", () => {
    expect(solveLevel(STOP_INTRO_LEVEL)).toBeDefined();
    expect(solveLevel({ ...STOP_INTRO_LEVEL, stops: [] })).toBeUndefined();
  });

  test("its three front arrows deadlock until one parks on the circle", () => {
    const initial = createGameState(STOP_INTRO_LEVEL);
    // Nothing on the front face can leave: each arrow blocks the next.
    expect(simulateMove(STOP_INTRO_LEVEL, initial, FREED).kind).toBe("blocked");
    expect(simulateMove(STOP_INTRO_LEVEL, initial, BLOCKER).kind).toBe(
      "blocked",
    );

    const park = simulateMove(STOP_INTRO_LEVEL, initial, PARKER);
    expect(park.kind).toBe("paused");
    const parked = applyMove(STOP_INTRO_LEVEL, initial, park);
    expect(parked.offsets).toEqual({ [PARKER]: 1 });
    expect(parked.lives).toBe(5);

    // Parking opened the freed arrow's lane, which in turn opens the blocker's.
    let state = parked;
    for (const arrowId of [FREED, BLOCKER, PARKER]) {
      const result = simulateMove(STOP_INTRO_LEVEL, state, arrowId);
      expect(result.kind).toBe("exit");
      state = applyMove(STOP_INTRO_LEVEL, state, result);
    }
    expect(state.remainingIds).toEqual([
      "stop-intro-back",
      "stop-intro-right",
      "stop-intro-top",
    ]);
    expect(state.lives).toBe(5);
    expect(state.failedIds).toEqual([]);
  });

  test("driving the parked arrow onward too early rebounds to the circle", () => {
    const initial = createGameState(STOP_INTRO_LEVEL);
    const parked = applyMove(
      STOP_INTRO_LEVEL,
      initial,
      simulateMove(STOP_INTRO_LEVEL, initial, PARKER),
    );

    const blocked = simulateMove(STOP_INTRO_LEVEL, parked, PARKER);
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blockerId).toBe(BLOCKER);
    const after = applyMove(STOP_INTRO_LEVEL, parked, blocked);
    expect(after.lives).toBe(4);
    expect(after.failedIds).toEqual([PARKER]);
    expect(after.offsets).toEqual({ [PARKER]: 1 });
  });

  test("its authored solution clears the cube without losing a life", () => {
    const solution = solveLevel(STOP_INTRO_LEVEL);
    if (!solution) throw new Error("Expected a solution for cube five.");
    let state = createGameState(STOP_INTRO_LEVEL);
    for (const arrowId of solution) {
      const result = simulateMove(STOP_INTRO_LEVEL, state, arrowId);
      expect(["exit", "paused"]).toContain(result.kind);
      state = applyMove(STOP_INTRO_LEVEL, state, result);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(STOP_INTRO_LEVEL.lives);
    // The parker is tapped twice: once to park, once to finish.
    expect(solution.filter((id) => id === PARKER)).toHaveLength(2);
  });

  test("generated cubes keep circles clear of arrow bodies and reachable", () => {
    for (const id of [6, 9, 17, 55]) {
      const level = generateLevel(id);
      expect(validateLevel(level).valid).toBe(true);
      const bodies = new Set(
        level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
      );
      for (const stop of level.stops ?? []) {
        expect(bodies.has(cellKey(stop))).toBe(false);
      }
      expect((level.stops ?? []).length).toBeLessThanOrEqual(3);
      expect(solveLevelTargets(level)).toBeDefined();
      if (
        (level.stops ?? []).length > 0 &&
        !level.arrows.some((arrow) => arrow.kind === "double")
      ) {
        // The circle is load-bearing for non-double cubes; a double arrow
        // carries its own alternate solve path past the stripped deadlock.
        expect(solveLevelTargets({ ...level, stops: [] })).toBeUndefined();
      }
    }
  }, 20_000);

  test("parking never moves an arrow onto another arrow's route", () => {
    for (const id of [13, 18, 27, 34, 37, 43, 52, 58, 111, 124, 140]) {
      const level = generateLevel(id);
      expect(crossingParks(level)).toEqual([]);
      const core = level.arrows.filter((arrow) => arrow.id.includes("-park-"));
      if (core.length > 0) {
        expect(hasStrandingState({ ...level, arrows: core })).toBe(false);
      }
    }
  }, 60_000);

  // Re-rolled for generator v8. The v7 regression was cube 52; under v8 the
  // same shape lives on cube 14: a circle at front:12:14 on r14-17's lane
  // would park it onto r14-37's track while r14-37's body pins it, a
  // collision-free strand. The generator must not place that circle, and the
  // shipped cube's endgame around those arrows must stay winnable.
  test("cube 14 can never park an arrow into a permanent deadlock", () => {
    const endgameOf = (level: LevelDefinition): LevelDefinition => {
      let state = createGameState(level);
      for (let pass = 0; pass < level.arrows.length; pass += 1) {
        const before = state.remainingIds.length;
        for (const arrowId of [...state.remainingIds]) {
          if (arrowId === "r14-17" || arrowId.includes("-park-")) continue;
          const result = simulateMove(level, state, arrowId);
          if (result.kind === "exit") state = applyMove(level, state, result);
        }
        if (state.remainingIds.length === before) break;
      }
      return {
        ...level,
        arrows: level.arrows.filter((arrow) =>
          state.remainingIds.includes(arrow.id),
        ),
      };
    };
    const level = generateLevel(14);
    const trap = { face: "front" as const, x: 12, y: 14 };
    expect((level.stops ?? []).map(cellKey)).not.toContain(cellKey(trap));
    // The rule bites: with that circle added, the park crosses a track and
    // the endgame strands.
    const trapped: LevelDefinition = {
      ...level,
      stops: [...(level.stops ?? []), trap],
    };
    expect(validateLevel(trapped).valid).toBe(true);
    expect(crossingParks(trapped)).toContain("r14-17->r14-37");
    expect(hasStrandingState(endgameOf(trapped))).toBe(true);
    // The shipped cube keeps no crossing park and a winnable endgame.
    expect(crossingParks(level)).toEqual([]);
    const endgame = endgameOf(level);
    expect(endgame.arrows.length).toBeGreaterThan(1);
    expect(hasStrandingState(endgame)).toBe(false);
  }, 30_000);

  test("the stranding check finds a park that deadlocks two arrows", () => {
    const cell = (x: number, y: number) => ({ face: "front" as const, x, y });
    const trap: LevelDefinition = {
      id: 900,
      title: "Park trap",
      gridSize: 6,
      lives: 3,
      arrows: [
        { id: "parker", path: [cell(0, 2), cell(1, 2)] },
        { id: "crosser", path: [cell(5, 3), cell(5, 2), cell(4, 2)] },
      ],
      stops: [cell(3, 2)],
    };
    expect(validateLevel(trap).valid).toBe(true);
    const parked = applyMove(
      trap,
      createGameState(trap),
      simulateMove(trap, createGameState(trap), "parker"),
    );
    expect(simulateMove(trap, parked, "parker").kind).toBe("blocked");
    expect(simulateMove(trap, parked, "crosser").kind).toBe("blocked");
    expect(hasStrandingState(trap)).toBe(true);
    expect(hasStrandingState(STOP_INTRO_LEVEL)).toBe(false);
  });
});
