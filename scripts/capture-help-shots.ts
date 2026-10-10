/**
 * Recaptures the settings guide's mechanic thumbnails into public/help/.
 * Serve the production build first, then run:
 *   make build && bun x vite preview --port 8058 --strictPort &
 *   bun scripts/capture-help-shots.ts
 * Kill the preview server afterwards. Each thumbnail is the canvas of the
 * mechanic's introduction cube, so the guide's pictures always match play.
 * Pass mechanic IDs to refresh only changed lessons. HELP_HEADLESS=1 permits
 * draft software captures; these do not replace real-GPU acceptance.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = "http://localhost:8058";
const SHOTS: ReadonlyArray<readonly [string, string]> = [
  ["arrows", "/?test=1"],
  ["stop", "/?feature=stop&test=1"],
  ["wrap", "/?feature=wrap&test=1"],
  ["overlap", "/?feature=overlap&test=1"],
  ["directional", "/?feature=directional&test=1"],
  ["double", "/?feature=double&test=1"],
  ["flip", "/?feature=flip&test=1"],
  ["wormhole", "/?feature=wormhole&test=1"],
  ["rotor", "/?feature=rotor&test=1"],
  ["fragile", "/?feature=fragile&test=1"],
  ["lock", "/?feature=lock&test=1"],
  ["mirror", "/?feature=mirror&test=1"],
  ["leap", "/?feature=leap&test=1"],
];

const requested = process.argv.slice(2);
for (const id of requested)
  if (!SHOTS.some(([known]) => known === id))
    throw new Error(`Unknown mechanic: ${id}`);
const shots = requested.length
  ? SHOTS.filter(([id]) => requested.includes(id))
  : SHOTS;
const headless = process.env.HELP_HEADLESS === "1";
if (headless)
  console.log(
    "Draft headless captures; hardware-GPU acceptance remains required.",
  );
const browser = await chromium.launch({ headless });
const context = await browser.newContext({
  viewport: { width: 560, height: 380 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});
const page = await context.newPage();
await mkdir(new URL("../public/help/", import.meta.url), { recursive: true });
for (const [id, path] of shots) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector("canvas");
  await page.waitForTimeout(1800);
  await page.locator("canvas").screenshot({
    path: new URL(`../public/help/${id}.png`, import.meta.url).pathname,
  });
  console.log(`captured ${id}`);
}
await browser.close();
