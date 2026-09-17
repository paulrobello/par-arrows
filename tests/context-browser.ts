import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { waitForReady } from "./runtime-fixtures";

interface TestState {
  level: { id: number };
  moving: { arrowId: string } | null;
  remainingIds: string[];
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

async function state(page: Page): Promise<TestState> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as TestState;
}

async function loadLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
    levelId,
  );
  assert.equal((await state(page)).level.id, levelId);
}

/** Real rAF deltas over roughly one and a half seconds. */
async function measureFrameTimes(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const deltas: number[] = [];
        let last = performance.now();
        let count = 0;
        const tick = (now: number): void => {
          deltas.push(now - last);
          last = now;
          count += 1;
          if (count < 90) requestAnimationFrame(tick);
          else resolve(deltas);
        };
        requestAnimationFrame(tick);
      }),
  );
}

function assertBudget(deltas: number[], levelId: number): void {
  const sorted = [...deltas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? Infinity;
  assert.ok(
    median <= 20,
    `Level ${levelId} median frame ${median.toFixed(1)}ms must be within the 20ms budget`,
  );
  assert.ok(
    p95 <= 45,
    `Level ${levelId} p95 frame ${p95.toFixed(1)}ms must be within the 45ms budget`,
  );
}

async function contrastingPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const source = document.querySelector("canvas");
    if (!source) return 0;
    const probe = document.createElement("canvas");
    probe.width = source.width;
    probe.height = source.height;
    const context = probe.getContext("2d");
    if (!context) return 0;
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let visible = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        (pixels[index] ?? 255) < 80 &&
        (pixels[index + 1] ?? 255) < 80 &&
        (pixels[index + 2] ?? 255) < 80 &&
        (pixels[index + 3] ?? 0) > 128
      )
        visible += 1;
    }
    return visible;
  });
}

export async function assertContextRecovery(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/context`, { recursive: true });
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

    // Frame-time budgets on a normal and a dense cube (median 20ms, p95 45ms)
    // and tap-to-motion response (150ms).
    const budgets: Record<string, { median: number; p95: number }> = {};
    for (const levelId of [1, 10]) {
      await loadLevel(page, levelId);
      const deltas = await measureFrameTimes(page);
      assertBudget(deltas, levelId);
      const sorted = [...deltas].sort((a, b) => a - b);
      budgets[String(levelId)] = {
        median: sorted[Math.floor(sorted.length / 2)] ?? Infinity,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? Infinity,
      };
    }

    await loadLevel(page, 1);
    const target = (await state(page)).visibleProjectedArrowPositions;
    assert.ok(target.length > 0, "A visible arrow must exist for timing");
    const bounds = await page.locator("canvas").boundingBox();
    assert.ok(bounds);
    const point = target[0];
    assert.ok(point, "A projected arrow point must exist for timing");
    const started = Date.now();
    await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    await page.waitForFunction(() => {
      const raw = window.render_game_to_text?.();
      return Boolean(raw && JSON.parse(raw).moving);
    });
    const responseMs = Date.now() - started;
    assert.ok(
      responseMs <= 150,
      `Tap response ${responseMs}ms must be within the 150ms budget`,
    );
    await Bun.write(
      `${output}/context/budgets.json`,
      JSON.stringify(
        { frameTimes: budgets, inputResponseMs: responseMs },
        null,
        2,
      ),
    );

    // Forced context loss on the dense cube, then recovery: three.js r186
    // re-initializes its GL context on webglcontextrestored and the app loop
    // repaints, so the game must come back rendering with state intact.
    await loadLevel(page, 10);
    const before = await state(page);
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) throw new Error("canvas is missing");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) throw new Error("WebGL context is missing");
      const extension = gl.getExtension("WEBGL_lose_context");
      if (!extension) throw new Error("WEBGL_lose_context is unavailable");
      extension.loseContext();
      Reflect.set(window, "__loseContextExtension", extension);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const extension = Reflect.get(window, "__loseContextExtension") as
        | WEBGL_lose_context
        | undefined;
      extension?.restoreContext();
    });
    // A lost context queries no new extensions, so the loss above keeps the
    // extension reference on window for this restore.
    // The WebGL drawing buffer clears after compositing, so the pixel probe
    // must share a task with a fresh render: repaint through the test hook,
    // probe, and retry until three.js has re-uploaded after the restore.
    let recovered = false;
    for (let attempt = 0; attempt < 10 && !recovered; attempt += 1) {
      await page.waitForTimeout(250);
      recovered =
        (await page.evaluate(() => {
          window.__PAR_ARROWS_TEST__?.render();
          const source = document.querySelector("canvas");
          if (!source) return false;
          const probe = document.createElement("canvas");
          probe.width = source.width;
          probe.height = source.height;
          const context2d = probe.getContext("2d");
          if (!context2d) return false;
          context2d.drawImage(source, 0, 0);
          const pixels = context2d.getImageData(
            0,
            0,
            probe.width,
            probe.height,
          ).data;
          let visible = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              (pixels[index] ?? 255) < 80 &&
              (pixels[index + 1] ?? 255) < 80 &&
              (pixels[index + 2] ?? 255) < 80 &&
              (pixels[index + 3] ?? 0) > 128
            )
              visible += 1;
          }
          return visible > 80;
        })) === true;
    }
    assert.ok(
      recovered,
      "The canvas must repaint after a WebGL context restore",
    );
    const after = await state(page);
    assert.equal(after.level.id, 10);
    assert.deepEqual(
      after.remainingIds,
      before.remainingIds,
      "Level 10 must keep every arrow through a context loss",
    );
    await page.screenshot({ path: `${output}/context/01-recovered.png` });

    assert.deepEqual(errors, [], "Context recovery must not log page errors");
  } finally {
    await context.close();
  }
  console.log(
    "PASS frame/input budgets and WebGL context-loss recovery with state intact",
  );
}
