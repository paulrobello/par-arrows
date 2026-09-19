import { describe, expect, test } from "bun:test";
import { analyzeLevel } from "../scripts/campaign-quality";
import { decodeRoute, type FrozenRoute } from "../src/content/campaign-layouts";
import { LEVEL_ONE, LEVELS } from "../src/content/levels";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { solveLevel, validateLevel } from "../src/core/validation";

function isStraightSurfaceArrow(
  path: readonly {
    readonly face: string;
    readonly x: number;
    readonly y: number;
  }[],
): boolean {
  return (
    new Set(path.map((cell) => cell.face)).size === 1 &&
    (new Set(path.map((cell) => cell.x)).size === 1 ||
      new Set(path.map((cell) => cell.y)).size === 1)
  );
}

function faceRuns(
  path: readonly { readonly face: string }[],
): readonly { readonly face: string; readonly length: number }[] {
  const runs: { face: string; length: number }[] = [];
  for (const cell of path) {
    const last = runs[runs.length - 1];
    if (last?.face === cell.face) last.length += 1;
    else runs.push({ face: cell.face, length: 1 });
  }
  return runs;
}

function substantialWrap(path: readonly { readonly face: string }[]): boolean {
  const runs = faceRuns(path);
  return runs.some(
    (run, index) => run.length >= 2 && (runs[index + 1]?.length ?? 0) >= 2,
  );
}

function visibleWrap(path: readonly { readonly face: string }[]): boolean {
  const faces = new Set(path.map((cell) => cell.face));
  return (
    (faces.has("top") && faces.has("left")) ||
    (faces.has("front") && faces.has("top"))
  );
}

function bendCount(
  path: readonly {
    readonly face: string;
    readonly x: number;
    readonly y: number;
  }[],
): number {
  let bends = 0;
  for (let index = 2; index < path.length; index += 1) {
    const first = path[index - 2];
    const middle = path[index - 1];
    const last = path[index];
    if (
      !first ||
      !middle ||
      !last ||
      first.face !== middle.face ||
      middle.face !== last.face
    )
      continue;
    const firstVector = [middle.x - first.x, middle.y - first.y] as const;
    const secondVector = [last.x - middle.x, last.y - middle.y] as const;
    if (
      firstVector[0] * secondVector[0] + firstVector[1] * secondVector[1] ===
      0
    )
      bends += 1;
  }
  return bends;
}

