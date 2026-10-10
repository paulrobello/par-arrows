import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { MIRROR_INTRO_LEVEL } from "../src/content/mirror-intro";
import {
  generateLevel,
  MIRROR_CORE_MARKER,
  mirrorCorePlanned,
} from "../src/content/procedural";
import { cellKey, cellToWorld, faceNormal } from "../src/core/topology";
import { solveLevelTargets } from "../src/core/validation";
import type { Cell, FaceId } from "../src/core/types";
import { THEME_PALETTES } from "../src/render/renderer";
import { waitForReady } from "./runtime-fixtures";

const NORTH = "mirror-intro-north";
const EAST = "mirror-intro-east";
const RELEASE = "mirror-intro-release";
const MIRROR_CELL = MIRROR_INTRO_LEVEL.mirrors?.[0]?.cell as Cell;

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  mirrors: { cell: string; orientation: string }[];
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

async function mirrorPixels(
  page: Page,
  image: Buffer,
  cell: Cell,
  gridSize: number,
  theme: "light" | "dark",
): Promise<number> {
  const ratio = await canvasRatio(page, image);
  const rect = await cellRect(page, cell, gridSize, 0.44);
  return matchingPixels(image, rect, ratio, near(THEME_PALETTES[theme].mirror));
}

export async function assertMirrorIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/mirror`, { recursive: true });
  await assertPreviewEntry(browser, url, output);
  await assertScriptedWalkthrough(browser, url, output);
  await assertReloadMidLevel(browser, url, output);
  await assertGeneratedCore(browser, url, output);
}

/**
 * `?feature=mirror` opens the introduction as a preview: no walkthrough runs,
 * no campaign save is written, and the mirror draws in silver in both themes
 * and restyles on a theme swap. A northbound tap reflects east and exits.
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
  const grid = MIRROR_INTRO_LEVEL.gridSize;
  try {
    await page.goto(`${url}&feature=mirror`);
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, MIRROR_INTRO_LEVEL.id);
    assert.deepEqual(current.mirrors, [
      { cell: cellKey(MIRROR_CELL), orientation: "/" },
    ]);
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A preview must not run the walkthrough",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Mirror preview must not create campaign state",
    );

    await resetCamera(page);
    await faceCamera(page, MIRROR_CELL.face);
    const light = await canvasShot(page);
    await writeFile(`${output}/mirror/00-mirror-light.png`, light);
    await setTheme(page, "dark");
    const dark = await canvasShot(page);
    await writeFile(`${output}/mirror/00-mirror-dark.png`, dark);
    const lightMirror = await mirrorPixels(
      page,
      light,
      MIRROR_CELL,
      grid,
      "light",
    );
    const darkMirror = await mirrorPixels(
      page,
      dark,
      MIRROR_CELL,
      grid,
      "dark",
    );
    const staleMirror = await mirrorPixels(
      page,
      dark,
      MIRROR_CELL,
      grid,
      "light",
    );
    console.log(
      `mirror: ${lightMirror}/${darkMirror} px (light/dark), ${staleMirror} px light-mirror after the swap`,
    );
    assert.ok(lightMirror > 20, `Light mirror shows (${lightMirror} px)`);
    assert.ok(darkMirror > 20, `Dark mirror shows (${darkMirror} px)`);
    assert.ok(
      staleMirror * 4 < lightMirror,
      `The theme swap must restyle the mirror (${staleMirror} px remain)`,
    );

    // The northbound arrow reflects east and leaves; a preview writes nothing.
    await activate(page, NORTH);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(NORTH));
    assert.deepEqual(current.failedIds, []);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Play in a preview must not write campaign state",
    );
    assert.deepEqual(errors, [], "No page errors in the mirror preview");
  } finally {
    await context.close();
  }
}

/**
 * First-run walkthrough in campaign play: the walkthrough refuses the east
 * arrow while it waits for the north one, the north arrow reflects east and
 * leaves, the walkthrough then asks for the east arrow, and the level clears.
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
    await openCampaignLevel(page, 55);
    let tutorial = await tutorialState(page);
    assert.equal(tutorial.active, true);
    assert.equal(tutorial.highlightId, NORTH);

    // The gated script ignores the east arrow while it waits for north.
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id, "head"),
      EAST,
    );
    await finishMotion(page);
    let current = await state(page);
    assert.ok(
      current.remainingIds.includes(EAST),
      "The walkthrough must ignore the east arrow first",
    );
    assert.equal(current.lives, MIRROR_INTRO_LEVEL.lives);

    await activate(page, NORTH);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(NORTH));
    tutorial = await tutorialState(page);
    assert.equal(tutorial.highlightId, RELEASE);
    await activate(page, RELEASE);
    tutorial = await tutorialState(page);
    assert.equal(tutorial.highlightId, EAST);

    await activate(page, EAST);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(EAST));

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
    await page.screenshot({ path: `${output}/mirror/01-walkthrough-won.png` });
    assert.deepEqual(errors, [], "No page errors in the mirror walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * Progress made on the authored mirror cube survives a reload: north gone,
 * lives whole, and the east arrow still leaves through the same mirror.
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
    await openCampaignLevel(page, 55);
    await activate(page, NORTH);
    let current = await state(page);
    assert.ok(!current.remainingIds.includes(NORTH));
    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.level.id, 55);
    assert.ok(
      !current.remainingIds.includes(NORTH),
      "The cleared arrow must stay cleared across a reload",
    );
    assert.deepEqual(current.failedIds, []);
    assert.deepEqual(current.mirrors, [
      { cell: cellKey(MIRROR_CELL), orientation: "/" },
    ]);
    await activate(page, RELEASE);
    await activate(page, EAST);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(EAST));
    void output;
    assert.deepEqual(errors, [], "No page errors across the reload");
  } finally {
    await context.close();
  }
}

/**
 * The first generated mirror core plays in its certified order: the page
 * builds the same cube as the Node generator, the two reflected approaches leave
 * through the mirror, and no life is lost.
 */
async function assertGeneratedCore(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  let id = 0;
  for (let levelId = 56; levelId <= 200; levelId += 1) {
    if (mirrorCorePlanned(levelId)) {
      const level = generateLevel(levelId);
      if ((level.mirrors ?? []).length > 0) {
        id = levelId;
        break;
      }
    }
  }
  assert.ok(id > 0, "Some generated level carries a mirror core");
  const level = generateLevel(id);
  const mirror = level.mirrors?.[0];
  assert.ok(mirror, `Level ${id} carries a mirror`);
  const north = `r${id}${MIRROR_CORE_MARKER}north`;
  const south = `r${id}${MIRROR_CORE_MARKER}south`;
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
      [north, south],
    );
    assert.deepEqual(
      pagePaths,
      [north, south].map((arrowId) =>
        level.arrows.find((arrow) => arrow.id === arrowId)?.path.map(cellKey),
      ),
      "The page must build the same cube as the Node generator",
    );
    let current = await state(page);
    assert.deepEqual(current.mirrors, [
      { cell: cellKey(mirror.cell), orientation: mirror.orientation },
    ]);
    await faceCamera(page, mirror.cell.face);
    await page.screenshot({
      path: `${output}/mirror/02-level${id}-start.png`,
    });

    // Lane blockers entangle the core, so replay the solver's zero-life
    // order; either face-off arrow may go first.
    const certificate = solveLevelTargets(level);
    assert.ok(certificate, `Level ${id} is solvable`);
    const positions = [north, south].map((arrowId) =>
      certificate.findIndex((t) => t.arrowId === arrowId),
    );
    assert.ok(
      positions.every((at) => at >= 0),
      "Both core arrows are certified",
    );
    assert.ok(
      certificate
        .slice(0, Math.min(...positions))
        .some((t) => !t.arrowId.includes(MIRROR_CORE_MARKER)),
      "A non-core arrow precedes the core arrows in the certificate",
    );
    for (const [index, target] of certificate
      .slice(0, Math.max(...positions) + 1)
      .entries()) {
      await activate(page, target.arrowId, target.endpoint);
      current = await state(page);
      assert.ok(
        !current.remainingIds.includes(target.arrowId),
        `Certificate step ${index} (${target.arrowId}) leaves`,
      );
      assert.equal(
        current.lives,
        level.lives,
        `Certificate step ${index} (${target.arrowId}) costs no life`,
      );
    }
    current = await state(page);
    assert.ok(
      !current.remainingIds.includes(north),
      "The northbound core arrow leaves through the mirror",
    );
    assert.ok(
      !current.remainingIds.includes(south),
      "The southbound core arrow leaves through the mirror",
    );
    assert.equal(current.lives, level.lives);
    await page.screenshot({
      path: `${output}/mirror/03-level${id}-core-cleared.png`,
    });
    assert.deepEqual(errors, [], "No page errors in the generated core");
  } finally {
    await context.close();
  }
}
