import assert from "node:assert/strict";
import type { Page } from "playwright";

/** Explicit wallet fixture; loading a test level must never award coins. */
export async function fundHints(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = "par-arrows:campaign:v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(
      key,
      JSON.stringify({
        ...saved,
        economy: {
          version: 1,
          coins: 200,
          rewarded: [[1, 20]],
        },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
}

export function campaignProgress(raw: string | null): unknown {
  assert.ok(raw);
  const row = JSON.parse(raw);
  delete row.economy;
  return row;
}

/** Let the durable purchase resolve between camera travel and flash time. */
export async function advanceHint(
  page: Page,
  milliseconds: number,
): Promise<void> {
  const steps = Math.max(1, Math.ceil(milliseconds / 100));
  for (let index = 0; index < steps; index += 1) {
    const purchasing = await page.evaluate((ms) => {
      window.advanceTime?.(ms);
      return (
        JSON.parse(window.render_game_to_text?.() ?? "{}").hint?.purchasing ===
        true
      );
    }, milliseconds / steps);
    if (purchasing)
      await page.waitForFunction(
        () =>
          JSON.parse(window.render_game_to_text?.() ?? "{}").hint
            ?.purchasing !== true,
      );
  }
}
