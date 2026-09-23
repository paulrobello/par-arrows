import { spotHeadingAt } from "./directionals";
import { advanceHead, cellKey, headingForPath } from "./topology";
import type {
  ArrowDefinition,
  Cell,
  GameState,
  LevelDefinition,
} from "./types";

/** Cell keys of every stop circle declared by a level. */
export function stopKeys(
  level: Pick<LevelDefinition, "stops">,
): ReadonlySet<string> {
  return new Set((level.stops ?? []).map(cellKey));
}

/**
 * Every cell an arrow's head can ever occupy, from its authored tail through the
 * last surface cell before it leaves the cube. Routing is pure topology, so the
 * track never depends on other arrows and stays constant for the whole level.
 */
export function arrowTrack(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies" | "directionals">,
  arrow: ArrowDefinition,
): readonly Cell[] {
  const track: Cell[] = [...arrow.path];
  const heading = headingForPath(arrow.path, level.gridSize);
  let current = arrow.path[arrow.path.length - 1];
  if (!heading || !current) return track;
  let currentHeading = heading;
  const visited = new Set<string>();
  const maximumSteps = 6 * level.gridSize * level.gridSize * 4;
  for (let step = 1; step <= maximumSteps; step += 1) {
    const stateKey = `${cellKey(current)}:${currentHeading}`;
    if (visited.has(stateKey)) return track;
    visited.add(stateKey);
    const forward = advanceHead(level, current, currentHeading);
    if (forward.exits || !forward.next) return track;
    track.push(forward.next);
    current = forward.next;
    currentHeading = spotHeadingAt(level, current) ?? forward.heading;
  }
  return track;
}

/** The largest forward offset an arrow can hold without leaving the cube. */
export function maximumOffset(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies" | "directionals">,
  arrow: ArrowDefinition,
): number {
  return Math.max(0, arrowTrack(level, arrow).length - arrow.path.length);
}

/** The cells an arrow occupies after travelling `offset` forward steps. */
export function currentPath(
  level: Pick<LevelDefinition, "gridSize" | "edgePolicies" | "directionals">,
  arrow: ArrowDefinition,
  offset: number,
): readonly Cell[] {
  if (offset <= 0) return arrow.path;
  const track = arrowTrack(level, arrow);
  const start = Math.min(offset, track.length - arrow.path.length);
  return start <= 0
    ? arrow.path
    : track.slice(start, start + arrow.path.length);
}

/** The exact occupied path of an active arrow in a settled state. */
export function settledPathOf(
  level: LevelDefinition,
  state: Pick<GameState, "offsets" | "settledPaths">,
  arrow: ArrowDefinition,
): readonly Cell[] {
  if (arrow.kind === "double") {
    return state.settledPaths?.[arrow.id] ?? arrow.path;
  }
  return currentPath(level, arrow, offsetOf(state.offsets, arrow.id));
}

/** A paid-failure key shared by both endpoints at one settled position. */
export function failurePositionKey(
  arrowId: string,
  path: readonly Cell[],
): string {
  return `${arrowId}:${path.map(cellKey).join("|")}`;
}

/** Read one arrow's settled offset, treating a missing entry as unmoved. */
export function offsetOf(
  offsets: Readonly<Record<string, number>> | undefined,
  arrowId: string,
): number {
  const value = offsets?.[arrowId];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

/** True when any remaining arrow is parked partway along its track. */
export function hasParkedArrows(state: Pick<GameState, "offsets">): boolean {
  return Object.values(state.offsets ?? {}).some((value) => value > 0);
}
