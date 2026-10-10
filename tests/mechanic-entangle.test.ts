import { expect, test } from "bun:test";
import {
  flipCoreIds,
  isAuthoredLevel,
  rotorCoreIds,
} from "../src/content/procedural";
import { createGameState } from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import {
  interactionRegion,
  proveRegion,
  solveLevelTargets,
} from "../src/core/validation";
import { cachedLevel } from "./generated-levels";

const trackKeys = (level: LevelDefinition, arrow: ArrowDefinition): string[] =>
  arrowTrack(
    level,
    arrow.kind === "double"
      ? { ...arrow, path: [...arrow.path].reverse() }
      : arrow,
  ).map(cellKey);

const LANE_MARKERS = {
  wormhole: "-wormhole-",
  fragile: "-fragile-",
  lock: "-lock-",
  mirror: "-mirror-",
  leap: "-leap-",
} as const;

// Flip, wormhole and fragile blockers have grown bodies; other mechanic blockers are two-cell arrows whose tail sits on their own
// core's body or track, and the assembled level stays solvable. Flip blockers
// are absorbed into the core's interaction region; rotor cores carry none (a
// multi-leg certificate the removal graph cannot express).
test("entangled blockers sit on their core lanes and keep the level solvable", () => {
  const seen: Record<string, number> = {};
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    let anyBlockers = false;
    const check = (
      kind: string,
      core: ArrowDefinition[],
      blockers: ArrowDefinition[],
    ): void => {
      if (blockers.length === 0) return;
      anyBlockers = true;
      seen[kind] = (seen[kind] ?? 0) + 1;
      const lane = new Set(
        core.flatMap((arrow) => [
          ...arrow.path.map(cellKey),
          ...trackKeys(level, arrow),
        ]),
      );
      for (const blocker of blockers) {
        if (kind === "flip" || kind === "wormhole") {
          expect(blocker.path.length).toBeGreaterThanOrEqual(3);
          expect(blocker.path.length).toBeLessThanOrEqual(10);
        } else if (kind === "fragile") {
          expect(blocker.path.length).toBeGreaterThanOrEqual(3);
          expect(blocker.path.length).toBeLessThanOrEqual(8);
        } else expect(blocker.path.length).toBe(2);
        expect(
          blocker.path.some((cell) => lane.has(cellKey(cell))),
          `${kind} blocker ${blocker.id} body off its core lanes`,
        ).toBe(true);
      }
    };

    const flipSeeds = new Set(flipCoreIds(level.arrows));
    const flipCore = level.arrows.filter((arrow) => flipSeeds.has(arrow.id));
    const flipBlockers = level.arrows.filter((arrow) =>
      arrow.id.includes("-flipb-"),
    );
    check("flip", flipCore, flipBlockers);
    if (flipBlockers.length > 0) {
      const region = interactionRegion(
        level,
        flipCore.map((arrow) => arrow.id),
      );
      expect(region, `level ${id} flip region`).toBeDefined();
      if (region) {
        expect(proveRegion(level, createGameState(level), region)).toEqual({
          ok: true,
        });
        expect(region.arrowIds).toEqual(
          expect.arrayContaining(flipBlockers.map((b) => b.id)),
        );
      }
    }

    const rotorSeeds = new Set(rotorCoreIds(level.arrows));
    const rotorCore = level.arrows.filter((arrow) => rotorSeeds.has(arrow.id));
    if (rotorCore.length > 0) {
      expect(
        level.arrows.filter((arrow) => arrow.id.includes("-xblock-rotor")),
        `level ${id} rotor cores never entangle`,
      ).toEqual([]);
      const region = interactionRegion(
        level,
        rotorCore.map((arrow) => arrow.id),
      );
      expect(region, `level ${id} rotor region`).toBeDefined();
      if (region)
        expect(region.arrowIds).toEqual(
          expect.arrayContaining(rotorCore.map((arrow) => arrow.id)),
        );
    }

    for (const [kind, marker] of Object.entries(LANE_MARKERS)) {
      const core = level.arrows.filter(
        (arrow) => arrow.id.includes(marker) && !arrow.id.includes("-xblock-"),
      );
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes(`-xblock-${kind}`),
      );
      if (blockers.length > 0)
        expect(
          core.length,
          `level ${id} ${kind} blockers without a core`,
        ).toBeGreaterThan(0);
      check(kind, core, blockers);
    }
    if (anyBlockers)
      expect(solveLevelTargets(level), `level ${id} solvable`).toBeDefined();
  }
  for (const kind of ["flip", ...Object.keys(LANE_MARKERS)])
    expect(seen[kind] ?? 0, `${kind} entangled levels`).toBeGreaterThan(0);
}, 600_000);
