import { describe, expect, test } from "bun:test";
import { generateLevel } from "../src/content/procedural";
import { overlappingArrowIds } from "../src/core/overlap";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type {
  ArrowDefinition,
  GameState,
  LevelDefinition,
} from "../src/core/types";
import {
  flipHeadingProbes,
  type InteractionRegion,
  interactionRegion,
  proveRegion,
  solveLevelTargets,
} from "../src/core/validation";

const FIRST_ID = 31;
const LAST_ID = 120;
// Directional spots first appear on generated cubes at level 21.
const FIRST_SPOT_ID = 21;

interface FlipSample {
  readonly id: number;
  readonly level: LevelDefinition;
  readonly seeds: readonly string[];
  readonly region: InteractionRegion | undefined;
}

// Generating ids 21-120 takes about 40 seconds, so every test shares one
// sweep. It fills lazily inside the first test that needs it (not a hook,
// whose default timeout is too short for it).
let levels: readonly LevelDefinition[] | undefined;
const generatedLevels = (): readonly LevelDefinition[] => {
  if (!levels) {
    const all: LevelDefinition[] = [];
    for (let id = FIRST_SPOT_ID; id <= LAST_ID; id += 1) {
      all.push(generateLevel(id));
    }
    levels = all;
  }
  return levels;
};

let sweep: readonly FlipSample[] | undefined;
const flipSamples = (): readonly FlipSample[] => {
  if (!sweep) {
    const samples: FlipSample[] = [];
    for (const level of generatedLevels()) {
      if (level.id < FIRST_ID) continue;
      const seeds = level.arrows
        .filter((arrow) => arrow.id.includes("-flip-"))
        .map((arrow) => arrow.id);
      if (seeds.length === 0) continue;
      samples.push({
        id: level.id,
        level,
        seeds,
        region: interactionRegion(level, seeds),
      });
    }
    sweep = samples;
  }
  return sweep;
};

// Every cell an arrow's track reaches under every flip-spot state, from both
// ends of a double. Built from exported pieces only, so it checks
// interactionRegion rather than repeating it.
const reach = (level: LevelDefinition, arrow: ArrowDefinition): Set<string> => {
  const paths =
    arrow.kind === "double"
      ? [arrow.path, [...arrow.path].reverse()]
      : [arrow.path];
  const keys = new Set<string>();
  for (const probe of flipHeadingProbes(level)) {
    for (const path of paths) {
      for (const cell of arrowTrack(probe, { ...arrow, path })) {
        keys.add(cellKey(cell));
      }
    }
  }
  return keys;
};

// The region's arrows alone, with only the circles inside the region and
// every spot on the board: the board the generator solves the region on.
const regionBoard = (
  level: LevelDefinition,
  region: InteractionRegion,
): LevelDefinition => {
  const inside = new Set(region.arrowIds);
  const regionStops = new Set(region.stopKeys);
  const stops = (level.stops ?? []).filter((stop) =>
    regionStops.has(cellKey(stop)),
  );
  const { stops: _allStops, ...bare } = level;
  return {
    ...bare,
    arrows: level.arrows.filter((arrow) => inside.has(arrow.id)),
    ...(stops.length > 0 ? { stops } : {}),
  };
};

