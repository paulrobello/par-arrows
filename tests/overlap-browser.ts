import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import {
  GENERATOR_VERSION,
  generateLevel,
  seedForLevel,
} from "../src/content/procedural";
import { createGameState, simulateMove } from "../src/core/game-state";
import {
  cellToWorld,
  faceHeadingVector,
  faceNormal,
} from "../src/core/topology";
import type { Cell } from "../src/core/types";
import { arrowDimensions } from "../src/render/renderer";
import { waitForReady } from "./runtime-fixtures";

type Group = {
  name: string;
  ids: string[];
  branchCells: Cell[];
  sharedTail: readonly [Cell, Cell];
};

const pair: Group = {
  name: "pair",
  ids: ["overlap-intro-pair-a", "overlap-intro-pair-b"],
  branchCells: [
    { face: "front", x: 1, y: 0 },
    { face: "front", x: 1, y: 2 },
  ],
  sharedTail: [
    { face: "front", x: 0, y: 1 },
    { face: "front", x: 1, y: 1 },
  ],
};
const trio: Group = {
  name: "trio",
  ids: ["overlap-intro-trio-a", "overlap-intro-trio-b", "overlap-intro-trio-c"],
  branchCells: [
    { face: "left", x: 1, y: 0 },
    { face: "left", x: 1, y: 2 },
    { face: "left", x: 1.5, y: 1 },
  ],
  sharedTail: [
    { face: "left", x: 0, y: 1 },
    { face: "left", x: 1, y: 1 },
  ],
};
const blockerId = "overlap-intro-blocker";

interface State {
  mode: string;
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  moving: {
    arrowId: string;
    kind: string;
    elapsed: number;
    duration: number;
    members?: {
      arrowId: string;
      headPosition: [number, number, number];
      headFace: string;
    }[];
  } | null;
  hint: { arrowId: string; phase: string; lit: boolean } | null;
  camera: {
    orientation: [number, number, number, number];
    position: [number, number, number];
    cubeScreenBounds: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    };
  };
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
  overlappingGroups?: string[][];
}

async function state(page: Page): Promise<State> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as State;
}

async function loadOverlap(page: Page): Promise<void> {
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
    OVERLAP_INTRO_LEVEL.id,
  );
  assert.equal((await state(page)).level.id, OVERLAP_INTRO_LEVEL.id);
  assert.deepEqual(
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()),
    OVERLAP_INTRO_LEVEL,
  );
}

async function advance(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((amount) => window.advanceTime?.(amount), milliseconds);
}

async function finishMotion(page: Page): Promise<void> {
  const moving = (await state(page)).moving;
  if (moving)
    await advance(page, Math.max(0, moving.duration - moving.elapsed) + 32);
}

async function projectCell(
  page: Page,
  cell: Group["branchCells"][number],
  headOffset = 0,
): Promise<{ x: number; y: number }> {
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
  const projected = new Vector3(
    ...cellToWorld(cell, OVERLAP_INTRO_LEVEL.gridSize),
  )
    .addScaledVector(
      new Vector3(...faceHeadingVector(cell.face, "east")),
      headOffset,
    )
    .addScaledVector(new Vector3(...faceNormal(cell.face)), 0.01)
    .project(camera);
  return {
    x: bounds.x + ((projected.x + 1) * bounds.width) / 2,
    y: bounds.y + ((1 - projected.y) * bounds.height) / 2,
  };
}

