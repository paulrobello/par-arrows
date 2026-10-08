import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  flipCorePlanned,
  generateLevel,
  getStopCount,
  isAuthoredLevel,
  ROTOR_PATTERNS,
  rotorCoreFrequency,
  rotorCoreIds,
  rotorCorePlanned,
} from "../src/content/procedural";
import { overlappingArrowIds } from "../src/core/overlap";
import { createGameState } from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type {
  Cell,
  DirectionalSpotDefinition,
  LevelDefinition,
} from "../src/core/types";
import {
  flipHeadingProbes,
  flipInterest,
  hasStrandingState,
  interactionRegion,
  proveRegion,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { layoutFingerprint } from "../src/storage";
import { cachedLevel } from "./generated-levels";

const FIRST_ID = 41;
const LAST_ID = 200;

// PRE_ROTOR parity retired at v11: the version bump re-rolls every id; the
// fixture pins determinism.

/** The rotor core alone: its arrows, its rotor and its circle. */
function coreBoard(level: LevelDefinition): LevelDefinition {
  const ids = new Set(rotorCoreIds(level.arrows));
  const arrows = level.arrows.filter((arrow) => ids.has(arrow.id));
  const reach = new Set<string>();
  for (const probe of flipHeadingProbes(level)) {
    for (const arrow of arrows) {
      for (const cell of arrowTrack(probe, arrow)) reach.add(cellKey(cell));
    }
  }
  const { stops: _stops, wormholes: _holes, ...bare } = level;
  const stops = (level.stops ?? []).filter((stop) => reach.has(cellKey(stop)));
  return {
    ...bare,
    arrows,
    directionals: (level.directionals ?? []).filter(
      (spot) => spot.kind === "rotor",
    ),
    ...(stops.length > 0 ? { stops } : {}),
  };
}

function frozen(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    directionals: (level.directionals ?? []).map((spot) =>
      spot.kind === "rotor" ? { cell: spot.cell, heading: spot.heading } : spot,
    ),
  };
}

