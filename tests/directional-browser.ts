import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { DIRECTIONAL_INTRO_LEVEL } from "../src/content/directional-intro";
import { cellKey } from "../src/core/topology";
import { waitForReady } from "./runtime-fixtures";

const EAST = "dir-intro-east";
const FREED = "dir-intro-freed";
const BLOCKER = "dir-intro-blocker";

interface DirectionalSpotText {
  cell: string;
  heading: string;
  kind: string;
  current: string;
}

interface State {
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  directionals: DirectionalSpotText[];
  moving: { kind: string; duration: number; elapsed: number } | null;
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

interface TutorialState {
  active: boolean;
  highlightId?: string;
  gate?: string[];
}

async function state(page: Page): Promise<State> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as State;
}

async function tutorialState(page: Page): Promise<TutorialState> {
  return (
    (await page.evaluate(() => window.get_tutorial_state?.())) ?? {
      active: false,
    }
  );
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

export async function assertDirectionalIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/directional`, { recursive: true });
  await assertScriptedWalkthrough(browser, url, output);
  await assertUnscriptedPlay(browser, url);
}

/**
 * First-run walkthrough: the script gates input to the highlighted arrow, the
 * chevron visibly bends it off the deadlock lane, and the freed arrows then
 * clear in sequence before free play finishes the cube.
 */
async function assertScriptedWalkthrough(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
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
    await page.goto(url);
    await waitForReady(page);
    // Walkthroughs run in campaign play only, so the scenario reaches cube 20
    // through the campaign loader rather than the preview selector.
    await page.evaluate(
      (levelId) => window.__PAR_ARROWS_TEST__?.loadLevel(levelId),
      DIRECTIONAL_INTRO_LEVEL.id,
    );
    await page.waitForFunction(
      (levelId) =>
        JSON.parse(window.render_game_to_text?.() ?? "{}")?.level?.id ===
        levelId,
      DIRECTIONAL_INTRO_LEVEL.id,
    );
    const opened = await state(page);
    assert.equal(
      opened.level.id,
      DIRECTIONAL_INTRO_LEVEL.id,
      "The campaign loader opens the directional introduction",
    );
    assert.deepEqual(opened.directionals, [
      {
        cell: cellKey({ face: "front", x: 2, y: 1 }),
        heading: "north",
        kind: "static",
        current: "north",
      },
    ]);
    const script = await tutorialState(page);
    assert.ok(script.active, "The walkthrough must run on first sight");
    assert.equal(script.highlightId, EAST);
    assert.deepEqual(script.gate, [EAST]);
    await page.screenshot({ path: `${output}/directional/01-intro.png` });

    // Input is gated: a non-highlighted arrow refuses the tap for free.
    await clickArrow(page, BLOCKER);
    let current = await state(page);
    assert.equal(current.lives, DIRECTIONAL_INTRO_LEVEL.lives);
    assert.deepEqual(current.failedIds, []);
    assert.equal(current.remainingIds.length, 6);

    // The chevron bends the east arrow north and off the cube.
    await clickArrow(page, EAST);
    current = await state(page);
    assert.equal(current.remainingIds.length, 5);
    assert.ok(
      !current.remainingIds.includes(EAST),
      "The bent arrow must leave the cube",
    );
    await page.screenshot({ path: `${output}/directional/02-bent.png` });
    assert.equal(
      (await tutorialState(page)).highlightId,
      FREED,
      "The walkthrough advances to the freed arrow",
    );

    await clickArrow(page, FREED);
    current = await state(page);
    assert.equal(current.remainingIds.length, 4);

    // Gating has ended once the scripted taps are consumed.
    await clickArrow(page, BLOCKER);
    current = await state(page);
    assert.equal(current.remainingIds.length, 3);

    // The remaining faces sit away from the default camera, so finish through
    // the attempt hook rather than screen clicks.
    for (const arrowId of [
      "dir-intro-back",
      "dir-intro-right",
      "dir-intro-top",
    ]) {
      await page.evaluate(
        (id) => window.__PAR_ARROWS_TEST__?.activate(id),
        arrowId,
      );
      await finishMotion(page);
    }
    current = await state(page);
    assert.deepEqual(
      current.remainingIds,
      [],
      "Free play clears the cube to a win",
    );
    assert.equal((await tutorialState(page)).active, false);
    await page.screenshot({ path: `${output}/directional/03-won.png` });
    assert.deepEqual(errors, [], "No page errors during the walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * With the walkthrough already seen, the cube plays plain: no gating, the
 * mechanic banner teaches the chevrons, and the bend still exits.
 */
async function assertUnscriptedPlay(
  browser: Browser,
  url: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  await context.addInitScript(
    (settings) => {
      if (!localStorage.getItem("par-arrows:settings:v1"))
        localStorage.setItem("par-arrows:settings:v1", settings);
    },
    JSON.stringify({
      gridLines: true,
      reducedMotion: false,
      theme: "light",
      tutorialSeenLevels: [DIRECTIONAL_INTRO_LEVEL.id],
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(`${url}&feature=directional`);
    await waitForReady(page);
    assert.equal((await state(page)).level.id, DIRECTIONAL_INTRO_LEVEL.id);
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A seen introduction must not replay its walkthrough",
    );
    assert.equal(await page.locator("#wrap-intro").isVisible(), true);
    const banner = await page.locator("#wrap-intro").textContent();
    assert.ok(
      banner?.includes("chevrons"),
      "The mechanic banner must teach the chevrons",
    );

    await clickArrow(page, EAST);
    const moved = await state(page);
    assert.ok(
      !moved.remainingIds.includes(EAST),
      "The chevron bends the east arrow out of the deadlock lane",
    );
    assert.equal(moved.lives, DIRECTIONAL_INTRO_LEVEL.lives);
    assert.deepEqual(errors, [], "No page errors during unscripted play");
  } finally {
    await context.close();
  }
}
