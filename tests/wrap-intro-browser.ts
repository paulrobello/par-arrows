import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { WRAP_INTRO_LEVEL } from "../src/content/intro";
import {
  GENERATOR_VERSION,
  generateLevel,
  seedForLevel,
} from "../src/content/procedural";
import { createGameState, simulateMove } from "../src/core/game-state";
import { waitForReady } from "./runtime-fixtures";

async function state(page: Page) {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw);
  return JSON.parse(raw) as {
    level: { id: number };
    lives: number;
    remainingIds: string[];
    failedIds: string[];
    visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
    moving: { headFace?: string; duration: number; elapsed: number } | null;
    camera: {
      cubeScreenBounds: {
        left: number;
        right: number;
        top: number;
        bottom: number;
      };
    };
  };
}

async function finishMotion(page: Page): Promise<void> {
  const moving = (await state(page)).moving;
  if (moving)
    await page.evaluate(
      (amount) => window.advanceTime?.(amount),
      Math.max(0, moving.duration - moving.elapsed) + 16,
    );
}

async function clickArrow(page: Page, id: string): Promise<void> {
  const point = (await state(page)).visibleProjectedArrowPositions.find(
    (candidate) => candidate.id === id,
  );
  assert.ok(point, `Arrow ${id} must be visible for a mouse click`);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
}

async function yellowPixelCount(page: Page): Promise<number> {
  const image = await page.locator("canvas").screenshot();
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    if (red > 90 && green > 55 && red > green * 1.18 && green > blue * 1.35)
      count += 1;
  }
  assert.ok(info.width > 0);
  return count;
}

