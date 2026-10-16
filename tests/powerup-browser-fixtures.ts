import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { seedForLevel } from "../src/content/procedural";
import type { GameState, LevelDefinition } from "../src/core/types";
import type { UndoSnapshot } from "../src/core/undo";
import { createGameState } from "../src/core/game-state";
import { migrateEconomy, type Economy } from "../src/economy";
import { layoutFingerprint } from "../src/storage";
import { waitForReady } from "./runtime-fixtures";

export const CAMPAIGN_KEY = "par-arrows:campaign:v1";
const SETTINGS_KEY = "par-arrows:settings:v1";
const instant = new Date("2026-10-16T12:00:00Z");

export function campaignRow(
  level: LevelDefinition,
  state = createGameState(level),
  undo: UndoSnapshot | null = null,
  coins = 200,
): string {
  return JSON.stringify({
    currentLevelId: level.id,
    unlockedLevelId: Math.max(22, level.id + 1),
    tutorialComplete: true,
    state,
    undo,
    contentVersion: 18,
    seed: seedForLevel(level.id),
    layout: layoutFingerprint(level),
    economy: { ...migrateEconomy(22), coins },
  });
}

export async function openCampaign(
  browser: Browser,
  url: string,
  fixture: string,
  mobile = false,
  seen: number[] = [1, 5, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1365, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  await context.addInitScript(
    ({ key, settingsKey, fixture, seen }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, fixture);
      if (!localStorage.getItem(settingsKey))
        localStorage.setItem(
          settingsKey,
          JSON.stringify({
            tutorialSeenLevels: seen,
            installPromptDismissed: true,
          }),
        );
    },
    { key: CAMPAIGN_KEY, settingsKey: SETTINGS_KEY, fixture, seen },
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

export async function savedRow(page: Page): Promise<
  Record<string, unknown> & {
    state: GameState;
    economy: Economy;
    undo: UndoSnapshot | null;
  }
> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
    CAMPAIGN_KEY,
  );
}

export async function activate(
  page: Page,
  arrowId: string,
  endpoint: "head" | "tail" = "head",
  finish = true,
): Promise<void> {
  await page.evaluate(
    async ({ arrowId, endpoint, finish }) => {
      const persisted = window.__PAR_ARROWS_TEST__?.activate(arrowId, endpoint);
      if (finish) window.advanceTime?.(10000);
      await persisted;
    },
    { arrowId, endpoint, finish },
  );
}

export async function dispatchPowerup(
  page: Page,
  action: string,
  count = 1,
): Promise<void> {
  await page.evaluate(
    ({ action, count }) => {
      const button = document.querySelector(`[data-action="${action}"]`);
      for (let i = 0; i < count; i++)
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    },
    { action, count },
  );
}

export async function setCoins(page: Page, coins: number): Promise<void> {
  await page.evaluate(
    ({ key, coins }) => {
      const row = JSON.parse(localStorage.getItem(key) ?? "{}");
      row.economy.coins = coins;
      localStorage.setItem(key, JSON.stringify(row));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    { key: CAMPAIGN_KEY, coins },
  );
}

export async function runPowerupBrowser(
  name: string,
  run: (browser: Browser, url: string, output: string) => Promise<void>,
): Promise<void> {
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
        /* Starting. */
      }
      if (ready) break;
      assert.equal(server.exitCode, null);
      await Bun.sleep(100);
    }
    assert.ok(ready, "Preview server starts");
    const software = process.env.BROWSER_SOFTWARE === "1";
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
        : process.platform === "darwin"
          ? { channel: "chrome" }
          : {}),
      args: software ? ["--enable-unsafe-swiftshader"] : [],
    });
    const output = `test-results/${name}${software ? "-software" : ""}`;
    await mkdir(output, { recursive: true });
    if (software)
      console.warn(
        "SwiftShader: functional/DOM evidence only; real-GPU pixel acceptance remains unverified.",
      );
    await run(browser, url, output);
  } finally {
    await browser?.close();
    server.kill();
    await server.exited;
  }
}
