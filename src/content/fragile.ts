import type { Rng } from "./procedural";
import { growMechanicBody, connectMechanicBody } from "./mechanic-body";
import {
  cellKey,
  HEADINGS,
  oppositeHeading,
  headingForPath,
  stepSurface,
} from "../core/topology";
import { arrowTrack } from "../core/stops";
import { createGameState, simulateMove, applyMove } from "../core/game-state";
import {
  solveLevelTargets,
  validateLevel,
  hasSoftLockState,
} from "../core/validation";
import type {
  Cell,
  LevelDefinition,
  ArrowDefinition,
  MoveTarget,
} from "../core/types";
const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;
export interface FragileConstruction {
  readonly arrows: readonly ArrowDefinition[];
  readonly cell: Cell;
  readonly certificate: readonly MoveTarget[];
}

/** Grow two competing crack approaches and real tail-lane dependencies.
 * A routed crosser body controls the double's safe endpoint. No copied
 * introductory gadget, transformed body or stamped fallback supplies it. */
export function constructFragile(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  limit = 32,
): FragileConstruction | undefined {
  const bare: LevelDefinition = {
    id: level.id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    arrows: [],
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
  for (let attempt = 0; attempt < limit; attempt++) {
    const head: Cell = {
        face: rng.pick(FACES),
        x: rng.int(level.gridSize),
        y: rng.int(level.gridSize),
      },
      heading = rng.pick(HEADINGS),
      neck = stepSurface(head, oppositeHeading(heading), level.gridSize);
    if ([head, neck].some((c) => occupied.has(cellKey(c)))) continue;
    const path = growMechanicBody(
      bare,
      rng,
      [neck, head],
      occupied,
      5 + rng.int(6),
    );
    if (path.length < 5) continue;
    const d: ArrowDefinition = {
      id: `r${level.id}-fragile-double`,
      kind: "double",
      path,
    };
    const headRoute = arrowTrack(bare, d).slice(path.length),
      tailRoute = arrowTrack(bare, { ...d, path: [...path].reverse() }).slice(
        path.length,
      );
    if (
      headRoute.length < 3 ||
      tailRoute.length < 2 ||
      [...headRoute, ...tailRoute].some((c) => occupied.has(cellKey(c)))
    )
      continue;
    const crack = rng.pick(headRoute.slice(1));
    for (let trial = 0; trial < 48; trial++) {
      let cHead = crack,
        back = rng.pick(HEADINGS);
      let approachFits = true;
      for (let k = 0, n = 1 + rng.int(5); k < n; k++) {
        const next = stepSurface(cHead, back, level.gridSize);
        const shifted = headingForPath([cHead, next], level.gridSize);
        if (!shifted) {
          approachFits = false;
          break;
        }
        back = shifted;
        cHead = next;
      }
      if (!approachFits) continue;
      const cNeck = stepSurface(cHead, back, level.gridSize);
      const cBase = {
        id: `r${level.id}-fragile-crosser`,
        path: [cNeck, cHead],
      };
      const cRoute = arrowTrack(bare, cBase).slice(2);
      if (
        !cRoute.some((c) => cellKey(c) === cellKey(crack)) ||
        [cHead, cNeck, ...cRoute].some((c) => occupied.has(cellKey(c))) ||
        path.some((c) =>
          [cHead, cNeck, ...cRoute].some((o) => cellKey(o) === cellKey(c)),
        )
      )
        continue;
      const forbidden = new Set([
        ...occupied,
        ...path.map(cellKey),
        ...headRoute.map(cellKey),
        ...cRoute.map(cellKey),
        cellKey(cHead),
      ]);
      if (forbidden.has(cellKey(cNeck))) continue;
      const contacts = tailRoute.filter((c) => !forbidden.has(cellKey(c)));
      if (!contacts.length) continue;
      const joined = connectMechanicBody(
        bare,
        rng,
        rng.pick(contacts),
        cNeck,
        forbidden,
      );
      if (!joined) continue;
      const c = { ...cBase, path: [...joined, cHead] };
      if (c.path.length < 3) continue;
      const board = { ...bare, arrows: [c, d], fragile: [crack] };
      if (!validateLevel(board).valid) continue;
      const initial = createGameState(board),
        wrong = simulateMove(board, initial, d.id, "head");
      if (
        wrong.kind !== "exit" ||
        !wrong.collapses?.length ||
        simulateMove(board, initial, d.id, "tail").kind !== "blocked" ||
        simulateMove(board, initial, c.id).kind !== "exit"
      )
        continue;
      if (
        simulateMove(board, applyMove(board, initial, wrong), c.id).kind !==
        "fall"
      )
        continue;
      const right = applyMove(
        board,
        initial,
        simulateMove(board, initial, c.id),
      );
      if (
        simulateMove(board, right, d.id, "head").kind !== "fall" ||
        simulateMove(board, right, d.id, "tail").kind !== "exit"
      )
        continue;
      if (!solveLevelTargets(board) || hasSoftLockState(board) !== false)
        continue;
      const count = rng.int(3);
      let full = board,
        ok = true;
      const reserved = new Set([
        ...occupied,
        cellKey(crack),
        ...path.map(cellKey),
        ...c.path.map(cellKey),
      ]);
      for (let index = 0; index < count; index++) {
        let found: ArrowDefinition | undefined;
        for (let trial = 0; trial < 48; trial++) {
          const owner = index && rng.next() < 0.5 ? full.arrows.at(-1)! : d;
          const route = arrowTrack(
            bare,
            owner.id === d.id ? { ...d, path: [...d.path].reverse() } : owner,
          ).slice(owner.path.length);
          const contacts = route.filter((c) => !reserved.has(cellKey(c)));
          if (!contacts.length) continue;
          const contact = rng.pick(contacts),
            heading = rng.pick(HEADINGS);
          let head = contact,
            walk = [contact];
          for (let k = 0, n = 1 + rng.int(3); k < n; k++) {
            const next = stepSurface(head, heading, level.gridSize);
            walk.push(next);
            head = next;
          }
          if (
            walk.some((c) => reserved.has(cellKey(c))) ||
            new Set(walk.map(cellKey)).size !== walk.length
          )
            continue;
          const lanes = new Set(
            [
              ...headRoute,
              ...cRoute,
              ...full.arrows
                .slice(2)
                .flatMap((a) => arrowTrack(bare, a).slice(a.path.length)),
            ].map(cellKey),
          );
          const arrow = {
            id: `r${level.id}-fragile-c${index}`,
            path: growMechanicBody(
              bare,
              rng,
              walk,
              new Set([...reserved, ...lanes]),
              Math.max(walk.length, 3 + rng.int(6)),
            ),
          };
          const next = { ...full, arrows: [...full.arrows, arrow] };
          if (
            arrow.path.length < 3 ||
            !validateLevel(next).valid ||
            simulateMove(next, createGameState(next), c.id).kind !== "exit" ||
            simulateMove(next, createGameState(next), d.id, "head").kind !==
              "exit" ||
            simulateMove(next, createGameState(next), arrow.id).kind !== "exit"
          )
            continue;
          if (arrowTrack(next, arrow).some((c) => occupied.has(cellKey(c))))
            continue;
          found = arrow;
          full = next;
          for (const cell of arrow.path) reserved.add(cellKey(cell));
          break;
        }
        if (!found) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const certificate = solveLevelTargets(full);
      if (!certificate || hasSoftLockState(full) !== false) continue;
      if (certificate.find((t) => t.arrowId === d.id)?.endpoint !== "tail")
        continue;
      const first = createGameState(full);
      const wrongHead = simulateMove(full, first, d.id, "head");
      if (
        wrongHead.kind !== "exit" ||
        !wrongHead.collapses?.length ||
        simulateMove(full, applyMove(full, first, wrongHead), c.id).kind !==
          "fall"
      )
        continue;
      return { arrows: full.arrows, cell: crack, certificate };
    }
  }
}
