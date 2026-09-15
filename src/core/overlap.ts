import { cellsEqual } from "./topology";
import type { ArrowDefinition, LevelDefinition } from "./types";

export interface SharedSegment {
  readonly cells: ReadonlySet<string>;
  readonly links: ReadonlySet<string>;
}

function key(cell: ArrowDefinition["path"][number]): string {
  return `${cell.face}:${cell.x}:${cell.y}`;
}

export function sharedDirectedSegment(
  first: ArrowDefinition,
  second: ArrowDefinition,
): SharedSegment | undefined {
  const runs: { cells: Set<string>; links: Set<string> }[] = [];
  for (
    let firstIndex = 0;
    firstIndex < first.path.length - 1;
    firstIndex += 1
  ) {
    const a = first.path[firstIndex];
    const b = first.path[firstIndex + 1];
    if (!a || !b || firstIndex + 1 === first.path.length - 1) continue;
    for (
      let secondIndex = 0;
      secondIndex < second.path.length - 1;
      secondIndex += 1
    ) {
      const c = second.path[secondIndex];
      const d = second.path[secondIndex + 1];
      if (!c || !d || secondIndex + 1 === second.path.length - 1) continue;
      if (!cellsEqual(a, c) || !cellsEqual(b, d)) continue;
      const cells = new Set<string>([key(a), key(b)]);
      const links = new Set<string>([`${key(a)}>${key(b)}`]);
      let offset = 1;
      while (
        firstIndex + offset + 1 < first.path.length - 1 &&
        secondIndex + offset + 1 < second.path.length - 1
      ) {
        const from = first.path[firstIndex + offset];
        const to = first.path[firstIndex + offset + 1];
        const matchingFrom = second.path[secondIndex + offset];
        const matchingTo = second.path[secondIndex + offset + 1];
        if (
          !from ||
          !to ||
          !matchingFrom ||
          !matchingTo ||
          !cellsEqual(from, matchingFrom) ||
          !cellsEqual(to, matchingTo)
        ) {
          break;
        }
        cells.add(key(to));
        links.add(`${key(from)}>${key(to)}`);
        offset += 1;
      }
      runs.push({ cells, links });
    }
  }
  if (runs.length === 0) return undefined;
  const longest = runs.sort(
    (left, right) => right.links.size - left.links.size,
  )[0];
  if (!longest) return undefined;
  const sharedCells = new Set<string>();
  const sharedLinks = new Set<string>();
  for (const run of runs) {
    for (const cell of run.cells) sharedCells.add(cell);
    for (const link of run.links) sharedLinks.add(link);
  }
  if (sharedLinks.size !== longest.links.size) return undefined;
  return { cells: sharedCells, links: sharedLinks };
}

/** Return the connected same-direction tail group containing `arrowId`. */
export function overlappingArrowIds(
  level: LevelDefinition,
  arrowId: string,
): readonly string[] {
  let cache = GROUPS.get(level);
  if (!cache) {
    const parents = new Map(level.arrows.map((arrow) => [arrow.id, arrow.id]));
    const owners = new Map<string, string[]>();
    const find = (id: string): string => {
      const parent = parents.get(id) ?? id;
      if (parent === id) return id;
      const root = find(parent);
      parents.set(id, root);
      return root;
    };
    for (const arrow of level.arrows) {
      for (let index = 0; index < arrow.path.length - 2; index += 1) {
        const from = arrow.path[index];
        const to = arrow.path[index + 1];
        if (!from || !to) continue;
        const link = `${key(from)}>${key(to)}`;
        owners.set(link, [...(owners.get(link) ?? []), arrow.id]);
      }
    }
    for (const ids of owners.values()) {
      const first = ids[0];
      if (!first) continue;
      for (const id of ids.slice(1)) {
        const firstRoot = find(first);
        const root = find(id);
        if (firstRoot !== root) parents.set(root, firstRoot);
      }
    }
    const members = new Map<string, string[]>();
    for (const arrow of level.arrows) {
      const root = find(arrow.id);
      members.set(root, [...(members.get(root) ?? []), arrow.id]);
    }
    cache = new Map();
    for (const ids of members.values()) {
      for (const id of ids) cache.set(id, ids);
    }
    GROUPS.set(level, cache);
  }
  return cache.get(arrowId) ?? [arrowId];
}

const GROUPS = new WeakMap<LevelDefinition, Map<string, readonly string[]>>();
