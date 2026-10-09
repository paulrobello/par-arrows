import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { LEAP_INTRO_LEVEL } from "../src/content/leap-intro";
import {
  generateLevel,
  LEAP_CORE_MARKER,
  leapCorePlanned,
} from "../src/content/procedural";
import { cellKey, cellToWorld, faceNormal } from "../src/core/topology";
import { solveLevelTargets } from "../src/core/validation";
import type { Cell, FaceId } from "../src/core/types";
import { THEME_PALETTES } from "../src/render/renderer";
import { waitForReady } from "./runtime-fixtures";

const LEAPER = "leap-intro-leaper";
const BARRED = "leap-intro-barred";
const PAD_CELL = LEAP_INTRO_LEVEL.leaps?.[0] as Cell;

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  leaps: string[];
  moving: {
    kind: string;
    duration: number;
    elapsed: number;
    anticipation?: number;
  } | null;
  camera: {
    position: [number, number, number];
    orientation: [number, number, number, number];
  };
}

interface TutorialState {
  active: boolean;
  highlightId?: string;
  gate?: string[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Rgb = readonly [number, number, number];

async function state(page: Page): Promise<State> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw, "Game diagnostics must be available");
  return JSON.parse(raw) as State;
}

async function tutorialState(page: Page): Promise<TutorialState> {
  return (
    (await page.evaluate(() => window.get_tutorial_state?.())) ?? {
      active: false,
    }
  );
}

async function finishMotion(page: Page): Promise<void> {
  const moving = (await state(page)).moving;
  if (moving) {
    await page.evaluate(
      (amount) => window.advanceTime?.(amount),
      Math.max(
        0,
        moving.duration + (moving.anticipation ?? 0) - moving.elapsed,
      ) + 32,
    );
  }
}

async function activate(
  page: Page,
  arrowId: string,
  endpoint: "head" | "tail" = "head",
): Promise<void> {
  await page.evaluate(
    ([id, end]) => window.__PAR_ARROWS_TEST__?.activate(id, end),
    [arrowId, endpoint] as const,
  );
  await finishMotion(page);
}

async function openCampaignLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
    levelId,
  );
  await page.waitForFunction(
    (id) =>
      JSON.parse(window.render_game_to_text?.() ?? "{}")?.level?.id === id,
    levelId,
  );
  await waitForReady(page);
}

async function resetCamera(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reset camera view" }).click();
  await page.evaluate(() => window.__PAR_ARROWS_TEST__?.render());
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((value) => {
    const select = document.querySelector<HTMLSelectElement>("#theme-select");
    if (!select) throw new Error("Theme select required");
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    window.__PAR_ARROWS_TEST__?.render();
  }, theme);
}

async function faceCamera(page: Page, face: FaceId): Promise<void> {
  const [nx, ny, nz] = faceNormal(face);
  const facing = async (): Promise<number> => {
    const [x, y, z] = (await state(page)).camera.position;
    return (x * nx + y * ny + z * nz) / Math.hypot(x, y, z);
  };
  let score = await facing();
  for (let attempt = 0; attempt < 80 && score < 0.8; attempt += 1) {
    let best: [number, number] | undefined;
    let bestScore = score;
    for (const [dx, dy] of [
      [10, 0],
      [-10, 0],
      [0, 10],
      [0, -10],
    ] as const) {
      await page.evaluate(([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y), [
        dx,
        dy,
      ] as const);
      const candidate = await facing();
      await page.evaluate(([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y), [
        -dx,
        -dy,
      ] as const);
      if (candidate > bestScore) {
        bestScore = candidate;
        best = [dx, dy];
      }
    }
    if (!best) break;
    await page.evaluate(
      ([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y),
      best,
    );
    score = bestScore;
  }
  assert.ok(score >= 0.8, `The ${face} face must face the camera`);
  await page.evaluate(() => window.__PAR_ARROWS_TEST__?.render());
}

async function decode(
  image: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const result = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
  };
}

async function matchingPixels(
  image: Buffer,
  rect: Rect,
  ratio: number,
  match: (r: number, g: number, b: number) => boolean,
): Promise<number> {
  const { data, width, height } = await decode(image);
  const x0 = Math.max(0, Math.round(rect.x * ratio));
  const y0 = Math.max(0, Math.round(rect.y * ratio));
  const x1 = Math.min(width, Math.round((rect.x + rect.width) * ratio));
  const y1 = Math.min(height, Math.round((rect.y + rect.height) * ratio));
  assert.ok(x1 > x0 && y1 > y0, "Crop must fall inside the canvas");
  let found = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 3;
      if (
        match(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0)
      )
        found += 1;
    }
  }
  return found;
}

