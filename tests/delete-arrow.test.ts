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
  deleteArrowState,
  deleteTargetUnavailable,
  planDelete,
  verifiesDeleteFinish,
} from "../src/core/delete-arrow";
import { overlappingArrowIds } from "../src/core/overlap";
import { gameStateKey } from "../src/core/undo";
import type { Cell, LevelDefinition, MoveTarget } from "../src/core/types";
import { validateLevel } from "../src/core/validation";
import { migrateEconomy } from "../src/economy";
import {
  commitCampaign,
  layoutFingerprint,
  loadCampaign,
  purchaseDelete,
  purchaseUndo,
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
function value(
  level: LevelDefinition,
  state = createGameState(level),
): CampaignSave {
  return {
    currentLevelId: level.id,
    unlockedLevelId: Math.max(201, level.id + 1),
    state,
    tutorialComplete: true,
    layout: layoutFingerprint(level),
    undo: null,
  };
}
function seed(
  level: LevelDefinition,
  state = createGameState(level),
  coins = 200,
): CampaignSave {
  const saved = value(level, state);
  expect(saveCampaign(saved)).toBe(true);
  entries.set(
    KEY,
    JSON.stringify({ ...row(), economy: { ...migrateEconomy(201), coins } }),
  );
  return saved;
}
const options = () => ({
  id: crypto.randomUUID(),
  valid: () => true,
  delivered: () => undefined,
});
const blocked = { arrowId: "l1-front-blocked", endpoint: "head" } as const;

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
  test(`level ${level.id} deletions preserve terrain and have replayable life-preserving finishes`, async () => {
    const before = createGameState(level);
    const initial = JSON.stringify(before);
    let allowed = 0;
    for (const arrow of level.arrows)
      for (const endpoint of arrow.kind === "double"
        ? (["head", "tail"] as const)
        : (["head"] as const)) {
        const target = { arrowId: arrow.id, endpoint };
        const plan = planDelete(level, before, target);
        if (!plan.eligible) continue;
        const next = deleteArrowState(level, before, target);
        if (!next) throw new Error("Expected a valid deletion");
        const ids = overlappingArrowIds(level, arrow.id);
        expect(next.remainingIds).toEqual(
          before.remainingIds.filter((id) => !ids.includes(id)),
        );
        expect(next.lives).toBe(before.lives);
        expect(next.spotHeadings).toEqual(before.spotHeadings);
        expect(next.collapsed).toEqual(before.collapsed);
        expect(next.unlocked).toEqual(before.unlocked);
        expect(verifiesDeleteFinish(level, next, plan.certificate)).toBe(true);
        const saved = seed(level, before);
        expect(
          (
            await purchaseDelete(
              level,
              saved,
              target,
              plan.certificate,
              options(),
            )
          ).saved,
        ).toBe(true);
        const loaded = (await loadCampaign(async () => level)).value;
        expect(loaded?.undo?.kind).toBe("delete");
        expect(loaded?.state).toEqual(next);
        expect(row().economy.coins).toBe(170);
        expect(
          (await purchaseUndo(level, loaded ?? saved, options())).saved,
        ).toBe(true);
        expect(gameStateKey(row().state)).toBe(gameStateKey(before));
        expect(row().economy.coins).toBe(150);
        expect(row().economy.rewarded).toEqual([[1, 200]]);
        allowed++;
      }
    expect(allowed).toBeGreaterThan(0);
    expect(JSON.stringify(before)).toBe(initial);
  });
}

test("a sole key carrier cannot be deleted while its gate is still needed", async () => {
  const saved = seed(LOCK_INTRO_LEVEL);
  const target = { arrowId: "lock-intro-key", endpoint: "head" } as const;
  const raw = entries.get(KEY);
  expect(planDelete(LOCK_INTRO_LEVEL, saved.state, target).eligible).toBe(
    false,
  );
  expect(
    (await purchaseDelete(LOCK_INTRO_LEVEL, saved, target, [], options()))
      .error,
  ).toBe("delete");
  expect(entries.get(KEY)).toBe(raw);
});

