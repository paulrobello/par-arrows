import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "../src/content/intro";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import {
  AUTHORED_LEVEL_IDS,
  doubleArrowFrequency,
  GENERATOR_VERSION,
  MAX_GENERATED_ARROWS,
  generateLevel,
  getLevelConfig,
  getStopCount,
  getWrappingEdgePolicies,
  getWrappingEdgeWeights,
  isAuthoredLevel,
  MAX_LEVEL_ID,
  seedForLevel,
} from "../src/content/procedural";
import { cachedLevel } from "./generated-levels";
import {
  applyMove,
  createGameState,
  simulateMove as simulateGameMove,
} from "../src/core/game-state";
import { simulateMove as simulateCoreMove } from "../src/core/movement";
import { overlappingArrowIds } from "../src/core/overlap";
import { arrowTrack } from "../src/core/stops";
import {
  cellKey,
  headingBetween,
  oppositeHeading,
  seamTransition,
} from "../src/core/topology";
import type { LevelDefinition } from "../src/core/types";
import {
  solveLevel,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";

function geometryHash(level: LevelDefinition): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: level.id,
        gridSize: level.gridSize,
        lives: level.lives,
        arrowScale: level.arrowScale,
        arrows: level.arrows,
        ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
      }),
    )
    .digest("hex");
}

function replaySolution(level: LevelDefinition): void {
  const solution = solveLevelTargets(level);
  if (!solution) throw new Error(`Expected a solution for ${level.id}.`);
  let state = createGameState(level);
  for (const target of solution) {
    const result = simulateGameMove(
      level,
      state,
      target.arrowId,
      target.endpoint,
    );
    expect(["exit", "paused"]).toContain(result.kind);
    state = applyMove(level, state, result);
  }
  expect(state.status).toBe("won");
  expect(state.lives).toBe(level.lives);
}

function diverseLevelIds(): readonly number[] {
  const ids = new Set<number>([
    2,
    3,
    4,
    6,
    7,
    8,
    9,
    10,
    13,
    14,
    16,
    18,
    100,
    1_000,
    1_000_000,
    MAX_LEVEL_ID,
  ]);
  for (let index = 1; ids.size < 120; index += 1) {
    ids.add(2 + ((index * 77_777_777_777_777) % (MAX_LEVEL_ID - 1)));
  }
  return [...ids];
}

function straightLengths(level: LevelDefinition): readonly number[] {
  return level.arrows
    .filter((arrow) => {
      if (new Set(arrow.path.map((cell) => cell.face)).size !== 1) return false;
      return (
        new Set(arrow.path.map((cell) => cell.x)).size === 1 ||
        new Set(arrow.path.map((cell) => cell.y)).size === 1
      );
    })
    .map((arrow) => arrow.path.length);
}

function normalizedShapeSignature(
  level: LevelDefinition,
  arrow: LevelDefinition["arrows"][number],
): string {
  return arrow.path
    .slice(1)
    .map((cell, index) => {
      const previous = arrow.path[index];
      if (!previous) throw new Error("Arrow path was unexpectedly incomplete.");
      const heading = headingBetween(previous, cell, level.gridSize);
      if (!heading) throw new Error("Generated arrow path was not adjacent.");
      return `${previous.face === cell.face ? "" : "/"}${heading}`;
    })
    .join("");
}