function rgb(color: number): Rgb {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function near(color: number, tolerance = 22) {
  const [cr, cg, cb] = rgb(color);
  return (r: number, g: number, b: number): boolean =>
    Math.abs(r - cr) <= tolerance &&
    Math.abs(g - cg) <= tolerance &&
    Math.abs(b - cb) <= tolerance;
}

async function projectPoint(
  page: Page,
  world: readonly [number, number, number],
): Promise<{ x: number; y: number }> {
  const current = await state(page);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  const camera = new PerspectiveCamera(
    32,
    bounds.width / bounds.height,
    0.1,
    40,
  );
  camera.position.fromArray(current.camera.position);
  camera.quaternion.fromArray(current.camera.orientation);
  camera.updateMatrixWorld();
  const point = new Vector3(...world).project(camera);
  return {
    x: ((point.x + 1) * bounds.width) / 2,
    y: ((1 - point.y) * bounds.height) / 2,
  };
}

async function cellRect(
  page: Page,
  cell: Cell,
  gridSize: number,
  share: number,
): Promise<Rect> {
  const center = await projectPoint(page, cellToWorld(cell, gridSize));
  const neighbor = await projectPoint(
    page,
    cellToWorld(
      { ...cell, x: cell.x + (cell.x + 1 < gridSize ? 1 : -1) },
      gridSize,
    ),
  );
  const half = Math.hypot(neighbor.x - center.x, neighbor.y - center.y) * share;
  return {
    x: center.x - half,
    y: center.y - half,
    width: half * 2,
    height: half * 2,
  };
}

async function canvasShot(page: Page): Promise<Buffer> {
  return page.locator("canvas").screenshot();
}

async function canvasRatio(page: Page, image: Buffer): Promise<number> {
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  return ((await sharp(image).metadata()).width ?? 0) / bounds.width;
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function padPixels(
  page: Page,
  image: Buffer,
  cell: Cell,
  gridSize: number,
  theme: "light" | "dark",
): Promise<number> {
  const ratio = await canvasRatio(page, image);
  const rect = await cellRect(page, cell, gridSize, 0.44);
  return matchingPixels(image, rect, ratio, near(THEME_PALETTES[theme].leap));
}

export async function assertLeapIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/leap`, { recursive: true });
  await assertPreviewEntry(browser, url, output);
  await assertScriptedWalkthrough(browser, url, output);
  await assertReloadMidLevel(browser, url, output);
  await assertGeneratedCore(browser, url, output);
}

/**
 * `?feature=leap` opens the introduction as a preview: no walkthrough runs,
 * no campaign save is written, and the pad draws in amber in both themes and
 * restyles on a theme swap. Tapping the leaper hops the gate and exits.
 */
async function assertPreviewEntry(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  const grid = LEAP_INTRO_LEVEL.gridSize;
  try {
    await page.goto(`${url}&feature=leap`);
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, LEAP_INTRO_LEVEL.id);
    assert.deepEqual(current.leaps, [cellKey(PAD_CELL)]);
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A preview must not run the walkthrough",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Leap preview must not create campaign state",
    );

    await resetCamera(page);
    await faceCamera(page, PAD_CELL.face);
    const light = await canvasShot(page);
    await writeFile(`${output}/leap/00-pad-light.png`, light);
    await setTheme(page, "dark");
    const dark = await canvasShot(page);
    await writeFile(`${output}/leap/00-pad-dark.png`, dark);
    const lightPad = await padPixels(page, light, PAD_CELL, grid, "light");
    const darkPad = await padPixels(page, dark, PAD_CELL, grid, "dark");
    const stalePad = await padPixels(page, dark, PAD_CELL, grid, "light");
    console.log(
      `leap: ${lightPad}/${darkPad} px (light/dark), ${stalePad} px light-pad after the swap`,
    );
    assert.ok(lightPad > 20, `Light pad shows (${lightPad} px)`);
    assert.ok(darkPad > 20, `Dark pad shows (${darkPad} px)`);
    assert.ok(
      stalePad * 4 < lightPad,
      `The theme swap must restyle the pad (${stalePad} px remain)`,
    );

    // The leaper hops the gate, crosses the key, and leaves; a preview
    // writes nothing.
    await activate(page, LEAPER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(LEAPER));
    assert.deepEqual(current.failedIds, []);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Play in a preview must not write campaign state",
    );
    assert.deepEqual(errors, [], "No page errors in the leap preview");
  } finally {
    await context.close();
  }
}

/**
 * First-run walkthrough in campaign play: the walkthrough refuses the barred
 * arrow while it waits for the leaper, the leaper hops the gate and leaves,
 * the walkthrough then asks for the barred arrow, and the level clears.
 */
async function assertScriptedWalkthrough(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  try {
    await page.goto(url);
    await waitForReady(page);
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
    await openCampaignLevel(page, 60);
    let tutorial = await tutorialState(page);
    assert.equal(tutorial.active, true);
    assert.equal(tutorial.highlightId, LEAPER);

    // The gated script ignores the barred arrow while it waits for the leaper.
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id, "head"),
      BARRED,
    );
    await finishMotion(page);
    let current = await state(page);
    assert.ok(
      current.remainingIds.includes(BARRED),
      "The walkthrough must ignore the barred arrow first",
    );
    assert.equal(current.lives, LEAP_INTRO_LEVEL.lives);

    await activate(page, LEAPER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(LEAPER));
    tutorial = await tutorialState(page);
    assert.equal(tutorial.highlightId, BARRED);

    await activate(page, BARRED);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(BARRED));

    // Clear the rest of the cube to finish the walkthrough.
    const state1 = await state(page);
    for (const id of state1.remainingIds) {
      await activate(page, id);
    }
    current = await state(page);
    assert.deepEqual(current.remainingIds, []);
    assert.deepEqual(current.failedIds, []);
    tutorial = await tutorialState(page);
    assert.equal(tutorial.active, false);
    await page.screenshot({ path: `${output}/leap/01-walkthrough-won.png` });
    assert.deepEqual(errors, [], "No page errors in the leap walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * Progress made on the authored leap cube survives a reload: the leaper gone,
 * lives whole, and the barred arrow still leaves through the opened gate.
 */
async function assertReloadMidLevel(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  try {
    await page.goto(url);
    await waitForReady(page);
    await page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
    await openCampaignLevel(page, 60);
    await activate(page, LEAPER);
    let current = await state(page);
    assert.ok(!current.remainingIds.includes(LEAPER));
    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.level.id, 60);
    assert.ok(
      !current.remainingIds.includes(LEAPER),
      "The cleared leaper must stay cleared across a reload",
    );
    assert.deepEqual(current.failedIds, []);
    assert.deepEqual(current.leaps, [cellKey(PAD_CELL)]);
    await activate(page, BARRED);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(BARRED));
    void output;
    assert.deepEqual(errors, [], "No page errors across the reload");
  } finally {
    await context.close();
  }
}

/**
 * The first generated leap core plays in its certified order: the page builds
 * the same cube as the Node generator, the leaper hops and leaves, the
 * blocker follows, and no life is lost.
 */
async function assertGeneratedCore(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  let id = 0;
  for (let levelId = 61; levelId <= 200; levelId += 1) {
    if (leapCorePlanned(levelId)) {
      const level = generateLevel(levelId);
      if ((level.leaps ?? []).length > 0) {
        id = levelId;
        break;
      }
    }
  }
  assert.ok(id > 0, "Some generated level carries a leap core");
  const level = generateLevel(id);
  const pad = level.leaps?.[0];
  assert.ok(pad, `Level ${id} carries a leap pad`);
  const leaper = `r${id}${LEAP_CORE_MARKER}leaper`;
  const blocker = `r${id}${LEAP_CORE_MARKER}blocker`;
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, id);
    const pagePaths = await page.evaluate(
      (wanted) =>
        wanted.map((arrowId) =>
          window.__PAR_ARROWS_TEST__
            ?.getLevel()
            .arrows.find((arrow) => arrow.id === arrowId)
            ?.path.map((entry) => `${entry.face}:${entry.x}:${entry.y}`),
        ),
      [leaper, blocker],
    );
    assert.deepEqual(
      pagePaths,
      [leaper, blocker].map((arrowId) =>
        level.arrows.find((arrow) => arrow.id === arrowId)?.path.map(cellKey),
      ),
      "The page must build the same cube as the Node generator",
    );
    let current = await state(page);
    assert.deepEqual(current.leaps, [cellKey(pad)]);
    await faceCamera(page, pad.face);
    await page.screenshot({
      path: `${output}/leap/02-level${id}-start.png`,
    });

    // Lane blockers entangle the core, so replay the solver's zero-life
    // order and check both core arrows leave in it.
    const certificate = solveLevelTargets(level);
    assert.ok(certificate, `Level ${id} is solvable`);
    const leaperAt = certificate.findIndex((t) => t.arrowId === leaper);
    const blockerAt = certificate.findIndex((t) => t.arrowId === blocker);
    assert.ok(leaperAt >= 0 && blockerAt > leaperAt, "The leaper first");
    assert.ok(
      certificate
        .slice(0, leaperAt)
        .some((t) => !t.arrowId.includes(LEAP_CORE_MARKER)),
      "A non-core arrow precedes the leaper in the certificate",
    );
    for (const target of certificate.slice(0, leaperAt + 1)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    current = await state(page);
    assert.ok(!current.remainingIds.includes(leaper), "The leaper leaves");
    assert.equal(current.lives, level.lives);
    for (const target of certificate.slice(leaperAt + 1, blockerAt + 1)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    current = await state(page);
    assert.ok(!current.remainingIds.includes(blocker), "The blocker leaves");
    assert.equal(current.lives, level.lives);
    await page.screenshot({
      path: `${output}/leap/03-level${id}-core-cleared.png`,
    });
    assert.deepEqual(errors, [], "No page errors in the generated core");
  } finally {
    await context.close();
  }
}
