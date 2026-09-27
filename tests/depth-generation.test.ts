import { expect, test } from "bun:test";
import { cachedLevel } from "./generated-levels";
import {
  depthStats,
  depthTarget,
  CHAIN_TOLERANCE,
  SHARE_TOLERANCE,
} from "../src/content/difficulty";
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import { layoutFingerprint } from "../src/storage";

test("every generated id 6-200 meets its depth gate within tolerance", () => {
  for (let id = 6; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const stats = depthStats(level);
    const target = depthTarget(id);
    expect(stats.chain).toBeGreaterThanOrEqual(
      target.minChain - CHAIN_TOLERANCE,
    );
    expect(stats.forcedShare).toBeGreaterThanOrEqual(
      target.minForced - SHARE_TOLERANCE,
    );
  }
}, 600_000);

test("generation is deterministic", () => {
  expect(layoutFingerprint(generateLevel(40))).toBe(
    layoutFingerprint(generateLevel(40)),
  );
  expect(layoutFingerprint(generateLevel(120))).toBe(
    layoutFingerprint(generateLevel(120)),
  );
});
