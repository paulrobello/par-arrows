import { describe, expect, test } from "bun:test";
import { flipTurnProgress } from "../src/render/renderer";

function blockedTravel(progress: number): number {
  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}

describe("flipTurnProgress", () => {
  test("a step-0 flip fires only at the end of an exit", () => {
    expect(flipTurnProgress(0, 8, 0)).toBe(0);
    expect(flipTurnProgress(0, 8, 0.9)).toBe(0);
    expect(flipTurnProgress(0, 8, 1)).toBe(0);
    expect(flipTurnProgress(8, 8, 1)).toBe(0);
  });

  test("a step-k flip starts turning at k / distance", () => {
    expect(flipTurnProgress(2, 8, 0.25)).toBe(0);
    expect(flipTurnProgress(2, 8, 0.24)).toBe(0);
    expect(flipTurnProgress(2, 8, 0.31)).toBeCloseTo(0.5);
    expect(flipTurnProgress(2, 8, 0.37)).toBeCloseTo(1);
    expect(flipTurnProgress(2, 8, 1)).toBe(1);
  });

  test("a flip past the motion distance clamps to the end", () => {
    expect(flipTurnProgress(12, 8, 0.99)).toBe(0);
  });

  test("a blocked rebound turns the glyph back to 0", () => {
    const turns = [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1].map((progress) =>
      flipTurnProgress(1, 4, blockedTravel(progress)),
    );
    expect(turns[0]).toBe(0);
    expect(turns[3]).toBe(1);
    expect(turns.at(-1)).toBe(0);
  });
});
