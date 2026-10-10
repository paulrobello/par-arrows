import { describe, expect, test } from "bun:test";
import { isAuthoredLevel, mirrorCorePlanned } from "../src/content/procedural";
import { trackKeys } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { cachedLevel } from "./generated-levels";

describe("mirror generation", () => {
  test("entangled mirror cores carry well-formed blockers on their lanes", () => {
    let found = 0;
    for (let id = 56; id <= 200 && found < 3; id += 1) {
      if (isAuthoredLevel(id) || !mirrorCorePlanned(id)) continue;
      const level = cachedLevel(id);
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-xblock-mirror"),
      );
      if (blockers.length === 0) continue; // legitimate fallback ids
      found += 1;
      const coreTrack = new Set(
        level.arrows
          .filter((arrow) => arrow.id.includes("-mirror-"))
          .flatMap((core) => [
            ...core.path.map(cellKey),
            ...trackKeys(level, core),
          ]),
      );
      for (const blocker of blockers) {
        // Blocker ids end "-xblock-mirror<n>", so the "-mirror-" core filter never
        // picks a blocker up as a core arrow.
        expect(blocker.id.includes("-mirror-")).toBe(false);
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