for (const kind of ["fragile", "flip", "rotor"] as const) {
  test(`an arrow holding a pending ${kind} change cannot be deleted`, async () => {
    const cell = (x: number): Cell => ({ face: "front", x, y: 2 });
    const level: LevelDefinition = {
      id: 25,
      title: "Pending fixture",
      gridSize: 6,
      lives: 5,
      arrows: [{ id: "a", path: [cell(0), cell(1), cell(2)] }],
      stops: [cell(4)],
      ...(kind === "fragile"
        ? { fragile: [cell(3)] }
        : { directionals: [{ cell: cell(3), heading: "east", kind }] }),
    };
    expect(validateLevel(level).valid).toBe(true);
    const before = createGameState(level);
    const move = simulateMove(level, before, "a");
    expect(move.kind).toBe("paused");
    const parked = applyMove(level, before, move);
    const saved = seed(level, parked);
    const target = { arrowId: "a", endpoint: "head" } as const;
    expect(deleteTargetUnavailable(level, parked, target)).toContain("holding");
    expect(planDelete(level, parked, target).eligible).toBe(false);
    expect(
      (await purchaseDelete(level, saved, target, [], options())).saved,
    ).toBe(false);
    expect(row().economy.coins).toBe(200);
    expect(row().state).toEqual(parked);
  });
}

test("a parked key carrier can be removed once the gate is open, without closing it", async () => {
  const cell = (x: number, y: number): Cell => ({ face: "front", x, y });
  const level: LevelDefinition = {
    id: 50,
    title: "Open gate",
    gridSize: 6,
    lives: 5,
    arrows: [
      { id: "key", path: [cell(0, 1), cell(1, 1)] },
      { id: "opener", path: [cell(4, 3), cell(4, 2)] },
    ],
    stops: [cell(3, 1)],
    locks: [{ id: "gate", key: cell(2, 1), lock: cell(4, 1) }],
  };
  expect(validateLevel(level).valid).toBe(true);
  let before = createGameState(level);
  before = applyMove(level, before, simulateMove(level, before, "key"));
  expect(before.unlocked).toEqual(["gate"]);
  expect(before.offsets.key).toBeGreaterThan(0);
  const target = { arrowId: "key", endpoint: "head" } as const;
  const plan = planDelete(level, before, target);
  if (!plan.eligible) throw new Error(plan.reason);
  const saved = seed(level, before);
  expect(
    (await purchaseDelete(level, saved, target, plan.certificate, options()))
      .saved,
  ).toBe(true);
  expect(row().state.unlocked).toEqual(["gate"]);
  expect(row().state.offsets.key).toBeUndefined();
  const loaded = (await loadCampaign(async () => level)).value;
  expect(loaded?.state).toEqual(row().state);
  expect((await purchaseUndo(level, loaded ?? saved, options())).saved).toBe(
    true,
  );
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
  expect(row().economy.coins).toBe(150);
});

test("deleting a failed double retains its paid failure and lives; Undo restores both heads without refunding", async () => {
  const level = DOUBLE_INTRO_LEVEL;
  let before = createGameState(level);
  before = applyMove(
    level,
    before,
    simulateMove(level, before, "double-intro-choice"),
  );
  expect(before.failedPositions).toHaveLength(1);
  const target = { arrowId: "double-intro-choice", endpoint: "tail" } as const;
  const plan = planDelete(level, before, target);
  if (!plan.eligible) throw new Error(plan.reason);
  const saved = seed(level, before);
  await purchaseDelete(level, saved, target, plan.certificate, options());
  expect(row().state.lives).toBe(before.lives);
  expect(row().state.failedPositions).toEqual(before.failedPositions);
  const loaded = (await loadCampaign(async () => level)).value;
  expect((await purchaseUndo(level, loaded ?? saved, options())).saved).toBe(
    true,
  );
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
  expect(row().economy.coins).toBe(150);
});

test("a parked double is removed as one complete target and restored with its exact settled path", async () => {
  const cell = (x: number, y: number): Cell => ({ face: "front", x, y });
  const level: LevelDefinition = {
    id: 25,
    title: "Parked double",
    gridSize: 6,
    lives: 5,
    arrows: [
      { id: "d", kind: "double", path: [cell(0, 1), cell(1, 1), cell(2, 1)] },
      { id: "other", path: [cell(0, 4), cell(1, 4)] },
    ],
    stops: [cell(4, 1)],
  };
  expect(validateLevel(level).valid).toBe(true);
  let before = createGameState(level);
  before = applyMove(level, before, simulateMove(level, before, "d"));
  expect(before.settledPaths?.d).toHaveLength(3);
  const target = { arrowId: "d", endpoint: "tail" } as const;
  const plan = planDelete(level, before, target);
  if (!plan.eligible) throw new Error(plan.reason);
  const saved = seed(level, before);
  expect(
    (await purchaseDelete(level, saved, target, plan.certificate, options()))
      .saved,
  ).toBe(true);
  expect(row().state.settledPaths.d).toBeUndefined();
  const loaded = (await loadCampaign(async () => level)).value;
  expect((await purchaseUndo(level, loaded ?? saved, options())).saved).toBe(
    true,
  );
  expect(gameStateKey(row().state)).toBe(gameStateKey(before));
});