describe("rotor generation", () => {
  test("frequency ramps from level 41 to 90 and holds", () => {
    expect(rotorCoreFrequency(40)).toBe(0);
    expect(rotorCoreFrequency(41)).toBeCloseTo(0.25);
    expect(rotorCoreFrequency(70)).toBeCloseTo(0.25 + (0.3 * 29) / 49);
    expect(rotorCoreFrequency(90)).toBeCloseTo(0.55);
    expect(rotorCoreFrequency(500)).toBeCloseTo(0.55);
    expect(ROTOR_PATTERNS.map((pattern) => pattern.name)).toEqual([
      "cycle-gate",
      "lane-window",
    ]);
  });

  // The plan draws only on ids with no flip plan and a circle to give the
  // core, so the ramp is measured over those. Measured shares: 5/13 over
  // 41-90 (ramp mean 0.37), 14/22 over 91-145 and 12/24 over 146-200
  // (ramp 0.55).
  test("plan share tracks the ramp on sampled bands", () => {
    for (const [from, to] of [
      [41, 90],
      [91, 145],
      [146, 200],
    ] as const) {
      let eligible = 0;
      let planned = 0;
      let expected = 0;
      for (let id = from; id <= to; id += 1) {
        if (isAuthoredLevel(id) || flipCorePlanned(id) || getStopCount(id) < 1)
          continue;
        eligible += 1;
        expected += rotorCoreFrequency(id);
        if (rotorCorePlanned(id)) planned += 1;
      }
      expect(eligible).toBeGreaterThan(10);
      expect(Math.abs(planned / eligible - expected / eligible)).toBeLessThan(
        0.2,
      );
    }
    for (let id = 2; id < FIRST_ID; id += 1) {
      expect(rotorCorePlanned(id)).toBe(false);
    }
  });

  // A rotor core that never parks cannot need its rotor to turn: frozen, it
  // is a static spot, and a cleared route stays clear. Each pattern parks.
  test("every pattern needs its rotor at all four rotations", () => {
    const turn = (dx: number, dy: number, rotation: number): [number, number] =>
      [
        [dx, dy],
        [-dy, dx],
        [-dx, -dy],
        [dy, -dx],
      ][rotation] as [number, number];
    const cycle = ["east", "south", "west", "north"] as const;
    for (const pattern of ROTOR_PATTERNS) {
      for (let rotation = 0; rotation < 4; rotation += 1) {
        const place = ([dx, dy]: readonly [number, number]): Cell => {
          const [x, y] = turn(dx, dy, rotation);
          return { face: "front", x: 8 + x, y: 8 + y };
        };
        const spot: DirectionalSpotDefinition = {
          cell: place([0, 0]),
          heading: cycle[
            (cycle.indexOf(pattern.heading as (typeof cycle)[number]) +
              rotation) %
              4
          ] as (typeof cycle)[number],
          kind: "rotor",
        };
        const core: LevelDefinition = {
          id: 904,
          title: pattern.name,
          gridSize: 17,
          lives: 3,
          arrows: pattern.arrows.map((entry) => ({
            id: entry.name,
            path: entry.cells.map(place),
          })),
          directionals: [spot],
          stops: [place(pattern.stop)],
        };
        expect(validateLevel(core).valid).toBe(true);
        expect(solveLevelTargets(core)).toBeDefined();
        expect(solveLevelTargets(frozen(core))).toBeUndefined();
        expect(hasStrandingState(core)).toBe(false);
        expect(flipInterest(core)).toBe(true);
      }
    }
  });

  // One pass over ids 41-200 (levels shared with the other generation
  // sweeps). Every level validates; caps hold; a level carries rotors only
  // when it planned one and never alongside a flip spot; each rotor region
  // proves, keeps wormhole ends and group tracks out, and no outside reach
  // enters it; each core needs its rotor on its own board; and ids without a
  // rotor core keep their pre-rotor fixture fingerprint.
  test("sweep 41-200", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/v8-layouts.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    const rotorLevels: number[] = [];
    for (let id = FIRST_ID; id <= LAST_ID; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      expect(validateLevel(level).valid, `level ${id}`).toBe(true);
      const spots = level.directionals ?? [];
      const rotors = spots.filter((spot) => spot.kind === "rotor");
      const seeds = rotorCoreIds(level.arrows);
      if (seeds.length === 0) {
        expect(rotors, `level ${id}`).toEqual([]);
        expect(layoutFingerprint(level), `level ${id}`).toBe(
          fixture[id] as string,
        );
        continue;
      }
      rotorLevels.push(id);
      expect(rotorCorePlanned(id)).toBe(true);
      expect(rotors.length).toBeGreaterThanOrEqual(1);
      expect(rotors.length).toBeLessThanOrEqual(2);
      expect(spots.some((spot) => spot.kind === "flip")).toBe(false);
      const patterns = new Set(
        seeds.map((seed) => seed.split("-rotor-")[1]?.split("-")[0]),
      );
      expect(patterns.size).toBe(1);

      const region = interactionRegion(level, seeds);
      expect(region, `level ${id}`).toBeDefined();
      if (!region) continue;
      expect(proveRegion(level, createGameState(level), region)).toEqual({
        ok: true,
      });
      for (const hole of level.wormholes ?? []) {
        expect(region.cells.has(cellKey(hole.a))).toBe(false);
        expect(region.cells.has(cellKey(hole.b))).toBe(false);
      }
      for (const arrow of level.arrows) {
        if (region.arrowIds.includes(arrow.id)) {
          expect(overlappingArrowIds(level, arrow.id)).toHaveLength(1);
          continue;
        }
        const grouped = overlappingArrowIds(level, arrow.id).length > 1;
        const paths =
          arrow.kind === "double"
            ? [arrow.path, [...arrow.path].reverse()]
            : [arrow.path];
        for (const probe of flipHeadingProbes(level)) {
          for (const path of paths) {
            for (const cell of arrowTrack(probe, { ...arrow, path })) {
              expect(
                region.cells.has(cellKey(cell)),
                `level ${id} ${arrow.id}${grouped ? " (group)" : ""}`,
              ).toBe(false);
            }
          }
        }
      }

      const core = coreBoard(level);
      expect(core.stops?.length ?? 0).toBeGreaterThan(0);
      expect(solveLevelTargets(core)).toBeDefined();
      expect(solveLevelTargets(frozen(core))).toBeUndefined();
      expect(solveLevelTargets(level)).toBeDefined();
    }
    expect(rotorLevels.length).toBeGreaterThan(0);
  }, 600_000);

  test("rotor levels generate deterministically and within budget", () => {
    for (const id of [42, 58, 111, 196]) {
      const started = performance.now();
      const level = generateLevel(id);
      expect(performance.now() - started).toBeLessThan(2000);
      expect(rotorCoreIds(level.arrows).length).toBeGreaterThan(0);
      expect(layoutFingerprint(generateLevel(id))).toBe(
        layoutFingerprint(level),
      );
    }
  }, 60_000);
});
