import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { LEVEL_ONE } from "../src/content/intro";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
import { generateLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { settledPathOf } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { gameStateKey } from "../src/core/undo";
import { solveLevelTargets } from "../src/core/validation";
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

async function state(page: Page) {
  return page.evaluate(() =>
    JSON.parse(window.render_game_to_text?.() ?? "{}"),
  );
}
async function purchased(page: Page, coins: number) {
  await page.waitForFunction((coins) => {
    const data = JSON.parse(window.render_game_to_text?.() ?? "{}");
    return !data.deletion && data.coins === coins;
  }, coins);
}
async function tapArrow(page: Page, id: string, mobile: boolean) {
  const data = await state(page);
  const target = data.visibleProjectedArrowPositions.find(
    (arrow: { id: string }) => arrow.id === id,
  );
  const bounds = await page.locator("canvas").first().boundingBox();
  assert.ok(target && bounds);
  if (mobile)
    await page.touchscreen.tap(bounds.x + target.x, bounds.y + target.y);
  else await page.mouse.click(bounds.x + target.x, bounds.y + target.y);
}
async function holdWrites(page: Page) {
  await page.evaluate(() => {
    const global = window as unknown as { releaseDeleteLock?: () => void };
    delete global.releaseDeleteLock;
    void navigator.locks.request(
      "par-arrows:campaign",
      () =>
        new Promise<void>((resolve) => {
          global.releaseDeleteLock = resolve;
        }),
    );
  });
  await page.waitForFunction(
    () =>
      !!(window as unknown as { releaseDeleteLock?: () => void })
        .releaseDeleteLock,
  );
}
async function releaseWrites(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { releaseDeleteLock?: () => void }
    ).releaseDeleteLock?.(),
  );
  await page.evaluate(() =>
    navigator.locks.request("par-arrows:campaign", () => undefined),
  );
}
async function begin(page: Page) {
  await page.locator("#delete-button").click();
  assert.equal((await state(page)).deletion?.phase, "selecting");
}

