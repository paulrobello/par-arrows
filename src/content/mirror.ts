import { constructParking } from "./parking";
import { growMechanicBody } from "./mechanic-body";
import { routeFrom } from "./dependency-fill";
import type { Rng } from "./procedural";
import {
  cellKey,
  headingForPath,
  HEADINGS,
  oppositeHeading,
  stepSurface,
} from "../core/topology";
import { arrowTrack } from "../core/stops";
import { createGameState, simulateMove, applyMove } from "../core/game-state";
import {
  validateLevel,
  solveLevelTargets,
  hasStrandingState,
  hasSoftLockState,
} from "../core/validation";
import type {
  LevelDefinition,
  Cell,
  ArrowDefinition,
  MirrorDefinition,
  MoveTarget,
} from "../core/types";

export interface MirrorConstruction {
  readonly arrows: readonly ArrowDefinition[];
  readonly mirror: MirrorDefinition;
  readonly certificate: readonly MoveTarget[];
}
/** Redirect a grown body cycle and integrate a second approach into its
 * actual ordering. Ground must deadlock, primary reflection must release a
 * reachable state, and the secondary must gain or lose a clear move. A
 * reciprocal head-only deadlock is never a construction fallback. */
export function constructMirror(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  limit = 64,
  glyphForbidden: ReadonlySet<string> = occupied,
): MirrorConstruction | undefined {
  const bare: LevelDefinition = {
    id: level.id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    arrows: [],
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  for (let outer = 0; outer < limit; outer++) {
    const native = constructParking(
      bare,
      rng,
      occupied,
      1,
      false,
      false,
      16,
      (c) => !glyphForbidden.has(cellKey(c)),
    );
    if (!native || native.arrows.some((a) => a.path.length < 3)) continue;
    const cell = native.stops[0]!;
    const arrows = native.arrows.map((a, i) => ({
      ...a,
      id: `r${level.id}-mirror-${i === 0 ? "north" : `c${i}`}`,
    }));
    const unlinked = { ...bare, arrows };
    const track = arrowTrack(unlinked, arrows[0]!);
    const at = track.findIndex((c) => cellKey(c) === cellKey(cell));
    const incoming = headingForPath(
      track.slice(at - 1, at + 1),
      level.gridSize,
    );
    if (!incoming) continue;
    for (const orientation of rng.next() < 0.5
      ? (["/", "\\"] as const)
      : (["\\", "/"] as const)) {
      let board = { ...unlinked, mirrors: [{ cell, orientation }] };
      if (
        !validateLevel(board).valid ||
        simulateMove(board, createGameState(board), arrows[0]!.id).kind !==
          "exit"
      )
        continue;
      const bodies = new Set([
        ...occupied,
        cellKey(cell),
        ...arrows.flatMap((a) => a.path.map(cellKey)),
      ]);
      const lanes = new Set(
        arrows.flatMap((a) =>
          arrowTrack(board, a).slice(a.path.length).map(cellKey),
        ),
      );
      // A second independent approach uses the mirror after a sampled native
      // body dependency releases it. Its path is grown, never copied.
      for (let trial = 0; trial < 24; trial++) {
        let head: Cell = cell;
        let backwards = oppositeHeading(
          rng.pick(HEADINGS.filter((h) => h !== incoming)),
        );
        let approachFits = true;
        for (let k = 0, n = 1 + rng.int(5); k < n; k++) {
          const next = stepSurface(head, backwards, level.gridSize);
          const local = headingForPath([head, next], level.gridSize);
          if (!local) {
            approachFits = false;
            break;
          }
          backwards = local;
          head = next;
        }
        if (!approachFits) continue;
        const neck = stepSurface(head, backwards, level.gridSize);
        const heading = headingForPath([neck, head], level.gridSize);
        if (!heading) continue;
        if (
          [head, neck].some((c) => bodies.has(cellKey(c))) ||
          !routeFrom(bare, head, heading)?.some(
            (c) => cellKey(c) === cellKey(cell),
          )
        )
          continue;
        const second = {
          id: `r${level.id}-mirror-south`,
          path: growMechanicBody(
            bare,
            rng,
            [neck, head],
            new Set([...bodies, ...lanes]),
            3 + rng.int(6),
          ),
        };
        if (second.path.length < 3) continue;
        const plainTrack = arrowTrack(bare, second);
        const mirrorAt = plainTrack.findIndex(
          (c) => cellKey(c) === cellKey(cell),
        );
        if (mirrorAt < second.path.length) continue;
        const secondIncoming = headingForPath(
          plainTrack.slice(mirrorAt - 1, mirrorAt + 1),
          level.gridSize,
        );
        if (!secondIncoming || secondIncoming === incoming) continue;
        const full = { ...board, arrows: [...arrows, second] };
        const ground = { ...full, mirrors: [] },
          groundState = createGameState(ground);
        const facing = full.arrows.some((a) => {
          const ma = simulateMove(ground, groundState, a.id);
          if (ma.kind !== "blocked" || !ma.blockerId) return false;
          const b = full.arrows.find((b) => b.id === ma.blockerId)!;
          const mb = simulateMove(ground, groundState, b.id);
          return (
            mb.blockerId === a.id &&
            ma.contact &&
            mb.contact &&
            cellKey(ma.contact.cell) === cellKey(b.path.at(-1)!) &&
            cellKey(mb.contact.cell) === cellKey(a.path.at(-1)!)
          );
        });
        if (facing) continue;
        if (
          !validateLevel(full).valid ||
          full.arrows.some((a) =>
            arrowTrack(full, a).some((c) => occupied.has(cellKey(c))),
          )
        )
          continue;
        if (
          !arrowTrack(full, second)
            .slice(second.path.length)
            .some((c) => cellKey(c) === cellKey(cell))
        )
          continue;
        if (
          !solveLevelTargets(full) ||
          solveLevelTargets({ ...full, mirrors: [] }) ||
          hasStrandingState(full) !== false ||
          hasSoftLockState(full) !== false
        )
          continue;
        const queue = [createGameState(full)],
          seen = new Set<string>();
        let requiredPrimary = false,
          meaningfulSecondary = false,
          revealsHeadStamp = false;
        while (queue.length) {
          const state = queue.pop()!;
          const key = state.remainingIds.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          if (
            state.remainingIds.includes(arrows[0]!.id) &&
            state.remainingIds.includes(second.id)
          ) {
            const a = simulateMove(ground, state, arrows[0]!.id),
              b = simulateMove(ground, state, second.id);
            if (
              a.blockerId === second.id &&
              b.blockerId === arrows[0]!.id &&
              a.contact &&
              b.contact &&
              cellKey(a.contact.cell) === cellKey(second.path.at(-1)!) &&
              cellKey(b.contact.cell) === cellKey(arrows[0]!.path.at(-1)!)
            ) {
              revealsHeadStamp = true;
              break;
            }
          }
          if (
            state.remainingIds.includes(arrows[0]!.id) &&
            simulateMove(full, state, arrows[0]!.id).kind === "exit" &&
            simulateMove(ground, state, arrows[0]!.id).kind === "blocked"
          )
            requiredPrimary = true;
          if (state.remainingIds.includes(second.id)) {
            const actual = simulateMove(full, state, second.id).kind,
              plain = simulateMove(ground, state, second.id).kind;
            if (
              (actual === "exit" && plain === "blocked") ||
              (actual === "blocked" && plain === "exit")
            )
              meaningfulSecondary = true;
          }
          for (const id of state.remainingIds) {
            const move = simulateMove(full, state, id);
            if (move.kind === "exit") queue.push(applyMove(full, state, move));
          }
        }
        if (revealsHeadStamp || !requiredPrimary || !meaningfulSecondary)
          continue;
        return {
          arrows: full.arrows,
          mirror: full.mirrors[0]!,
          certificate: solveLevelTargets(full)!,
        };
      }
    }
  }
}
