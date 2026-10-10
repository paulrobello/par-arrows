import { rotatedHeading } from "../core/directionals";
import { applyMove, createGameState, simulateMove } from "../core/game-state";
import { currentPath } from "../core/stops";
import {
  cellKey,
  HEADINGS,
  headingForPath,
  oppositeHeading,
  stepSurface,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  DirectionalSpotDefinition,
  LevelDefinition,
} from "../core/types";
import { hasStrandingState, validateLevel } from "../core/validation";
import { routeFrom } from "./dependency-fill";
import type { Rng } from "./procedural";
import {
  connectMechanicBody as connect,
  growMechanicBody as growTail,
} from "./mechanic-body";

const FACES = ["front", "back", "left", "right", "top", "bottom"] as const;

export interface ParkingConstruction {
  readonly arrows: readonly ArrowDefinition[];
  readonly stops: readonly Cell[];
  readonly parkLegs: readonly string[];
  readonly spots: readonly DirectionalSpotDefinition[];
}

/**
 * Synthesize a dependency cycle from actual surface walks. Parking vacates a
 * sampled body contact; one to three followers unwind; a routed last arrow
 * occupies the parker's continuation. No catalog or stamped fallback exists.
 * Proofs use the movement engine and bounded enumeration, never global search.
 * Native-cycle mode releases the whole opener body and installs no circle.
 * Portal and double constructors prove the actual jump or tail-end exit.
 */
