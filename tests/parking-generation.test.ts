import { describe, expect, test } from "bun:test";
import { constructParking } from "../src/content/parking";
import { getStopCount, isAuthoredLevel, Rng } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { arrowTrack } from "../src/core/stops";
import { cellKey, cellToWorld } from "../src/core/topology";
import type { Cell, LevelDefinition } from "../src/core/types";
import {
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { cachedLevel } from "./generated-levels";

/** Canonicalize ALL cells together under translation and the 48 cube isometries.
 * A rotated, mirrored or transplanted gadget counts as the same structure. */
function structure(level: LevelDefinition): string {
  const cells = [
    ...level.arrows.flatMap((arrow) => arrow.path),
    ...(level.stops ?? []),
  ];
  const axes = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const variants: string[] = [];
  for (const axis of axes)
    for (let mask = 0; mask < 8; mask += 1) {
      const transformed = (cell: Cell): number[] => {
        const world = cellToWorld(cell, level.gridSize);
        return axis.map(
          (a, i) =>
            Math.round(world[a!]! * level.gridSize) *
            (mask & (1 << i) ? -1 : 1),
        );
      };
      const points = cells.map(transformed);
      const origin = [0, 1, 2].map((i) =>
        Math.min(...points.map((point) => point[i]!)),
      );
      const encode = (cell: Cell): string =>
        transformed(cell)
          .map((value, i) => value - origin[i]!)
          .join(",");
      variants.push(
        JSON.stringify([
          level.arrows.map((arrow) => arrow.path.map(encode).join(";")).sort(),
          level.stops?.map(encode).sort(),
        ]),
      );
    }
  return variants.sort()[0]!;
}

const empty: LevelDefinition = {
  id: 6,
  title: "parking construction",
  gridSize: 12,
  lives: 3,
  arrows: [],
};

describe("parking built from puzzle topology", () => {
  test("the diversity oracle identifies rotated, mirrored, transplanted and reordered copies", () => {
    const base: LevelDefinition = {
      ...empty,
      arrows: [
        {
          id: "p",
          path: [
            { face: "front", x: 2, y: 2 },
            { face: "front", x: 3, y: 2 },
            { face: "front", x: 3, y: 3 },
          ],
        },
        {
          id: "f",
          path: [
            { face: "front", x: 5, y: 2 },
            { face: "front", x: 5, y: 3 },
          ],
        },
      ],
      stops: [{ face: "front", x: 3, y: 5 }],
    };
    for (const mirrored of [false, true]) {
      const move = (cell: Cell): Cell => ({
        face: "right",
        x: 2 + cell.y,
        y: mirrored ? 2 + cell.x : 10 - cell.x,
      });
      const copy = {
        ...base,
        arrows: [...base.arrows].reverse().map((arrow, index) => ({
          id: `renamed${index}`,
          path: arrow.path.map(move),
        })),
        stops: base.stops!.map(move),
      };
      expect(structure(copy)).toBe(structure(base));
    }
  });

  test("independent seeds produce real structural variation and required, safe interactions", () => {
    const shapes = new Map<string, number>();
    const counts = new Set<number>();
    let crossFace = 0;
    let placed = 0;
    for (let seed = 1; seed <= 64; seed += 1) {
      const core = constructParking(empty, new Rng(seed), new Set(), 3);
      expect(core, `seed ${seed}`).toBeDefined();
      if (!core) continue;
      placed += 1;
      const board = { ...empty, ...core };
      expect(validateLevel(board).valid).toBe(true);
      expect(solveLevelTargets(board)).toBeDefined();
      expect(solveLevelTargets({ ...board, stops: [] })).toBeUndefined();
      expect(hasStrandingState(board)).toBe(false);
      const initial = createGameState(board);
      const parker = board.arrows[0]!;
      const freed = board.arrows[board.arrows.length - 1]!;
      expect(simulateMove(board, initial, freed.id).kind).toBe("blocked");
      const park = simulateMove(board, initial, parker.id);
      expect(park.kind).toBe("paused");
      const parked = applyMove(board, initial, park);
      expect(simulateMove(board, parked, freed.id).kind).toBe("exit");
      expect(simulateMove(board, parked, parker.id).kind).toBe("blocked");
      const key = structure(board);
      shapes.set(key, (shapes.get(key) ?? 0) + 1);
      counts.add(core.arrows.length);
      if (
        new Set(
          core.arrows.flatMap((arrow) => arrow.path.map((cell) => cell.face)),
        ).size > 1
      )
        crossFace += 1;
      // The old classic tutorial stamp had two straight two-cell arrows.
      expect(core.arrows.every((arrow) => arrow.path.length >= 3)).toBe(true);
    }
    expect(placed).toBe(64);
    expect(shapes.size / placed).toBeGreaterThanOrEqual(0.95);
    expect(Math.max(...shapes.values())).toBeLessThanOrEqual(2);
    expect([...counts].sort()).toEqual([3, 4, 5]);
    expect(crossFace).toBeGreaterThanOrEqual(16);
  }, 30_000);

  test("determinism, occupied cells, exhausted budgets, and bounded failure", () => {
    const occupied = new Set(["back:4:8", "back:4:7", "front:0:0"]);
    const first = constructParking(empty, new Rng(1), occupied, 1);
    expect(first).toBeDefined();
    expect(first).toEqual(constructParking(empty, new Rng(1), occupied, 1));
    for (const arrow of first?.arrows ?? []) {
      expect(
        arrowTrack(empty, arrow).some((cell) => occupied.has(cellKey(cell))),
      ).toBe(false);
    }
    expect(constructParking(empty, new Rng(1), occupied, 0)).toBeUndefined();
    const full = new Set<string>();
    for (const face of ["front", "back", "left", "right", "top", "bottom"])
      for (let x = 0; x < empty.gridSize; x += 1)
        for (let y = 0; y < empty.gridSize; y += 1)
          full.add(`${face}:${x}:${y}`);
    expect(constructParking(empty, new Rng(1), full, 1)).toBeUndefined();
  });

  test("shipped parking is varied and ordinary fill genuinely blocks its lanes", () => {
    const shapes = new Set<string>();
    let placed = 0;
    let eligible = 0;
    let blocked = 0;
    for (const id of [
      ...Array.from({ length: 65 }, (_, i) => 6 + i * 3),
      1_000,
      10_000,
      1_000_000,
    ]) {
      if (isAuthoredLevel(id)) continue;
      const level = cachedLevel(id);
      if (getStopCount(id) > 0) eligible += 1;
      const arrows = level.arrows.filter((arrow) =>
        arrow.id.includes("-park-"),
      );
      if (!arrows.length) continue;
      placed += 1;
      const stops = (level.stops ?? []).filter((stop) =>
        arrowTrack(
          level,
          arrows.find((arrow) => arrow.id.endsWith("-park-p"))!,
        ).some((cell) => cellKey(cell) === cellKey(stop)),
      );
      const core = {
        ...level,
        arrows: [
          arrows.find((arrow) => arrow.id.endsWith("-park-p"))!,
          ...arrows.filter((arrow) => !arrow.id.endsWith("-park-p")),
        ],
        stops,
      };
      shapes.add(structure(core));
      expect(solveLevelTargets({ ...core, stops: [] })).toBeUndefined();
      const lanes = new Set(
        arrows.flatMap((arrow) =>
          arrowTrack(level, arrow).slice(arrow.path.length).map(cellKey),
        ),
      );
      const ordinary = level.arrows.filter((arrow) =>
        /^r\d+-\d+$/.test(arrow.id),
      );
      const blocker = ordinary.find((arrow) =>
        arrow.path.some((cell) => lanes.has(cellKey(cell))),
      );
      if (blocker) {
        const witness = { ...core, arrows: [...core.arrows, blocker] };
        const sequence = solveLevelTargets(core);
        expect(sequence).toBeDefined();
        let state = createGameState(witness);
        let required = false;
        for (const target of sequence ?? []) {
          let move = simulateMove(
            witness,
            state,
            target.arrowId,
            target.endpoint,
          );
          if (move.kind === "blocked" && move.blockerId === blocker.id) {
            required = true;
            // Counterfactual removal: the same certified action must become
            // safe once this ordinary fill body has cleared its lane.
            state = {
              ...state,
              remainingIds: state.remainingIds.filter(
                (arrowId) => arrowId !== blocker.id,
              ),
            };
            move = simulateMove(
              witness,
              state,
              target.arrowId,
              target.endpoint,
            );
          }
          expect(["exit", "paused"], `level ${id}`).toContain(move.kind);
          state = applyMove(witness, state, move);
        }
        expect(required, `level ${id} has only cosmetic lane blocking`).toBe(
          true,
        );
        expect(state.remainingIds).toEqual([]);
        expect(state.lives).toBe(witness.lives);
        blocked += 1;
      }
      expect(solveLevelTargets(level), `level ${id}`).toBeDefined();
    }
    expect(placed).toBeGreaterThanOrEqual(eligible * 0.9);
    expect(placed).toBeGreaterThan(20);
    expect(shapes.size / placed).toBeGreaterThanOrEqual(0.95);
    expect(blocked / placed).toBeGreaterThanOrEqual(0.95);
  }, 180_000);
});
