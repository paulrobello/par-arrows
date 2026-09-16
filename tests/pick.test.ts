import { describe, expect, test } from "bun:test";
import { resolvePick } from "../src/pick";

const safeOnly =
  (...ids: string[]) =>
  (arrowId: string) =>
    ids.includes(arrowId);

describe("resolvePick", () => {
  test("returns nothing when the pointer reached no arrow", () => {
    expect(resolvePick([], safeOnly())).toBeUndefined();
  });

  test("returns the only candidate even when it would collide", () => {
    expect(resolvePick([{ arrowId: "a", distancePx: 12 }], safeOnly())).toBe(
      "a",
    );
  });

  test("prefers a safe arrow over a closer colliding one", () => {
    expect(
      resolvePick(
        [
          { arrowId: "blocked", distancePx: 2 },
          { arrowId: "safe", distancePx: 17 },
        ],
        safeOnly("safe"),
      ),
    ).toBe("safe");
  });

  test("picks the closest safe arrow when several would not collide", () => {
    expect(
      resolvePick(
        [
          { arrowId: "far", distancePx: 20 },
          { arrowId: "near", distancePx: 4 },
        ],
        safeOnly("far", "near"),
      ),
    ).toBe("near");
  });

  test("falls back to the closest arrow when every candidate collides", () => {
    expect(
      resolvePick(
        [
          { arrowId: "far", distancePx: 19 },
          { arrowId: "near", distancePx: 3 },
        ],
        safeOnly(),
      ),
    ).toBe("near");
  });

  test("keeps the supplied order when distances tie", () => {
    expect(
      resolvePick(
        [
          { arrowId: "first", distancePx: 0 },
          { arrowId: "second", distancePx: 0 },
        ],
        safeOnly(),
      ),
    ).toBe("first");
  });

  test("prefers a safe direct hit over a safe nearby arrow", () => {
    expect(
      resolvePick(
        [
          { arrowId: "direct", distancePx: 0 },
          { arrowId: "nearby", distancePx: 9 },
        ],
        safeOnly("direct", "nearby"),
      ),
    ).toBe("direct");
  });
});
