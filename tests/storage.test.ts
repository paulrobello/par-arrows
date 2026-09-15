import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LEVELS } from "../src/content/levels";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import type { GameState, LevelDefinition } from "../src/core/types";
import { solveLevel } from "../src/core/validation";
import { loadCampaign, saveCampaign } from "../src/storage";

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