describe("generated interaction regions", () => {
  test("every flip level's region closes, proves, and composes", () => {
    const samples = flipSamples();
    let regions = 0;
    let regionsToNinety = 0;
    let equalToSeeds = 0;
    for (const { id, level, seeds, region } of samples) {
      expect(region, `level ${id}`).toBeDefined();
      if (!region) continue;
      regions += 1;
      if (id <= 90) regionsToNinety += 1;
      for (const seed of seeds) expect(region.arrowIds).toContain(seed);
      if (region.arrowIds.length === seeds.length) equalToSeeds += 1;
      expect(proveRegion(level, createGameState(level), region)).toEqual({
        ok: true,
      });
      const members = level.arrows.filter((arrow) =>
        region.arrowIds.includes(arrow.id),
      );
      // interactionRegion tracks a double from its head end only, so a
      // double member's tail-direction cells would be missing from
      // region.cells. No generated region holds one; this pins that fact,
      // and the subset check below would expose the gap if one appeared.
      expect(
        members.filter((arrow) => arrow.kind === "double").map((a) => a.id),
        `level ${id}`,
      ).toEqual([]);
      // A group moves on one shared offset, so no member may sit in a flip
      // region, whose tracks depend on spot state.
      expect(
        members
          .filter((arrow) => overlappingArrowIds(level, arrow.id).length > 1)
          .map((a) => a.id),
        `level ${id}`,
      ).toEqual([]);
      const memberReach = new Set<string>();
      for (const arrow of members) {
        for (const key of reach(level, arrow)) {
          expect(region.cells.has(key), `level ${id} ${arrow.id} ${key}`).toBe(
            true,
          );
          memberReach.add(key);
        }
      }
      for (const arrow of level.arrows) {
        if (region.arrowIds.includes(arrow.id)) continue;
        for (const key of reach(level, arrow)) {
          expect(memberReach.has(key), `level ${id} ${arrow.id} ${key}`).toBe(
            false,
          );
        }
      }
    }
    expect(regionsToNinety).toBeGreaterThanOrEqual(20);
    console.log(
      `regions: ${regions} in ${FIRST_ID}-${LAST_ID}, ${regionsToNinety} in ${FIRST_ID}-90, ${equalToSeeds} equal to their flip core`,
    );
  }, 240_000);

  // A group moves on one shared offset along each member's static track, so
  // no member's track (body included) may enter a spot cell, static or flip,
  // under any flip state.
  test("no shared-tail group member's route touches a spot cell", () => {
    const grouped: number[] = [];
    for (const level of generatedLevels()) {
      const spotKeys = new Set(
        (level.directionals ?? []).map((spot) => cellKey(spot.cell)),
      );
      if (spotKeys.size === 0) continue;
      const members = level.arrows.filter(
        (arrow) => overlappingArrowIds(level, arrow.id).length > 1,
      );
      if (members.length === 0) continue;
      grouped.push(level.id);
      for (const arrow of members) {
        for (const key of reach(level, arrow)) {
          expect(
            spotKeys.has(key),
            `level ${level.id} ${arrow.id} ${key}`,
          ).toBe(false);
        }
      }
    }
    expect(grouped.length).toBeGreaterThan(0);
    console.log(
      `grouped spot cubes in ${FIRST_SPOT_ID}-${LAST_ID}: ${grouped.join(",")}`,
    );
  }, 240_000);

  test("stops appear inside some flip regions", () => {
    const withStops = flipSamples().filter(
      ({ region }) => region && region.stopKeys.length > 0,
    );
    expect(withStops.length).toBeGreaterThan(0);
    console.log(
      `regions with stops: ${withStops
        .map(({ id, region }) => `${id} ${region?.stopKeys.join(",")}`)
        .join("; ")}`,
    );
  }, 240_000);

  // The prover treats outside arrows as static blockers. Its region-first
  // solution, replayed by the real engine on the full level, must play out
  // step for step as it did with the region alone; the full solver's
  // clearing order must also hold in the engine.
  test("region solutions replay identically in the full-level engine", () => {
    const parks: string[] = [];
    let parityLevels = 0;
    for (const { id, level, region } of flipSamples()) {
      if (!region) continue;
      const sub = regionBoard(level, region);
      const targets = solveLevelTargets(sub);
      expect(targets, `level ${id}`).toBeDefined();
      if (!targets) continue;
      let alone = createGameState(sub);
      let full = createGameState(level);
      for (const target of targets) {
        const expected = simulateMove(
          sub,
          alone,
          target.arrowId,
          target.endpoint,
        );
        const actual = simulateMove(
          level,
          full,
          target.arrowId,
          target.endpoint,
        );
        expect(actual.kind, `level ${id} ${target.arrowId}`).toBe(
          expected.kind,
        );
        expect(["exit", "paused"]).toContain(actual.kind);
        if (actual.kind === "paused") {
          const parked = actual.settledPath?.at(-1);
          expect(parked, `level ${id} ${target.arrowId}`).toBeDefined();
          const key = parked ? cellKey(parked) : "";
          expect(region.stopKeys).toContain(key);
          parks.push(`${id} ${key} ${target.arrowId}`);
        }
        alone = applyMove(sub, alone, expected);
        full = applyMove(level, full, actual);
      }
      for (const arrowId of region.arrowIds) {
        expect(full.remainingIds).not.toContain(arrowId);
      }
      expect(full.lives).toBe(level.lives);
      expect(full.failedIds).toEqual([]);
      expect(full.remainingIds.length).toBe(
        level.arrows.length - region.arrowIds.length,
      );

      const whole = solveLevelTargets(level);
      expect(whole, `level ${id}`).toBeDefined();
      let state: GameState = createGameState(level);
      for (const target of whole ?? []) {
        const result = simulateMove(
          level,
          state,
          target.arrowId,
          target.endpoint,
        );
        expect(["exit", "paused"], `level ${id} ${target.arrowId}`).toContain(
          result.kind,
        );
        state = applyMove(level, state, result);
      }
      expect(state.remainingIds, `level ${id}`).toEqual([]);
      expect(state.lives).toBe(level.lives);
      parityLevels += 1;
    }
    expect(parityLevels).toBeGreaterThanOrEqual(20);
    expect(parks.length).toBeGreaterThan(0);
    console.log(
      `parity levels: ${parityLevels}; region parks: ${parks.join("; ")}`,
    );
  }, 240_000);
});
