import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  generateLevel,
  isAuthoredLevel,
  LOCK_CORE_MARKER,
  LOCK_PATTERN,
  lockCoreFrequency,
  lockCorePlanned,
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
  hasStrandingState,
  interactionRegion,
  occupancyKeys,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { layoutFingerprint } from "../src/storage";
import { cachedLevel } from "./generated-levels";

const FIRST_ID = 51;
const LAST_ID = 200;

// PRE_LOCK parity retired at v11: the version bump re-rolls every id; the
// fixture pins determinism.

/**
 * Ids whose lock core placed the cross-face variant: the key cell sits on a
 * neighboring face across a seam from its gate, so the key's flight crosses
 * faces. The seeded coin prefers cross on every lock id; a cross aspirant
 * whose geometry cannot fit falls back to the same-face pattern, so this set
 * is the measured share of the placed cores that fit cross-face (flip-core
 * blockers re-rolled which ids place cross-face).
 */
const CROSS_FACE: ReadonlySet<number> = new Set([169]);

/** The core's two arrows and its lock, alone on the level's cube. */
function coreBoard(level: LevelDefinition): LevelDefinition {
  const {
    stops: _stops,
    directionals: _spots,
    wormholes: _holes,
    fragile: _fragile,
    ...bare
  } = level;
  return {
    ...bare,
    arrows: level.arrows.filter((arrow) => arrow.id.includes(LOCK_CORE_MARKER)),
  };
}

const openerOf = (level: LevelDefinition): string =>
  level.arrows.find((arrow) => arrow.id.endsWith(`${LOCK_CORE_MARKER}opener`))
    ?.id as string;
const keyArrowOf = (level: LevelDefinition): string =>
  level.arrows.find((arrow) => arrow.id.endsWith(`${LOCK_CORE_MARKER}key`))
    ?.id as string;

