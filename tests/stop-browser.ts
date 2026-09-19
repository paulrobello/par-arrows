import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { STOP_INTRO_LEVEL } from "../src/content/stop-intro";
import { cellKey } from "../src/core/topology";
import { waitForReady } from "./runtime-fixtures";

const PARKER = "stop-intro-parker";
const FREED = "stop-intro-freed";
const BLOCKER = "stop-intro-blocker";

interface State {
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  stops: string[];
  parkedOffsets: Record<string, number>;
  moving: {
    arrowId: string;
    kind: string;
    duration: number;
    elapsed: number;
  } | null;
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

async function state(page: Page): Promise<State> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as State;
}

async function finishMotion(page: Page): Promise<void> {
  const moving = (await state(page)).moving;
  if (moving) {
    await page.evaluate(
      (amount) => window.advanceTime?.(amount),
      Math.max(0, moving.duration - moving.elapsed) + 32,
    );
  }
}

/** Click an arrow where the renderer currently projects it on screen. */
async function clickArrow(page: Page, arrowId: string): Promise<void> {
  const point = (await state(page)).visibleProjectedArrowPositions.find(
    (entry) => entry.id === arrowId,
  );
  assert.ok(point, `Arrow ${arrowId} must be visible to click`);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
  await finishMotion(page);
}

async function headPoint(page: Page, arrowId: string): Promise<number> {
  const point = (await state(page)).visibleProjectedArrowPositions.find(
    (entry) => entry.id === arrowId,
  );
  assert.ok(point, `Arrow ${arrowId} must be visible`);
  return point.x;
}

export async function assertStopIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/stop`, { recursive: true });
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
    await page.goto(`${url}&feature=stop`);
    await waitForReady(page);
    const opened = await state(page);
    assert.equal(
      opened.level.id,
      STOP_INTRO_LEVEL.id,
      "The public stop selector opens its introduction",
    );
    assert.deepEqual(
      opened.stops,
      (STOP_INTRO_LEVEL.stops ?? []).map(cellKey),
      "The introduction renders its authored stop circle",
    );
    assert.deepEqual(opened.parkedOffsets, {});
    await page.screenshot({ path: `${output}/stop/01-intro.png` });

    // The front face deadlocks: only the parker can move at all.
    const startX = await headPoint(page, PARKER);
    await clickArrow(page, FREED);
    let current = await state(page);
    assert.equal(current.lives, STOP_INTRO_LEVEL.lives - 1);
    assert.deepEqual(current.failedIds, [FREED]);
    assert.equal(current.remainingIds.length, 6);

    // Parking moves the arrow forward without costing a life.
    await clickArrow(page, PARKER);
    current = await state(page);
    assert.deepEqual(
      current.parkedOffsets,
      { [PARKER]: 1 },
      "Tapping an arrow onto a circle parks it there",
    );
    assert.equal(current.lives, STOP_INTRO_LEVEL.lives - 1);
    assert.equal(current.remainingIds.length, 6);
    const parkedX = await headPoint(page, PARKER);
    assert.ok(
      Math.abs(parkedX - startX) > 4,
      "A parked arrow is redrawn at its new position",
    );
    await page.screenshot({ path: `${output}/stop/02-parked.png` });

    // Driving on too early rebounds to the circle rather than to the start.
    await clickArrow(page, PARKER);
    current = await state(page);
    assert.equal(current.lives, STOP_INTRO_LEVEL.lives - 2);
    assert.ok(current.failedIds.includes(PARKER));
    assert.deepEqual(
      current.parkedOffsets,
      { [PARKER]: 1 },
      "A collision after a circle rebounds to the circle",
    );
    assert.equal(
      await headPoint(page, PARKER),
      parkedX,
      "The rebound leaves the arrow exactly on its circle",
    );

    // Repeat failures by the same red arrow stay free.
    await clickArrow(page, PARKER);
    assert.equal((await state(page)).lives, STOP_INTRO_LEVEL.lives - 2);

    // Retry returns a parked arrow to its authored start, drawn and logical.
    await page.locator('[data-action="retry"]').first().click();
    current = await state(page);
    assert.equal(current.lives, STOP_INTRO_LEVEL.lives);
    assert.deepEqual(current.failedIds, []);
    assert.deepEqual(
      current.parkedOffsets,
      {},
      "Retry clears every parked position",
    );
    assert.equal(
      await headPoint(page, PARKER),
      startX,
      "Retry redraws a parked arrow at its authored start",
    );

    // Park again to set up the deadlock resolution below.
    await clickArrow(page, PARKER);
    assert.deepEqual((await state(page)).parkedOffsets, { [PARKER]: 1 });

    // Parking cleared the lane, so the rest of the cube now comes apart.
    for (const arrowId of [FREED, BLOCKER, PARKER]) {
      await clickArrow(page, arrowId);
    }
    current = await state(page);
    assert.deepEqual(
      current.parkedOffsets,
      {},
      "Removing a parked arrow clears its offset",
    );
    assert.deepEqual(
      current.remainingIds.sort(),
      ["stop-intro-back", "stop-intro-right", "stop-intro-top"].sort(),
      "The front-face deadlock resolves once the parker has parked",
    );
    await page.screenshot({ path: `${output}/stop/03-cleared.png` });

    assert.deepEqual(errors, [], "Stop introduction must not log page errors");
  } finally {
    await context.close();
  }

  await assertParkedCampaignSave(browser, url);
  console.log(
    "PASS stop-circle parking, rebound-to-circle, free repeats, deadlock resolution and parked campaign reload",
  );
}

/**
 * Preview sessions never write saves, so the parked state is round-tripped
 * through a real campaign save instead.
 */
async function assertParkedCampaignSave(
  browser: Browser,
  url: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  // Cube 5's walkthrough is not under test in this parking-persistence
  // scenario; mark it seen so input gating never rejects the freed-arrow
  // taps checked after the reload.
  await context.addInitScript(
    (settings) => {
      if (!localStorage.getItem("par-arrows:settings:v1"))
        localStorage.setItem("par-arrows:settings:v1", settings);
    },
    JSON.stringify({
      gridLines: true,
      reducedMotion: false,
      theme: "light",
      tutorialSeenLevels: [5],
    }),
  );
  const page = await context.newPage();
  try {
    await page.goto(url);
    await waitForReady(page);
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
      STOP_INTRO_LEVEL.id,
    );
    assert.equal((await state(page)).level.id, STOP_INTRO_LEVEL.id);

    await clickArrow(page, PARKER);
    assert.deepEqual((await state(page)).parkedOffsets, { [PARKER]: 1 });

    await page.reload();
    await waitForReady(page);
    const restored = await state(page);
    assert.equal(restored.level.id, STOP_INTRO_LEVEL.id);
    assert.deepEqual(
      restored.parkedOffsets,
      { [PARKER]: 1 },
      "A campaign reload restores the parked position",
    );
    assert.equal(
      restored.remainingIds.length,
      STOP_INTRO_LEVEL.arrows.length,
      "A parked arrow is neither removed nor duplicated by a reload",
    );

    // The restored arrow is re-laid at its circle, so it is still tappable.
    await clickArrow(page, FREED);
    assert.ok(
      !(await state(page)).remainingIds.includes(FREED),
      "The lane a restored parked arrow opened is still clear",
    );
  } finally {
    await context.close();
  }
}
