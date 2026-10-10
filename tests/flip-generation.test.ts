import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  flipBlockFrequency,
  flipCoreFrequency,
  flipCoreIds,
  isAuthoredLevel,
  Rng,
  seedForLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey, oppositeHeading } from "../src/core/topology";
import type {
  ArrowDefinition,
  DirectionalSpotDefinition,
  GameState,
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
import { constructFlip } from "../src/content/flip";
import { mechanicStructure, blockingStructure } from "./mechanic-structure";
import { layoutFingerprint } from "../src/storage";
import { cachedLevel } from "./generated-levels";

// FNV-1a exactly as `hashSeed` in src/content/procedural.ts (not exported).
function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash || 1;
}

const planDraw = (id: number, stream: string): number =>
  new Rng(fnv1a(`${seedForLevel(id)}:${stream}`)).next();

const trackKeys = (level: LevelDefinition, arrow: ArrowDefinition): string[] =>
  arrowTrack(level, arrow).map(cellKey);

/** Actual reachable states; change only one heading in each counterfactual. */
function safetyWitnesses(level: LevelDefinition): Map<string, Set<string>> {
  const pending: GameState[] = [createGameState(level)];
  const seen = new Set<string>();
  const witnesses = new Map(
    (level.directionals ?? []).map((s) => [cellKey(s.cell), new Set<string>()]),
  );
  const safe = (kind: string) => kind === "exit" || kind === "paused";
  while (pending.length) {
    const state = pending.pop()!;
    const key = JSON.stringify([
      state.remainingIds,
      state.spotHeadings,
      state.offsets,
      state.settledPaths,
    ]);
    if (seen.has(key)) continue;
    expect(seen.size).toBeLessThan(5000);
    seen.add(key);
    for (const id of state.remainingIds) {
      const move = simulateMove(level, state, id);
      for (const spot of level.directionals ?? []) {
        const key = cellKey(spot.cell);
        const other = simulateMove(
          level,
          {
            ...state,
            spotHeadings: {
              ...state.spotHeadings,
              [key]: oppositeHeading(state.spotHeadings?.[key] ?? spot.heading),
            },
          },
          id,
        );
        if (
          safe(move.kind) !== safe(other.kind) &&
          (move.kind === "blocked" || other.kind === "blocked")
        )
          witnesses.get(key)!.add(id);
      }
      if (safe(move.kind)) pending.push(applyMove(level, state, move));
    }
  }
  return witnesses;
}