export function constructParking(
  level: LevelDefinition,
  rng: Rng,
  occupied: ReadonlySet<string>,
  budget: number,
  rotorPhase = false,
  portalCycle = false,
  attemptLimit = 96,
  acceptContact?: (cell: Cell) => boolean,
): ParkingConstruction | undefined {
  if (budget < 1) return undefined;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const head: Cell = {
      face: rng.pick(FACES),
      x: rng.int(level.gridSize),
      y: rng.int(level.gridSize),
    };
    const heading = rng.pick(HEADINGS);
    const neck = stepSurface(head, oppositeHeading(heading), level.gridSize);
    if ([head, neck].some((cell) => occupied.has(cellKey(cell)))) continue;
    const path = growTail(
      level,
      rng,
      [neck, head],
      occupied,
      3 + rng.int(portalCycle ? 4 : 8),
    );
    const actualHeading = headingForPath(path, level.gridSize);
    if (!actualHeading) continue;
    const route = routeFrom(level, head, actualHeading);
    if (
      !route ||
      route.length < 3 ||
      route.some((cell) => occupied.has(cellKey(cell)))
    )
      continue;
    const own = new Set(path.map(cellKey));
    if (route.some((cell) => own.has(cellKey(cell)))) continue;
    // A rotor circuit needs the tail to pass its spot before the head parks,
    // so the quarter-turn is settled while the parker still blocks a lane.
    const minimumTravel = rotorPhase ? path.length + 1 : 1;
    const maximumTravel = rotorPhase
      ? route.length - 2
      : Math.min(path.length - 1, route.length - 2);
    if (maximumTravel < minimumTravel) continue;
    const travel = minimumTravel + rng.int(maximumTravel - minimumTravel + 1);
    const stop = route[travel - 1]!;
    if (acceptContact && !acceptContact(stop)) continue;
    const parker: ArrowDefinition = { id: `r${level.id}-park-p`, path };
    const board = { ...level, arrows: [parker], stops: [stop] };
    const parked = currentPath(board, parker, travel);
    const parkedKeys = portalCycle
      ? new Set<string>()
      : new Set(parked.map(cellKey));
    const vacated = portalCycle
      ? path
      : path.filter((cell) => !parkedKeys.has(cellKey(cell)));
    if (!vacated.length) continue;
    // Select a phased contact before constructing followers. Searching
    // complete circuits and only then looking for a compatible crossing
    // wastes most work, especially beside earlier reserved mechanics.
    const crossings: {
      cell: Cell;
      heading: (typeof HEADINGS)[number];
      contacts: readonly Cell[];
    }[] = [];
    if (rotorPhase) {
      const track = [...path, ...route];
      const vacatedKeys = new Set(vacated.map(cellKey));
      for (let at = path.length; at < travel; at += 1) {
        const cell = track[at]!;
        const incoming = headingForPath(
          track.slice(at - 1, at + 1),
          level.gridSize,
        );
        if (!incoming) continue;
        const nextHeading = rotatedHeading(incoming);
        const side = routeFrom(level, cell, nextHeading);
        const contacts = side?.filter((next) => vacatedKeys.has(cellKey(next)));
        if (contacts?.length)
          crossings.push({ cell, heading: nextHeading, contacts });
      }
      if (!crossings.length) continue;
    }
    const bodies = new Set([...occupied, ...path.map(cellKey), cellKey(stop)]);
    // Future bodies cannot intercept any earlier follower's exit or the park.
    const protectedRoutes = new Set(route.slice(0, travel).map(cellKey));
    const followers: ArrowDefinition[] = [];
    let targets: readonly Cell[] = vacated;
    const count = 1 + rng.int(portalCycle ? 2 : 3);
    let failed = false;
    for (let index = 0; index <= count; index += 1) {
      const last = index === count;
      let placed: ArrowDefinition | undefined;
      for (let trial = 0; trial < 48; trial += 1) {
        const crossing =
          rotorPhase && index === 0 ? rng.pick(crossings) : undefined;
        // Stateful circuits may branch from any earlier released body,
        // rather than reproducing a single fixed dependency chain. The
        // emission order still clears every possible parent before its child.
        const parents =
          (rotorPhase || portalCycle) && index > 0
            ? rng.pick([vacated, ...followers.map((arrow) => arrow.path)])
            : targets;
        const contact = rng.pick(crossing?.contacts ?? parents);
        let candidateHead = crossing?.cell ?? contact;
        const backwards = crossing
          ? oppositeHeading(crossing.heading)
          : rng.pick(HEADINGS);
        let previous = candidateHead;
        const gap =
          1 + rng.int(Math.min(portalCycle ? 3 : 5, level.gridSize - 1));
        for (let step = 0; step < gap; step += 1) {
          previous = candidateHead;
          candidateHead = stepSurface(candidateHead, backwards, level.gridSize);
        }
        // Resolve seam-local heading by the link back towards the contact.
        const direction = HEADINGS.find(
          (h) =>
            cellKey(stepSurface(candidateHead, h, level.gridSize)) ===
            cellKey(previous),
        );
        if (!direction) continue;
        const candidateNeck = stepSurface(
          candidateHead,
          oppositeHeading(direction),
          level.gridSize,
        );
        const candidateRoute = routeFrom(level, candidateHead, direction);
        if (
          !candidateRoute ||
          !candidateRoute.some((cell) => cellKey(cell) === cellKey(contact)) ||
          candidateRoute.some(
            (cell) =>
              occupied.has(cellKey(cell)) ||
              parkedKeys.has(cellKey(cell)) ||
              cellKey(cell) === cellKey(stop),
          )
        )
          continue;
        const forbidden = new Set([
          ...bodies,
          ...protectedRoutes,
          cellKey(candidateHead),
        ]);
        if (
          forbidden.has(cellKey(candidateNeck)) ||
          bodies.has(cellKey(candidateHead)) ||
          protectedRoutes.has(cellKey(candidateHead))
        )
          continue;
        let candidatePath: Cell[];
        if (last) {
          const anchors = route
            .slice(travel, portalCycle ? travel + 4 : undefined)
            .filter(
              (cell) =>
                !forbidden.has(cellKey(cell)) &&
                cellKey(cell) !== cellKey(candidateHead) &&
                !candidateRoute.some((r) => cellKey(r) === cellKey(cell)),
            );
          if (!anchors.length) continue;
          const joined = connect(
            level,
            rng,
            rng.pick(anchors),
            candidateNeck,
            forbidden,
          );
          if (!joined) continue;
          candidatePath = [...joined, candidateHead];
        } else {
          candidatePath = growTail(
            level,
            rng,
            [candidateNeck, candidateHead],
            forbidden,
            3 + rng.int(portalCycle ? 4 : 9),
          );
        }
        const arrow = {
          id: `r${level.id}-park-${last ? "b" : `f${index}`}`,
          path: candidatePath,
        };
        const solo = { ...level, arrows: [arrow] };
        if (!validateLevel(solo).valid) continue;
        const probe = simulateMove(
          { ...board, arrows: [parker, ...followers, arrow] },
          createGameState({ ...board, arrows: [parker, ...followers, arrow] }),
          arrow.id,
        );
        if (probe.kind !== "blocked") continue;
        placed = arrow;
        for (const cell of candidatePath) bodies.add(cellKey(cell));
        for (const cell of candidateRoute) protectedRoutes.add(cellKey(cell));
        break;
      }
      if (!placed) {
        failed = true;
        break;
      }
      followers.push(placed);
      targets = placed.path;
    }
    if (failed) continue;
    // Emission is reversed by the generator's replay: followers leave first,
    // then the continuation blocker, then the parker.
    const arrows = [parker, ...followers.reverse()];
    const coreLevel = { ...level, arrows, stops: portalCycle ? [] : [stop] };
    if (!validateLevel(coreLevel).valid) continue;
    const stripped = { ...coreLevel, stops: [] };
    if (
      !arrows.every(
        (arrow) =>
          simulateMove(stripped, createGameState(stripped), arrow.id).kind ===
          "blocked",
      )
    )
      continue;
    let state = createGameState(coreLevel);
    if (portalCycle) {
      // Prove the native body's unwind after releasing the whole opener.
      // The consuming mechanic proves its actual jump or endpoint exit.
      state = {
        ...state,
        remainingIds: state.remainingIds.filter((id) => id !== parker.id),
      };
    } else {
      const park = simulateMove(coreLevel, state, parker.id);
      if (park.kind !== "paused") continue;
      state = applyMove(coreLevel, state, park);
    }
    let clears = true;
    for (const arrow of [...arrows]
      .reverse()
      .filter((a) => !portalCycle || a.id !== parker.id)) {
      const move = simulateMove(coreLevel, state, arrow.id);
      if (move.kind !== "exit") {
        clears = false;
        break;
      }
      state = applyMove(coreLevel, state, move);
    }
    if (!clears || (!portalCycle && hasStrandingState(coreLevel) !== false))
      continue;
    return {
      arrows,
      stops: [stop],
      spots: [],
      parkLegs: portalCycle ? [] : [`park:${parker.id}`],
    };
  }
  return undefined;
}
