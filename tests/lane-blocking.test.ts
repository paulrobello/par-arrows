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
  { name: "wormhole", marker: "-wormhole-", ids: [44, 48, 49, 53] },
  { name: "fragile", marker: FRAGILE_CORE_MARKER, ids: [46, 52, 57] },
  { name: "lock", marker: LOCK_CORE_MARKER, ids: [64, 67, 70] },
  { name: "mirror", marker: MIRROR_CORE_MARKER, ids: [57, 67, 69] },
  { name: "leap", marker: LEAP_CORE_MARKER, ids: [61, 64, 69] },
  { name: "double", marker: "-double-", ids: [34, 41, 51, 68] },
  { name: "directional", marker: "-dir-", ids: [21, 24, 33, 62] },
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

// Measured 2026-10-08 over each mechanic's first level to 200, stride 3
// (placed cores only); floor is measured minus 0.05.
const COVERAGE_FLOOR: Record<(typeof LANE_MECHANICS)[number]["name"], number> =
  {
    wormhole: 0.95, // 1.00 measured (28/28)
    fragile: 0.95, // 1.00 measured (29/29)
    lock: 0.95, // 1.00 measured (26/26)
    mirror: 0.95, // 1.00 measured (26/26)
    leap: 0.95, // 1.00 measured (25/25)
    double: 0.91, // 0.96 measured (25/26), tail lane
    directional: 0.95, // 1.00 measured (42/42)
  };

describe("natural lane blocking coverage", () => {
  for (const mechanic of LANE_MECHANICS) {
    test(`${mechanic.name}: nearly every placed core lane carries a fill body`, () => {
      let placed = 0;
      let blocked = 0;
      for (let id = mechanic.ids[0]; id <= 200; id += 3) {
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
      expect(placed).toBeGreaterThan(20);
      expect(blocked / placed).toBeGreaterThanOrEqual(
        COVERAGE_FLOOR[mechanic.name],
      );
    }, 600_000);
  }
});
