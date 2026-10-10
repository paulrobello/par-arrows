import { arrowTrack } from "../core/stops";
import {
  cellKey,
  HEADINGS,
  oppositeHeading,
  stepSurface,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  Heading,
  LevelDefinition,
} from "../core/types";
import {
  flipHeadingProbes,
  flipInterest,
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../core/validation";
import { routeFrom } from "./dependency-fill";
import type { Rng } from "./procedural";
import { growMechanicBody as growTail } from "./mechanic-body";

const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;

/** Extend a sampled contact stem into a seeded self-avoiding body. */
export function growFlipLaneBlocker(
  level: LevelDefinition,
  rng: Rng,
  path: Cell[],
  forbidden: ReadonlySet<string>,
): Cell[] {
  return growTail(
    level,
    rng,
    path,
    forbidden,
    Math.max(path.length, 3 + rng.int(6)),
  );
}

function approach(
  level: LevelDefinition,
  rng: Rng,
  contact: Cell,
  heading: Heading,
  forbidden: ReadonlySet<string>,
  id: string,
): ArrowDefinition | undefined {
  let head = contact;
  for (let step = 0, gap = 1 + rng.int(5); step < gap; step++)
    head = stepSurface(head, oppositeHeading(heading), level.gridSize);
  if (
    !routeFrom(level, head, heading)?.some(
      (c) => cellKey(c) === cellKey(contact),
    )
  )
    return undefined;
  const neck = stepSurface(head, oppositeHeading(heading), level.gridSize);
  if ([neck, head].some((c) => forbidden.has(cellKey(c)))) return undefined;
  return {
    id,
    path: growTail(level, rng, [neck, head], forbidden, 3 + rng.int(6)),
  };
}

/** A body contact on an earlier lane, with its own exit initially clear.
 * Sampling earlier lanes creates branches and joins instead of one fixed chain. */
function laneContact(
  board: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  contacts: readonly Cell[],
  id: string,
): ArrowDefinition | undefined {
  const spotKeys = (board.directionals ?? []).map((s) => cellKey(s.cell));
  const bodies = new Set([
    ...occupied,
    ...spotKeys,
    ...board.arrows.flatMap((a) => a.path.map(cellKey)),
  ]);
  const candidates = contacts.filter((c) => !bodies.has(cellKey(c)));
  if (!candidates.length) return undefined;
  const reaches = flipHeadingProbes(board).flatMap((p) =>
    board.arrows.flatMap((a) =>
      arrowTrack(p, a).slice(a.path.length).map(cellKey),
    ),
  );
  for (let trial = 0; trial < 32; trial++) {
    const contact = rng.pick(candidates);
    const heading = rng.pick(HEADINGS);
    const path = [contact];
    let head = contact;
    for (let step = 0, gap = 1 + rng.int(4); step < gap; step++) {
      head = stepSurface(head, heading, board.gridSize);
      path.push(head);
    }
    if (
      path.some((c) => bodies.has(cellKey(c))) ||
      new Set(path.map(cellKey)).size !== path.length
    )
      continue;
    const candidate = { id, path };
    const route = arrowTrack(board, candidate).slice(path.length);
    if (!route.length || route.some((c) => bodies.has(cellKey(c)))) continue;
    const grown = {
      ...candidate,
      path: growTail(
        board,
        rng,
        path,
        new Set([...bodies, ...reaches]),
        Math.max(path.length, 3 + rng.int(6)),
      ),
    };
    if (validateLevel({ ...board, arrows: [...board.arrows, grown] }).valid)
      return grown;
  }
  return undefined;
}

/** Grow a flip circuit from approaches, phased exits and sampled body contacts.
 * There are no authored coordinates, transformations of completed gadgets or
 * stamped fallbacks. Every candidate uses the real engine for safety proofs. */
export function constructFlip(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  forbiddenTracks: ReadonlySet<string>,
  attemptLimit = 96,
): LevelDefinition | undefined {
  const reserved = new Set([...occupied, ...forbiddenTracks]);
  const twoSpots = rng.next() < 0.3;
  for (let attempt = 0; attempt < attemptLimit; attempt++) {
    const cell: Cell = {
      face: rng.pick(FACES),
      x: 1 + rng.int(level.gridSize - 2),
      y: 1 + rng.int(level.gridSize - 2),
    };
    if (reserved.has(cellKey(cell))) continue;
    const heading = rng.pick(HEADINGS);
    const reversed = oppositeHeading(heading);
    const forward = routeFrom(level, cell, heading);
    const backward = routeFrom(level, cell, reversed);
    if (
      !forward ||
      !backward ||
      forward.length < 2 ||
      backward.length < 2 ||
      [...forward, ...backward].some((c) => reserved.has(cellKey(c)))
    )
      continue;
    const spots = [{ cell, heading, kind: "flip" as const }];
    let board: LevelDefinition = {
      ...level,
      arrows: [],
      stops: [],
      directionals: spots,
    };
    const forbidden = new Set([
      ...reserved,
      cellKey(cell),
      ...forward.map(cellKey),
      ...backward.map(cellKey),
    ]);
    const perpendicular = HEADINGS.filter(
      (h) => h !== heading && h !== reversed,
    );
    const headOn = rng.next() < 0.4;
    const firstHeading = headOn ? reversed : rng.pick(perpendicular);
    const secondHeading = headOn
      ? rng.pick(perpendicular)
      : oppositeHeading(firstHeading);
    const firstForbidden = new Set(forbidden);
    // A reversing arrow necessarily occupies its own outgoing lane.
    if (headOn) for (const c of forward) firstForbidden.delete(cellKey(c));
    const first = approach(
      level,
      rng,
      cell,
      firstHeading,
      firstForbidden,
      `r${level.id}-flip-a`,
    );
    if (!first) continue;
    for (const c of first.path) forbidden.add(cellKey(c));
    const second = approach(
      level,
      rng,
      cell,
      secondHeading,
      forbidden,
      `r${level.id}-flip-b`,
    );
    if (!second) continue;
    const arrows: ArrowDefinition[] = [first, second];
    const mandatory: (readonly Cell[])[] = [backward];
    if (twoSpots) {
      const bodies = new Set(arrows.flatMap((a) => a.path.map(cellKey)));
      const choices = forward.filter(
        (c) => !bodies.has(cellKey(c)) && !reserved.has(cellKey(c)),
      );
      if (!choices.length) continue;
      const nextCell = rng.pick(choices);
      // Turn away from the first spot, so neither heading returns to it.
      // All combinations still go through the validator below.
      const nextHeading = rng.pick(perpendicular);
      const otherRoute = routeFrom(
        level,
        nextCell,
        oppositeHeading(nextHeading),
      );
      if (
        !otherRoute?.length ||
        otherRoute.some((c) => reserved.has(cellKey(c)))
      )
        continue;
      spots.push({ cell: nextCell, heading: nextHeading, kind: "flip" });
      mandatory.push(otherRoute);
    }
    board = { ...board, arrows };
    const count = mandatory.length + rng.int(2);
    let placed = true;
    for (let index = 0; index < count; index++) {
      const contacts =
        mandatory[index] ??
        rng.pick(
          arrows.map((a) =>
            arrowTrack(rng.pick(flipHeadingProbes(board)), a).slice(
              a.path.length,
            ),
          ),
        );
      const arrow = laneContact(
        board,
        rng,
        reserved,
        contacts,
        `r${level.id}-flip-c${index}`,
      );
      if (!arrow) {
        placed = false;
        break;
      }
      arrows.push(arrow);
      board = { ...board, arrows };
    }
    if (!placed || !validateLevel(board).valid) continue;
    // Close every possible heading against earlier mechanics and groups.
    if (
      flipHeadingProbes(board).some((probe) =>
        arrows.some((arrow) => {
          const keys = arrowTrack(probe, arrow).map(cellKey);
          return (
            keys.some((key) => reserved.has(key)) ||
            spots.some(
              (spot) =>
                keys.filter((key) => key === cellKey(spot.cell)).length > 1,
            )
          );
        }),
      )
    )
      continue;
    if (
      !solveLevelTargets(board) ||
      hasStrandingState(board) !== false ||
      flipInterest(board) !== true
    )
      continue;
    // Each spot must affect safety. Hold the other spot static during this
    // small additional proof, then check actual reachable states in tests.
    if (
      spots.some(
        (spot) =>
          flipInterest({
            ...board,
            directionals: spots.map((s) =>
              cellKey(s.cell) === cellKey(spot.cell)
                ? s
                : { cell: s.cell, heading: s.heading },
            ),
          }) !== true,
      )
    )
      continue;
    return board;
  }
  return undefined;
}