async function controls(
  browser: Browser,
  url: string,
  output: string,
  mobile: boolean,
) {
  const { context, page, errors } = await openCampaign(
    browser,
    url,
    campaignRow(LEVEL_ONE),
    mobile,
  );
  try {
    const raw = await page.evaluate(
      (key) => localStorage.getItem(key),
      CAMPAIGN_KEY,
    );
    const button = page.getByRole("button", {
      name: "Delete Arrow",
      exact: true,
    });
    assert.match(await button.innerText(), /30 coins/);
    assert.equal(
      await button.getAttribute("aria-describedby"),
      "delete-price delete-help coin-balance",
    );
    await begin(page);
    assert.equal(await page.locator("#delete-cancel").isVisible(), true);
    assert.equal(await page.locator("#hint-button").isDisabled(), true);
    assert.equal(await page.locator("#undo-button").isDisabled(), true);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      raw,
      "Entering selection is free",
    );
    await page.locator("#delete-cancel").click();
    assert.equal((await state(page)).deletion, null);
    assert.equal(await page.locator("#delete-selection").isVisible(), false);
    await button.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    assert.equal((await state(page)).deletion, null);
    await dispatchPowerup(page, "delete", 3);
    assert.equal((await state(page)).deletion?.phase, "selecting");
    await activate(page, "missing");
    assert.match(
      await page.locator("#delete-selection-copy").innerText(),
      /No coins spent/,
    );
    assert.equal((await savedRow(page)).economy.coins, 200);
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    await page.keyboard.press("Escape");
    assert.equal(
      (await state(page)).deletion,
      null,
      "Escape cancels even after focus leaves the controls",
    );
    await begin(page);
    await page.screenshot({
      path: `${output}/delete-selection-${mobile ? "mobile" : "desktop"}.png`,
    });
    await tapArrow(page, "l1-front-blocked", mobile);
    await purchased(page, 170);
    assert.equal(await page.locator("#delete-selection").isVisible(), false);
    assert.deepEqual((await savedRow(page)).state.remainingIds, [
      "l1-front-blocker",
    ]);
    assert.equal(
      (await savedRow(page)).state.lives,
      LEVEL_ONE.lives,
      "Deleting a blocked arrow does not cost or refund life",
    );
    assert.equal((await savedRow(page)).undo?.kind, "delete");
    await page.reload();
    await waitForReady(page);
    assert.equal((await savedRow(page)).economy.coins, 170);
    await page.locator("#hint-button").click();
    await page.evaluate(() => window.advanceTime?.(650));
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").hint?.phase ===
        "flashing",
    );
    await dispatchPowerup(page, "undo");
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text?.() ?? "{}").coins === 130,
    );
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(createGameState(LEVEL_ONE)),
    );
    assert.equal(
      (await savedRow(page)).undo,
      null,
      "Undo consumes deletion history without refunding either purchase",
    );
    await setCoins(page, 29);
    assert.equal(await button.isDisabled(), true);
    assert.match(
      await page.locator("#delete-help").innerText(),
      /Need 1 more coin/,
    );
    await dispatchPowerup(page, "delete", 3);
    await page.keyboard.press("d");
    assert.equal((await state(page)).deletion, null);
    assert.equal((await savedRow(page)).economy.coins, 29);
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
              const box = element.getBoundingClientRect();
              return box.left >= 0 && box.right <= innerWidth;
            }),
        ),
        true,
      );
      await page.screenshot({
        path: `${output}/delete-mobile-320-shortfall.png`,
      });
      await setCoins(page, 200);
      await begin(page);
      assert.equal(await page.locator("#delete-cancel").isVisible(), true);
      await page.screenshot({
        path: `${output}/delete-mobile-320-selection.png`,
      });
      await page.locator("#delete-cancel").click();
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function wholeTargetsAndKeys(browser: Browser, url: string) {
  for (const level of [OVERLAP_INTRO_LEVEL, DOUBLE_INTRO_LEVEL]) {
    const { context, page, errors } = await openCampaign(
      browser,
      url,
      campaignRow(level),
    );
    try {
      const target = level.arrows.find((arrow) =>
        level === DOUBLE_INTRO_LEVEL
          ? arrow.kind === "double"
          : overlappingArrowIds(level, arrow.id).length > 1,
      );
      assert.ok(target);
      const ids = overlappingArrowIds(level, target.id);
      await begin(page);
      await activate(
        page,
        target.id,
        level === DOUBLE_INTRO_LEVEL ? "tail" : "head",
      );
      await purchased(page, 170);
      const after = await savedRow(page);
      assert.ok(ids.every((id) => !after.state.remainingIds.includes(id)));
      assert.equal(
        after.state.remainingIds.length,
        level.arrows.length - ids.length,
      );
      assert.equal(after.state.lives, level.lives);
      await dispatchPowerup(page, "undo");
      await page.waitForFunction(
        () => JSON.parse(window.render_game_to_text?.() ?? "{}").coins === 150,
      );
      assert.equal(
        gameStateKey((await savedRow(page)).state),
        gameStateKey(createGameState(level)),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  const { context, page } = await openCampaign(
    browser,
    url,
    campaignRow(LOCK_INTRO_LEVEL),
  );
  try {
    const before = await savedRow(page);
    await begin(page);
    await activate(page, "lock-intro-key");
    assert.match(
      await page.locator("#delete-selection-copy").innerText(),
      /Cannot verify a safe finish/,
    );
    assert.equal((await savedRow(page)).economy.coins, 200);
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(before.state),
    );
    await activate(page, "lock-intro-opener");
    await purchased(page, 170);
    assert.deepEqual(
      (await savedRow(page)).state.unlocked,
      [],
      "Deletion does not fake a key traversal",
    );
  } finally {
    await context.close();
  }
}

async function pendingTerrain(browser: Browser, url: string) {
  const level = generateLevel(54);
  let current = createGameState(level);
  let holding: string | undefined;
  const spots = new Set(
    (level.directionals ?? [])
      .filter((spot) => spot.kind === "flip" || spot.kind === "rotor")
      .map((spot) => cellKey(spot.cell)),
  );
  for (const target of solveLevelTargets(level) ?? []) {
    const result = simulateMove(
      level,
      current,
      target.arrowId,
      target.endpoint,
    );
    current = applyMove(level, current, result);
    const pending = level.arrows.find(
      (arrow) =>
        current.remainingIds.includes(arrow.id) &&
        settledPathOf(level, current, arrow).some((cell) =>
          spots.has(cellKey(cell)),
        ),
    );
    if (result.kind === "paused" && pending) {
      holding = pending.id;
      break;
    }
  }
  assert.ok(
    holding,
    "The generated fixture really has a pending stateful change",
  );
  const { context, page } = await openCampaign(
    browser,
    url,
    campaignRow(level, current),
  );
  try {
    await begin(page);
    await activate(page, holding);
    assert.match(
      await page.locator("#delete-selection-copy").innerText(),
      /holding a flip or rotor/,
    );
    assert.equal((await savedRow(page)).economy.coins, 200);
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(current),
    );
  } finally {
    await context.close();
  }
}

async function racesAndCancellation(browser: Browser, url: string) {
  const { context, page } = await openCampaign(
    browser,
    url,
    campaignRow(LEVEL_ONE),
  );
  try {
    const other = await context.newPage();
    await other.goto(url);
    await waitForReady(other);
    await begin(page);
    await begin(other);
    await holdWrites(page);
    for (const tab of [page, other])
      await tab.evaluate(() => {
        for (let i = 0; i < 3; i++)
          void window.__PAR_ARROWS_TEST__?.activate("l1-front-blocked");
      });
    for (const tab of [page, other])
      await tab.waitForFunction(
        () =>
          JSON.parse(window.render_game_to_text?.() ?? "{}").deletion?.phase ===
          "purchasing",
      );
    await releaseWrites(page);
    await page.waitForFunction(
      (key) =>
        JSON.parse(localStorage.getItem(key) ?? "{}").economy?.coins === 170,
      CAMPAIGN_KEY,
    );
    assert.deepEqual((await savedRow(page)).state.remainingIds, [
      "l1-front-blocker",
    ]);
    const messages = await Promise.all(
      [page, other].map((tab) => tab.locator("#delete-status").innerText()),
    );
    assert.equal(
      messages.filter((message) => message.includes("30 coins spent")).length,
      1,
    );
    await other.close();
    await page.reload();
    await waitForReady(page);
    await dispatchPowerup(page, "undo");
    await purchased(page, 150);
    const before = await page.evaluate(
      (key) => localStorage.getItem(key),
      CAMPAIGN_KEY,
    );
    await begin(page);
    await holdWrites(page);
    await page.evaluate(() => {
      void window.__PAR_ARROWS_TEST__?.activate("l1-front-blocked");
    });
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").deletion?.phase ===
        "purchasing",
    );
    await page.locator("#delete-cancel").click();
    await releaseWrites(page);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      before,
      "Cancellation while waiting for the save lock is free",
    );
  } finally {
    await context.close();
  }
}

