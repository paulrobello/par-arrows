import { expect, test } from "bun:test";
import {
  directionalFacePlan,
  doubleArrowFrequency,
  flipBlockFrequency,
  flipCoreFrequency,
  flipCoreIds,
  fragileCorePlanned,
  getStopCount,
  isAuthoredLevel,
  leapCorePlanned,
  lockCorePlanned,
  mirrorCorePlanned,
  Rng,
  rotorCorePlanned,
  seedForLevel,
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
// stay within the standing 10% band of the shipped value: 39 of 56 planned
// cores carry blockers (0.696), so the floor sits at 0.59 (measured - 0.1).
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
  expect(entangled / planned).toBeGreaterThan(0.59);
}, 300_000);
