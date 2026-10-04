import assert from "node:assert/strict";
import type { Browser } from "playwright";

/**
 * The settings guide lists exactly the mechanics whose introduction cubes
 * the campaign has reached, thumbnail and one-line rule each, and hides the
 * rest behind a "clear more cubes" note.
 */
export async function assertMechanicsGuide(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(`${output}/help`, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("requestfailed", (request) => failures.push(request.url()));
  try {
    await page.goto(url);
    await waitForGuide(page);
    assert.equal(
      await itemCount(page),
      1,
      "A fresh campaign shows arrows only",
    );
    assert.equal(
      await page.locator("#mechanics-list li strong").first().textContent(),
      "Arrows",
    );
    assert.equal(
      await page.locator("#mechanics-more").isVisible(),
      true,
      "Unmet mechanics stay hidden behind the progress note",
    );
    await page
      .locator("#settings-panel")
      .screenshot({ path: `${output}/help/01-fresh.png` });

    // Reaching cube 61 reveals every mechanic through the leap pads.
    await context.addInitScript(() =>
      localStorage.setItem(
        "par-arrows:campaign:v1",
        JSON.stringify({
          contentVersion: 18,
          currentLevelId: 61,
          unlockedLevelId: 61,
        }),
      ),
    );
    await page.reload();
    await waitForGuide(page);
    assert.equal(await itemCount(page), 13, "Cube 61 reveals all mechanics");
    assert.equal(
      await page.locator("#mechanics-list li strong").last().textContent(),
      "Leap pads",
    );
    assert.equal(
      await page.locator("#mechanics-more").isVisible(),
      false,
      "Nothing is hidden once every mechanic has been met",
    );
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll<HTMLImageElement>("#mechanics-list img"),
      ].every((image) => image.complete && image.naturalWidth > 0),
    );
    assert.deepEqual(failures, [], "Every thumbnail must load");
    await page
      .locator("#settings-panel")
      .screenshot({ path: `${output}/help/02-complete.png` });
    console.log("PASS settings mechanics guide");
  } finally {
    await context.close();
  }
}

async function waitForGuide(page: import("playwright").Page): Promise<void> {
  await page.locator("#settings-button").click();
  await page.waitForSelector("#mechanics-list li");
}

async function itemCount(page: import("playwright").Page): Promise<number> {
  return page.locator("#mechanics-list li").count();
}
