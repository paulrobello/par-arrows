import { describe, expect, test } from "bun:test";
import {
  FRAGILE_CORE_MARKER,
  LEAP_CORE_MARKER,
  LOCK_CORE_MARKER,
  MIRROR_CORE_MARKER,
} from "../src/content/procedural";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { validateLevel } from "../src/core/validation";
import { cachedLevel } from "./generated-levels";

// Arrow ids that belong to a seeded structure rather than the fill: core
// markers, lane blockers, flip blockers, and the flip/rotor region.
const SEEDED = [
  FRAGILE_CORE_MARKER,
  LOCK_CORE_MARKER,
  MIRROR_CORE_MARKER,
  LEAP_CORE_MARKER,
  "-wormhole-",
  "-xblock-",
  "-flipb-",
  "-flip-",
  "-rotor-",
  "-double-",
  "-dir-",
  "-park-",
];

// A double's certified move is its tail, so its lane runs from the reversed path.
function coreLaneKeys(
  level: LevelDefinition,
  arrow: ArrowDefinition,
): string[] {
  const oriented =
    arrow.kind === "double"
      ? { ...arrow, path: [...arrow.path].reverse() }
      : arrow;
  return arrowTrack(level, oriented).slice(arrow.path.length).map(cellKey);
}

const LANE_MECHANICS = [
  {
    name: "wormhole",
    firstLevel: 36,
    marker: "-wormhole-",
    ids: [44, 48, 49, 53],
  },
  {
    name: "fragile",
    firstLevel: 46,
    marker: FRAGILE_CORE_MARKER,
    ids: [46, 52, 57],
  },
  { name: "lock", firstLevel: 51, marker: LOCK_CORE_MARKER, ids: [64, 67, 70] },
  {
    name: "mirror",
    firstLevel: 56,
    marker: MIRROR_CORE_MARKER,
    ids: [57, 67, 69],
  },
  { name: "leap", firstLevel: 61, marker: LEAP_CORE_MARKER, ids: [61, 64, 69] },
  { name: "double", firstLevel: 26, marker: "-double-", ids: [34, 41, 51, 68] },
  {
    name: "directional",
    firstLevel: 21,
    marker: "-dir-",
    ids: [21, 24, 33, 62],
  },
] as const;

describe("mechanic lanes join the dependency fill", () => {
  for (const mechanic of LANE_MECHANICS) {
    test(`${mechanic.name} core lane carries a natural fill blocker`, () => {
      for (const id of mechanic.ids) {
        const level = cachedLevel(id);
        const coreArrows = level.arrows.filter((arrow) =>
          arrow.id.includes(mechanic.marker),
        );
        expect(coreArrows.length).toBeGreaterThan(0);
        const laneKeys = new Set(
          coreArrows.flatMap((arrow) => coreLaneKeys(level, arrow)),
        );
        const fill = level.arrows.filter(
          (arrow) => !SEEDED.some((marker) => arrow.id.includes(marker)),
        );
        const blockedLane = fill.some((arrow) =>
          arrow.path.some((cell) => laneKeys.has(cellKey(cell))),
        );
        expect(blockedLane).toBe(true);
        expect(validateLevel(level).valid).toBe(true);
      }
    });
  }
});

// Sweep: each mechanic's first level to 200, stride 3, placed cores only.
const COVERAGE_FLOOR: Record<(typeof LANE_MECHANICS)[number]["name"], number> =
  {
    wormhole: 0.95, // 1.00 measured 2026-10-08 (25/25); pin floor 0.95
    fragile: 0.95, // 1.00 measured 2026-10-08 (29/29); pin floor 0.95
    lock: 0.95, // 1.00 measured 2026-10-08 (22/22); pin floor 0.95
    mirror: 0.95, // 1.00 measured 2026-10-08 (20/20); pin floor 0.95
    leap: 0.95, // 1.00 measured 2026-10-08 (25/25); pin floor 0.95
    double: 0.95, // 1.00 measured 2026-10-08 (26/26, tail lane); pin floor 0.95
    directional: 0.95, // 1.00 measured 2026-10-08 (42/42); pin floor 0.95
  };

describe("natural lane blocking coverage", () => {
  for (const mechanic of LANE_MECHANICS) {
    test(`${mechanic.name}: nearly every placed core lane carries a fill body`, () => {
      let placed = 0;
      let blocked = 0;
      for (let id = mechanic.firstLevel; id <= 200; id += 3) {
        const level = cachedLevel(id);
        const coreArrows = level.arrows.filter((arrow) =>
          arrow.id.includes(mechanic.marker),
        );
        if (coreArrows.length === 0) continue;
        placed += 1;
        const keys = new Set(
          coreArrows.flatMap((arrow) => coreLaneKeys(level, arrow)),
        );
        const fill = level.arrows.filter(
          (arrow) => !SEEDED.some((marker) => arrow.id.includes(marker)),
        );
        if (
          fill.some((arrow) =>
            arrow.path.some((cell) => keys.has(cellKey(cell))),
          )
        )
          blocked += 1;
      }
      expect(placed).toBeGreaterThan(15);
      expect(blocked / placed).toBeGreaterThanOrEqual(
        COVERAGE_FLOOR[mechanic.name],
      );
    }, 600_000);
  }
});

// Parking synthesis exposes a latent blocker reservation bug on this seed:
// a seeded lock blocker crossed a portal end even though ordinary fill did not.
test("seeded lane blockers stay off every other mechanic cell (level 114)", () => {
  const level = cachedLevel(114);
  const cells = new Set([
    ...(level.wormholes ?? []).flatMap((entry) => [
      cellKey(entry.a),
      cellKey(entry.b),
    ]),
    ...(level.fragile ?? []).map(cellKey),
    ...(level.locks ?? []).flatMap((entry) => [
      cellKey(entry.key),
      cellKey(entry.lock),
    ]),
    ...(level.mirrors ?? []).map((entry) => cellKey(entry.cell)),
    ...(level.leaps ?? []).map(cellKey),
  ]);
  expect(cells.size).toBeGreaterThan(0);
  const blockers = level.arrows.filter((arrow) =>
    arrow.id.includes("-xblock-"),
  );
  expect(blockers.length).toBeGreaterThan(0);
  for (const arrow of blockers)
    expect(
      arrowTrack({ ...level, wormholes: [] }, arrow).some((cell) =>
        cells.has(cellKey(cell)),
      ),
    ).toBe(false);
});