describe("generated double arrows", () => {
  test("uses v10 generation, keeps the authored seeds, and the planned frequency curve", () => {
    expect(GENERATOR_VERSION).toBe(10);
    expect(AUTHORED_LEVEL_IDS).toEqual([
      1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ]);
    expect(seedForLevel(25)).toBe(
      "par-arrows:runtime:7:level:25:double-intro:1",
    );
    expect(seedForLevel(1)).toBe("par-arrows:runtime:1:level:1");
    expect(doubleArrowFrequency(25)).toBe(0);
    expect(doubleArrowFrequency(26)).toBeCloseTo(0.2);
    expect(doubleArrowFrequency(60)).toBeCloseTo(0.45);
    expect(doubleArrowFrequency(1_000)).toBeCloseTo(0.45);
  });

  test("deterministically omits doubles before 26 and includes required-use samples", () => {
    for (const id of [2, 10, 12, 20, 24]) {
      expect(
        generateLevel(id).arrows.some((arrow) => arrow.kind === "double"),
      ).toBe(false);
    }
    const samples = Array.from({ length: 20 }, (_, index) => 26 + index);
    const withDouble = samples
      .map(generateLevel)
      .filter((level) => level.arrows.some((arrow) => arrow.kind === "double"));
    expect(withDouble.length).toBeGreaterThan(0);
    for (const level of withDouble) {
      expect(generateLevel(level.id)).toEqual(level);
      const doubles = level.arrows.filter((arrow) => arrow.kind === "double");
      expect(doubles).toHaveLength(1);
      expect(overlappingArrowIds(level, doubles[0]?.id ?? "")).toHaveLength(1);
      const solution = solveLevelTargets(level);
      expect(solution).toBeDefined();
      expect(
        solution?.some(
          (target) =>
            doubles.some((arrow) => arrow.id === target.arrowId) &&
            target.endpoint === "tail",
        ),
      ).toBe(true);
      expect(level.arrows.length).toBeLessThanOrEqual(MAX_GENERATED_ARROWS);
    }
  }, 60_000);

  test("generated doubles are long and bend", () => {
    const lengths: number[] = [];
    let bent = 0;
    for (let id = 26; id <= 200; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      const double = level.arrows.find((arrow) => arrow.kind === "double");
      if (!double) continue;
      expect(double.path.length).toBeGreaterThanOrEqual(5);
      lengths.push(double.path.length);
      const headings = new Set(
        double.path
          .slice(1)
          .map((cell, index) =>
            headingBetween(
              double.path[index] as (typeof double.path)[number],
              cell,
              level.gridSize,
            ),
          ),
      );
      if (headings.size > 1) bent += 1;
    }
    expect(lengths.length).toBeGreaterThan(0);
    expect(bent * 2).toBeGreaterThanOrEqual(lengths.length);
    lengths.sort((left, right) => left - right);
    const middle = Math.floor(lengths.length / 2);
    const median =
      lengths.length % 2 === 1
        ? (lengths[middle] as number)
        : ((lengths[middle - 1] as number) + (lengths[middle] as number)) / 2;
    expect(median).toBeGreaterThanOrEqual(6);
  }, 900_000);
});

