import { expect, test } from "bun:test";
import {
  directionalFacePlan,
  doubleArrowFrequency,
  flipBlockFrequency,
  flipCoreFrequency,
  flipCoreIds,
  fragileBlockFrequency,
  fragileCorePlanned,
  getStopCount,
  isAuthoredLevel,
  leapBlockFrequency,
  leapCorePlanned,
  lockBlockFrequency,
  lockCorePlanned,
  mirrorBlockFrequency,
  mirrorCorePlanned,
  Rng,
  rotorBlockFrequency,
  rotorCorePlanned,
  seedForLevel,
  wormholeBlockFrequency,
  wormholePlan,
} from "../src/content/procedural";
import { solveLevel } from "../src/core/validation";
import { cachedLevel } from "./generated-levels";

// FNV-1a exactly as `hashSeed` in src/content/procedural.ts, which is not
// exported; the plan draws hash `${seedForLevel(id)}:<stream>`.
function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash || 1;
}

const planDraw = (id: number, stream: string): number =>
  new Rng(fnv1a(`${seedForLevel(id)}:${stream}`)).next();

// v9 placement ratios (placed / planned) over levels 2-200; each v10 ratio
// must stay within 10% of its v9 value.
const V9 = {
  staticSpots: 707 / 845,
  flipCores: 94 / 97,
  wormholes: 98 / 105,
  doubles: 72 / 72,
} as const;

// Rotor cores arrived after v9, so their pin is the ratio measured when they
// shipped: 31 placed of 31 planned over levels 41-200.
const ROTOR_CORES = 31 / 31;

// Fragile cores likewise: 76 placed of 77 planned over levels 46-200 when
// they shipped (75 of 76 once level 50 became the authored lock cube).
const FRAGILE_CORES = 76 / 77;

// Lock cores likewise: 78 placed of 79 planned over levels 51-200.
const LOCK_CORES = 78 / 79;

// Mirror cores likewise: 73 placed of 83 planned over levels 56-200.
const MIRROR_CORES = 73 / 83;

// Leap cores likewise: 74 placed of 81 planned over levels 61-200.
const LEAP_CORES = 74 / 81;

