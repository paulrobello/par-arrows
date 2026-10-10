import { growMechanicBody } from "./mechanic-body";
import { constructParking } from "./parking";
import type { Rng } from "./procedural";
import { cellKey } from "../core/topology";
import { arrowTrack } from "../core/stops";
import { createGameState, simulateMove } from "../core/game-state";
import {
  solveLevelTargets,
  validateLevel,
  hasStrandingState,
  hasSoftLockState,
} from "../core/validation";

import type {
  LevelDefinition,
  ArrowDefinition,
  Cell,
  MoveTarget,
} from "../core/types";
export interface LeapConstruction {
  readonly arrows: readonly ArrowDefinition[];
  readonly pad: Cell;
  readonly certificate: readonly MoveTarget[];
}
/** Grow a native body cycle and skip its actual first collision. The
 * continuation body grows around the contact; the engine proves the jump,
 * landing and every safe unwind. Exhaustion supplies no coordinate gadget. */
export function constructLeap(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  limit = 32,
  glyphForbidden: ReadonlySet<string> = occupied,
): LeapConstruction | undefined {
  const bare: LevelDefinition = {
    id: level.id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    arrows: [],
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  for (let attempt = 0; attempt < limit; attempt++) {
    const native = constructParking(bare, rng, occupied, 1, false, true, 16);
    if (!native || native.arrows.some((a) => a.path.length < 3)) continue;
    let arrows = native.arrows.map((a, i) => ({
      ...a,
      id: `r${level.id}-leap-${i === 0 ? "leaper" : i === 1 ? "blocker" : `c${i}`}`,
    }));
    const nativeBoard = { ...bare, arrows },
      p = arrows[0]!;
    const hold = arrows[1]!;
    const protectedCells = new Set([
      ...occupied,
      ...arrows
        .filter((a) => a.id !== hold.id)
        .flatMap((a) => a.path.map(cellKey)),
      ...arrowTrack(nativeBoard, p).map(cellKey),
    ]);
    const extended = growMechanicBody(
      bare,
      rng,
      [...hold.path],
      protectedCells,
      hold.path.length + 1 + rng.int(6),
    );
    if (extended.length === hold.path.length) continue;
    arrows = arrows.map((a) =>
      a.id === hold.id ? { ...a, path: extended } : a,
    );
    const board = { ...bare, arrows };
    const route = arrowTrack(board, p).slice(p.path.length);
    const bodies = new Set(arrows.slice(1).flatMap((a) => a.path.map(cellKey)));
    const contact = route.findIndex((c) => bodies.has(cellKey(c)));
    if (
      contact < 1 ||
      !route[contact + 1] ||
      bodies.has(cellKey(route[contact + 1]!))
    )
      continue;
    const pad = route[contact - 1]!;
    if (glyphForbidden.has(cellKey(pad))) continue;
    const full = { ...board, leaps: [pad] };
    const move = simulateMove(full, createGameState(full), p.id),
      ground = simulateMove(board, createGameState(board), p.id);
    if (
      !validateLevel(full).valid ||
      move.kind !== "exit" ||
      ground.kind !== "blocked" ||
      !ground.contact ||
      move.leaps?.length !== 1 ||
      !bodies.has(cellKey(move.leaps[0]!.over)) ||
      cellKey(move.leaps[0]!.over) !== cellKey(ground.contact.cell)
    )
      continue;
    if (
      full.arrows.some((a) =>
        arrowTrack(full, a).some((c) => occupied.has(cellKey(c))),
      )
    )
      continue;
    const certificate = solveLevelTargets(full);
    if (
      !certificate ||
      solveLevelTargets(board) ||
      hasStrandingState(full) !== false ||
      hasSoftLockState(full) !== false
    )
      continue;
    return { arrows: full.arrows, pad, certificate };
  }
}
