import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { CONTENT_ELEVEN_LAYOUTS } from "../src/content-11-layouts";
import { LEVELS } from "../src/content/levels";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
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
  layoutFingerprint,
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

function save(
  state: GameState,
  unlockedLevelId = state.levelId,
  level: LevelDefinition = levelFor(state.levelId),
): boolean {
  return saveCampaign({
    currentLevelId: state.levelId,
    unlockedLevelId,
    tutorialComplete: true,
    state,
    layout: layoutFingerprint(level),
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

function parkedDoubleLevel(): LevelDefinition {
  return {
    id: 25,
    title: "Stored double",
    gridSize: 6,
    lives: 4,
    arrows: [
      {
        id: "double",
        kind: "double",
        path: [
          { face: "front", x: 1, y: 3 },
          { face: "front", x: 2, y: 3 },
        ],
      },
      {
        id: "wall",
        path: [
          { face: "front", x: 4, y: 1 },
          { face: "front", x: 3, y: 1 },
        ],
      },
    ],
    directionals: [{ cell: { face: "front", x: 3, y: 3 }, heading: "north" }],
    stops: [{ face: "front", x: 3, y: 2 }],
  };
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
    expect(save(createGameState(level), 27, level)).toBe(true);
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
      expect(save(state, 35, level)).toBe(true);
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
    expect(save(unchangedState, 35, unchanged)).toBe(true);
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
    expect(save(changedState, 35, changed)).toBe(true);
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
      contentVersion: 12,
      generatorVersion: 7,
      currentLevelId: 42,
      unlockedLevelId: 88,
      layout: layoutFingerprint(level),
    });
    expect(savedJson()).not.toHaveProperty("level");

    const restored = await loadCampaign(resolveFixture);
    expect(restored.recovered).toBe(false);
    expect(restored.contentUpdated).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.level).toEqual(level);
  });

  test("restores an exact partial v6 generator-v1 attempt on unchanged cube two", async () => {
    const level = generateLevel(2);
    const state = exitedState(level);
    writeVersionOneGeneratorSave(state, 15, false);

    const restored = await loadCampaign(async (id) => generateLevel(id));
    expect(restored.recovered).toBe(false);
    expect(restored.contentUpdated).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.unlockedLevelId).toBe(15);
    expect(restored.value?.tutorialComplete).toBe(false);
  });

  test("refreshes a v6 generator-v1 attempt on a rebuilt cube", async () => {
    // Level 29 was rebuilt when self-contact rejection was removed, so its
    // current layout differs from the frozen content-11 table and the
    // refresh fires for that reason, not because the fixture is synthetic.
    const level = generateLevel(29);
    expect(CONTENT_ELEVEN_LAYOUTS[29]).not.toBe(layoutFingerprint(level));
    writeVersionOneGeneratorSave(exitedState(level), 31, false);

    const restored = await loadCampaign(async (id) => generateLevel(id));
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.unlockedLevelId).toBe(31);
  });

  test("refreshes a v6 generator-v1 attempt above level four", async () => {
    const level = generateLevel(60);
    expect(CONTENT_ELEVEN_LAYOUTS[60]).not.toBe(layoutFingerprint(level));
    writeVersionOneGeneratorSave(exitedState(level), 62, false);

    const restored = await loadCampaign(async (id) => generateLevel(id));
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value?.state).toEqual(createGameState(level));
    expect(restored.value?.currentLevelId).toBe(60);
    expect(restored.value?.unlockedLevelId).toBe(62);
    expect(restored.value?.tutorialComplete).toBe(false);
  });

  test("preserves unchanged v6 generator content on cubes two and eleven", async () => {
    for (const id of [2, 11]) {
      const level = generateLevel(id);
      const state = exitedState(level);
      expect(save(state, 29, level)).toBe(true);
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
    expect(save(exitedState(level), 35, level)).toBe(true);
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
    expect(save(parked, 9, level)).toBe(true);

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
    const level = generateLevel(2);
    const state = exitedState(level);
    expect(save(state, 12, level)).toBe(true);
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

    const restored = await loadCampaign(async (id) => generateLevel(id));
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.state.offsets).toEqual({});
    expect(restored.value?.unlockedLevelId).toBe(12);
  });

  test("round-trips a bent parked double path and position failure", async () => {
    const level = parkedDoubleLevel();
    const initial = createGameState(level);
    const paused = simulateMove(level, initial, "double", "head");
    expect(paused.kind).toBe("paused");
    let state = applyMove(level, initial, paused);
    const blocked = simulateMove(level, state, "double", "head");
    expect(blocked.kind).toBe("blocked");
    state = applyMove(level, state, blocked);
    expect(state.settledPaths?.double).toEqual(paused.settledPath);
    expect(state.failedPositions).toHaveLength(1);
    expect(save(state, 40, level)).toBe(true);

    const restored = await loadCampaign(async () => level);
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(state);
    expect(restored.value?.unlockedLevelId).toBe(40);
  });

  test("refreshes malformed double paths while preserving campaign progress", async () => {
    const level = parkedDoubleLevel();
    const initial = createGameState(level);
    const parked = applyMove(
      level,
      initial,
      simulateMove(level, initial, "double", "head"),
    );
    expect(save(parked, 40, level)).toBe(true);
    const goodPath = parked.settledPaths?.double;
    if (!goodPath) throw new Error("Expected parked double path.");
    const malformed: GameState[] = [
      { ...parked, settledPaths: { double: [goodPath[0]!] } },
      { ...parked, settledPaths: { double: [goodPath[0]!, goodPath[0]!] } },
      {
        ...parked,
        settledPaths: {
          double: [goodPath[0]!, { face: "front", x: 99, y: 99 }],
        },
      },
      {
        ...parked,
        settledPaths: {
          double: [goodPath[0]!, { face: "front", x: 5, y: 5 }],
        },
      },
      { ...parked, settledPaths: { wall: goodPath } },
      { ...parked, remainingIds: ["wall"], settledPaths: { double: goodPath } },
      { ...parked, failedPositions: ["double:wrong"] },
    ];
    for (const state of malformed) {
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({ ...savedJson(), state, tutorialComplete: false }),
      );
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(true);
      expect(restored.value?.currentLevelId).toBe(25);
      expect(restored.value?.unlockedLevelId).toBe(40);
      expect(restored.value?.tutorialComplete).toBe(false);
      expect(restored.value?.state).toEqual(createGameState(level));
    }
  });

  test("restores a spent double failure after that arrow exits", async () => {
    const level = DOUBLE_INTRO_LEVEL;
    let state = createGameState(level);
    const blocked = simulateMove(level, state, "double-intro-choice", "head");
    expect(blocked.kind).toBe("blocked");
    state = applyMove(level, state, blocked);
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "double-intro-choice", "tail"),
    );
    expect(state.remainingIds).not.toContain("double-intro-choice");
    expect(state.lives).toBe(level.lives - 1);
    expect(state.failedPositions).toHaveLength(1);
    expect(save(state, 30, level)).toBe(true);
    const restored = await loadCampaign(async () => level);
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(state);
  });

  test("restores failure history from an earlier parked double position", async () => {
    const level = parkedDoubleLevel();
    let state = createGameState(level);
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "double", "head"),
    );
    const firstPath = state.settledPaths?.double;
    if (!firstPath) throw new Error("Expected first parked path.");
    const failureKey = `double:${firstPath.map((cell) => `${cell.face}:${cell.x}:${cell.y}`).join("|")}`;
    state = {
      ...state,
      failedPositions: [failureKey],
      lives: level.lives - 1,
      revision: state.revision + 1,
    };
    const secondPath = [
      { face: "front" as const, x: 3, y: 1 },
      { face: "front" as const, x: 3, y: 0 },
    ];
    // The wall leaves first so the double's new path is clear of every arrow.
    state = {
      ...state,
      remainingIds: ["double"],
      settledPaths: { double: secondPath },
      revision: state.revision + 2,
    };
    expect(save(state, 30, level)).toBe(true);
    const restored = await loadCampaign(async () => level);
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state.failedPositions).toEqual([failureKey]);
    expect(
      save({ ...state, remainingIds: ["double", "wall"] }, 30, level),
    ).toBe(true);
    expect((await loadCampaign(async () => level)).recovered).toBe(true);
  });

  test("restores a parked path reached after another arrow leaves", async () => {
    const level: LevelDefinition = {
      id: 25,
      title: "Freed double",
      gridSize: 6,
      lives: 4,
      stops: [{ face: "front", x: 4, y: 3 }],
      arrows: [
        {
          id: "double",
          kind: "double",
          path: [
            { face: "front", x: 1, y: 3 },
            { face: "front", x: 2, y: 3 },
          ],
        },
        {
          id: "wall",
          path: [
            { face: "front", x: 3, y: 2 },
            { face: "front", x: 3, y: 3 },
          ],
        },
      ],
    };
    let state = createGameState(level);
    state = applyMove(level, state, simulateMove(level, state, "wall"));
    state = applyMove(
      level,
      state,
      simulateMove(level, state, "double", "head"),
    );
    expect(state.settledPaths?.double).toBeDefined();
    expect(save(state, 30, level)).toBe(true);
    const restored = await loadCampaign(async () => level);
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(state);
  });

  test("resumes v8 generator-v6 saves on unchanged seeded levels", async () => {
    for (const id of [2, 8, 11, 20]) {
      const level = generateLevel(id);
      const state = exitedState(level);
      expect(save(state, 30, level)).toBe(true);
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({
          ...savedJson(),
          contentVersion: 8,
          generatorVersion: 6,
          seed: seedForLevel(id),
        }),
      );
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(false);
      expect(restored.value?.state).toEqual(state);
    }
  });

  test("content-9 saves resume on unchanged cubes and refresh on seam-fix rebuilds", async () => {
    for (const [id, resumes] of [
      [8, true],
      [25, true],
      [10, false],
      [22, false],
    ] as const) {
      const level = generateLevel(id);
      const state = exitedState(level);
      expect(save(state, 30, level)).toBe(true);
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({ ...savedJson(), contentVersion: 9 }),
      );
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(!resumes);
      expect(restored.contentUpdated).toBe(!resumes);
      expect(restored.value?.state).toEqual(
        resumes ? state : createGameState(level),
      );
      expect(restored.value?.unlockedLevelId).toBe(30);
    }
  });

  test("content-10 saves resume unless the circle gate rebuilt the cube", async () => {
    for (const [id, resumes] of [
      [22, true],
      [25, true],
      [52, false],
      [13, false],
      [201, false],
    ] as const) {
      const level = generateLevel(id);
      const state = exitedState(level);
      expect(save(state, 300, level)).toBe(true);
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({ ...savedJson(), contentVersion: 10 }),
      );
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(!resumes);
      expect(restored.contentUpdated).toBe(!resumes);
      expect(restored.value?.state).toEqual(
        resumes ? state : createGameState(level),
      );
      expect(restored.value?.unlockedLevelId).toBe(300);
    }
  }, 30_000);

  test("the shipped content-11 table matches unchanged layouts only", () => {
    expect(Object.keys(CONTENT_ELEVEN_LAYOUTS)).toHaveLength(200);
    for (const id of [2, 8, 22, 25]) {
      expect(CONTENT_ELEVEN_LAYOUTS[id]).toBe(
        layoutFingerprint(generateLevel(id)),
      );
    }
    expect(CONTENT_ELEVEN_LAYOUTS[60]).not.toBe(
      layoutFingerprint(generateLevel(60)),
    );
  }, 30_000);

  test("layout fingerprints are SHA-1 across block boundaries", () => {
    const base = levelFor(2);
    const titles = [
      ...Array.from({ length: 140 }, (_, length) => "x".repeat(length)),
      "Würfel ⏺> 立方体",
    ];
    for (const title of titles) {
      const level = { ...base, title };
      expect(layoutFingerprint(level)).toBe(
        createHash("sha1")
          .update(JSON.stringify(level))
          .digest("hex")
          .slice(0, 16),
      );
    }
  });

  test("a save resumes only on a level with the same layout fingerprint", async () => {
    const level = generateLevel(22);
    const state = exitedState(level);
    expect(save(state, 40, level)).toBe(true);
    expect(savedJson().layout).toBe(layoutFingerprint(level));
    const same = await loadCampaign(async () => level);
    expect(same.recovered).toBe(false);
    const moved = { ...level, lives: level.lives + 1 };
    const changed = await loadCampaign(async () => moved);
    expect(changed.recovered).toBe(true);
    expect(changed.contentUpdated).toBe(true);
    expect(changed.value?.unlockedLevelId).toBe(40);
    const renamed = { ...level, title: "Moved cube" };
    const retitled = await loadCampaign(async () => renamed);
    expect(retitled.recovered).toBe(true);
    expect(retitled.contentUpdated).toBe(true);
    expect(retitled.value?.state).toEqual(createGameState(renamed));
    const { layout: _dropped, ...unfingerprinted } = savedJson();
    entries.set(CAMPAIGN_KEY, JSON.stringify(unfingerprinted));
    expect((await loadCampaign(async () => level)).recovered).toBe(true);
  }, 30_000);

  test("restores flipped spots and a pending flip from an arrow parked on a spot", async () => {
    const cellAt = (x: number, y: number) => ({ face: "front" as const, x, y });
    const level: LevelDefinition = {
      id: 31,
      title: "Stored flip",
      gridSize: 6,
      lives: 3,
      arrows: [
        { id: "mover", path: [cellAt(0, 2), cellAt(1, 2)] },
        { id: "other", path: [cellAt(0, 4), cellAt(1, 4)] },
      ],
      directionals: [{ cell: cellAt(2, 2), heading: "north", kind: "flip" }],
      stops: [cellAt(2, 1)],
    };
    let state = createGameState(level);
    state = applyMove(level, state, simulateMove(level, state, "mover"));
    expect(state.settledPaths?.mover).toBeDefined();
    expect(save(state, 31, level)).toBe(true);
    const restored = await loadCampaign(async () => level);
    expect(restored.recovered).toBe(false);
    expect(restored.value?.state).toEqual(state);
    const resumed = restored.value?.state as GameState;
    const onward = applyMove(
      level,
      resumed,
      simulateMove(level, resumed, "mover"),
    );
    expect(onward.spotHeadings).toEqual({ "front:2:2": "south" });
    expect(save(onward, 31, level)).toBe(true);
    const flipped = await loadCampaign(async () => level);
    expect(flipped.recovered).toBe(false);
    expect(flipped.value?.state).toEqual(onward);
  });

  test("rejects stored spot directions off the spot's axis or on static spots", async () => {
    const cellAt = (x: number, y: number) => ({ face: "front" as const, x, y });
    const level: LevelDefinition = {
      id: 31,
      title: "Bad flip",
      gridSize: 6,
      lives: 3,
      arrows: [{ id: "a", path: [cellAt(0, 0), cellAt(1, 0)] }],
      directionals: [
        { cell: cellAt(3, 3), heading: "north", kind: "flip" },
        { cell: cellAt(4, 4), heading: "east" },
      ],
    };
    for (const [spotHeadings, resumes] of [
      [{ "front:3:3": "south" }, true],
      [{ "front:3:3": "north" }, true],
      [{ "front:3:3": "east" }, false],
      [{ "front:4:4": "west" }, false],
      [{ "front:0:0": "north" }, false],
    ] as const) {
      const state = { ...createGameState(level), spotHeadings } as GameState;
      expect(save(state, 31, level)).toBe(true);
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(!resumes);
      expect(restored.value?.state).toEqual(
        resumes ? state : createGameState(level),
      );
    }
  });

  test("never restores two arrows onto one cell, however each is parked", async () => {
    const cellAt = (x: number, y: number) => ({ face: "front" as const, x, y });
    const flipLevel: LevelDefinition = {
      id: 31,
      title: "Two on one stop",
      gridSize: 6,
      lives: 3,
      arrows: [
        { id: "a", path: [cellAt(0, 1), cellAt(1, 1)] },
        { id: "b", path: [cellAt(2, 3), cellAt(2, 2)] },
      ],
      directionals: [{ cell: cellAt(4, 4), heading: "north", kind: "flip" }],
      stops: [cellAt(2, 1)],
    };
    const aParked = [cellAt(1, 1), cellAt(2, 1)];
    const bParked = [cellAt(2, 2), cellAt(2, 1)];
    const doubleLevel: LevelDefinition = {
      id: 31,
      title: "Double meets single",
      gridSize: 6,
      lives: 3,
      arrows: [
        { id: "double", kind: "double", path: [cellAt(1, 3), cellAt(2, 3)] },
        { id: "single", path: [cellAt(3, 5), cellAt(3, 4)] },
      ],
      stops: [cellAt(3, 3)],
    };
    const doubleParked = [cellAt(2, 3), cellAt(3, 3)];
    for (const [level, parked, resumes] of [
      [flipLevel, { settledPaths: { a: aParked } }, true],
      [flipLevel, { settledPaths: { b: bParked } }, true],
      [flipLevel, { settledPaths: { a: aParked, b: bParked } }, false],
      [doubleLevel, { offsets: { single: 1 } }, true],
      [doubleLevel, { settledPaths: { double: doubleParked } }, true],
      [
        doubleLevel,
        { offsets: { single: 1 }, settledPaths: { double: doubleParked } },
        false,
      ],
    ] as const) {
      const state = {
        ...createGameState(level),
        ...parked,
        revision: 2,
      } as GameState;
      expect(save(state, 31, level)).toBe(true);
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(!resumes);
      expect(restored.value?.state).toEqual(
        resumes ? state : createGameState(level),
      );
    }
  });

  test("content-11 saves resume only on cubes whose layout is unchanged", async () => {
    for (const [id, resumes] of [
      [22, true],
      [25, true],
      [29, false],
      [60, false],
    ] as const) {
      const level = generateLevel(id);
      const state = exitedState(level);
      expect(save(state, 60, level)).toBe(true);
      const current = savedJson();
      const { layout: _dropped, ...legacy } = current;
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({ ...legacy, contentVersion: 11 }),
      );
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(!resumes);
      expect(restored.contentUpdated).toBe(!resumes);
      expect(restored.value?.state).toEqual(
        resumes ? state : createGameState(level),
      );
      expect(restored.value?.unlockedLevelId).toBe(60);
      entries.set(CAMPAIGN_KEY, JSON.stringify(current));
      const fingerprinted = await loadCampaign(async () => level);
      expect(fingerprinted.recovered).toBe(false);
      expect(fingerprinted.value?.state).toEqual(state);
    }
  }, 30_000);

  test("a content-11 save on a rebuilt cube refreshes and keeps progression", async () => {
    const level = generateLevel(60);
    expect(save(exitedState(level), 75, level)).toBe(true);
    const { layout: _dropped, ...legacy } = savedJson();
    entries.set(
      CAMPAIGN_KEY,
      JSON.stringify({ ...legacy, contentVersion: 11 }),
    );
    const restored = await loadCampaign(async () => level);
    expect(restored.recovered).toBe(true);
    expect(restored.contentUpdated).toBe(true);
    expect(restored.value).toMatchObject({
      currentLevelId: 60,
      unlockedLevelId: 75,
      tutorialComplete: true,
      state: createGameState(level),
    });
    if (!restored.value) throw new Error("Expected refreshed campaign");
    expect(saveCampaign(restored.value)).toBe(true);
    expect(savedJson()).toMatchObject({
      contentVersion: 12,
      layout: layoutFingerprint(level),
    });
    expect((await loadCampaign(async () => level)).recovered).toBe(false);
  }, 30_000);

  test("a content-11 save on level 30 refreshes onto the authored flip cube", async () => {
    const level = generateLevel(30);
    expect(CONTENT_ELEVEN_LAYOUTS[30]).not.toBe(layoutFingerprint(level));
    for (const seed of [seedForLevel(30), "par-arrows:runtime:7:level:30"]) {
      expect(save(exitedState(level), 34, level)).toBe(true);
      const { layout: _dropped, ...legacy } = savedJson();
      entries.set(
        CAMPAIGN_KEY,
        JSON.stringify({ ...legacy, contentVersion: 11, seed }),
      );
      const restored = await loadCampaign(async () => level);
      expect(restored.recovered).toBe(true);
      expect(restored.contentUpdated).toBe(true);
      expect(restored.value).toMatchObject({
        currentLevelId: 30,
        unlockedLevelId: 34,
        tutorialComplete: true,
        state: createGameState(level),
      });
    }
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
    expect(save(failed, failed.levelId, level)).toBe(true);

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
      expect(save(partialState, partialState.levelId, level)).toBe(true);
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
        contentVersion: 12,
        generatorVersion: 7,
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