async function failuresAndLifecycle(browser: Browser, url: string) {
  const { context, page } = await openCampaign(
    browser,
    url,
    campaignRow(LEVEL_ONE),
  );
  try {
    const before = await page.evaluate(
      (key) => localStorage.getItem(key),
      CAMPAIGN_KEY,
    );
    await begin(page);
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("Denied", "QuotaExceededError");
      };
    });
    await activate(page, "l1-front-blocked");
    assert.match(
      await page.locator("#delete-selection-copy").innerText(),
      /No coins spent/,
    );
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      before,
    );
    await page.reload();
    await waitForReady(page);
    await page.evaluate(() => {
      const Native = window.Worker;
      window.Worker = class extends Native {
        private silent: boolean;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.silent = String(url).includes("delete-worker");
        }
        postMessage(message: unknown) {
          if (!this.silent) super.postMessage(message);
        }
      };
    });
    await begin(page);
    await page.evaluate(() => {
      void window.__PAR_ARROWS_TEST__?.activate("l1-front-blocked");
    });
    assert.equal((await state(page)).deletion?.phase, "checking");
    await page.locator("#delete-cancel").click();
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      before,
    );
    await begin(page);
    await page.evaluate(() => {
      void window.__PAR_ARROWS_TEST__?.activate("l1-front-blocked");
    });
    await page.clock.fastForward(5100);
    assert.match(
      await page.locator("#delete-selection-copy").innerText(),
      /took too long/,
    );
    assert.equal((await savedRow(page)).economy.coins, 200);
    await page.locator("#delete-cancel").click();
    await begin(page);
    await page.evaluate(() => {
      void window.__PAR_ARROWS_TEST__?.activate("l1-front-blocked");
    });
    assert.equal((await state(page)).deletion?.phase, "checking");
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).deletion, null);
    assert.equal((await savedRow(page)).economy.coins, 200);
    await begin(page);
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(2));
    assert.equal((await state(page)).deletion, null);
    assert.equal((await savedRow(page)).economy.coins, 200);
    await begin(page);
    await page.locator('[data-action="retry"]').first().click();
    assert.equal((await state(page)).deletion, null);
    await begin(page);
    await page.evaluate(() => {
      const id = window.__PAR_ARROWS_TEST__?.getLevel().arrows[0]?.id;
      if (id) void window.__PAR_ARROWS_TEST__?.activate(id);
      window.__PAR_ARROWS_TEST__?.resetProgress();
    });
    await page.waitForFunction(
      (key) => localStorage.getItem(key) === null,
      CAMPAIGN_KEY,
    );
    assert.equal((await state(page)).coins, 0);
    assert.equal((await state(page)).deletion, null);
  } finally {
    await context.close();
  }
}