test("mechanic placement ratios stay within 10% of v9", () => {
  const totals = {
    staticPlanned: 0,
    staticPlaced: 0,
    holesPlanned: 0,
    holesPlaced: 0,
    stopBudget: 0,
    stops: 0,
    groupEligible: 0,
    groups: 0,
    flipPlanned: 0,
    flipLevels: 0,
    doublePlanned: 0,
    doubleLevels: 0,
    rotorPlanned: 0,
    rotorLevels: 0,
    fragilePlanned: 0,
    fragileLevels: 0,
    lockPlanned: 0,
    lockLevels: 0,
    mirrorPlanned: 0,
    mirrorLevels: 0,
    leapPlanned: 0,
    leapLevels: 0,
  };
  for (let id = 2; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    totals.staticPlanned += directionalFacePlan(id).reduce(
      (sum, count) => sum + count,
      0,
    );
    totals.staticPlaced += (level.directionals ?? []).filter(
      (spot) => spot.kind !== "flip" && spot.kind !== "rotor",
    ).length;
    totals.holesPlanned += wormholePlan(id);
    totals.holesPlaced += level.wormholes?.length ?? 0;
    totals.stopBudget += getStopCount(id);
    totals.stops += level.stops?.length ?? 0;
    if ((level.stops?.length ?? 0) > 0) {
      expect(
        solveLevel({ ...level, stops: [] }),
        `level ${id} keeps circles it does not need`,
      ).toBeUndefined();
    }
    if (id >= 16) totals.groupEligible += 1;
    if (level.arrows.some((arrow) => arrow.id.includes("-overlap-")))
      totals.groups += 1;
    if (planDraw(id, "flip-plan") < flipCoreFrequency(id))
      totals.flipPlanned += 1;
    if ((level.directionals ?? []).some((spot) => spot.kind === "flip"))
      totals.flipLevels += 1;
    if (id >= 26 && planDraw(id, "double-plan") < doubleArrowFrequency(id))
      totals.doublePlanned += 1;
    if (level.arrows.some((arrow) => arrow.kind === "double"))
      totals.doubleLevels += 1;
    if (rotorCorePlanned(id)) totals.rotorPlanned += 1;
    if ((level.directionals ?? []).some((spot) => spot.kind === "rotor"))
      totals.rotorLevels += 1;
    if (fragileCorePlanned(id)) totals.fragilePlanned += 1;
    if ((level.fragile?.length ?? 0) > 0) totals.fragileLevels += 1;
    if (lockCorePlanned(id)) totals.lockPlanned += 1;
    if ((level.locks?.length ?? 0) > 0) totals.lockLevels += 1;
    if (mirrorCorePlanned(id)) totals.mirrorPlanned += 1;
    if ((level.mirrors?.length ?? 0) > 0) totals.mirrorLevels += 1;
    if (leapCorePlanned(id)) totals.leapPlanned += 1;
    if ((level.leaps?.length ?? 0) > 0) totals.leapLevels += 1;
  }
  expect(totals.staticPlaced / totals.staticPlanned).toBeGreaterThanOrEqual(
    V9.staticSpots * 0.9,
  );
  // The far-side blocker shipped with every wormhole core (2026-10) needs a
  // free perpendicular wing beside end B's corridor, which costs about four
  // placements over the sweep, so this floor sits at 0.8x of v9.
  expect(totals.holesPlaced / totals.holesPlanned).toBeGreaterThanOrEqual(
    V9.wormholes * 0.8,
  );
  // Decorative circles are gone: a circle only ships on a proven
  // required-use core, so the budget is a ceiling, not a quota.
  expect(totals.stops).toBeLessThanOrEqual(totals.stopBudget);
  expect(totals.groups).toBe(totals.groupEligible);
  expect(totals.flipPlanned).toBeGreaterThan(0);
  expect(totals.flipLevels / totals.flipPlanned).toBeGreaterThanOrEqual(
    V9.flipCores * 0.9,
  );
  expect(totals.doublePlanned).toBeGreaterThan(0);
  expect(totals.doubleLevels / totals.doublePlanned).toBeGreaterThanOrEqual(
    V9.doubles * 0.9,
  );
  expect(totals.rotorPlanned).toBeGreaterThan(0);
  expect(totals.rotorLevels / totals.rotorPlanned).toBeGreaterThanOrEqual(
    ROTOR_CORES * 0.9,
  );
  expect(totals.fragilePlanned).toBeGreaterThan(0);
  expect(totals.fragileLevels / totals.fragilePlanned).toBeGreaterThanOrEqual(
    FRAGILE_CORES * 0.9,
  );
  expect(totals.lockPlanned).toBeGreaterThan(0);
  expect(totals.lockLevels / totals.lockPlanned).toBeGreaterThanOrEqual(
    LOCK_CORES * 0.9,
  );
  expect(totals.mirrorPlanned).toBeGreaterThan(0);
  expect(totals.mirrorLevels / totals.mirrorPlanned).toBeGreaterThanOrEqual(
    MIRROR_CORES * 0.9,
  );
  expect(totals.leapPlanned).toBeGreaterThan(0);
  expect(totals.leapLevels / totals.leapPlanned).toBeGreaterThanOrEqual(
    LEAP_CORES * 0.9,
  );
}, 900_000);

// The blocker plan places on its own stream; a planned core falls back to
// zero blockers only on a failed re-proof. Measured share over 31-200 must
// stay above the v11 measurement: 31/60 = 0.517 after parking synthesis, so the
// floor sits at 0.46 (measured - 0.05).
test("flip blocker share tracks its plan curve", () => {
  let planned = 0;
  let entangled = 0;
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    if (flipCoreIds(level.arrows).length === 0) continue;
    if (planDraw(id, "flip-block") >= flipBlockFrequency(id)) continue;
    planned += 1;
    if (level.arrows.some((arrow) => arrow.id.includes("-flipb-")))
      entangled += 1;
  }
  expect(planned).toBeGreaterThan(30);
  expect(entangled / planned).toBeGreaterThan(0.46);
}, 300_000);

