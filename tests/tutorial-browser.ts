import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { waitForReady } from "./runtime-fixtures";

const CAMPAIGN_KEY = "par-arrows:campaign:v1";
const SETTINGS_KEY = "par-arrows:settings:v1";

interface TutorialState {
  active: boolean;
  levelId?: number;
  stepIndex?: number;
  copy?: string;
  highlightId?: string;
  gate?: string[];
}

interface State {
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  moving: { duration: number; elapsed: number } | null;
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
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

async function storageValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}

/**
 * The first-run walkthrough on level 1: rules first, a forced blocked click
 * that costs a life, then the guided clear of the whole cube.
 */
export async function assertFirstRunWalkthrough(
  page: Page,
  output: string,
): Promise<void> {
  const card = page.locator("#tutorial");
  assert.equal(
    await card.isVisible(),
    true,
    "First run must open with the tutorial card",
  );
  assert.equal(
    await page.locator("#tutorial-title").textContent(),
    "Find the open way.",
  );
  const opened = await tutorialState(page);
  assert.ok(
    opened.active && opened.levelId === 1 && opened.stepIndex === 0,
    "Level 1 must start its walkthrough at the first step",
  );
  assert.equal(opened.highlightId, "l1-front-blocked");
  assert.deepEqual(opened.gate, ["l1-front-blocked"]);
  assert.equal(await page.locator("#wrap-intro").isVisible(), false);
  await page.screenshot({ path: `${output}/tutorial-start.png` });

  // Input gating: a tap on a visible non-highlighted arrow is rejected
  // outright — no move, no life cost, no step advance.
  await clickArrow(page, "l1-front-blocker");
  const rejected = await state(page);
  assert.equal(rejected.lives, 5, "A gated-out tap must not cost a life");
  assert.deepEqual(rejected.failedIds, []);
  const rejectedStep = await tutorialState(page);
  assert.ok(rejectedStep.active && rejectedStep.stepIndex === 0);

  // The forced lesson: tapping the blocked arrow rebounds it, marks it red,
  // and costs exactly one life — and the impact flashes the lives chip and
  // the stage for a moment before settling.
  const blockedPoint = (await state(page)).visibleProjectedArrowPositions.find(
    (entry) => entry.id === "l1-front-blocked",
  );
  assert.ok(blockedPoint, "Blocked arrow must be visible to click");
  const blockedBounds = await page.locator("canvas").boundingBox();
  assert.ok(blockedBounds);
  await page.mouse.click(
    blockedBounds.x + blockedPoint.x,
    blockedBounds.y + blockedPoint.y,
  );
  const blockedMotion = (await state(page)).moving;
  assert.ok(blockedMotion, "The blocked click must start a motion");
  await page.evaluate(
    (amount) => window.advanceTime?.(amount),
    blockedMotion.duration / 2 + 33,
  );
  const flash = await page.evaluate(() => ({
    chip: document.querySelector(".lives")?.classList.contains("life-lost"),
    stage: document
      .querySelector("#game-stage")
      ?.classList.contains("life-lost"),
  }));
  assert.ok(
    flash.chip && flash.stage,
    "Losing a life must flash the lives chip and the stage",
  );
  await page.evaluate(() => window.advanceTime?.(1000));
  const flashAfter = await page.evaluate(() => ({
    chip: document.querySelector(".lives")?.classList.contains("life-lost"),
    stage: document
      .querySelector("#game-stage")
      ?.classList.contains("life-lost"),
  }));
  assert.ok(
    !flashAfter.chip && !flashAfter.stage,
    "The life-loss flash must expire on its own",
  );
  const afterCollision = await state(page);
  assert.equal(
    afterCollision.lives,
    4,
    "The forced blocked click must cost one life",
  );
  assert.deepEqual(afterCollision.failedIds, ["l1-front-blocked"]);
  const step1 = await tutorialState(page);
  assert.ok(step1.active && step1.stepIndex === 1);
  assert.equal(step1.highlightId, "l1-front-blocker");
  assert.deepEqual(step1.gate, ["l1-front-blocker"]);
  assert.equal(await card.isVisible(), true);
  await page.screenshot({ path: `${output}/tutorial-collision.png` });

  await clickArrow(page, "l1-front-blocker");
  const step2 = await tutorialState(page);
  assert.ok(step2.active && step2.stepIndex === 2);
  assert.equal(step2.highlightId, "l1-front-blocked");
  assert.deepEqual(step2.gate, ["l1-front-blocked"]);

  await clickArrow(page, "l1-front-blocked");
  const step3 = await tutorialState(page);
  assert.ok(step3.active && step3.stepIndex === 3);
  assert.equal(step3.highlightId, undefined);
  assert.equal(step3.gate, undefined);

  // The remaining arrows span the hidden faces, so clear them through the
  // scripted path the celebration suite uses instead of screen coordinates.
  for (const arrowId of [
    "l1-back",
    "l1-right",
    "l1-left",
    "l1-top",
    "l1-bottom",
  ]) {
    await page.evaluate((id) => {
      window.__PAR_ARROWS_TEST__?.activate(id);
      const moving = JSON.parse(window.render_game_to_text?.() ?? "{}").moving;
      if (moving)
        window.advanceTime?.(Math.max(0, moving.duration - moving.elapsed) + 1);
    }, arrowId);
  }
  const won = await state(page);
  assert.deepEqual(won.remainingIds, []);
  assert.equal(
    await page.locator("#state-card.is-won").isVisible(),
    true,
    "Clearing the cube must show the victory card",
  );
  const finished = await tutorialState(page);
  assert.equal(finished.active, false);
  const settings = await storageValue(page, SETTINGS_KEY);
  assert.ok(
    settings?.includes("[1]") ?? false,
    "Winning level 1 must record the walkthrough as seen",
  );
  const campaign = await storageValue(page, CAMPAIGN_KEY);
  assert.ok(
    campaign?.includes('"tutorialComplete":true') ?? false,
    "Winning level 1 must complete the campaign tutorial flag",
  );
  await page.screenshot({ path: `${output}/tutorial-complete.png` });

  await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(1));
  assert.equal(
    await card.isVisible(),
    false,
    "A seen walkthrough must not restart when the cube is replayed",
  );
  assert.equal((await tutorialState(page)).active, false);
}

