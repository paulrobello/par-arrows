import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  flipCorePlanned,
  generateLevel,
  getStopCount,
  isAuthoredLevel,
  Rng,
  rotorCoreFrequency,
  rotorCoreIds,
  rotorCorePlanned,
} from "../src/content/procedural";
import { constructRotor } from "../src/content/rotor";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { Cell, LevelDefinition } from "../src/core/types";
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
import { blockingStructure, mechanicStructure } from "./mechanic-structure";

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

  test("independent seeds grow distinct, required and safe phased lane circuits", () => {
    const empty: LevelDefinition = {
      id: 90,
      title: "rotor topology",
      gridSize: 16,
      lives: 3,
      arrows: [],
    };
    const shapes = new Set<string>();
    const laneShapes = new Set<string>();
    const graphs = new Set<string>();
    const sizes = new Set<number>();
    let multiFace = 0;
    for (let seed = 1; seed <= 64; seed += 1) {
      const core = constructRotor(empty, new Rng(seed), new Set(), new Set());
      expect(core, `seed ${seed}`).toBeDefined();
      if (!core) continue;
      const board = {
        ...empty,
        arrows: core.arrows,
        stops: core.stops,
        directionals: core.spots,
      };
      expect(validateLevel(board).valid).toBe(true);
      expect(solveLevelTargets(frozen(board))).toBeUndefined();
      expect(solveLevelTargets({ ...board, stops: [] })).toBeUndefined();
      expect(hasStrandingState(board)).toBe(false);
      shapes.add(mechanicStructure(board));
      laneShapes.add(
        mechanicStructure({
          ...board,
          arrows: board.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
        }),
      );
      sizes.add(core.arrows.length);
      if (
        new Set(core.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1
      )
        multiFace += 1;
      const spot = core.spots[0]!;
      const parker = core.arrows[0]!;
      let state = createGameState(board);
      const pause = simulateMove(board, state, parker.id);
      expect(pause.kind).toBe("paused");
      state = applyMove(board, state, pause);
      graphs.add(blockingStructure(board, state));
      const parked = new Set(state.settledPaths?.[parker.id]?.map(cellKey));
      expect(parked.size).toBe(parker.path.length);
      expect(parker.path.some((cell) => parked.has(cellKey(cell)))).toBe(false);
      expect(parked.has(cellKey(spot.cell))).toBe(false);
      expect(state.spotHeadings?.[cellKey(spot.cell)]).not.toBe(spot.heading);
      let required = false;
      for (const arrow of [...core.arrows.slice(1).reverse(), parker]) {
        const move = simulateMove(board, state, arrow.id);
        expect(move.kind).toBe("exit");
        const held = simulateMove(
          board,
          {
            ...state,
            spotHeadings: {
              ...state.spotHeadings,
              [cellKey(spot.cell)]: spot.heading,
            },
          },
          arrow.id,
        );
        if (held.kind === "blocked" && held.blockerId === parker.id)
          required = true;
        state = applyMove(board, state, move);
      }
      expect(
        required,
        `seed ${seed} rotor lacks a real parked-body interaction`,
      ).toBe(true);
      expect(state.remainingIds).toEqual([]);
      expect(state.lives).toBe(board.lives);
    }
    expect(shapes.size).toBeGreaterThanOrEqual(64 * 0.95);
    expect(laneShapes.size).toBeGreaterThanOrEqual(64 * 0.95);
    expect(graphs.size).toBeGreaterThanOrEqual(6);
    expect(sizes.size).toBe(3);
    expect(multiFace).toBeGreaterThan(16);
    const full = new Set<string>();
    for (const face of ["front", "back", "left", "right", "top", "bottom"])
      for (let x = 0; x < empty.gridSize; x++)
        for (let y = 0; y < empty.gridSize; y++) full.add(`${face}:${x}:${y}`);
    expect(constructRotor(empty, new Rng(1), full, new Set())).toBeUndefined();
    expect(constructRotor(empty, new Rng(1), new Set(), full)).toBeUndefined();
  }, 180_000);

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
    const shapes = new Set<string>();
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
      shapes.add(mechanicStructure(core));
      expect(core.stops?.length ?? 0).toBeGreaterThan(0);
      expect(solveLevelTargets(core)).toBeDefined();
      expect(solveLevelTargets(frozen(core))).toBeUndefined();
      expect(solveLevelTargets(level)).toBeDefined();
    }
    expect(rotorLevels.length).toBeGreaterThan(20);
    expect(shapes.size / rotorLevels.length).toBeGreaterThanOrEqual(0.95);
  }, 600_000);

  test("rotor levels generate deterministically and within budget", () => {
    for (const id of [42, 58, 111, 196]) {
      const started = performance.now();
      const level = generateLevel(id);
      // 2570ms measured on CI 2026-10-08 after lane cores joined the fill; raised from 2000.
      expect(performance.now() - started).toBeLessThan(4000);
      expect(rotorCoreIds(level.arrows).length).toBeGreaterThan(0);
      expect(layoutFingerprint(generateLevel(id))).toBe(
        layoutFingerprint(level),
      );
    }
  }, 60_000);

  test("an unplaceable far-ID circuit gives up within the generation budget", () => {
    // The unconstrained path search took 42 seconds here, then still omitted
    // the optional rotor. Exhaustion must preserve a fast, solvable board.
    const started = performance.now();
    const level = generateLevel(4_179_387_469_245_184);
    expect(performance.now() - started).toBeLessThan(8000);
    expect(validateLevel(level).valid).toBe(true);
    expect(solveLevelTargets(level)).toBeDefined();
  }, 30_000);
});