// Lane-blocker shares for the five certificate-led mechanics, measured over
// 31-200 on 2026-10-08 (v11) as seeded-blocker cores / planned (core placed
// AND the `<mech>-block` draw under its curve). Each floor is measured - 0.05.
// Rotor cores never entangle (multi-leg dance), so rotor has no pin; the
// shared sweep in tests/mechanic-entangle.test.ts pins that limitation.
const LANE_SHARES = [
  // 40/52 = 0.769 measured 2026-10-08; pin floor 0.72
  {
    kind: "wormhole",
    marker: "-wormhole-",
    frequency: wormholeBlockFrequency,
    floor: 0.72,
    minPlanned: 30,
  },
  // 41/51 = 0.804 measured 2026-10-08; pin floor 0.75
  {
    kind: "fragile",
    marker: "-fragile-",
    frequency: fragileBlockFrequency,
    floor: 0.75,
    minPlanned: 30,
  },
  // 30/48 = 0.625 after parking synthesis; pin floor 0.57 (measured - 0.05)
  {
    kind: "lock",
    marker: "-lock-",
    frequency: lockBlockFrequency,
    floor: 0.57,
    minPlanned: 25,
  },
  // 35/42 = 0.833 measured 2026-10-08; pin floor 0.78
  {
    kind: "mirror",
    marker: "-mirror-",
    frequency: mirrorBlockFrequency,
    floor: 0.78,
    minPlanned: 25,
  },
  // 39/48 = 0.813 measured 2026-10-08; pin floor 0.76
  {
    kind: "leap",
    marker: "-leap-",
    frequency: leapBlockFrequency,
    floor: 0.76,
    minPlanned: 25,
  },
] as const;

for (const lane of LANE_SHARES) {
  test(`${lane.kind} blocker share tracks its plan curve`, () => {
    let planned = 0;
    let entangled = 0;
    for (let id = 31; id <= 200; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      if (!level.arrows.some((arrow) => arrow.id.includes(lane.marker)))
        continue;
      const frequency = lane.frequency(id);
      if (frequency === 0 || planDraw(id, `${lane.kind}-block`) >= frequency)
        continue;
      planned += 1;
      if (
        level.arrows.some((arrow) => arrow.id.includes(`-xblock-${lane.kind}`))
      )
        entangled += 1;
    }
    expect(planned).toBeGreaterThan(lane.minPlanned);
    expect(entangled / planned).toBeGreaterThan(lane.floor);
  }, 300_000);
}

test("block curves ramp from each mechanic's first level", () => {
  expect(rotorBlockFrequency(40)).toBe(0);
  expect(rotorBlockFrequency(41)).toBeCloseTo(0.35);
  expect(rotorBlockFrequency(100)).toBeCloseTo(0.7);
  expect(wormholeBlockFrequency(36)).toBeCloseTo(0.35);
  expect(wormholeBlockFrequency(95)).toBeCloseTo(0.7);
  expect(fragileBlockFrequency(46)).toBeCloseTo(0.35);
  expect(lockBlockFrequency(51)).toBeCloseTo(0.35);
  expect(mirrorBlockFrequency(56)).toBeCloseTo(0.35);
  expect(leapBlockFrequency(61)).toBeCloseTo(0.35);
  expect(leapBlockFrequency(60)).toBe(0);
});

// The second blocker comes from a seeded coin on each `-block` stream, so the
// campaign must carry at least one id where the coin hit: otherwise the
// two-blocker half of the design would be untested dead weight. Measured at
// HEAD, 7 flip ids carry two `-flipb-` blockers.
test("a two-blocker flip id exists in the campaign", () => {
  let twoBlockers = 0;
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const blockers = cachedLevel(id).arrows.filter((arrow) =>
      arrow.id.includes("-flipb-"),
    ).length;
    expect(blockers).toBeLessThanOrEqual(2);
    if (blockers === 2) twoBlockers += 1;
  }
  expect(twoBlockers).toBeGreaterThanOrEqual(1);
}, 300_000);
