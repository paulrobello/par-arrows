import { afterEach, beforeEach, expect, test } from "bun:test";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "../src/content/intro";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import { DIRECTIONAL_INTRO_LEVEL } from "../src/content/directional-intro";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import { FLIP_INTRO_LEVEL } from "../src/content/flip-intro";
import { WORMHOLE_INTRO_LEVEL } from "../src/content/wormhole-intro";
import { ROTOR_INTRO_LEVEL } from "../src/content/rotor-intro";
import { FRAGILE_INTRO_LEVEL } from "../src/content/fragile-intro";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
import { MIRROR_INTRO_LEVEL } from "../src/content/mirror-intro";
import { LEAP_INTRO_LEVEL } from "../src/content/leap-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import {
  canUndo,
  changesGameplay,
  gameStateKey,
  fatalCollisionForUndo,
  type UndoSnapshot,
} from "../src/core/undo";
import type { GameState, LevelDefinition, MoveTarget } from "../src/core/types";
import { solveLevelTargets } from "../src/core/validation";
import { migrateEconomy } from "../src/economy";
import { overlappingArrowIds } from "../src/core/overlap";
import {
  campaignUndo,
  commitCampaign,
  layoutFingerprint,
  loadCampaign,
  purchaseUndo,
  resetCampaign,
  saveCampaign,
  type CampaignSave,
} from "../src/storage";
import { cachedLevel } from "./generated-levels";

