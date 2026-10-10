import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FRAGILE_CORE_MARKER,
  fragileCoreFrequency,
  fragileCorePlanned,
  generateLevel,
  isAuthoredLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { trackKeys } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type { LevelDefinition } from "../src/core/types";
import {
  hasSoftLockState,
  interactionRegion,
  occupancyKeys,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { layoutFingerprint } from "../src/storage";
import { cachedLevel } from "./generated-levels";

const FIRST_ID = 46;
const LAST_ID = 200;

// PRE_FRAGILE parity retired at v11: the version bump re-rolls every id; the
// fixture pins determinism.

/** The core's grown arrows and its fragile cell, alone on the level's cube. */
function coreBoard(level: LevelDefinition): LevelDefinition {
  const {
    stops: _stops,
    directionals: _spots,
    wormholes: _holes,
    ...bare
  } = level;
  return {
    ...bare,
    arrows: level.arrows.filter((arrow) =>
      arrow.id.includes(FRAGILE_CORE_MARKER),
    ),
  };
}

describe("fragile generation", () => {
  test("frequency ramps from level 46 to 90 and holds", () => {
    expect(fragileCoreFrequency(45)).toBe(0);
    expect(fragileCoreFrequency(46)).toBeCloseTo(0.25);
    expect(fragileCoreFrequency(68)).toBeCloseTo(0.25 + (0.3 * 22) / 44);
    expect(fragileCoreFrequency(90)).toBeCloseTo(0.55);
    expect(fragileCoreFrequency(500)).toBeCloseTo(0.55);
    for (let id = 2; id < FIRST_ID; id += 1) {
      expect(fragileCorePlanned(id)).toBe(false);
    }
  });

  // Measured plan shares: 19/45 over 46-90 (ramp mean 0.40), 28/55 over
  // 91-145 and 30/55 over 146-200 (ramp 0.55).
  test("plan share tracks the ramp on sampled bands", () => {
    for (const [from, to] of [
      [46, 90],
      [91, 145],
      [146, 200],
    ] as const) {
      let eligible = 0;
      let planned = 0;
      let expected = 0;
      for (let id = from; id <= to; id += 1) {
        if (isAuthoredLevel(id)) continue;
        eligible += 1;
        expected += fragileCoreFrequency(id);
        if (fragileCorePlanned(id)) planned += 1;
      }
      expect(Math.abs(planned - expected) / eligible).toBeLessThan(0.2);
    }
  });

  // One pass over ids 46-200, sharing levels with the other sweeps. Every
  // level validates and solves; a fragile cell appears only on a planned id
  // and never more than one; no arrow outside the core can reach it, and it
  // sits outside every stateful-spot region; the core's own board solves
  // with zero falls by collapsing the cell; and ids without a fragile core
  // keep their pre-fragile fixture fingerprint.
  test("sweep 46-200", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/v8-layouts.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    const fragileLevels: number[] = [];
    for (let id = FIRST_ID; id <= LAST_ID; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      expect(validateLevel(level).valid, `level ${id}`).toBe(true);
      const cells = level.fragile ?? [];
      if (cells.length === 0) {
        expect(layoutFingerprint(level), `level ${id}`).toBe(
          fixture[id] as string,
        );
        continue;
      }
      fragileLevels.push(id);
      expect(fragileCorePlanned(id)).toBe(true);
      expect(cells).toHaveLength(1);
      const key = cellKey(cells[0] as (typeof cells)[number]);
      for (const arrow of level.arrows) {
        if (arrow.id.includes(FRAGILE_CORE_MARKER)) continue;
        expect(occupancyKeys(level, arrow).has(key), `${id} ${arrow.id}`).toBe(
          false,
        );
      }
      const seeds = level.arrows
        .filter((arrow) => /-(flip|rotor)-/.test(arrow.id))
        .map((arrow) => arrow.id);
      if (seeds.length > 0) {
        expect(interactionRegion(level, seeds)?.cells.has(key)).toBe(false);
      }
      const core = coreBoard(level);
      const targets = solveLevelTargets(core);
      expect(targets, `level ${id}`).toBeDefined();
      let state = createGameState(core);
      for (const target of targets ?? []) {
        const result = simulateMove(
          core,
          state,
          target.arrowId,
          target.endpoint,
        );
        expect(result.kind).toBe("exit");
        state = applyMove(core, state, result);
      }
      expect(state.collapsed).toEqual([key]);
      expect(state.lives).toBe(core.lives);
    }
    expect(fragileLevels.length).toBeGreaterThan(0);
  }, 600_000);

  test("fragile levels generate deterministically and within budget", () => {
    for (const id of [52, 57, 160, 199]) {
      const started = performance.now();
      const level = generateLevel(id);
      // Lane-blocker era: raised from 4 s with runner headroom (the
      // entangled seeder plus per-blocker certificate replays).
      expect(performance.now() - started).toBeLessThan(8000);
      expect(level.fragile).toHaveLength(1);
      expect(layoutFingerprint(generateLevel(id))).toBe(
        layoutFingerprint(level),
      );
    }
  }, 60_000);

  test("entangled fragile cores carry well-formed blockers on their lanes", () => {
    let found = 0;
    for (let id = 46; id <= 200 && found < 3; id += 1) {
      if (isAuthoredLevel(id) || !fragileCorePlanned(id)) continue;
      const level = cachedLevel(id);
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-xblock-fragile"),
      );
      if (blockers.length === 0) continue; // legitimate fallback ids
      found += 1;
      const coreTrack = new Set(
        level.arrows
          .filter((arrow) => arrow.id.includes("-fragile-"))
          .flatMap((core) => [
            ...core.path.map(cellKey),
            ...trackKeys(
              level,
              core.kind === "double"
                ? { ...core, path: [...core.path].reverse() }
                : core,
            ),
          ]),
      );
      for (const blocker of blockers) {
        // Blocker ids end "-xblock-fragile<n>", so the "-fragile-" core filter never
        // picks a blocker up as a core arrow.
        expect(blocker.id.includes("-fragile-")).toBe(false);
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
