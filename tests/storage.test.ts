import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LEVELS } from "../src/content/levels";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import { generateLevel, seedForLevel } from "../src/content/procedural";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import type { GameState, LevelDefinition } from "../src/core/types";
import {
  clearCampaign,
  loadCampaign,
  loadSettings,
  saveCampaign,
  saveSettings,
} from "../src/storage";

const CAMPAIGN_KEY = "par-arrows:campaign:v1";
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
    removeItem: (key) => entries.delete(key),
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
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function levelFor(id: number): LevelDefinition {
  const base = LEVELS[0];
  if (!base) throw new Error("Expected level one fixture");
  return id === base.id ? base : { ...base, id, title: `Cube ${id}` };
}

async function resolveFixture(id: number): Promise<LevelDefinition> {
  return levelFor(id);
}

function save(state: GameState, unlockedLevelId = state.levelId): boolean {
  return saveCampaign({
    currentLevelId: state.levelId,
    unlockedLevelId,
    tutorialComplete: true,
    state,
  });
}

function savedJson(): Record<string, unknown> {
  const raw = entries.get(CAMPAIGN_KEY);
  if (!raw) throw new Error("Expected campaign save");
  return JSON.parse(raw) as Record<string, unknown>;
}

function writeLegacyVersion(
  state: GameState,
  contentVersion: 1 | 2 | 3 | 4 | 5,
  unlockedLevelId = state.levelId,
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
  entries.set(CAMPAIGN_KEY, JSON.stringify({ ...savedJson(), contentVersion }));
}

function writeVersionOneGeneratorSave(
  state: GameState,
  unlockedLevelId = state.levelId,
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
  entries.set(
    CAMPAIGN_KEY,
    JSON.stringify({
      ...savedJson(),
      contentVersion: 6,
      generatorVersion: 1,
      seed: `par-arrows:runtime:1:level:${state.levelId}`,
    }),
  );
}

function exitedState(level: LevelDefinition): GameState {
  const initial = createGameState(level);
  const arrow = initial.remainingIds[0];
  if (!arrow) throw new Error("Expected removable arrow");
  return applyMove(level, initial, simulateMove(level, initial, arrow));
}

