import { expect, test } from "bun:test";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import {
  chainStats,
  depthStats,
  depthTarget,
  CHAIN_TOLERANCE,
  SHARE_TOLERANCE,
} from "../src/content/difficulty";

const cell = (x: number, y: number) => ({ face: "front" as const, x, y });
const board = (arrows: ArrowDefinition[]): LevelDefinition => ({
  id: 9999,
  title: "metric test",
  gridSize: 4,
  lives: 3,
  arrows,
});

test("a free cube has chain 1, zero shares, peel 1", () => {
  const level = board([
    { id: "f1", path: [cell(0, 0), cell(1, 0)] },
    { id: "f2", path: [cell(0, 3), cell(1, 3)] },
  ]);
  expect(chainStats(level)).toEqual({
    chain: 1,
    forcedShare: 0,
    blockedShare: 0,
  });
  expect(depthStats(level)).toEqual({
    chain: 1,
    forcedShare: 0,
    blockedShare: 0,
    peel: 1,
  });
});

test("a three-arrow transitive chain scores exactly its depth", () => {
  // a1 heads east into a2's body; a2 heads north into a3's body; a3 exits west, clear.
  const level = board([
    { id: "a1", path: [cell(0, 0), cell(1, 0), cell(2, 0)] }, // blocked by a2 at (3,0)
    { id: "a2", path: [cell(3, 0), cell(3, 1)] }, // blocked by a3 at (3,2)
    { id: "a3", path: [cell(3, 2), cell(2, 2)] }, // exits west, clear
  ]);
  expect(chainStats(level)).toEqual({
    chain: 3,
    forcedShare: 2 / 3,
    blockedShare: 2 / 3,
  });
  expect(depthStats(level).peel).toBe(3);
});

test("a double with both halves blocked is one unit with two edges", () => {
  const level = board([
    { id: "d1", path: [cell(1, 0), cell(2, 0)], kind: "double" },
    { id: "b1", path: [cell(3, 0), cell(3, 1)] },
    { id: "t1", path: [cell(0, 0), cell(0, 1)] },
  ]);
  expect(chainStats(level)).toEqual({
    chain: 2,
    forcedShare: 1 / 3,
    blockedShare: 1 / 3,
  });
});

test("depthTarget curve waypoints", () => {
  expect(depthTarget(4)).toEqual({ minChain: 0, minForced: 0 });
  expect(depthTarget(6)).toEqual({ minChain: 2, minForced: 0.2 });
  expect(depthTarget(12)).toEqual({ minChain: 4, minForced: 0.3 });
  expect(depthTarget(26)).toEqual({ minChain: 5, minForced: 0.39 });
  expect(depthTarget(40)).toEqual({ minChain: 5, minForced: 0.48 });
  expect(depthTarget(41)).toEqual({ minChain: 5, minForced: 0.48 });
  expect(depthTarget(70)).toEqual({ minChain: 5, minForced: 0.48 });
  expect(depthTarget(120)).toEqual({ minChain: 5, minForced: 0.48 });
});

test("tolerance constants", () => {
  expect(CHAIN_TOLERANCE).toBe(1);
  expect(SHARE_TOLERANCE).toBe(0.05);
});
