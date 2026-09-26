import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import { waitForReady } from "./runtime-fixtures";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID_SAMSUNG =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36";

interface PromptState {
  open: boolean;
  browser: string;
  mobile: boolean;
}

async function prompt(page: Page): Promise<PromptState> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw);
  return (JSON.parse(raw) as { pwaPrompt: PromptState }).pwaPrompt;
}

async function openSettingsDialog(page: Page): Promise<void> {
  await page.locator("#settings-button").click();
  await page.locator("#install-help-button").click();
}

export async function assertPwaPrompt(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/pwa`, { recursive: true });
  const forced = `${url}&pwaPrompt=1`;

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_SAFARI,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await phone.newPage();
    await page.goto(forced);
    await waitForReady(page);
    let state = await prompt(page);
    assert.equal(state.open, true, "First mobile launch must show the dialog");
    assert.equal(state.browser, "ios-safari");
    const steps = await page.locator("#install-steps li").allTextContents();
    assert.ok(
      steps.some((step) => step.includes("Add to Home Screen")),
      "iOS Safari steps must name Add to Home Screen",
    );
    await page.screenshot({ path: `${output}/pwa/iphone-dialog.png` });
    await page.locator("#install-close").click();
    state = await prompt(page);
    assert.equal(state.open, false);

    const stored = await page.evaluate(() =>
      localStorage.getItem("par-arrows:settings:v1"),
    );
    await page.reload();
    await waitForReady(page);
    state = await prompt(page);
    assert.equal(
      state.open,
      false,
      `A dismissed dialog must stay closed (stored settings: ${stored})`,
    );

    await openSettingsDialog(page);
    state = await prompt(page);
    assert.equal(state.open, true, "Settings must reopen the dialog");
    await page.keyboard.press("Escape");
    assert.equal((await prompt(page)).open, false);
  } finally {
    await phone.close();
  }

  const samsung = await browser.newContext({
    viewport: { width: 412, height: 915 },
    userAgent: ANDROID_SAMSUNG,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await samsung.newPage();
    await page.goto(forced);
    await waitForReady(page);
    const state = await prompt(page);
    assert.equal(state.open, true);
    assert.equal(state.browser, "samsung");
    const steps = await page.locator("#install-steps li").allTextContents();
    assert.ok(
      steps.some((step) => step.includes("Samsung Internet")),
      "Samsung steps must be browser-specific",
    );
  } finally {
    await samsung.close();
  }

  const desktop = await browser.newContext({
    viewport: { width: 1100, height: 760 },
  });
  try {
    const page = await desktop.newPage();
    await page.goto(forced);
    await waitForReady(page);
    let state = await prompt(page);
    assert.equal(state.mobile, false);
    assert.equal(state.open, false, "Desktop must not auto-show the dialog");
    await openSettingsDialog(page);
    state = await prompt(page);
    assert.equal(state.open, true, "Settings must open the dialog on desktop");
  } finally {
    await desktop.close();
  }

  const installed = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE_SAFARI,
    isMobile: true,
    hasTouch: true,
  });
  try {
    await installed.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        query.includes("display-mode: standalone")
          ? ({ ...original(query), matches: true } as MediaQueryList)
          : original(query);
    });
    const page = await installed.newPage();
    await page.goto(forced);
    await waitForReady(page);
    assert.equal(
      (await prompt(page)).open,
      false,
      "An installed app must not show the dialog",
    );
  } finally {
    await installed.close();
  }
}
