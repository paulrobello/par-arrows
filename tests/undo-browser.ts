import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { generateLevel } from "../src/content/procedural";
import { LEVEL_ONE } from "../src/content/intro";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import { ROTOR_INTRO_LEVEL } from "../src/content/rotor-intro";
import { FRAGILE_INTRO_LEVEL } from "../src/content/fragile-intro";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import { solveLevelTargets } from "../src/core/validation";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { gameStateKey, type UndoSnapshot } from "../src/core/undo";
import { waitForReady } from "./runtime-fixtures";
import {
  activate,
  CAMPAIGN_KEY,
  campaignRow,
  dispatchPowerup,
  openCampaign,
  runPowerupBrowser,
  savedRow,
  setCoins,
} from "./powerup-browser-fixtures";

async function finishedUndo(page: Page, coins: number): Promise<void> {
  await page.waitForFunction((coins) => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return state.coins === coins && !state.undoPurchasing;
  }, coins);
  await page.evaluate(() => {
    const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
    if (state.moving?.phase === "rewind") window.advanceTime?.(10000);
  });
}

async function recovery(
  browser: Browser,
  url: string,
  output: string,
  mobile: boolean,
) {
  const level = generateLevel(2);
  const { context, page, errors } = await openCampaign(
    browser,
    url,
    campaignRow(level),
    mobile,
  );
  try {
    assert.equal(await page.locator("#undo-button").isDisabled(), true);
    assert.match(
      await page.locator("#undo-help").innerText(),
      /No move to undo/,
    );
    assert.match(await page.locator("#undo-button").innerText(), /20 coins/);
    let state = createGameState(level);
    let before = state;
    let fatalId = "";
    for (let i = 0; i < level.lives; i++) {
      const target = level.arrows.find(
        (arrow) =>
          !state.failedIds.includes(arrow.id) &&
          simulateMove(level, state, arrow.id).kind === "blocked",
      );
      assert.ok(target);
      before = state;
      fatalId = target.id;
      state = applyMove(level, state, simulateMove(level, state, target.id));
      await activate(page, target.id, "head", i !== level.lives - 1);
    }
    // The fatal move is durable before its animation finishes.
    assert.equal((await savedRow(page)).state.status, "lost");
    await dispatchPowerup(page, "undo", 2);
    assert.equal(
      (await savedRow(page)).economy.coins,
      200,
      "Undo cannot interrupt an active move",
    );
    await page.reload();
    await waitForReady(page);
    assert.equal((await savedRow(page)).state.lives, 0);
    assert.equal(await page.locator("#recovery-undo").isVisible(), true);
    assert.match(await page.locator("#state-button").innerText(), /Free/);
    assert.equal(await page.locator("#hint-button").isDisabled(), true);
    await page.screenshot({
      path: `${output}/undo-zero-lives-${mobile ? "mobile" : "desktop"}.png`,
    });
    await page.locator("#recovery-undo").click();
    await finishedUndo(page, 180);
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(before),
    );
    assert.equal((await savedRow(page)).undo, null);
    await dispatchPowerup(page, "undo", 3);
    assert.equal((await savedRow(page)).economy.coins, 180);
    await activate(page, fatalId);
    assert.equal((await savedRow(page)).state.lives, 0);
    await dispatchPowerup(page, "undo", 3);
    await finishedUndo(page, 160);
    assert.equal((await savedRow(page)).state.lives, 1);
    await activate(page, fatalId);
    await setCoins(page, 19);
    assert.equal(await page.locator("#undo-button").isDisabled(), true);
    assert.match(
      await page.locator("#undo-help").innerText(),
      /Need 1 more coin/,
    );
    assert.equal(await page.locator("#recovery-undo").isVisible(), false);
    await dispatchPowerup(page, "undo", 3);
    await page.keyboard.press("u");
    assert.equal((await savedRow(page)).economy.coins, 19);
    await setCoins(page, 20);
    await page.locator("#undo-button").focus();
    await page.keyboard.press("Enter");
    await finishedUndo(page, 0);
    assert.equal((await savedRow(page)).state.lives, 1);
    await page.reload();
    await waitForReady(page);
    assert.equal((await savedRow(page)).economy.coins, 0);
    assert.equal((await savedRow(page)).undo, null);
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 720 });
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            [
              ...document.querySelectorAll(
                ".hud > *, .control-dock button, .control-dock input",
              ),
            ].every((element) => {
              const bounds = element.getBoundingClientRect();
              return bounds.left >= 0 && bounds.right <= innerWidth;
            }),
        ),
        true,
      );
      await page.screenshot({ path: `${output}/undo-mobile-320.png` });
    }
    await activate(page, fatalId);
    await page.locator("#state-button").click();
    await page.waitForFunction((key) => {
      const row = JSON.parse(localStorage.getItem(key) ?? "{}");
      return (
        row.state?.revision === 0 &&
        row.undo === null &&
        row.economy.coins === 0
      );
    }, CAMPAIGN_KEY);
    assert.equal((await savedRow(page)).state.lives, level.lives);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function tutorialAndWins(browser: Browser, url: string) {
  const lesson = await openCampaign(
    browser,
    url,
    campaignRow(STOP_INTRO_LEVEL),
    false,
    [],
  );
  try {
    const before = (await savedRow(lesson.page)).state;
    const step = await lesson.page.evaluate(() =>
      window.get_tutorial_state?.(),
    );
    const arrow = step && "gate" in step ? step.gate?.[0] : undefined;
    assert.ok(arrow);
    await activate(lesson.page, arrow);
    const advanced = await lesson.page.evaluate(() =>
      window.get_tutorial_state?.(),
    );
    assert.ok(advanced && "stepIndex" in advanced && advanced.stepIndex > 0);
    await dispatchPowerup(lesson.page, "undo");
    await finishedUndo(lesson.page, 180);
    assert.equal(
      gameStateKey((await savedRow(lesson.page)).state),
      gameStateKey(before),
    );
    assert.equal(
      await lesson.page.evaluate(() => {
        const state = window.get_tutorial_state?.();
        return state?.active ? state.stepIndex : undefined;
      }),
      0,
    );
    await lesson.page.reload();
    await waitForReady(lesson.page);
    assert.equal(
      await lesson.page.evaluate(() => {
        const state = window.get_tutorial_state?.();
        return state?.active ? state.stepIndex : undefined;
      }),
      0,
    );
    await activate(lesson.page, arrow);
    assert.equal((await savedRow(lesson.page)).state.status, "playing");
  } finally {
    await lesson.context.close();
  }
  const fixture = JSON.parse(campaignRow(LEVEL_ONE));
  fixture.economy = { version: 1, coins: 200, rewarded: [[2, 21]] };
  const won = await openCampaign(browser, url, JSON.stringify(fixture));
  try {
    await activate(won.page, "l1-front-blocker");
    await activate(won.page, "l1-front-blocked");
    assert.equal((await savedRow(won.page)).state.status, "won");
    assert.equal((await savedRow(won.page)).economy.coins, 210);
    await dispatchPowerup(won.page, "undo");
    await finishedUndo(won.page, 190);
    await activate(won.page, "l1-front-blocked");
    assert.equal((await savedRow(won.page)).economy.coins, 190);
    await won.page.reload();
    await waitForReady(won.page);
    assert.equal((await savedRow(won.page)).economy.coins, 190);
    await won.page.locator('[data-action="retry"]').first().click();
    await won.page.waitForFunction((key) => {
      const row = JSON.parse(localStorage.getItem(key) ?? "{}");
      return row.state?.revision === 0 && row.undo === null;
    }, CAMPAIGN_KEY);
    assert.equal((await savedRow(won.page)).undo, null);
    await activate(won.page, "l1-front-blocker");
    await won.page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(2));
    assert.equal((await savedRow(won.page)).undo, null);
    assert.equal((await savedRow(won.page)).economy.coins, 190);
    await won.page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
    await won.page.waitForFunction((key) => {
      return localStorage.getItem(key) === null;
    }, CAMPAIGN_KEY);
    assert.equal(
      await won.page.evaluate(
        () => JSON.parse(window.render_game_to_text?.() ?? "{}").coins,
      ),
      0,
    );
  } finally {
    await won.context.close();
  }
}