describe("curated campaign", () => {
  test("replaces repeated bands with diverse geometry and distributed interior heads", () => {
    const previousCells = [270, 347, 446, 545, 654, 665, 778, 831, 882];
    const doubledCounts = [60, 84, 108, 132, 156, 168, 180, 180, 180];
    for (const [index, level] of LEVELS.slice(1).entries()) {
      const quality = analyzeLevel(level);
      const expectedCount = doubledCounts[index];
      if (expectedCount === undefined)
        throw new Error("Missing doubled level count.");
      expect(level.arrows.length).toBe(expectedCount);
      expect(quality.cells).toBeGreaterThanOrEqual(
        Math.ceil((previousCells[index] ?? 0) * 1.8),
      );
      expect(quality.uniqueUnfoldedBends).toBeGreaterThanOrEqual(
        Math.ceil(quality.multiBend * 0.8),
      );
      expect(quality.maxUnfoldedCopies).toBeLessThanOrEqual(
        Math.max(2, Math.floor(quality.multiBend * 0.15)),
      );
      expect(quality.uniqueBendFootprints).toBeGreaterThanOrEqual(
        Math.ceil(quality.singleFaceMultiBend * 0.75),
      );
      expect(quality.maxBendCopies).toBeLessThanOrEqual(
        Math.max(2, Math.floor(quality.singleFaceMultiBend * 0.15)),
      );
      expect(quality.irregularRuns).toBeGreaterThanOrEqual(
        Math.ceil(quality.multiBend * 0.1),
      );
      expect(quality.narrowWinders).toBeLessThanOrEqual(
        Math.floor(quality.multiBend * 0.1),
      );
      expect(quality.interiorHeads).toBeGreaterThanOrEqual(
        Math.ceil(quality.arrows * 0.3),
      );
      expect(quality.initiallyBlocked).toBeGreaterThanOrEqual(
        Math.ceil(quality.arrows * 0.25),
      );
      for (const occupied of Object.values(quality.faceCells))
        expect(occupied).toBeGreaterThanOrEqual(
          Math.ceil(level.gridSize ** 2 * 0.5),
        );
    }
  });
  test("contains ten valid, face-spanning levels with the configured life curve", () => {
    expect(LEVELS).toHaveLength(10);
    for (const level of LEVELS) {
      expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
      expect(
        new Set(
          level.arrows.flatMap((arrow) => arrow.path.map((cell) => cell.face)),
        ).size,
      ).toBe(6);
      expect(level.lives).toBe(level.id <= 3 ? 5 : level.id <= 6 ? 4 : 3);
    }
  });

  test("replays a complete no-mistake solution for every campaign level", () => {
    for (const level of LEVELS) {
      const solution = solveLevel(level);
      expect(solution).toHaveLength(level.arrows.length);
      let state = createGameState(level);
      for (const arrowId of solution ?? []) {
        const result = simulateMove(level, state, arrowId);
        expect(result.kind).toBe("exit");
        state = applyMove(level, state, result);
      }
      expect(state.status).toBe("won");
      expect(state.remainingIds).toEqual([]);
    }
  }, 15_000);

  test("raises density with real zigzags, wraps, and varied authored route lengths", () => {
    const campaignStraightLengths = new Set<number>();
    for (const level of LEVELS.slice(1)) {
      const levelStraightLengths = new Set<number>();
      for (const arrow of level.arrows) {
        if (isStraightSurfaceArrow(arrow.path)) {
          campaignStraightLengths.add(arrow.path.length);
          levelStraightLengths.add(arrow.path.length);
        }
      }
      const wraps = level.arrows.filter((arrow) => substantialWrap(arrow.path));
      const multiBend = level.arrows.filter(
        (arrow) => bendCount(arrow.path) >= 3,
      );
      const initialState = createGameState(level);
      const initiallyBlocked = level.arrows.filter(
        (arrow) =>
          simulateMove(level, initialState, arrow.id).kind === "blocked",
      );
      expect(level.arrows.length).toBeGreaterThanOrEqual(
        level.id === 2 ? 60 : 84,
      );
      expect(
        level.arrows.reduce((total, arrow) => total + arrow.path.length, 0),
      ).toBeGreaterThanOrEqual(level.id === 2 ? 400 : 600);
      expect(wraps.length).toBeGreaterThanOrEqual(3);
      expect(wraps.some((arrow) => visibleWrap(arrow.path))).toBe(true);
      expect(multiBend.length).toBeGreaterThanOrEqual(
        Math.ceil(level.arrows.length * 0.4),
      );
      expect(initiallyBlocked.length).toBeGreaterThanOrEqual(
        Math.ceil(level.arrows.length * 0.2),
      );
      expect(initiallyBlocked.some((arrow) => bendCount(arrow.path) >= 3)).toBe(
        true,
      );
      expect(levelStraightLengths.size).toBeGreaterThanOrEqual(3);
      if (level.id >= 5)
        expect(
          new Set(
            level.arrows.flatMap((arrow) =>
              arrow.path.map((cell) => cell.face),
            ),
          ).size,
        ).toBe(6);
    }
    for (const length of [2, 3, 4])
      expect(campaignStraightLengths.has(length)).toBe(true);
    const finalLevel = LEVELS.at(-1);
    if (!finalLevel) throw new Error("Expected final campaign level");
    const finalMultiBend = finalLevel.arrows.filter(
      (arrow) => bendCount(arrow.path) >= 3,
    );
    expect(finalLevel.arrows).toHaveLength(180);
    expect(
      finalLevel.arrows.reduce((total, arrow) => total + arrow.path.length, 0),
    ).toBeGreaterThanOrEqual(1700);
    expect(finalMultiBend.length).toBeGreaterThanOrEqual(
      Math.ceil(finalLevel.arrows.length * 0.5),
    );
    expect(
      new Set(finalMultiBend.map((arrow) => bendCount(arrow.path))).size,
    ).toBeGreaterThanOrEqual(3);
  });

  test("adds three-face routes and semantic three-arrow removal chains in later levels", () => {
    for (const level of LEVELS.slice(4)) {
      expect(
        level.arrows.some(
          (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
        ),
      ).toBe(true);
      const state = createGameState(level);
      const results = new Map(
        level.arrows.map((arrow) => [
          arrow.id,
          simulateMove(level, state, arrow.id),
        ]),
      );
      const hasThreeArrowChain = [...results.values()].some((first) => {
        if (first.kind !== "blocked" || !first.blockerId) return false;
        const second = results.get(first.blockerId);
        if (second?.kind !== "blocked" || !second.blockerId) return false;
        return results.get(second.blockerId)?.kind === "exit";
      });
      expect(hasThreeArrowChain).toBe(true);
    }
  });

  test("keeps the browser failure fixtures meaningful", () => {
    const levelThree = LEVELS[2];
    const levelSeven = LEVELS[6];
    if (!levelThree || !levelSeven) throw new Error("Expected levels 3 and 7.");
    const levelThreeState = createGameState(levelThree);
    expect(
      levelThree.arrows.some(
        (arrow) =>
          arrow.path.some((cell) => cell.face === "front") &&
          simulateMove(levelThree, levelThreeState, arrow.id).kind ===
            "blocked",
      ),
    ).toBe(true);
    const levelSevenState = createGameState(levelSeven);
    expect(
      levelSeven.arrows.filter(
        (arrow) =>
          simulateMove(levelSeven, levelSevenState, arrow.id).kind ===
          "blocked",
      ).length,
    ).toBeGreaterThanOrEqual(levelSeven.lives);
  });
});

describe("onboarding fixture", () => {
  test("rejects malformed frozen route tokens without searching", () => {
    const malformed: FrozenRoute = {
      id: "malformed",
      start: ["front", 0, 0],
      steps: "EX",
    };
    expect(() => decodeRoute(malformed, 4)).toThrow("invalid direction token");
  });
});

describe("level one tutorial cube", () => {
  test("pairs a blocked arrow with its blocker on an otherwise open cube", () => {
    expect(LEVEL_ONE.arrows).toHaveLength(7);
    expect(LEVEL_ONE.stops).toBeUndefined();
    expect(LEVEL_ONE.edgePolicies).toBeUndefined();
    expect(validateLevel(LEVEL_ONE)).toEqual({ valid: true, errors: [] });
    expect(
      new Set(
        LEVEL_ONE.arrows.flatMap((arrow) =>
          arrow.path.map((cell) => cell.face),
        ),
      ).size,
    ).toBe(6);
  });

  test("costs a life on the blocked arrow until its blocker clears", () => {
    const initial = createGameState(LEVEL_ONE);
    const failure = simulateMove(LEVEL_ONE, initial, "l1-front-blocked");
    expect(failure.kind).toBe("blocked");
    const afterFailure = applyMove(LEVEL_ONE, initial, failure);
    expect(afterFailure.failedIds).toEqual(["l1-front-blocked"]);
    const blocker = simulateMove(LEVEL_ONE, afterFailure, "l1-front-blocker");
    expect(blocker.kind).toBe("exit");
    const afterBlocker = applyMove(LEVEL_ONE, afterFailure, blocker);
    const retry = simulateMove(LEVEL_ONE, afterBlocker, "l1-front-blocked");
    expect(retry.kind).toBe("exit");
  });
});
