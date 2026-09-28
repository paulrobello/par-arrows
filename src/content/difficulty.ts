import type { ArrowDefinition, LevelDefinition } from "../core/types";
import { overlappingArrowIds } from "../core/overlap";
import { arrowTrack } from "../core/stops";
import { cellKey } from "../core/topology";

/** Share of fill placements that must have a clear route: the depth dial. */
export function clearShare(id: number): number {
  if (id <= 4) return 1;
  if (id >= 60) return 0;
  return 0.95 * (1 - Math.max(0, id - 6) / 54);
}

/** Relative slack: a board passes at 90% of each floor, or 110% of the cap. */
export const GATE_TOLERANCE = 0.1;

type Waypoints = readonly (readonly [number, number])[];

/** Piecewise-linear through `points`, held flat before the first and after the last. */
function piecewise(points: Waypoints, id: number): number {
  const [first] = points;
  if (!first || id <= first[0]) return first?.[1] ?? 0;
  for (let index = 1; index < points.length; index += 1) {
    const [x0, y0] = points[index - 1] as readonly [number, number];
    const [x1, y1] = points[index] as readonly [number, number];
    if (id <= x1) return y0 + ((y1 - y0) * (id - x0)) / (x1 - x0);
  }
  return (points[points.length - 1] as readonly [number, number])[1];
}

// Floors sit at or below each band's measured 10th percentile (the cap at or
// above its 90th), so about nine boards in ten pass on first construction.
const MEDIAN_WAYPOINTS: Waypoints = [
  [12, 2],
  [20, 2],
  [40, 6],
  [60, 12],
];
const DEEP_WAYPOINTS: Waypoints = [
  [12, 0],
  [20, 0.06],
  [40, 0.36],
  [60, 0.48],
];
const FREE_WAYPOINTS: Waypoints = [
  [10, 0.4],
  [20, 0.26],
  [40, 0.21],
  [60, 0.16],
];

/** Floor on the median closure size over tap units. */
export function medianTarget(id: number): number {
  if (id < 12) return 0;
  return Math.round(piecewise(MEDIAN_WAYPOINTS, id));
}

/** Floor on the share of units whose closure is at least `DEEP_CLOSURE`. */
export function deepShareTarget(id: number): number {
  if (id <= 12) return 0;
  return piecewise(DEEP_WAYPOINTS, id);
}

/** Cap on the share of units that start free. */
export function freeCap(id: number): number {
  return piecewise(FREE_WAYPOINTS, id);
}

export function meetsDepthGate(id: number, stats: ClosureStats): boolean {
  return (
    stats.median >= medianTarget(id) * (1 - GATE_TOLERANCE) &&
    stats.deepShare >= deepShareTarget(id) * (1 - GATE_TOLERANCE) &&
    stats.freeShare <= freeCap(id) * (1 + GATE_TOLERANCE)
  );
}

interface Unit {
  readonly memberIds: readonly string[];
}

function units(level: LevelDefinition): readonly Unit[] {
  const counted = new Set<string>();
  const list: Unit[] = [];
  for (const arrow of level.arrows) {
    if (counted.has(arrow.id)) continue;
    const memberIds = overlappingArrowIds(level, arrow.id);
    for (const id of memberIds) counted.add(id);
    list.push({ memberIds });
  }
  return list;
}

export interface ClosureStats {
  readonly median: number;
  readonly deepShare: number;
  readonly freeShare: number;
}

/** Closure size at which a unit counts as deep. */
export const DEEP_CLOSURE = 15;

/**
 * Units whose bodies sit on each route of each unit. A double contributes
 * two routes (head and reversed path) that are kept apart, because its
 * closure is the smaller of the two.
 */
function unitRoutes(level: LevelDefinition): {
  list: readonly Unit[];
  routes: ReadonlyArray<ReadonlyArray<ReadonlySet<number>>>;
} {
  const list = units(level);
  const owner = new Map<string, number>();
  list.forEach((unit, index) => {
    for (const id of unit.memberIds) {
      const arrow = level.arrows.find((entry) => entry.id === id);
      for (const cell of arrow?.path ?? []) owner.set(cellKey(cell), index);
    }
  });
  const onRoute = (arrow: ArrowDefinition, self: number): Set<number> => {
    const found = new Set<number>();
    for (const cell of arrowTrack(level, arrow).slice(arrow.path.length)) {
      const unit = owner.get(cellKey(cell));
      if (unit !== undefined && unit !== self) found.add(unit);
    }
    return found;
  };
  const routes = list.map((unit, index) => {
    const members = unit.memberIds
      .map((id) => level.arrows.find((entry) => entry.id === id))
      .filter((arrow): arrow is ArrowDefinition => arrow !== undefined);
    const lead = members[0];
    if (members.length === 1 && lead?.kind === "double") {
      return [
        onRoute(lead, index),
        onRoute({ ...lead, path: [...lead.path].reverse() }, index),
      ];
    }
    const union = new Set<number>();
    for (const member of members) {
      for (const blocker of onRoute(member, index)) union.add(blocker);
    }
    return [union];
  });
  return { list, routes };
}

export function closureStats(level: LevelDefinition): ClosureStats {
  const { list, routes } = unitRoutes(level);
  // A unit's graph edges are the union of its routes' prerequisites: every
  // route a double might take needs its bodies gone eventually from the
  // perspective of anything waiting on the double.
  const edges = routes.map((sets) => {
    const all = new Set<number>();
    for (const set of sets) for (const unit of set) all.add(unit);
    return all;
  });
  const reach = (start: ReadonlySet<number>, self: number): number => {
    const seen = new Set<number>();
    const stack = [...start];
    while (stack.length > 0) {
      const next = stack.pop() as number;
      if (next === self || seen.has(next)) continue;
      seen.add(next);
      for (const more of edges[next] ?? []) stack.push(more);
    }
    return seen.size;
  };
  const sizes = routes.map((sets, index) =>
    Math.min(...sets.map((set) => reach(set, index))),
  );
  const n = list.length;
  if (n === 0) return { median: 0, deepShare: 0, freeShare: 0 };
  const sorted = [...sizes].sort((a, b) => a - b);
  const middle = Math.floor(n / 2);
  const median =
    n % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return {
    median,
    deepShare: sizes.filter((size) => size >= DEEP_CLOSURE).length / n,
    freeShare: sizes.filter((size) => size === 0).length / n,
  };
}
