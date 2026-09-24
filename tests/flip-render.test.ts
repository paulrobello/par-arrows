import { describe, expect, test } from "bun:test";
import { flipTurnProgress } from "../src/render/renderer";

const GRID = 8;
const CELL = 2 / GRID;
const DISTANCE = 10 * CELL;

function blockedTravel(progress: number): number {
  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}

describe("flipTurnProgress", () => {
  test("a step-0 flip fires only at the end of an exit", () => {
    expect(flipTurnProgress(0, GRID, DISTANCE, 0)).toBe(0);
    expect(flipTurnProgress(0, GRID, DISTANCE, 0.9)).toBe(0);
    expect(flipTurnProgress(0, GRID, DISTANCE, 1)).toBe(0);
  });

  test("a step-k flip starts turning at its world-space share of travel", () => {
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.39)).toBe(0);
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.4)).toBe(0);
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.46)).toBeCloseTo(0.5);
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.52)).toBeCloseTo(1);
    expect(flipTurnProgress(4, GRID, DISTANCE, 1)).toBe(1);
  });

  test("the fire point scales with grid pitch, not cell count", () => {
    const large = 16;
    const distance = 10 * (2 / large);
    expect(flipTurnProgress(4, large, distance, 0.46)).toBeCloseTo(0.5);
  });

  test("a flip past the motion distance clamps to the end", () => {
    expect(flipTurnProgress(12, GRID, DISTANCE, 0.99)).toBe(0);
  });

  test("a blocked rebound turns the glyph and returns it to 0", () => {
    const distance = 5 * CELL;
    const turns = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 1].map((progress) =>
      flipTurnProgress(2, GRID, distance, blockedTravel(progress)),
    );
    expect(turns[1]).toBe(0);
    expect(turns[3]).toBeGreaterThan(0);
    expect(turns[4]).toBe(1);
    expect(turns[5]).toBeGreaterThan(0);
    expect(turns.at(-1)).toBe(0);
  });
});
