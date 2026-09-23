import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import { cellToWorld } from "../src/core/topology";
import { waitForReady } from "./runtime-fixtures";

const CHOICE = "double-intro-choice";
const BLOCKER = "double-intro-blocker";
const CAMPAIGN_KEY = "par-arrows:campaign:v1";

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  lives: number;
  remainingIds: string[];
  selectedArrowId?: string;
  selectedEndpoint?: "head" | "tail";
  settledPaths: Record<string, unknown[]>;
  failedPositions: string[];
  camera: {
    position: [number, number, number];
    orientation: [number, number, number, number];
  };
  moving: { duration: number; elapsed: number } | null;
}

async function state(page: Page): Promise<State> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw);
  return JSON.parse(raw) as State;
}

async function finishMotion(page: Page): Promise<void> {
  const motion = (await state(page)).moving;
  if (!motion) return;
  await page.evaluate(
    (milliseconds) => window.advanceTime?.(milliseconds),
    Math.max(0, motion.duration - motion.elapsed) + 32,
  );
}

async function activate(
  page: Page,
  arrowId: string,
  endpoint: "head" | "tail" = "head",
): Promise<void> {
  await page.evaluate(
    ({ arrowId, endpoint }) =>
      window.__PAR_ARROWS_TEST__?.activate(arrowId, endpoint),
    { arrowId, endpoint },
  );
  await finishMotion(page);
}

async function pressCell(
  page: Page,
  cell: { face: "front"; x: number; y: number },
): Promise<State> {
  const current = await state(page);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  const camera = new PerspectiveCamera(
    32,
    bounds.width / bounds.height,
    0.1,
    40,
  );
  camera.position.fromArray(current.camera.position);
  camera.quaternion.fromArray(current.camera.orientation);
  camera.updateMatrixWorld();
  const [x, y, z] = cellToWorld(cell, 4);
  const point = new Vector3(x, y, z).project(camera);
  const clientX = bounds.x + ((point.x + 1) * bounds.width) / 2;
  const clientY = bounds.y + ((1 - point.y) * bounds.height) / 2;
  await page.mouse.move(clientX, clientY);
  await page.mouse.down();
  const pressed = await state(page);
  await page.mouse.move(clientX + 30, clientY + 30);
  await page.mouse.up();
  return pressed;
}

async function colorCounts(
  page: Page,
): Promise<{ violet: number; lime: number }> {
  const image = await page.screenshot();
  const { data } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let violet = 0;
  let lime = 0;
  for (let index = 0; index < data.length; index += 3) {
    const red = data[index] ?? 0;
    const green = data[index + 1] ?? 0;
    const blue = data[index + 2] ?? 0;
    if (blue > red * 1.15 && blue > green * 1.25) violet += 1;
    if (green > red * 1.1 && green > blue * 1.15) lime += 1;
  }
  return { violet, lime };
}

export async function assertDoubleIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/double`, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(`${url}&feature=double`);
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, 25);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), CAMPAIGN_KEY),
      null,
      "Double preview must not create campaign state",
    );
    await page.screenshot({ path: `${output}/double/preview.png` });
    const colors = await colorCounts(page);
    assert.ok(colors.violet > 10, "The violet half must render");
    assert.ok(colors.lime > 10, "The lime half must render");
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("#theme-select");
      if (!select) throw new Error("Theme selector missing");
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const darkColors = await colorCounts(page);
    assert.ok(
      darkColors.violet > 10,
      "The violet half must render in dark mode",
    );
    assert.ok(darkColors.lime > 10, "The lime half must render in dark mode");

    await page.goto(`${url}`);
    await waitForReady(page);
    await page.evaluate((id) => window.__PAR_ARROWS_TEST__?.loadLevel(id), 25);
    await page.waitForFunction(
      (id) =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").level?.id === id,
      25,
    );
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.remainingIds.length, DOUBLE_INTRO_LEVEL.arrows.length);
    await activate(page, CHOICE, "head");
    current = await state(page);
    assert.equal(
      current.remainingIds.length,
      DOUBLE_INTRO_LEVEL.arrows.length,
      "The scripted walkthrough rejects the wrong endpoint",
    );
    assert.equal(current.lives, DOUBLE_INTRO_LEVEL.lives);

    await activate(page, CHOICE, "tail");
    current = await state(page);
    assert.ok(!current.remainingIds.includes(CHOICE));
    const tutorial = await page.evaluate(() => window.get_tutorial_state?.());
    assert.equal(
      tutorial?.active && tutorial.highlightId,
      BLOCKER,
      "Tail activation advances the endpoint-specific walkthrough",
    );

    await activate(page, BLOCKER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(BLOCKER));
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).level.id, 25);

    await page.evaluate(() => {
      localStorage.setItem(
        "par-arrows:settings:v1",
        JSON.stringify({
          gridLines: true,
          reducedMotion: false,
          theme: "light",
          tutorialSeenLevels: [25],
        }),
      );
    });
    await page.reload();
    await waitForReady(page);
    await page.evaluate((id) => window.__PAR_ARROWS_TEST__?.loadLevel(id), 25);
    await page.waitForFunction(
      (id) =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").level?.id === id,
      25,
    );
    await page.locator('[data-action="retry"]').first().click();
    const headPress = await pressCell(page, { face: "front", x: 2, y: 1 });
    assert.equal(headPress.selectedArrowId, CHOICE);
    assert.equal(headPress.selectedEndpoint, "head");
    const tailPress = await pressCell(page, { face: "front", x: 1, y: 1 });
    assert.equal(tailPress.selectedArrowId, CHOICE);
    assert.equal(tailPress.selectedEndpoint, "tail");
    const midpointPress = await pressCell(page, {
      face: "front",
      x: 1.5,
      y: 1,
    } as { face: "front"; x: number; y: number });
    assert.equal(midpointPress.selectedArrowId, CHOICE);
    assert.ok(["head", "tail"].includes(midpointPress.selectedEndpoint ?? ""));
    const beforeFailure = await state(page);
    await activate(page, CHOICE, "head");
    const failed = await state(page);
    assert.equal(failed.lives, beforeFailure.lives - 1);
    assert.equal(failed.failedPositions.length, 1);
    await activate(page, CHOICE, "head");
    assert.equal((await state(page)).lives, failed.lives);
    await activate(page, CHOICE, "tail");
    const exited = await state(page);
    assert.ok(!exited.remainingIds.includes(CHOICE));
    assert.equal(exited.failedPositions.length, 1);
    await page.reload();
    await waitForReady(page);
    const restored = await state(page);
    assert.equal(restored.lives, exited.lives);
    assert.equal(restored.failedPositions.length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
