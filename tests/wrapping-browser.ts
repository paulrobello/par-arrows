import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import {
  GENERATOR_VERSION,
  generateLevel,
  seedForLevel,
} from "../src/content/procedural";
import { createGameState, simulateMove } from "../src/core/game-state";
import { waitForReady } from "./runtime-fixtures";

export interface WrappingBrowserFixtures {
  readonly movementLevelId: number;
  readonly reboundLevelId: number;
}

async function loadLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
    levelId,
  );
  await page.waitForFunction(
    (id) => JSON.parse(window.render_game_to_text?.() ?? "{}").level?.id === id,
    levelId,
  );
}

async function yellowPixelCount(page: Page): Promise<number> {
  const image = await page.locator("canvas").screenshot();
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let offset = 0; offset < info.width * info.height * 4; offset += 4) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    if (red > 90 && green > 55 && red > green * 1.18 && green > blue * 1.35) {
      count += 1;
    }
  }
  return count;
}

function crossingArrow(levelId: number, expectedKind?: "exit" | "blocked") {
  const level = generateLevel(levelId);
  const state = createGameState(level);
  const arrow = level.arrows.find((candidate) => {
    const result = simulateMove(level, state, candidate.id);
    return (
      (!expectedKind || result.kind === expectedKind) &&
      result.route.some(
        (cell, index) =>
          index > 0 && cell.face !== result.route[index - 1]?.face,
      )
    );
  });
  assert.ok(
    arrow,
    `Level ${levelId} needs a ${expectedKind ?? "wrapped"} move`,
  );
  return arrow;
}

export async function assertWrappingEdges(
  browser: Browser,
  url: string,
  output: string,
  fixtures: WrappingBrowserFixtures,
): Promise<void> {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await waitForReady(page);

    const movementLevel = generateLevel(fixtures.movementLevelId);
    const movementArrow = crossingArrow(fixtures.movementLevelId);
    await loadLevel(page, fixtures.movementLevelId);
    const expectedEdges =
      (movementLevel.edgePolicies ?? []).filter(
        (policy) => policy.policy === "continue",
      ).length / 2;
    assert.equal(
      JSON.parse(
        await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
      ).wrappingEdges,
      expectedEdges,
    );
    const initialYellowPixels = await yellowPixelCount(page);
    assert.ok(initialYellowPixels > 10, "Wrapped seams must appear yellow");
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("#theme-select");
      if (!select) return;
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").theme?.resolved ===
        "dark",
    );
    const darkYellowPixels = await yellowPixelCount(page);
    assert.ok(
      darkYellowPixels > 10,
      "Wrapped seams must remain yellow in dark mode",
    );
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("#theme-select");
      if (!select) return;
      select.value = "light";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
      (await yellowPixelCount(page)) > 5,
      "Wrapped seams must fit on mobile",
    );
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.screenshot({ path: `${output}/wrapped-edges-initial.png` });
    await page.evaluate(
      ({ levelId, arrowId, lives, revision, generatorVersion, seed }) => {
        const key = "par-arrows:campaign:v1";
        const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
        saved.currentLevelId = levelId;
        saved.unlockedLevelId = Math.max(
          saved.unlockedLevelId ?? levelId,
          levelId,
        );
        saved.state = {
          levelId,
          remainingIds: [arrowId],
          failedIds: [],
          lives,
          status: "playing",
          revision,
        };
        saved.tutorialComplete = true;
        saved.contentVersion = 6;
        saved.generatorVersion = generatorVersion;
        saved.seed = seed;
        localStorage.setItem(key, JSON.stringify(saved));
      },
      {
        levelId: movementLevel.id,
        arrowId: movementArrow.id,
        lives: movementLevel.lives,
        revision: movementLevel.arrows.length - 1,
        generatorVersion: GENERATOR_VERSION,
        seed: seedForLevel(movementLevel.id),
      },
    );
    await page.reload();
    await waitForReady(page);
    const initialImage = await sharp(await page.locator("canvas").screenshot())
      .raw()
      .toBuffer();
    const startingFace = movementArrow.path.at(-1)?.face;
    const destinationFace = simulateMove(
      movementLevel,
      {
        levelId: movementLevel.id,
        remainingIds: [movementArrow.id],
        failedIds: [],
        lives: movementLevel.lives,
        status: "playing",
        revision: movementLevel.arrows.length - 1,
      },
      movementArrow.id,
    ).route.at(-1)?.face;
    assert.notEqual(destinationFace, startingFace);
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id),
      movementArrow.id,
    );
    let currentFace: string | undefined = startingFace;
    for (
      let index = 0;
      index < 60 && currentFace === startingFace;
      index += 1
    ) {
      await page.evaluate(() => window.advanceTime?.(12));
      currentFace = JSON.parse(
        await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
      ).moving?.headFace;
    }
    assert.equal(
      currentFace,
      destinationFace,
      "Head must fold onto the next face",
    );
    const movingImage = await page.locator("canvas").screenshot();
    const movingPixels = await sharp(movingImage).raw().toBuffer();
    assert.notDeepEqual(
      movingPixels,
      initialImage,
      "Wrapped head motion must render",
    );
    await page.screenshot({ path: `${output}/wrapped-head-moving.png` });
    await page.evaluate(() => window.advanceTime?.(5000));
    await page.waitForFunction(
      (id) =>
        !JSON.parse(
          window.render_game_to_text?.() ?? "{}",
        ).remainingIds?.includes(id),
      movementArrow.id,
    );
    await loadLevel(page, 10);
    assert.equal(
      JSON.parse(
        await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
      ).wrappingEdges,
      0,
    );
    console.log(
      `PASS wrapped edges in light/dark/mobile (${initialYellowPixels}/${darkYellowPixels} yellow pixels), head fold, and non-wrapped cleanup`,
    );

    const reboundArrow = crossingArrow(fixtures.reboundLevelId, "blocked");
    await loadLevel(page, fixtures.reboundLevelId);
    const reboundYellowPixels = await yellowPixelCount(page);
    assert.ok(reboundYellowPixels > 10, "Wrapped seams must remain visible");
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id),
      reboundArrow.id,
    );
    await page.evaluate(() => window.advanceTime?.(5000));
    const reboundState = await page.evaluate(() =>
      JSON.parse(window.render_game_to_text?.() ?? "{}"),
    );
    assert.ok(reboundState.failedIds.includes(reboundArrow.id));
    assert.equal(
      reboundState.lives,
      generateLevel(fixtures.reboundLevelId).lives - 1,
    );
    await page.evaluate((id) => {
      window.__PAR_ARROWS_TEST__?.activate(id);
      window.advanceTime?.(5000);
    }, reboundArrow.id);
    assert.equal(
      JSON.parse(
        await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
      ).lives,
      reboundState.lives,
    );
    await page.locator('[data-action="retry"]').first().click();
    assert.equal((await yellowPixelCount(page)) > 10, true);
    await page.reload();
    await waitForReady(page);
    assert.equal(
      await page.evaluate(
        (id) =>
          JSON.parse(window.render_game_to_text?.() ?? "{}").level?.id === id,
        fixtures.reboundLevelId,
      ),
      true,
    );
    const reloadedYellowPixels = await yellowPixelCount(page);
    assert.ok(reloadedYellowPixels > 10, "Reload must restore wrapped seams");
    assert.deepEqual(errors, []);
    console.log(
      `PASS wrapped rebound, retry, and reload (${reboundYellowPixels}/${reloadedYellowPixels} yellow pixels)`,
    );
  } finally {
    await context.close();
  }
}