async function winsAndPreview(browser: Browser, url: string) {
  let current = createGameState(LEVEL_ONE);
  current = applyMove(
    LEVEL_ONE,
    current,
    simulateMove(LEVEL_ONE, current, "l1-front-blocker"),
  );
  const fixture = JSON.parse(campaignRow(LEVEL_ONE, current));
  fixture.economy = { version: 1, coins: 200, rewarded: [[2, 21]] };
  const { context, page } = await openCampaign(
    browser,
    url,
    JSON.stringify(fixture),
  );
  try {
    await begin(page);
    await activate(page, "l1-front-blocked");
    await purchased(page, 180);
    assert.equal((await savedRow(page)).state.status, "won");
    await dispatchPowerup(page, "undo");
    await purchased(page, 160);
    await begin(page);
    await activate(page, "l1-front-blocked");
    await purchased(page, 130);
    await page.reload();
    await waitForReady(page);
    assert.equal((await savedRow(page)).economy.coins, 130);
    assert.deepEqual((await savedRow(page)).economy.rewarded, [[1, 21]]);
  } finally {
    await context.close();
  }
  const preview = new URL(url);
  preview.searchParams.set("level", "1");
  const isolated = await openCampaign(
    browser,
    preview.href,
    campaignRow(LEVEL_ONE),
  );
  try {
    const before = await isolated.page.evaluate(
      (key) => localStorage.getItem(key),
      CAMPAIGN_KEY,
    );
    await dispatchPowerup(isolated.page, "delete", 3);
    assert.equal((await state(isolated.page)).deletion, null);
    assert.equal(
      await isolated.page.locator("#delete-button").isDisabled(),
      true,
    );
    assert.match(
      await isolated.page.locator("#delete-help").innerText(),
      /Campaign only/,
    );
    await activate(isolated.page, "l1-front-blocked");
    assert.equal(
      await isolated.page.evaluate(
        (key) => localStorage.getItem(key),
        CAMPAIGN_KEY,
      ),
      before,
    );
  } finally {
    await isolated.context.close();
  }
}

export async function assertDeleteEconomy(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await controls(browser, url, output, false);
  await controls(browser, url, output, true);
  await wholeTargetsAndKeys(browser, url);
  await pendingTerrain(browser, url);
  await racesAndCancellation(browser, url);
  await failuresAndLifecycle(browser, url);
  await winsAndPreview(browser, url);
  console.log(
    "PASS Delete Arrow: desktop/mobile targeting/cancellation, groups/doubles, safe finish proofs, pending terrain, key/gate safety, reload, Hint/Undo spending, wins/replays, duplicates/concurrency, worker/storage failures, lifecycle boundaries, preview isolation and 320px layout",
  );
}
if (import.meta.main)
  await runPowerupBrowser("delete-arrow", assertDeleteEconomy);