describe("lock generation", () => {
  test("frequency ramps from level 51 to 90 and holds", () => {
    expect(lockCoreFrequency(50)).toBe(0);
    expect(lockCoreFrequency(51)).toBeCloseTo(0.25);
    expect(lockCoreFrequency(70)).toBeCloseTo(0.25 + (0.3 * 19) / 39);
    expect(lockCoreFrequency(90)).toBeCloseTo(0.55);
    expect(lockCoreFrequency(500)).toBeCloseTo(0.55);
    for (let id = 2; id < FIRST_ID; id += 1) {
      expect(lockCorePlanned(id)).toBe(false);
    }
  });

  test("plan share tracks the ramp on sampled bands", () => {
    for (const [from, to] of [
      [51, 90],
      [91, 145],
      [146, 200],
    ] as const) {
      let eligible = 0;
      let planned = 0;
      let expected = 0;
      for (let id = from; id <= to; id += 1) {
        if (isAuthoredLevel(id)) continue;
        eligible += 1;
        expected += lockCoreFrequency(id);
        if (lockCorePlanned(id)) planned += 1;
      }
      expect(Math.abs(planned - expected) / eligible).toBeLessThan(0.2);
    }
  });

  test("the pattern needs its key first at all four rotations", () => {
    const turn = (dx: number, dy: number, rotation: number): [number, number] =>
      [
        [dx, dy],
        [-dy, dx],
        [-dx, -dy],
        [dy, -dx],
      ][rotation] as [number, number];
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const at = ([dx, dy]: readonly [number, number]) => {
        const [x, y] = turn(dx, dy, rotation);
        return { face: "front" as const, x: 6 + x, y: 6 + y };
      };
      const level: LevelDefinition = {
        id: 905,
        title: "Lock pattern",
        gridSize: 13,
        lives: 3,
        locks: [
          { id: "lock", key: at(LOCK_PATTERN.keyCell), lock: at([0, 0]) },
        ],
        arrows: [
          { id: "opener", path: LOCK_PATTERN.opener.map(at) },
          { id: "key", path: LOCK_PATTERN.key.map(at) },
        ],
      };
      expect(validateLevel(level).errors).toEqual([]);
      const initial = createGameState(level);
      expect(simulateMove(level, initial, "opener").kind).toBe("gated");
      const stripped = { ...level, locks: [] };
      expect(
        simulateMove(stripped, createGameState(stripped), "opener").kind,
      ).toBe("exit");
      expect(solveLevelTargets(level)).toEqual([
        { arrowId: "key", endpoint: "head" },
        { arrowId: "opener", endpoint: "head" },
      ]);
      expect(hasStrandingState(level)).toBe(false);
      expect(hasSoftLockState(level)).toBe(false);
    }
  });

  // One pass over ids 51-200, sharing levels with the other sweeps. Every
  // level validates; a lock appears only on a planned id and never more than
  // one; no arrow outside the core reaches its gate or key, and both sit
  // outside every stateful-spot region; the core's own board needs its key
  // first, is strand-free, and the stripped core lets the opener leave first;
  // and ids without a lock core keep their pre-lock fixture fingerprint.
  test("sweep 51-200", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/v8-layouts.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    const lockLevels: number[] = [];
    for (let id = FIRST_ID; id <= LAST_ID; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      expect(validateLevel(level).valid, `level ${id}`).toBe(true);
      const locks = level.locks ?? [];
      if (locks.length === 0) {
        expect(layoutFingerprint(level), `level ${id}`).toBe(
          fixture[id] as string,
        );
        continue;
      }
      lockLevels.push(id);
      expect(lockCorePlanned(id)).toBe(true);
      expect(locks).toHaveLength(1);
      const lock = locks[0] as (typeof locks)[number];
      expect(lock.key.face !== lock.lock.face).toBe(CROSS_FACE.has(id));
      const keys = [cellKey(lock.lock), cellKey(lock.key)];
      for (const arrow of level.arrows) {
        if (arrow.id.includes(LOCK_CORE_MARKER)) continue;
        const reach = occupancyKeys(level, arrow);
        for (const key of keys) {
          expect(reach.has(key), `${id} ${arrow.id}`).toBe(false);
        }
      }
      const seeds = level.arrows
        .filter((arrow) => /-(flip|rotor)-/.test(arrow.id))
        .map((arrow) => arrow.id);
      if (seeds.length > 0) {
        const region = interactionRegion(level, seeds);
        for (const key of keys) expect(region?.cells.has(key)).toBe(false);
      }
      const core = coreBoard(level);
      const opener = openerOf(core);
      const keyArrow = keyArrowOf(core);
      expect(
        simulateMove(core, createGameState(core), opener).kind,
        `level ${id}`,
      ).toBe("gated");
      const order = (solveLevelTargets(core) ?? []).map(
        (target) => target.arrowId,
      );
      expect(order.indexOf(keyArrow)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(keyArrow)).toBeLessThan(order.indexOf(opener));
      const stripped = { ...core, locks: [] };
      expect(
        simulateMove(stripped, createGameState(stripped), opener).kind,
      ).toBe("exit");
      expect(hasStrandingState(core)).toBe(false);
      expect(hasSoftLockState(core)).toBe(false);
      // Entangled blockers sit on the core's lanes, so the certificate replays
      // on the core board: the gate opens and no life is spent.
      let state = createGameState(core);
      for (const target of solveLevelTargets(core) ?? []) {
        const result = simulateMove(
          core,
          state,
          target.arrowId,
          target.endpoint,
        );
        expect(result.kind).toBe("exit");
        state = applyMove(core, state, result);
      }
      expect(state.unlocked).toEqual([lock.id]);
      expect(state.lives).toBe(core.lives);
    }
    expect(lockLevels.length).toBeGreaterThan(0);
  }, 600_000);

  test("lock levels generate deterministically and within budget", () => {
    for (const id of [64, 104, 160, 199]) {
      const started = performance.now();
      const level = generateLevel(id);
      // The leap pass is a third copy of the first pass on certificate tiers,
      // so the sampled lock ids carry the mirror pass's restart cost too
      // (measured 3391 ms on CI for id 104 when leap cores shipped).
      // Lane-blocker era: raised from 4 s with runner headroom (the
      // entangled seeder plus per-blocker certificate replays; the leap-era
      // comment above recorded 3391 ms on CI).
      expect(performance.now() - started).toBeLessThan(8000);
      expect(level.locks).toHaveLength(1);
      expect(layoutFingerprint(generateLevel(id))).toBe(
        layoutFingerprint(level),
      );
    }
  }, 60_000);

  test("entangled lock cores carry well-formed blockers on their lanes", () => {
    let found = 0;
    for (let id = 51; id <= 200 && found < 3; id += 1) {
      if (isAuthoredLevel(id) || !lockCorePlanned(id)) continue;
      const level = cachedLevel(id);
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-xblock-lock"),
      );
      if (blockers.length === 0) continue; // legitimate fallback ids
      found += 1;
      const coreTrack = new Set(
        level.arrows
          .filter((arrow) => arrow.id.includes("-lock-"))
          .flatMap((core) => [
            ...core.path.map(cellKey),
            ...trackKeys(level, core),
          ]),
      );
      for (const blocker of blockers) {
        // Blocker ids end "-xblock-lock<n>", so the "-lock-" core filter never
        // picks a blocker up as a core arrow.
        expect(blocker.id.includes("-lock-")).toBe(false);
        expect(blocker.path.length).toBe(2);
        expect(blocker.path.some((cell) => coreTrack.has(cellKey(cell)))).toBe(
          true,
        );
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  }, 600_000);
});
