import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import { LEVEL_ONE } from "../src/content/intro";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import { generateLevel, seedForLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import type { GameState, LevelDefinition, MoveTarget } from "../src/core/types";
import { solveLevelTargets } from "../src/core/validation";
import { emptyEconomy } from "../src/economy";
import { layoutFingerprint } from "../src/storage";
import { runHintChecks } from "./hints-browser";
import { waitForReady } from "./runtime-fixtures";

const KEY = "par-arrows:campaign:v1";
const SETTINGS = "par-arrows:settings:v1";
const instant = new Date("2026-10-16T12:00:00Z");
interface State {
  coins: number | null;
  lives: number;
  hint: {
    arrowId: string;
    endpoint: string;
    phase: string;
    lit: boolean;
  } | null;
  moving: { duration: number; elapsed: number } | null;
  remainingIds: string[];
}
async function state(page: Page): Promise<State> {
  return page.evaluate(() =>
    JSON.parse(window.render_game_to_text?.() ?? "{}"),
  );
}
function saved(
  level: LevelDefinition,
  state = createGameState(level),
  unlocked = 21,
): string {
  return JSON.stringify({
    currentLevelId: level.id,
    unlockedLevelId: unlocked,
    tutorialComplete: false,
    state,
    contentVersion: 18,
    seed: seedForLevel(level.id),
    layout: layoutFingerprint(level),
  });
}
async function contextFor(
  browser: Browser,
  url: string,
  fixture?: string,
  mobile = false,
  seen = [1],
): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1365, height: 900 },
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  await context.addInitScript(
    ({ fixture, key, settings, seen }) => {
      if (fixture && !localStorage.getItem(key))
        localStorage.setItem(key, fixture);
      if (!localStorage.getItem(settings))
        localStorage.setItem(
          settings,
          JSON.stringify({ tutorialSeenLevels: seen }),
        );
    },
    { fixture: fixture ?? null, key: KEY, settings: SETTINGS, seen },
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: instant });
  await page.clock.pauseAt(instant);
  await page.goto(url);
  await waitForReady(page);
  return { context, page, errors };
}
async function advance(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((ms) => window.advanceTime?.(ms), milliseconds);
}
async function reveal(page: Page): Promise<void> {
  await advance(page, 650);
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text?.() ?? "{}").hint?.phase ===
      "flashing",
  );
}
async function setCoins(page: Page, coins: number): Promise<void> {
  await page.evaluate(
    ({ key, coins }) => {
      const row = JSON.parse(localStorage.getItem(key) ?? "{}");
      row.economy.coins = coins;
      localStorage.setItem(key, JSON.stringify(row));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    { key: KEY, coins },
  );
}
async function bypassClicks(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelector("#hint-button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const alternate = document.createElement("button");
    alternate.dataset.action = "hint";
    document.querySelector(".app-shell")?.append(alternate);
    alternate.click();
    alternate.remove();
  });
}
async function unchangedBoard(page: Page, before: string): Promise<void> {
  const after = await page.evaluate((key) => localStorage.getItem(key), KEY);
  assert.ok(after);
  const logical = (raw: string) => {
    const row = JSON.parse(raw);
    delete row.economy;
    return row;
  };
  assert.deepEqual(
    logical(after),
    logical(before),
    "Buying a hint changes only the wallet",
  );
}
async function corePurchases(
  browser: Browser,
  url: string,
  output: string,
  mobile: boolean,
): Promise<void> {
  const { context, page, errors } = await contextFor(
    browser,
    url,
    saved(LEVEL_ONE),
    mobile,
  );
  try {
    assert.equal((await state(page)).coins, 200);
    const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
    assert.ok(before);
    const button = page.getByRole("button", { name: "Hint", exact: true });
    assert.equal(
      await button.getAttribute("aria-describedby"),
      "hint-price hint-help coin-balance",
    );
    assert.match(await button.innerText(), /20 coins/);
    await button.click();
    await advance(page, 200);
    await page.getByRole("button", { name: "Reset camera view" }).click();
    assert.equal(
      (await state(page)).coins,
      200,
      "Cancellation before reveal is free",
    );
    await bypassClicks(page);
    await bypassClicks(page);
    await reveal(page);
    assert.equal(
      (await state(page)).coins,
      180,
      "Duplicate activations charge once",
    );
    await bypassClicks(page);
    assert.equal((await state(page)).coins, 180);
    await unchangedBoard(page, before);
    await page.screenshot({
      path: `${output}/hint-coins-${mobile ? "mobile" : "desktop"}.png`,
    });
    await advance(page, 2500);
    assert.equal((await state(page)).hint, null);
    await button.focus();
    await page.keyboard.press("Enter");
    await reveal(page);
    assert.equal(
      (await state(page)).coins,
      160,
      "Keyboard uses the same purchase path",
    );
    await page.reload();
    await waitForReady(page);
    assert.equal(
      (await state(page)).coins,
      160,
      "Reload never refunds or re-migrates a purchase",
    );
    await setCoins(page, 10);
    assert.equal(await button.isDisabled(), true);
    assert.match(
      await page.locator("#hint-help").innerText(),
      /Need 10 more coins/,
    );
    await bypassClicks(page);
    await page.keyboard.press("h");
    await page.keyboard.press("Space");
    await advance(page, 700);
    assert.equal((await state(page)).hint, null);
    assert.equal((await state(page)).coins, 10);
    if (mobile) {
      await page.setViewportSize({ width: 320, height: 720 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page.evaluate(() =>
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
        "HUD and controls fit 320 CSS pixels",
      );
      await page.screenshot({
        path: `${output}/hint-coins-mobile-320-shortfall.png`,
      });
    }
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
async function failures(browser: Browser, url: string): Promise<void> {
  // The first walkthrough asks for a blocked move, so no safe hint exists.
  const lesson = await contextFor(browser, url, saved(LEVEL_ONE), false, []);
  try {
    await lesson.page.locator("#hint-button").click();
    assert.equal((await state(lesson.page)).hint, null);
    assert.equal((await state(lesson.page)).coins, 200);
    assert.match(
      await lesson.page.locator("#hint-status").innerText(),
      /No safe hint/,
    );
  } finally {
    await lesson.context.close();
  }

  const lostLevel = generateLevel(2);
  const initial = createGameState(lostLevel);
  const lost: GameState = {
    ...initial,
    status: "lost",
    lives: 0,
    failedIds: initial.remainingIds.slice(0, lostLevel.lives),
    revision: lostLevel.lives,
  };
  const zero = await contextFor(browser, url, saved(lostLevel, lost));
  try {
    assert.equal((await state(zero.page)).lives, 0);
    assert.equal(await zero.page.locator("#hint-button").isDisabled(), true);
    await bypassClicks(zero.page);
    await advance(zero.page, 700);
    assert.equal((await state(zero.page)).hint, null);
    assert.equal((await state(zero.page)).coins, 200);
  } finally {
    await zero.context.close();
  }

  const denied = await contextFor(browser, url, saved(LEVEL_ONE));
  try {
    await denied.page.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key)
          throw new DOMException("Denied", "QuotaExceededError");
        return original.call(this, name, value);
      };
    }, KEY);
    await denied.page.locator("#hint-button").click();
    await advance(denied.page, 650);
    await denied.page.waitForFunction(
      () => JSON.parse(window.render_game_to_text?.() ?? "{}").hint === null,
    );
    assert.equal((await state(denied.page)).coins, 200);
    assert.equal(
      await denied.page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? "{}").economy.coins,
        KEY,
      ),
      200,
    );
    assert.match(
      await denied.page.locator("#hint-help").innerText(),
      /saved progress/,
    );
  } finally {
    await denied.context.close();
  }

  const graphics = await contextFor(browser, url, saved(LEVEL_ONE));
  try {
    await graphics.page.locator("#hint-button").click();
    await graphics.page.evaluate(() => {
      const gl = document.querySelector("canvas")?.getContext("webgl2");
      const loss = gl?.getExtension("WEBGL_lose_context");
      if (!loss) throw new Error("Context-loss extension unavailable");
      loss.loseContext();
    });
    await graphics.page.waitForFunction(() =>
      document.querySelector("canvas")?.getContext("webgl2")?.isContextLost(),
    );
    await advance(graphics.page, 650);
    await graphics.page.waitForFunction(
      () => JSON.parse(window.render_game_to_text?.() ?? "{}").hint === null,
    );
    assert.equal((await state(graphics.page)).coins, 200);
    await bypassClicks(graphics.page);
    assert.equal((await state(graphics.page)).hint, null);
    assert.equal((await state(graphics.page)).coins, 200);
  } finally {
    await graphics.context.close();
  }
}
async function concurrentTabs(browser: Browser, url: string): Promise<void> {
  const { context, page } = await contextFor(browser, url, saved(LEVEL_ONE));
  try {
    const other = await context.newPage();
    await other.clock.install({ time: instant });
    await other.clock.pauseAt(instant);
    await other.goto(url);
    await waitForReady(other);
    await other.evaluate(() => {
      void navigator.locks.request(
        "par-arrows:campaign",
        () =>
          new Promise<void>((resolve) => {
            Reflect.set(window, "releaseWalletLock", resolve);
          }),
      );
    });
    await other.waitForFunction(() => Reflect.has(window, "releaseWalletLock"));
    await page.locator("#hint-button").click();
    await advance(page, 650);
    await page.getByRole("button", { name: "Reset camera view" }).click();
    await other.evaluate(() => Reflect.get(window, "releaseWalletLock")());
    // A barrier confirms the cancelled purchase ahead of it has drained.
    await other.evaluate(() =>
      navigator.locks.request("par-arrows:campaign", () => undefined),
    );
    assert.equal((await state(page)).coins, 200);
    assert.equal((await state(page)).hint, null);

    await setCoins(page, 20);
    await other.waitForFunction(
      () => JSON.parse(window.render_game_to_text?.() ?? "{}").coins === 20,
    );
    await page.locator("#hint-button").click();
    await other.locator("#hint-button").click();
    await Promise.all([advance(page, 650), advance(other, 650)]);
    for (const tab of [page, other])
      await tab.waitForFunction(() => {
        const state = JSON.parse(window.render_game_to_text?.() ?? "{}");
        return (
          state.coins === 0 && (!state.hint || state.hint.phase === "flashing")
        );
      });
    assert.equal(
      [await state(page), await state(other)].filter((state) => state.hint?.lit)
        .length,
      1,
      "Only one tab can purchase with the last 20 coins",
    );
    await other.close();
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).coins, 0);
  } finally {
    await context.close();
  }
}
function almostWon(level: LevelDefinition): {
  state: GameState;
  final: MoveTarget;
} {
  const targets = solveLevelTargets(level);
  assert.ok(targets?.length);
  let current = createGameState(level);
  for (const target of targets.slice(0, -1))
    current = applyMove(
      level,
      current,
      simulateMove(level, current, target.arrowId, target.endpoint),
    );
  const final = targets.at(-1);
  assert.ok(final);
  return { state: current, final };
}
async function completionRewards(browser: Browser, url: string): Promise<void> {
  const first = almostWon(LEVEL_ONE);
  const fixture = JSON.stringify({
    ...JSON.parse(saved(LEVEL_ONE, first.state, 1)),
    economy: emptyEconomy(),
  });
  const { context, page } = await contextFor(browser, url, fixture);
  try {
    await page.evaluate(
      (target) =>
        window.__PAR_ARROWS_TEST__?.activate(target.arrowId, target.endpoint),
      first.final,
    );
    await page.waitForFunction((key) => {
      const row = JSON.parse(localStorage.getItem(key) ?? "{}");
      return row.state?.status === "won" && row.economy?.coins === 10;
    }, KEY);
    assert.ok(
      (await state(page)).moving,
      "Reward is durable before celebration finishes",
    );
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).coins, 10);
    await page.locator('[data-action="retry"]').first().click();
    const solution = solveLevelTargets(LEVEL_ONE);
    assert.ok(solution);
    for (const target of solution) {
      await page.evaluate(
        (target) =>
          window.__PAR_ARROWS_TEST__?.activate(target.arrowId, target.endpoint),
        target,
      );
      const moving = (await state(page)).moving;
      if (moving) await advance(page, moving.duration - moving.elapsed + 50);
    }
    assert.equal(
      (await state(page)).coins,
      10,
      "Replay never earns another reward",
    );
    const level = generateLevel(2);
    const second = almostWon(level);
    await page.evaluate(
      ({ key, fixture }) => {
        const previous = JSON.parse(localStorage.getItem(key) ?? "{}");
        localStorage.setItem(
          key,
          JSON.stringify({ ...JSON.parse(fixture), economy: previous.economy }),
        );
      },
      { key: KEY, fixture: saved(level, second.state, 2) },
    );
    await page.reload();
    await waitForReady(page);
    await page.evaluate(
      (target) =>
        window.__PAR_ARROWS_TEST__?.activate(target.arrowId, target.endpoint),
      second.final,
    );
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text?.() ?? "{}").coins === 20,
    );
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(3));
    assert.equal((await state(page)).coins, 20);
    await page.locator("#hint-button").click();
    await reveal(page);
    assert.equal(
      (await state(page)).coins,
      0,
      "Two first clears buy exactly one hint",
    );
    const campaign = await page.evaluate(
      (key) => localStorage.getItem(key),
      KEY,
    );
    await page.goto(`${url}&level=3`);
    await waitForReady(page);
    assert.equal(await page.locator("#hint-button").isDisabled(), true);
    await bypassClicks(page);
    await advance(page, 700);
    assert.equal((await state(page)).hint, null);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), KEY),
      campaign,
    );
  } finally {
    await context.close();
  }
}