export async function assertWrapIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const levelTen = generateLevel(10);
  assert.equal(levelTen.arrows.length, 180);
  const lastArrow = levelTen.arrows.find(
    (arrow) =>
      simulateMove(
        levelTen,
        {
          ...createGameState(levelTen),
          remainingIds: [arrow.id],
          lives: 3,
          revision: 179,
        },
        arrow.id,
      ).kind === "exit",
  );
  assert.ok(lastArrow);
  await context.addInitScript(
    (saved) => {
      if (!localStorage.getItem("par-arrows:campaign:v1"))
        localStorage.setItem("par-arrows:campaign:v1", saved);
    },
    JSON.stringify({
      currentLevelId: 10,
      unlockedLevelId: 10,
      tutorialComplete: true,
      contentVersion: 11,
      generatorVersion: GENERATOR_VERSION,
      seed: seedForLevel(10),
      state: {
        levelId: 10,
        remainingIds: [lastArrow.id],
        failedIds: [],
        lives: 3,
        status: "playing",
        revision: 179,
      },
    }),
  );
  // Cube 11's walkthrough is already seen in this scenario, so the module
  // exercises the ambient mechanic line a replaying player gets.
  await context.addInitScript(
    (settings) => {
      if (!localStorage.getItem("par-arrows:settings:v1"))
        localStorage.setItem("par-arrows:settings:v1", settings);
    },
    JSON.stringify({
      gridLines: false,
      reducedMotion: false,
      theme: "light",
      tutorialSeenLevels: [11],
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 10);
    assert.deepEqual((await state(page)).remainingIds, [lastArrow.id]);
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id),
      lastArrow.id,
    );
    await finishMotion(page);
    assert.equal(
      await page.locator(".state-card.is-won").isVisible(),
      true,
      "The campaign must show the level 10 win before progression",
    );
    await page.getByRole("button", { name: "Next Level", exact: true }).click();
    await waitForReady(page);

    const intro = await state(page);
    assert.equal(intro.level.id, 11);
    assert.equal(
      (await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()))
        ?.arrows.length,
      6,
    );
    const introDefinition = await page.evaluate(() =>
      window.__PAR_ARROWS_TEST__?.getLevel(),
    );
    assert.ok(introDefinition);
    assert.equal(introDefinition.edgePolicies?.length, 2);
    assert.deepEqual(
      await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
      WRAP_INTRO_LEVEL,
    );
    const instruction = page.locator("#wrap-intro");
    assert.equal(await instruction.isVisible(), true);
    assert.equal(
      await instruction.textContent(),
      "Yellow edges carry arrows onto the next face. Try an arrow pointing toward the yellow line.",
    );
    assert.ok((await yellowPixelCount(page)) > 10);
    await page.screenshot({ path: `${output}/wrap-intro-light.png` });
    await page.setViewportSize({ width: 1100, height: 600 });
    const instructionBounds = await instruction.boundingBox();
    const canvasBounds = await page.locator("canvas").boundingBox();
    assert.ok(instructionBounds && canvasBounds);
    const cube = (await state(page)).camera.cubeScreenBounds;
    assert.ok(
      instructionBounds.x + instructionBounds.width <=
        canvasBounds.x + cube.left ||
        instructionBounds.x >= canvasBounds.x + cube.right ||
        instructionBounds.y + instructionBounds.height <=
          canvasBounds.y + cube.top ||
        instructionBounds.y >= canvasBounds.y + cube.bottom,
      "The introduction must not cover the cube at short desktop heights",
    );
    await page.screenshot({ path: `${output}/wrap-intro-short-landscape.png` });
    await page.setViewportSize({ width: 1100, height: 760 });

    await page.evaluate((id) => {
      window.__PAR_ARROWS_TEST__?.activate(id);
      window.advanceTime?.(5000);
    }, "wrap-intro-back");
    assert.equal((await state(page)).remainingIds.length, 5);
    await page.reload();
    await waitForReady(page);
    assert.deepEqual((await state(page)).remainingIds, [
      "wrap-intro-front",
      "wrap-intro-left",
      "wrap-intro-right",
      "wrap-intro-top",
      "wrap-intro-bottom",
    ]);
    assert.equal(await instruction.isVisible(), true);
    await page.locator('[data-action="retry"]').click();
    assert.deepEqual((await state(page)).remainingIds, [
      "wrap-intro-front",
      "wrap-intro-left",
      "wrap-intro-back",
      "wrap-intro-right",
      "wrap-intro-top",
      "wrap-intro-bottom",
    ]);
    assert.equal((await state(page)).lives, 5);

    await clickArrow(page, "wrap-intro-front");
    for (let step = 0; step < 100; step += 1) {
      const moving = (await state(page)).moving;
      if (!moving || moving.headFace === "left") break;
      await page.evaluate(() => window.advanceTime?.(20));
    }
    const crossed = await state(page);
    assert.equal(crossed.moving?.headFace, "left");
    assert.ok(
      crossed.remainingIds.includes("wrap-intro-front"),
      "The arrow should still be moving after reaching the left face",
    );
    assert.equal(crossed.lives, 5);
    await page.screenshot({ path: `${output}/wrap-intro-crossing.png` });
    await finishMotion(page);
    assert.equal((await state(page)).lives, 5);

    const remaining = (await state(page)).remainingIds;
    await page.evaluate((ids) => {
      for (const id of ids) {
        window.__PAR_ARROWS_TEST__?.activate(id);
        const moving = JSON.parse(
          window.render_game_to_text?.() ?? "{}",
        ).moving;
        if (moving) window.advanceTime?.(moving.duration - moving.elapsed + 16);
      }
    }, remaining);
    assert.equal((await state(page)).remainingIds.length, 0);
    assert.equal(await instruction.isVisible(), false);
    await page.getByRole("button", { name: "Next Level", exact: true }).click();
    await waitForReady(page);
    const levelTwelve = await state(page);
    assert.equal(levelTwelve.level.id, 12);
    const generatedTwelve = await page.evaluate(() =>
      window.__PAR_ARROWS_TEST__?.getLevel(),
    );
    assert.ok(generatedTwelve);
    assert.ok(generatedTwelve.arrows.length > WRAP_INTRO_LEVEL.arrows.length);
    assert.equal(await instruction.isVisible(), false);

    await page.evaluate(() => {
      localStorage.setItem(
        "par-arrows:campaign:v1",
        JSON.stringify({
          contentVersion: 6,
          generatorVersion: 2,
          seed: "par-arrows:runtime:2:level:11",
          currentLevelId: 11,
          unlockedLevelId: 27,
          tutorialComplete: true,
          state: {
            levelId: 11,
            remainingIds: ["r11-wrap-0"],
            failedIds: [],
            lives: 3,
            status: "playing",
            revision: 179,
          },
        }),
      );
    });
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 11);
    assert.equal((await state(page)).remainingIds.length, 6);
    assert.equal((await state(page)).lives, 5);
    assert.equal(await page.locator("#level-input").getAttribute("max"), "27");
    assert.equal(await instruction.isVisible(), true);
    const refreshedSave = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("par-arrows:campaign:v1") ?? "{}"),
    );
    assert.equal(
      refreshedSave.seed,
      "par-arrows:runtime:2:level:11:wrap-intro:1",
    );
    assert.equal(refreshedSave.tutorialComplete, true);

    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => {
        const select =
          document.querySelector<HTMLSelectElement>("#theme-select");
        if (!select) throw new Error("Theme selector missing");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, theme);
      await page.evaluate(
        (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
        11,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await instruction.isVisible(), true);
      assert.ok((await yellowPixelCount(page)) > 5);
      await page.screenshot({
        path: `${output}/wrap-intro-${theme}-mobile.png`,
      });
      await page.setViewportSize({ width: 1100, height: 760 });
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS level 10 progression, wrap intro instruction and seam, mouse crossing, partial-save retry, level 12 progression, old-layout migration, and mobile themes",
    );
  } finally {
    await context.close();
  }
}
