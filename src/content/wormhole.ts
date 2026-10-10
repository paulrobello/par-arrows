import { applyMove, createGameState, simulateMove } from "../core/game-state";
import { arrowTrack } from "../core/stops";
import {
  cellKey,
  headingForPath,
  HEADINGS,
  oppositeHeading,
  stepSurface,
} from "../core/topology";
import {
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../core/validation";
import type {
  ArrowDefinition,
  Cell,
  LevelDefinition,
  MoveTarget,
  WormholeDefinition,
} from "../core/types";
import { constructParking } from "./parking";
import { routeFrom } from "./dependency-fill";
import { growMechanicBody } from "./mechanic-body";
import type { Rng } from "./procedural";

const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;

export interface WormholeConstruction {
  readonly arrows: readonly ArrowDefinition[];
  readonly wormhole: WormholeDefinition;
  readonly certificate: readonly MoveTarget[];
}

/** Grow a native blocked cycle, then break it with a proved portal traversal.
 * The exit has a sampled body contact, rather than a fixed adjacent blocker.
 * Both ends and every route avoid prior reservations; exhaustion omits it. */
export function constructWormhole(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  suffix = "",
  limit = 8,
): WormholeConstruction | undefined {
  const earlierReach = new Set(
    level.arrows.flatMap((a) =>
      (a.kind === "double"
        ? [a.path, [...a.path].reverse()]
        : [a.path]
      ).flatMap((path) => arrowTrack(level, { ...a, path }).map(cellKey)),
    ),
  );
  const bare: LevelDefinition = {
    id: level.id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
    arrows: [],
  };
  for (let outer = 0; outer < limit; outer++) {
    const p = constructParking(bare, rng, occupied, 1, false, true);
    if (!p) continue;
    const arrows = p.arrows.map((a, i) => ({
      ...a,
      id: `r${level.id}-wormhole-${i === 0 ? "portal" : `gate${i}`}${suffix}`,
    }));
    const portal = arrows[0]!;
    const a = p.stops[0]!;
    const unlinked = { ...bare, arrows };
    const track = arrowTrack(unlinked, portal);
    const at = track.findIndex((c) => cellKey(c) === cellKey(a));
    const heading = headingForPath(track.slice(at - 1, at + 1), bare.gridSize);
    if (!heading || earlierReach.has(cellKey(a))) continue;
    const otherReach = new Set(
      arrows.slice(1).flatMap((a) => arrowTrack(unlinked, a).map(cellKey)),
    );
    if (otherReach.has(cellKey(a))) continue;
    const bodies = new Set([
      ...occupied,
      ...arrows.flatMap((a) => a.path.map(cellKey)),
    ]);
    for (let trial = 0; trial < 64; trial++) {
      const b: Cell = {
        face: rng.pick(FACES.filter((f) => f !== a.face)),
        x: rng.int(bare.gridSize),
        y: rng.int(bare.gridSize),
      };
      if (
        bodies.has(cellKey(b)) ||
        otherReach.has(cellKey(b)) ||
        earlierReach.has(cellKey(b))
      )
        continue;
      const corridor = routeFrom(bare, b, heading);
      if (!corridor?.length || corridor.some((c) => bodies.has(cellKey(c))))
        continue;
      const wormhole = { id: suffix ? "w2" : "w1", a, b };
      const board = { ...unlinked, wormholes: [wormhole] };
      const contact = rng.pick(corridor);
      const side = rng.pick(
        HEADINGS.filter((h) => h !== heading && h !== oppositeHeading(heading)),
      );
      const path = [contact];
      let head = contact;
      for (let k = 0, n = 1 + rng.int(4); k < n; k++) {
        head = stepSurface(head, side, bare.gridSize);
        path.push(head);
      }
      if (
        path.some(
          (c) =>
            bodies.has(cellKey(c)) ||
            [cellKey(a), cellKey(b)].includes(cellKey(c)),
        )
      )
        continue;
      const far = {
        id: `r${level.id}-wormhole-far${suffix}`,
        path: growMechanicBody(
          bare,
          rng,
          path,
          new Set([
            ...bodies,
            cellKey(a),
            cellKey(b),
            ...arrows.flatMap((a) => arrowTrack(board, a).map(cellKey)),
          ]),
          Math.max(path.length, 3 + rng.int(6)),
        ),
      };
      const full = { ...board, arrows: [...arrows, far] };
      if (far.path.length < 3) continue;
      if (!validateLevel(full).valid) continue;
      if (
        full.arrows.some((a) =>
          arrowTrack(full, a).some((c) => occupied.has(cellKey(c))),
        )
      )
        continue;
      let state = createGameState(full);
      const first = simulateMove(full, state, far.id);
      if (first.kind !== "exit") continue;
      const blocked = simulateMove(full, state, portal.id);
      if (blocked.kind !== "blocked" || blocked.blockerId !== far.id) continue;
      state = applyMove(full, state, first);
      const jump = simulateMove(full, state, portal.id);
      if (jump.kind !== "exit" || jump.portals?.length !== 1) continue;
      const certificate = solveLevelTargets(full);
      if (
        !certificate ||
        solveLevelTargets({ ...full, wormholes: [] }) ||
        hasStrandingState(full) !== false
      )
        continue;
      return { arrows: full.arrows, wormhole, certificate };
    }
  }
  return undefined;
}
