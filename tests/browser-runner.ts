import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  webkit,
} from "playwright";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { createGameState, simulateMove } from "../src/core/game-state";
import {
  cellToWorld,
  faceHeadingVector,
  faceNormal,
  headingForPath,
} from "../src/core/topology";
import { solveLevel } from "../src/core/validation";
import { arrowDimensions } from "../src/render/renderer";
import { runHintChecks } from "./hints-browser";
import { assertRuntimeCampaign } from "./runtime-browser";
import { assertWrappingEdges } from "./wrapping-browser";
import { assertConsistentMotion } from "./motion-browser";
import { LEVELS, waitForReady } from "./runtime-fixtures";

interface Snapshot {
  mode: string;
  level: { id: number; title: string };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  moving: {
    arrowId: string;
    kind: string;
    elapsed: number;
    duration: number;
  } | null;
  celebration: { active: boolean; elapsed: number; duration: number };
  theme: {
    preference: "system" | "light" | "dark";
    resolved: "light" | "dark";
  };
  camera: {
    orientation: [number, number, number, number];
    position: [number, number, number];
    distance: number;
    cubeScreenBounds: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    };
  };
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

const port = 8058;
const url = `http://127.0.0.1:${port}/?test=1`;
const engine = process.env.BROWSER_ENGINE === "webkit" ? webkit : chromium;
const output =
  engine === webkit ? "test-results/webkit" : "test-results/browser";
const server = Bun.spawn(
  [
    "bun",
    "node_modules/vite/bin/vite.js",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { stdout: "pipe", stderr: "pipe" },
);
const serverOutput = new Response(server.stdout).text();
const serverErrors = new Response(server.stderr).text();
let browser: Browser | undefined;
let primaryContext: BrowserContext | undefined;
const failures: string[] = [];
const deadline = setTimeout(() => {
  console.error("Browser verification exceeded its 180-second deadline.");
  server.kill();
  void browser?.close();
  process.exitCode = 1;
}, 180_000);

async function closeWithinDeadline(promise: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Browser cleanup exceeded 8 seconds.")),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function snapshot(page: Page): Promise<Snapshot> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as Snapshot;
}

async function advance(page: Page, milliseconds = 1800): Promise<void> {
  await page.evaluate((amount) => window.advanceTime?.(amount), milliseconds);
}

async function finishMotion(page: Page): Promise<void> {
  const moving = (await snapshot(page)).moving;
  if (moving)
    await advance(page, Math.max(0, moving.duration - moving.elapsed) + 16);
}

async function loadLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
    levelId,
  );
  assert.equal((await snapshot(page)).level.id, levelId);
}

async function clickArrow(page: Page, arrowId: string): Promise<void> {
  const current = await snapshot(page);
  const point = current.visibleProjectedArrowPositions.find(
    (candidate) => candidate.id === arrowId,
  );
  assert.ok(point, `Arrow ${arrowId} must be exposed to click`);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
}

async function launchLastArrow(page: Page, levelId = 1): Promise<void> {
  const level = LEVELS.find((candidate) => candidate.id === levelId);
  assert.ok(level);
  const solution = solveLevel(level);
  assert.ok(solution);
  await loadLevel(page, levelId);
  await page.evaluate((ids) => {
    for (const [index, id] of ids.entries()) {
      window.__PAR_ARROWS_TEST__?.activate(id);
      if (index < ids.length - 1) {
        const moving = JSON.parse(
          window.render_game_to_text?.() ?? "{}",
        ).moving;
        if (moving)
          window.advanceTime?.(
            Math.max(0, moving.duration - moving.elapsed) + 1,
          );
      }
    }
  }, solution);
}

