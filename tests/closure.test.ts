import { expect, test } from "bun:test";
import {
  GATE_TOLERANCE,
  clearShare,
  closureStats,
  deepShareTarget,
  freeCap,
  meetsDepthGate,
  medianTarget,
} from "../src/content/difficulty";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";

const cell = (x: number, y: number) => ({ face: "front" as const, x, y });
const board = (arrows: ArrowDefinition[]): LevelDefinition => ({
  id: 9999,
  title: "closure test",
  gridSize: 6,
  lives: 3,
  arrows,
});

test("free arrows have empty closures", () => {
  const stats = closureStats(
    board([
      { id: "a", path: [cell(0, 0), cell(1, 0)] },
      { id: "b", path: [cell(0, 5), cell(1, 5)] },
    ]),
  );
  expect(stats).toEqual({ median: 0, deepShare: 0, freeShare: 1 });
});

test("a straight chain counts every arrow behind it", () => {
  // c1 east into c2's body, c2 south into c3's body, c3 exits west.
  const stats = closureStats(
    board([
      { id: "c1", path: [cell(0, 0), cell(1, 0), cell(2, 0)] },
      { id: "c2", path: [cell(3, 0), cell(3, 1)] },
      { id: "c3", path: [cell(3, 2), cell(2, 2)] },
    ]),
  );
  // closures: c1 -> {c2, c3} = 2, c2 -> {c3} = 1, c3 -> {} = 0
  expect(stats.median).toBe(1);
  expect(stats.freeShare).toBeCloseTo(1 / 3);
});

test("every body on the route counts, not just the first blocker", () => {
  // r heads east along row 0 through b1 at (2,0) and b2 at (4,0).
  const stats = closureStats(
    board([
      { id: "r", path: [cell(0, 0), cell(1, 0)] },
      { id: "b1", path: [cell(2, 1), cell(2, 0)] },
      { id: "b2", path: [cell(4, 1), cell(4, 0)] },
    ]),
  );
  // r's closure is {b1, b2}; b1 and b2 head north off the board, free.
  expect(stats.median).toBe(0);
  expect(stats.freeShare).toBeCloseTo(2 / 3);
  const deep = closureStats(
    board([
      { id: "r", path: [cell(0, 0), cell(1, 0)] },
      { id: "b1", path: [cell(2, 1), cell(2, 0)] },
      { id: "b2", path: [cell(4, 1), cell(4, 0)] },
      { id: "x", path: [cell(0, 1), cell(1, 1)] },
    ]),
  );
  // x heads east along row 1 through b1's tail (2,1) and b2's tail (4,1).
  expect(deep.freeShare).toBeCloseTo(2 / 4);
});

test("a cycle terminates and each member counts the other", () => {
  // a heads east into b's body; b heads west into a's body.
  const stats = closureStats(
    board([
      { id: "a", path: [cell(0, 2), cell(1, 2)] },
      { id: "b", path: [cell(4, 2), cell(3, 2)] },
    ]),
  );
  expect(stats.median).toBe(1);
  expect(stats.freeShare).toBe(0);
});

test("a shared-tail group is one unit whose routes union", () => {
  const stats = closureStats(
    board([
      { id: "g1", path: [cell(0, 3), cell(1, 3), cell(1, 2)] },
      { id: "g2", path: [cell(0, 3), cell(1, 3), cell(1, 4)] },
      { id: "top", path: [cell(0, 0), cell(1, 0)] },
    ]),
  );
  // g1 heads north through (1,1),(1,0): top's body at (1,0). g2 heads south, free.
  // Units: {g1,g2} closure {top} = 1, top closure 0.
  expect(stats.median).toBe(0.5);
  expect(stats.freeShare).toBeCloseTo(1 / 2);
});

test("a double takes its smaller endpoint closure", () => {
  const stats = closureStats(
    board([
      // head end east hits wall at (3,0); tail end west is clear.
      { id: "d", kind: "double", path: [cell(1, 0), cell(2, 0)] },
      { id: "wall", path: [cell(3, 1), cell(3, 0)] },
    ]),
  );
  expect(stats.freeShare).toBe(1);
});

test("deepShare counts closures of fifteen or more", () => {
  // k_i heads east along row 5 through every later k's body, so the
  // closure of k_i is 16 - i: k0 (16) and k1 (15) are deep.
  const chain: ArrowDefinition[] = Array.from({ length: 17 }, (_, index) => ({
    id: `k${index}`,
    path: [
      { face: "front", x: 2 * index, y: 5 },
      { face: "front", x: 2 * index + 1, y: 5 },
    ],
  }));
  const stats = closureStats({ ...board(chain), gridSize: 40 });
  expect(stats.deepShare).toBeCloseTo(2 / 17);
});

test("curve waypoints", () => {
  expect(clearShare(2)).toBe(1);
  expect(clearShare(60)).toBe(0);
  expect(clearShare(200)).toBe(0);
  expect(medianTarget(11)).toBe(0);
  expect(medianTarget(12)).toBe(2);
  expect(medianTarget(20)).toBe(2);
  expect(medianTarget(40)).toBe(6);
  expect(medianTarget(60)).toBe(12);
  expect(medianTarget(200)).toBe(12);
  expect(deepShareTarget(12)).toBe(0);
  expect(deepShareTarget(20)).toBeCloseTo(0.06);
  expect(deepShareTarget(40)).toBeCloseTo(0.36);
  expect(deepShareTarget(60)).toBeCloseTo(0.48);
  expect(deepShareTarget(200)).toBeCloseTo(0.48);
  expect(freeCap(10)).toBeCloseTo(0.4);
  expect(freeCap(20)).toBeCloseTo(0.26);
  expect(freeCap(40)).toBeCloseTo(0.21);
  expect(freeCap(60)).toBeCloseTo(0.16);
  expect(freeCap(200)).toBeCloseTo(0.16);
});

test("the gate applies a relative tolerance to each term", () => {
  expect(GATE_TOLERANCE).toBe(0.1);
  const median = medianTarget(60) * (1 - GATE_TOLERANCE);
  const deepShare = deepShareTarget(60) * (1 - GATE_TOLERANCE);
  const freeShare = freeCap(60) * (1 + GATE_TOLERANCE);
  const pass = { median, deepShare, freeShare };
  expect(meetsDepthGate(60, pass)).toBe(true);
  expect(meetsDepthGate(60, { ...pass, median: median - 0.01 })).toBe(false);
  expect(meetsDepthGate(60, { ...pass, deepShare: deepShare - 0.001 })).toBe(
    false,
  );
  expect(meetsDepthGate(60, { ...pass, freeShare: freeShare + 0.001 })).toBe(
    false,
  );
});