describe("runtime campaign generator", () => {
  test("has a versioned stable seed and rejects unsafe ids", () => {
    expect(GENERATOR_VERSION).toBe(10);
    expect(seedForLevel(1_000_000)).toBe(seedForLevel(1_000_000));
    expect(seedForLevel(1_000_000)).not.toBe(seedForLevel(1_000_001));
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, MAX_LEVEL_ID + 1])
      expect(() => generateLevel(id)).toThrow(RangeError);
  });

  test("keeps level one unchanged and regenerates every later id identically", () => {
    expect(generateLevel(1)).toEqual(LEVEL_ONE);
    for (const id of [2, 10, 12, 14, 15, 16, 100, 1_000, 1_000_000]) {
      expect(generateLevel(id)).toEqual(generateLevel(id));
    }
  }, 30_000);

  test("pins v10 geometry for early generated levels and keeps the authored cubes", () => {
    // Re-rolled for generator v10.
    expect(geometryHash(generateLevel(2))).toBe(
      "cf2f92bda9b5b1a9480f8aaf12afbbbc8d3180712c4cc10ab7718c8bc0ac507c",
    );
    expect(geometryHash(generateLevel(10))).toBe(
      "0bed69470ffe8eb628f51a0c6e31f46008e720f5687c80f17bcd63fc53e9702a",
    );
    expect(geometryHash(generateLevel(12))).toBe(
      "58ef432b859859849aeff9004a7dd3e06955d72be7f31127ecc43692ce4fef33",
    );
    expect(geometryHash(generateLevel(13))).toBe(
      "0d9e3439637e03909bce98cafd27762e02ab5cce21f2c314971fab8078fb5be3",
    );
    expect(geometryHash(generateLevel(14))).toBe(
      "6ee76798966de9cc6bd19b6bbdd5096dd4899a50f4fa42dcef2999608cea35fe",
    );
    expect(geometryHash(generateLevel(3))).toBe(
      "85c87297ba08873c5c4ae32928903b3c15c58471411372c13d68570cf5167f70",
    );
    expect(geometryHash(generateLevel(4))).toBe(
      "7ba22f8ad4e119aa3ff883ca0fbab432846c6492039ef85baaed8dde7a9adea6",
    );
    expect(generateLevel(5)).toBe(STOP_INTRO_LEVEL);
    expect(generateLevel(15)).toBe(OVERLAP_INTRO_LEVEL);
    expect(getWrappingEdgeWeights(15)).toEqual([1, 0, 0, 0]);
    expect(getWrappingEdgePolicies(15)).toEqual([]);
  });

  test("builds bounded valid levels that clear in removal order or by the solver", () => {
    const layouts = [2, 3, 7, 10, 14, 16, 327, 1_000, 1_000_000].map(
      generateLevel,
    );
    expect(
      new Set(layouts.map((level) => JSON.stringify(level.arrows))).size,
    ).toBe(layouts.length);
    for (const level of layouts) {
      expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
      expect(level.gridSize).toBeLessThanOrEqual(18);
      expect(level.arrows.length).toBeLessThanOrEqual(MAX_GENERATED_ARROWS);
      expect(
        Math.max(...level.arrows.map((arrow) => arrow.path.length)),
      ).toBeLessThanOrEqual(40);
      expect(
        new Set(
          level.arrows.flatMap((arrow) => arrow.path.map((cell) => cell.face)),
        ).size,
      ).toBe(6);
      expect(
        level.arrows.some(
          (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
        ),
      ).toBe(true);
      const lengths = straightLengths(level);
      for (const length of [2, 3, 4]) expect(lengths).toContain(length);
      // Two-cell arrows have only four possible shapes on a cube and the
      // generator plants them on purpose, so repetition is only a variety
      // problem for shapes long enough to be recognisable.
      const shapeCopies = new Map<string, number>();
      for (const arrow of level.arrows) {
        if (arrow.path.length < 3) continue;
        const signature = normalizedShapeSignature(level, arrow);
        shapeCopies.set(signature, (shapeCopies.get(signature) ?? 0) + 1);
      }
      expect(Math.max(...shapeCopies.values())).toBeLessThanOrEqual(
        Math.max(6, Math.ceil(level.arrows.length * 0.03)),
      );
      if (
        (level.stops ?? []).length > 0 ||
        level.arrows.some((arrow) => arrow.kind === "double") ||
        (level.directionals ?? []).length > 0 ||
        (level.wormholes ?? []).length > 0
      ) {
        // Circles, doubles, and any spot-bearing board replay the solver's
        // own order: flip spots make routes order-dependent, so plain
        // reverse order is not the guaranteed one on those cubes.
        replaySolution(level);
      } else {
        let certificateState = createGameState(level);
        for (const arrow of [...level.arrows].reverse()) {
          // An arrow whose route crosses a stop circle needs one tap per leg.
          while (certificateState.remainingIds.includes(arrow.id)) {
            const result = simulateGameMove(
              level,
              certificateState,
              arrow.id,
              arrow.kind === "double" ? "tail" : "head",
            );
            expect(["exit", "paused"]).toContain(result.kind);
            const next = applyMove(level, certificateState, result);
            expect(next).not.toBe(certificateState);
            certificateState = next;
          }
        }
        expect(certificateState.status).toBe("won");
        expect(certificateState.lives).toBe(level.lives);
        if ([2, 10].includes(level.id)) {
          let state = createGameState(level);
          const solution = solveLevel(level);
          if (!solution) throw new Error("Expected a generated solution.");
          for (const arrowId of solution) {
            const result = simulateGameMove(level, state, arrowId);
            expect(["exit", "paused"]).toContain(result.kind);
            state = applyMove(level, state, result);
          }
          expect(state.status).toBe("won");
          expect(state.lives).toBe(level.lives);
        }
      }
    }
  }, 60_000);

  test("keeps the intended v10 curve and continuing capped progression", () => {
    expect(
      [2, 3, 4, 6, 7, 8, 9, 10].map((id) => getLevelConfig(id).arrowCount),
    ).toEqual([45, 45, 54, 54, 54, 65, 65, 65]);
    expect(getLevelConfig(5).arrowCount).toBe(6);
    expect(getLevelConfig(3).lives).toBe(5);
    expect(getLevelConfig(6).lives).toBe(4);
    expect(getLevelConfig(7).lives).toBe(3);
    expect(getLevelConfig(12).arrowCount).toBe(76);
    expect(getLevelConfig(31).arrowCount).toBe(130);
    expect(getLevelConfig(1_000_000).gridSize).toBe(18);
    expect(getLevelConfig(1_000_000).arrowCount).toBe(200);
  });

  test("v10 config curves", () => {
    expect(getLevelConfig(2)).toEqual({
      gridSize: 10,
      arrowCount: 45,
      lives: 5,
      arrowScale: 10 / 8,
    });
    expect(getLevelConfig(12)).toEqual({
      gridSize: 13,
      arrowCount: 76,
      lives: 3,
      arrowScale: 13 / 14,
    });
    expect(getLevelConfig(41)).toEqual({
      gridSize: 18,
      arrowCount: 146,
      lives: 3,
      arrowScale: 18 / 14,
    });
    expect(getLevelConfig(32).arrowCount).toBe(146);
    expect(getLevelConfig(42).arrowCount).toBe(146);
    expect(getLevelConfig(43).arrowCount).toBe(150);
    expect(getLevelConfig(52).arrowCount).toBe(168);
    expect(getLevelConfig(57).arrowCount).toBe(178);
    expect(getLevelConfig(67).arrowCount).toBe(198);
    expect(getLevelConfig(68).arrowCount).toBe(200);
    expect(getLevelConfig(69).arrowCount).toBe(200);
    expect(getLevelConfig(32).gridSize).toBe(18);
  });

  test("constructs a broad deterministic seeded sweep without quality collapse", () => {
    for (const id of diverseLevelIds()) {
      const level = generateLevel(id);
      expect(seedForLevel(id)).toBe(
        `par-arrows:runtime:${GENERATOR_VERSION}:level:${id}`,
      );
      expect(validateLevel(level).valid).toBe(true);
      // The face plan governs static spots; a flip or rotor core's spot is separate.
      const spots = (level.directionals ?? []).filter(
        (spot) => spot.kind !== "flip" && spot.kind !== "rotor",
      );
      if (spots.length > 0) {
        const perFace = new Map<string, number>();
        for (const spot of spots) {
          perFace.set(spot.cell.face, (perFace.get(spot.cell.face) ?? 0) + 1);
        }
        expect(perFace.size).toBeLessThanOrEqual(4);
        for (const count of perFace.values()) {
          expect(count).toBeLessThanOrEqual(4);
        }
      }
      expect(level.gridSize).toBeLessThanOrEqual(18);
      // Every tier fills to the exact configured count.
      expect(level.arrows.length).toBe(getLevelConfig(id).arrowCount);
      expect(level.arrows.length).toBeLessThanOrEqual(MAX_GENERATED_ARROWS);
      expect(
        Math.max(...level.arrows.map((arrow) => arrow.path.length)),
      ).toBeLessThanOrEqual(40);
      // The construction guarantees the three-face spread on spot cubes
      // only (a directional board without one restarts); elsewhere it was a
      // statistical property of the v8 density, not a rule.
      if ((level.directionals ?? []).length > 0) {
        expect(
          level.arrows.some(
            (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
          ),
        ).toBe(true);
      }
      const lengths = straightLengths(level);
      for (const length of [2, 3, 4]) expect(lengths).toContain(length);
    }
  }, 240_000);

  test("introduces wrapping after level ten and shifts probability toward more edges", () => {
    for (let id = 1; id <= 10; id += 1) {
      expect(getWrappingEdgeWeights(id)).toEqual([1, 0, 0, 0]);
      expect(generateLevel(id).edgePolicies ?? []).toEqual([]);
    }
    expect(getWrappingEdgeWeights(11)).toEqual([0, 1, 0, 0]);
    expect(getWrappingEdgeWeights(12)).toEqual([
      0.25, 0.594943820224719, 0.12202247191011235, 0.033033707865168536,
    ]);
    const final = getWrappingEdgeWeights(100);
    expect(final[0]).toBe(0.25);
    expect(final[1]).toBeCloseTo(0.15);
    expect(final[2]).toBeCloseTo(0.3);
    expect(final[3]).toBeCloseTo(0.3);
    expect(getWrappingEdgeWeights(MAX_LEVEL_ID)).toEqual(final);
    for (let id = 12; id <= 100; id += 1) {
      const current = getWrappingEdgeWeights(id);
      if (
        id === 15 ||
        id === 20 ||
        id === 25 ||
        id === 30 ||
        id === 35 ||
        id === 40 ||
        id === 45 ||
        id === 50 ||
        id === 55 ||
        id === 60
      ) {
        expect(current).toEqual([1, 0, 0, 0]);
        continue;
      }
      const previous = getWrappingEdgeWeights(
        id === 16
          ? 14
          : id === 21
            ? 19
            : id === 26
              ? 24
              : id === 31
                ? 29
                : id === 36
                  ? 34
                  : id === 41
                    ? 39
                    : id === 46
                      ? 44
                      : id === 51
                        ? 49
                        : id === 56
                          ? 54
                          : id === 61
                            ? 59
                            : id - 1,
      );
      expect(current[0]).toBe(0.25);
      expect(
        current.reduce((sum, probability) => sum + probability, 0),
      ).toBeCloseTo(1);
      expect(current[1]).toBeLessThan(previous[1]);
      expect(current[2]).toBeGreaterThan(previous[2]);
      expect(current[3]).toBeGreaterThan(previous[3]);
    }
  });

  test("authored level eleven safely teaches the reciprocal front-left wrap", () => {
    const level = generateLevel(11);
    expect(level).toBe(WRAP_INTRO_LEVEL);
    expect(level).toMatchObject({
      id: 11,
      title: "Cube 11",
      gridSize: 4,
      lives: 5,
      arrowScale: 1,
    });
    expect(getLevelConfig(11)).toEqual({
      gridSize: 4,
      arrowCount: 6,
      lives: 5,
      arrowScale: 1,
    });
    expect(level.arrows).toHaveLength(6);
    expect(
      new Set(
        level.arrows.flatMap((arrow) => arrow.path.map((cell) => cell.face)),
      ),
    ).toEqual(new Set(["front", "back", "right", "left", "top", "bottom"]));
    expect(seedForLevel(11)).toBe("par-arrows:runtime:2:level:11:wrap-intro:1");
    expect(generateLevel(11)).toBe(WRAP_INTRO_LEVEL);
    expect(getWrappingEdgePolicies(11)).toEqual([
      {
        face: "front",
        edge: "west",
        policy: "continue",
        neighbor: { face: "left", entering: "west" },
      },
      {
        face: "left",
        edge: "east",
        policy: "continue",
        neighbor: { face: "front", entering: "east" },
      },
    ]);
    expect(level.edgePolicies).toEqual(getWrappingEdgePolicies(11));
    expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
    const allIds = level.arrows.map((arrow) => arrow.id);
    for (const arrow of level.arrows) {
      expect(simulateCoreMove(level, allIds, arrow.id).kind).toBe("exit");
    }

    const frontArrow = level.arrows.find(
      (arrow) => arrow.id === "wrap-intro-front",
    );
    const leftArrow = level.arrows.find(
      (arrow) => arrow.id === "wrap-intro-left",
    );
    const frontBoundary = frontArrow?.path[1];
    const leftBoundary = leftArrow?.path[1];
    if (!frontArrow || !leftArrow || !frontBoundary || !leftBoundary)
      throw new Error("Wrap intro arrows are missing their boundary cells.");
    const frontMove = simulateCoreMove(level, allIds, frontArrow.id);
    const leftMove = simulateCoreMove(level, allIds, leftArrow.id);
    expect(frontMove.route).toContainEqual(
      seamTransition(frontBoundary, "west", 4).cell,
    );
    expect(leftMove.route).toContainEqual(
      seamTransition(leftBoundary, "east", 4).cell,
    );
    expect(frontMove.kind).toBe("exit");
    expect(new Set(frontMove.route.map((cell) => cell.face))).toEqual(
      new Set(["front", "left"]),
    );
    expect(leftMove.kind).toBe("exit");
    expect(new Set(leftMove.route.map((cell) => cell.face))).toEqual(
      new Set(["left", "front"]),
    );
    for (let id = 1; id <= 10; id += 1) {
      expect(generateLevel(id).edgePolicies ?? []).toEqual([]);
    }
  });

  test("samples zero through three unique reciprocal physical edges with the intended late weights", () => {
    const counts = [0, 0, 0, 0];
    const physicalEdges = new Set<string>();
    for (let id = 100; id < 10_100; id += 1) {
      const policies = getWrappingEdgePolicies(id);
      const count = policies.length / 2;
      expect(Number.isInteger(count) && count >= 0 && count <= 3).toBe(true);
      counts[count] = (counts[count] ?? 0) + 1;
      expect(
        new Set(policies.map((rule) => `${rule.face}:${rule.edge}`)).size,
      ).toBe(policies.length);
      for (const rule of policies) {
        expect(rule.policy).toBe("continue");
        expect(rule.neighbor).toBeDefined();
        if (!rule.neighbor) throw new Error("Missing reciprocal edge.");
        physicalEdges.add([rule.face, rule.neighbor.face].sort().join(":"));
        expect(policies).toContainEqual({
          face: rule.neighbor.face,
          edge: oppositeHeading(rule.neighbor.entering),
          policy: "continue",
          neighbor: { face: rule.face, entering: oppositeHeading(rule.edge) },
        });
      }
    }
    expect(physicalEdges.size).toBe(12);
    const expected = [0.25, 0.15, 0.3, 0.3];
    counts.forEach((count, index) => {
      expect(Math.abs(count / 10_000 - (expected[index] ?? 0))).toBeLessThan(
        0.02,
      );
    });
  });

  test("introduces stop circles at level five and spreads zero to three later", () => {
    for (let id = 1; id <= 4; id += 1) {
      expect(getStopCount(id)).toBe(0);
      expect(generateLevel(id).stops ?? []).toEqual([]);
    }
    expect(getStopCount(5)).toBe(1);
    expect(generateLevel(5).stops).toHaveLength(1);
    expect(getStopCount(6)).toBe(1);
    expect(getStopCount(11)).toBe(0);
    expect(getStopCount(15)).toBe(0);

    const counts = new Set<number>();
    for (let id = 5; id <= 60; id += 1) counts.add(getStopCount(id));
    expect([...counts].sort()).toEqual([0, 1, 2, 3]);

    for (const id of [6, 7, 12, 16, 55]) {
      const level = generateLevel(id);
      const stops = level.stops ?? [];
      expect(stops).toHaveLength(getStopCount(id));
      const bodies = new Set(
        level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
      );
      const reachable = new Set(
        level.arrows.flatMap((arrow) =>
          arrowTrack(level, arrow).slice(arrow.path.length).map(cellKey),
        ),
      );
      for (const stop of stops) {
        expect(bodies.has(cellKey(stop))).toBe(false);
        expect(reachable.has(cellKey(stop))).toBe(true);
      }
    }
  }, 20_000);

  test("every generated circle level requires parking and solves with it", () => {
    for (const id of [6, 7, 10, 12, 14, 16, 55, 100]) {
      const level = generateLevel(id);
      const stops = level.stops ?? [];
      expect(stops).toHaveLength(getStopCount(id));
      if (stops.length === 0) continue;
      const stripped = { ...level, stops: [] };
      // A double arrow provides its own alternate solve path, so the
      // parking-required invariant only applies to circle cubes without doubles.
      if (!level.arrows.some((arrow) => arrow.kind === "double")) {
        expect(solveLevelTargets(stripped)).toBeUndefined();
      }
      replaySolution(level);
    }
  }, 20_000);

  test("park cores vary in shape across the campaign", () => {
    const shapes = new Set<string>();
    // The self-passage rule rebuilds boards where a lone park arrow folded
    // over its own body, so the first twin core moved from level 75 to 77;
    // the sweep reaches past it.
    for (let id = 6; id <= 77; id += 1) {
      const level = generateLevel(id);
      if ((level.stops ?? []).length === 0) continue;
      const parkArrows = level.arrows.filter((arrow) =>
        arrow.id.includes("-park-"),
      );
      // A rotor core takes the first circle; with a budget of one it holds
      // the level's only circle and no parking core is placed.
      if (
        parkArrows.length === 0 &&
        level.arrows.some((arrow) => arrow.id.includes("-rotor-"))
      )
        continue;
      shapes.add(
        `${parkArrows.length}:${parkArrows.reduce(
          (cells, arrow) => cells + arrow.path.length,
          0,
        )}`,
      );
    }
    // classic 3:8, cascade 4:9, crossfire 4:11, double/twist 3:10, long 3:11,
    // twin 6:16.
    expect([...shapes].sort()).toEqual([
      "3:10",
      "3:11",
      "3:8",
      "4:11",
      "4:9",
      "6:16",
    ]);
  }, 90_000);

  test("double-circle cores stay deadlocked after one park and open after two", () => {
    let checked = 0;
    for (let id = 6; id <= 80 && checked < 3; id += 1) {
      const level = generateLevel(id);
      if ((level.stops ?? []).length < 2) continue;
      const parkArrows = level.arrows.filter((arrow) =>
        arrow.id.includes("-park-"),
      );
      const parker = parkArrows.find((arrow) => arrow.id.endsWith("-park-p"));
      if (!parker) continue;
      const others = parkArrows.filter((arrow) => arrow.id !== parker.id);
      let state = createGameState(level);
      const first = simulateGameMove(level, state, parker.id);
      if (first.kind !== "paused") continue;
      state = applyMove(level, state, first);
      // Plain arrows may legally sit on the core's vacated route cells, so
      // only core-arrow blockers prove the deadlock is the core's own.
      const blockedByCore = (arrow: (typeof parkArrows)[number]): boolean => {
        const result = simulateGameMove(level, state, arrow.id);
        return (
          result.kind === "blocked" &&
          result.blockerId?.includes("-park-") === true
        );
      };
      if (!others.every(blockedByCore)) continue;
      // The freed arrow is the one the parker itself pins: its lane cell is
      // the parker's head, which only the second park vacates.
      const freed = others.find(
        (arrow) =>
          simulateGameMove(level, state, arrow.id).blockerId === parker.id,
      );
      if (!freed) continue;
      checked += 1;
      const second = simulateGameMove(level, state, parker.id);
      expect(second.kind).toBe("paused");
      state = applyMove(level, state, second);
      const result = simulateGameMove(level, state, freed.id);
      expect(result.kind === "blocked" ? result.blockerId : null).not.toBe(
        parker.id,
      );
    }
    expect(checked).toBeGreaterThan(0);
  }, 60_000);

  test("decorative circles ahead on the parker's track only add pauses", () => {
    let checked = 0;
    for (let id = 6; id <= 120 && checked < 3; id += 1) {
      const level = generateLevel(id);
      if ((level.stops ?? []).length === 0) continue;
      const parker = level.arrows.find((arrow) => arrow.id.endsWith("-park-p"));
      if (!parker) continue;
      const track = arrowTrack(level, parker).map(cellKey);
      const pathKeys = new Set(parker.path.map(cellKey));
      const ahead = (level.stops ?? []).filter(
        (stop) => track.includes(cellKey(stop)) && !pathKeys.has(cellKey(stop)),
      );
      if (ahead.length === 0) continue;
      checked += 1;
      expect(solveLevel({ ...level, stops: [] })).toBeUndefined();
      expect(solveLevel(level)).toBeDefined();
    }
    expect(checked).toBeGreaterThan(0);
  }, 30_000);

  test("generates playable head continuations without changing the seeded edge selection", () => {
    const counts = new Set<number>();
    for (let id = 11; id <= 50; id += 1) {
      const level = generateLevel(id);
      const policies = level.edgePolicies ?? [];
      expect(policies).toEqual(getWrappingEdgePolicies(id));
      counts.add(policies.length / 2);
      if (policies.length === 0) continue;
      expect(
        level.arrows.some((arrow) => {
          const result = simulateCoreMove(level, [arrow.id], arrow.id);
          return (
            result.kind === "exit" &&
            new Set(result.route.map((cell) => cell.face)).size > 1
          );
        }),
      ).toBe(true);
    }
    expect([...counts].sort()).toEqual([0, 1, 2, 3]);
  }, 60_000);
});
