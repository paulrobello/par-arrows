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

interface BoxRead {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

async function measureBoxes(
  page: Page,
  selectors: string[],
): Promise<Record<string, BoxRead>> {
  const read = await page.evaluate((requested) => {
    const boxes: Record<string, BoxRead | null> = {};
    for (const selector of requested as string[]) {
      const element = document.querySelector(selector);
      if (!element) {
        boxes[selector] = null;
        continue;
      }
      const box = element.getBoundingClientRect();
      boxes[selector] = {
        width: box.width,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      };
    }
    return boxes;
  }, selectors);
  for (const selector of selectors) {
    const box = read[selector];
    assert.ok(box, `${selector} must be present to measure`);
    assert.ok(box.width > 0 && box.height > 0, `${selector} must be readable`);
  }
  return read as Record<string, BoxRead>;
}

function pickBox(read: Record<string, BoxRead>, selector: string): BoxRead {
  const box = read[selector];
  assert.ok(box, `${selector} must be measured`);
  return box;
}

function assertSeparate(
  first: BoxRead,
  second: BoxRead,
  firstLabel: string,
  secondLabel: string,
): void {
  const gap = 2;
  const separated =
    first.right + gap <= second.left ||
    second.right + gap <= first.left ||
    first.bottom + gap <= second.top ||
    second.bottom + gap <= first.top;
  assert.ok(
    separated,
    `${firstLabel} (${JSON.stringify(first)}) must not overlap ${secondLabel} (${JSON.stringify(second)})`,
  );
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

    // Demo mode shows the tutorial card; at phone widths it must not sit on
    // the gesture-help line, and at narrow desktop widths the help line must
    // not sit on the control dock.
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.locator("#tutorial").isVisible(),
      true,
      "Demo mode must show the tutorial card",
    );
    const phone = await measureBoxes(page, [".tutorial-card", ".gesture-help"]);
    assertSeparate(
      pickBox(phone, ".tutorial-card"),
      pickBox(phone, ".gesture-help"),
      "Tutorial card",
      "gesture help (390px)",
    );
    await page.screenshot({ path: `${output}/resize/03-phone-tutorial.png` });

    await page.setViewportSize({ width: 320, height: 690 });
    const narrow = await measureBoxes(page, [
      ".tutorial-card",
      ".gesture-help",
    ]);
    assertSeparate(
      pickBox(narrow, ".tutorial-card"),
      pickBox(narrow, ".gesture-help"),
      "Tutorial card",
      "gesture help (320px)",
    );

    for (const width of [900, 1000, 1100]) {
      await page.setViewportSize({ width, height: 700 });
      const desktop = await measureBoxes(page, [
        ".control-dock",
        ".gesture-help",
      ]);
      assertSeparate(
        pickBox(desktop, ".control-dock"),
        pickBox(desktop, ".gesture-help"),
        "Control dock",
        `gesture help (${width}px)`,
      );
    }

    assert.deepEqual(errors, [], "Resize tracking must not log page errors");
  } finally {
    await context.close();
  }
  console.log(
    "PASS canvas backing-store tracking and tutorial/help/dock layout bounds",
  );
}
