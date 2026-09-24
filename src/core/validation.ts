import { flippedHeading, spotHeadingAt } from "./directionals";
import {
  applyMove,
  createGameState,
  simulateMove as simulateState,
} from "./game-state";
import { advanceHead, simulateMove } from "./movement";
import { overlappingArrowIds, sharedDirectedSegment } from "./overlap";
import { arrowTrack, maximumOffset, settledPathOf } from "./stops";
import { cellKey, headingForPath, linkKey, seamTransition } from "./topology";
import type {
  ArrowDefinition,
  Cell,
  Endpoint,
  GameState,
  Heading,
  LevelDefinition,
  MoveResult,
  MoveTarget,
} from "./types";

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

function orientedPath(
  arrow: ArrowDefinition,
  endpoint: Endpoint,
): readonly Cell[] {
  return endpoint === "head" ? arrow.path : [...arrow.path].reverse();
}

function inBounds(cell: Cell, gridSize: number): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < gridSize && cell.y < gridSize;
}

function loopError(
  arrow: ArrowDefinition,
  level: LevelDefinition,
  endpoint: Endpoint,
): string | undefined {
  const path = orientedPath(arrow, endpoint);
  const initialHead = path[path.length - 1];
  if (!initialHead) {
    return `Arrow ${arrow.id} has no head cell.`;
  }
  const heading = headingForPath(path, level.gridSize);
  if (!heading) {
    return undefined;
  }
  let head: Cell = initialHead;
  let currentHeading = heading;
  const visited = new Set<string>();
  const maximumSteps = 6 * level.gridSize * level.gridSize * 4;
  for (let step = 1; step <= maximumSteps; step += 1) {
    const stateKey = `${cellKey(head)}:${currentHeading}`;
    if (visited.has(stateKey)) {
      return `Arrow ${arrow.id} has a nonterminating continuation loop from its ${endpoint} endpoint.`;
    }
    visited.add(stateKey);
    const forward = advanceHead(level, head, currentHeading);
    if (forward.exits) {
      return undefined;
    }
    const next = forward.next;
    if (!next) {
      return `Arrow ${arrow.id} has an incomplete topology step.`;
    }
    head = next;
    currentHeading = spotHeadingAt(level, head) ?? forward.heading;
  }
  return `Arrow ${arrow.id} has a nonterminating continuation loop from its ${endpoint} endpoint.`;
}

/** Spot state as a key fragment; a spot stored at its authored heading is left out. */
function spotStateKey(
  level: LevelDefinition,
  spotHeadings: Readonly<Record<string, Heading>> | undefined,
): string {
  const authored = new Map(
    (level.directionals ?? []).map((spot) => [
      cellKey(spot.cell),
      spot.heading,
    ]),
  );
  return Object.entries(spotHeadings ?? {})
    .filter(([key, heading]) => authored.get(key) !== heading)
    .map(([key, heading]) => `${key}=${heading}`)
    .sort()
    .join(",");
}

interface FoldState {
  /** Settled body in authored order. */
  readonly body: readonly Cell[];
  readonly spots: Readonly<Record<string, Heading>>;
}

/**
 * Report a stop circle that would park an arrow with its body covering one
 * cell twice. Searches every sequence of the arrow's own taps, from either
 * end of a double, starting from each given spot state and carrying the
 * arrow's own flips between legs. Other arrows are left out, so a flip that
 * another arrow makes between this arrow's legs is not modelled.
 */
