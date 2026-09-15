import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { type Browser, chromium, type Page, webkit } from "playwright";
import { LEVELS } from "../src/content/levels";
import { createGameState, simulateMove } from "../src/core/game-state";
import { solveLevel } from "../src/core/validation";

interface Snapshot {
  mode: string;
  level: { id: number; title: string };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  moving: { arrowId: string; kind: string; elapsed: number } | null;
  camera: {
    yaw: number;
    pitch: number;
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
const failures: string[] = [];
const deadline = setTimeout(() => {
  console.error("Browser verification exceeded its 120-second deadline.");
  server.kill();
  void browser?.close();
  process.exitCode = 1;
}, 120_000);

async function snapshot(page: Page): Promise<Snapshot> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as Snapshot;
}

async function advance(page: Page, milliseconds = 1800): Promise<void> {
  await page.evaluate((amount) => window.advanceTime?.(amount), milliseconds);
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
  const darkPixels = await page.evaluate((id) => {
    window.__PAR_ARROWS_TEST__?.loadLevel(id);
    const source = document.querySelector("canvas");
    if (!source) return 0;
    const probe = document.createElement("canvas");
    probe.width = source.width;
    probe.height = source.height;
    const context = probe.getContext("2d");
    if (!context) return 0;
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        (pixels[index] ?? 255) < 80 &&
        (pixels[index + 1] ?? 255) < 80 &&
        (pixels[index + 2] ?? 255) < 80 &&
        (pixels[index + 3] ?? 0) > 128
      )
        dark += 1;
    }
    return dark;
  }, levelId);
  assert.ok(
    darkPixels > 80,
    "The actual canvas must contain visible black arrows, not only invisible hit targets",
  );
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
    ...(process.platform === "darwin" && engine === chromium
      ? { channel: "chrome" }
      : {}),
  });
  const context = await browser.newContext({
    baseURL: url,
    viewport: { width: 1365, height: 900 },
  });
  const page = await context.newPage();
  observeErrors(page);
  page.setDefaultTimeout(10_000);
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.__PAR_ARROWS_TEST__));

  assert.equal((await snapshot(page)).mode, "demo");
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
  await page.waitForFunction(() => Boolean(window.__PAR_ARROWS_TEST__));
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
  assert.notEqual(afterOrbit.camera.yaw, beforeGesture.camera.yaw);
  assert.equal(afterOrbit.lives, beforeGesture.lives);
  assert.deepEqual(afterOrbit.remainingIds, beforeGesture.remainingIds);
  await page.mouse.wheel(0, -240);
  const afterZoom = await snapshot(page);
  assert.notEqual(afterZoom.camera.distance, afterOrbit.camera.distance);
  assert.equal(afterZoom.lives, beforeGesture.lives);
  await page.getByRole("button", { name: "Reset camera view" }).click();
  await page.locator('[data-action="retry"]').first().click();
  const retried = await snapshot(page);
  assert.equal(retried.lives, level.lives);
  assert.deepEqual(retried.failedIds, []);
  assert.equal(retried.remainingIds.length, level.arrows.length);
  console.log(
    "PASS orbit, wheel zoom, view reset, and same-layout retry without unintended moves",
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
  await page.waitForFunction(() => Boolean(window.__PAR_ARROWS_TEST__));
  assert.equal((await snapshot(page)).remainingIds.length, 0);
  await page.getByRole("button", { name: "Next cube" }).click();
  assert.equal((await snapshot(page)).level.id, 2);
  console.log(
    "PASS interrupted final exit persists win and unlocks next level",
  );

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

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const touchPage = await mobile.newPage();
  observeErrors(touchPage);
  await touchPage.goto(url);
  await touchPage.waitForFunction(() => Boolean(window.__PAR_ARROWS_TEST__));
  await loadLevel(touchPage, 3);
  await assertVisibleArrows(touchPage, 3);
  await assertCubeFits(touchPage);
  await touchPage.screenshot({ path: `${output}/mobile-portrait.png` });
  const touchBefore = await snapshot(touchPage);
  const touchBounds = await touchPage.locator("canvas").boundingBox();
  assert.ok(touchBounds);
  if (engine === chromium) {
    const client = await mobile.newCDPSession(touchPage);
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
    `PASS emulated mobile portrait/landscape and ${engine === chromium ? "two-pointer pinch without a move" : "WebKit touch activation"}`,
  );
  await mobile.close();
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
  clearTimeout(deadline);
  await browser?.close();
  server.kill();
  await server.exited;
  const logs = `${await serverOutput}\n${await serverErrors}`;
  await Bun.write(`${output}/server.log`, logs);
}
