import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LEVELS } from "../src/content/levels";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import type { GameState, LevelDefinition } from "../src/core/types";
import { solveLevel } from "../src/core/validation";
import {
  loadCampaign,
  loadSettings,
  saveCampaign,
  saveSettings,
} from "../src/storage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let entries: Map<string, string>;

function installStorage(denied = false): void {
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      if (denied)
        throw new DOMException("Storage denied", "QuotaExceededError");
      entries.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });
}

beforeEach(() => {
  entries = new Map();
  installStorage();
});

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function save(state: GameState): boolean {
  return saveCampaign({
    currentLevelId: state.levelId,
    unlockedLevelId: state.levelId,
    tutorialComplete: true,
    state,
  });
}

function writeLegacyVersion(
  state: GameState,
  unlockedLevelId: number,
  contentVersion: 1 | 2 | 3 | 4,
  tutorialComplete = true,
): void {
  expect(
    saveCampaign({
      currentLevelId: state.levelId,
      unlockedLevelId,
      tutorialComplete,
      state,
    }),
  ).toBe(true);
  const key = entries.keys().next().value;
  if (!key) throw new Error("Expected legacy save key");
  const current = JSON.parse(entries.get(key) ?? "{}");
  entries.set(key, JSON.stringify({ ...current, contentVersion }));
}

const OLD_V2_LEVEL_TWO_IDS = [
  "l2-front-dependency-blocked",
  "l2-front-dependency-clear",
  "l2-wrap-top-west-3-1",
  "l2-wrap-front-west-3-1",
  "l2-straight-back-east-0-2",
  "l2-straight-right-east-0-2",
  "l2-straight-bottom-east-0-2",
  "l2-straight-front-east-2-2",
  "l2-straight-front-west-1-3",
  "l2-straight-back-east-1-4",
  "l2-straight-back-east-2-4",
  "l2-straight-back-east-3-4",
] as const;

const OLD_V3_LEVEL_TWO_IDS = [
  "l2-bottom-three-cell-line",
  "l2-top-two-cell-line",
  "l2-top-wrap-west-6",
  "l2-front-wrap-north-6",
  "l2-right-wrap-east-6",
  "l2-left-wrap-south-5",
  "l2-front-left-0-inward",
  "l2-front-right-1",
  "l2-front-left-1-inward",
  "l2-front-east-line",
  "l2-back-right-0",
  "l2-back-left-0-inward",
  "l2-back-right-1",
  "l2-back-left-1-inward",
  "l2-right-right-0",
  "l2-right-left-0-inward",
  "l2-right-right-1",
  "l2-right-left-1-inward",
  "l2-right-west-line",
  "l2-left-left-0-inward",
  "l2-left-left-1-inward",
  "l2-left-west-line",
  "l2-top-left-0-inward",
  "l2-top-left-1-inward",
  "l2-bottom-right-1",
  "l2-bottom-left-1-inward",
  "l2-bottom-east-line",
  "l2-left-hook-fill-84",
  "l2-front-edge-fill-155",
  "l2-front-edge-fill-174",
] as const;

const OLD_V4_LEVEL_TWO_IDS = [
  "l2-straight-2",
  "l2-straight-3",
  "l2-straight-4",
  "l2-3",
  "l2-4",
  "l2-5",
  "l2-6",
  "l2-7",
  "l2-8",
  "l2-9",
  "l2-10",
  "l2-11",
  "l2-12",
  "l2-13",
  "l2-14",
  "l2-15",
  "l2-16",
  "l2-17",
  "l2-18",
  "l2-19",
  "l2-20",
  "l2-21",
  "l2-22",
  "l2-23",
  "l2-24",
  "l2-25",
  "l2-26",
  "l2-27",
  "l2-28",
  "l2-29",
] as const;

function oldV2LevelTwoState(): GameState {
  return {
    levelId: 2,
    remainingIds: OLD_V2_LEVEL_TWO_IDS.slice(1),
    failedIds: [OLD_V2_LEVEL_TWO_IDS[1]],
    lives: 4,
    status: "playing",
    revision: 2,
  };
}