const KEY = "par-arrows:campaign:v1";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let entries: Map<string, string>;
let denied = false;
beforeEach(() => {
  entries = new Map();
  denied = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (denied) throw new Error("Storage denied");
          entries.set(key, value);
        },
        removeItem: (key: string) => entries.delete(key),
      },
    },
  });
});
afterEach(() => {
  if (originalWindow)
    Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
const row = () => JSON.parse(entries.get(KEY) ?? "{}");
function save(
  level: LevelDefinition,
  state: GameState,
  undo: UndoSnapshot | null = null,
): CampaignSave {
  return {
    currentLevelId: level.id,
    unlockedLevelId: Math.max(201, level.id + 1),
    state,
    tutorialComplete: true,
    layout: layoutFingerprint(level),
    undo,
  };
}
function seed(
  level: LevelDefinition,
  state = createGameState(level),
  coins = 2000,
): void {
  expect(saveCampaign(save(level, state))).toBe(true);
  entries.set(
    KEY,
    JSON.stringify({ ...row(), economy: { ...migrateEconomy(201), coins } }),
  );
}
function snapshot(before: GameState, target: MoveTarget): UndoSnapshot {
  return {
    version: 1,
    id: crypto.randomUUID(),
    before,
    target,
    tutorialComplete: false,
    tutorialStep: 1,
  };
}
async function move(
  level: LevelDefinition,
  before: GameState,
  target: MoveTarget,
  previous: UndoSnapshot | null = null,
) {
  const result = simulateMove(level, before, target.arrowId, target.endpoint);
  const after = applyMove(level, before, result);
  const useful = changesGameplay(before, after);
  const undo = useful ? snapshot(before, target) : previous;
  const value = save(level, after, undo);
  expect(
    (await commitCampaign(value, { level, captureUndo: useful })).saved,
  ).toBe(true);
  return { result, after, value, undo };
}
const delivery = { valid: () => true, delivered: () => undefined };

for (const level of [
  LEVEL_ONE,
  STOP_INTRO_LEVEL,
  WRAP_INTRO_LEVEL,
  OVERLAP_INTRO_LEVEL,
  DIRECTIONAL_INTRO_LEVEL,
  DOUBLE_INTRO_LEVEL,
  FLIP_INTRO_LEVEL,
  WORMHOLE_INTRO_LEVEL,
  ROTOR_INTRO_LEVEL,
  FRAGILE_INTRO_LEVEL,
  LOCK_INTRO_LEVEL,
  MIRROR_INTRO_LEVEL,
  LEAP_INTRO_LEVEL,
]) {
  test(`paid Undo restores every complete state in the level ${level.id} mechanic solution`, async () => {
    const targets = solveLevelTargets(level);
    expect(targets).toBeDefined();
    let before = createGameState(level);
    for (const target of targets ?? []) {
      seed(level, before);
      const { after, value, undo } = await move(level, before, target);
      expect(undo).not.toBeNull();
      expect(campaignUndo(level, value)?.id).toBe(undo?.id);
      // A reload must retain the full pre-move snapshot and its proof.
      const loaded = (await loadCampaign(async () => level)).value;
      expect(loaded?.undo?.before).toEqual(before);
      expect((await purchaseUndo(level, loaded ?? value, delivery)).saved).toBe(
        true,
      );
      expect(gameStateKey(row().state)).toBe(gameStateKey(before));
      expect(row().state.revision).toBe(after.revision + 1);
      expect(row().undo).toBeNull();
      expect(row().economy.coins).toBe(1980);
      expect(row().economy.rewarded).toEqual([[1, 200]]);
      expect(row().unlockedLevelId).toBe(value.unlockedLevelId);
      expect(row().tutorialComplete).toBe(false);
      expect(row().tutorialStep).toBe(1);
      before = after;
    }
  });
}

test("Undo restores a generated parked rotor body and all pending/settled spot state", async () => {
  const level = cachedLevel(58);
  const targets = solveLevelTargets(level);
  expect(targets).toBeDefined();
  let before = createGameState(level);
  let checked = 0;
  for (const target of targets ?? []) {
    const result = simulateMove(level, before, target.arrowId, target.endpoint);
    const after = applyMove(level, before, result);
    if (
      result.kind === "paused" ||
      Object.keys(before.settledPaths ?? {}).length
    ) {
      seed(level, before);
      const { value } = await move(level, before, target);
      expect((await purchaseUndo(level, value, delivery)).saved).toBe(true);
      expect(gameStateKey(row().state)).toBe(gameStateKey(before));
      checked++;
    }
    before = after;
  }
  expect(checked).toBeGreaterThan(0);
});

test("fatal collision can be undone after reload, including red marks and stale-result protection", async () => {
  const level = { ...LEVEL_ONE, lives: 1 };
  const before = createGameState(level);
  seed(level, before);
  const { result, value, after } = await move(level, before, {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  expect(after.status).toBe("lost");
  expect(after.lives).toBe(0);
  const loaded = (await loadCampaign(async () => level)).value;
  expect(loaded?.undo).not.toBeNull();
  if (!loaded) throw new Error("Expected the fatal attempt to reload");
  expect(fatalCollisionForUndo(level, loaded.state, loaded.undo)).toEqual(
    result,
  );
  expect((await purchaseUndo(level, loaded ?? value, delivery)).saved).toBe(
    true,
  );
  const restored = row().state as GameState;
  expect(restored.lives).toBe(1);
  expect(restored.failedIds).toEqual([]);
  expect(applyMove(level, restored, result)).toBe(restored);
});

test("fatal fall restores the removed double, holes, failed-position history and last life", async () => {
  const level = { ...FRAGILE_INTRO_LEVEL, lives: 1 };
  let before = createGameState(level);
  before = applyMove(
    level,
    before,
    simulateMove(level, before, "fragile-intro-crosser"),
  );
  seed(level, before);
  const { after, value } = await move(level, before, {
    arrowId: "fragile-intro-double",
    endpoint: "head",
  });
  expect(after.status).toBe("lost");
  expect(after.remainingIds).toEqual([]);
  expect(after.fallenIds).toEqual(["fragile-intro-double"]);
  expect(
    fatalCollisionForUndo(level, after, value.undo ?? null),
  ).toBeUndefined();
  expect((await purchaseUndo(level, value, delivery)).saved).toBe(true);
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
});

test("free repeat collisions retain the last useful move, while invalid targets cannot create history", async () => {
  const level = LEVEL_ONE;
  const before = createGameState(level);
  seed(level);
  const first = await move(level, before, {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  const repeat = await move(
    level,
    first.after,
    { arrowId: "l1-front-blocked", endpoint: "head" },
    first.undo,
  );
  expect(repeat.undo?.id).toBe(first.undo?.id);
  expect((await purchaseUndo(level, repeat.value, delivery)).saved).toBe(true);
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
  if (!first.undo) throw new Error("Expected the original useful move");
  expect(
    canUndo(level, first.after, {
      ...first.undo,
      target: { arrowId: "missing", endpoint: "head" },
    }),
  ).toBe(false);
});

test("Undo restores a double's paid failure marks and both endpoint choices", async () => {
  const level = DOUBLE_INTRO_LEVEL;
  const before = createGameState(level);
  seed(level, before);
  const arrow = level.arrows.find((arrow) => arrow.kind === "double");
  if (!arrow) throw new Error("Expected a two-headed arrow");
  const { value, after } = await move(level, before, {
    arrowId: arrow.id,
    endpoint: "head",
  });
  expect(after.failedPositions).toHaveLength(1);
  expect(after.lives).toBe(before.lives - 1);
  expect((await purchaseUndo(level, value, delivery)).saved).toBe(true);
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
});

test("Undo reverses a parked double's resume with the exact settled path", async () => {
  const level: LevelDefinition = {
    id: 25,
    title: "Parked double",
    gridSize: 5,
    lives: 5,
    arrows: [
      {
        id: "double",
        kind: "double",
        path: [0, 1, 2].map((x) => ({ face: "front", x, y: 1 })),
      },
    ],
    stops: [{ face: "front", x: 3, y: 1 }],
  };
  let before = createGameState(level);
  before = applyMove(level, before, simulateMove(level, before, "double"));
  expect(before.settledPaths?.double).toHaveLength(3);
  seed(level, before);
  const { value } = await move(level, before, {
    arrowId: "double",
    endpoint: "head",
  });
  expect((await purchaseUndo(level, value, delivery)).saved).toBe(true);
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
});

test("a fatal shared-tail collision restores the entire group for one recovered life", async () => {
  const level = { ...OVERLAP_INTRO_LEVEL, lives: 1 };
  const before = createGameState(level);
  const arrow = level.arrows.find(
    (arrow) =>
      overlappingArrowIds(level, arrow.id).length > 1 &&
      simulateMove(level, before, arrow.id).kind === "blocked",
  );
  if (!arrow) throw new Error("Expected a blocked group");
  seed(level, before);
  const { value, after } = await move(level, before, {
    arrowId: arrow.id,
    endpoint: "head",
  });
  expect(after.failedIds.length).toBeGreaterThan(1);
  expect(after.lives).toBe(0);
  expect((await purchaseUndo(level, value, delivery)).saved).toBe(true);
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
});

test("a free gate rewind creates no purchasable Undo", async () => {
  seed(LOCK_INTRO_LEVEL);
  const { result, value } = await move(
    LOCK_INTRO_LEVEL,
    createGameState(LOCK_INTRO_LEVEL),
    { arrowId: "lock-intro-opener", endpoint: "head" },
  );
  expect(result.kind).toBe("gated");
  expect(row().undo).toBeNull();
  expect((await purchaseUndo(LOCK_INTRO_LEVEL, value, delivery)).saved).toBe(
    false,
  );
  expect(row().economy.coins).toBe(2000);
});

test("Hint spending survives Undo; simultaneous purchases and stale writes cannot consume an Undo twice", async () => {
  seed(LEVEL_ONE);
  const { value } = await move(LEVEL_ONE, createGameState(LEVEL_ONE), {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  expect(
    (await commitCampaign(value, { level: LEVEL_ONE, purchaseHint: true }))
      .saved,
  ).toBe(true);
  let deliveries = 0;
  const results = await Promise.all(
    [0, 1].map(() =>
      purchaseUndo(LEVEL_ONE, value, {
        ...delivery,
        delivered: () => {
          deliveries++;
        },
      }),
    ),
  );
  expect(results.filter((result) => result.saved)).toHaveLength(1);
  expect(deliveries).toBe(1);
  expect(row().economy.coins).toBe(1960);
  expect((await commitCampaign(value, { level: LEVEL_ONE })).saved).toBe(true);
  expect(row().undo).toBeNull();
  expect(
    (await commitCampaign(value, { level: LEVEL_ONE, captureUndo: true }))
      .saved,
  ).toBe(true);
  expect(row().undo).toBeNull();
  expect((await purchaseUndo(LEVEL_ONE, value, delivery)).saved).toBe(false);
  expect(row().economy.coins).toBe(1960);
});

test("undoing a win preserves its first-clear reward and unlock, and a replay earns nothing", async () => {
  const level = LEVEL_ONE;
  let before = createGameState(level);
  before = applyMove(
    level,
    before,
    simulateMove(level, before, "l1-front-blocker"),
  );
  seed(level, before, 20);
  entries.set(
    KEY,
    JSON.stringify({
      ...row(),
      unlockedLevelId: 3,
      economy: { version: 1, coins: 20, rewarded: [[2, 3]] },
    }),
  );
  const win = await move(level, before, {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  expect(win.after.status).toBe("won");
  expect(row().economy.coins).toBe(30);
  expect((await purchaseUndo(level, win.value, delivery)).saved).toBe(true);
  expect(row().economy.coins).toBe(10);
  expect(row().economy.rewarded).toEqual([[1, 3]]);
  const restored = row().state as GameState;
  await move(level, restored, {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  expect(row().economy.coins).toBe(10);
  expect(row().unlockedLevelId).toBe(201);
});

test("shortfalls, damaged wallets, cancellation, failed saves and failed delivery never consume Undo", async () => {
  seed(LEVEL_ONE);
  const { value } = await move(LEVEL_ONE, createGameState(LEVEL_ONE), {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  const raw = entries.get(KEY);
  if (!raw) throw new Error("Expected the durable move");
  let deliveries = 0;
  const delivered = () => {
    deliveries++;
  };
  expect(
    (await purchaseUndo(LEVEL_ONE, value, { valid: () => false, delivered }))
      .error,
  ).toBe("cancelled");
  denied = true;
  expect(
    (await purchaseUndo(LEVEL_ONE, value, { ...delivery, delivered })).error,
  ).toBe("storage");
  denied = false;
  expect(
    (
      await purchaseUndo(LEVEL_ONE, value, {
        ...delivery,
        delivered: () => {
          throw new Error("Renderer unavailable");
        },
      })
    ).error,
  ).toBe("delivery");
  expect(entries.get(KEY)).toBe(raw);
  entries.set(
    KEY,
    JSON.stringify({ ...row(), economy: { ...row().economy, coins: 19 } }),
  );
  expect(
    (await purchaseUndo(LEVEL_ONE, value, { ...delivery, delivered })).error,
  ).toBe("funds");
  entries.set(
    KEY,
    JSON.stringify({ ...row(), economy: { version: 2, coins: 100 } }),
  );
  expect(
    (await purchaseUndo(LEVEL_ONE, value, { ...delivery, delivered })).error,
  ).toBe("wallet");
  expect(deliveries).toBe(0);
  expect(row().undo?.id).toBe(value.undo?.id);
});

test("legacy or corrupt history never grants recovery and cannot damage a compatible attempt or wallet", async () => {
  seed(LEVEL_ONE);
  const { value } = await move(LEVEL_ONE, createGameState(LEVEL_ONE), {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  const original = row();
  for (const bad of [
    undefined,
    { version: 2 },
    { ...value.undo, before: { ...value.undo?.before, lives: 99 } },
    { ...value.undo, target: { arrowId: "missing", endpoint: "head" } },
  ]) {
    entries.set(KEY, JSON.stringify({ ...original, undo: bad }));
    const loaded = await loadCampaign(async () => LEVEL_ONE);
    expect(loaded.recovered).toBe(false);
    expect(loaded.value?.undo).toBeNull();
    expect(loaded.value?.state).toEqual(value.state);
    expect(loaded.value?.economy?.coins).toBe(2000);
    expect((await purchaseUndo(LEVEL_ONE, value, delivery)).saved).toBe(false);
  }
  entries.set(KEY, JSON.stringify({ ...original, contentVersion: 1 }));
  expect((await loadCampaign(async () => LEVEL_ONE)).value?.undo).toBeNull();
});

test("restart, level change and reset clear history; old history cannot attach to a new attempt", async () => {
  seed(LEVEL_ONE);
  const { value } = await move(LEVEL_ONE, createGameState(LEVEL_ONE), {
    arrowId: "l1-front-blocked",
    endpoint: "head",
  });
  expect(
    (
      await commitCampaign(save(LEVEL_ONE, createGameState(LEVEL_ONE)), {
        level: LEVEL_ONE,
      })
    ).saved,
  ).toBe(true);
  expect((await purchaseUndo(LEVEL_ONE, value, delivery)).saved).toBe(false);
  expect(row().economy.coins).toBe(2000);
  expect(row().undo).toBeNull();
  const other = { ...LEVEL_ONE, id: 2 };
  await commitCampaign(save(other, createGameState(other)), { level: other });
  expect((await purchaseUndo(LEVEL_ONE, value, delivery)).saved).toBe(false);
  await resetCampaign();
  expect(entries.has(KEY)).toBe(false);
});
