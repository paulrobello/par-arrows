import { spotHeadingAt } from "./directionals";
import { cellKey } from "./topology";
import { advanceWithPortals, pathHeading } from "./wormholes";
import type {
  ArrowDefinition,
  Cell,
  GameState,
  LevelDefinition,
} from "./types";

/**
 * Level fields the track helpers read. Wormholes only matter when a level
 * declares them; every generated and authored level without them is unchanged.
 */
type TrackSource = Pick<
  LevelDefinition,
  "gridSize" | "edgePolicies" | "directionals" | "wormholes"
>;

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
  level: TrackSource,
  arrow: ArrowDefinition,
): readonly Cell[] {
  const track: Cell[] = [...arrow.path];
  const heading = pathHeading(level, arrow.path);
  let current = arrow.path[arrow.path.length - 1];
  if (!heading || !current) return track;
  let currentHeading = heading;
  const visited = new Set<string>();
  const maximumSteps = 6 * level.gridSize * level.gridSize * 4;
  for (let step = 1; step <= maximumSteps; step += 1) {
    const stateKey = `${cellKey(current)}:${currentHeading}`;
    if (visited.has(stateKey)) return track;
    visited.add(stateKey);
    const forward = advanceWithPortals(level, current, currentHeading);
    if (forward.exits || !forward.next) return track;
    track.push(forward.next);
    current = forward.next;
    currentHeading = spotHeadingAt(level, current) ?? forward.heading;
  }
  return track;
}

/**
 * Cell keys of an arrow's track, traced from both ends of a double, so a
 * double's tail-direction cells count alongside its head-direction cells.
 */
export function trackKeys(
  level: TrackSource,
  arrow: ArrowDefinition,
): string[] {
  const paths =
    arrow.kind === "double"
      ? [arrow.path, [...arrow.path].reverse()]
      : [arrow.path];
  return paths.flatMap((path) =>
    arrowTrack(level, { ...arrow, path }).map(cellKey),
  );
}

/** The largest forward offset an arrow can hold without leaving the cube. */
export function maximumOffset(
  level: TrackSource,
  arrow: ArrowDefinition,
): number {
  return Math.max(0, arrowTrack(level, arrow).length - arrow.path.length);
}

/** The cells an arrow occupies after travelling `offset` forward steps. */
export function currentPath(
  level: TrackSource,
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
  const settled = state.settledPaths?.[arrow.id];
  if (settled) return settled;
  if (arrow.kind === "double") return arrow.path;
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
