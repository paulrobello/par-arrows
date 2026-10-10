import { describe, expect, test } from "bun:test";
import { isAuthoredLevel, leapCorePlanned } from "../src/content/procedural";
import { trackKeys } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { cachedLevel } from "./generated-levels";

describe("leap generation", () => {
  test("entangled leap cores carry well-formed blockers on their lanes", () => {
    let found = 0;
    for (let id = 61; id <= 200 && found < 3; id += 1) {
      if (isAuthoredLevel(id) || !leapCorePlanned(id)) continue;
      const level = cachedLevel(id);
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-xblock-leap"),
      );
      if (blockers.length === 0) continue; // legitimate fallback ids
      found += 1;
      const coreTrack = new Set(
        level.arrows
          .filter((arrow) => arrow.id.includes("-leap-"))
          .flatMap((core) => [
            ...core.path.map(cellKey),
            ...trackKeys(level, core),
          ]),
      );
      for (const blocker of blockers) {
        // Blocker ids end "-xblock-leap<n>", so the "-leap-" core filter never
        // picks a blocker up as a core arrow.
        expect(blocker.id.includes("-leap-")).toBe(false);
        expect(blocker.path.length).toBeGreaterThanOrEqual(3);
        expect(blocker.path.length).toBeLessThanOrEqual(8);
        expect(blocker.path.some((cell) => coreTrack.has(cellKey(cell)))).toBe(
          true,
        );
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  }, 600_000);
});
