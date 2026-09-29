import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  flipCoreIds,
  generateLevel,
  wormholeFrequency,
  wormholePlan,
} from "../src/content/procedural";
import { createGameState } from "../src/core/game-state";
import {
  flipHeadingProbes,
  interactionRegion,
  proveRegion,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { layoutFingerprint } from "../src/storage";
import { cachedLevel } from "./generated-levels";

describe("wormhole generation", () => {
  test("frequency curve", () => {
    expect(wormholeFrequency(35)).toBe(0);
    expect(wormholeFrequency(36)).toBeCloseTo(0.25);
    expect(wormholeFrequency(90)).toBeCloseTo(0.6);
    expect(wormholeFrequency(150)).toBeCloseTo(0.6);
  });

  // One pass over ids 36-200: every level validates, levels without a
  // wormhole keep their v8 fingerprint, and on flip cubes no wormhole end
  // ever sits in a proven interaction region (nor does any outside arrow's
  // real reach, portal jumps included, enter one).
  test("sweep 36-200", () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("./fixtures/v8-layouts.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    let withHoles = 0;
    for (let id = 36; id <= 200; id += 1) {
      const level = cachedLevel(id);
      const holes = level.wormholes ?? [];
      expect(holes.length).toBeLessThanOrEqual(id >= 50 ? 2 : 1);
      expect(holes.length).toBeLessThanOrEqual(wormholePlan(id));
      expect(validateLevel(level).valid).toBe(true);
      // A planned hole may legitimately drop (placement failure), but the
      // shipped zero-hole layout must then be the exact plan-zero build,
      // which the baseline fingerprint equality below pins.
      if (holes.length === 0) {
        expect(layoutFingerprint(level)).toBe(baseline[id] as string);
        continue;
      }
      withHoles += 1;
      const ends = new Set(
        holes.flatMap((hole) => [cellKey(hole.a), cellKey(hole.b)]),
      );
      const seeds = flipCoreIds(level.arrows);
      if (seeds.length > 0 && id !== 30) {
        const region = interactionRegion(level, [...seeds]);
        expect(region).toBeDefined();
        if (!region) continue;
        expect(proveRegion(level, createGameState(level), region)).toEqual({
          ok: true,
        });
        for (const endKey of ends) {
          expect(region.cells.has(endKey)).toBe(false);
        }
        for (const arrow of level.arrows) {
          if (region.arrowIds.includes(arrow.id)) continue;
          const paths =
            arrow.kind === "double"
              ? [arrow.path, [...arrow.path].reverse()]
              : [arrow.path];
          for (const probe of flipHeadingProbes(level)) {
            for (const path of paths) {
              for (const cell of arrowTrack(probe, { ...arrow, path })) {
                expect(region.cells.has(cellKey(cell))).toBe(false);
              }
            }
          }
        }
      }
    }
    expect(withHoles).toBeGreaterThan(30);
  }, 600_000);

  test("a level carrying a wormhole core needs its wormholes", () => {
    const cored = [...Array(165).keys()]
      .map((i) => i + 36)
      .map(generateLevel)
      .filter((level) =>
        level.arrows.some((arrow) => arrow.id.includes("-wormhole-")),
      );
    expect(cored.length).toBeGreaterThan(10);
    for (const level of cored.slice(0, 6)) {
      expect(solveLevelTargets({ ...level, wormholes: [] })).toBeUndefined();
    }
  }, 600_000);
});
