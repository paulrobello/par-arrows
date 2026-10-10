import { simulateMove } from "../src/core/game-state";
import { cellToWorld, stepSurface } from "../src/core/topology";
import type { Cell, GameState, LevelDefinition } from "../src/core/types";

/** Canonical directed blocking graph, independent of coordinates and ids.
 * The parked vertex is colored; long tails and moved heads cannot disguise
 * the same actual blocker relationships as a different circuit. */
export function blockingStructure(
  level: LevelDefinition,
  state: GameState,
): string {
  const ids = level.arrows.map((arrow) => arrow.id);
  const moves = ids.map((id) => simulateMove(level, state, id));
  const variants: string[] = [];
  const visit = (order: number[], remaining: number[]): void => {
    if (remaining.length) {
      for (const next of remaining)
        visit(
          [...order, next],
          remaining.filter((i) => i !== next),
        );
      return;
    }
    variants.push(
      JSON.stringify(
        order.map((index) => {
          const id = ids[index]!;
          const move = moves[index]!;
          const blocker = move.blockerId ? ids.indexOf(move.blockerId) : -1;
          return [
            Boolean(state.settledPaths?.[id] || state.offsets?.[id]),
            move.kind,
            order.indexOf(blocker),
          ];
        }),
      ),
    );
  };
  visit(
    [],
    ids.map((_, index) => index),
  );
  return variants.sort()[0]!;
}

/** Canonicalize ALL cells together under translation and the 48 cube isometries.
 * A rotated, mirrored or transplanted gadget counts as the same structure. */
export function mechanicStructure(level: LevelDefinition): string {
  const cells = [
    ...level.arrows.flatMap((arrow) => arrow.path),
    ...(level.stops ?? []),
    ...(level.fragile ?? []),
    ...(level.leaps ?? []),
    ...(level.locks ?? []).flatMap((lock) => [lock.key, lock.lock]),
    ...(level.mirrors ?? []).map((mirror) => mirror.cell),
    ...(level.wormholes ?? []).flatMap((w) => [w.a, w.b]),
    ...(level.directionals ?? []).map((spot) => spot.cell),
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
          level.fragile?.map(encode).sort(),
          level.leaps?.map(encode).sort(),
          level.locks
            ?.map((lock) => [encode(lock.key), encode(lock.lock)])
            .sort(),
          // Mirror orientation is deliberately ignored: an orientation draw
          // must not inflate the measured diversity of body/glyph layouts.
          level.mirrors?.map((mirror) => encode(mirror.cell)).sort(),
          level.wormholes
            ?.map((w) => [encode(w.a), encode(w.b)].sort().join(";"))
            .sort(),
          level.directionals
            ?.map((spot) => {
              const start = transformed(spot.cell);
              const next = transformed(
                stepSurface(spot.cell, spot.heading, level.gridSize),
              );
              return [
                encode(spot.cell),
                spot.kind ?? "static",
                next.map((v, i) => v - start[i]!),
              ].join(";");
            })
            .sort(),
        ]),
      );
    }
  return variants.sort()[0]!;
}

/** Colored actual blocker graph retaining both choices of a double arrow. */
export function endpointBlockingStructure(
  level: LevelDefinition,
  state: GameState,
): string {
  const arrows = level.arrows;
  const moves = arrows.map((a) => [
    simulateMove(level, state, a.id),
    ...(a.kind === "double" ? [simulateMove(level, state, a.id, "tail")] : []),
  ]);
  const variants: string[] = [];
  const visit = (order: number[], remaining: number[]): void => {
    if (remaining.length) {
      for (const next of remaining)
        visit(
          [...order, next],
          remaining.filter((i) => i !== next),
        );
      return;
    }
    variants.push(
      JSON.stringify(
        order.map((index) => [
          arrows[index]!.kind === "double",
          moves[index]!.map((move) => [
            move.kind,
            order.indexOf(
              move.blockerId
                ? arrows.findIndex((a) => a.id === move.blockerId)
                : -1,
            ),
          ]),
        ]),
      ),
    );
  };
  visit(
    [],
    arrows.map((_, index) => index),
  );
  return variants.sort()[0]!;
}
