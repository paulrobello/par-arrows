import { expect, test } from "bun:test";
import {
  directionalFacePlan,
  doubleArrowFrequency,
  flipCoreFrequency,
  getStopCount,
  isAuthoredLevel,
  Rng,
  seedForLevel,
  wormholePlan,
} from "../src/content/procedural";
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
  };
  for (let id = 2; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    totals.staticPlanned += directionalFacePlan(id).reduce(
      (sum, count) => sum + count,
      0,
    );
    totals.staticPlaced += (level.directionals ?? []).filter(
      (spot) => spot.kind !== "flip",
    ).length;
    totals.holesPlanned += wormholePlan(id);
    totals.holesPlaced += level.wormholes?.length ?? 0;
    totals.stopBudget += getStopCount(id);
    totals.stops += level.stops?.length ?? 0;
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
  }
  expect(totals.staticPlaced / totals.staticPlanned).toBeGreaterThanOrEqual(
    V9.staticSpots * 0.9,
  );
  expect(totals.holesPlaced / totals.holesPlanned).toBeGreaterThanOrEqual(
    V9.wormholes * 0.9,
  );
  expect(totals.stops).toBe(totals.stopBudget);
  expect(totals.groups).toBe(totals.groupEligible);
  expect(totals.flipPlanned).toBeGreaterThan(0);
  expect(totals.flipLevels / totals.flipPlanned).toBeGreaterThanOrEqual(
    V9.flipCores * 0.9,
  );
  expect(totals.doublePlanned).toBeGreaterThan(0);
  expect(totals.doubleLevels / totals.doublePlanned).toBeGreaterThanOrEqual(
    V9.doubles * 0.9,
  );
}, 900_000);
