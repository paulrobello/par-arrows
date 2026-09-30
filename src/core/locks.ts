import { cellKey } from "./topology";
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