function oldV3LevelTwoState(): GameState {
  return {
    levelId: 2,
    remainingIds: OLD_V3_LEVEL_TWO_IDS.slice(1),
    failedIds: [OLD_V3_LEVEL_TWO_IDS[1]],
    lives: 4,
    status: "playing",
    revision: 2,
  };
}

function oldV4LevelTwoState(): GameState {
  return {
    levelId: 2,
    remainingIds: OLD_V4_LEVEL_TWO_IDS.slice(1),
    failedIds: [OLD_V4_LEVEL_TWO_IDS[1]],
    lives: 4,
    status: "playing",
    revision: 2,
  };
}

function refreshedLevelTwo(level: LevelDefinition): LevelDefinition {
  const route = level.arrows[0];
  if (!route) throw new Error("Expected a route for the refreshed level");
  return {
    ...level,
    arrows: [{ ...route, id: "l2-v5-doubled-layout" }],
  };
}

function levelWithBlockedArrow(): {
  level: LevelDefinition;
  arrowId: string;
} {
  for (const level of LEVELS) {
    const state = createGameState(level);
    const arrow = level.arrows.find(
      (candidate) =>
        simulateMove(level, state, candidate.id).kind === "blocked",
    );
    if (arrow) return { level, arrowId: arrow.id };
  }
  throw new Error("Campaign must include at least one initially blocked arrow");
}

