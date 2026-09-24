import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FLIP_PATTERNS,
  flipCoreFrequency,
  generateLevel,
} from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey, oppositeHeading } from "../src/core/topology";
import type {
  ArrowDefinition,
  DirectionalSpotDefinition,
  LevelDefinition,
} from "../src/core/types";
import {
  flipInterest,
  hasStrandingState,
  solveLevelTargets,
} from "../src/core/validation";
import { layoutFingerprint } from "../src/storage";

const isFlipArrow = (arrow: ArrowDefinition): boolean =>
  arrow.id.includes("-flip-");

/** Every cell a core arrow can reach with the flip spot held either way. */
function coreFootprint(
  level: LevelDefinition,
  core: readonly ArrowDefinition[],
  spot: DirectionalSpotDefinition,
): ReadonlySet<string> {
  const footprint = new Set([cellKey(spot.cell)]);
  for (const heading of [spot.heading, oppositeHeading(spot.heading)]) {
    const probe: LevelDefinition = {
      ...level,
      directionals: (level.directionals ?? []).map((entry) =>
        entry === spot ? { cell: spot.cell, heading } : entry,
      ),
    };
    for (const arrow of core) {
      for (const cell of arrowTrack(probe, arrow)) {
        footprint.add(cellKey(cell));
      }
    }
  }
  return footprint;
}

describe("generated flip cores", () => {
  test("frequency ramps from level 31 to 70", () => {
    expect(flipCoreFrequency(30)).toBe(0);
    expect(flipCoreFrequency(31)).toBeCloseTo(0.25);
    expect(flipCoreFrequency(70)).toBeCloseTo(0.5);
    expect(flipCoreFrequency(500)).toBeCloseTo(0.5);
    expect(FLIP_PATTERNS.map((pattern) => pattern.name)).toEqual([
      "gate",
      "bounce",
      "relay",
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
            {
              cell: place([2, 2]),
              heading: cycle[
                (cycle.indexOf(pattern.heading) + rotation) % 4
              ] as (typeof cycle)[number],
              kind: "flip",
            },
          ],
        };
        expect(hasStrandingState(core)).toBe(false);
        expect(flipInterest(core)).toBe(true);
      }
    }
  });

  // One pass over ids 2-120: a level without a flip core must match its
  // pre-flip layout exactly; a level with one must carry an isolated core that
  // never strands and whose flip matters.
  test("flip cores are isolated and proven; every other level is unchanged", () => {
    const baseline = JSON.parse(
      readFileSync(
        new URL("./fixtures/pre-flip-layouts.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, string>;
    const coreIds: number[] = [];
    for (let id = 2; id <= 120; id += 1) {
      const level = generateLevel(id);
      const core = level.arrows.filter(isFlipArrow);
      if (core.length === 0) {
        if (id !== 30)
          expect(layoutFingerprint(level)).toBe(baseline[id] as string);
        continue;
      }
      if (id === 30) continue;
      coreIds.push(id);
      expect(id).toBeGreaterThanOrEqual(31);
      const flips = (level.directionals ?? []).filter(
        (spot) => spot.kind === "flip",
      );
      expect(flips).toHaveLength(1);
      const spot = flips[0] as DirectionalSpotDefinition;
      const coreLevel: LevelDefinition = {
        ...level,
        arrows: core,
        stops: [],
        directionals: [spot],
      };
      expect(hasStrandingState(coreLevel)).toBe(false);
      expect(flipInterest(coreLevel)).toBe(true);
      // What makes the core-only checks above sound: each core arrow's
      // track on the assembled level equals its track on the core board,
      // which for arrowTrack (grid, seams and spots only) is a probe
      // holding nothing but the flip spot.
      for (const arrow of core) {
        expect(arrowTrack(coreLevel, arrow)).toEqual(arrowTrack(level, arrow));
      }
      const footprint = coreFootprint(level, core, spot);
      for (const stop of level.stops ?? []) {
        expect(footprint.has(cellKey(stop))).toBe(false);
      }
      for (const arrow of level.arrows) {
        if (isFlipArrow(arrow)) continue;
        const paths =
          arrow.kind === "double"
            ? [arrow.path, [...arrow.path].reverse()]
            : [arrow.path];
        for (const path of paths) {
          for (const cell of arrowTrack(level, { ...arrow, path })) {
            expect(footprint.has(cellKey(cell))).toBe(false);
          }
        }
      }
      expect(solveLevelTargets(level)).toBeDefined();
    }
    expect(coreIds.length).toBeGreaterThanOrEqual(40);
  }, 600_000);
});
