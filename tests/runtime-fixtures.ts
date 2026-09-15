import type { Page } from "playwright";
import { generateLevel } from "../src/content/procedural";

export const LEVELS = Array.from({ length: 10 }, (_, index) =>
  generateLevel(index + 1),
);

export async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const raw = window.render_game_to_text?.();
    return (
      Boolean(window.__PAR_ARROWS_TEST__) &&
      raw &&
      JSON.parse(raw).loading === false
    );
  });
  await page.waitForFunction(() => {
    const layer = document.querySelector<HTMLElement>("#generation-layer");
    return layer && getComputedStyle(layer).display === "none";
  });
}
