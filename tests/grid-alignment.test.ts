import { describe, expect, test } from "bun:test";
import { gridLineOffsets } from "../src/render/renderer";

describe("grid line alignment", () => {
  test("lane alignment draws interior cell boundaries", () => {
    expect(gridLineOffsets(4, "lane")).toEqual([1, 2, 3]);
  });

  test("line alignment draws through cell centers", () => {
    expect(gridLineOffsets(4, "line")).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  test("a single-cell grid has no lane lines and one centered line", () => {
    expect(gridLineOffsets(1, "lane")).toEqual([]);
    expect(gridLineOffsets(1, "line")).toEqual([0.5]);
  });
});
