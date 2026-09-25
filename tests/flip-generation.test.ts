import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FLIP_PATTERNS,
  flipCoreFrequency,
  generateLevel,
} from "../src/content/procedural";
import { createGameState, simulateMove } from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import type {
  ArrowDefinition,
  DirectionalSpotDefinition,
  LevelDefinition,
} from "../src/core/types";
import {
  flipHeadingProbes,
  flipInterest,
  hasStrandingState,
  interactionRegion,
  proveRegion,
  solveLevelTargets,
} from "../src/core/validation";
import { layoutFingerprint } from "../src/storage";

const isFlipArrow = (arrow: ArrowDefinition): boolean =>
  arrow.id.includes("-flip-");

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

  // The relay2 chain's point: the lid's safety depends on each of the two
  // spots on its own. For each spot there is a state pair differing only in
  // that spot's heading where the lid's tap flips between exit and blocked.
  test("relay2's lid depends on each spot independently", () => {
    const pattern = FLIP_PATTERNS.find((entry) => entry.name === "relay2");
    expect(pattern).toBeDefined();
    if (!pattern) return;
    const at = ([x, y]: readonly [number, number]) => ({
      face: "front" as const,
      x: x + 2,
      y: y + 2,
    });
    const spots: DirectionalSpotDefinition[] = [
      { cell: [2, 2] as const, heading: pattern.heading },
      ...(pattern.extraSpots ?? []),
    ].map((spot) => ({
      cell: at(spot.cell),
      heading: spot.heading,
      kind: "flip" as const,
    }));
    expect(spots).toHaveLength(2);
    const level: LevelDefinition = {
      id: 903,
      title: "relay2",
      gridSize: 9,
      lives: 3,
      arrows: pattern.arrows.map((entry) => ({
        id: entry.name,
        path: entry.cells.map(at),
      })),
      directionals: spots,
    };
    const flipped = {
      east: "west",
      west: "east",
      north: "south",
      south: "north",
    } as const;
    const combos = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ] as const;
    const lidKind = (
      remainingIds: readonly string[],
      reversed: readonly boolean[],
    ): string => {
      const spotHeadings = Object.fromEntries(
        spots.map((spot, index) => [
          cellKey(spot.cell),
          reversed[index] ? flipped[spot.heading] : spot.heading,
        ]),
      );
      return simulateMove(
        level,
        { ...createGameState(level), remainingIds, spotHeadings },
        "lid",
      ).kind;
    };
    const safe = (kind: string) => kind === "exit" || kind === "paused";
    // Every subset of the other arrows, so the witness can come from any
    // board the lid might face.
    const others = level.arrows
      .map((arrow) => arrow.id)
      .filter((id) => id !== "lid");
    const boards = Array.from({ length: 1 << others.length }, (_, mask) => [
      "lid",
      ...others.filter((_, bit) => mask & (1 << bit)),
    ]);
    spots.forEach((_, spotIndex) => {
      const witnessed = boards.some((board) =>
        combos.some((combo) => {
          const other = combo.map((value, index) =>
            index === spotIndex ? !value : value,
          );
          const first = lidKind(board, combo);
          const second = lidKind(board, other);
          return (
            safe(first) !== safe(second) &&
            (first === "blocked" || second === "blocked")
          );
        }),
      );
      expect(witnessed, `spot ${spotIndex}`).toBe(true);
    });
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
        for (const probe of flipHeadingProbes(level)) {
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
