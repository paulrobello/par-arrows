import { describe, expect, test } from "bun:test";
import { resolvePick, type PickCandidate } from "../src/pick";
import type { Endpoint, MoveTarget } from "../src/core/types";

function target(arrowId: string, endpoint: Endpoint = "head"): MoveTarget {
  return { arrowId, endpoint };
}

function candidate(
  arrowId: string,
  distancePx: number,
  endpoint: Endpoint = "head",
): PickCandidate {
  return { target: target(arrowId, endpoint), distancePx };
}

const safeOnly =
  (...targets: MoveTarget[]) =>
  (value: MoveTarget) =>
    targets.some(
      (target) =>
        target.arrowId === value.arrowId && target.endpoint === value.endpoint,
    );

describe("resolvePick", () => {
  test("returns nothing when the pointer reached no arrow", () => {
    expect(resolvePick([], safeOnly())).toBeUndefined();
  });

  test("returns the only target even when it would collide", () => {
    expect(resolvePick([candidate("a", 12)], safeOnly())).toEqual(target("a"));
  });

  test("prefers the safe endpoint of one double arrow", () => {
    const tail = target("double", "tail");
    expect(
      resolvePick(
        [candidate("double", 2, "head"), candidate("double", 17, "tail")],
        safeOnly(tail),
      ),
    ).toEqual(tail);
  });

  test("picks the closest safe target when several would not collide", () => {
    const far = target("far");
    const near = target("near");
    expect(
      resolvePick(
        [candidate("far", 20), candidate("near", 4)],
        safeOnly(far, near),
      ),
    ).toEqual(near);
  });

  test("falls back to the closest target when every candidate collides", () => {
    expect(
      resolvePick([candidate("far", 19), candidate("near", 3)], safeOnly()),
    ).toEqual(target("near"));
  });

  test("uses a deterministic endpoint for an exact nearby midpoint tie", () => {
    expect(
      resolvePick(
        [candidate("double", 5, "tail"), candidate("double", 5, "head")],
        safeOnly(),
      ),
    ).toEqual(target("double", "head"));
  });

  test("preserves direct-hit order when exact midpoint pickers tie", () => {
    expect(
      resolvePick(
        [candidate("double", 0, "tail"), candidate("double", 0, "head")],
        safeOnly(),
      ),
    ).toEqual(target("double", "tail"));
  });

  test("keeps a direct hit even when a nearby target is safe", () => {
    const safe = target("safe");
    expect(
      resolvePick(
        [candidate("aimed", 0), candidate("safe", 11)],
        safeOnly(safe),
      ),
    ).toEqual(target("aimed"));
  });

  test("prefers a safe direct endpoint when the press landed on both", () => {
    const tail = target("double", "tail");
    expect(
      resolvePick(
        [candidate("double", 0, "head"), candidate("double", 0, "tail")],
        safeOnly(tail),
      ),
    ).toEqual(tail);
  });
});