async function atomicFlows(browser: Browser, url: string) {
  const fixture = await openCampaign(browser, url, campaignRow(LEVEL_ONE));
  const { page, context } = fixture;
  try {
    await activate(page, "l1-front-blocked");
    await page.locator("#hint-button").click();
    await page.evaluate(() => window.advanceTime?.(650));
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").hint?.phase ===
        "flashing",
    );
    await dispatchPowerup(page, "undo", 3);
    await finishedUndo(page, 160);
    assert.equal((await savedRow(page)).state.lives, LEVEL_ONE.lives);
    await activate(page, "l1-front-blocked");
    await page.evaluate(() => {
      const global = window as unknown as { releaseUndoLock?: () => void };
      delete global.releaseUndoLock;
      void navigator.locks.request(
        "par-arrows:campaign",
        () =>
          new Promise<void>((resolve) => {
            global.releaseUndoLock = resolve;
          }),
      );
    });
    await page.waitForFunction(
      () =>
        !!(window as unknown as { releaseUndoLock?: () => void })
          .releaseUndoLock,
    );
    await dispatchPowerup(page, "undo");
    await page.evaluate(
      (key) => window.dispatchEvent(new StorageEvent("storage", { key })),
      CAMPAIGN_KEY,
    );
    await page.evaluate(() =>
      (
        window as unknown as { releaseUndoLock?: () => void }
      ).releaseUndoLock?.(),
    );
    await finishedUndo(page, 140);
    assert.equal(
      (await savedRow(page)).state.lives,
      LEVEL_ONE.lives,
      "A wallet refresh retaining the same record does not cancel Undo",
    );
    await activate(page, "l1-front-blocked");
    const original = await page.evaluate(
      (key) => localStorage.getItem(key),
      CAMPAIGN_KEY,
    );
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Storage denied", "QuotaExceededError");
      };
    });
    await dispatchPowerup(page, "undo");
    await page.waitForFunction(() =>
      document
        .querySelector("#undo-status")
        ?.textContent?.includes("No coins spent"),
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      original,
    );
    await page.reload();
    await waitForReady(page);
    // Two tabs compete for exactly the same persisted record.
    const other = await context.newPage();
    await other.goto(url);
    await waitForReady(other);
    await page.evaluate(() => {
      const global = window as unknown as { releaseUndoLock?: () => void };
      void navigator.locks.request(
        "par-arrows:campaign",
        () =>
          new Promise<void>((resolve) => {
            global.releaseUndoLock = resolve;
          }),
      );
    });
    await page.waitForFunction(
      () =>
        !!(window as unknown as { releaseUndoLock?: () => void })
          .releaseUndoLock,
    );
    await Promise.all([
      dispatchPowerup(page, "undo", 3),
      dispatchPowerup(other, "undo", 3),
    ]);
    await page.evaluate(() =>
      (
        window as unknown as { releaseUndoLock?: () => void }
      ).releaseUndoLock?.(),
    );
    await finishedUndo(page, 120);
    await finishedUndo(other, 120);
    assert.equal((await savedRow(page)).economy.coins, 120);
    const messages = await Promise.all(
      [page, other].map((tab) => tab.locator("#undo-status").innerText()),
    );
    assert.equal(
      messages.filter((message) => message.includes("20 coins spent")).length,
      1,
    );
    await other.close();
    await page.reload();
    await waitForReady(page);
    await activate(page, "l1-front-blocked");
    await page.evaluate(() => {
      const global = window as unknown as { releaseUndoLock?: () => void };
      delete global.releaseUndoLock;
      void navigator.locks.request(
        "par-arrows:campaign",
        () =>
          new Promise<void>((resolve) => {
            global.releaseUndoLock = resolve;
          }),
      );
    });
    await page.waitForFunction(
      () =>
        !!(window as unknown as { releaseUndoLock?: () => void })
          .releaseUndoLock,
    );
    await dispatchPowerup(page, "undo");
    await page.locator('[data-action="retry"]').first().click();
    await page.evaluate(() =>
      (
        window as unknown as { releaseUndoLock?: () => void }
      ).releaseUndoLock?.(),
    );
    await finishedUndo(page, 120);
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key) ?? "{}").state?.revision === 0,
      CAMPAIGN_KEY,
    );
    assert.equal((await savedRow(page)).state.lives, LEVEL_ONE.lives);
  } finally {
    await context.close();
  }
}