async function clickAt(
  page: Page,
  point: { x: number; y: number },
  touch: boolean,
  space: "canvas" | "viewport",
): Promise<void> {
  let x = point.x;
  let y = point.y;
  if (space === "canvas") {
    const bounds = await page.locator("canvas").boundingBox();
    assert.ok(bounds);
    x += bounds.x;
    y += bounds.y;
  }
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function selectedPixelsNear(
  page: Page,
  cell: Group["branchCells"][number],
): Promise<number> {
  const point = await projectCell(page, cell);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  const image = await page.locator("canvas").screenshot();
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ratioX = info.width / bounds.width;
  const ratioY = info.height / bounds.height;
  const centerX = Math.round((point.x - bounds.x) * ratioX);
  const centerY = Math.round((point.y - bounds.y) * ratioY);
  let selected = 0;
  for (let y = centerY - 5; y <= centerY + 5; y += 1) {
    for (let x = centerX - 5; x <= centerX + 5; x += 1) {
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
      const offset = (y * info.width + x) * 4;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      if (blue > red * 1.35 && blue > green * 1.06) selected += 1;
    }
  }
  return selected;
}

async function activateAt(
  page: Page,
  group: Group,
  point: { x: number; y: number },
  touch: boolean,
  space: "canvas" | "viewport",
  expectedKind = "exit",
): Promise<void> {
  const before = await state(page);
  await clickAt(page, point, touch, space);
  const moving = (await state(page)).moving;
  assert.ok(moving, `${group.name} tap must start group movement`);
  assert.deepEqual(
    moving.members?.map((member) => member.arrowId).sort(),
    [...group.ids].sort(),
    `${group.name} activation must animate every linked arrow`,
  );
  assert.equal(moving.kind, expectedKind);
  if (before.moving) assert.fail("A group must start from an idle state");
}

async function activateHead(
  page: Page,
  group: Group,
  id: string,
  touch: boolean,
): Promise<void> {
  const point = await projectHead(page, id);
  await activateAt(page, group, point, touch, "viewport");
  assert.equal((await state(page)).moving?.arrowId, id);
}

async function projectHead(
  page: Page,
  id: string,
): Promise<{ x: number; y: number }> {
  const head = OVERLAP_INTRO_LEVEL.arrows
    .find((arrow) => arrow.id === id)
    ?.path.at(-1);
  assert.ok(head);
  const { headLength } = arrowDimensions(
    OVERLAP_INTRO_LEVEL.gridSize,
    OVERLAP_INTRO_LEVEL.arrowScale,
  );
  return projectCell(page, head, headLength / 3);
}

async function assertEveryGroupTarget(
  page: Page,
  group: Group,
  touch: boolean,
  output: string,
): Promise<void> {
  for (const id of group.ids) {
    await loadOverlap(page);
    await page.getByRole("button", { name: "Reset camera view" }).click();
    if (group === pair) {
      const blocker = (await state(page)).visibleProjectedArrowPositions.find(
        (entry) => entry.id === blockerId,
      );
      assert.ok(blocker);
      await clickAt(page, blocker, touch, "canvas");
      await finishMotion(page);
    }
    await activateHead(page, group, id, touch);
    await advance(page, 180);
    const moving = (await state(page)).moving;
    assert.ok(moving?.members && moving.members.length === group.ids.length);
    await page.screenshot({
      path: `${output}/overlap/${touch ? "mobile" : "desktop"}-${group.name}-head-${id}.png`,
    });
    await finishMotion(page);
    const settled = await state(page);
    assert.ok(
      group.ids.every((memberId) => !settled.remainingIds.includes(memberId)),
    );
  }

  for (const cell of group.branchCells) {
    await loadOverlap(page);
    await page.getByRole("button", { name: "Reset camera view" }).click();
    if (group === pair) {
      const blocker = (await state(page)).visibleProjectedArrowPositions.find(
        (entry) => entry.id === blockerId,
      );
      assert.ok(blocker);
      await clickAt(page, blocker, touch, "canvas");
      await finishMotion(page);
    }
    const point = await projectCell(page, cell);
    await activateAt(page, group, point, touch, "viewport");
    await finishMotion(page);
    const settled = await state(page);
    assert.ok(
      group.ids.every((memberId) => !settled.remainingIds.includes(memberId)),
    );
  }

  await loadOverlap(page);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  if (group === pair) {
    const blocker = (await state(page)).visibleProjectedArrowPositions.find(
      (entry) => entry.id === blockerId,
    );
    assert.ok(blocker);
    await clickAt(page, blocker, touch, "canvas");
    await finishMotion(page);
  }
  const camera = await state(page);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  const projection = new PerspectiveCamera(
    32,
    bounds.width / bounds.height,
    0.1,
    40,
  );
  projection.position.fromArray(camera.camera.position);
  projection.quaternion.fromArray(camera.camera.orientation);
  projection.updateMatrixWorld();
  const tailStart = new Vector3(
    ...cellToWorld(group.sharedTail[0], OVERLAP_INTRO_LEVEL.gridSize),
  );
  const tailEnd = new Vector3(
    ...cellToWorld(group.sharedTail[1], OVERLAP_INTRO_LEVEL.gridSize),
  );
  const midpoint = tailStart.add(tailEnd).multiplyScalar(0.5);
  midpoint
    .addScaledVector(new Vector3(...faceNormal(group.sharedTail[0].face)), 0.01)
    .project(projection);
  const tailPoint = {
    x: bounds.x + ((midpoint.x + 1) * bounds.width) / 2,
    y: bounds.y + ((1 - midpoint.y) * bounds.height) / 2,
  };
  await activateAt(page, group, tailPoint, touch, "viewport");
  await finishMotion(page);
  const tailSettled = await state(page);
  assert.ok(group.ids.every((id) => !tailSettled.remainingIds.includes(id)));
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const select = page.locator("#theme-select");
  if (await select.count()) {
    await page.evaluate((value) => {
      const element =
        document.querySelector<HTMLSelectElement>("#theme-select");
      if (element) {
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, theme);
  }
}

async function assertCampaignSave(
  browser: Browser,
  url: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const stateValue = createGameState(OVERLAP_INTRO_LEVEL);
  const previousLevel = generateLevel(OVERLAP_INTRO_LEVEL.id - 1);
  const previousState = createGameState(previousLevel);
  const lastArrow = previousLevel.arrows.find(
    (arrow) =>
      arrow.path.some((cell) => cell.face === "front") &&
      simulateMove(
        previousLevel,
        { ...previousState, remainingIds: [arrow.id] },
        arrow.id,
      ).kind === "exit",
  );
  assert.ok(lastArrow);
  const savedCampaign = JSON.stringify({
    currentLevelId: previousLevel.id,
    unlockedLevelId: previousLevel.id,
    tutorialComplete: true,
    contentVersion: 8,
    generatorVersion: GENERATOR_VERSION,
    seed: seedForLevel(previousLevel.id),
    state: {
      ...previousState,
      remainingIds: [lastArrow.id],
      revision: previousLevel.arrows.length - 1,
    },
  });
  await context.addInitScript((saved) => {
    if (!localStorage.getItem("par-arrows:campaign:v1")) {
      localStorage.setItem("par-arrows:campaign:v1", saved);
    }
  }, savedCampaign);
  const page = await context.newPage();
  try {
    await page.goto(url);
    await waitForReady(page);
    assert.equal((await state(page)).mode, "campaign");
    assert.equal((await state(page)).level.id, previousLevel.id);
    assert.deepEqual(
      (await state(page)).remainingIds,
      [lastArrow.id],
      "The level-14 save resumes exactly",
    );
    const lastPoint = (await state(page)).visibleProjectedArrowPositions.find(
      (entry) => entry.id === lastArrow.id,
    );
    assert.ok(lastPoint);
    await clickAt(page, lastPoint, false, "canvas");
    await finishMotion(page);
    await page.getByRole("button", { name: "Next Level", exact: true }).click();
    await waitForReady(page);
    assert.equal((await state(page)).level.id, OVERLAP_INTRO_LEVEL.id);
    assert.deepEqual((await state(page)).remainingIds, stateValue.remainingIds);

    const trioHead = (await state(page)).visibleProjectedArrowPositions.find(
      (entry) => entry.id === trio.ids[0],
    );
    assert.ok(trioHead);
    await activateAt(page, trio, trioHead, false, "canvas");
    await advance(page, 120);
    const movingTrio = await state(page);
    assert.ok(movingTrio.moving);
    const expectedAfterTrio = stateValue.remainingIds.filter(
      (id) => !trio.ids.includes(id),
    );
    const savedAfterTrio = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("par-arrows:campaign:v1") ?? "{}"),
    );
    assert.deepEqual(savedAfterTrio.state.remainingIds, expectedAfterTrio);
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).moving, null);
    assert.deepEqual((await state(page)).remainingIds, expectedAfterTrio);
    assert.equal((await state(page)).lives, stateValue.lives);

    const pairHead = (await state(page)).visibleProjectedArrowPositions.find(
      (entry) => entry.id === pair.ids[1],
    );
    assert.ok(pairHead);
    await activateAt(page, pair, pairHead, false, "canvas", "blocked");
    const blockedAttempt = (await state(page)).moving;
    assert.ok(blockedAttempt);
    await advance(page, Math.max(16, blockedAttempt.duration * 0.2));
    assert.ok((await state(page)).moving);
    const savedBlockedAttempt = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("par-arrows:campaign:v1") ?? "{}"),
    );
    assert.deepEqual(
      savedBlockedAttempt.state.failedIds
        .filter((id: string) => pair.ids.includes(id))
        .sort(),
      [...pair.ids].sort(),
    );
    assert.equal(savedBlockedAttempt.state.lives, stateValue.lives - 1);
    assert.deepEqual(savedBlockedAttempt.state.remainingIds, expectedAfterTrio);
    await page.reload();
    await waitForReady(page);
    assert.equal((await state(page)).moving, null);
    assert.deepEqual((await state(page)).remainingIds, expectedAfterTrio);
    const failed = await state(page);
    assert.deepEqual(
      failed.failedIds.filter((id) => pair.ids.includes(id)).sort(),
      [...pair.ids].sort(),
    );
    assert.equal(failed.lives, stateValue.lives - 1);
    const savedAfterFailure = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("par-arrows:campaign:v1") ?? "{}"),
    );
    assert.deepEqual(savedAfterFailure.state.remainingIds, expectedAfterTrio);
    assert.deepEqual(
      savedAfterFailure.state.failedIds
        .filter((id: string) => pair.ids.includes(id))
        .sort(),
      [...pair.ids].sort(),
    );
    assert.equal(savedAfterFailure.state.lives, stateValue.lives - 1);
    const failedMember = (
      await state(page)
    ).visibleProjectedArrowPositions.find((entry) => entry.id === pair.ids[0]);
    assert.ok(failedMember);
    await clickAt(page, failedMember, false, "canvas");
    await advance(page, 1000);
    assert.equal((await state(page)).lives, stateValue.lives - 1);
    await page.locator('[data-action="retry"]').click();
    assert.equal((await state(page)).lives, stateValue.lives);
    assert.deepEqual((await state(page)).failedIds, []);
  } finally {
    await context.close();
  }
}

