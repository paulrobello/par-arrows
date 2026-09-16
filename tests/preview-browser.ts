import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import {
  GENERATOR_VERSION,
  generateLevel,
  getWrappingEdgePolicies,
  MAX_LEVEL_ID,
  seedForLevel,
} from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import { solveLevel } from "../src/core/validation";

const CAMPAIGN_KEY = "par-arrows:campaign:v1";

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const raw = window.render_game_to_text?.();
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    return snapshot.loading === false && !snapshot.loadingError;
  });
}

async function state(page: Page) {
  return JSON.parse(
    await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
  ) as {
    level: { id: number };
    preview: { active: boolean } | null;
    wrappingEdges: number;
    lives: number;
    remainingIds: string[];
    failedIds: string[];
    loading: boolean;
    loadingError?: string;
    moving: { duration: number; elapsed: number } | null;
  };
}

function previewUrl(base: string, query: string): string {
  const url = new URL(base);
  url.search = query;
  return url.href;
}

export async function assertLevelPreview(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const campaign = generateLevel(2);
  const initial = createGameState(campaign);
  const blocked = campaign.arrows.find(
    (arrow) => simulateMove(campaign, initial, arrow.id).kind === "blocked",
  );
  assert.ok(blocked);
  const campaignState = applyMove(
    campaign,
    initial,
    simulateMove(campaign, initial, blocked.id),
  );
  const saved = JSON.stringify({
    currentLevelId: 2,
    unlockedLevelId: 3,
    state: campaignState,
    tutorialComplete: true,
    contentVersion: 8,
    generatorVersion: GENERATOR_VERSION,
    seed: seedForLevel(2),
  });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const assertSaveUnchanged = async (): Promise<void> => {
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      saved,
      "Testing must leave the campaign save byte-for-byte unchanged",
    );
  };
  try {
    await page.goto(url);
    await waitForReady(page);
    await page.evaluate(
      ({ key, saved }) => {
        localStorage.setItem(key, saved);
        localStorage.setItem(
          "par-arrows:settings:v1",
          JSON.stringify({ reducedMotion: true, theme: "light" }),
        );
      },
      { key: CAMPAIGN_KEY, saved },
    );

    await page.goto(previewUrl(url, "level=25"));
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 25);
    assert.equal((await state(page)).preview?.active, true);
    assert.equal(
      await page.evaluate(() => Boolean(window.__PAR_ARROWS_TEST__)),
      false,
      "Public test links must work without the automation flag",
    );
    await assertSaveUnchanged();
    assert.equal(
      await page.getByRole("link", { name: "Return to campaign" }).isVisible(),
      true,
    );

    await page.goto(
      `${previewUrl(url, "feature=wrap&level=20&wraps=3&test=1&source=manual")}#inspect`,
    );
    await waitForReady(page);
    let preview = await state(page);
    assert.ok(preview.level.id >= 20);
    assert.equal(preview.wrappingEdges, 3);
    assert.equal(
      new URL(page.url()).searchParams.get("level"),
      String(preview.level.id),
    );
    const matchedLevel = preview.level.id;
    assert.equal(new URL(page.url()).searchParams.get("source"), "manual");
    assert.equal(new URL(page.url()).hash, "#inspect");
    assert.deepEqual(
      await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
      generateLevel(matchedLevel),
    );
    await assertSaveUnchanged();
    await page.screenshot({ path: `${output}/feature-preview-desktop.png` });

    const testLevel = generateLevel(matchedLevel);
    const testState = createGameState(testLevel);
    const blockedPreview = testLevel.arrows.find(
      (arrow) =>
        simulateMove(testLevel, testState, arrow.id).kind === "blocked",
    );
    assert.ok(blockedPreview);
    await page.evaluate((id) => {
      window.__PAR_ARROWS_TEST__?.activate(id);
      window.advanceTime?.(100);
    }, blockedPreview.id);
    assert.deepEqual(
      (await state(page)).failedIds,
      overlappingArrowIds(testLevel, blockedPreview.id),
    );
    await assertSaveUnchanged();
    await page.locator('[data-action="retry"]').first().click();
    assert.deepEqual((await state(page)).failedIds, []);
    await assertSaveUnchanged();

    await page.goto(previewUrl(url, "level=1&wraps=0&test=1"));
    await waitForReady(page);
    const solution = solveLevel(generateLevel(1));
    assert.ok(solution);
    await page.evaluate((ids) => {
      for (const id of ids) {
        window.__PAR_ARROWS_TEST__?.activate(id);
        window.advanceTime?.(100);
      }
    }, solution);
    assert.equal((await state(page)).remainingIds.length, 0);
    await assertSaveUnchanged();
    await page.getByRole("button", { name: "Next cube", exact: true }).click();
    await waitForReady(page);
    preview = await state(page);
    assert.equal(preview.level.id, 2);
    assert.equal(preview.wrappingEdges, 0);
    assert.equal(new URL(page.url()).searchParams.get("wraps"), "0");
    await assertSaveUnchanged();

    await page.goto(
      `${previewUrl(url, `feature=wrap&level=${matchedLevel}&wraps=3&test=1&source=manual`)}#inspect`,
    );
    await waitForReady(page);
    await page.locator('input[type="number"]').fill("50");
    await page.locator('input[type="number"]').press("Enter");
    await waitForReady(page);
    preview = await state(page);
    assert.ok(preview.level.id >= 50);
    assert.equal(preview.wrappingEdges, 3);
    const afterGo = preview.level.id;
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).level.id, afterGo);
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
    await waitForReady(page);
    assert.equal((await state(page)).level.id, afterGo);
    await assertSaveUnchanged();

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.getByRole("link", { name: "Return to campaign" }).isVisible(),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${output}/feature-preview-mobile.png` });
    await page.setViewportSize({ width: 844, height: 390 });
    const banner = await page.locator("#preview-banner").boundingBox();
    const canvas = await page.locator("canvas").boundingBox();
    const cubeBounds = await page.evaluate(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").camera
          .cubeScreenBounds,
    );
    assert.ok(banner && canvas);
    assert.ok(
      banner.x + banner.width <= canvas.x + cubeBounds.left ||
        banner.x >= canvas.x + cubeBounds.right ||
        banner.y + banner.height <= canvas.y + cubeBounds.top ||
        banner.y >= canvas.y + cubeBounds.bottom,
      "The landscape test banner must not cover the cube",
    );
    await page.screenshot({ path: `${output}/feature-preview-landscape.png` });
    await page.getByRole("link", { name: "Return to campaign" }).click();
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 2);
    assert.equal((await state(page)).preview?.active ?? false, false);
    assert.equal(new URL(page.url()).searchParams.get("source"), "manual");
    assert.equal(new URL(page.url()).hash, "#inspect");
    assert.deepEqual((await state(page)).failedIds, campaignState.failedIds);
    assert.equal((await state(page)).lives, campaignState.lives);
    assert.deepEqual(
      JSON.parse(
        await page.evaluate(
          (key) => localStorage.getItem(key) ?? "{}",
          CAMPAIGN_KEY,
        ),
      ),
      JSON.parse(saved),
    );

    for (const query of [
      "level=1.5",
      "level=0",
      "feature=unknown",
      "wraps=4",
      "feature=wrap&wraps=0",
      "level=11&level=12",
      `level=${MAX_LEVEL_ID}&wraps=${(getWrappingEdgePolicies(MAX_LEVEL_ID).length / 2 + 1) % 4}`,
    ]) {
      await page.evaluate(
        ({ key, saved }) => localStorage.setItem(key, saved),
        { key: CAMPAIGN_KEY, saved },
      );
      await page.goto(previewUrl(url, `${query}&test=1`));
      await page.waitForFunction(() =>
        Boolean(
          JSON.parse(window.render_game_to_text?.() ?? "{}").loadingError,
        ),
      );
      assert.equal((await state(page)).preview?.active, true);
      await assertSaveUnchanged();
      assert.equal(
        await page
          .getByRole("link", { name: "Return to campaign" })
          .isVisible(),
        true,
      );
      await page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
      await assertSaveUnchanged();
    }
    await page.getByRole("link", { name: "Return to campaign" }).click();
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 2);
    await page.evaluate((key) => localStorage.removeItem(key), CAMPAIGN_KEY);
    await page.goto(previewUrl(url, "feature=wraparound"));
    await waitForReady(page);
    assert.ok((await state(page)).wrappingEdges >= 1);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      null,
    );
    await page.goto(previewUrl(url, "feature=wrap"));
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 11);
    assert.equal((await state(page)).preview?.active, true);
    assert.ok((await state(page)).wrappingEdges >= 1);
    assert.equal(await page.locator("#wrap-intro").isVisible(), true);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      null,
      "The wrap intro preview must not create a campaign save",
    );
    await page.screenshot({ path: `${output}/wrap-intro-preview-light.png` });
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("#theme-select");
      if (!select) throw new Error("Theme selector missing");
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.screenshot({ path: `${output}/wrap-intro-preview-dark.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator("#wrap-intro").isVisible(), true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${output}/wrap-intro-preview-mobile.png` });
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      null,
      "Responsive preview rendering must remain isolated from campaign saves",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS public level/feature/count URLs, filtered Next/Go, deterministic reload, invalid options, and isolated campaign saves",
    );
  } finally {
    await context.close();
  }
}
