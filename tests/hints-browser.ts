import assert from "node:assert/strict";
import type { Page } from "playwright";
import { PerspectiveCamera, Vector3 } from "three";
import { LEVELS } from "../src/content/levels";
import { createGameState, simulateMove } from "../src/core/game-state";
import {
  cellToWorld,
  faceHeadingVector,
  faceNormal,
  headingForPath,
} from "../src/core/topology";
import type { GameState, LevelDefinition } from "../src/core/types";
import { arrowDimensions } from "../src/render/renderer";

interface HintSnapshot {
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  moving: { arrowId: string } | null;
  hint: {
    arrowId: string;
    phase: "rotating" | "flashing";
    elapsed: number;
    lit: boolean;
  } | null;
  camera: {
    position: [number, number, number];
    orientation: [number, number, number, number];
    distance: number;
  };
}

async function snapshot(page: Page): Promise<HintSnapshot> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw);
  return JSON.parse(raw) as HintSnapshot;
}

async function advance(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((ms) => window.advanceTime?.(ms), milliseconds);
}

function logical(state: HintSnapshot): unknown {
  return {
    level: state.level,
    lives: state.lives,
    remainingIds: state.remainingIds,
    failedIds: state.failedIds,
  };
}

async function headPosition(
  page: Page,
  level: LevelDefinition,
  arrowId: string,
) {
  const state = await snapshot(page);
  const arrow = level.arrows.find((candidate) => candidate.id === arrowId);
  const head = arrow?.path.at(-1);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(arrow && head && bounds);
  const normal = new Vector3(...faceNormal(head.face));
  const point = new Vector3(...cellToWorld(head, level.gridSize));
  const heading = headingForPath(arrow.path, level.gridSize);
  assert.ok(heading);
  point
    .addScaledVector(normal, 0.005)
    .addScaledVector(
      new Vector3(...faceHeadingVector(head.face, heading)),
      arrowDimensions(level.gridSize, level.arrowScale).headLength * 0.5,
    );
  const facing =
    normal.dot(new Vector3(...state.camera.position).sub(point)) > 0.04;
  const camera = new PerspectiveCamera(
    32,
    bounds.width / bounds.height,
    0.1,
    40,
  );
  camera.position.fromArray(state.camera.position);
  camera.quaternion.fromArray(state.camera.orientation);
  camera.updateMatrixWorld();
  const projected = point.project(camera);
  return {
    visible: facing && projected.z > -1 && projected.z < 1,
    x: bounds.x + ((projected.x + 1) * bounds.width) / 2,
    y: bounds.y + ((1 - projected.y) * bounds.height) / 2,
    bounds,
  };
}

async function assertHeadExposed(
  page: Page,
  level: LevelDefinition,
  arrowId: string,
) {
  const point = await headPosition(page, level, arrowId);
  assert.equal(
    point.visible,
    true,
    "Hint must expose the arrow head, including wrapped arrows",
  );
  assert.ok(
    point.x > point.bounds.x + 15 &&
      point.x < point.bounds.x + point.bounds.width - 15,
  );
  assert.ok(
    point.y > point.bounds.y + 70 &&
      point.y < point.bounds.y + point.bounds.height - 85,
  );
  return point;
}

