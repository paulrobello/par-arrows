import { settledPathOf } from "./stops";
import { cellKey } from "./topology";
import type { Cell, GameState, LevelDefinition } from "./types";

type FragileSource = Pick<LevelDefinition, "fragile">;

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Keyed on the fragile array rather than the level, like the spot index:
 * generation spreads many copies of one level that share it.
 */
const FRAGILE_INDEX = new WeakMap<readonly Cell[], ReadonlySet<string>>();

/** Cell keys of every fragile cell a level declares. */
export function fragileKeys(level: FragileSource): ReadonlySet<string> {
  const cells = level.fragile;
  if (!cells || cells.length === 0) return EMPTY;
  let keys = FRAGILE_INDEX.get(cells);
  if (!keys) {
    keys = new Set(cells.map(cellKey));
    FRAGILE_INDEX.set(cells, keys);
  }
  return keys;
}

export function hasFragileCells(level: FragileSource): boolean {
  return fragileKeys(level).size > 0;
}

export function isFragileCell(level: FragileSource, cell: Cell): boolean {
  return fragileKeys(level).has(cellKey(cell));
}

/**
 * Fragile cells still intact under a remaining arrow's body: each collapses
 * once that arrow moves off it.
 */
export function pendingCollapseKeys(
  level: LevelDefinition,
  state: Pick<
    GameState,
    "remainingIds" | "offsets" | "settledPaths" | "collapsed"
  >,
): ReadonlySet<string> {
  const fragile = fragileKeys(level);
  const pending = new Set<string>();
  if (fragile.size === 0) return pending;
  const collapsed = new Set(state.collapsed ?? []);
  for (const arrow of level.arrows) {
    if (!state.remainingIds.includes(arrow.id)) continue;
    for (const cell of settledPathOf(level, state, arrow)) {
      const key = cellKey(cell);
      if (fragile.has(key) && !collapsed.has(key)) pending.add(key);
    }
  }
  return pending;
}
