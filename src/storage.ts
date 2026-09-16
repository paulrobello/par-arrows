import {
  GENERATOR_VERSION,
  MAX_LEVEL_ID,
  seedForLevel,
} from "./content/procedural";
import { createGameState } from "./core/game-state";
import { overlappingArrowIds } from "./core/overlap";
import { currentPath, maximumOffset } from "./core/stops";
import { cellKey } from "./core/topology";
import type { GameState, LevelDefinition } from "./core/types";

const STORAGE_KEY = "par-arrows:campaign:v1";
const SETTINGS_KEY = "par-arrows:settings:v1";
const CONTENT_VERSION = 8;

export interface CampaignSave {
  readonly currentLevelId: number;
  readonly unlockedLevelId: number;
  readonly state: GameState;
  readonly tutorialComplete: boolean;
}

export interface LoadedCampaign extends CampaignSave {
  /** Resolved for this session only. It is never written to local storage. */
  readonly level: LevelDefinition;
}

export interface PlayerSettings {
  readonly reducedMotion: boolean;
  readonly theme: "system" | "light" | "dark";
}

export interface StorageResult<T> {
  readonly value: T | undefined;
  readonly recovered: boolean;
  readonly contentUpdated: boolean;
}

type StoredCampaign = Partial<CampaignSave> & {
  readonly contentVersion?: unknown;
  readonly generatorVersion?: unknown;
  readonly seed?: unknown;
};

const DEFAULT_SETTINGS: PlayerSettings = {
  reducedMotion: false,
  theme: "system",
};

function getStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isLevelId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_LEVEL_ID
  );
}

/**
 * Parked offsets must name remaining arrows only, stay inside each arrow's
 * track, move a shared-tail group as one, and never park two arrows onto the
 * same cell.
 */
function hasValidOffsets(
  value: unknown,
  level: LevelDefinition,
  remainingIds: ReadonlySet<string>,
  overlapGroups: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const offsets = value as Record<string, unknown>;
  for (const [id, offset] of Object.entries(offsets)) {
    const arrow = level.arrows.find((candidate) => candidate.id === id);
    if (
      !arrow ||
      !remainingIds.has(id) ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > maximumOffset(level, arrow)
    ) {
      return false;
    }
  }
  const at = (id: string): number => {
    const offset = offsets[id];
    return typeof offset === "number" ? offset : 0;
  };
  for (const group of overlapGroups.values()) {
    if (group.some((id) => at(id) !== at(group[0] as string))) return false;
  }
  // Shared-tail group members legitimately share cells; anyone else may not.
  const occupied = new Map<string, string>();
  for (const arrow of level.arrows) {
    if (!remainingIds.has(arrow.id)) continue;
    const group = overlappingArrowIds(level, arrow.id);
    for (const cell of currentPath(level, arrow, at(arrow.id))) {
      const key = cellKey(cell);
      const owner = occupied.get(key);
      if (owner !== undefined && !group.includes(owner)) return false;
      occupied.set(key, arrow.id);
    }
  }
  return true;
}

function isState(value: unknown, level: LevelDefinition): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  const ids = level.arrows.map((arrow) => arrow.id);
  const remaining = candidate.remainingIds;
  const failed = candidate.failedIds;
  const lives = candidate.lives;
  const revision = candidate.revision;
  if (typeof lives !== "number" || typeof revision !== "number") return false;
  if (
    !Array.isArray(remaining) ||
    !Array.isArray(failed) ||
    remaining.length > level.arrows.length ||
    failed.length > level.arrows.length
  ) {
    return false;
  }
  const validIds = (values: unknown[]): boolean =>
    values.every((id) => typeof id === "string" && ids.includes(id));
  const unique = (values: unknown[]): boolean =>
    new Set(values).size === values.length;
  const remainingIds = new Set(remaining as string[]);
  const failedIds = new Set(failed as string[]);
  const overlapGroups = new Map<string, readonly string[]>();
  for (const id of ids) {
    const group = overlappingArrowIds(level, id);
    if (group.length > 1) overlapGroups.set(group[0] as string, group);
  }
  const completeForGroups = (values: ReadonlySet<string>): boolean =>
    [...overlapGroups.values()].every((group) => {
      const membersPresent = group.filter((id) => values.has(id)).length;
      return membersPresent === 0 || membersPresent === group.length;
    });
  if (!completeForGroups(remainingIds) || !completeForGroups(failedIds))
    return false;
  const groupedIds = new Set([...overlapGroups.values()].flat());
  const removedLogicalCount =
    ids.filter((id) => !groupedIds.has(id) && !remainingIds.has(id)).length +
    [...overlapGroups.values()].filter(
      (group) => !remainingIds.has(group[0] as string),
    ).length;
  const failedLogicalCount =
    (failed as string[]).filter((id) => !groupedIds.has(id)).length +
    [...overlapGroups.values()].filter((group) =>
      failedIds.has(group[0] as string),
    ).length;
  if (!hasValidOffsets(candidate.offsets, level, remainingIds, overlapGroups)) {
    return false;
  }
  const expectedStatus =
    remaining?.length === 0 ? "won" : lives === 0 ? "lost" : "playing";
  return (
    candidate.levelId === level.id &&
    validIds(remaining) &&
    validIds(failed) &&
    unique(remaining) &&
    unique(failed) &&
    Number.isSafeInteger(lives) &&
    lives >= 0 &&
    lives <= level.lives &&
    lives === level.lives - failedLogicalCount &&
    !(remaining.length === 0 && lives === 0) &&
    Number.isSafeInteger(revision) &&
    revision >= removedLogicalCount + failedLogicalCount &&
    candidate.status === expectedStatus
  );
}

