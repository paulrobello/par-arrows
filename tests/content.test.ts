import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DEMO_BLOCKED_ID,
  DEMO_LEVEL,
  DEMO_SUCCESS_ID,
  LEVELS,
  decodeCampaignArrow,
} from "../src/content/levels";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { solveLevel, validateLevel } from "../src/core/validation";
import { headingForPath } from "../src/core/topology";

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

function hasRightAngleBend(
  path: readonly {
    readonly face: string;
    readonly x: number;
    readonly y: number;
  }[],
): boolean {
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
      return true;
  }
  return false;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

describe("curated campaign", () => {
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
  });

  test("uses varied straight lengths and substantial visible wraps after level 1", () => {
    for (const level of LEVELS.slice(1)) {
      const straightLengths = new Set(
        level.arrows
          .filter((arrow) => isStraightSurfaceArrow(arrow.path))
          .map((arrow) => arrow.path.length),
      );
      const wraps = level.arrows.filter((arrow) => substantialWrap(arrow.path));
      for (const length of [2, 3, 4])
        expect(straightLengths.has(length)).toBe(true);
      expect(
        new Set(level.arrows.map((arrow) => arrow.path.length)).size,
      ).toBeGreaterThanOrEqual(4);
      expect(wraps.length).toBeGreaterThanOrEqual(2);
      expect(wraps.some((arrow) => visibleWrap(arrow.path))).toBe(true);
      expect(
        new Set(
          level.arrows.map((arrow) =>
            headingForPath(arrow.path, level.gridSize),
          ),
        ).size,
      ).toBeGreaterThanOrEqual(2);
      if (level.id >= 3)
        expect(
          level.arrows.some((arrow) => hasRightAngleBend(arrow.path)),
        ).toBe(true);
      if (level.id >= 5)
        expect(wraps.length).toBeGreaterThanOrEqual(
          Math.ceil(level.arrows.length * 0.25),
        );
    }
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
  test("rejects malformed wrapped-route crossing counts without searching", () => {
    expect(() => decodeCampaignArrow("l99-wrap-front-east-0-0", 4)).toThrow(
      "requires 1-3 seam crossings",
    );
    expect(() => decodeCampaignArrow("l99-wrap-front-east-0-4", 4)).toThrow(
      "requires 1-3 seam crossings",
    );
  });

  test("preserves the baseline level-one and demo data", () => {
    expect(stableHash(LEVELS[0])).toBe(
      "a37ad4fe023faeecb65317ad7db43cf67e50d9277c6bf1d375133ecd0f6d9a53",
    );
    expect(stableHash(DEMO_LEVEL)).toBe(
      "e3d477b3eedbb57b37538e3f3282865b4a9dbb32f0af58b2fb8f5df2935e9a14",
    );
  });

  test("fails first and then removes the failed arrow's blocker on the front face", () => {
    expect(validateLevel(DEMO_LEVEL)).toEqual({ valid: true, errors: [] });
    const initial = createGameState(DEMO_LEVEL);
    const failure = simulateMove(DEMO_LEVEL, initial, DEMO_BLOCKED_ID);
    const afterFailure = applyMove(DEMO_LEVEL, initial, failure);
    expect(failure.kind).toBe("blocked");
    expect(afterFailure.failedIds).toEqual([DEMO_BLOCKED_ID]);
    const success = simulateMove(DEMO_LEVEL, afterFailure, DEMO_SUCCESS_ID);
    expect(success.kind).toBe("exit");
    expect(success.route.every((cell) => cell.face === "front")).toBe(true);
  });
});