function foldedStopError(
  level: LevelDefinition,
  arrow: ArrowDefinition,
  startSpots: readonly Readonly<Record<string, Heading>>[],
): string | undefined {
  const alone: LevelDefinition = { ...level, arrows: [arrow] };
  const endpoints: readonly Endpoint[] =
    arrow.kind === "double" ? ["head", "tail"] : ["head"];
  const seen = new Set<string>();
  const pending: FoldState[] = startSpots.map((spots) => ({
    body: arrow.path,
    spots,
  }));
  while (pending.length > 0) {
    const { body, spots } = pending.pop() as FoldState;
    const key = `${body.map(cellKey).join(">")}#${spotStateKey(level, spots)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const endpoint of endpoints) {
      const result = simulateMove(
        alone,
        [arrow.id],
        arrow.id,
        endpoint,
        0,
        {},
        { [arrow.id]: body },
        spots,
      );
      if (result.kind !== "paused") continue;
      const oriented = endpoint === "head" ? body : [...body].reverse();
      const parked = [...oriented, ...result.route.slice(1)].slice(
        -oriented.length,
      );
      const stop = result.route.at(-1);
      if (stop && new Set(parked.map(cellKey)).size !== parked.length) {
        return `Stop circle ${cellKey(stop)} would park arrow ${arrow.id} folded over itself.`;
      }
      const next: Record<string, Heading> = { ...spots };
      for (const flip of result.spotFlips ?? []) {
        next[cellKey(flip.cell)] = flippedHeading(
          spotHeadingAt(level, flip.cell, next) as Heading,
        );
      }
      pending.push({
        body: endpoint === "head" ? parked : [...parked].reverse(),
        spots: next,
      });
    }
  }
  return undefined;
}

/** Structural validation and independent full-motion loop checks. */
export function validateLevel(level: LevelDefinition): ValidationResult {
  const errors: string[] = [];
  if (!Number.isInteger(level.id) || level.id < 0) {
    errors.push("Level id must be a nonnegative integer.");
  }
  if (!Number.isInteger(level.gridSize) || level.gridSize < 2) {
    errors.push("Grid size must be an integer of at least 2.");
  }
  if (!Number.isInteger(level.lives) || level.lives < 1) {
    errors.push("Lives must be a positive integer.");
  }
  if (
    level.arrowScale !== undefined &&
    (!Number.isFinite(level.arrowScale) || level.arrowScale <= 0)
  ) {
    errors.push("Arrow display scale must be a positive finite number.");
  }
  const edgePolicies = new Set<string>();
  for (const edge of level.edgePolicies ?? []) {
    const key = `${edge.face}:${edge.edge}`;
    if (edgePolicies.has(key)) {
      errors.push(`Edge policy ${key} is declared more than once.`);
    }
    edgePolicies.add(key);
    if (edge.policy === "exit" && edge.neighbor) {
      errors.push(`Exit edge ${key} must not declare a continuation neighbor.`);
    }
    if (edge.policy === "continue" && !edge.neighbor) {
      errors.push(`Continuation edge ${key} needs an oriented neighbor.`);
    }
    if (edge.policy === "continue" && edge.neighbor) {
      const boundary: Cell =
        edge.edge === "east" || edge.edge === "west"
          ? {
              face: edge.face,
              x: edge.edge === "east" ? level.gridSize - 1 : 0,
              y: 0,
            }
          : {
              face: edge.face,
              x: 0,
              y: edge.edge === "south" ? level.gridSize - 1 : 0,
            };
      const expected = seamTransition(boundary, edge.edge, level.gridSize);
      if (
        expected.cell.face !== edge.neighbor.face ||
        expected.heading !== edge.neighbor.entering
      ) {
        errors.push(
          `Continuation edge ${key} does not match the cube seam transition.`,
        );
      }
    }
  }

  const ids = new Set<string>();
  const cells = new Map<string, string[]>();
  const links = new Map<string, string[]>();
  for (const arrow of level.arrows) {
    if (!arrow.id || ids.has(arrow.id)) {
      errors.push(
        `Arrow ids must be nonempty and unique: ${arrow.id || "<empty>"}.`,
      );
    }
    ids.add(arrow.id);
    if (arrow.kind && arrow.kind !== "single" && arrow.kind !== "double") {
      errors.push(
        `Arrow ${arrow.id} has unsupported kind ${String(arrow.kind)}.`,
      );
    }
    if (arrow.path.length < 2) {
      errors.push(`Arrow ${arrow.id} needs at least two path cells.`);
      continue;
    }
    for (const cell of arrow.path) {
      if (!inBounds(cell, level.gridSize)) {
        errors.push(
          `Arrow ${arrow.id} has an out-of-bounds cell ${cellKey(cell)}.`,
        );
      }
      const key = cellKey(cell);
      const owners = cells.get(key) ?? [];
      if (owners.includes(arrow.id)) {
        errors.push(`Arrow ${arrow.id} overlaps its own cell ${key}.`);
      }
      for (const owner of owners) {
        const previous = level.arrows.find(
          (candidate) => candidate.id === owner,
        );
        const segment = previous
          ? sharedDirectedSegment(previous, arrow)
          : undefined;
        if (!segment?.cells.has(key)) {
          errors.push(
            `Arrow ${arrow.id} overlaps cell ${key} already used by ${owner}.`,
          );
        }
      }
      cells.set(key, [...owners, arrow.id]);
    }
    for (let index = 1; index < arrow.path.length; index += 1) {
      const previous = arrow.path[index - 1];
      const current = arrow.path[index];
      if (
        !previous ||
        !current ||
        !headingForPath([previous, current], level.gridSize)
      ) {
        errors.push(
          `Arrow ${arrow.id} has non-adjacent path cells at link ${index}.`,
        );
        continue;
      }
      const key = linkKey(previous, current);
      const owners = links.get(key) ?? [];
      if (owners.includes(arrow.id)) {
        errors.push(`Arrow ${arrow.id} overlaps its own link ${key}.`);
      }
      for (const owner of owners) {
        const sharedOwner = level.arrows.find(
          (candidate) => candidate.id === owner,
        );
        const segment = sharedOwner
          ? sharedDirectedSegment(sharedOwner, arrow)
          : undefined;
        const directed = `${cellKey(previous)}>${cellKey(current)}`;
        if (!segment?.links.has(directed)) {
          errors.push(
            `Arrow ${arrow.id} overlaps link ${key} already used by ${owner}.`,
          );
        }
      }
      links.set(key, [...owners, arrow.id]);
    }
    for (const endpoint of arrow.kind === "double"
      ? (["head", "tail"] as const)
      : (["head"] as const)) {
      const loopProblem = loopError(arrow, level, endpoint);
      if (loopProblem) {
        errors.push(loopProblem);
      }
    }
  }
  const stopCells = new Set<string>();
  const arrowCells = new Set(
    level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
  );
  for (const stop of level.stops ?? []) {
    const key = cellKey(stop);
    if (!inBounds(stop, level.gridSize)) {
      errors.push(`Stop circle ${key} is out of bounds.`);
    }
    if (stopCells.has(key)) {
      errors.push(`Stop circle ${key} is declared more than once.`);
    }
    stopCells.add(key);
    if (arrowCells.has(key)) {
      errors.push(`Stop circle ${key} sits on an arrow's starting cell.`);
    }
  }

  const spotCells = new Set<string>();
  for (const spot of level.directionals ?? []) {
    const key = cellKey(spot.cell);
    if (!inBounds(spot.cell, level.gridSize)) {
      errors.push(`Directional spot ${key} is out of bounds.`);
    }
    if (spotCells.has(key)) {
      errors.push(`Directional spot ${key} is declared more than once.`);
    }
    spotCells.add(key);
    if (stopCells.has(key)) {
      errors.push(
        `Directional spot ${key} shares its cell with a stop circle.`,
      );
    }
    if (spot.kind === "flip" && stopCells.has(key)) {
      errors.push(`Flip spot ${key} shares its cell with a stop circle.`);
    }
    if (arrowCells.has(key)) {
      errors.push(`Directional spot ${key} sits on an arrow's starting cell.`);
    }
  }
  if (spotCells.size > 0) {
    const grouped = level.arrows.some(
      (arrow) => overlappingArrowIds(level, arrow.id).length > 1,
    );
    if (grouped) {
      errors.push(
        "A level with directional spots cannot contain shared-tail groups.",
      );
    }
  }

  // A fold can only park on a stop circle, so levels without one skip the search.
  if (stopCells.size > 0) {
    const combos: Record<string, Heading>[] = [{}];
    for (const spot of (level.directionals ?? []).filter(
      (candidate) => candidate.kind === "flip",
    )) {
      const key = cellKey(spot.cell);
      for (const combo of [...combos]) {
        combos.push({ ...combo, [key]: flippedHeading(spot.heading) });
      }
    }
    for (const arrow of level.arrows) {
      const problem = foldedStopError(level, arrow, combos);
      if (problem && !errors.includes(problem)) errors.push(problem);
    }
  }

  const checkedGroups = new Set<string>();
  for (const arrow of level.arrows) {
    const group = overlappingArrowIds(level, arrow.id);
    if (group.length < 2) continue;
    const groupKey = [...group].sort().join("|");
    if (checkedGroups.has(groupKey)) continue;
    checkedGroups.add(groupKey);
    if (group.length > 3) {
      errors.push(`Shared-tail group ${groupKey} has more than three arrows.`);
    }
    const members = level.arrows.filter((candidate) =>
      group.includes(candidate.id),
    );
    if (members.some((member) => member.kind === "double")) {
      errors.push(
        `Shared-tail group ${groupKey} cannot contain double-ended arrows.`,
      );
    }
    // Members share one offset and the group stops advancing as soon as any
    // member would leave, so a stop deeper than the shortest travel parks a
    // head the group can never actually move it to.
    const reach = Math.min(
      ...members.map((member) => maximumOffset(level, member)),
    );
    const unreachable = members.some((member) =>
      arrowTrack(level, member)
        .slice(member.path.length + reach)
        .some((cell) => stopCells.has(cellKey(cell))),
    );
    if (unreachable) {
      errors.push(
        `Shared-tail group ${groupKey} has a stop circle it can never park on.`,
      );
    }
    for (let firstIndex = 0; firstIndex < members.length; firstIndex += 1) {
      const first = members[firstIndex];
      if (!first) continue;
      for (const second of members.slice(firstIndex + 1)) {
        const firstRoute = simulateMove(level, [first.id], first.id);
        const secondRoute = simulateMove(level, [second.id], second.id);
        const firstTravel = firstRoute.route.map(cellKey);
        const secondTravel = secondRoute.route.map(cellKey);
        const secondBody = second.path.map(cellKey);
        const firstBody = first.path.map(cellKey);
        if (
          firstTravel.some((key) => secondBody.includes(key)) ||
          secondTravel.some((key) => firstBody.includes(key)) ||
          firstTravel.some((key) => secondTravel.includes(key))
        ) {
          errors.push(
            `Shared-tail group ${groupKey} has crossing or contacting travel paths.`,
          );
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Drive one arrow from its settled position to an exit, parking on every stop
 * circle along the way. Undefined means some leg of that drive was blocked.
 */
function targetsFor(
  level: LevelDefinition,
  arrowId: string,
): readonly MoveTarget[] {
  const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
  return arrow?.kind === "double"
    ? [
        { arrowId, endpoint: "head" },
        { arrowId, endpoint: "tail" },
      ]
    : [{ arrowId, endpoint: "head" }];
}

/** True when `arrowId` may be tapped; a proof probe restricts taps to a region. */
function tappable(
  tapFilter: ((arrowId: string) => boolean) | undefined,
  arrowId: string,
): boolean {
  return tapFilter ? tapFilter(arrowId) : true;
}

/**
 * Simulate one tap with optional extra static occupancy. A blocked cell acts
 * exactly like an arrow sitting on it: the head stops on the first route cell
 * (after its own) that carries one, which also outranks a stop circle on the
 * same cell, matching the engine's per-step collision-before-pause order.
 */
export function probeMove(
  level: LevelDefinition,
  state: GameState,
  arrowId: string,
  endpoint: Endpoint,
  blockedCells?: ReadonlySet<string>,
): MoveResult {
  const result = simulateState(level, state, arrowId, endpoint);
  if (!blockedCells || blockedCells.size === 0) return result;
  for (let index = 1; index < result.route.length; index += 1) {
    const step = result.route[index];
    if (!step || !blockedCells.has(cellKey(step))) continue;
    const route = result.route.slice(0, index + 1);
    return {
      ...result,
      kind: "blocked",
      distance: index - 0.5,
      route,
      waypoints: route.map((cell) => ({ cell, phase: "surface" as const })),
    };
  }
  return result;
}

function driveThrough(
  level: LevelDefinition,
  state: GameState,
  target: MoveTarget,
  blockedCells?: ReadonlySet<string>,
):
  | { readonly state: GameState; readonly taps: readonly MoveTarget[] }
  | undefined {
  const maximumTaps = level.gridSize * 6 + 2;
  const taps: MoveTarget[] = [];
  let current = state;
  for (let tap = 0; tap < maximumTaps; tap += 1) {
    const result = probeMove(
      level,
      current,
      target.arrowId,
      target.endpoint,
      blockedCells,
    );
    if (result.kind !== "exit" && result.kind !== "paused") return undefined;
    const next = applyMove(level, current, result);
    if (next === current) return undefined;
    taps.push(target);
    current = next;
    if (result.kind === "exit") return { state: current, taps };
  }
  return undefined;
}

/**
 * Remove every arrow that can currently reach its exit. Removing an arrow only
 * ever frees cells, so clearing greedily can never strand another arrow and
 * needs no backtracking. An exit can also flip a spot; flip cores get the same
 * guarantee from enumerating their states (`hasStrandingState`), not from this.
 */
function clearWhatExits(
  level: LevelDefinition,
  state: GameState,
  tapFilter?: (arrowId: string) => boolean,
  blockedCells?: ReadonlySet<string>,
): { readonly state: GameState; readonly taps: readonly MoveTarget[] } {
  const taps: MoveTarget[] = [];
  let current = state;
  for (let pass = 0; pass <= level.arrows.length; pass += 1) {
    const before = current.remainingIds.length;
    for (const arrowId of [...current.remainingIds]) {
      if (!tappable(tapFilter, arrowId)) continue;
      if (!current.remainingIds.includes(arrowId)) continue;
      const cleared = targetsFor(level, arrowId)
        .map((target) => driveThrough(level, current, target, blockedCells))
        .find((result) => result !== undefined);
      if (!cleared) continue;
      current = cleared.state;
      taps.push(...cleared.taps);
    }
    if (current.remainingIds.length === before) break;
  }
  return { state: current, taps };
}

function solveKey(level: LevelDefinition, state: GameState): string {
  const parked = Object.entries(state.offsets)
    .filter(([, value]) => value > 0)
    .map(([id, value]) => `${id}@${value}`)
    .sort()
    .join(",");
  const settled = Object.entries(state.settledPaths ?? {})
    .map(([id, path]) => `${id}@${path.map(cellKey).join(">")}`)
    .sort()
    .join(",");
  const failures = [...(state.failedPositions ?? [])].sort().join(",");
  const spots = spotStateKey(level, state.spotHeadings);
  return `${[...state.remainingIds].sort().join("|")}#${parked}#${settled}#${failures}#${spots}`;
}

const SOLVER_NODE_BUDGET = 4000;

/**
 * Enumerate every state reachable without a collision and report whether any
 * of them can no longer be cleared. Undefined means the state space exceeded
 * `limit`, so the answer is unknown; only small cores should be checked.
 * `tapFilter` restricts which arrows may be tapped and `blockedCells` adds
 * static occupancy; with neither, this is the whole-level check.
 */
function enumerateStranding(
  level: LevelDefinition,
  state: GameState,
  limit = 5000,
  tapFilter?: (arrowId: string) => boolean,
  blockedCells?: ReadonlySet<string>,
): boolean | undefined {
  const states = new Map<string, readonly string[]>();
  const winnableSeeds = new Set<string>();
  const pending = [state];
  while (pending.length > 0) {
    const current = pending.pop() as GameState;
    const key = solveKey(level, current);
    if (states.has(key)) continue;
    if (states.size >= limit) return undefined;
    const next: string[] = [];
    // Without a filter a state is clearable only once nothing remains, which
    // is the empty-remainingIds terminal the whole-level check relied on.
    if (current.remainingIds.every((id) => !tappable(tapFilter, id))) {
      winnableSeeds.add(key);
    } else {
      for (const arrowId of current.remainingIds) {
        if (!tappable(tapFilter, arrowId)) continue;
        for (const target of targetsFor(level, arrowId)) {
          const result = probeMove(
            level,
            current,
            target.arrowId,
            target.endpoint,
            blockedCells,
          );
          if (result.kind !== "exit" && result.kind !== "paused") continue;
          const settled = applyMove(level, current, result);
          if (settled === current) continue;
          next.push(solveKey(level, settled));
          pending.push(settled);
        }
      }
    }
    states.set(key, next);
  }
  const winnable = new Set(winnableSeeds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [key, next] of states) {
      if (!winnable.has(key) && next.some((entry) => winnable.has(entry))) {
        winnable.add(key);
        grew = true;
      }
    }
  }
  return winnable.size < states.size;
}

/**
 * Enumerate every state reachable without a collision and report whether any
 * of them can no longer be cleared. Undefined means the state space exceeded
 * `limit`, so the answer is unknown; only small cores should be checked.
 */
export function hasStrandingState(
  level: LevelDefinition,
  limit = 5000,
): boolean | undefined {
  return enumerateStranding(level, createGameState(level), limit);
}

/**
 * True when some collision-free reachable state has an arrow whose tap is
 * safe with the flip spots as they are and a collision with them reversed,
 * or the other way round. Undefined when the state space exceeds `limit`.
 * `tapFilter` restricts which arrows may be tapped and `blockedCells` adds
 * static occupancy; with neither, this is the whole-level check.
 */
function enumeratedFlipInterest(
  level: LevelDefinition,
  state: GameState,
  limit = 5000,
  tapFilter?: (arrowId: string) => boolean,
  blockedCells?: ReadonlySet<string>,
): boolean | undefined {
  const flips = (level.directionals ?? []).filter(
    (spot) => spot.kind === "flip",
  );
  if (flips.length === 0) return false;
  const seen = new Set<string>();
  const pending = [state];
  const safe = (kind: string): boolean => kind === "exit" || kind === "paused";
  while (pending.length > 0) {
    const current = pending.pop() as GameState;
    const key = solveKey(level, current);
    if (seen.has(key)) continue;
    if (seen.size >= limit) return undefined;
    seen.add(key);
    for (const arrowId of current.remainingIds) {
      if (!tappable(tapFilter, arrowId)) continue;
      for (const target of targetsFor(level, arrowId)) {
        const result = probeMove(
          level,
          current,
          target.arrowId,
          target.endpoint,
          blockedCells,
        );
        for (const spot of flips) {
          const spotKey = cellKey(spot.cell);
          const spotHeading = spotHeadingAt(
            level,
            spot.cell,
            current.spotHeadings,
          ) as Heading;
          const reversed: GameState = {
            ...current,
            spotHeadings: {
              ...(current.spotHeadings ?? {}),
              [spotKey]: flippedHeading(spotHeading),
            },
          };
          const other = probeMove(
            level,
            reversed,
            target.arrowId,
            target.endpoint,
            blockedCells,
          );
          if (
            safe(result.kind) !== safe(other.kind) &&
            (result.kind === "blocked" || other.kind === "blocked")
          ) {
            return true;
          }
        }
        if (!safe(result.kind)) continue;
        const next = applyMove(level, current, result);
        if (next !== current) pending.push(next);
      }
    }
  }
  return false;
}

/**
 * True when some collision-free reachable state has an arrow whose tap is
 * safe with the flip spots as they are and a collision with them reversed,
 * or the other way round. Undefined when the state space exceeds `limit`.
 */
export function flipInterest(
  level: LevelDefinition,
  limit = 5000,
): boolean | undefined {
  return enumeratedFlipInterest(level, createGameState(level), limit);
}

/**
 * Parking an arrow on a stop circle occupies new cells, so unlike clearing it
 * can strand other arrows and has to be explored with backtracking. Reverse
 * construction gives generated levels a drive-through certificate, so they
 * finish in the greedy pass and never reach this search.
 */
function searchSolution(
  level: LevelDefinition,
  state: GameState,
  visited: Set<string>,
  budget: { remaining: number },
  tapFilter?: (arrowId: string) => boolean,
  blockedCells?: ReadonlySet<string>,
): readonly MoveTarget[] | undefined {
  const cleared = clearWhatExits(level, state, tapFilter, blockedCells);
  if (cleared.state.remainingIds.every((id) => !tappable(tapFilter, id)))
    return cleared.taps;
  const key = solveKey(level, cleared.state);
  if (visited.has(key)) return undefined;
  visited.add(key);
  for (const arrowId of cleared.state.remainingIds) {
    if (!tappable(tapFilter, arrowId)) continue;
    for (const target of targetsFor(level, arrowId)) {
      if (budget.remaining <= 0) return undefined;
      budget.remaining -= 1;
      const result = probeMove(
        level,
        cleared.state,
        target.arrowId,
        target.endpoint,
        blockedCells,
      );
      if (result.kind !== "paused") continue;
      const parked = applyMove(level, cleared.state, result);
      if (parked === cleared.state) continue;
      const rest = searchSolution(
        level,
        parked,
        visited,
        budget,
        tapFilter,
        blockedCells,
      );
      if (rest) return [...cleared.taps, target, ...rest];
    }
  }
  return undefined;
}

/**
 * True when the greedy-plus-parking search clears every arrow the filter
 * allows, with optional static occupancy from outside blockers. This is the
 * same search the solver runs, restricted to what may be tapped.
 */
function enumeratedSolvable(
  level: LevelDefinition,
  state: GameState,
  tapFilter?: (arrowId: string) => boolean,
  blockedCells?: ReadonlySet<string>,
): boolean {
  const solution = searchSolution(
    level,
    state,
    new Set(),
    {
      remaining: SOLVER_NODE_BUDGET,
    },
    tapFilter,
    blockedCells,
  );
  return solution !== undefined;
}

/**
 * Replay a deterministic no-mistake solution under the same simulation used by
 * the game. The result lists taps in order, so an arrow that parks on a stop
 * circle appears once per leg. Undefined means no legal full-clear sequence was
 * found.
 */
export function solveLevelTargets(
  level: LevelDefinition,
): readonly MoveTarget[] | undefined {
  if (!validateLevel(level).valid) {
    return undefined;
  }
  return searchSolution(level, createGameState(level), new Set(), {
    remaining: SOLVER_NODE_BUDGET,
  });
}

/** Legacy string certificate for levels containing only single-ended arrows. */
export function solveLevel(
  level: LevelDefinition,
): readonly string[] | undefined {
  const targets = solveLevelTargets(level);
  if (!targets) return undefined;
  if (
    targets.some(
      (target) =>
        level.arrows.find((arrow) => arrow.id === target.arrowId)?.kind ===
        "double",
    )
  ) {
    return undefined;
  }
  return targets.map((target) => target.arrowId);
}

export interface InteractionRegion {
  /** Arrow ids in the region, including the seed arrows. */
  readonly arrowIds: readonly string[];
  /** Flip-spot and stop cell keys inside the region. */
  readonly spotKeys: readonly string[];
  readonly stopKeys: readonly string[];
  /** Every cell any region arrow can occupy under any spot state (tracks + bodies). */
  readonly cells: ReadonlySet<string>;
}

/**
 * Cell keys an arrow occupies now or can ever occupy (its authored body plus
 * its track) under any flip-spot state, so a closure derived from these keys
 * stays valid whatever a spot's current direction is.
 */
function occupancyKeys(
  level: LevelDefinition,
  arrow: ArrowDefinition,
): ReadonlySet<string> {
  const keys = new Set<string>();
  const probes = flipHeadingProbes(level);
  for (const probe of probes) {
    for (const cell of arrowTrack(probe, arrow)) {
      keys.add(cellKey(cell));
    }
  }
  return keys;
}

/** Level variants covering every direction each flip spot can hold. */
function flipHeadingProbes(level: LevelDefinition): readonly LevelDefinition[] {
  const flips = (level.directionals ?? []).filter(
    (spot) => spot.kind === "flip",
  );
  if (flips.length === 0) return [level];
  let probes: LevelDefinition[] = [level];
  for (const spot of flips) {
    const reversed = flippedHeading(spot.heading);
    probes = probes.flatMap((probe) => [
      probe,
      {
        ...probe,
        directionals: (probe.directionals ?? []).map((candidate) =>
          cellKey(candidate.cell) === cellKey(spot.cell)
            ? { ...candidate, heading: reversed }
            : candidate,
        ),
      },
    ]);
  }
  return probes;
}

/**
 * Close seed arrows under reachability: any arrow whose track touches a cell
 * a region arrow can occupy joins the region. Undefined past `maxArrows`.
 */
export function interactionRegion(
  level: LevelDefinition,
  seedArrowIds: readonly string[],
  maxArrows = 6,
): InteractionRegion | undefined {
  const byId = new Map(level.arrows.map((arrow) => [arrow.id, arrow]));
  const stopSet = new Set((level.stops ?? []).map(cellKey));
  const spotSet = new Set(
    (level.directionals ?? []).map((spot) => cellKey(spot.cell)),
  );
  const occupancy = new Map<string, ReadonlySet<string>>();
  const occupancyOf = (arrow: ArrowDefinition): ReadonlySet<string> => {
    let keys = occupancy.get(arrow.id);
    if (!keys) {
      keys = occupancyKeys(level, arrow);
      occupancy.set(arrow.id, keys);
    }
    return keys;
  };
  const members = new Set<string>();
  const cells = new Set<string>();
  const frontier = [...seedArrowIds];
  while (frontier.length > 0) {
    const id = frontier.pop() as string;
    if (members.has(id)) continue;
    const arrow = byId.get(id);
    if (!arrow) continue;
    if (members.size >= maxArrows) return undefined;
    members.add(id);
    for (const key of occupancyOf(arrow)) cells.add(key);
    for (const key of occupancyOf(arrow)) {
      if (stopSet.has(key) || spotSet.has(key)) continue;
      for (const other of level.arrows) {
        if (members.has(other.id) || frontier.includes(other.id)) continue;
        if (occupancyOf(other).has(key)) frontier.push(other.id);
      }
    }
  }
  return {
    arrowIds: [...members],
    spotKeys: [...spotSet].filter((key) => cells.has(key)),
    stopKeys: [...stopSet].filter((key) => cells.has(key)),
    cells,
  };
}

/**
 * Prove a region with outside arrows as static blockers: occupancy includes
 * their settled cells, but they are never tapped. A blocker only removes
 * options, so clearable-under-blockers implies clearable-in-game.
 */
export function proveRegion(
  level: LevelDefinition,
  state: GameState,
  region: InteractionRegion,
  limit = 5000,
): {
  readonly ok: boolean;
  readonly reason?: "stranded" | "uninteresting" | "unsolvable" | "overflow";
} {
  const inside = new Set(region.arrowIds);
  const blocked = new Set<string>();
  for (const arrow of level.arrows) {
    if (inside.has(arrow.id) || !state.remainingIds.includes(arrow.id))
      continue;
    for (const cell of settledPathOf(level, state, arrow)) {
      blocked.add(cellKey(cell));
    }
  }
  const stranded = enumerateStranding(
    level,
    state,
    limit,
    (id) => inside.has(id),
    blocked,
  );
  if (stranded === undefined) return { ok: false, reason: "overflow" };
  if (stranded === true) return { ok: false, reason: "stranded" };
  const interesting = enumeratedFlipInterest(
    level,
    state,
    limit,
    (id) => inside.has(id),
    blocked,
  );
  if (interesting !== true) {
    return {
      ok: false,
      reason: interesting === undefined ? "overflow" : "uninteresting",
    };
  }
  if (!enumeratedSolvable(level, state, (id) => inside.has(id), blocked)) {
    return { ok: false, reason: "unsolvable" };
  }
  return { ok: true };
}
