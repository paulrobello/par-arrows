import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { waitForReady } from "./runtime-fixtures";

interface FrameRead {
  backingAspect: number;
  cssAspect: number;
  cssWidth: number;
  backingWidth: number;
}

async function readCanvasFrame(page: Page): Promise<FrameRead> {
  const read = await page.evaluate((): FrameRead | null => {
    const canvas =
      document.querySelector<HTMLCanvasElement>("canvas.game-canvas");
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    return {
      backingAspect: canvas.width / canvas.height,
      cssAspect: box.width / box.height,
      cssWidth: box.width,
      backingWidth: canvas.width,
    };
  });
  assert.ok(read, "The game canvas must exist and be laid out");
  return read;
}

async function waitForFrameAgreement(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const canvas =
      document.querySelector<HTMLCanvasElement>("canvas.game-canvas");
    if (!canvas) return false;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    return (
      Math.abs(box.width / box.height - canvas.width / canvas.height) /
        (box.width / box.height) <
      0.02
    );
  });
}

export async function assertResizeTracking(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/resize`, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
    const initial = await readCanvasFrame(page);
    assert.ok(
      Math.abs(initial.backingAspect - initial.cssAspect) / initial.cssAspect <
        0.02,
      "The backing store must match the laid-out canvas box in portrait",
    );

    // iOS rotation updates the element layout without a second window resize
    // event after the new geometry is committed, so only an element observer
    // sees the settled box. Squeeze the stage into a landscape box directly —
    // the viewport, and therefore the window resize event, stay untouched.
    await page.evaluate(() => {
      const stage = document.getElementById("game-stage");
      if (!stage) throw new Error("game stage is missing");
      stage.style.width = "844px";
      stage.style.height = "390px";
    });
    await waitForFrameAgreement(page);
    await page.screenshot({ path: `${output}/resize/01-stage-only.png` });

    await page.evaluate(() => {
      const stage = document.getElementById("game-stage");
      if (!stage) throw new Error("game stage is missing");
      stage.removeAttribute("style");
    });
    await waitForFrameAgreement(page);

    // The same tracking must hold through a full emulated device rotation.
    await page.setViewportSize({ width: 844, height: 390 });
    await waitForFrameAgreement(page);
    const rotated = await readCanvasFrame(page);
    assert.ok(
      Math.abs(rotated.backingAspect - rotated.cssAspect) / rotated.cssAspect <
        0.02,
      "The backing store must match the laid-out canvas box in landscape",
    );
    await page.screenshot({ path: `${output}/resize/02-landscape.png` });

    assert.deepEqual(errors, [], "Resize tracking must not log page errors");
  } finally {
    await context.close();
  }
  console.log(
    "PASS canvas backing store tracks stage-only, restored, and rotated layout",
  );
}
