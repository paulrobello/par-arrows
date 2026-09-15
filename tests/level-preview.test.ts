import { describe, expect, test } from "bun:test";
import {
  parseLevelPreview,
  resolveLevelPreview,
} from "../src/content/level-preview";
import { MAX_LEVEL_ID } from "../src/content/procedural";
import type { EdgePolicyDefinition } from "../src/core/types";

function policies(count: number): readonly EdgePolicyDefinition[] {
  return Array.from({ length: count * 2 }, (_, index) => ({
    face: index % 2 === 0 ? "front" : "right",
    edge: index % 2 === 0 ? "east" : "west",
    policy: "continue",
    neighbor: {
      face: index % 2 === 0 ? "right" : "front",
      entering: index % 2 === 0 ? "east" : "west",
    },
  })) as readonly EdgePolicyDefinition[];
}

describe("test-level URL previews", () => {
  test("ignores unrelated parameters and test-only links", () => {
    expect(parseLevelPreview("?test=1&source=manual")).toEqual({
      active: false,
    });
    expect(parseLevelPreview("?source=manual&source=other")).toEqual({
      active: false,
    });
  });

  test("parses exact levels and case-insensitive wrap aliases", () => {
    expect(parseLevelPreview("?level=25&test=1")).toEqual({
      active: true,
      requestedLevelId: 25,
    });
    for (const feature of ["wrap", "WRAPPING", "WrapAround"]) {
      expect(parseLevelPreview(`?feature=${feature}`)).toMatchObject({
        active: true,
        feature: "wrap",
      });
    }
  });

  test("rejects unsupported features, malformed selectors, duplicates and conflicts", () => {
    for (const search of [
      "?feature=unknown",
      "?feature=",
      "?level=1.5",
      "?level=",
      "?level=0",
      `?level=${MAX_LEVEL_ID + 1}`,
      "?wraps=-1",
      "?wraps=",
      "?wraps=4",
      "?level=2&level=3",
      "?feature=wrap&feature=wrapping",
      "?wraps=1&wraps=2",
      "?feature=wrap&wraps=0",
    ]) {
      const parsed = parseLevelPreview(search);
      expect(parsed.active).toBe(true);
      expect(parsed.error).toBeDefined();
    }
  });

  test("loads exact level selectors without scanning policy counts", () => {
    let calls = 0;
    const exact = resolveLevelPreview(
      parseLevelPreview("?level=25"),
      undefined,
      () => {
        calls += 1;
        return [];
      },
    );
    expect(exact.resolvedLevelId).toBe(25);
    expect(calls).toBe(0);
  });

  test("filters by physical wrap count from the requested level", () => {
    const calls: number[] = [];
    const getPolicies = (id: number): readonly EdgePolicyDefinition[] => {
      calls.push(id);
      return policies(id === 12 ? 1 : id === 15 ? 2 : 0);
    };
    const wrap = resolveLevelPreview(
      parseLevelPreview("?level=10&feature=wrap"),
      10,
      getPolicies,
    );
    expect(wrap.resolvedLevelId).toBe(12);
    expect(calls).toEqual([11, 12]);

    calls.length = 0;
    const exactCount = resolveLevelPreview(
      parseLevelPreview("?level=12&wraps=2"),
      12,
      getPolicies,
    );
    expect(exactCount.resolvedLevelId).toBe(15);
    expect(calls).toEqual([12, 13, 14, 15]);
  });

  test("keeps wrap-free searches at the requested starting level", () => {
    const calls: number[] = [];
    const selected = resolveLevelPreview(
      parseLevelPreview("?level=8&wraps=0"),
      8,
      (id) => {
        calls.push(id);
        return policies(id === 9 ? 1 : 0);
      },
    );
    expect(selected.resolvedLevelId).toBe(8);
    expect(calls).toEqual([8]);
  });

  test("bounds filtered searches to 1000 ids and stays within MAX_LEVEL_ID", () => {
    let scanned = 0;
    const noMatch = resolveLevelPreview(
      parseLevelPreview("?feature=wrap"),
      1,
      () => {
        scanned += 1;
        return [];
      },
    );
    expect(noMatch.resolvedLevelId).toBeUndefined();
    expect(noMatch.error).toContain("1000 levels");
    expect(scanned).toBe(1_000);

    let calls = 0;
    const nearMaximum = resolveLevelPreview(
      parseLevelPreview("?feature=wrap"),
      MAX_LEVEL_ID,
      () => {
        calls += 1;
        return [];
      },
    );
    expect(nearMaximum.resolvedLevelId).toBeUndefined();
    expect(nearMaximum.error).toContain("1000 levels");
    expect(calls).toBe(1);
  });
});
