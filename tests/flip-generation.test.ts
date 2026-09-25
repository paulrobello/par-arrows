import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FLIP_PATTERNS,
  flipCoreFrequency,
  generateLevel,
} from "../src/content/procedural";
import { createGameState } from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type {
  ArrowDefinition,
  DirectionalSpotDefinition,
  LevelDefinition,
} from "../src/core/types";
import {
  flipInterest,
  hasStrandingState,
  interactionRegion,
  proveRegion,
  solveLevelTargets,
} from "../src/core/validation";
import { layoutFingerprint } from "../src/storage";

const isFlipArrow = (arrow: ArrowDefinition): boolean =>
  arrow.id.includes("-flip-");

/** Level variants covering every direction each flip spot can hold. */
function flipProbes(level: LevelDefinition): readonly LevelDefinition[] {
  let probes = [level];
  for (const spot of level.directionals ?? []) {
    if (spot.kind !== "flip") continue;
    probes = probes.flatMap((probe) => [
      probe,
      {
        ...probe,
        directionals: (probe.directionals ?? []).map((entry) =>
          entry.cell === spot.cell
            ? { ...entry, heading: flipped[entry.heading] }
            : entry,
        ),
      },
    ]);
  }
  return probes;
}

const flipped = {
  east: "west",
  west: "east",
  north: "south",
  south: "north",
} as const;

describe("generated flip cores", () => {
  test("frequency ramps from level 31 to 90", () => {
    expect(flipCoreFrequency(30)).toBe(0);
    expect(flipCoreFrequency(31)).toBeCloseTo(0.25);
    expect(flipCoreFrequency(70)).toBeCloseTo(0.25 + (0.4 * 39) / 59);
    expect(flipCoreFrequency(90)).toBeCloseTo(0.65);
    expect(flipCoreFrequency(500)).toBeCloseTo(0.65);
    expect(FLIP_PATTERNS.map((pattern) => pattern.name)).toEqual([
      "gate",
      "bounce",
      "relay",
      "relay2",
    ]);
  });

  test("every pattern keeps its properties at all four rotations", () => {
    const at = (x: number, y: number) => ({ face: "front" as const, x, y });
    const turn = (dx: number, dy: number, rotation: number): [number, number] =>
      [
        [dx, dy],
        [-dy, dx],
        [-dx, -dy],
        [dy, -dx],
      ][rotation] as [number, number];
    const cycle = ["east", "south", "west", "north"] as const;
    for (const pattern of FLIP_PATTERNS) {
      for (let rotation = 0; rotation < 4; rotation += 1) {
        const place = ([dx, dy]: readonly [number, number]) => {
          const [x, y] = turn(dx - 2, dy - 2, rotation);
          return at(4 + x, 4 + y);
        };
        const core: LevelDefinition = {
          id: 902,
          title: "Rotated core",
          gridSize: 9,
          lives: 3,
          arrows: pattern.arrows.map((entry) => ({
            id: entry.name,
            path: entry.cells.map(place),
          })),
          directionals: [
            { cell: [2, 2] as const, heading: pattern.heading },
            ...(pattern.extraSpots ?? []),
          ].map((spot) => ({
            cell: place(spot.cell),
            heading: cycle[
              (cycle.indexOf(spot.heading) + rotation) % 4
            ] as (typeof cycle)[number],
            kind: "flip" as const,
          })),
        };
        expect(hasStrandingState(core)).toBe(false);
        expect(flipInterest(core)).toBe(true);
      }
    }
  });

  // One pass over ids 2-120: every level matches the committed v8 baseline;
  // a level with a flip core carries a proven interaction region that no
  // outside track ever enters, whose flip matters, and whose core is itself
  // strand-free and flip-interesting.
  test("flip regions are proven and closed; every level matches the v8 baseline", () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("./fixtures/v8-layouts.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    const coreIds: number[] = [];
    for (let id = 2; id <= 120; id += 1) {
      const level = generateLevel(id);
      expect(layoutFingerprint(level)).toBe(baseline[id] as string);
      const core = level.arrows.filter(isFlipArrow);
      if (core.length === 0 || id === 30) continue;
      coreIds.push(id);
      expect(id).toBeGreaterThanOrEqual(31);
      const flips = (level.directionals ?? []).filter(
        (spot) => spot.kind === "flip",
      );
      expect(flips.length).toBeGreaterThanOrEqual(1);
      expect(flips.length).toBeLessThanOrEqual(3);
      const coreLevel: LevelDefinition = {
        ...level,
        arrows: core,
        stops: [],
        directionals: flips as DirectionalSpotDefinition[],
      };
      expect(hasStrandingState(coreLevel)).toBe(false);
      expect(flipInterest(coreLevel)).toBe(true);
      // What makes the core-only checks above sound: each core arrow's
      // track on the assembled level equals its track on the core board,
      // which for arrowTrack (grid, seams and spots only) is a probe
      // holding nothing but the flip spots.
      for (const arrow of core) {
        expect(arrowTrack(coreLevel, arrow)).toEqual(arrowTrack(level, arrow));
      }
      const region = interactionRegion(
        level,
        core.map((arrow) => arrow.id),
      );
      expect(region).toBeDefined();
      if (!region) continue;
      expect(proveRegion(level, createGameState(level), region)).toEqual({
        ok: true,
      });
      for (const arrow of level.arrows) {
        if (region.arrowIds.includes(arrow.id)) continue;
        const paths =
          arrow.kind === "double"
            ? [arrow.path, [...arrow.path].reverse()]
            : [arrow.path];
        for (const probe of flipProbes(level)) {
          for (const path of paths) {
            for (const cell of arrowTrack(probe, { ...arrow, path })) {
              expect(region.cells.has(cellKey(cell))).toBe(false);
            }
          }
        }
      }
      expect(solveLevelTargets(level)).toBeDefined();
    }
    expect(coreIds.length).toBeGreaterThanOrEqual(40);
  }, 600_000);
});
