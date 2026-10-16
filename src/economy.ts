import { MAX_LEVEL_ID } from "./content/procedural";

export const COMPLETION_REWARD = 10;
export const HINT_COST = 20;
const MAX_COINS = Number.MAX_SAFE_INTEGER;

/** Inclusive, sorted ranges keep an endless sequential campaign compact. */
export interface Economy {
  readonly version: 1;
  readonly coins: number;
  readonly rewarded: readonly (readonly [number, number])[];
}

export function emptyEconomy(): Economy {
  return { version: 1, coins: 0, rewarded: [] };
}

function credit(count: number): number {
  return count > Math.floor(MAX_COINS / COMPLETION_REWARD)
    ? MAX_COINS
    : count * COMPLETION_REWARD;
}

/** Legacy unlocks imply progress; they are not an exact completion history. */
export function migrateEconomy(unlockedLevelId: number): Economy {
  const completed = unlockedLevelId - 1;
  return {
    version: 1,
    coins: credit(completed),
    rewarded: completed > 0 ? [[1, completed]] : [],
  };
}

export function isEconomy(value: unknown): value is Economy {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Economy>;
  if (
    candidate.version !== 1 ||
    !Number.isSafeInteger(candidate.coins) ||
    (candidate.coins ?? -1) < 0 ||
    !Array.isArray(candidate.rewarded)
  )
    return false;
  let previousEnd = -1;
  let completed = 0;
  for (const range of candidate.rewarded) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [start, end] = range;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end > MAX_LEVEL_ID ||
      end < start ||
      start <= previousEnd + 1
    )
      return false;
    previousEnd = end;
    completed += end - start + 1;
  }
  return (candidate.coins as number) <= credit(completed);
}

/** Idempotent even for a replay, interrupted celebration, or sparse test load. */
export function rewardCompletion(economy: Economy, levelId: number): Economy {
  if (!Number.isSafeInteger(levelId) || levelId < 1 || levelId > MAX_LEVEL_ID)
    return economy;
  if (
    economy.rewarded.some(([start, end]) => levelId >= start && levelId <= end)
  )
    return economy;
  const ranges = [...economy.rewarded, [levelId, levelId] as const].sort(
    (a, b) => a[0] - b[0],
  );
  const rewarded: [number, number][] = [];
  for (const [start, end] of ranges) {
    const previous = rewarded.at(-1);
    if (previous && start <= previous[1] + 1)
      previous[1] = Math.max(previous[1], end);
    else rewarded.push([start, end]);
  }
  return {
    version: 1,
    coins:
      Math.min(MAX_COINS - COMPLETION_REWARD, economy.coins) +
      COMPLETION_REWARD,
    rewarded,
  };
}

export function spendHint(economy: Economy): Economy | undefined {
  return economy.coins >= HINT_COST
    ? { ...economy, coins: economy.coins - HINT_COST }
    : undefined;
}
