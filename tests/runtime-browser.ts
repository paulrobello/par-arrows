import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import {
  GENERATOR_VERSION,
  generateLevel,
  seedForLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { waitForReady } from "./runtime-fixtures";

const KEY = "par-arrows:campaign:v1";

async function state(page: Page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw);
  return JSON.parse(raw) as {
    level: { id: number };
    loading: boolean;
    loadingError?: string;
    lives: number;
    remainingIds: string[];
    failedIds: string[];
    generation: { version: number; seed: string } | null;
  };
}

export async function assertRuntimeCampaign(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
  const page = await context.newPage();
  let workers = 0;
  const errors: string[] = [];
  page.on("worker", () => (workers += 1));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await waitForReady(page);
  const pending = await page.evaluate(() => {
    void window.__PAR_ARROWS_TEST__?.loadLevel(12);
    return JSON.parse(window.render_game_to_text?.() ?? "{}");
  });
  assert.equal(pending.loading, true);
  await waitForReady(page);
  assert.equal((await state(page)).level.id, 12);
  assert.ok(workers > 0, "A real worker must generate runtime levels");
  const twelve = generateLevel(12);
  assert.deepEqual(
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
    twelve,
  );
  assert.deepEqual((await state(page)).generation, {
    version: GENERATOR_VERSION,
    seed: seedForLevel(12),
  });
  const blocked = twelve.arrows.find(
    (arrow) =>
      simulateMove(twelve, createGameState(twelve), arrow.id).kind ===
      "blocked",
  );
  assert.ok(blocked);
  const blockedIds = overlappingArrowIds(twelve, blocked.id);
  await page.evaluate((id) => {
    window.__PAR_ARROWS_TEST__?.activate(id);
    window.advanceTime?.(1000);
  }, blocked.id);
  const saved = await page.evaluate((key) => localStorage.getItem(key), KEY);
  assert.ok(saved);
  await page.reload();
  await waitForReady(page);
  assert.deepEqual((await state(page)).failedIds, blockedIds);
  assert.equal((await state(page)).lives, twelve.lives - 1);
  assert.deepEqual(
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
    twelve,
  );
  await page.locator('[data-action="retry"]').first().click();
  assert.equal((await state(page)).lives, twelve.lives);
  assert.deepEqual((await state(page)).failedIds, []);
  assert.deepEqual(
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
    twelve,
  );

  await page.evaluate(async () => {
    await Promise.allSettled([
      window.__PAR_ARROWS_TEST__?.loadLevel(50_000),
      window.__PAR_ARROWS_TEST__?.loadLevel(12),
    ]);
  });
  assert.equal(
    (await state(page)).level.id,
    12,
    "A stale worker result cannot replace the latest request",
  );
  await page.evaluate(async () => {
    const pending = window.__PAR_ARROWS_TEST__?.loadLevel(50_001);
    window.__PAR_ARROWS_TEST__?.resetProgress();
    await pending;
  });
  assert.equal(
    (await state(page)).level.id,
    1,
    "Resetting progress returns to the tutorial cube",
  );
  assert.equal(
    await page.evaluate((key) => localStorage.getItem(key), KEY),
    null,
  );

  await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(1000));
  const thousand = generateLevel(1000);
  assert.deepEqual(
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
    thousand,
  );
  assert.ok(thousand.gridSize <= 26 && thousand.arrows.length <= 264);
  await page.screenshot({ path: `${output}/runtime-cube-1000-mobile.png` });
  const safe = thousand.arrows.find((arrow) => {
    const move = simulateMove(thousand, createGameState(thousand), arrow.id);
    return move.kind === "exit" && (move.members?.length ?? 1) === 1;
  });
  assert.ok(safe);
  await page.evaluate(
    ({ key, arrowId, count }) => {
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      saved.state.remainingIds = [arrowId];
      saved.state.revision = count - 1;
      localStorage.setItem(key, JSON.stringify(saved));
    },
    { key: KEY, arrowId: safe.id, count: thousand.arrows.length },
  );
  await page.reload();
  await waitForReady(page);
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.activate(id),
    safe.id,
  );
  await page.reload();
  await waitForReady(page);
  assert.deepEqual((await state(page)).remainingIds, []);
  await page.getByRole("button", { name: "Next Level", exact: true }).click();
  await waitForReady(page);
  assert.equal((await state(page)).level.id, 1001);
  assert.ok((await page.locator("#level-input").count()) === 1);
  assert.equal(await page.locator("#level-input").getAttribute("max"), "1001");
  assert.ok((await page.locator("#level-form option").count()) < 30);
  await page.locator("#level-input").fill("1");
  await page.locator("#level-input").press("Enter");
  await waitForReady(page);
  assert.equal((await state(page)).level.id, 1);
  await page.locator("#level-input").fill("1001");
  await page.locator("#level-input").press("Enter");
  await waitForReady(page);
  assert.equal((await state(page)).level.id, 1001);
  await page.locator("#level-input").fill("1002");
  await page.locator("#level-input").press("Enter");
  assert.equal(
    (await state(page)).level.id,
    1001,
    "Locked levels cannot be selected",
  );

  const second = await browser.newContext();
  const otherPage = await second.newPage();
  await otherPage.goto(url);
  await waitForReady(otherPage);
  await otherPage.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(1001));
  assert.deepEqual(
    await otherPage.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
  );
  await second.close();
  assert.deepEqual(errors, []);
  await context.close();

  // Cube 2 keeps its version-1 seed and layout, so a legacy save for it still
  // resumes exactly; cubes 3 and 4 were rebuilt by the content-10 seam fix and
  // refresh, as do generated cubes from 5 (covered by the level-twelve case).
  const migrationLevel = generateLevel(2);
  const initialMigrationState = createGameState(migrationLevel);
  const migrationBlocker = migrationLevel.arrows.find(
    (arrow) =>
      simulateMove(migrationLevel, initialMigrationState, arrow.id).kind ===
      "blocked",
  );
  assert.ok(migrationBlocker);
  const partialMigrationState = applyMove(
    migrationLevel,
    initialMigrationState,
    simulateMove(migrationLevel, initialMigrationState, migrationBlocker.id),
  );
  const levelTwoLegacySave = JSON.stringify({
    currentLevelId: 2,
    unlockedLevelId: 14,
    state: partialMigrationState,
    tutorialComplete: true,
    contentVersion: 6,
    generatorVersion: 1,
    seed: "par-arrows:runtime:1:level:2",
  });
  const migration = await browser.newContext();
  await migration.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, saved),
    { key: KEY, saved: levelTwoLegacySave },
  );
  const migrationPage = await migration.newPage();
  await migrationPage.goto(url);
  await waitForReady(migrationPage);
  assert.equal((await state(migrationPage)).level.id, 2);
  assert.deepEqual(
    (await state(migrationPage)).remainingIds,
    partialMigrationState.remainingIds,
  );
  assert.deepEqual((await state(migrationPage)).failedIds, [
    migrationBlocker.id,
  ]);
  assert.equal((await state(migrationPage)).lives, migrationLevel.lives - 1);
  await migration.close();

  const levelTwelve = generateLevel(12);
  const initialTwelveState = createGameState(levelTwelve);
  const blockedTwelve = levelTwelve.arrows.find(
    (arrow) =>
      simulateMove(levelTwelve, initialTwelveState, arrow.id).kind ===
      "blocked",
  );
  assert.ok(blockedTwelve);
  const staleLaterState = applyMove(
    levelTwelve,
    initialTwelveState,
    simulateMove(levelTwelve, initialTwelveState, blockedTwelve.id),
  );
  const laterLegacySave = JSON.stringify({
    currentLevelId: 12,
    unlockedLevelId: 17,
    state: staleLaterState,
    tutorialComplete: true,
    contentVersion: 6,
    generatorVersion: 1,
    seed: "par-arrows:runtime:1:level:12",
  });
  const refresh = await browser.newContext();
  await refresh.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, saved),
    { key: KEY, saved: laterLegacySave },
  );
  const refreshPage = await refresh.newPage();
  await refreshPage.goto(url);
  await waitForReady(refreshPage);
  assert.equal((await state(refreshPage)).level.id, 12);
  assert.deepEqual((await state(refreshPage)).failedIds, []);
  assert.equal((await state(refreshPage)).lives, levelTwelve.lives);
  const migratedCampaign = await refreshPage.evaluate((key) => {
    const savedCampaign = JSON.parse(localStorage.getItem(key) ?? "{}");
    return {
      currentLevelId: savedCampaign.currentLevelId,
      unlockedLevelId: savedCampaign.unlockedLevelId,
      tutorialComplete: savedCampaign.tutorialComplete,
    };
  }, KEY);
  assert.deepEqual(migratedCampaign, {
    currentLevelId: 12,
    unlockedLevelId: 17,
    tutorialComplete: true,
  });
  await refresh.close();

  const failed = await browser.newContext();
  await failed.addInitScript(
    ({ key, saved }) => {
      localStorage.setItem(key, saved);
      const NativeWorker = window.Worker;
      Object.defineProperty(window, "Worker", {
        configurable: true,
        writable: true,
        value: class {
          constructor() {
            throw new Error("Worker unavailable for test");
          }
        },
      });
      Object.defineProperty(window, "restoreWorkerForTest", {
        value: () => {
          window.Worker = NativeWorker;
        },
      });
    },
    { key: KEY, saved },
  );
  const failedPage = await failed.newPage();
  await failedPage.goto(url);
  await failedPage.waitForFunction(() => {
    const raw = window.render_game_to_text?.();
    return raw && Boolean(JSON.parse(raw).loadingError);
  });
  assert.equal(
    await failedPage.evaluate((key) => localStorage.getItem(key), KEY),
    saved,
  );
  await failedPage.evaluate(() =>
    (
      window as unknown as { restoreWorkerForTest(): void }
    ).restoreWorkerForTest(),
  );
  await failedPage.locator('[data-action="generation-retry"]').click();
  await waitForReady(failedPage);
  assert.equal((await state(failedPage)).level.id, 12);
  assert.deepEqual((await state(failedPage)).failedIds, blockedIds);
  assert.equal((await state(failedPage)).lives, twelve.lives - 1);
  await failed.close();

  const legacy = JSON.parse(saved);
  legacy.contentVersion = 5;
  const delayed = await browser.newContext();
  await delayed.addInitScript(
    ({ key, saved }) => {
      localStorage.setItem(key, saved);
      const NativeWorker = window.Worker;
      Object.defineProperty(window, "workerRepliesForTest", {
        value: 0,
        writable: true,
      });
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener("message", () => {
            (
              window as unknown as { workerRepliesForTest: number }
            ).workerRepliesForTest += 1;
          });
        }
        postMessage(message: unknown): void {
          setTimeout(() => super.postMessage(message), 500);
        }
      };
    },
    { key: KEY, saved: JSON.stringify(legacy) },
  );
  const delayedPage = await delayed.newPage();
  await delayedPage.goto(url);
  await delayedPage.waitForFunction(() => Boolean(window.__PAR_ARROWS_TEST__));
  await delayedPage.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
  await delayedPage.waitForFunction(
    () =>
      (window as unknown as { workerRepliesForTest: number })
        .workerRepliesForTest > 0,
  );
  assert.equal(
    await delayedPage.evaluate((key) => localStorage.getItem(key), KEY),
    null,
    "Stale legacy restore must not resurrect cleared progress",
  );
  assert.equal(
    (await state(delayedPage)).level.id,
    1,
    "Resetting progress returns to the tutorial cube",
  );
  await delayed.close();
  console.log(
    "PASS runtime worker generation, shared seeds, 1000→1001 progression, bounded navigation, retry/reload, stale requests, restore failure recovery and reset during migration",
  );
}