describe("generated flip cores", () => {
  test("flip blocker frequency ramps from level 31 to 90", () => {
    expect(flipBlockFrequency(30)).toBe(0);
    expect(flipBlockFrequency(31)).toBeCloseTo(0.35);
    expect(flipBlockFrequency(60)).toBe(0);
    expect(flipBlockFrequency(61)).toBeCloseTo(0.528);
    expect(flipBlockFrequency(90)).toBeCloseTo(0.7);
    expect(flipBlockFrequency(120)).toBeCloseTo(0.7);
  });
  test("frequency ramps from level 31 to 90", () => {
    expect(flipCoreFrequency(30)).toBe(0);
    expect(flipCoreFrequency(31)).toBeCloseTo(0.25);
    expect(flipCoreFrequency(70)).toBeCloseTo(0.25 + (0.4 * 39) / 59);
    expect(flipCoreFrequency(90)).toBeCloseTo(0.65);
    expect(flipCoreFrequency(500)).toBeCloseTo(0.65);
  });

  test("independent seeds grow varied circuits with meaningful one- and two-spot interactions", () => {
    const empty: LevelDefinition = {
      id: 90,
      title: "flip topology",
      gridSize: 16,
      lives: 3,
      arrows: [],
    };
    const shapes = new Set<string>();
    const lanes = new Set<string>();
    const graphs = new Set<string>();
    const counts = new Set<number>();
    let two = 0;
    let multiFace = 0;
    let reversals = 0;
    for (let seed = 1; seed <= 64; seed++) {
      const core = constructFlip(
        empty,
        new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
        new Set(),
        new Set(),
      );
      expect(core, `seed ${seed}`).toBeDefined();
      if (!core) continue;
      expect(hasStrandingState(core)).toBe(false);
      expect(flipInterest(core)).toBe(true);
      expect(solveLevelTargets(core)).toBeDefined();
      shapes.add(mechanicStructure(core));
      lanes.add(
        mechanicStructure({
          ...core,
          arrows: core.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
        }),
      );
      graphs.add(blockingStructure(core, createGameState(core)));
      counts.add(core.arrows.length);
      if (
        new Set(core.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1
      )
        multiFace++;
      for (const probe of flipHeadingProbes(core))
        for (const arrow of core.arrows) {
          const keys = arrowTrack(probe, arrow).map(cellKey);
          for (const spot of core.directionals ?? [])
            expect(
              keys.filter((key) => key === cellKey(spot.cell)).length,
            ).toBeLessThanOrEqual(1);
        }
      const witnesses = safetyWitnesses(core);
      expect(
        [...witnesses.values()].every((ids) => ids.size > 0),
        `seed ${seed}: every spot must change safe choices`,
      ).toBe(true);
      if (witnesses.size === 2) {
        two++;
        const [first, second] = [...witnesses.values()];
        expect(
          [...first!].some((id) => second!.has(id)),
          `seed ${seed}: both spots must matter to one shared arrow`,
        ).toBe(true);
      }
      let state = createGameState(core);
      for (const target of solveLevelTargets(core) ?? []) {
        const move = simulateMove(core, state, target.arrowId);
        if (
          move.route?.some(
            (cell, i, route) =>
              i > 1 && cellKey(cell) === cellKey(route[i - 2]!),
          )
        )
          reversals++;
        expect(move.kind).toBe("exit");
        state = applyMove(core, state, move);
      }
      expect(state.remainingIds).toEqual([]);
      expect(state.lives).toBe(core.lives);
    }
    expect(shapes.size).toBeGreaterThanOrEqual(64 * 0.95);
    expect(lanes.size).toBeGreaterThanOrEqual(64 * 0.95);
    expect(graphs.size).toBeGreaterThanOrEqual(6);
    expect(counts.size).toBeGreaterThanOrEqual(3);
    expect(multiFace).toBeGreaterThan(16);
    expect(two).toBeGreaterThan(8);
    expect(two).toBeLessThan(48);
    expect(reversals).toBeGreaterThan(0);
    const full = new Set<string>();
    for (const face of ["front", "back", "left", "right", "top", "bottom"])
      for (let x = 0; x < empty.gridSize; x++)
        for (let y = 0; y < empty.gridSize; y++) full.add(`${face}:${x}:${y}`);
    expect(constructFlip(empty, new Rng(1), full, new Set())).toBeUndefined();
    expect(constructFlip(empty, new Rng(1), new Set(), full)).toBeUndefined();
  }, 60_000);

  // Preserve the actual shared-spot regression independently of later
  // optional-mechanic rerolls. Captured from level 124 at f8bda3eb.
  test("a later fragile reroll preserves shared two-spot safety", () => {
    const core = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/fragile-shared-flip-regression.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as LevelDefinition;
    expect(core.directionals!.length).toBe(2);
    const [first, second] = [...safetyWitnesses(core).values()];
    expect([...first!].some((id) => second!.has(id))).toBe(true);
  });

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
    const shapes = new Set<string>();
    const lanes = new Set<string>();
    const graphs = new Set<string>();
    let two = 0;
    for (let id = 2; id <= 200; id += 1) {
      const level = cachedLevel(id);
      expect(layoutFingerprint(level)).toBe(baseline[id] as string);
      const seeds = new Set(flipCoreIds(level.arrows));
      const core = level.arrows.filter((arrow) => seeds.has(arrow.id));
      if (core.length === 0 || id === 30) continue;
      coreIds.push(id);
      expect(id).toBeGreaterThanOrEqual(31);
      const flips = (level.directionals ?? []).filter(
        (spot) => spot.kind === "flip",
      );
      expect(flips.length).toBeGreaterThanOrEqual(1);
      expect(flips.length).toBeLessThanOrEqual(2);
      const coreLevel: LevelDefinition = {
        ...level,
        arrows: core,
        stops: [],
        directionals: flips as DirectionalSpotDefinition[],
      };
      expect(hasStrandingState(coreLevel)).toBe(false);
      expect(flipInterest(coreLevel)).toBe(true);
      shapes.add(mechanicStructure(coreLevel));
      lanes.add(
        mechanicStructure({
          ...coreLevel,
          arrows: core.map((a) => ({ ...a, path: a.path.slice(-2) })),
        }),
      );
      graphs.add(blockingStructure(coreLevel, createGameState(coreLevel)));
      const witnesses = safetyWitnesses(coreLevel);
      expect([...witnesses.values()].every((ids) => ids.size > 0)).toBe(true);
      if (witnesses.size === 2) {
        two++;
        const [first, second] = [...witnesses.values()];
        expect(
          [...first!].some((arrowId) => second!.has(arrowId)),
          "level " + id + ": both spots must affect one shared arrow",
        ).toBe(true);
      }
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
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-flipb-"),
      );
      if (blockers.length > 0) {
        // Closure must have absorbed the blockers and their chain.
        expect(region.arrowIds).toEqual(
          expect.arrayContaining(blockers.map((b) => b.id)),
        );
        // A1: the dance is gated behind a blocker on some core lane.
        const coreTrack = new Set(
          core.flatMap((arrow) => [
            ...arrow.path.map(cellKey),
            ...trackKeys(level, arrow),
          ]),
        );
        expect(
          blockers.some((blocker) =>
            blocker.path.some((cell) => coreTrack.has(cellKey(cell))),
          ),
        ).toBe(true);
      }
    }
    expect(coreIds.length).toBeGreaterThanOrEqual(40);
    expect(shapes.size / coreIds.length).toBeGreaterThanOrEqual(0.95);
    expect(lanes.size / coreIds.length).toBeGreaterThanOrEqual(0.95);
    expect(graphs.size).toBeGreaterThanOrEqual(6);
    expect(two).toBeGreaterThan(5);
  }, 600_000);
  test("entangled flip cores carry well-formed blockers on their lanes", () => {
    let found = 0;
    for (let id = 31; id <= 120; id += 1) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      const coreIdList = flipCoreIds(level.arrows);
      if (coreIdList.length === 0) continue;
      const cores = level.arrows.filter((arrow) =>
        coreIdList.includes(arrow.id),
      );
      if (planDraw(id, "flip-block") >= flipBlockFrequency(id)) continue;
      if (found >= 3) continue;
      const blockers = level.arrows.filter((arrow) =>
        arrow.id.includes("-flipb-"),
      );
      if (blockers.length === 0) continue; // legitimate fallback ids
      found += 1;
      expect(blockers.length).toBeLessThanOrEqual(2);
      const coreTrack = new Set(
        cores.flatMap((core) => [
          ...core.path.map(cellKey),
          ...trackKeys(level, core),
        ]),
      );
      const seenCells = new Set<string>();
      for (const blocker of blockers) {
        for (const cell of blocker.path) {
          expect(seenCells.has(cellKey(cell))).toBe(false);
          seenCells.add(cellKey(cell));
        }
      }
      for (const blocker of blockers) {
        expect(blocker.path.length).toBeGreaterThanOrEqual(3);
        expect(blocker.path.length).toBeLessThanOrEqual(10);
        const onTrack = blocker.path.some((cell) =>
          coreTrack.has(cellKey(cell)),
        );
        expect(onTrack).toBe(true);
      }
    }
    expect(found).toBeGreaterThanOrEqual(3);
  }, 300_000);
});

test("entangled boards open with the blocker chain, not the dance", () => {
  let checked = 0;
  for (let id = 31; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const blockers = level.arrows.filter((arrow) =>
      arrow.id.includes("-flipb-"),
    );
    if (blockers.length === 0) continue;
    checked += 1;
    // Some core arrow carries a blocker prerequisite: the dance cannot begin
    // before a blocker move.
    const coreIds = new Set(flipCoreIds(level.arrows));
    const cores = level.arrows.filter((arrow) => coreIds.has(arrow.id));
    const coreTrack = new Set(
      cores.flatMap((core) => [
        ...core.path.map(cellKey),
        ...trackKeys(level, core),
      ]),
    );
    expect(
      blockers.some((blocker) =>
        blocker.path.some((cell) => coreTrack.has(cellKey(cell))),
      ),
    ).toBe(true);
    // The board is clearable at play time.
    expect(solveLevelTargets(level)).toBeDefined();
  }
  expect(checked).toBeGreaterThanOrEqual(3);
}, 600_000);
