import { constructParking } from "./parking";
import type { Rng } from "./procedural";
import { cellKey, headingForPath, oppositeHeading } from "../core/topology";
import { arrowTrack } from "../core/stops";
import { createGameState, simulateMove, applyMove } from "../core/game-state";
import {
  solveLevelTargets,
  validateLevel,
  hasStrandingState,
  hasSoftLockState,
} from "../core/validation";
import type { LevelDefinition, FaceId } from "../core/types";
/** Grow a native body cycle, then release its opener with a required
 * head-on reversal. Every safe prefix rejects reciprocal head-only pairs.
 * Bodies and contacts grow against the actual board; no flankers are copied. */
export function constructDirectional(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  preferredFace?: FaceId,
  limit = 32,
  spotForbidden: ReadonlySet<string> = occupied,
): LevelDefinition | undefined {
  const bare: LevelDefinition = {
    id: level.id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    arrows: [],
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  for (let attempt = 0; attempt < limit; attempt++) {
    const native = constructParking(
      bare,
      rng,
      occupied,
      1,
      false,
      true,
      16,
      (c) =>
        (!preferredFace || attempt >= limit / 2 || c.face === preferredFace) &&
        !spotForbidden.has(cellKey(c)),
    );
    if (!native || native.arrows.some((a) => a.path.length < 3)) continue;
    const cell = native.stops[0]!;
    const arrows = native.arrows.map((a, i) => ({
      ...a,
      id: `r${level.id}-dir-${i === 0 ? "a" : i === 1 ? "b" : `c${i}`}`,
    }));
    const board = { ...bare, arrows },
      p = arrows[0]!,
      track = arrowTrack(board, p),
      at = track.findIndex((c) => cellKey(c) === cellKey(cell));
    const entry = headingForPath(track.slice(at - 1, at + 1), level.gridSize);
    if (!entry) continue;
    const spot = { cell, heading: oppositeHeading(entry) },
      full = { ...board, directionals: [spot] };
    const queue = [createGameState(full)],
      seen = new Set<string>();
    let headStamp = false;
    while (queue.length) {
      const state = queue.pop()!,
        key = state.remainingIds.join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        state.remainingIds.some((id) => {
          const a = arrows.find((a) => a.id === id)!,
            m = simulateMove(board, state, id);
          if (m.kind !== "blocked" || !m.blockerId || !m.contact) return false;
          const b = arrows.find((b) => b.id === m.blockerId)!;
          const n = simulateMove(board, state, b.id);
          return (
            n.blockerId === a.id &&
            n.contact &&
            cellKey(m.contact.cell) === cellKey(b.path.at(-1)!) &&
            cellKey(n.contact.cell) === cellKey(a.path.at(-1)!)
          );
        })
      ) {
        headStamp = true;
        break;
      }
      for (const id of state.remainingIds) {
        const move = simulateMove(full, state, id);
        if (move.kind === "exit") queue.push(applyMove(full, state, move));
      }
    }
    if (headStamp) continue;
    if (
      !validateLevel(full).valid ||
      simulateMove(full, createGameState(full), p.id).kind !== "exit"
    )
      continue;
    if (
      arrows.some((a) =>
        arrowTrack(full, a).some((c) => occupied.has(cellKey(c))),
      )
    )
      continue;
    if (
      !solveLevelTargets(full) ||
      solveLevelTargets(board) ||
      hasStrandingState(full) !== false ||
      hasSoftLockState(full) !== false
    )
      continue;
    return full;
  }
}