async function mechanicTargets(browser: Browser, url: string): Promise<void> {
  const grouped = createGameState(OVERLAP_INTRO_LEVEL);
  const unblocked = applyMove(
    OVERLAP_INTRO_LEVEL,
    grouped,
    simulateMove(OVERLAP_INTRO_LEVEL, grouped, "overlap-intro-blocker"),
  );
  const fixtures = [
    {
      level: DOUBLE_INTRO_LEVEL,
      state: createGameState(DOUBLE_INTRO_LEVEL),
      arrowId: "double-intro-choice",
      endpoint: "tail",
    },
    {
      level: OVERLAP_INTRO_LEVEL,
      state: unblocked,
      arrowId: "overlap-intro-pair-a",
      endpoint: "head",
    },
  ];
  for (const fixture of fixtures) {
    const { context, page, errors } = await contextFor(
      browser,
      url,
      saved(fixture.level, fixture.state, fixture.level.id + 1),
      false,
      [fixture.level.id],
    );
    try {
      const before = await state(page);
      await page.locator("#hint-button").click();
      await reveal(page);
      const after = await state(page);
      assert.equal(after.hint?.arrowId, fixture.arrowId);
      assert.equal(after.hint?.endpoint, fixture.endpoint);
      assert.equal(after.coins, (before.coins as number) - 20);
      assert.equal(after.lives, before.lives);
      assert.deepEqual(after.remainingIds, before.remainingIds);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}

export async function assertHintEconomy(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(output, { recursive: true });
  await corePurchases(browser, url, output, false);
  await corePurchases(browser, url, output, true);
  await failures(browser, url);
  await concurrentTabs(browser, url);
  await completionRewards(browser, url);
  await mechanicTargets(browser, url);
  console.log(
    "PASS Hint economy: migration, purchases, cancellation, duplicate/keyboard/alternate entrypoints, shortfalls, zero lives, failures, concurrent tabs, first clears, replay, reload, preview isolation, double endpoints, groups, and 320px layout",
  );
}

if (import.meta.main) {
  const url = "http://127.0.0.1:8058/?test=1";
  const server = Bun.spawn(
    [
      "bun",
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "8058",
      "--strictPort",
    ],
    { stdout: "ignore", stderr: "inherit" },
  );
  let browser: Browser | undefined;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(url)).ok;
      } catch {
        /* Server is starting. */
      }
      if (ready) break;
      if (server.exitCode !== null) throw new Error("Preview server exited");
      await Bun.sleep(100);
    }
    assert.ok(ready, "Preview server starts");
    const software = process.env.BROWSER_SOFTWARE === "1";
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
        : {}),
      ...(process.platform === "darwin" && !process.env.BROWSER_EXECUTABLE_PATH
        ? { channel: "chrome" }
        : {}),
      args: software ? ["--enable-unsafe-swiftshader"] : [],
    });
    const output = software
      ? "test-results/hint-economy-software"
      : "test-results/hint-economy";
    if (software)
      console.warn(
        "SwiftShader run: functional/DOM evidence only; canvas pixels require real GPU acceptance.",
      );
    await assertHintEconomy(browser, url, output);
    for (const mobile of [false, true]) {
      const { context, page } = await contextFor(
        browser,
        url,
        undefined,
        mobile,
      );
      try {
        await runHintChecks(page, output, mobile);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    server.kill();
    await server.exited;
  }
}
