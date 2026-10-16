import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { generateLevel } from "../src/content/procedural";
import { gameStateKey } from "../src/core/undo";
import { fatalFixture } from "./fatal-collision-browser";
import {
  activate,
  campaignRow,
  dispatchPowerup,
  openCampaign,
  runPowerupBrowser,
  savedRow,
} from "./powerup-browser-fixtures";
import { waitForReady } from "./runtime-fixtures";

interface View {
  level: { id: number };
  lives: number;
  coins: number;
  gameOverDelayMs: number;
  heldCollision: { arrowId: string } | null;
  moving: { phase: string; duration: number; anticipation: number } | null;
  renderedHeads: Record<string, number[]>;
}
const view = (page: Page): Promise<View> =>
  page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
const advance = (page: Page, ms: number) =>
  page.evaluate((ms) => window.advanceTime?.(ms), ms);
const cardVisible = (page: Page) => page.locator("#state-card").isVisible();

/** Stop on the first rendered impact frame, without spending any of the reveal pause. */
async function reachImpact(
  page: Page,
  arrowId: string,
  endpoint: "head" | "tail",
) {
  await activate(page, arrowId, endpoint, false);
  const outbound = await view(page);
  assert.equal(outbound.moving?.phase, "impact");
  assert.equal(
    outbound.gameOverDelayMs,
    0,
    "Countdown never starts on activation",
  );
  assert.equal(await cardVisible(page), false);
  await page.evaluate(() => {
    const state = () => JSON.parse(window.render_game_to_text?.() ?? "{}");
    const motion = state().moving;
    window.advanceTime?.(
      Math.max(0, motion.anticipation + motion.duration - 1),
    );
    for (let frame = 0; state().moving && frame < 5; frame++)
      window.advanceTime?.(1);
  });
  const held = await view(page);
  assert.equal(held.moving, null);
  assert.equal(held.heldCollision?.arrowId, arrowId);
  assert.equal(held.lives, 0);
  assert.equal(
    held.gameOverDelayMs,
    2000,
    "Two seconds start at the held impact pose",
  );
  assert.equal(held.coins, 200);
  assert.equal(await cardVisible(page), false);
  return held;
}

async function timing(
  browser: Browser,
  url: string,
  output: string,
  mobile: boolean,
  reduced: boolean,
) {
  const fixture = fatalFixture(generateLevel(2), (r) => r.distance > 1);
  const { page, context, errors } = await openCampaign(
    browser,
    url,
    campaignRow(fixture.level, fixture.before),
    mobile,
  );
  const label = `${mobile ? "mobile" : "desktop"}${reduced ? "-reduced" : ""}`;
  try {
    if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
    const initial = await view(page);
    const held = await reachImpact(
      page,
      fixture.target.arrowId,
      fixture.target.endpoint,
    );
    assert.equal(
      await page.locator("#undo-button").isEnabled(),
      true,
      "Dock Undo is available during the pause",
    );
    await page.screenshot({ path: `${output}/${label}-impact-uncovered.png` });
    await advance(page, 1000);
    await dispatchPowerup(page, "hint");
    await dispatchPowerup(page, "delete");
    await activate(
      page,
      fixture.target.arrowId,
      fixture.target.endpoint,
      false,
    );
    assert.equal(await cardVisible(page), false);
    assert.deepEqual((await view(page)).renderedHeads, held.renderedHeads);
    assert.equal(
      (await view(page)).coins,
      200,
      "Blocked actions never charge during the pause",
    );
    await advance(page, 999);
    assert.equal(
      await cardVisible(page),
      false,
      "Game Over stays hidden through1999ms after impact",
    );
    assert.deepEqual((await view(page)).renderedHeads, held.renderedHeads);
    await advance(page, 2);
    assert.equal(
      await cardVisible(page),
      true,
      "Game Over appears after the full two seconds",
    );
    assert.deepEqual(
      (await view(page)).renderedHeads,
      held.renderedHeads,
      "Showing the card never rewinds the impact",
    );
    await page.screenshot({ path: `${output}/${label}-game-over.png` });
    await page.reload();
    await waitForReady(page);
    assert.equal(
      (await view(page)).gameOverDelayMs,
      2000,
      "Reload starts a fresh pause on the reconstructed impact",
    );
    assert.equal(await cardVisible(page), false);
    assert.deepEqual((await view(page)).renderedHeads, held.renderedHeads);
    await advance(page, 1999);
    assert.equal(await cardVisible(page), false);
    await advance(page, 2);
    assert.equal(await cardVisible(page), true);
    await page.locator("#recovery-undo").click();
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").moving?.phase ===
        "rewind",
    );
    const rewind = await view(page);
    assert.equal(rewind.gameOverDelayMs, 0);
    assert.equal(rewind.coins, 180);
    assert.deepEqual(rewind.renderedHeads, held.renderedHeads);
    await advance(page, (rewind.moving?.duration ?? 0) / 2);
    const middle = await view(page);
    assert.equal(middle.moving?.phase, "rewind");
    assert.notDeepEqual(middle.renderedHeads, held.renderedHeads);
    assert.notDeepEqual(middle.renderedHeads, initial.renderedHeads);
    await advance(page, 10000);
    assert.equal((await view(page)).lives, 1);
    assert.equal((await view(page)).gameOverDelayMs, 0);
    assert.equal(await cardVisible(page), false);
    assert.deepEqual((await view(page)).renderedHeads, initial.renderedHeads);
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(fixture.before),
    );
    assert.equal((await savedRow(page)).economy.coins, 180);
    assert.equal((await savedRow(page)).undo, null);
    assert.deepEqual(errors, []);
    console.log(
      `PASS Game Over delay ${label}: impact+1999ms hidden,2001ms visible, reload pause and paid visible rewind`,
    );
  } finally {
    await context.close();
  }
}

