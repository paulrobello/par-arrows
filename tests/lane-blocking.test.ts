import { describe, expect, test } from "bun:test";
import {
  FRAGILE_CORE_MARKER,
  LEAP_CORE_MARKER,
  LOCK_CORE_MARKER,
  MIRROR_CORE_MARKER,
} from "../src/content/procedural";
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
];

const LANE_MECHANICS = [
  { name: "wormhole", marker: "-wormhole-", ids: [44, 48, 49, 53] },
  { name: "fragile", marker: FRAGILE_CORE_MARKER, ids: [46, 52, 57] },
  { name: "lock", marker: LOCK_CORE_MARKER, ids: [64, 67, 70] },
  { name: "mirror", marker: MIRROR_CORE_MARKER, ids: [57, 67, 69] },
  { name: "leap", marker: LEAP_CORE_MARKER, ids: [61, 64, 69] },
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
          coreArrows.flatMap((arrow) =>
            arrowTrack(level, arrow).slice(arrow.path.length).map(cellKey),
          ),
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