describe("resumable campaign saves", () => {
  test("refreshes only the old cube-eleven layout and preserves its progression", async () => {
    const level = generateLevel(11);
    expect(save(createGameState(level), 27)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        ...savedJson(),
        seed: "par-arrows:runtime:2:level:11",
        tutorialComplete: false,
        state: {
          ...createGameState(level),
          remainingIds: ["r11-wrap-0"],
          lives: 3,
          revision: 179,
        },
      }),
    );
    const restored = await loadCampaign(async (id) => generateLevel(id));
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value).toMatchObject({
      currentLevelId: 11,
      unlockedLevelId: 27,
      tutorialComplete: false,
      state: createGameState(level),
    });
    if (!restored.value) throw new Error("Expected restored introduction");
    expect(saveCampaign(restored.value)).toBe(true);
    expect(savedJson().seed).toBe(seedForLevel(11));
    expect(
      (await loadCampaign(async (id) => generateLevel(id))).recovered,
    ).toBe(false);
  });

  test("resumes partial introductory and unchanged surrounding levels exactly", async () => {
    for (const id of [1, 10, 11, 12, 15, 30]) {
      const level = generateLevel(id);
      const initial = createGameState(level);
      const clearArrow = level.arrows.find(
        (arrow) => simulateMove(level, initial, arrow.id).kind === "exit",
      );
      if (!clearArrow) throw new Error("Expected a clear arrow");
      const state = applyMove(
        level,
        initial,
        simulateMove(level, initial, clearArrow.id),
      );
      expect(save(state, 35)).toBe(true);
      if (id !== 11) expect(savedJson().seed).toBe(seedForLevel(id));
      const restored = await loadCampaign(async (requestedId) =>
        generateLevel(requestedId),
      );
      expect(restored.recovered).toBe(false);
      expect(restored.contentUpdated).toBe(false);
      expect(restored.value?.state).toEqual(state);
      expect(restored.value?.unlockedLevelId).toBe(35);
      expect(restored.value?.tutorialComplete).toBe(true);
    }
  });

  test("v4 saves resume on byte-identical cubes and refresh on changed ones", async () => {
    const unchanged = generateLevel(8);
    const unchangedState = exitedState(unchanged);
    expect(save(unchangedState, 35)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        ...savedJson(),
        generatorVersion: 4,
        seed: "par-arrows:runtime:4:level:8",
      }),
    );
    const resumed = await loadCampaign(async (id) => generateLevel(id));
    expect(resumed.recovered).toBe(false);
    expect(resumed.value?.state).toEqual(unchangedState);
    expect(resumed.value?.unlockedLevelId).toBe(35);

    const changed = generateLevel(12);
    const changedState = exitedState(changed);
    expect(save(changedState, 35)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        ...savedJson(),
        generatorVersion: 4,
        seed: "par-arrows:runtime:4:level:12",
      }),
    );
    const refreshed = await loadCampaign(async (id) => generateLevel(id));
    expect(refreshed.recovered).toBe(true);
    expect(refreshed.contentUpdated).toBe(true);
    expect(refreshed.value).toMatchObject({
      state: createGameState(changed),
      unlockedLevelId: 35,
      tutorialComplete: true,
    });
  });

  test("does not invoke the resolver when no save exists", async () => {
    let calls = 0;
    const result = await loadCampaign(async (id) => {
      calls += 1;
      return levelFor(id);
    });

    expect(result).toEqual({
      value: undefined,
      recovered: false,
      contentUpdated: false,
    });
    expect(calls).toBe(0);
  });

  test("round-trips a current attempt beyond the authored campaign without persisting level", async () => {
    const level = levelFor(42);
    const state = exitedState(level);
    expect(save(state, 88)).toBe(true);
    expect(savedJson()).toMatchObject({
      contentVersion: 8,
      generatorVersion: 5,
      currentLevelId: 42,
      unlockedLevelId: 88,
    });
    expect(savedJson()).not.toHaveProperty("level");

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(false);
    expect(restored.contentUpdated).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.level).toEqual(level);
  });

  test("restores an exact partial v6 generator-v1 attempt through level four", async () => {
    const level = levelFor(4);
    const state = exitedState(level);
    writeVersionOneGeneratorSave(state, 15, false);

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(false);
    expect(restored.contentUpdated).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.unlockedLevelId).toBe(15);
    expect(restored.value?.tutorialComplete).toBe(false);
  });

  test("refreshes a v6 generator-v1 attempt above level four", async () => {
    const level = levelFor(11);
    writeVersionOneGeneratorSave(exitedState(level), 17, false);

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.currentLevelId).toBe(11);
    expect(restored.value?.unlockedLevelId).toBe(17);
    expect(restored.value?.tutorialComplete).toBe(false);
  });

  test("preserves unchanged v6 generator content through level four and cube eleven", async () => {
    for (const id of [2, 3, 4, 11]) {
      const level = generateLevel(id);
      const state = exitedState(level);
      expect(save(state, 29)).toBe(true);
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({
          ...savedJson(),
          contentVersion: 6,
          generatorVersion: 2,
          seed: seedForLevel(id),
        }),
      );

      const restored = await loadCampaign((requestedId) =>
        Promise.resolve(generateLevel(requestedId)),
      );
      expect(restored.recovered).toBe(false);
      expect(restored.value?.state).toEqual(state);
      expect(restored.value?.unlockedLevelId).toBe(29);
    }
  });

  test("refreshes changed cube fifteen while preserving campaign progress", async () => {
    const level = generateLevel(15);
    expect(save(exitedState(level), 35)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        ...savedJson(),
        contentVersion: 6,
        generatorVersion: 2,
        seed: "par-arrows:runtime:2:level:15",
      }),
    );

    const restored = await loadCampaign((id) =>
      Promise.resolve(generateLevel(id)),
    );
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.unlockedLevelId).toBe(35);
    expect(restored.value?.tutorialComplete).toBe(true);
  });

  test("restores a parked attempt and rejects impossible parked offsets", async () => {
    const level = STOP_INTRO_LEVEL;
    const initial = createGameState(level);
    const parked = applyMove(
      level,
      initial,
      simulateMove(level, initial, "stop-intro-parker"),
    );
    expect(parked.offsets).toEqual({ "stop-intro-parker": 1 });
    expect(save(parked, 9)).toBe(true);

    const restored = await loadCampaign((id) =>
      Promise.resolve(id === 5 ? level : generateLevel(id)),
    );
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(parked);
    expect(restored.value?.unlockedLevelId).toBe(9);

    for (const broken of [
      // Past the end of the arrow's own track.
      { ...parked, offsets: { "stop-intro-parker": 99 } },
      // Naming an arrow that is no longer on the cube.
      { ...parked, offsets: { "stop-intro-missing": 1 } },
      // Parked straight onto another arrow's cell.
      { ...parked, offsets: { "stop-intro-parker": 2 } },
      // A malformed value where an integer belongs.
      { ...parked, offsets: { "stop-intro-parker": 1.5 } },
    ]) {
      const raw = savedJson();
      entries.set(CAMPAIGN_KEY, JSON.stringify({ ...raw, state: broken }));
      const recovered = await loadCampaign((id) =>
        Promise.resolve(id === 5 ? level : generateLevel(id)),
      );
      expect(recovered.recovered).toBe(true);
      expect(recovered.value?.state).toEqual(createGameState(level));
    }
  });

  test("a v7 save without parked offsets resumes with none", async () => {
    const level = levelFor(2);
    const state = exitedState(level);
    expect(save(state, 12)).toBe(true);
    const { offsets: _dropped, ...withoutOffsets } = state;
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        ...savedJson(),
        contentVersion: 7,
        generatorVersion: 3,
        state: withoutOffsets,
      }),
    );

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.state.offsets).toEqual({});
    expect(restored.value?.unlockedLevelId).toBe(12);
  });

  test("saves an atomic overlap failure as one life and rejects partial groups", async () => {
    const level = OVERLAP_INTRO_LEVEL;
    const initial = createGameState(level);
    const failed = applyMove(
      level,
      initial,
      simulateMove(level, initial, "overlap-intro-pair-a"),
    );
    expect(failed.failedIds).toEqual([
      "overlap-intro-pair-a",
      "overlap-intro-pair-b",
    ]);
    expect(failed.lives).toBe(level.lives - 1);
    expect(save(failed)).toBe(true);

    const restored = await loadCampaign((id) =>
      Promise.resolve(id === 15 ? level : generateLevel(id)),
    );
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(failed);

    for (const partialState of [
      { ...failed, failedIds: ["overlap-intro-pair-a"] },
      {
        ...initial,
        remainingIds: initial.remainingIds.filter(
          (id) => id !== "overlap-intro-pair-a",
        ),
      },
    ]) {
      expect(save(partialState)).toBe(true);
      const raw = savedJson();
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({ ...raw, state: partialState }),
      );
      const recovered = await loadCampaign((_id) => Promise.resolve(level));
      expect(recovered.recovered).toBe(true);
      expect(recovered.value?.state).toEqual(createGameState(level));
    }
  });

  test.each([1, 2, 3, 4, 5] as const)(
    "resets a legacy v%d level one attempt to the reworked tutorial cube",
    async (contentVersion) => {
      const level = levelFor(1);
      writeLegacyVersion(exitedState(level), contentVersion, 3, false);

      const restored = await loadCampaign(resolveFixture);
      expect(restored.recovered).toBe(true);
      expect(restored.contentUpdated).toBe(true);
      expect(restored.value?.state).toEqual(createGameState(level));
      expect(restored.value?.unlockedLevelId).toBe(3);
      expect(restored.value?.tutorialComplete).toBe(false);
      if (!restored.value) throw new Error("Expected restored campaign");
      expect(saveCampaign(restored.value)).toBe(true);
      expect(savedJson()).toMatchObject({
        contentVersion: 8,
        generatorVersion: 5,
      });
    },
  );

  test.each([1, 2, 3, 4, 5] as const)(
    "resets a later v%d attempt while preserving progression",
    async (contentVersion) => {
      const level = levelFor(11);
      writeLegacyVersion(exitedState(level), contentVersion, 17, false);

      const restored = await loadCampaign(resolveFixture);
      expect(restored.recovered).toBe(true);
      expect(restored.contentUpdated).toBe(true);
      expect(restored.value?.state).toEqual(createGameState(level));
      expect(restored.value?.unlockedLevelId).toBe(17);
      expect(restored.value?.tutorialComplete).toBe(false);
    },
  );

  test("a current-version save with pre-rework level one arrows refreshes in place", async () => {
    const level = levelFor(1);
    const state = createGameState(level);
    expect(save(state, 4)).toBe(true);
    const stale = {
      ...state,
      remainingIds: [
        "l1-front-clear",
        "l1-back-clear",
        "l1-right-clear",
        "l1-left-clear",
        "l1-top-clear",
        "l1-bottom-clear",
      ],
      failedIds: [],
    };
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({ ...savedJson(), state: stale, tutorialComplete: false }),
    );

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.currentLevelId).toBe(1);
    expect(restored.value?.unlockedLevelId).toBe(4);
    expect(restored.value?.tutorialComplete).toBe(false);
  });

  test("a v6 seed mismatch resets the attempt and never restores stale arrow IDs", async () => {
    const level = levelFor(19);
    const state = exitedState(level);
    expect(save(state, 25)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({ ...savedJson(), seed: "obsolete" }),
    );

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.unlockedLevelId).toBe(25);
  });

  test("invalid state recovers against the resolved level", async () => {
    const level = levelFor(12);
    const invalid = { ...createGameState(level), lives: 99 };
    expect(save(invalid)).toBe(true);

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    if (!restored.value) throw new Error("Expected restored campaign");
    expect(saveCampaign(restored.value)).toBe(true);
    expect((await loadCampaign(resolveFixture)).recovered).toBe(false);
  });

  test("oversized saved state arrays recover before validating their IDs", async () => {
    const level = levelFor(12);
    const state = createGameState(level);
    expect(save(state)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        ...savedJson(),
        state: { ...state, remainingIds: [...state.remainingIds, "extra"] },
      }),
    );

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
  });

  test("malformed progression metadata recovers without resolving a level", async () => {
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({
        currentLevelId: Number.MAX_SAFE_INTEGER,
        unlockedLevelId: 1,
      }),
    );
    let calls = 0;
    const restored = await loadCampaign(async (id) => {
      calls += 1;
      return levelFor(id);
    });

    expect(restored).toEqual({
      value: undefined,
      recovered: true,
      contentUpdated: false,
    });
    expect(calls).toBe(0);
    expect(entries.has(CAMPAIGN_KEY)).toBe(false);
  });

  test.each(["null", '"campaign"', "42", "[]"])(
    "valid JSON %s that is not campaign metadata recovers without resolving",
    async (raw) => {
      entries.set(CAMPAIGN_KEY, raw);
      let calls = 0;

      const restored = await loadCampaign(async (id) => {
        calls += 1;
        return levelFor(id);
      });

      expect(restored).toEqual({
        value: undefined,
        recovered: true,
        contentUpdated: false,
      });
      expect(calls).toBe(0);
      expect(entries.has(CAMPAIGN_KEY)).toBe(false);
    },
  );

  test("a resolver rejection leaves the valid stored attempt unchanged", async () => {
    const level = levelFor(27);
    expect(save(exitedState(level), 30)).toBe(true);
    const raw = entries.get(CAMPAIGN_KEY);

    await expect(
      loadCampaign(async () => Promise.reject(new Error("worker unavailable"))),
    ).rejects.toThrow("worker unavailable");
    expect(entries.get(CAMPAIGN_KEY)).toBe(raw);
  });

  test("a stale async restore cannot recreate progress cleared while it resolves", async () => {
    const level = levelFor(27);
    writeLegacyVersion(exitedState(level), 5, 30);
    let release!: (value: LevelDefinition) => void;
    const pendingLevel = new Promise<LevelDefinition>((resolve) => {
      release = resolve;
    });

    const loading = loadCampaign(async () => pendingLevel);
    clearCampaign();
    release(level);

    const restored = await loading;
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(entries.has(CAMPAIGN_KEY)).toBe(false);
  });

  test("future content versions recover safely", async () => {
    const level = levelFor(31);
    expect(save(exitedState(level), 31)).toBe(true);
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({ ...savedJson(), contentVersion: 99 }),
    );

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
  });

  test("denied writes remain recoverable", async () => {
    const state = createGameState(levelFor(1));
    installStorage(true);
    expect(save(state)).toBe(false);
    expect((await loadCampaign(resolveFixture)).value).toBeUndefined();
  });
});

