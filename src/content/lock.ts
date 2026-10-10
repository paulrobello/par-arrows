import type { Rng } from "./procedural";
import { growMechanicBody } from "./mechanic-body";
import {
  cellKey,
  HEADINGS,
  headingForPath,
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
  LockDefinition,
  MoveTarget,
} from "../core/types";

export interface LockConstruction {
  readonly arrows: readonly ArrowDefinition[];
  readonly lock: LockDefinition;
  readonly certificate: readonly MoveTarget[];
}
const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;
function clearArrow(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  id: string,
  minimumRoute = 4,
) {
  for (let trial = 0; trial < 64; trial++) {
    const head: Cell = {
        face: rng.pick(FACES),
        x: rng.int(level.gridSize),
        y: rng.int(level.gridSize),
      },
      heading = rng.pick(HEADINGS),
      neck = stepSurface(head, oppositeHeading(heading), level.gridSize);
    if ([head, neck].some((c) => occupied.has(cellKey(c)))) continue;
    const path = growMechanicBody(
        level,
        rng,
        [neck, head],
        occupied,
        3 + rng.int(6),
      ),
      arrow = { id, path };
    const route = arrowTrack(level, arrow).slice(path.length);
    if (
      path.length < 3 ||
      route.length < minimumRoute ||
      route.some((c) => occupied.has(cellKey(c))) ||
      !validateLevel({ ...level, arrows: [arrow] }).valid
    )
      continue;
    return arrow;
  }
}
/** Grow independent opener/key routes and sampled lane dependencies.
 * Actual gate, unlock and ground counterfactuals replace both introductory
 * coordinate variants. Bounded failure supplies no stamped fallback. */
export function constructLock(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  limit = 32,
): LockConstruction | undefined {
  const bare = {
    id: level.id,
    title: level.title,
    lives: level.lives,
    gridSize: level.gridSize,
    arrows: [],
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  const count = rng.int(3);
  for (let attempt = 0; attempt < limit; attempt++) {
    const opener = clearArrow(bare, rng, occupied, `r${level.id}-lock-opener`);
    if (!opener) continue;
    const opRoute = arrowTrack(bare, opener).slice(opener.path.length);
    // Keep room for the gate, up to two seeded contacts and ordinary fill.
    // A three-cell route can be fully consumed by those reserved objects.
    if (opRoute.length < 4) continue;
    const gate = rng.pick(opRoute);
    const occupiedNext = new Set([
      ...occupied,
      cellKey(gate),
      ...arrowTrack(bare, opener).map(cellKey),
    ]);
    const keyArrow = clearArrow(
      bare,
      rng,
      occupiedNext,
      `r${level.id}-lock-key`,
      6,
    );
    if (!keyArrow) continue;
    const keyRoute = arrowTrack(bare, keyArrow).slice(keyArrow.path.length),
      key = rng.pick(keyRoute);
    const lock = { id: `r${level.id}-lock`, key, lock: gate };
    let board = { ...bare, arrows: [opener, keyArrow], locks: [lock] };
    const bodies = new Set([
      ...occupied,
      cellKey(gate),
      cellKey(key),
      ...board.arrows.flatMap((a) => a.path.map(cellKey)),
    ]);
    let fits = true;
    for (let index = 0; index < count; index++) {
      let placed: ArrowDefinition | undefined;
      for (let trial = 0; trial < 48; trial++) {
        const owner = rng.pick(board.arrows),
          route = arrowTrack(board, owner).slice(owner.path.length);
        const gateAt = route.findIndex((c) => cellKey(c) === cellKey(gate));
        const contacts = (
          owner.id === opener.id ? route.slice(gateAt + 1) : route
        ).filter((c) => !bodies.has(cellKey(c)));
        if (!contacts.length) continue;
        const contact = rng.pick(contacts);
        const path = [contact];
        let head = contact,
          heading = rng.pick(HEADINGS);
        for (let k = 0, n = 1 + rng.int(3); k < n; k++) {
          const next = stepSurface(head, heading, level.gridSize);
          const local = headingForPath([head, next], level.gridSize);
          if (!local) break;
          head = next;
          heading = local;
          path.push(head);
        }
        if (
          path.some((c) => bodies.has(cellKey(c))) ||
          new Set(path.map(cellKey)).size !== path.length
        )
          continue;
        const reaches = board.arrows.flatMap((a) =>
          arrowTrack(board, a).map(cellKey),
        );
        const arrow = {
          id: `r${level.id}-lock-c${index}`,
          path: growMechanicBody(
            bare,
            rng,
            path,
            new Set([...bodies, ...reaches]),
            Math.max(path.length, 3 + rng.int(6)),
          ),
        };
        const nextBoard = { ...board, arrows: [...board.arrows, arrow] };
        if (
          arrow.path.length < 3 ||
          !validateLevel(nextBoard).valid ||
          simulateMove(nextBoard, createGameState(nextBoard), arrow.id).kind !==
            "exit"
        )
          continue;
        if (
          arrowTrack(nextBoard, arrow).some(
            (c) =>
              occupied.has(cellKey(c)) ||
              cellKey(c) === cellKey(key) ||
              cellKey(c) === cellKey(gate),
          )
        )
          continue;
        placed = arrow;
        board = nextBoard;
        for (const c of arrow.path) bodies.add(cellKey(c));
        break;
      }
      if (!placed) {
        fits = false;
        break;
      }
    }
    if (!fits || !validateLevel(board).valid) continue;
    const state = createGameState(board);
    if (
      simulateMove(board, state, opener.id).kind !== "gated" ||
      simulateMove({ ...board, locks: [] }, state, opener.id).kind !== "exit"
    )
      continue;
    const certificate = solveLevelTargets(board);
    if (
      !certificate ||
      hasStrandingState(board) !== false ||
      hasSoftLockState(board) !== false
    )
      continue;
    const order = certificate.map((t) => t.arrowId);
    if (
      order.indexOf(keyArrow.id) < 0 ||
      order.indexOf(keyArrow.id) > order.indexOf(opener.id)
    )
      continue;
    let current = state;
    for (const target of certificate) {
      const move = simulateMove(
        board,
        current,
        target.arrowId,
        target.endpoint,
      );
      if (move.kind !== "exit") {
        fits = false;
        break;
      }
      current = applyMove(board, current, move);
    }
    if (
      !fits ||
      current.status !== "won" ||
      current.lives !== board.lives ||
      !current.unlocked?.includes(lock.id)
    )
      continue;
    return { arrows: board.arrows, lock, certificate };
  }
}
