import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FRAGILE_CORE_MARKER,
  FRAGILE_PATTERN,
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

// Fingerprints of the fragile-core ids before fragile cores existed. The
// fixture regeneration that shipped fragile cores changed exactly these ids
// and no other; every other id's fixture entry is the untouched pre-fragile
// value, so an id without a fragile core matching the fixture is plan-zero
// parity. Over 46-200, 76 of 77 planned cores place: id 137 gives its plan
// up and comes out as the plan-zero construction.
const PRE_FRAGILE: Readonly<Record<number, string>> = {
  49: "426686e762c97464",
  50: "9497a985a8d09d33",
  52: "70fba173988c2e66",
  54: "7d986db806fa49ee",
  63: "81910dde0792aad7",
  66: "77bb0fb67161ac6e",
  67: "cae142bec75ada96",
  68: "ef4d52c77740a8fe",
  70: "bdb58bd1985e0958",
  72: "3f440bae8b13d2b8",
  73: "20b58f15d1e32f33",
  75: "85d6779178e11f2b",
  76: "eb358255ba2514c7",
  77: "aa56d3488c8bc3f2",
  80: "fae21a03e9bf0668",
  81: "cf848c9daa11fc3e",
  86: "54ede4190b9cf88e",
  87: "e2a1400b40cd7a91",
  89: "2c92fb2ce3d59aeb",
  91: "9c2cccef1266a925",
  92: "eee1e60ce5cc5267",
  94: "add3f5a0f94a4d84",
  99: "d25e60f39b96d064",
  103: "5b55a1335e075744",
  104: "e22335b390107db2",
  105: "69eb8b1aa743d00b",
  107: "325c7b13bcacfd50",
  108: "910f65f995d1e792",
  110: "cab2e08761091982",
  114: "3ba08a2b07854a29",
  116: "cfdf855b6fa4efaf",
  117: "29c50283f01c1012",
  118: "160dfdc4fa42541e",
  119: "7afc4e4a32c5a28d",
  120: "9d34004a80e898da",
  130: "e83ccfebdd971c7e",
  131: "e66649aee2e2de00",
  133: "4121f14161d03ac7",
  134: "a1c9161537dc98de",
  135: "680ea266ff72b169",
  136: "0a4f9113a1c3936b",
  138: "3d6f68f23ddc3a26",
  139: "156c73b4cfd03be9",
  140: "7d4aeb36904b4bb8",
  141: "00d064c1d982ffa9",
  144: "5e3f01191ed01c77",
  147: "48a02f3518a34110",
  148: "f5edbd8354e38ec1",
  149: "271531d7e8c52488",
  150: "d2aa15163eaee0fc",
  153: "6e5673af50bb8739",
  154: "a992199b3dab2a0c",
  155: "f6a6d1b892f5bacd",
  156: "c048a9ba5a6430c7",
  157: "aa6dcad86e6086cc",
  158: "9cfd2f67160dd004",
  161: "9d7c23b0c8b2119f",
  164: "ed0e4c8578a7308c",
  167: "8d71e24f914f6916",
  169: "177fbe656fb17040",
  171: "a15bac893ed0bd58",
  173: "eba048d747c8fd98",
  174: "78aaf051777b4351",
  175: "c5e7541992cf431c",
  179: "c8adc43b9a348d08",
  181: "4f982c9662ddba95",
  182: "bc86dd46240b1b64",
  184: "4bd34fb667d0728b",
  185: "fbb5c084f217a0c1",
  187: "6e4407f7c268af6a",
  189: "1de0626ced169e0d",
  192: "a9ece4c2e3c9c15b",
  193: "ea3d94ccd3be250f",
  194: "fff15d00b99898ec",
  195: "1a77299a2e11b103",
  199: "a4088c25ffb2d21c",
};

/** The core's two arrows and its fragile cell, alone on the level's cube. */
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

  test("the pattern needs its crossing order at all four rotations", () => {
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
        id: 904,
        title: "Fragile pattern",
        gridSize: 13,
        lives: 3,
        fragile: [at([0, 0])],
        arrows: [
          { id: "crosser", path: FRAGILE_PATTERN.crosser.map(at) },
          {
            id: "double",
            kind: "double",
            path: FRAGILE_PATTERN.double.map(at),
          },
        ],
      };
      expect(validateLevel(level).errors).toEqual([]);
      expect(solveLevelTargets(level)).toEqual([
        { arrowId: "crosser", endpoint: "head" },
        { arrowId: "double", endpoint: "tail" },
      ]);
      expect(hasSoftLockState(level)).toBe(false);
      let state = createGameState(level);
      state = applyMove(level, state, simulateMove(level, state, "double"));
      expect(simulateMove(level, state, "crosser").kind).toBe("fall");
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
        expect(id in PRE_FRAGILE, `level ${id}`).toBe(false);
        expect(layoutFingerprint(level), `level ${id}`).toBe(
          fixture[id] as string,
        );
        continue;
      }
      fragileLevels.push(id);
      expect(fragileCorePlanned(id)).toBe(true);
      expect(cells).toHaveLength(1);
      expect(layoutFingerprint(level)).not.toBe(PRE_FRAGILE[id]);
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
    expect(fragileLevels).toEqual(
      Object.keys(PRE_FRAGILE)
        .map(Number)
        .sort((a, b) => a - b),
    );
  }, 600_000);

  test("fragile levels generate deterministically and within budget", () => {
    for (const id of [49, 104, 150, 199]) {
      const started = performance.now();
      const level = generateLevel(id);
      expect(performance.now() - started).toBeLessThan(1000);
      expect(level.fragile).toHaveLength(1);
      expect(layoutFingerprint(generateLevel(id))).toBe(
        layoutFingerprint(level),
      );
    }
  }, 60_000);
});
