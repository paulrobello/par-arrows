import { createGameState } from "./core/game-state";
import type { GameState, LevelDefinition } from "./core/types";

const STORAGE_KEY = "par-arrows:campaign:v1";
const SETTINGS_KEY = "par-arrows:settings:v1";
const CONTENT_VERSION = 3;

export interface CampaignSave {
  readonly currentLevelId: number;
  readonly unlockedLevelId: number;
  readonly state: GameState;
  readonly tutorialComplete: boolean;
}

export interface PlayerSettings {
  readonly reducedMotion: boolean;
}

export interface StorageResult<T> {
  readonly value: T | undefined;
  readonly recovered: boolean;
  readonly contentUpdated: boolean;
}

const DEFAULT_SETTINGS: PlayerSettings = { reducedMotion: false };

function getStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isState(value: unknown, level: LevelDefinition): value is GameState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<GameState>;
  const ids = level.arrows.map((arrow) => arrow.id);
  const remaining = candidate.remainingIds;
  const failed = candidate.failedIds;
  const lives = candidate.lives;
  const revision = candidate.revision;
  if (typeof lives !== "number" || typeof revision !== "number") {
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
    Array.isArray(remaining) &&
    Array.isArray(failed) &&
    validIds(remaining) &&
    validIds(failed) &&
    unique(remaining) &&
    unique(failed) &&
    Number.isInteger(lives) &&
    lives >= 0 &&
    lives <= level.lives &&
    lives === level.lives - failed.length &&
    !(remaining.length === 0 && lives === 0) &&
    Number.isInteger(revision) &&
    revision >= level.arrows.length - remaining.length + failed.length &&
    candidate.status === expectedStatus
  );
}

export function loadCampaign(
  levels: readonly LevelDefinition[],
): StorageResult<CampaignSave> {
  const store = getStore();
  if (!store) {
    return { value: undefined, recovered: true, contentUpdated: false };
  }
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      return { value: undefined, recovered: false, contentUpdated: false };
    }
    const parsed = JSON.parse(raw) as Partial<CampaignSave> & {
      contentVersion?: unknown;
    };
    const level = levels.find(
      (candidate) => candidate.id === parsed.currentLevelId,
    );
    const unlockedLevelId = parsed.unlockedLevelId;
    if (
      !level ||
      typeof unlockedLevelId !== "number" ||
      !Number.isInteger(unlockedLevelId) ||
      unlockedLevelId < level.id ||
      unlockedLevelId < 1 ||
      unlockedLevelId > (levels.at(-1)?.id ?? 1)
    ) {
      store.removeItem(STORAGE_KEY);
      return { value: undefined, recovered: true, contentUpdated: false };
    }
    const legacyContent =
      parsed.contentVersion === 1 || parsed.contentVersion === 2;
    const legacyLevelOne = legacyContent && level.id === 1;
    const currentStateIsValid = isState(parsed.state, level);
    if (parsed.contentVersion === CONTENT_VERSION && currentStateIsValid) {
      return {
        value: {
          currentLevelId: level.id,
          unlockedLevelId,
          state: parsed.state,
          tutorialComplete: parsed.tutorialComplete === true,
        },
        recovered: false,
        contentUpdated: false,
      };
    }
    if (legacyLevelOne && currentStateIsValid) {
      const compatible: CampaignSave = {
        currentLevelId: level.id,
        unlockedLevelId,
        state: parsed.state,
        tutorialComplete: parsed.tutorialComplete === true,
      };
      saveCampaign(compatible);
      return { value: compatible, recovered: false, contentUpdated: false };
    }
    {
      const recovered: CampaignSave = {
        currentLevelId: level.id,
        unlockedLevelId,
        state: createGameState(level),
        tutorialComplete: parsed.tutorialComplete === true,
      };
      saveCampaign(recovered);
      return {
        value: recovered,
        recovered: true,
        contentUpdated: legacyContent && level.id > 1,
      };
    }
  } catch {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private or embedded browser contexts.
    }
    return { value: undefined, recovered: true, contentUpdated: false };
  }
}

export function saveCampaign(value: CampaignSave): boolean {
  try {
    const store = getStore();
    if (!store) {
      return false;
    }
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...value, contentVersion: CONTENT_VERSION }),
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
    return { reducedMotion: parsed?.reducedMotion === true };
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
