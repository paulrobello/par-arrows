import { cellKey, stepSurface, HEADINGS } from "./topology";
import type { Cell, LevelDefinition, LockDefinition } from "./types";

type LockSource = Pick<LevelDefinition, "locks">;

export const MAX_LOCKS = 2;

interface LockIndex {
  /** Locks keyed by their gate cell. */
  readonly gates: ReadonlyMap<string, LockDefinition>;
  /** Locks keyed by their key cell; one key cell opens one lock. */
  readonly keys: ReadonlyMap<string, LockDefinition>;
}

const EMPTY: LockIndex = { gates: new Map(), keys: new Map() };

/**
 * Keyed on the locks array rather than the level, like the fragile index:
 * generation spreads many copies of one level that share it.
 */
const LOCK_INDEX = new WeakMap<readonly LockDefinition[], LockIndex>();

function lockIndex(level: LockSource): LockIndex {
  const locks = level.locks;
  if (!locks || locks.length === 0) return EMPTY;
  let index = LOCK_INDEX.get(locks);
  if (!index) {
    index = {
      gates: new Map(locks.map((lock) => [cellKey(lock.lock), lock])),
      keys: new Map(locks.map((lock) => [cellKey(lock.key), lock])),
    };
    LOCK_INDEX.set(locks, index);
  }
  return index;
}

export function hasLocks(level: LockSource): boolean {
  return (level.locks?.length ?? 0) > 0;
}

/** The lock whose barred gate sits on `cell`. */
export function gateAt(
  level: LockSource,
  cell: Cell,
): LockDefinition | undefined {
  return lockIndex(level).gates.get(cellKey(cell));
}

/** The lock that a head entering `cell` opens. */
export function keyAt(
  level: LockSource,
  cell: Cell,
): LockDefinition | undefined {
  return lockIndex(level).keys.get(cellKey(cell));
}

/** Cell keys of every gate that is still closed in a settled state. */
export function closedGateKeys(
  level: LockSource,
  unlocked: readonly string[] | undefined,
): ReadonlySet<string> {
  const open = new Set(unlocked ?? []);
  return new Set(
    (level.locks ?? [])
      .filter((lock) => !open.has(lock.id))
      .map((lock) => cellKey(lock.lock)),
  );
}

/**
 * The surface route a key glyph flies from its cell to its paired gate:
 * breadth-first over face adjacency and cube seams, so the flight stays on
 * the outside of the cube however far apart the pair sits. Deterministic:
 * the fixed heading order breaks distance ties.
 */
export function keyFlightRoute(
  level: Pick<LevelDefinition, "locks" | "gridSize">,
  lockId: string,
): readonly Cell[] {
  const lock = (level.locks ?? []).find((entry) => entry.id === lockId);
  if (!lock) return [];
  const start = lock.key;
  const goal = lock.lock;
  if (cellKey(start) === cellKey(goal)) return [start];
  const visited = new Set([cellKey(start)]);
  let frontier = [start];
  const parents = new Map<string, Cell>();
  while (frontier.length > 0 && !visited.has(cellKey(goal))) {
    const next: Cell[] = [];
    for (const cell of frontier) {
      for (const heading of HEADINGS) {
        const neighbor = stepSurface(cell, heading, level.gridSize);
        const key = cellKey(neighbor);
        if (visited.has(key)) continue;
        visited.add(key);
        parents.set(key, cell);
        next.push(neighbor);
        if (key === cellKey(goal)) break;
      }
      if (visited.has(cellKey(goal))) break;
    }
    frontier = next;
  }
  const route: Cell[] = [goal];
  let current = goal;
  while (visited.has(cellKey(current)) && cellKey(current) !== cellKey(start)) {
    const parent = parents.get(cellKey(current));
    if (!parent) break;
    route.push(parent);
    current = parent;
  }
  return route.reverse();
}
