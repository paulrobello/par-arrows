import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DEMO_BLOCKED_ID,
  DEMO_LEVEL,
  DEMO_SUCCESS_ID,
  LEVELS,
} from "../src/content/levels";
import { decodeRoute, type FrozenRoute } from "../src/content/campaign-layouts";
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

function normalizedDirectionSignature(
  path: readonly {
    readonly face: string;
    readonly x: number;
    readonly y: number;
  }[],
): string {
  const directions: string[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (!previous || !current || previous.face !== current.face) continue;
    const direction =
      current.x > previous.x
        ? "E"
        : current.x < previous.x
          ? "W"
          : current.y > previous.y
            ? "S"
            : "N";
    if (directions.at(-1) !== direction) directions.push(direction);
  }
  return directions.join("");
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
        level.id === 2 ? 30 : 42,
      );
      expect(
        level.arrows.reduce((total, arrow) => total + arrow.path.length, 0),
      ).toBeGreaterThanOrEqual(level.id === 2 ? 200 : 300);
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
      expect(
        new Set(
          multiBend.map((arrow) => normalizedDirectionSignature(arrow.path)),
        ).size,
      ).toBeGreaterThanOrEqual(3);
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
    expect(finalLevel.arrows).toHaveLength(90);
    expect(
      finalLevel.arrows.reduce((total, arrow) => total + arrow.path.length, 0),
    ).toBeGreaterThanOrEqual(850);
    expect(finalMultiBend.length).toBeGreaterThanOrEqual(
      Math.ceil(finalLevel.arrows.length * 0.5),
    );
    expect(
      new Set(finalMultiBend.map((arrow) => bendCount(arrow.path))).size,
    ).toBeGreaterThanOrEqual(3);
    expect(
      new Set(
        finalMultiBend.map((arrow) => normalizedDirectionSignature(arrow.path)),
      ).size,
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