async function assertCelebration(page: Page, mobile = false): Promise<void> {
  await launchLastArrow(page);
  assert.ok((await snapshot(page)).moving);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator("#state-card").isVisible(), false);
  await finishMotion(page);
  const count = await page.locator(".confetti-piece").count();
  assert.ok(count > 0 && count <= 64, "Victory has a bounded confetti burst");
  assert.equal(await page.locator(".state-card.is-won").isVisible(), true);
  assert.equal(await page.locator(".victory-emblem").isVisible(), true);
  assert.equal(
    await page
      .locator(".celebration-layer")
      .evaluate((element) => getComputedStyle(element).pointerEvents),
    "none",
  );
  assert.ok(
    await page.evaluate(() => {
      const layer = document.querySelector(".celebration-layer");
      const card = document.querySelector("#state-card");
      return (
        layer &&
        card &&
        Number(getComputedStyle(layer).zIndex) >
          Number(getComputedStyle(card).zIndex)
      );
    }),
    "Confetti must remain visible over the wide mobile completion card",
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: `${output}/celebration-${mobile ? "mobile" : "desktop"}.png`,
  });
  await page.getByRole("button", { name: "Next cube", exact: true }).click();
  await waitForReady(page);
  assert.equal((await snapshot(page)).level.id, 2);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator(".state-card.is-won").count(), 0);
  if (mobile) return;

  await launchLastArrow(page);
  await finishMotion(page);
  await page.locator("#settings-button").click();
  await page.getByLabel("Reduce movement").check();
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  await launchLastArrow(page);
  await advance(page, 150);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator(".victory-emblem").isVisible(), true);
  await page.getByLabel("Reduce movement").uncheck();
  await page.locator("#settings-button").click();

  await launchLastArrow(page);
  await finishMotion(page);
  assert.equal((await snapshot(page)).celebration.active, true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () => document.querySelectorAll(".confetti-piece").length === 0,
  );
  assert.equal((await snapshot(page)).celebration.active, false);
  assert.equal(await page.locator(".state-card.is-celebrating").count(), 0);
  await launchLastArrow(page);
  await finishMotion(page);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator(".state-card.is-won").isVisible(), true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(await page.locator(".confetti-piece").count(), 0);

  await launchLastArrow(page, 10);
  await finishMotion(page);
  assert.ok((await page.locator(".confetti-piece").count()) > 0);
  assert.match(await page.locator("#state-title").innerText(), /cube cleared/i);
  await page.screenshot({ path: `${output}/celebration-campaign.png` });
  await advance(page, 3500);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator(".state-card.is-won").isVisible(), true);
  await page.reload();
  await waitForReady(page);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator(".state-card.is-won").isVisible(), true);
  await page.getByRole("button", { name: "Next cube", exact: true }).click();
  await waitForReady(page);
  assert.equal((await snapshot(page)).level.id, 11);
  assert.equal(await page.locator(".state-card.is-won").count(), 0);
  console.log(
    "PASS victory timing, next/retry, expiry, saved win, progression past level 10, and reduced motion",
  );
}

function observeErrors(page: Page): void {
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
}

async function assertCubeFits(page: Page): Promise<void> {
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  const cube = (await snapshot(page)).camera.cubeScreenBounds;
  assert.ok(
    cube.left >= 0 && cube.right <= bounds.width,
    "Default cube fits viewport width",
  );
  assert.ok(
    cube.top >= 0 && cube.bottom <= bounds.height,
    "Default cube fits viewport height",
  );
}

async function assertVisibleArrows(page: Page, levelId: number): Promise<void> {
  const arrowPixels = await page.evaluate(async (id) => {
    await window.__PAR_ARROWS_TEST__?.loadLevel(id);
    const source = document.querySelector("canvas");
    if (!source) return 0;
    const probe = document.createElement("canvas");
    probe.width = source.width;
    probe.height = source.height;
    const context = probe.getContext("2d");
    if (!context) return 0;
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    const darkTheme = document.documentElement.dataset.theme === "dark";
    let visible = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        (darkTheme
          ? (pixels[index] ?? 0) > 180 &&
            (pixels[index + 1] ?? 0) > 180 &&
            (pixels[index + 2] ?? 0) > 180
          : (pixels[index] ?? 255) < 80 &&
            (pixels[index + 1] ?? 255) < 80 &&
            (pixels[index + 2] ?? 255) < 80) &&
        (pixels[index + 3] ?? 0) > 128
      )
        visible += 1;
    }
    return visible;
  }, levelId);
  assert.ok(
    arrowPixels > 80,
    "The actual canvas must contain contrasting arrows, not only invisible hit targets",
  );
}

async function assertTheme(
  page: Page,
  resolved: "light" | "dark",
): Promise<void> {
  await page.waitForFunction(
    (expected) => document.documentElement.dataset.theme === expected,
    resolved,
  );
  assert.equal((await snapshot(page)).theme.resolved, resolved);
  assert.equal(
    await page.locator('meta[name="theme-color"]').getAttribute("content"),
    resolved === "dark" ? "#101820" : "#e9f4f7",
  );
}