test("Delete then Hint then Undo retains every purchase and the completion ledger", async () => {
  const saved = seed(LEVEL_ONE);
  const plan = planDelete(LEVEL_ONE, saved.state, blocked);
  if (!plan.eligible) throw new Error(plan.reason);
  expect(
    (
      await purchaseDelete(
        LEVEL_ONE,
        saved,
        blocked,
        plan.certificate,
        options(),
      )
    ).saved,
  ).toBe(true);
  const loaded = (await loadCampaign(async () => LEVEL_ONE)).value;
  if (!loaded) throw new Error("Expected deletion save");
  expect(
    (await commitCampaign(loaded, { level: LEVEL_ONE, purchaseHint: true }))
      .saved,
  ).toBe(true);
  expect(row().economy.coins).toBe(150);
  expect((await purchaseUndo(LEVEL_ONE, loaded, options())).saved).toBe(true);
  expect(row().economy.coins).toBe(130);
  expect(row().economy.rewarded).toEqual([[1, 200]]);
  expect(gameStateKey(row().state)).toBe(gameStateKey(saved.state));
  expect((await commitCampaign(loaded, { level: LEVEL_ONE })).saved).toBe(true);
  expect(row().undo).toBeNull();
  expect((await purchaseUndo(LEVEL_ONE, loaded, options())).saved).toBe(false);
  expect(row().economy.coins).toBe(130);
});

test("winning deletion atomically claims one reward; Undo and deletion replays never claim it again", async () => {
  let before = createGameState(LEVEL_ONE);
  before = applyMove(
    LEVEL_ONE,
    before,
    simulateMove(LEVEL_ONE, before, "l1-front-blocker"),
  );
  const saved = seed(LEVEL_ONE, before, 100);
  entries.set(
    KEY,
    JSON.stringify({
      ...row(),
      economy: { version: 1, coins: 100, rewarded: [[2, 11]] },
    }),
  );
  expect(
    (await purchaseDelete(LEVEL_ONE, saved, blocked, [], options())).saved,
  ).toBe(true);
  expect(row().state.status).toBe("won");
  expect(row().economy.coins).toBe(80);
  expect(row().economy.rewarded).toEqual([[1, 11]]);
  const won = (await loadCampaign(async () => LEVEL_ONE)).value;
  if (!won) throw new Error("Expected winning save");
  expect((await purchaseUndo(LEVEL_ONE, won, options())).saved).toBe(true);
  expect(row().economy.coins).toBe(60);
  const restored = (await loadCampaign(async () => LEVEL_ONE)).value;
  if (!restored) throw new Error("Expected restored save");
  expect(
    (await purchaseDelete(LEVEL_ONE, restored, blocked, [], options())).saved,
  ).toBe(true);
  expect(row().economy.coins).toBe(30);
  expect(row().economy.rewarded).toEqual([[1, 11]]);
});

test("duplicate/concurrent deletion spends once; stale paid actions cannot change the purchased board", async () => {
  const saved = seed(LEVEL_ONE);
  const plan = planDelete(LEVEL_ONE, saved.state, blocked);
  if (!plan.eligible) throw new Error(plan.reason);
  let delivered = 0;
  const attempt = {
    ...options(),
    delivered: () => {
      delivered++;
    },
  };
  const result = await Promise.all([
    purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, attempt),
    purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, attempt),
  ]);
  expect(result.filter((result) => result.saved)).toHaveLength(1);
  expect(delivered).toBe(1);
  expect(row().economy.coins).toBe(170);
  const after = entries.get(KEY);
  expect(
    (await commitCampaign(saved, { level: LEVEL_ONE, purchaseHint: true }))
      .saved,
  ).toBe(false);
  expect(entries.get(KEY)).toBe(after);
});

