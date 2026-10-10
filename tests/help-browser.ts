import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";

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
  await assertLazyThumbnails(browser);
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
    await waitForThumbnails(page);
    assert.deepEqual(failures, [], "Every thumbnail must load");
    await page
      .locator("#settings-panel")
      .screenshot({ path: `${output}/help/02-complete.png` });

    // A thumbnail tap opens the mechanic enlarged and closes cleanly.
    await page.locator("#mechanics-list li").first().click();
    await page.waitForSelector("#mechanics-dialog[open]");
    assert.equal(
      await page.locator("#mechanics-dialog-title").textContent(),
      "Arrows",
    );
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>(
        "#mechanics-dialog-image",
      );
      return image !== null && image.complete && image.naturalWidth > 0;
    });
    const dialogBox = await page.locator("#mechanics-dialog").boundingBox();
    assert.ok(
      dialogBox && dialogBox.width > 300,
      "The enlarged view stays roomy on phone-sized screens",
    );
    await page.screenshot({ path: `${output}/help/03-enlarged.png` });
    await page.locator("#mechanics-dialog-close").click();
    assert.equal(await page.locator("#mechanics-dialog[open]").count(), 0);
    console.log("PASS settings mechanics guide");
  } finally {
    await context.close();
  }
}

async function waitForThumbnails(page: Page): Promise<void> {
  const images = page.locator("#mechanics-list img");
  // The guide scrolls independently of the page. Lazy images outside it may
  // never start loading until brought into view, even after network idle.
  for (let index = 0; index < (await images.count()); index++) {
    await images.nth(index).scrollIntoViewIfNeeded();
    await page.waitForFunction((index) => {
      const image = document.querySelectorAll<HTMLImageElement>(
        "#mechanics-list img",
      )[index];
      return image !== undefined && image.complete && image.naturalWidth > 0;
    }, index);
  }
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll<HTMLImageElement>("#mechanics-list img"),
    ].every((image) => image.complete && image.naturalWidth > 0),
  );
  // Keep the existing overview screenshot and first-entry tap at the top.
  await images.first().scrollIntoViewIfNeeded();
}

/** Exercise native lazy loading independently of cache and GPU behavior. */
async function assertLazyThumbnails(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 400, height: 300 },
  });
  const page = await context.newPage();
  let releaseImage = () => {};
  const imageReleased = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  try {
    await page.route("http://mechanics-guide.test/**", async (route) => {
      if (route.request().url().endsWith("/far.svg")) await imageReleased;
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"/>',
      });
    });
    await page.setContent(`
      <ul id="mechanics-list" style="height:120px;overflow:auto;margin:0">
        <li><img width="32" height="24" loading="lazy"
          src="http://mechanics-guide.test/first.svg"></li>
        <li style="height:12000px" aria-hidden="true"></li>
        <li><img width="32" height="24" loading="lazy"
          src="http://mechanics-guide.test/far.svg"></li>
      </ul>
    `);
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLImageElement>("img")?.naturalWidth === 32,
    );
    assert.equal(
      await page
        .locator("img")
        .last()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
      0,
      "The distant thumbnail must start unloaded",
    );
    const farRequested = page.waitForRequest(
      "http://mechanics-guide.test/far.svg",
    );
    await Promise.all([
      waitForThumbnails(page),
      farRequested.then(async () => {
        assert.ok(
          await page
            .locator("#mechanics-list")
            .evaluate((list) => list.scrollTop > 0),
          "Thumbnail synchronization must scroll the nested guide",
        );
        releaseImage();
      }),
    ]);
    assert.deepEqual(
      await page
        .locator("img")
        .evaluateAll((images: HTMLImageElement[]) =>
          images.map((image) => image.naturalWidth),
        ),
      [32, 32],
      "Synchronization waits for the delayed offscreen response",
    );
    assert.equal(
      await page.locator("#mechanics-list").evaluate((list) => list.scrollTop),
      0,
      "The overview returns to its first entry",
    );
    console.log("PASS lazy mechanics thumbnails in a nested scroll container");
  } finally {
    releaseImage();
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