export async function runHintChecks(
  page: Page,
  output: string,
  mobile = false,
): Promise<void> {
  const level = LEVELS.find((candidate) => candidate.id === (mobile ? 2 : 10));
  assert.ok(level);
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
    level.id,
  );
  const before = await snapshot(page);
  const savedBefore = await page.evaluate(() =>
    localStorage.getItem("par-arrows:campaign:v1"),
  );
  const safe = level.arrows.find(
    (arrow) =>
      simulateMove(level, createGameState(level), arrow.id).kind === "exit",
  );
  assert.ok(safe);
  const button = page.getByRole("button", { name: "Hint", exact: true });
  await button.click();
  assert.equal((await snapshot(page)).hint?.arrowId, safe.id);
  await advance(page, 700);
  await assertHeadExposed(page, level, safe.id);

  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2 + 260,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.equal(
    (await snapshot(page)).hint,
    null,
    "Manual rotation cancels the hint",
  );
  assert.equal((await headPosition(page, level, safe.id)).visible, false);
  if (!mobile) {
    const distance = (await snapshot(page)).camera.distance;
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction((prior) => {
      const raw = window.render_game_to_text?.();
      return raw && JSON.parse(raw).camera.distance < prior;
    }, distance);
  }
  await button.click();
  assert.equal((await snapshot(page)).hint?.phase, "rotating");
  assert.equal((await snapshot(page)).hint?.lit, false);
  assert.equal(await button.isDisabled(), true);
  await advance(page, 200);
  assert.equal(
    (await snapshot(page)).hint?.lit,
    false,
    "No flashing during camera travel",
  );
  await advance(page, 500);
  const revealed = await snapshot(page);
  assert.equal(revealed.hint?.phase, "flashing");
  await assertHeadExposed(page, level, safe.id);
  assert.deepEqual(logical(revealed), logical(before));
  await page.screenshot({
    path: `${output}/hint-${mobile ? "mobile" : "desktop"}.png`,
  });
  const phases: boolean[] = [];
  for (let index = 0; index < 7; index += 1) {
    phases.push((await snapshot(page)).hint?.lit ?? false);
    await advance(page, 250);
  }
  assert.ok(
    phases.includes(true) && phases.includes(false),
    "The revealed arrow visibly pulses",
  );
  await advance(page, 1500);
  assert.equal((await snapshot(page)).hint, null);
  assert.equal(await button.isDisabled(), false);
  assert.deepEqual(logical(await snapshot(page)), logical(before));
  assert.equal(
    await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
    savedBefore,
  );

  await button.click();
  await page.getByRole("button", { name: "Reset camera view" }).click();
  assert.equal((await snapshot(page)).hint, null);
  await button.click();
  await page.locator('[data-action="retry"]').first().click();
  assert.equal((await snapshot(page)).hint, null);
  await button.click();
  await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(2));
  assert.equal((await snapshot(page)).hint, null);

  for (const event of ["pointercancel", "lostpointercapture"]) {
    await button.click();
    await page.locator("canvas").dispatchEvent(event);
    assert.equal((await snapshot(page)).hint, null);
  }
  if (!mobile) {
    await button.click();
    await page.mouse.wheel(0, 60);
    await page.waitForFunction(() => {
      const raw = window.render_game_to_text?.();
      return raw && JSON.parse(raw).hint === null;
    });
  } else if (page.context().browser()?.browserType().name() === "chromium") {
    await button.click();
    const client = await page.context().newCDPSession(page);
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 24, y, id: 0 },
        { x: x + 24, y, id: 1 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 50, y, id: 0 },
        { x: x + 50, y, id: 1 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForFunction(() => {
      const raw = window.render_game_to_text?.();
      return raw && JSON.parse(raw).hint === null;
    });
    await client.detach();
  }

  const wrappedLevel = LEVELS[1];
  const wrapped = wrappedLevel?.arrows.find(
    (arrow) => new Set(arrow.path.map((cell) => cell.face)).size > 1,
  );
  assert.ok(wrappedLevel && wrapped);
  const removable = wrappedLevel.arrows.find(
    (arrow) =>
      simulateMove(wrappedLevel, createGameState(wrappedLevel), arrow.id)
        .kind === "exit",
  );
  assert.ok(removable);
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.activate(id),
    removable.id,
  );
  await advance(page, 1000);
  const fixture: GameState = {
    ...createGameState(wrappedLevel),
    remainingIds: [wrapped.id],
    failedIds: [wrapped.id],
    lives: wrappedLevel.lives - 1,
    revision: wrappedLevel.arrows.length,
  };
  await page.evaluate((state) => {
    const key = "par-arrows:campaign:v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(
      key,
      JSON.stringify({ ...saved, currentLevelId: state.levelId, state }),
    );
  }, fixture);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__PAR_ARROWS_TEST__));
  await page.locator("#settings-button").click();
  await page.getByLabel("Reduce movement").check();
  await page.locator("#settings-button").click();
  await button.click();
  await advance(page, 20);
  assert.equal((await snapshot(page)).hint?.phase, "flashing");
  assert.equal((await snapshot(page)).hint?.lit, true);
  await assertHeadExposed(page, wrappedLevel, wrapped.id);
  await advance(page, 900);
  assert.equal(
    (await snapshot(page)).hint?.lit,
    true,
    "Reduced motion uses steady emphasis",
  );
  await page.locator("#settings-button").click();
  await page.locator("#theme-select").selectOption("dark");
  await page.locator("#settings-button").click();
  assert.equal((await snapshot(page)).hint?.arrowId, wrapped.id);
  await page.screenshot({
    path: `${output}/hint-${mobile ? "mobile" : "desktop"}-wrapped-dark.png`,
  });
  await advance(page, 3000);
  assert.deepEqual((await snapshot(page)).failedIds, [wrapped.id]);
  await page.locator("#settings-button").click();
  await page.getByLabel("Reduce movement").uncheck();
  await page.locator("#settings-button").click();
  await button.click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => {
    const raw = window.render_game_to_text?.();
    return raw && JSON.parse(raw).hint?.lit === true;
  });
  await advance(page, 30);
  assert.equal((await snapshot(page)).hint?.lit, true);
  const target = await assertHeadExposed(page, wrappedLevel, wrapped.id);
  if (mobile) await page.touchscreen.tap(target.x, target.y);
  else await page.mouse.click(target.x, target.y);
  assert.equal((await snapshot(page)).hint, null);
  assert.equal((await snapshot(page)).moving?.arrowId, wrapped.id);
  assert.equal(await button.isDisabled(), true);
  await advance(page, 1000);
  assert.deepEqual((await snapshot(page)).remainingIds, []);
  assert.equal((await snapshot(page)).lives, fixture.lives);
  assert.equal(await button.isDisabled(), true, "No hints on completed levels");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => window.__PAR_ARROWS_TEST__?.loadLevel(3));
  await page.locator("#settings-button").click();
  await page.locator("#theme-select").selectOption("system");
  await page.locator("#settings-button").click();
  if (mobile) {
    await page.setViewportSize({ width: 320, height: 720 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${output}/hint-mobile-320.png` });
    await page.setViewportSize({ width: 390, height: 844 });
  }
  console.log(
    `PASS ${mobile ? "mobile" : "desktop"} safe hints: hidden-head reveal, rotation before flashing, cancellation, wrapped/red arrows, reduced motion, safe activation, and unchanged progress`,
  );
}