describe("concurrent-tab conflict policy", () => {
  test("a lagging tab cannot regress the unlock another tab earned", () => {
    expect(save(createGameState(levelFor(1)), 5)).toBe(true);
    expect(save(createGameState(levelFor(2)), 2)).toBe(true);
    expect(savedJson().unlockedLevelId).toBe(5);
    expect(savedJson().currentLevelId).toBe(2);
  });

  test("the last writing tab selects the resume state with the merged unlock", async () => {
    expect(save(createGameState(levelFor(2)), 3)).toBe(true);
    const later = createGameState(levelFor(1));
    expect(save(later, 1)).toBe(true);
    const loaded = await loadCampaign(resolveFixture);
    expect(loaded.value?.currentLevelId).toBe(1);
    expect(loaded.value?.unlockedLevelId).toBe(3);
    expect(loaded.value?.state).toEqual(later);
  });

  test("unlock progress is monotonic across interleaved tab writes", () => {
    expect(save(createGameState(levelFor(1)), 4)).toBe(true);
    expect(save(createGameState(levelFor(2)), 2)).toBe(true);
    expect(savedJson().unlockedLevelId).toBe(4);
    expect(save(createGameState(levelFor(3)), 6)).toBe(true);
    expect(savedJson().unlockedLevelId).toBe(6);
    expect(save(createGameState(levelFor(1)), 1)).toBe(true);
    expect(savedJson().unlockedLevelId).toBe(6);
  });

  test("a corrupt stored save cannot contribute a merge or block the write", () => {
    entries.set(CAMPAIGN_KEY, "{broken");
    expect(save(createGameState(levelFor(1)), 1)).toBe(true);
    expect(savedJson().unlockedLevelId).toBe(1);
    expect(savedJson().currentLevelId).toBe(1);
  });
});