const MECHANIC_INTROS: readonly {
  level: number;
  title: string;
  first: string;
  gate: string[];
}[] = [
  {
    level: 5,
    title: "Park it.",
    first: "stop-intro-parker",
    gate: ["stop-intro-parker"],
  },
  {
    level: 11,
    title: "Ride the yellow edge.",
    first: "wrap-intro-front",
    gate: ["wrap-intro-front"],
  },
  {
    level: 15,
    title: "Fly together.",
    first: "overlap-intro-blocker",
    gate: ["overlap-intro-blocker"],
  },
];

/**
 * Mechanic cubes 5, 11, and 15 each walk through their rule in a campaign
 * session. Preview sessions keep the ambient mechanic line and never write
 * storage, so the walkthrough is reached through the campaign loader instead.
 */
export async function assertTutorialFlow(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/tutorial`, { recursive: true });
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

    for (const intro of MECHANIC_INTROS) {
      await page.evaluate((levelId) => {
        return window.__PAR_ARROWS_TEST__?.loadLevel(levelId);
      }, intro.level);
      assert.equal((await state(page)).level.id, intro.level);
      assert.equal(
        await page.locator("#tutorial").isVisible(),
        true,
        `Cube ${intro.level} must show its walkthrough`,
      );
      assert.equal(
        await page.locator("#tutorial-title").textContent(),
        intro.title,
      );
      assert.equal(
        await page.locator("#wrap-intro").isVisible(),
        false,
        "The scripted card must replace the ambient mechanic line",
      );
      const before = await tutorialState(page);
      assert.ok(before.active && before.stepIndex === 0);
      assert.equal(before.highlightId, intro.first);
      assert.deepEqual(before.gate, intro.gate);
      await clickArrow(page, intro.first);
      const after = await tutorialState(page);
      assert.ok(
        after.active && after.stepIndex === 1,
        `The scripted first click must advance cube ${intro.level}'s walkthrough`,
      );
      await page.screenshot({
        path: `${output}/tutorial/mechanic-${intro.level}.png`,
      });
    }

    // Level 15's group step gates the whole pair: either member launches,
    // and once it clears, the trio step leaves the rest of the cube ungated.
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(15));
    assert.equal((await state(page)).level.id, 15);
    await clickArrow(page, "overlap-intro-blocker");
    const groupStep = await tutorialState(page);
    assert.ok(groupStep.active && groupStep.stepIndex === 1);
    assert.deepEqual(groupStep.gate, [
      "overlap-intro-pair-a",
      "overlap-intro-pair-b",
    ]);

    // Park the camera so the left face faces away: the trio step's highlight
    // then sits on a hidden face, and reaching that step must rotate the cube
    // to show it instead of instructing a tap on an invisible arrow.
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.orbit(-84, 0));
    const parkedIds = (await state(page)).visibleProjectedArrowPositions.map(
      (entry) => entry.id,
    );
    assert.ok(
      parkedIds.includes("overlap-intro-pair-b"),
      "The front face must stay visible after parking the camera",
    );
    assert.ok(
      !parkedIds.some((id) => id.startsWith("overlap-intro-trio")),
      "The left-face trio must be hidden before the trio step",
    );
    await clickArrow(page, "overlap-intro-pair-b");
    const freePlay = await tutorialState(page);
    assert.ok(freePlay.active && freePlay.stepIndex === 2);
    assert.equal(freePlay.gate, undefined);
    await page.evaluate((amount) => window.advanceTime?.(amount), 900);
    const trioStepIds = (await state(page)).visibleProjectedArrowPositions.map(
      (entry) => entry.id,
    );
    assert.ok(
      trioStepIds.includes("overlap-intro-trio-a"),
      "The trio step must rotate the cube so its highlighted arrow is visible",
    );

    // Steps were taken but no scripted cube was won, so nothing is recorded
    // as seen yet; the level 1 walkthrough above pins the on-win write.
    const settings = await storageValue(page, SETTINGS_KEY);
    assert.deepEqual(JSON.parse(settings ?? "null"), null);
    assert.deepEqual(errors, [], "Tutorial flow must run without page errors");
  } finally {
    await context.close();
  }
}
