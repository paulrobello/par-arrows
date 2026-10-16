import { expect, test } from "bun:test";
import { connectMechanicBody } from "../src/content/mechanic-body";
import { Rng } from "../src/content/procedural";
import { cellKey } from "../src/core/topology";
import type { Cell, LevelDefinition } from "../src/core/types";
import captured from "./fixtures/mechanic-body-connectors.json";

interface Fixture {
  gridSize: number;
  goal: Cell;
  seed: number;
  path: string[] | null;
  next: number;
}

const fixtures = captured as Fixture[];
const start: Cell = { face: "front", x: 0, y: 0 };
const board = (gridSize: number): LevelDefinition => ({
  id: 77,
  title: "Connector fixture",
  gridSize,
  lives: 5,
  arrows: [],
});
const barrier = (gridSize: number): Set<string> =>
  new Set(
    Array.from({ length: gridSize }, (_, y) =>
      cellKey({ face: "front", x: Math.floor(gridSize / 2), y }),
    ),
  );

// Captured from e02037f's string-keyed BFS before optimization. Include seam
// crossings, sampled detours, and searches that exceed the 30-cell limit.
// The next draw also locks the exploration order on unsuccessful searches.
test("connector retains seeded paths and random-stream positions on both grid sizes", () => {
  for (const fixture of fixtures) {
    const rng = new Rng(fixture.seed);
    const path = connectMechanicBody(
      board(fixture.gridSize),
      rng,
      start,
      fixture.goal,
      barrier(fixture.gridSize),
    );
    expect(path?.map(cellKey) ?? null).toEqual(fixture.path);
    expect(rng.next()).toBe(fixture.next);
  }
});

test("connector never shares reservations or visited state between searches", () => {
  const level = board(4);
  const goal: Cell = { face: "back", x: 3, y: 3 };
  const original = connectMechanicBody(
    level,
    new Rng(1),
    start,
    goal,
    barrier(4),
  );
  expect(original).toBeDefined();
  expect(
    connectMechanicBody(
      level,
      new Rng(1),
      start,
      goal,
      new Set([cellKey(goal)]),
    ),
  ).toBeUndefined();
  expect(
    connectMechanicBody(level, new Rng(1), start, goal, barrier(4)),
  ).toEqual(original);
});

test("connector returned cells cannot mutate the shared surface graph", () => {
  const level = board(4);
  const goal: Cell = { face: "back", x: 3, y: 3 };
  const path = connectMechanicBody(level, new Rng(37), start, goal, barrier(4));
  expect(path).toBeDefined();
  const expected = path?.map(cellKey);
  const cell = path?.[1];
  if (!cell) throw new Error("Expected a seam-crossing path");
  Object.assign(cell, { x: -99, y: -99 });
  expect(
    connectMechanicBody(level, new Rng(37), start, goal, barrier(4))?.map(
      cellKey,
    ),
  ).toEqual(expected);
});

test("connector may start at a reserved contact but cannot enter another reservation", () => {
  const level = board(4);
  const goal: Cell = { face: "front", x: 1, y: 0 };
  const path = connectMechanicBody(
    level,
    new Rng(64),
    start,
    goal,
    new Set([cellKey(start)]),
  );
  expect(path?.[0]).toEqual(start);
  expect(path?.at(-1)).toEqual(goal);
  expect(
    connectMechanicBody(
      level,
      new Rng(64),
      start,
      goal,
      new Set([cellKey(goal)]),
    ),
  ).toBeUndefined();
});