describe("player settings", () => {
  test("defaults to system theme and full motion", () => {
    expect(loadSettings()).toEqual({
      gridLines: true,
      reducedMotion: false,
      theme: "system",
      tutorialSeenLevels: [],
    });
  });

  test("loads legacy reduced-motion settings with the system theme", () => {
    entries.set(
      "par-arrows:settings:v1",
      JSON.stringify({ reducedMotion: true }),
    );
    expect(loadSettings()).toEqual({
      gridLines: true,
      reducedMotion: true,
      theme: "system",
      tutorialSeenLevels: [],
    });
  });

  test("recovers from malformed and invalid saved themes", () => {
    entries.set("par-arrows:settings:v1", "{broken");
    expect(loadSettings()).toEqual({
      gridLines: true,
      reducedMotion: false,
      theme: "system",
      tutorialSeenLevels: [],
    });
    entries.set(
      "par-arrows:settings:v1",
      JSON.stringify({ reducedMotion: true, theme: "midnight" }),
    );
    expect(loadSettings()).toEqual({
      gridLines: true,
      reducedMotion: true,
      theme: "system",
      tutorialSeenLevels: [],
    });
  });

  test("persists theme, grid lines, and reduced motion", () => {
    expect(
      saveSettings({
        gridLines: true,
        reducedMotion: true,
        theme: "dark",
        tutorialSeenLevels: [],
      }),
    ).toBe(true);
    expect(loadSettings()).toEqual({
      gridLines: true,
      reducedMotion: true,
      theme: "dark",
      tutorialSeenLevels: [],
    });
  });

  test("round-trips seen tutorial levels and drops invalid entries", () => {
    expect(
      saveSettings({
        gridLines: false,
        reducedMotion: false,
        theme: "system",
        tutorialSeenLevels: [1, 5],
      }),
    ).toBe(true);
    expect(loadSettings().tutorialSeenLevels).toEqual([1, 5]);

    entries.set(
      "par-arrows:settings:v1",
      JSON.stringify({
        gridLines: false,
        reducedMotion: false,
        theme: "system",
        tutorialSeenLevels: [1, "5", 0, -2, 2.5, 11, 11],
      }),
    );
    expect(loadSettings().tutorialSeenLevels).toEqual([1, 11]);
  });
});
