import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  flipCoreIds,
  generateLevel,
  isAuthoredLevel,
  wormholeFrequency,
  wormholePlan,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import {
  flipHeadingProbes,
  hasStrandingState,
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
      // The actual engine checks the sampled contact anywhere on the exit
      // corridor. No fixed adjacent-to-B body layout is part of the contract.
      for (const hole of holes) {
        const second = hole.id === "w2";
        const coreBoard = {
          ...level,
          stops: [],
          directionals: [],
          fragile: [],
          locks: [],
          mirrors: [],
          leaps: [],
          wormholes: [hole],
          arrows: level.arrows.filter(
            (a) =>
              a.id.includes("-wormhole-") && a.id.endsWith("-2") === second,
          ),
        };
        const suffix = second ? "-2" : "";
        const portal = coreBoard.arrows.find((a) =>
          a.id.endsWith(`-portal${suffix}`),
        )!;
        const far = coreBoard.arrows.find((a) =>
          a.id.endsWith(`-far${suffix}`),
        )!;
        expect(portal).toBeDefined();
        expect(far).toBeDefined();
        const initial = createGameState(coreBoard);
        const blocked = simulateMove(coreBoard, initial, portal.id);
        expect(blocked.kind).toBe("blocked");
        expect(blocked.blockerId).toBe(far.id);
        expect(blocked.portals).toHaveLength(1);
        const first = simulateMove(coreBoard, initial, far.id);
        expect(first.kind).toBe("exit");
        const jump = simulateMove(
          coreBoard,
          applyMove(coreBoard, initial, first),
          portal.id,
        );
        expect(jump.kind).toBe("exit");
        expect(jump.portals).toHaveLength(1);
        expect(
          solveLevelTargets({ ...coreBoard, wormholes: [] }),
        ).toBeUndefined();
        expect(hasStrandingState(coreBoard)).toBe(false);
      }
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

  test("entangled wormhole cores carry well-formed blockers on their lanes", () => {
    let found = 0;
    for (let id = 36; id <= 200 && found < 3; id += 1) {
      if (isAuthoredLevel(id) || wormholePlan(id) === 0) continue;
      const level = cachedLevel(id);
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-xblock-wormhole"),
      );
      if (blockers.length === 0) continue; // legitimate fallback ids
      found += 1;
      const coreTrack = new Set(
        level.arrows
          .filter((arrow) => arrow.id.includes("-wormhole-"))
          .flatMap((core) => [
            ...core.path.map(cellKey),
            ...arrowTrack(level, core).map(cellKey),
          ]),
      );
      for (const blocker of blockers) {
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
