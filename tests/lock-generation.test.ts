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

// Fingerprints of the lock-core ids before lock cores existed, with level 50
// already authored. The fixture regeneration that shipped lock cores changed
// exactly these ids and no other; every other id's fixture entry is the
// untouched pre-lock value, so an id without a lock core matching the fixture
// is plan-zero parity. Over 51-200, 78 of 79 planned cores place. Id 137 is
// also fragile-planned, so its lock pass carries the fragile core too, and
// that core never fits there: the pass gives up before the lock is tried,
// and 137 comes out as the plan-zero construction.
const PRE_LOCK: Readonly<Record<number, string>> = {
  51: "ba172fc4d1c52319",
  56: "1e2610f97292f990",
  58: "293349744176a8f1",
  63: "3456ce3717ede8bc",
  65: "30a9c20728bfbb59",
  67: "59940d23305d2a8a",
  71: "c1e5e00ad5c21a75",
  73: "9ea684944a40241d",
  74: "d56cbd56b8405c37",
  75: "edbc2fbff21e8264",
  76: "481b55a41b9216d0",
  77: "e021ce11f7f32cd5",
  80: "ecc4caf6d4c7c299",
  84: "d280b932101a200e",
  85: "a2be2470a9929270",
  86: "c24b7eb5014da1dd",
  89: "542304d6451e4b82",
  92: "f8786c45aa72a17d",
  93: "b92983e98e05191d",
  94: "da1e6df04014bdce",
  95: "ecfd2bf9d54069af",
  96: "f9e4c829752d523c",
  97: "45ff0cdd5b9b788f",
  98: "7491e9b39d4e3fa7",
  101: "5a28c71c8af8f20e",
  102: "01b45d575c13d82c",
  104: "4fd587caf2803c8e",
  105: "374258dd916aa0a3",
  110: "5bacef4f2d9b3288",
  112: "e48a9430434652c3",
  116: "971cbaec8f3b3893",
  117: "53f1d6c357a2f906",
  118: "75e90145363d3797",
  119: "e0a7665ca2f248dd",
  120: "4e473960477abbcc",
  121: "fcc48a41e3b64667",
  124: "9c00ff735f132662",
  125: "a9476981c783efae",
  129: "264c17c5f15c30d1",
  130: "e3adfa80331967da",
  131: "48ee3a4cc10ee0c6",
  133: "c0a91fa7b3ec26b5",
  134: "40f39c459f0a4c2d",
  135: "e251bd8a3e8d9bb9",
  136: "44f39a1c33d35eab",
  139: "61ff9488c46dc025",
  141: "22feb14a3182b494",
  142: "cde8d085d4a76a49",
  143: "1dd8cedb9b2ed298",
  144: "ca63508da4034e42",
  146: "a9e8b39ae466cc16",
  147: "80399d600cfa940c",
  149: "ad8517c01985e6ef",
  150: "2b4ecc0f9b58eaa5",
  151: "a768e440ed6e8295",
  152: "3a97deb1bb39e450",
  154: "b293cdc3271d397f",
  155: "9b2046364c8421cf",
  160: "b300a5e4a3d43d19",
  164: "4d3e40c4b681483f",
  171: "3a32f7141a46c597",
  172: "379382ceedbc7df7",
  173: "42457b05de92f6ad",
  175: "db45f95d40edffdb",
  176: "7356414ec26a928b",
  179: "409ffa495667c122",
  180: "3447e6fd94a89f99",
  184: "b6e6b0bbab48b5ec",
  185: "95d4fce3a63164f9",
  190: "62208d0bac0d7994",
  193: "b3556305b6a47af3",
  195: "9220c6561d33a424",
  196: "d27ce1208a7eda52",
  197: "5c71ac249a175b6a",
  198: "ac5fcab1aace310a",
  199: "609d4c4b06611a56",
  200: "710b93c506d44096",
};

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
        expect(id in PRE_LOCK, `level ${id}`).toBe(false);
        expect(layoutFingerprint(level), `level ${id}`).toBe(
          fixture[id] as string,
        );
        continue;
      }
      lockLevels.push(id);
      expect(lockCorePlanned(id)).toBe(true);
      expect(locks).toHaveLength(1);
      expect(layoutFingerprint(level)).not.toBe(PRE_LOCK[id]);
      const lock = locks[0] as (typeof locks)[number];
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
      // The core's certificate leads the level's replay, so it wins the
      // whole cube with the gate opened and no life spent.
      let state = createGameState(level);
      for (const target of solveLevelTargets(core) ?? []) {
        const result = simulateMove(
          level,
          state,
          target.arrowId,
          target.endpoint,
        );
        expect(result.kind).toBe("exit");
        state = applyMove(level, state, result);
      }
      expect(state.unlocked).toEqual([lock.id]);
      expect(state.lives).toBe(level.lives);
    }
    expect(lockLevels).toEqual(
      Object.keys(PRE_LOCK)
        .map(Number)
        .sort((a, b) => a - b),
    );
  }, 600_000);

  test("lock levels generate deterministically and within budget", () => {
    for (const id of [51, 104, 150, 199]) {
      const started = performance.now();
      const level = generateLevel(id);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(level.locks).toHaveLength(1);
      expect(layoutFingerprint(generateLevel(id))).toBe(
        layoutFingerprint(level),
      );
    }
  }, 60_000);
});
