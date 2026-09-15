import { describe, expect, test } from "bun:test";
import {
  canonicalFootprint,
  runLengths,
  unfoldedFootprint,
} from "../scripts/campaign-quality";
import type { Cell } from "../src/core/types";

const hook: readonly Cell[] = [
  { face: "front", x: 0, y: 0 },
  { face: "front", x: 1, y: 0 },
  { face: "front", x: 2, y: 0 },
  { face: "front", x: 2, y: 1 },
  { face: "front", x: 1, y: 1 },
];

describe("campaign shape measurements", () => {
  test("recognizes the same path shape when it crosses a face seam", () => {
    const wrapped: readonly Cell[] = [
      { face: "front", x: 2, y: 1 },
      { face: "front", x: 3, y: 1 },
      { face: "right", x: 0, y: 1 },
      { face: "right", x: 0, y: 2 },
    ];
    expect(unfoldedFootprint(wrapped, 4)).toBe(
      canonicalFootprint(hook.slice(0, 4)),
    );
    expect(unfoldedFootprint([...wrapped].reverse(), 4)).toBe(
      unfoldedFootprint(wrapped, 4),
    );
  });
  test("counts translated, rotated, mirrored, and reversed stamps as one footprint", () => {
    const rotated = hook.map(
      (cell): Cell => ({ face: "top", x: 8 - cell.y, y: 4 + cell.x }),
    );
    const mirrored = hook.map(
      (cell): Cell => ({ face: "left", x: 5 - cell.x, y: 2 + cell.y }),
    );
    expect(canonicalFootprint(rotated)).toBe(canonicalFootprint(hook));
    expect(canonicalFootprint(mirrored.reverse())).toBe(
      canonicalFootprint(hook),
    );
    expect(canonicalFootprint([...hook].reverse())).toBe(
      canonicalFootprint(hook),
    );
  });

  test("distinguishes footprints and preserves uneven run lengths", () => {
    const extended: readonly Cell[] = [...hook, { face: "front", x: 0, y: 1 }];
    expect(canonicalFootprint(extended)).not.toBe(canonicalFootprint(hook));
    expect(runLengths(hook)).toEqual([2, 1, 1]);
    expect(runLengths(extended)).toEqual([2, 1, 2]);
    expect(
      canonicalFootprint([
        { face: "front", x: 0, y: 0 },
        { face: "top", x: 0, y: 0 },
      ]),
    ).toBeUndefined();
  });
});