async function previewIsolation(browser: Browser, url: string) {
  const before = createGameState(LEVEL_ONE);
  const target = { arrowId: "l1-front-blocked", endpoint: "head" } as const;
  const after = applyMove(
    LEVEL_ONE,
    before,
    simulateMove(LEVEL_ONE, before, target.arrowId),
  );
  const undo: UndoSnapshot = {
    version: 1,
    id: "preview-record",
    before,
    target,
    tutorialComplete: true,
  };
  const preview = new URL(url);
  preview.searchParams.set("level", "1");
  const { context, page } = await openCampaign(
    browser,
    preview.href,
    campaignRow(LEVEL_ONE, after, undo),
  );
  try {
    const raw = await page.evaluate(
      (key) => localStorage.getItem(key),
      CAMPAIGN_KEY,
    );
    await activate(page, "l1-front-blocked");
    await dispatchPowerup(page, "undo", 3);
    assert.equal(await page.locator("#undo-button").isDisabled(), true);
    assert.match(await page.locator("#undo-help").innerText(), /Campaign only/);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      raw,
    );
  } finally {
    await context.close();
  }
}

export async function assertUndoMechanicRestoration(
  browser: Browser,
  url: string,
) {
  for (const [level, changed] of [
    [ROTOR_INTRO_LEVEL, "spotGlyphTurns"],
    [FRAGILE_INTRO_LEVEL, "fragileGlyphCollapse"],
    [LOCK_INTRO_LEVEL, "lockGlyphOpen"],
    [DOUBLE_INTRO_LEVEL, "remainingIds"],
  ] as const) {
    const { context, page, errors } = await openCampaign(
      browser,
      url,
      campaignRow(level),
    );
    try {
      const before = await savedRow(page);
      const visualBefore = await page.evaluate(() =>
        JSON.parse(window.render_game_to_text?.() ?? "{}"),
      );
      const target = solveLevelTargets(level)?.[0];
      assert.ok(target);
      await activate(page, target.arrowId, target.endpoint);
      assert.notEqual(
        gameStateKey((await savedRow(page)).state),
        gameStateKey(before.state),
      );
      const changedVisual = await page.evaluate(() =>
        JSON.parse(window.render_game_to_text?.() ?? "{}"),
      );
      assert.notDeepEqual(
        changedVisual[changed],
        visualBefore[changed],
        `Level ${level.id} visibly changes ${changed}`,
      );
      await dispatchPowerup(page, "undo");
      await finishedUndo(page, 180);
      assert.equal(
        gameStateKey((await savedRow(page)).state),
        gameStateKey(before.state),
      );
      const visualAfter = await page.evaluate(() =>
        JSON.parse(window.render_game_to_text?.() ?? "{}"),
      );
      for (const key of [
        "directionals",
        "spotGlyphTurns",
        "fragile",
        "fragileGlyphCollapse",
        "pendingFlips",
        "pendingCollapses",
        "locks",
        "keyFlights",
        "lockGlyphOpen",
        "unlockedIds",
        "settledPaths",
        "remainingIds",
        "failedPositions",
        "parkedOffsets",
        "fallenIds",
      ]) {
        assert.ok(Object.hasOwn(visualBefore, key));
        assert.deepEqual(
          visualAfter[key],
          visualBefore[key],
          `Level ${level.id}: renderer restores ${key}`,
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

export async function assertUndoEconomy(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await recovery(browser, url, output, false);
  await recovery(browser, url, output, true);
  await tutorialAndWins(browser, url);
  await atomicFlows(browser, url);
  await previewIsolation(browser, url);
  await assertUndoMechanicRestoration(browser, url);
  console.log(
    "PASS paid Undo: desktop/mobile, zero-life recovery, interrupted/reloaded moves, repeated purchases, duplicates/keyboard, shortfalls, tutorial restore, wins/replays, Hint spending, save failures, concurrent tabs, cancellation, reset/level changes, previews and 320px layout",
  );
}
if (import.meta.main) await runPowerupBrowser("undo", assertUndoEconomy);