async function cancellation(browser: Browser, url: string) {
  const fixture = fatalFixture(generateLevel(2), (r) => r.distance > 1);
  for (const action of [
    "undo",
    "retry",
    "level",
    "reset",
    "pending-undo-retry",
  ] as const) {
    const { page, context, errors } = await openCampaign(
      browser,
      url,
      campaignRow(fixture.level, fixture.before),
    );
    try {
      await reachImpact(page, fixture.target.arrowId, fixture.target.endpoint);
      await advance(page, 500);
      if (action === "pending-undo-retry") {
        await page.evaluate(() => {
          void navigator.locks.request(
            "par-arrows:campaign",
            () =>
              new Promise<void>((resolve) =>
                Reflect.set(window, "releaseDelayLock", resolve),
              ),
          );
        });
        await page.waitForFunction(
          () => typeof Reflect.get(window, "releaseDelayLock") === "function",
        );
      }
      if (action === "undo" || action === "pending-undo-retry")
        await page.locator("#undo-button").click();
      if (action === "undo") {
        await page.waitForFunction(
          () =>
            JSON.parse(window.render_game_to_text?.() ?? "{}").moving?.phase ===
            "rewind",
        );
        await dispatchPowerup(page, "undo", 3);
      } else if (action === "retry" || action === "pending-undo-retry") {
        await page.locator('.dock-button[data-action="retry"]').click();
      } else if (action === "level") {
        await page.locator("#level-input").fill("1");
        await page.locator("#level-form button").click();
        await page.waitForFunction(
          () =>
            JSON.parse(window.render_game_to_text?.() ?? "{}").level.id === 1,
        );
        await waitForReady(page);
      } else
        await page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
      if (action === "pending-undo-retry") {
        await page.evaluate(() => Reflect.get(window, "releaseDelayLock")?.());
        await page.waitForFunction(
          () =>
            !JSON.parse(window.render_game_to_text?.() ?? "{}").undoPurchasing,
        );
      }
      await advance(page, 10000);
      const settled = await view(page);
      assert.equal(settled.gameOverDelayMs, 0);
      assert.equal(settled.heldCollision, null);
      assert.equal(
        await cardVisible(page),
        false,
        `${action}: no stale Game Over can cover the new state`,
      );
      assert.equal(
        settled.coins,
        action === "undo" ? 180 : action === "reset" ? 0 : 200,
      );
      assert.ok(settled.lives > 0);
      assert.deepEqual(errors, []);
      console.log(`PASS Game Over delay cancellation: ${action}`);
    } finally {
      await context.close();
    }
  }
}

export async function assertGameOverDelay(
  browser: Browser,
  url: string,
  output: string,
) {
  for (const mobile of [false, true])
    for (const reduced of [false, true])
      await timing(browser, url, output, mobile, reduced);
  for (const mobile of [false, true]) {
    const fixture = fatalFixture(generateLevel(2), (r) => r.distance > 1);
    const { page, context, errors } = await openCampaign(
      browser,
      url,
      campaignRow(fixture.level, fixture.before),
      mobile,
    );
    try {
      await page.clock.runFor(20);
      const held = await reachImpact(
        page,
        fixture.target.arrowId,
        fixture.target.endpoint,
      );
      await page.clock.runFor(1000);
      assert.equal(await cardVisible(page), false);
      // One late RAF must not turn a two-second pause into capped physics time.
      await page.clock.fastForward(1500);
      await page.clock.runFor(20);
      assert.equal(await cardVisible(page), true);
      assert.equal((await view(page)).gameOverDelayMs, 0);
      assert.deepEqual((await view(page)).renderedHeads, held.renderedHeads);
      assert.equal((await view(page)).coins, 200);
      assert.deepEqual(errors, []);
      console.log(
        `PASS Game Over delay real elapsed time across a stalled ${mobile ? "mobile" : "desktop"} frame`,
      );
    } finally {
      await context.close();
    }
  }
  await cancellation(browser, url);
}
if (import.meta.main)
  await runPowerupBrowser("game-over-delay", assertGameOverDelay);