export async function assertOverlapIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/overlap`, { recursive: true });
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
  const featureUrl = `${url}&feature=overlap`;
  try {
    await page.goto(featureUrl);
    await waitForReady(page);
    assert.equal(
      (await state(page)).level.id,
      OVERLAP_INTRO_LEVEL.id,
      "The public overlap selector opens its introduction",
    );
    await loadOverlap(page);
    const diagnostics = await state(page);
    assert.deepEqual(
      diagnostics.overlappingGroups?.map((ids) => [...ids].sort()).sort(),
      [[...pair.ids].sort(), [...trio.ids].sort()].sort(),
    );
    assert.equal(
      (await page.evaluate(() => window.__PAR_ARROWS_TEST__?.getLevel()))
        ?.arrows.length,
      OVERLAP_INTRO_LEVEL.arrows.length,
    );
    await page.screenshot({
      path: `${output}/overlap/intro-light-desktop.png`,
    });

    await setTheme(page, "dark");
    await page.screenshot({ path: `${output}/overlap/intro-dark-desktop.png` });
    await setTheme(page, "light");
    await assertEveryGroupTarget(page, pair, false, output);
    await assertEveryGroupTarget(page, trio, false, output);

    const blocker = (await state(page)).visibleProjectedArrowPositions.find(
      (entry) => entry.id === blockerId,
    );
    assert.ok(blocker);
    await clickAt(page, blocker, false, "canvas");
    await finishMotion(page);
    const afterBlockerExit = await state(page);
    assert.ok(!afterBlockerExit.remainingIds.includes(blockerId));

    const savedBeforeHint = await page.evaluate(() =>
      localStorage.getItem("par-arrows:campaign:v1"),
    );
    await page.getByRole("button", { name: "Hint", exact: true }).click();
    assert.equal((await state(page)).hint?.arrowId, pair.ids[0]);
    await advance(page, 600);
    const hinted = await state(page);
    assert.equal(hinted.hint?.phase, "flashing");
    assert.equal(hinted.hint?.lit, true);
    for (const branchCell of pair.branchCells) {
      assert.ok(
        (await selectedPixelsNear(page, branchCell)) > 0,
        "Both linked arrows must be highlighted during the same hint flash",
      );
    }
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      savedBeforeHint,
      "Showing a group hint must not change campaign progress",
    );
    await page.getByRole("button", { name: "Reset camera view" }).click();

    const refreshedPairHead = (
      await state(page)
    ).visibleProjectedArrowPositions.find((entry) => entry.id === pair.ids[1]);
    assert.ok(refreshedPairHead);
    await activateAt(page, pair, refreshedPairHead, false, "canvas");
    await advance(page, 220);
    const inFlight = await state(page);
    const reference = inFlight.moving?.members?.[0]?.headPosition;
    assert.ok(reference);
    await page.screenshot({
      path: `${output}/overlap/pair-moving-unblocked.png`,
    });
    await finishMotion(page);
    const clearedPair = await state(page);
    assert.ok(pair.ids.every((id) => !clearedPair.remainingIds.includes(id)));
    assert.ok(pair.ids.every((id) => !clearedPair.failedIds.includes(id)));

    await loadOverlap(page);
    await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-09-15T12:00:01Z"));
    const pairBHead = await projectHead(page, pair.ids[1] as string);
    const beforeBlock = await state(page);
    const originalHeadPoints = beforeBlock.visibleProjectedArrowPositions
      .filter((entry) => pair.ids.includes(entry.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const lives = beforeBlock.lives;
    await activateAt(page, pair, pairBHead, false, "viewport", "blocked");
    const blockedMoving = (await state(page)).moving;
    assert.ok(blockedMoving);
    assert.equal(
      blockedMoving.arrowId,
      pair.ids[1],
      "The unblocked member was tapped; its sibling causes the rewind",
    );
    assert.equal(blockedMoving?.kind, "blocked");
    assert.deepEqual(
      blockedMoving.members?.map((member) => member.arrowId).sort(),
      [...pair.ids].sort(),
    );
    const initialHeads = new Map(
      blockedMoving.members?.map((member) => [
        member.arrowId,
        member.headPosition,
      ]),
    );
    await advance(
      page,
      Math.max(0, blockedMoving.duration * 0.75 - blockedMoving.elapsed),
    );
    const returning = await state(page);
    assert.ok(returning.moving?.members);
    assert.ok(returning.moving.elapsed > returning.moving.duration / 2);
    const returnDistances: number[] = [];
    for (const member of returning.moving.members) {
      const initial = initialHeads.get(member.arrowId);
      assert.ok(initial);
      const distanceToStart = Math.hypot(
        ...member.headPosition.map(
          (value, index) => value - (initial[index] ?? 0),
        ),
      );
      returnDistances.push(distanceToStart);
      assert.ok(
        distanceToStart > 0 && distanceToStart < 0.25,
        "Every group head must reverse toward its original position at the shared blocker",
      );
    }
    assert.ok(
      Math.max(...returnDistances) - Math.min(...returnDistances) < 0.000001,
      "All heads rewind at the same speed",
    );
    await advance(page, 80);
    const failed = await state(page);
    assert.deepEqual(
      failed.failedIds.filter((id) => pair.ids.includes(id)).sort(),
      [...pair.ids].sort(),
    );
    assert.equal(
      failed.lives,
      lives - 1,
      "One group collision consumes one life",
    );
    assert.deepEqual(
      failed.visibleProjectedArrowPositions
        .filter((entry) => pair.ids.includes(entry.id))
        .sort((left, right) => left.id.localeCompare(right.id)),
      originalHeadPoints,
      "A collision restores both arrows to their original positions",
    );
    await page.screenshot({ path: `${output}/overlap/pair-blocked-red.png` });
    const redLives = failed.lives;
    const failedMember = failed.visibleProjectedArrowPositions.find(
      (entry) => entry.id === pair.ids[0],
    );
    assert.ok(failedMember);
    await clickAt(page, failedMember, false, "canvas");
    await advance(page, 1000);
    assert.equal(
      (await state(page)).lives,
      redLives,
      "Repeating the failed group is free",
    );
    await page.clock.resume();
    await page.locator('[data-action="retry"]').click();
    assert.equal((await state(page)).lives, OVERLAP_INTRO_LEVEL.lives);
    assert.deepEqual((await state(page)).failedIds, []);

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    const touchPage = await mobile.newPage();
    touchPage.on("pageerror", (error) => errors.push(error.message));
    touchPage.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await touchPage.goto(featureUrl);
    await waitForReady(touchPage);
    await loadOverlap(touchPage);
    await touchPage.screenshot({
      path: `${output}/overlap/intro-light-mobile.png`,
    });
    await setTheme(touchPage, "dark");
    await touchPage.screenshot({
      path: `${output}/overlap/intro-dark-mobile.png`,
    });
    await setTheme(touchPage, "light");
    await assertEveryGroupTarget(touchPage, trio, true, output);
    assert.deepEqual(
      errors,
      [],
      "Overlap browser verification must have no console or page errors",
    );
    await mobile.close();

    await loadOverlap(page);
    const finalBlocker = (
      await state(page)
    ).visibleProjectedArrowPositions.find((entry) => entry.id === blockerId);
    assert.ok(finalBlocker);
    await clickAt(page, finalBlocker, false, "canvas");
    await finishMotion(page);
    for (const group of [pair, trio]) {
      const point = (await state(page)).visibleProjectedArrowPositions.find(
        (entry) => entry.id === group.ids[0],
      );
      assert.ok(point);
      await activateAt(page, group, point, false, "canvas");
      await finishMotion(page);
    }
    await page.getByRole("button", { name: "Next Level", exact: true }).click();
    await waitForReady(page);
    assert.ok(
      (await state(page)).level.id === OVERLAP_INTRO_LEVEL.id + 1,
      "Completing linked intro groups advances to generated content",
    );
    await assertCampaignSave(browser, url);
    console.log(
      "PASS overlapping pair/trio head, body and shared-tail activation, mobile touch, atomic collision, save/retry and progression",
    );
  } finally {
    await context.close();
  }
}