async function assertThemes(page: Page, mobile = false): Promise<void> {
  const prefix = mobile ? "mobile" : "desktop";
  await page.emulateMedia({ colorScheme: "light" });
  assert.equal((await snapshot(page)).theme.preference, "system");
  await assertTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await assertTheme(page, "dark");
  await assertVisibleArrows(page, 10);
  await page.screenshot({ path: `${output}/theme-${prefix}-dark-dense.png` });
  await assertArrowheadPicking(page, 2, mobile);
  await loadLevel(page, 3);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  const level = LEVELS[2];
  assert.ok(level);
  const exposed = (await snapshot(page)).visibleProjectedArrowPositions;
  const blocked = exposed.find(
    (arrow) =>
      simulateMove(level, createGameState(level), arrow.id).kind === "blocked",
  );
  assert.ok(blocked);
  await clickArrow(page, blocked.id);
  await advance(page);
  const before = await snapshot(page);
  assert.ok(before.failedIds.includes(blocked.id));
  await page.screenshot({ path: `${output}/theme-${prefix}-dark-failed.png` });
  await page.locator("#settings-button").click();
  await page.locator("#theme-select").selectOption("light");
  await assertTheme(page, "light");
  const after = await snapshot(page);
  assert.deepEqual(after.remainingIds, before.remainingIds);
  assert.deepEqual(after.failedIds, before.failedIds);
  assert.equal(after.lives, before.lives);
  assert.deepEqual(after.camera, before.camera);
  const clear = level.arrows.find(
    (arrow) =>
      simulateMove(level, createGameState(level), arrow.id).kind === "exit",
  );
  assert.ok(clear);
  const motion = await page.evaluate((id) => {
    window.__PAR_ARROWS_TEST__?.activate(id);
    const beforeTheme = window.render_game_to_text?.();
    const select = document.querySelector<HTMLSelectElement>("#theme-select");
    if (select) {
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { before: beforeTheme, after: window.render_game_to_text?.() };
  }, clear.id);
  assert.ok(motion.before && motion.after);
  const beforeTheme = JSON.parse(motion.before) as Snapshot;
  const afterTheme = JSON.parse(motion.after) as Snapshot;
  assert.equal(beforeTheme.moving?.arrowId, clear.id);
  assert.deepEqual(afterTheme.moving, beforeTheme.moving);
  assert.deepEqual(afterTheme.camera, beforeTheme.camera);
  assert.deepEqual(afterTheme.remainingIds, beforeTheme.remainingIds);
  await finishMotion(page);
  await page.locator("#theme-select").selectOption("light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await assertTheme(page, "light");
  await page.locator("#theme-select").selectOption("dark");
  await page.getByLabel("Reduce movement").check();
  await page.emulateMedia({ colorScheme: "light" });
  await assertTheme(page, "dark");
  await page.reload();
  await waitForReady(page);
  await assertTheme(page, "dark");
  assert.equal((await snapshot(page)).theme.preference, "dark");
  assert.deepEqual((await snapshot(page)).failedIds, before.failedIds);
  assert.equal((await snapshot(page)).lives, before.lives);
  await page.locator("#settings-button").click();
  assert.equal(await page.getByLabel("Reduce movement").isChecked(), true);
  await page.getByLabel("Reduce movement").uncheck();
  await page.screenshot({
    path: `${output}/theme-${prefix}-dark-settings.png`,
  });
  await page.locator("#settings-button").click();
  await launchLastArrow(page);
  await finishMotion(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/theme-${prefix}-dark-victory.png` });
  assert.equal(await page.locator(".state-card.is-won").isVisible(), true);
  await page.getByRole("button", { name: "Next cube", exact: true }).click();
  await waitForReady(page);
  await page.locator("#settings-button").click();
  await page.locator("#theme-select").selectOption("system");
  await assertTheme(page, "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await assertTheme(page, "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await assertTheme(page, "light");
  await page.locator("#settings-button").click();
  console.log(
    `PASS ${prefix} system theme, persistent overrides, settings preservation, dark arrows/picking/failure/victory`,
  );
}

async function assertThemeBootstrap(browser: Browser): Promise<void> {
  const cases = [
    { scheme: "dark", saved: null, expected: "dark" },
    { scheme: "dark", saved: '{"theme":"light"}', expected: "light" },
    { scheme: "light", saved: '{"theme":"dark"}', expected: "dark" },
    {
      scheme: "dark",
      saved: '{"theme":"invalid","reducedMotion":true}',
      expected: "dark",
    },
    { scheme: "dark", saved: '{"reducedMotion":true}', expected: "dark" },
    { scheme: "dark", saved: "{broken", expected: "dark" },
  ] as const;
  for (const scenario of cases) {
    const context = await browser.newContext({ colorScheme: scenario.scheme });
    if (scenario.saved)
      await context.addInitScript((saved) => {
        localStorage.setItem("par-arrows:settings:v1", saved);
      }, scenario.saved);
    await context.route("**/assets/index-*.js", (route) => route.abort());
    const page = await context.newPage();
    await page.goto(url);
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      scenario.expected,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.style.colorScheme),
      scenario.expected,
    );
    await context.close();
  }
  const denied = await browser.newContext({ colorScheme: "dark" });
  await denied.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  const page = await denied.newPage();
  observeErrors(page);
  await page.goto(url);
  await waitForReady(page);
  await assertTheme(page, "dark");
  await page.locator("#settings-button").click();
  await page.locator("#theme-select").selectOption("light");
  await assertTheme(page, "light");
  await denied.close();
  console.log(
    "PASS theme before app bundle execution, saved overrides/legacy/malformed data, and denied storage",
  );
}

async function assertArrowheadPicking(
  page: Page,
  levelId: number,
  touch = false,
): Promise<void> {
  await loadLevel(page, levelId);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  if (touch && engine === chromium) {
    const distance = (await snapshot(page)).camera.distance;
    await page.mouse.move(195, 420);
    await page.mouse.wheel(0, -10000);
    await page.waitForFunction((previous) => {
      const raw = window.render_game_to_text?.();
      return raw && JSON.parse(raw).camera.distance < previous;
    }, distance);
  }
  const level = LEVELS.find((candidate) => candidate.id === levelId);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(level && bounds);
  const current = await snapshot(page);
  const camera = new PerspectiveCamera(
    32,
    bounds.width / bounds.height,
    0.1,
    40,
  );
  camera.position.fromArray(current.camera.position);
  camera.quaternion.fromArray(current.camera.orientation);
  camera.updateMatrixWorld();
  const { ribbonWidth, headLength } = arrowDimensions(
    level.gridSize,
    level.arrowScale,
  );
  const samples = level.arrows.map((arrow) => {
    const head = arrow.path.at(-1);
    const heading = headingForPath(arrow.path, level.gridSize);
    assert.ok(head && heading);
    const normal = new Vector3(...faceNormal(head.face));
    const direction = new Vector3(...faceHeadingVector(head.face, heading));
    const side = normal.clone().cross(direction).normalize();
    const base = new Vector3(
      ...cellToWorld(head, level.gridSize),
    ).addScaledVector(normal, 0.005);
    const facing = normal.dot(camera.position.clone().sub(base)) > 0.04;
    const points = [
      [0.82, 0],
      [0.12, -0.75],
      [0.12, 0.75],
    ].map(([along = 0, across = 0]) => {
      const projected = base
        .clone()
        .addScaledVector(direction, headLength * along)
        .addScaledVector(side, ribbonWidth * 0.8 * across * (1 - along))
        .project(camera);
      return {
        x: bounds.x + ((projected.x + 1) * bounds.width) / 2,
        y: bounds.y + ((1 - projected.y) * bounds.height) / 2,
      };
    });
    return { id: arrow.id, facing, points };
  });
  const inside = (sample: (typeof samples)[number]): boolean =>
    sample.points.every(
      (point) =>
        point.x > bounds.x + 25 &&
        point.x < bounds.x + bounds.width - 25 &&
        point.y > bounds.y + 100 &&
        point.y < bounds.y + bounds.height - 110,
    );
  const target = samples.find((sample) => sample.facing && inside(sample));
  assert.ok(
    target,
    "A visible arrowhead must be available for tip and wing checks",
  );
  for (const [index, point] of target.points.entries()) {
    await loadLevel(page, levelId);
    if (touch) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    const moving = (await snapshot(page)).moving;
    assert.equal(
      moving?.arrowId,
      target.id,
      `Arrowhead ${index === 0 ? "tip" : "wing"} must activate ${target.id}`,
    );
    assert.equal(
      moving?.kind,
      simulateMove(level, createGameState(level), target.id).kind,
    );
    if (index === 0) {
      const other: (typeof samples)[number] | undefined = samples.find(
        (sample) => sample.facing && sample.id !== target.id && inside(sample),
      );
      const secondaryPoint: { x: number; y: number } | undefined =
        other?.points[0];
      assert.ok(
        secondaryPoint,
        "A second exposed head is needed for the busy-input check",
      );
      if (touch) await page.touchscreen.tap(secondaryPoint.x, secondaryPoint.y);
      else await page.mouse.click(secondaryPoint.x, secondaryPoint.y);
      assert.equal(
        (await snapshot(page)).moving?.arrowId,
        target.id,
        "Another head tap cannot launch a second moving arrow",
      );
    }
    await advance(page);
  }
  await loadLevel(page, levelId);
  const hidden = samples.find((sample) => !sample.facing && inside(sample));
  assert.ok(hidden, "A far-side head must be available for exclusion checks");
  const point = hidden.points[0];
  assert.ok(point);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  assert.notEqual(
    (await snapshot(page)).moving?.arrowId,
    hidden.id,
    "A ghosted head cannot be selected through the cube",
  );
  await loadLevel(page, levelId);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  console.log(
    `PASS ${touch ? "touch" : "mouse"} arrowhead tip/wing activation and far-side exclusion on level ${levelId}`,
  );
}

async function assertDensePicking(
  page: Page,
  levelId: number,
  touch = false,
): Promise<void> {
  await loadLevel(page, levelId);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  const level = LEVELS.find((candidate) => candidate.id === levelId);
  assert.ok(level);
  const initial = await snapshot(page);
  const pathLength = (id: string): number =>
    level.arrows.find((arrow) => arrow.id === id)?.path.length ?? 0;
  const candidates = [...initial.visibleProjectedArrowPositions]
    .sort((left, right) => pathLength(right.id) - pathLength(left.id))
    .slice(0, 4);
  assert.equal(candidates.length, 4);
  for (const [index, candidate] of candidates.entries()) {
    await loadLevel(page, levelId);
    const bounds = await page.locator("canvas").boundingBox();
    assert.ok(bounds);
    if (touch) {
      await page.touchscreen.tap(
        bounds.x + candidate.x,
        bounds.y + candidate.y,
      );
    } else {
      await clickArrow(page, candidate.id);
    }
    const expected = simulateMove(level, createGameState(level), candidate.id);
    const accepted = await snapshot(page);
    const moving = accepted.moving;
    if (moving) {
      assert.equal(
        moving.arrowId,
        candidate.id,
        "Dense picking must select the intended arrow, not its neighbor",
      );
      assert.equal(moving.kind, expected.kind);
    } else if (expected.kind === "blocked") {
      assert.deepEqual(
        accepted.failedIds,
        [candidate.id],
        "A short completed rebound must belong to the tapped arrow",
      );
      assert.equal(accepted.lives, level.lives - 1);
    } else {
      assert.deepEqual(
        accepted.remainingIds,
        level.arrows
          .filter((arrow) => arrow.id !== candidate.id)
          .map((arrow) => arrow.id),
      );
    }
    if (index === 0) {
      await advance(page, 170);
      await page.screenshot({
        path: `${output}/${touch ? "mobile" : "desktop"}-dense-motion-${levelId}.png`,
      });
    }
    await advance(page);
    const settled = await snapshot(page);
    assert.equal(
      settled.remainingIds.includes(candidate.id),
      expected.kind !== "exit",
    );
    assert.equal(
      settled.lives,
      level.lives - (expected.kind === "blocked" ? 1 : 0),
    );
  }
  await loadLevel(page, levelId);
}

function assertRotationStep(
  before: Snapshot,
  after: Snapshot,
  deltaX: number,
  deltaY: number,
): void {
  const orientation = after.camera.orientation;
  assert.ok(Math.abs(Math.hypot(...orientation) - 1) < 1e-8);
  const dot = orientation.reduce(
    (sum, value, index) =>
      sum + value * (before.camera.orientation[index] ?? 0),
    0,
  );
  const expected = Math.hypot(deltaX, deltaY) * 0.012;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(dot)));
  const localRotation = new Quaternion()
    .fromArray(before.camera.orientation)
    .invert()
    .multiply(new Quaternion().fromArray(orientation));
  if (deltaY !== 0)
    assert.ok(
      localRotation.x * deltaY < 0,
      `Vertical drag direction mismatch: deltaY=${deltaY}, local=${JSON.stringify(localRotation.toArray())}, angle=${angle}`,
    );
  if (deltaX !== 0)
    assert.ok(
      localRotation.y * deltaX < 0,
      "Horizontal drag direction must remain unchanged",
    );
  assert.ok(
    Math.abs(angle - expected) < 0.002,
    `Each drag step must rotate fully without a stop or pole flip: got ${angle}, expected ${expected}`,
  );
  const positionDot =
    after.camera.position.reduce(
      (sum, value, index) => sum + value * (before.camera.position[index] ?? 0),
      0,
    ) /
    (before.camera.distance * after.camera.distance);
  assert.ok(
    Math.abs(positionDot - Math.cos(expected)) < 0.002,
    "Camera must orbit the cube, including at the poles",
  );
  assert.equal(after.camera.distance, before.camera.distance);
  assert.equal(after.lives, before.lives);
  assert.deepEqual(after.remainingIds, before.remainingIds);
  assert.deepEqual(after.failedIds, before.failedIds);
  assert.equal(after.moving, null);
}

interface DragGesture {
  start(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  end(): Promise<void>;
}

async function assertContinuousRotation(
  page: Page,
  gesture: DragGesture,
  directions: readonly (readonly [number, number])[],
  label: string,
): Promise<void> {
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  await page.evaluate(() => {
    const events: unknown[] = [];
    Reflect.set(window, "rotationInputEvents", events);
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "gotpointercapture",
      "lostpointercapture",
    ]) {
      document.addEventListener(type, (event) => {
        const pointer = event as PointerEvent;
        events.push({
          type,
          x: pointer.clientX,
          y: pointer.clientY,
          buttons: pointer.buttons,
          target: (event.target as Element)?.tagName,
        });
        if (events.length > 30) events.shift();
      });
    }
  });
  for (const [deltaX, deltaY] of directions) {
    for (let drag = 0; drag < 7; drag += 1) {
      const x = bounds.x + bounds.width / 2 - deltaX * 4;
      const y = bounds.y + bounds.height / 2 - deltaY * 4;
      await gesture.start(x, y);
      let before = await snapshot(page);
      for (let step = 1; step <= 8; step += 1) {
        await gesture.move(x + deltaX * step, y + deltaY * step);
        // Browser input dispatch may acknowledge before the page handles pointermove.
        try {
          await page.waitForFunction((previous) => {
            const raw = window.render_game_to_text?.();
            if (!raw) return false;
            const orientation = JSON.parse(raw).camera.orientation as number[];
            return orientation.some(
              (value, index) => value !== previous[index],
            );
          }, before.camera.orientation);
        } catch (error) {
          await Bun.write(
            `${output}/rotation-failure.json`,
            JSON.stringify(
              {
                label,
                deltaX,
                deltaY,
                drag,
                step,
                before,
                after: await snapshot(page),
                events: await page.evaluate(() =>
                  Reflect.get(window, "rotationInputEvents"),
                ),
              },
              null,
              2,
            ),
          );
          throw error;
        }
        const after = await snapshot(page);
        try {
          assertRotationStep(before, after, deltaX, deltaY);
        } catch (error) {
          await Bun.write(
            `${output}/rotation-failure.json`,
            JSON.stringify(
              {
                label,
                deltaX,
                deltaY,
                drag,
                step,
                before,
                after,
                events: await page.evaluate(() =>
                  Reflect.get(window, "rotationInputEvents"),
                ),
              },
              null,
              2,
            ),
          );
          throw error;
        }
        before = after;
      }
      await gesture.end();
      assert.deepEqual(
        (await snapshot(page)).remainingIds,
        before.remainingIds,
      );
      if (drag === 1 && deltaY > 0) {
        await page.screenshot({
          path: `${output}/${label}-rotation-${deltaX}-${deltaY}.png`,
        });
      }
    }
  }
}

try {
  await mkdir(output, { recursive: true });
  const startupDeadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < startupDeadline) {
    if (server.exitCode !== null)
      throw new Error("Isolated Vite server exited");
    try {
      ready = (await fetch(url)).ok;
      if (ready) break;
    } catch {
      // The isolated test server may still be opening its listener.
    }
    await Bun.sleep(100);
  }
  assert.ok(ready, "Isolated server must start within 15 seconds");
  browser = await engine.launch({
    headless: false,
    ...(engine === chromium && process.env.PAR_ARROWS_TEST_WINDOW_POSITION
      ? {
          args: [
            `--window-position=${process.env.PAR_ARROWS_TEST_WINDOW_POSITION}`,
            "--disable-backgrounding-occluded-windows",
          ],
        }
      : {}),
    ...(process.platform === "darwin" && engine === chromium
      ? { channel: "chrome" }
      : {}),
  });
  const context = await browser.newContext({
    baseURL: url,
    colorScheme: "light",
    viewport: { width: 1365, height: 900 },
  });
  primaryContext = context;
  const page = await context.newPage();
  observeErrors(page);
  page.setDefaultTimeout(10_000);
  await page.goto(url);
  await waitForReady(page);

  assert.equal((await snapshot(page)).mode, "demo");
  assert.equal(
    await page.getByRole("button", { name: "Hint", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("button", { name: /skip/i }).count(), 0);
  await page.screenshot({ path: `${output}/demo-start.png` });
  await advance(page, 1700);
  const failedDemo = await snapshot(page);
  assert.ok(
    failedDemo.failedIds.length > 0,
    "Demo must visibly show its failed arrow",
  );
  await page.screenshot({ path: `${output}/demo-failure.png` });
  await advance(page, 4000);
  const completedDemo = await snapshot(page);
  assert.ok(completedDemo.remainingIds.length < failedDemo.remainingIds.length);
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  await page.getByRole("button", { name: "Start level 1" }).click();
  assert.equal((await snapshot(page)).lives, 5);
  assert.deepEqual((await snapshot(page)).failedIds, []);
  await assertVisibleArrows(page, 1);
  await page.screenshot({ path: `${output}/desktop-level-1.png` });
  console.log(
    "PASS demo: blocked touch, persistent red, then exit; campaign starts clean",
  );

  await loadLevel(page, 2);
  await assertCubeFits(page);
  await assertVisibleArrows(page, 2);
  await page.screenshot({ path: `${output}/desktop-level-2.png` });
  await assertArrowheadPicking(page, 2);
  await assertDensePicking(page, 2);

  await loadLevel(page, 3);
  const level = LEVELS.find((candidate) => candidate.id === 3);
  assert.ok(level);
  const initial = await snapshot(page);
  const initialState = createGameState(level);
  const blocked = initial.visibleProjectedArrowPositions.find(
    (candidate) =>
      simulateMove(level, initialState, candidate.id).kind === "blocked",
  );
  assert.ok(
    blocked,
    "Test level must expose a blocked arrow in the initial view",
  );
  await clickArrow(page, blocked.id);
  await advance(page);
  const once = await snapshot(page);
  assert.equal(once.lives, level.lives - 1);
  assert.ok(once.failedIds.includes(blocked.id));
  await clickArrow(page, blocked.id);
  await advance(page);
  assert.equal((await snapshot(page)).lives, once.lives);
  await page.reload();
  await waitForReady(page);
  const resumed = await snapshot(page);
  assert.equal(resumed.level.id, level.id);
  assert.equal(resumed.lives, once.lives);
  assert.deepEqual(resumed.failedIds, once.failedIds);
  await clickArrow(page, blocked.id);
  await advance(page);
  assert.equal((await snapshot(page)).lives, once.lives);
  await page.screenshot({ path: `${output}/persistent-red.png` });
  console.log(
    "PASS real pointer collision, free repeat, reload, and persistent failure history",
  );

  const beforeGesture = await snapshot(page);
  const canvas = await page.locator("canvas").boundingBox();
  assert.ok(canvas);
  await page.mouse.move(
    canvas.x + canvas.width * 0.45,
    canvas.y + canvas.height * 0.5,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + canvas.width * 0.65,
    canvas.y + canvas.height * 0.55,
    { steps: 10 },
  );
  await page.mouse.up();
  const afterOrbit = await snapshot(page);
  assert.notDeepEqual(
    afterOrbit.camera.orientation,
    beforeGesture.camera.orientation,
  );
  assert.equal(afterOrbit.lives, beforeGesture.lives);
  assert.deepEqual(afterOrbit.remainingIds, beforeGesture.remainingIds);
  await assertContinuousRotation(
    page,
    {
      start: async (x, y) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: async (x, y) => {
        await page.mouse.move(x, y);
      },
      end: async () => {
        await page.mouse.up();
      },
    },
    [
      [20, 0],
      [-20, 0],
      [0, 20],
      [0, -20],
      [20, 20],
      [-20, -20],
    ],
    "desktop",
  );
  const rotated = await snapshot(page);
  const clearAfterRotation = rotated.visibleProjectedArrowPositions.find(
    (candidate) =>
      simulateMove(level, initialState, candidate.id).kind === "exit",
  );
  assert.ok(
    clearAfterRotation,
    "A rotated visible face must expose a selectable clear arrow",
  );
  await clickArrow(page, clearAfterRotation.id);
  await advance(page);
  assert.ok(
    !(await snapshot(page)).remainingIds.includes(clearAfterRotation.id),
  );
  await page.mouse.wheel(0, -240);
  const afterZoom = await snapshot(page);
  assert.notEqual(afterZoom.camera.distance, afterOrbit.camera.distance);
  assert.equal(afterZoom.lives, beforeGesture.lives);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  const resetCamera = (await snapshot(page)).camera;
  assert.deepEqual(resetCamera.orientation, beforeGesture.camera.orientation);
  assert.equal(resetCamera.distance, beforeGesture.camera.distance);
  await page.locator('[data-action="retry"]').first().click();
  const retried = await snapshot(page);
  assert.equal(retried.lives, level.lives);
  assert.deepEqual(retried.failedIds, []);
  assert.equal(retried.remainingIds.length, level.arrows.length);
  console.log(
    "PASS continuous full-turn orbit on both axes and diagonals, rotated picking, wheel zoom, view reset, and retry",
  );

  await loadLevel(page, 1);
  const first = LEVELS[0];
  assert.ok(first);
  const solution = solveLevel(first);
  assert.ok(solution);
  for (const arrowId of solution) {
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id),
      arrowId,
    );
    if (arrowId !== solution.at(-1)) await advance(page);
  }
  await page.reload();
  await waitForReady(page);
  assert.equal((await snapshot(page)).remainingIds.length, 0);
  await page.getByRole("button", { name: "Next cube" }).click();
  await waitForReady(page);
  assert.equal((await snapshot(page)).level.id, 2);
  console.log(
    "PASS interrupted final exit persists win and unlocks next level",
  );
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  await assertCelebration(page);

  await loadLevel(page, 7);
  const failureLevel = LEVELS.find((candidate) => candidate.id === 7);
  assert.ok(failureLevel);
  const failureState = createGameState(failureLevel);
  const blockedIds = failureLevel.arrows
    .filter(
      (arrow) =>
        simulateMove(failureLevel, failureState, arrow.id).kind === "blocked",
    )
    .map((arrow) => arrow.id);
  assert.ok(blockedIds.length >= failureLevel.lives);
  for (const id of blockedIds.slice(0, failureLevel.lives)) {
    await page.evaluate(
      (arrowId) => window.__PAR_ARROWS_TEST__?.activate(arrowId),
      id,
    );
    await advance(page);
  }
  assert.equal((await snapshot(page)).lives, 0);
  assert.equal(
    await page.getByRole("button", { name: "Hint", exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.locator(".confetti-piece").count(), 0);
  assert.equal(await page.locator(".state-card.is-won").count(), 0);
  await page.getByRole("button", { name: "Retry cube", exact: true }).click();
  assert.equal((await snapshot(page)).lives, failureLevel.lives);
  assert.deepEqual((await snapshot(page)).failedIds, []);
  console.log("PASS zero-life failure and full-budget retry");

  const wrappedLevel = LEVELS.find((candidate) =>
    candidate.arrows.some(
      (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
    ),
  );
  assert.ok(wrappedLevel);
  const wrapped = wrappedLevel.arrows.find(
    (arrow) => new Set(arrow.path.map((cell) => cell.face)).size >= 3,
  );
  assert.ok(wrapped);
  await loadLevel(page, wrappedLevel.id);
  const wrappedSolution = solveLevel(wrappedLevel);
  assert.ok(wrappedSolution);
  for (const id of wrappedSolution) {
    await page.evaluate(
      (arrowId) => window.__PAR_ARROWS_TEST__?.activate(arrowId),
      id,
    );
    if (id === wrapped.id) {
      await advance(page, 340);
      await page.screenshot({ path: `${output}/wrapped-arrow-moving.png` });
      await advance(page);
      assert.ok(!(await snapshot(page)).remainingIds.includes(id));
      break;
    }
    await advance(page);
  }
  console.log(
    "PASS multi-face arrow exits through the presentation controller",
  );

  await loadLevel(page, 10);
  await page.screenshot({ path: `${output}/desktop-level-10.png` });
  await assertArrowheadPicking(page, 10);
  await assertDensePicking(page, 10);
  console.log("PASS dense level 2/10 pointer selection and long-path motion");
  const manifest = (await (
    await page.request.get("/manifest.webmanifest")
  ).json()) as {
    display: string;
    icons: { src: string; sizes: string; type: string; purpose: string }[];
  };
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons, [
    {
      src: "/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icon-maskable-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
  ]);
  const assets = [
    ["/favicon.ico", "image/x-icon"],
    ["/favicon.svg", "image/svg+xml"],
    ["/favicon-16x16.png", "image/png"],
    ["/favicon-32x32.png", "image/png"],
    ["/favicon-48x48.png", "image/png"],
    ["/favicon-64x64.png", "image/png"],
    ["/favicon-128x128.png", "image/png"],
    ["/apple-touch-icon.png", "image/png"],
    ["/icon.svg", "image/svg+xml"],
    ["/icon-192.png", "image/png"],
    ["/icon-512.png", "image/png"],
    ["/icon-maskable-192.png", "image/png"],
    ["/icon-maskable-512.png", "image/png"],
  ] as const;
  for (const [path, mime] of assets) {
    const response = await page.request.get(path);
    assert.equal(
      response.status(),
      200,
      `${path} must not fall back to the app HTML`,
    );
    assert.ok(
      response.headers()["content-type"]?.startsWith(mime),
      `${path} must return ${mime}`,
    );
  }
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1);
  console.log("PASS PWA manifest and installation assets");
  await assertThemes(page);
  await runHintChecks(page, output);

  const mobile = await browser.newContext({
    colorScheme: "light",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const touchPage = await mobile.newPage();
  observeErrors(touchPage);
  await touchPage.goto(url);
  await waitForReady(touchPage);
  await assertThemes(touchPage, true);
  await runHintChecks(touchPage, output, true);
  await assertCelebration(touchPage, true);
  await loadLevel(touchPage, 3);
  await assertVisibleArrows(touchPage, 3);
  await assertCubeFits(touchPage);
  await touchPage.screenshot({ path: `${output}/mobile-portrait.png` });
  const touchBefore = await snapshot(touchPage);
  const touchBounds = await touchPage.locator("canvas").boundingBox();
  assert.ok(touchBounds);
  if (engine === chromium) {
    const client = await mobile.newCDPSession(touchPage);
    await assertContinuousRotation(
      touchPage,
      {
        start: async (x, y) => {
          await client.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 0 }],
          });
        },
        move: async (x, y) => {
          await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y, id: 0 }],
          });
        },
        end: async () => {
          await client.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        },
      },
      [
        [0, 20],
        [0, -20],
      ],
      "mobile",
    );
    const centerX = touchBounds.x + touchBounds.width / 2;
    const centerY = touchBounds.y + touchBounds.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: centerX - 30, y: centerY, id: 0 },
        { x: centerX + 30, y: centerY, id: 1 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: centerX - 65, y: centerY, id: 0 },
        { x: centerX + 65, y: centerY, id: 1 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    const touchAfter = await snapshot(touchPage);
    assert.notEqual(touchAfter.camera.distance, touchBefore.camera.distance);
    assert.equal(touchAfter.lives, touchBefore.lives);
    assert.deepEqual(touchAfter.remainingIds, touchBefore.remainingIds);
  } else {
    const clearArrow = touchBefore.visibleProjectedArrowPositions.find(
      (candidate) =>
        simulateMove(level, createGameState(level), candidate.id).kind ===
        "exit",
    );
    assert.ok(clearArrow, "Mobile WebKit must expose a removable arrow");
    await touchPage.touchscreen.tap(
      touchBounds.x + clearArrow.x,
      touchBounds.y + clearArrow.y,
    );
    await advance(touchPage);
    assert.ok(
      !(await snapshot(touchPage)).remainingIds.includes(clearArrow.id),
    );
    assert.equal((await snapshot(touchPage)).lives, touchBefore.lives);
  }
  await loadLevel(touchPage, 10);
  await touchPage.getByRole("button", { name: "Reset camera view" }).click();
  await assertCubeFits(touchPage);
  await touchPage.screenshot({ path: `${output}/mobile-level-10.png` });
  await assertArrowheadPicking(touchPage, 10, true);
  await assertDensePicking(touchPage, 10, true);
  console.log(
    "PASS dense mobile level 10 touch selection and long-path motion",
  );
  await touchPage.setViewportSize({ width: 844, height: 390 });
  await touchPage.getByRole("button", { name: "Reset camera view" }).click();
  await assertCubeFits(touchPage);
  await touchPage.screenshot({ path: `${output}/mobile-landscape.png` });
  const overflows = await touchPage.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(
    overflows,
    false,
    "Landscape layout must not overflow horizontally",
  );
  console.log(
    `PASS emulated mobile portrait/landscape and ${engine === chromium ? "continuous touch rotation and two-pointer pinch without a move" : "WebKit touch activation"}`,
  );
  await mobile.close();
  await assertRuntimeCampaign(browser, url, output);
  await assertConsistentMotion(browser, url, output);
  await assertWrappingEdges(browser, url, output, {
    movementLevelId: 11,
    reboundLevelId: 11,
  });
  await assertThemeBootstrap(browser);
  assert.deepEqual(failures, [], "Browser must not report uncaught errors");
  await Bun.write(
    `${output}/summary.json`,
    JSON.stringify(
      { passed: true, browser: engine.name(), physicalDevice: false },
      null,
      2,
    ),
  );
} finally {
  try {
    try {
      if (primaryContext) await closeWithinDeadline(primaryContext.close());
    } finally {
      if (browser) await closeWithinDeadline(browser.close());
    }
  } finally {
    server.kill();
    const forceStop = setTimeout(() => server.kill("SIGKILL"), 2000);
    await server.exited;
    clearTimeout(forceStop);
    const logs = `${await serverOutput}\n${await serverErrors}`;
    await Bun.write(`${output}/server.log`, logs);
    clearTimeout(deadline);
  }
}
