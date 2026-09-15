import {
  GENERATOR_VERSION,
  MAX_LEVEL_ID,
  seedForLevel,
} from "./content/procedural";
import { createGameState } from "./core/game-state";
import type { GameState, LevelDefinition } from "./core/types";

const STORAGE_KEY = "par-arrows:campaign:v1";
const SETTINGS_KEY = "par-arrows:settings:v1";
const CONTENT_VERSION = 6;

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
    lives === level.lives - failed.length &&
    !(remaining.length === 0 && lives === 0) &&
    Number.isSafeInteger(revision) &&
    revision >= level.arrows.length - remaining.length + failed.length &&
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
    value === 1 || value === 2 || value === 3 || value === 4 || value === 5
  );
}

function hasMatchingGeneratorMetadata(
  value: StoredCampaign,
  levelId: number,
): boolean {
  const seedMatches = value.seed === seedForLevel(levelId);
  return (
    seedMatches &&
    (value.generatorVersion === GENERATOR_VERSION ||
      (levelId <= 10 && value.generatorVersion === 1))
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
    (exactCurrentContent || (legacyContent && currentLevelId === 1));
  const value: LoadedCampaign = compatible
    ? {
        currentLevelId,
        unlockedLevelId,
        state: parsed.state as GameState,
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
