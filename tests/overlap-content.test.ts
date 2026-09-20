import { describe, expect, test } from "bun:test";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import {
  generateLevel,
  getLevelConfig,
  seedForLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { cellKey, headingBetween } from "../src/core/topology";
import { solveLevel, validateLevel } from "../src/core/validation";

function replay(
  level: ReturnType<typeof generateLevel>,
  ids: readonly string[],
): void {
  let state = createGameState(level);
  for (const arrowId of ids) {
    const result = simulateMove(level, state, arrowId);
    expect(result.kind).toBe("exit");
    state = applyMove(level, state, result);
  }
  expect(state.status).toBe("won");
  expect(state.lives).toBe(level.lives);
}

describe("overlapping-tail level content", () => {
  test("the compact authored lesson teaches pair failure, removal, and retry", () => {
    const level = OVERLAP_INTRO_LEVEL;
    expect(getLevelConfig(15)).toEqual({
      gridSize: 4,
      arrowCount: 6,
      lives: 5,
      arrowScale: 1,
    });
    expect(level.id).toBe(15);
    expect(seedForLevel(15)).toBe(
      "par-arrows:runtime:3:level:15:overlap-intro:1",
    );
    expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
    expect(overlappingArrowIds(level, "overlap-intro-pair-a")).toEqual([
      "overlap-intro-pair-a",
      "overlap-intro-pair-b",
    ]);
    expect(overlappingArrowIds(level, "overlap-intro-trio-a")).toEqual([
      "overlap-intro-trio-a",
      "overlap-intro-trio-b",
      "overlap-intro-trio-c",
    ]);

    let state = createGameState(level);
    const failedPair = simulateMove(level, state, "overlap-intro-pair-b");
    expect(failedPair.kind).toBe("blocked");
    expect(failedPair.members).toHaveLength(2);
    state = applyMove(level, state, failedPair);
    expect(state.failedIds).toEqual([
      "overlap-intro-pair-a",
      "overlap-intro-pair-b",
    ]);
    expect(state.lives).toBe(level.lives - 1);

    const removeBlocker = simulateMove(level, state, "overlap-intro-blocker");
    expect(removeBlocker.kind).toBe("exit");
    state = applyMove(level, state, removeBlocker);
    const retry = simulateMove(level, state, "overlap-intro-pair-a");
    expect(retry.kind).toBe("exit");
    expect(retry.members).toHaveLength(2);
    state = applyMove(level, state, retry);
    expect(state.remainingIds).not.toContain("overlap-intro-pair-a");
    expect(state.remainingIds).not.toContain("overlap-intro-pair-b");

    const solution = solveLevel(level);
    if (!solution)
      throw new Error("Expected the overlap lesson to be solvable.");
    replay(level, solution);
  });

  test("generated levels 16+ seed deterministic pair and trio groups", () => {
    for (const [id, expectedSize] of [
      [16, 2],
      [18, 3],
    ] as const) {
      const level = generateLevel(id);
      const group = overlappingArrowIds(level, level.arrows[0]?.id ?? "");
      expect(group).toHaveLength(expectedSize);
      expect(level.arrows).toHaveLength(getLevelConfig(id).arrowCount);
      expect(level).toEqual(generateLevel(id));
      expect(seedForLevel(id)).toBe(`par-arrows:runtime:4:level:${id}`);
      expect(validateLevel(level)).toEqual({ valid: true, errors: [] });

      let state = createGameState(level);
      if ((level.stops ?? []).length > 0) {
        // The parking deadlock breaks the plain reverse order, so circle
        // levels replay the solver's park-prefixed solution instead.
        const solution = solveLevel(level);
        if (!solution) throw new Error("Expected a generated solution.");
        for (const arrowId of solution) {
          const result = simulateMove(level, state, arrowId);
          expect(["exit", "paused"]).toContain(result.kind);
          state = applyMove(level, state, result);
        }
      } else {
        for (const arrow of [...level.arrows].reverse()) {
          // An arrow whose route crosses a stop circle needs one tap per leg.
          while (state.remainingIds.includes(arrow.id)) {
            const result = simulateMove(level, state, arrow.id);
            expect(["exit", "paused"]).toContain(result.kind);
            const next = applyMove(level, state, result);
            expect(next).not.toBe(state);
            state = next;
          }
        }
      }
      expect(state.status).toBe("won");
      expect(state.lives).toBe(level.lives);
    }
  }, 20_000);

  test("generated cubes wrap group members around cube seams", () => {
    let wrappedCubes = 0;
    let staggeredCubes = 0;
    for (const id of [
      16, 17, 18, 19, 21, 22, 23, 24, 25, 28, 40, 46, 49, 55, 58, 70,
    ]) {
      const level = generateLevel(id);
      expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
      if ((level.directionals ?? []).length > 0) continue;
      expect(level).toEqual(generateLevel(id));
      const group = overlappingArrowIds(level, level.arrows[0]?.id ?? "");
      expect(group.length).toBeGreaterThan(1);
      const members = level.arrows.filter((arrow) => group.includes(arrow.id));
      const shared = members
        .map((member) => new Set(member.path.map(cellKey)))
        .reduce(
          (left, right) => new Set([...left].filter((key) => right.has(key))),
        );
      const sharedFaces = new Set(
        [...shared].map((key) => key.split(":")[0] ?? ""),
      );
      let wrappedMember = false;
      let staggeredMember = false;
      for (const member of members) {
        const head = member.path[member.path.length - 1];
        if (head && !sharedFaces.has(head.face)) wrappedMember = true;
      }
      for (let first = 0; first < members.length; first += 1) {
        const left = members[first];
        if (!left) continue;
        for (const right of members.slice(first + 1)) {
          let divergence = 0;
          while (
            divergence < left.path.length &&
            divergence < right.path.length &&
            cellKey(left.path[divergence]!) === cellKey(right.path[divergence]!)
          ) {
            divergence += 1;
          }
          if (divergence < 2) continue;
          if (divergence >= left.path.length) continue;
          if (divergence >= right.path.length) continue;
          const sharedHeading = headingBetween(
            left.path[divergence - 2]!,
            left.path[divergence - 1]!,
            level.gridSize,
          );
          const leftHeading = headingBetween(
            left.path[divergence - 1]!,
            left.path[divergence]!,
            level.gridSize,
          );
          const rightHeading = headingBetween(
            right.path[divergence - 1]!,
            right.path[divergence]!,
            level.gridSize,
          );
          if (
            sharedHeading &&
            (leftHeading === sharedHeading || rightHeading === sharedHeading)
          ) {
            staggeredMember = true;
          }
        }
      }
      if (wrappedMember) wrappedCubes += 1;
      if (staggeredMember) staggeredCubes += 1;

      let state = createGameState(level);
      if ((level.stops ?? []).length > 0) {
        const solution = solveLevel(level);
        if (!solution) throw new Error(`Expected a solution for cube ${id}.`);
        for (const arrowId of solution) {
          const result = simulateMove(level, state, arrowId);
          expect(["exit", "paused"]).toContain(result.kind);
          state = applyMove(level, state, result);
        }
      } else {
        for (const arrow of [...level.arrows].reverse()) {
          // An arrow whose route crosses a stop circle needs one tap per leg.
          while (state.remainingIds.includes(arrow.id)) {
            const result = simulateMove(level, state, arrow.id);
            expect(["exit", "paused"]).toContain(result.kind);
            const next = applyMove(level, state, result);
            expect(next).not.toBe(state);
            state = next;
          }
        }
      }
      expect(state.status).toBe("won");
      expect(state.lives).toBe(level.lives);
    }
    expect(wrappedCubes).toBeGreaterThanOrEqual(3);
    expect(staggeredCubes).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