describe("resumable campaign saves", () => {
  test("first failure survives reload and a repeated failure remains free", () => {
    const { level, arrowId } = levelWithBlockedArrow();
    const initial = createGameState(level);
    const failed = applyMove(
      level,
      initial,
      simulateMove(level, initial, arrowId),
    );
    expect(failed.lives).toBe(level.lives - 1);
    expect(save(failed)).toBe(true);
    const resumed = loadCampaign(LEVELS).value;
    expect(resumed?.state).toEqual(failed);
    expect(resumed?.tutorialComplete).toBe(true);
    if (!resumed) throw new Error("Expected saved game");
    const retried = applyMove(
      level,
      resumed.state,
      simulateMove(level, resumed.state, arrowId),
    );
    expect(retried.lives).toBe(failed.lives);
    expect(retried.failedIds).toContain(arrowId);
  });

  test("removed arrows remain removed after reopen", () => {
    const level = LEVELS[0];
    if (!level) throw new Error("Expected first level");
    const initial = createGameState(level);
    const arrow = level.arrows.find(
      (candidate) => simulateMove(level, initial, candidate.id).kind === "exit",
    );
    if (!arrow) throw new Error("Expected removable arrow");
    const removed = applyMove(
      level,
      initial,
      simulateMove(level, initial, arrow.id),
    );
    save(removed);
    expect(loadCampaign(LEVELS).value?.state.remainingIds).not.toContain(
      arrow.id,
    );
  });

  test.each([1, 2, 3, 4] as const)(
    "migrates a level one v%d attempt without changing its exact state",
    (contentVersion) => {
      const level = LEVELS[0];
      if (!level) throw new Error("Expected first level");
      const initial = createGameState(level);
      const removedId = initial.remainingIds[0];
      const failedId = initial.remainingIds[1];
      if (!removedId || !failedId) throw new Error("Expected level one arrows");
      const partial: GameState = {
        ...initial,
        remainingIds: initial.remainingIds.filter((id) => id !== removedId),
        failedIds: [failedId],
        lives: initial.lives - 1,
        revision: 2,
      };
      const unlockedLevelId = Math.min(3, LEVELS.at(-1)?.id ?? 1);
      writeLegacyVersion(partial, unlockedLevelId, contentVersion, false);

      const restored = loadCampaign(LEVELS);
      expect(restored.recovered).toBe(false);
      expect(restored.contentUpdated).toBe(false);
      expect(restored.value?.state).toEqual(partial);
      expect(restored.value?.unlockedLevelId).toBe(unlockedLevelId);
      expect(restored.value?.tutorialComplete).toBe(false);
      const key = entries.keys().next().value;
      if (!key) throw new Error("Expected migrated save key");
      expect(JSON.parse(entries.get(key) ?? "{}").contentVersion).toBe(5);
    },
  );

  test.each([1, 2, 3, 4] as const)(
    "resets a later v%d attempt while preserving unlocks and onboarding",
    (contentVersion) => {
      const previousLevel = LEVELS.find((candidate) => candidate.id === 2);
      if (!previousLevel) throw new Error("Expected second level");
      const level = refreshedLevelTwo(previousLevel);
      const levels = LEVELS.map((candidate) =>
        candidate.id === level.id ? level : candidate,
      );
      const legacyState =
        contentVersion === 4
          ? oldV4LevelTwoState()
          : contentVersion === 3
            ? oldV3LevelTwoState()
            : oldV2LevelTwoState();
      const currentArrowIds = new Set(level.arrows.map((arrow) => arrow.id));
      expect(
        legacyState.remainingIds.some((id) => !currentArrowIds.has(id)),
      ).toBe(true);
      const unlockedLevelId = Math.min(7, LEVELS.at(-1)?.id ?? level.id);
      writeLegacyVersion(legacyState, unlockedLevelId, contentVersion, false);

      const restored = loadCampaign(levels);
      expect(restored.recovered).toBe(true);
      expect(restored.contentUpdated).toBe(true);
      expect(restored.value?.state).toEqual(createGameState(level));
      expect(restored.value?.unlockedLevelId).toBe(unlockedLevelId);
      expect(restored.value?.tutorialComplete).toBe(false);
      const key = entries.keys().next().value;
      if (!key) throw new Error("Expected migrated save key");
      expect(JSON.parse(entries.get(key) ?? "{}").contentVersion).toBe(5);
      const reopened = loadCampaign(levels);
      expect(reopened.recovered).toBe(false);
      expect(reopened.contentUpdated).toBe(false);
    },
  );

  test("a valid later v4 state resets even when arrow IDs still match", () => {
    const level = LEVELS.find((candidate) => candidate.id === 2);
    if (!level) throw new Error("Expected second level");
    const currentState = createGameState(level);
    const unlockedLevelId = Math.min(7, LEVELS.at(-1)?.id ?? level.id);
    writeLegacyVersion(currentState, unlockedLevelId, 4, false);

    const restored = loadCampaign(LEVELS);
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.unlockedLevelId).toBe(unlockedLevelId);
    expect(restored.value?.tutorialComplete).toBe(false);
  });

  test("fresh v5 saves reopen the exact current attempt", () => {
    const level = LEVELS[0];
    if (!level) throw new Error("Expected first level");
    const initial = createGameState(level);
    const arrow = level.arrows.find(
      (candidate) => simulateMove(level, initial, candidate.id).kind === "exit",
    );
    if (!arrow) throw new Error("Expected removable level one arrow");
    const partial = applyMove(
      level,
      initial,
      simulateMove(level, initial, arrow.id),
    );
    save(partial);
    const key = entries.keys().next().value;
    if (!key) throw new Error("Expected v5 save key");
    expect(JSON.parse(entries.get(key) ?? "{}").contentVersion).toBe(5);
    const restored = loadCampaign(LEVELS);
    expect(restored.recovered).toBe(false);
    expect(restored.contentUpdated).toBe(false);
    expect(restored.value?.state).toEqual(partial);
  });

  test("removing a previously red arrow does not invalidate the saved campaign", () => {
    const { level, arrowId } = levelWithBlockedArrow();
    const initial = createGameState(level);
    let state = applyMove(
      level,
      initial,
      simulateMove(level, initial, arrowId),
    );
    const lives = state.lives;
    const solution = solveLevel(level);
    expect(solution).not.toBeNull();
    for (const id of solution ?? []) {
      state = applyMove(level, state, simulateMove(level, state, id));
      if (id === arrowId) break;
    }
    expect(state.remainingIds).not.toContain(arrowId);
    expect(save(state)).toBe(true);
    const resumed = loadCampaign(LEVELS);
    expect(resumed.recovered).toBe(false);
    expect(resumed.value?.state.remainingIds).not.toContain(arrowId);
    expect(resumed.value?.state.lives).toBe(lives);
  });

  test.each([
    { lives: -1 },
    { lives: 1.5 },
    { lives: 999 },
    { lives: 4 },
    { revision: -2 },
    { status: "won" },
    { status: "lost" },
    { remainingIds: ["not-an-arrow"] },
  ])(
    "invalid progress recovers without replaying corrupt state: %j",
    (patch) => {
      const level = LEVELS[0];
      if (!level) throw new Error("Expected first level");
      const invalid = { ...createGameState(level), ...patch } as GameState;
      save(invalid);
      const restored = loadCampaign(LEVELS);
      expect(restored.recovered).toBe(true);
      expect(restored.value?.state).not.toEqual(invalid);
    },
  );

  test("duplicate arrow IDs cannot create an unwinnable resumed board", () => {
    const level = LEVELS[0];
    if (!level) throw new Error("Expected first level");
    const initial = createGameState(level);
    const invalid = {
      ...initial,
      remainingIds: [...initial.remainingIds, ...initial.remainingIds],
    };
    save(invalid);
    const restored = loadCampaign(LEVELS);
    expect(restored.recovered).toBe(true);
    expect(restored.value?.state).not.toEqual(invalid);
  });

  test("a changed content version resets the attempt while preserving unlocks", () => {
    const level = LEVELS[4];
    if (!level) throw new Error("Expected fifth level");
    save(createGameState(level));
    const key = entries.keys().next().value;
    if (!key) throw new Error("Expected saved progress");
    const saved = JSON.parse(entries.get(key) ?? "{}");
    entries.set(key, JSON.stringify({ ...saved, contentVersion: -1 }));
    const restored = loadCampaign(LEVELS);
    expect(restored.recovered).toBe(true);
    expect(restored.value?.unlockedLevelId).toBe(level.id);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(loadCampaign(LEVELS).recovered).toBe(false);
  });

  test("unreadable JSON and denied writes remain recoverable", () => {
    const level = LEVELS[0];
    if (!level) throw new Error("Expected first level");
    const state = createGameState(level);
    save(state);
    const key = entries.keys().next().value;
    if (!key) throw new Error("Expected a saved snapshot");
    entries.set(key, "{broken");
    expect(loadCampaign(LEVELS).recovered).toBe(true);
    installStorage(true);
    expect(save(state)).toBe(false);
  });
});