test("cancelled, failed, unaffordable and unproved deletions never change money, board or history", async () => {
  const saved = seed(LEVEL_ONE);
  const plan = planDelete(LEVEL_ONE, saved.state, blocked);
  if (!plan.eligible) throw new Error(plan.reason);
  const raw = entries.get(KEY);
  let delivered = 0;
  const attempt = {
    ...options(),
    delivered: () => {
      delivered++;
    },
  };
  expect(
    (
      await purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, {
        ...attempt,
        valid: () => false,
      })
    ).error,
  ).toBe("cancelled");
  expect(
    (await purchaseDelete(LEVEL_ONE, saved, blocked, [], attempt)).error,
  ).toBe("delete");
  denied = true;
  expect(
    (await purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, attempt))
      .error,
  ).toBe("storage");
  denied = false;
  expect(
    (
      await purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, {
        ...attempt,
        delivered: () => {
          throw new Error("Delivery failed");
        },
      })
    ).error,
  ).toBe("delivery");
  expect(entries.get(KEY)).toBe(raw);
  expect(delivered).toBe(0);
  entries.set(
    KEY,
    JSON.stringify({ ...row(), economy: { ...row().economy, coins: 29 } }),
  );
  expect(
    (await purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, attempt))
      .error,
  ).toBe("funds");
  entries.set(
    KEY,
    JSON.stringify({ ...row(), economy: { version: 2, coins: 100 } }),
  );
  expect(
    (await purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, attempt))
      .error,
  ).toBe("wallet");
  expect(row().state).toEqual(saved.state);
  expect(row().undo).toBeNull();
  expect(delivered).toBe(0);
});

test("missing targets, invalid endpoints, zero lives and proof exhaustion cannot be purchased", async () => {
  const saved = seed(LEVEL_ONE);
  for (const target of [
    { arrowId: "missing", endpoint: "head" },
    { arrowId: blocked.arrowId, endpoint: "tail" },
  ] as const) {
    expect(planDelete(LEVEL_ONE, saved.state, target).eligible).toBe(false);
    expect(
      (await purchaseDelete(LEVEL_ONE, saved, target, [], options())).saved,
    ).toBe(false);
  }
  expect(planDelete(LEVEL_ONE, saved.state, blocked, 0).eligible).toBe(false);
  expect(row().economy.coins).toBe(200);
  const level = { ...LEVEL_ONE, lives: 1 };
  const before = createGameState(level);
  const lost = applyMove(
    level,
    before,
    simulateMove(level, before, blocked.arrowId),
  );
  const zero = seed(level, lost);
  expect(
    (await purchaseDelete(level, zero, blocked, [], options())).saved,
  ).toBe(false);
  expect(row().economy.coins).toBe(200);
});

test("unknown deletion history and content refresh preserve spending without inventing recovery", async () => {
  const saved = seed(LEVEL_ONE);
  const plan = planDelete(LEVEL_ONE, saved.state, blocked);
  if (!plan.eligible) throw new Error(plan.reason);
  await purchaseDelete(LEVEL_ONE, saved, blocked, plan.certificate, options());
  const after = row();
  entries.set(
    KEY,
    JSON.stringify({ ...after, undo: { ...after.undo, kind: "future" } }),
  );
  const invalid = await loadCampaign(async () => LEVEL_ONE);
  expect(invalid.recovered).toBe(false);
  expect(invalid.value?.undo).toBeNull();
  expect(invalid.value?.state).toEqual(after.state);
  expect(invalid.value?.economy?.coins).toBe(170);
  entries.set(KEY, JSON.stringify({ ...after, contentVersion: 1 }));
  const refreshed = await loadCampaign(async () => LEVEL_ONE);
  expect(refreshed.contentUpdated).toBe(true);
  expect(refreshed.value?.undo).toBeNull();
  expect(refreshed.value?.economy?.coins).toBe(170);
  expect(refreshed.value?.economy?.rewarded).toEqual([[1, 200]]);
});

// Includes cold generation of four boards and twelve separate proof jobs;
// the interactive worker still has its own five-second deadline per target.
test("generated static and stateful boards retain certified finishes after eligible removals", () => {
  for (const id of [2, 26, 58, 100]) {
    const level = cachedLevel(id);
    const state = createGameState(level);
    const candidates = level.arrows
      .filter((arrow) => arrow.id.startsWith("r"))
      .slice(0, 3);
    expect(candidates.length).toBeGreaterThan(0);
    let allowed = 0;
    for (const arrow of candidates) {
      const target: MoveTarget = { arrowId: arrow.id, endpoint: "head" };
      const plan = planDelete(level, state, target);
      if (!plan.eligible) continue;
      const after = deleteArrowState(level, state, target);
      if (!after) throw new Error("Expected removal");
      expect(verifiesDeleteFinish(level, after, plan.certificate)).toBe(true);
      allowed++;
    }
    expect(allowed).toBeGreaterThan(0);
  }
}, 60_000);
