import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LEVEL_ONE } from "../src/content/intro";
import { MAX_LEVEL_ID } from "../src/content/procedural";
import { createGameState } from "../src/core/game-state";
import {
  emptyEconomy,
  isEconomy,
  migrateEconomy,
  rewardCompletion,
  spendHint,
} from "../src/economy";
import {
  type CampaignSave,
  commitCampaign,
  layoutFingerprint,
  loadCampaign,
  resetCampaign,
  saveCampaign,
} from "../src/storage";

const KEY = "par-arrows:campaign:v1";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let entries: Map<string, string>;
let denied: boolean;

beforeEach(() => {
  entries = new Map();
  denied = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (denied) throw new Error("Storage unavailable");
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

function campaign(id = 1, won = false): CampaignSave {
  const level = { ...LEVEL_ONE, id };
  const initial = createGameState(level);
  return {
    currentLevelId: id,
    unlockedLevelId: won ? id + 1 : id,
    tutorialComplete: false,
    layout: layoutFingerprint(level),
    state: won
      ? {
          ...initial,
          status: "won",
          remainingIds: [],
          revision: level.arrows.length,
        }
      : initial,
  };
}

function row(): Record<string, unknown> {
  return JSON.parse(entries.get(KEY) ?? "{}");
}

function legacy(unlocked = 4): CampaignSave {
  const value = { ...campaign(), unlockedLevelId: unlocked };
  saveCampaign(value);
  const saved = row();
  delete saved.economy;
  entries.set(KEY, JSON.stringify(saved));
  return value;
}

const purchase = { purchaseHint: true };

describe("coin ledger", () => {
  test("rewards first clears only, coalesces adjacent ranges, and preserves gaps", () => {
    let wallet = rewardCompletion(emptyEconomy(), 3);
    wallet = rewardCompletion(wallet, 1);
    expect(wallet.rewarded).toEqual([
      [1, 1],
      [3, 3],
    ]);
    expect(rewardCompletion(wallet, 3)).toBe(wallet);
    wallet = rewardCompletion(wallet, 2);
    expect(wallet).toEqual({ version: 1, coins: 30, rewarded: [[1, 3]] });
    expect(spendHint(wallet)?.coins).toBe(10);
    expect(spendHint(emptyEconomy())).toBeUndefined();
  });

  test("large inferred progress stays compact with safe integer coins", () => {
    const wallet = migrateEconomy(MAX_LEVEL_ID);
    expect(wallet.rewarded).toEqual([[1, MAX_LEVEL_ID - 1]]);
    expect(wallet.coins).toBe(Number.MAX_SAFE_INTEGER);
    expect(isEconomy(wallet)).toBe(true);
    expect(isEconomy(rewardCompletion(wallet, MAX_LEVEL_ID))).toBe(true);
  });

  test("refuses malformed balances, ranges, versions, and unearned coins", () => {
    for (const bad of [
      null,
      { version: 2, coins: 0, rewarded: [] },
      { version: 1, coins: -1, rewarded: [] },
      { version: 1, coins: 0.5, rewarded: [[1, 1]] },
      { version: 1, coins: 10, rewarded: [] },
      { version: 1, coins: 0, rewarded: [[3, 1]] },
      {
        version: 1,
        coins: 0,
        rewarded: [
          [1, 2],
          [2, 3],
        ],
      },
      { version: 1, coins: 0, rewarded: [[0, 1]] },
    ])
      expect(isEconomy(bad)).toBe(false);
  });
});

describe("durable economy", () => {
  test("credits legacy unlocked progress once without changing a valid attempt", async () => {
    const value = legacy();
    const loaded = await loadCampaign(async () => LEVEL_ONE);
    expect(loaded.recovered).toBe(false);
    expect(loaded.value?.state).toEqual(value.state);
    expect(loaded.value?.economy?.coins).toBe(30);
    expect(await commitCampaign(value)).toMatchObject({
      saved: true,
      economy: { coins: 30 },
    });
    expect(await commitCampaign(value, purchase)).toMatchObject({
      saved: true,
      economy: { coins: 10 },
    });
    expect(
      (await loadCampaign(async () => LEVEL_ONE)).value?.economy?.coins,
    ).toBe(10);
    expect((await commitCampaign(value)).economy?.coins).toBe(10);
    expect(row().state).toEqual(value.state);
    expect(row().unlockedLevelId).toBe(4);
  });

  test("content refresh preserves inferred credit and never repeats migration", async () => {
    const value = legacy();
    entries.set(KEY, JSON.stringify({ ...row(), contentVersion: 1 }));
    const loaded = await loadCampaign(async () => LEVEL_ONE);
    expect(loaded.contentUpdated).toBe(true);
    expect(loaded.value?.economy?.coins).toBe(30);
    expect((await commitCampaign(value)).economy?.coins).toBe(30);
    expect((await commitCampaign(value, purchase)).economy?.coins).toBe(10);
    expect((await commitCampaign(value)).economy?.coins).toBe(10);
  });

  test("a fresh test load/unlock does not earn coins; a real sparse clear earns only its own reward", async () => {
    expect((await commitCampaign(campaign(40))).economy).toEqual(
      emptyEconomy(),
    );
    expect((await commitCampaign(campaign(40, true))).economy).toEqual({
      version: 1,
      coins: 10,
      rewarded: [[40, 40]],
    });
    expect((await commitCampaign(campaign(40, true))).economy?.coins).toBe(10);
    await commitCampaign(campaign(40));
    expect((await commitCampaign(campaign(40, true))).economy?.coins).toBe(10);
  });

  test("interrupted wins, reloads, retries, and stale tabs cannot duplicate rewards or restore spending", async () => {
    await commitCampaign(campaign(1, true));
    await commitCampaign(campaign(2, true));
    const stale = campaign();
    expect((await commitCampaign(stale, purchase)).economy?.coins).toBe(0);
    await commitCampaign(stale);
    await commitCampaign(campaign(1, true));
    expect(
      (await loadCampaign(async () => LEVEL_ONE)).value?.economy?.coins,
    ).toBe(0);
  });

  test("simultaneous completion claims and purchases serialize against the latest wallet", async () => {
    await Promise.all([
      commitCampaign(campaign(1, true)),
      commitCampaign(campaign(1, true)),
    ]);
    await commitCampaign(campaign(2, true));
    let delivered = 0;
    const options = {
      purchaseHint: true,
      delivered: () => {
        delivered += 1;
      },
    };
    const results = await Promise.all([
      commitCampaign(campaign(), options),
      commitCampaign(campaign(), options),
    ]);
    expect(results.filter((result) => result.saved)).toHaveLength(1);
    expect(results[1]?.error).toBe("funds");
    expect(delivered).toBe(1);
    expect((row().economy as { coins: number }).coins).toBe(0);
  });

  test("insufficient funds and zero lives never charge or deliver", async () => {
    await commitCampaign(campaign(1, true));
    expect((await commitCampaign(campaign(), purchase)).error).toBe("funds");
    const value = legacy();
    const before = entries.get(KEY);
    expect(
      (
        await commitCampaign(
          { ...value, state: { ...value.state, lives: 0, status: "lost" } },
          purchase,
        )
      ).error,
    ).toBe("cancelled");
    expect(entries.get(KEY)).toBe(before);
  });

  test("cancellation is checked when the queued purchase executes", async () => {
    const value = legacy();
    const before = entries.get(KEY);
    let valid = true;
    const pending = commitCampaign(value, {
      purchaseHint: true,
      valid: () => valid,
    });
    valid = false;
    expect((await pending).error).toBe("cancelled");
    expect(entries.get(KEY)).toBe(before);
  });

  test("failed writes never deliver; failed delivery rolls back the debit", async () => {
    const value = legacy();
    const before = entries.get(KEY);
    let delivered = false;
    denied = true;
    expect(
      (
        await commitCampaign(value, {
          purchaseHint: true,
          delivered: () => {
            delivered = true;
          },
        })
      ).error,
    ).toBe("storage");
    expect(delivered).toBe(false);
    expect(entries.get(KEY)).toBe(before);
    denied = false;
    expect(
      (
        await commitCampaign(value, {
          purchaseHint: true,
          delivered: () => {
            throw new Error("Renderer unavailable");
          },
        })
      ).error,
    ).toBe("delivery");
    expect(entries.get(KEY)).toBe(before);
  });

  test("a damaged wallet blocks purchases while preserving progression and the damaged record", async () => {
    const value = legacy();
    const bad = { version: 1, coins: -10, rewarded: [[1, 3]] };
    entries.set(KEY, JSON.stringify({ ...row(), economy: bad }));
    const loaded = await loadCampaign(async () => LEVEL_ONE);
    expect(loaded.value?.state).toEqual(value.state);
    expect(loaded.value?.economy).toBeUndefined();
    expect((await commitCampaign(value, purchase)).error).toBe("wallet");
    expect((await commitCampaign(value)).saved).toBe(true);
    expect(row().economy).toEqual(bad);
    expect(row().unlockedLevelId).toBe(4);
  });

  test("reset clears coins and ledger after any pending writes", async () => {
    legacy();
    const pending = commitCampaign(campaign(4, true));
    const reset = resetCampaign();
    await Promise.all([pending, reset]);
    expect(entries.has(KEY)).toBe(false);
    expect((await commitCampaign(campaign())).economy).toEqual(emptyEconomy());
  });
});