describe("player settings", () => {
  test("defaults to system theme and full motion", () => {
    expect(loadSettings()).toEqual({ reducedMotion: false, theme: "system" });
  });

  test("loads legacy reduced-motion settings with the system theme", () => {
    entries.set(
      "par-arrows:settings:v1",
      JSON.stringify({ reducedMotion: true }),
    );

    expect(loadSettings()).toEqual({ reducedMotion: true, theme: "system" });
  });

  test("recovers from malformed and invalid saved themes", () => {
    entries.set("par-arrows:settings:v1", "{broken");
    expect(loadSettings()).toEqual({ reducedMotion: false, theme: "system" });

    entries.set(
      "par-arrows:settings:v1",
      JSON.stringify({ reducedMotion: true, theme: "midnight" }),
    );
    expect(loadSettings()).toEqual({ reducedMotion: true, theme: "system" });
  });

  test("persists a manual theme without dropping reduced motion", () => {
    expect(saveSettings({ reducedMotion: true, theme: "dark" })).toBe(true);

    expect(loadSettings()).toEqual({ reducedMotion: true, theme: "dark" });
  });

  test("persists reduced motion without dropping the theme", () => {
    expect(saveSettings({ reducedMotion: false, theme: "light" })).toBe(true);
    expect(saveSettings({ reducedMotion: true, theme: "light" })).toBe(true);

    expect(loadSettings()).toEqual({ reducedMotion: true, theme: "light" });
  });

  test("denied storage leaves settings usable in memory", () => {
    installStorage(true);

    expect(saveSettings({ reducedMotion: true, theme: "dark" })).toBe(false);
    expect(loadSettings()).toEqual({ reducedMotion: false, theme: "system" });
  });
});