function removeStoredCampaign(store: Storage): void {
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}

function isLegacyContentVersion(value: unknown): boolean {
  return (
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6
  );
}

/** Levels whose seed and geometry this release leaves exactly as they were. */
function isUnchangedLevel(levelId: number): boolean {
  return levelId <= 4 || levelId === 11 || levelId === 15;
}

function hasMatchingGeneratorMetadata(
  value: StoredCampaign,
  levelId: number,
): boolean {
  if (value.seed !== seedForLevel(levelId)) return false;
  const stored = value.generatorVersion;
  if (stored === GENERATOR_VERSION) return true;
  // A matching seed on an unchanged level still describes the same cube, so an
  // older generator stamp is not by itself a reason to restart the attempt.
  return (
    (levelId <= 4 && (stored === 1 || stored === 2 || stored === 3)) ||
    (levelId === 11 && (stored === 2 || stored === 3)) ||
    (levelId === 15 && stored === 3)
  );
}

/**
 * Restores persisted metadata then resolves the level. This does not write after
 * awaiting the resolver, so callers can discard stale results before persisting.
 */
export async function loadCampaign(
  resolveLevel: (id: number) => Promise<LevelDefinition>,
): Promise<StorageResult<LoadedCampaign>> {
  const store = getStore();
  if (!store) {
    return { value: undefined, recovered: true, contentUpdated: false };
  }

  let parsed: StoredCampaign | undefined;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      return { value: undefined, recovered: false, contentUpdated: false };
    }
    const decoded: unknown = JSON.parse(raw);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      removeStoredCampaign(store);
      return { value: undefined, recovered: true, contentUpdated: false };
    }
    parsed = decoded as StoredCampaign;
  } catch {
    removeStoredCampaign(store);
    return { value: undefined, recovered: true, contentUpdated: false };
  }

  const { currentLevelId, unlockedLevelId } = parsed;
  if (
    !isLevelId(currentLevelId) ||
    !isLevelId(unlockedLevelId) ||
    unlockedLevelId < currentLevelId
  ) {
    removeStoredCampaign(store);
    return { value: undefined, recovered: true, contentUpdated: false };
  }

  const level = await resolveLevel(currentLevelId);
  if (level.id !== currentLevelId) {
    throw new Error(
      `Resolved level ${level.id} does not match ${currentLevelId}`,
    );
  }

  const legacyContent = isLegacyContentVersion(parsed.contentVersion);
  const exactCurrentContent =
    parsed.contentVersion === CONTENT_VERSION &&
    hasMatchingGeneratorMetadata(parsed, currentLevelId);
  const currentStateIsValid = isState(parsed.state, level);
  const compatible =
    currentStateIsValid &&
    (exactCurrentContent ||
      ((parsed.contentVersion === 6 || parsed.contentVersion === 7) &&
        isUnchangedLevel(currentLevelId) &&
        hasMatchingGeneratorMetadata(parsed, currentLevelId)) ||
      (legacyContent && currentLevelId === 1));
  const restored = parsed.state as GameState | undefined;
  const value: LoadedCampaign = compatible
    ? {
        currentLevelId,
        unlockedLevelId,
        state: {
          ...(restored as GameState),
          offsets: restored?.offsets ?? {},
        },
        tutorialComplete: parsed.tutorialComplete === true,
        level,
      }
    : {
        currentLevelId,
        unlockedLevelId,
        state: createGameState(level),
        tutorialComplete: parsed.tutorialComplete === true,
        level,
      };

  return {
    value,
    recovered: !compatible,
    contentUpdated:
      !compatible &&
      (legacyContent ||
        parsed.contentVersion !== CONTENT_VERSION ||
        !hasMatchingGeneratorMetadata(parsed, currentLevelId)),
  };
}

export function saveCampaign(value: CampaignSave): boolean {
  try {
    const store = getStore();
    if (
      !store ||
      !isLevelId(value.currentLevelId) ||
      !isLevelId(value.unlockedLevelId) ||
      value.unlockedLevelId < value.currentLevelId
    ) {
      return false;
    }
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        currentLevelId: value.currentLevelId,
        unlockedLevelId: value.unlockedLevelId,
        state: value.state,
        tutorialComplete: value.tutorialComplete,
        contentVersion: CONTENT_VERSION,
        generatorVersion: GENERATOR_VERSION,
        seed: seedForLevel(value.currentLevelId),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): PlayerSettings {
  try {
    const raw = getStore()?.getItem(SETTINGS_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Partial<PlayerSettings>)
      : undefined;
    const theme = parsed?.theme;
    return {
      reducedMotion: parsed?.reducedMotion === true,
      theme:
        theme === "light" || theme === "dark" || theme === "system"
          ? theme
          : "system",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PlayerSettings): boolean {
  try {
    getStore()?.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return Boolean(getStore());
  } catch {
    return false;
  }
}

export function clearCampaign(): void {
  try {
    getStore()?.removeItem(STORAGE_KEY);
  } catch {
    // No recovery action is available when storage is denied.
  }
}
