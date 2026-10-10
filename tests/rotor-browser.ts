import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { generateLevel, rotorCoreIds } from "../src/content/procedural";
import { ROTOR_INTRO_LEVEL } from "../src/content/rotor-intro";
import { spotStates } from "../src/core/directionals";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey, cellToWorld, faceNormal } from "../src/core/topology";
import type { Cell, FaceId, Heading } from "../src/core/types";
import { solveLevelTargets } from "../src/core/validation";
import { waitForReady } from "./runtime-fixtures";

const TURNER = "rotor-intro-turner";
const BENDER = "rotor-intro-bender";
const ROTOR: Cell = { face: "front", x: 2, y: 1 };
const ROTOR_KEY = cellKey(ROTOR);
/** Representative generated phased-lane circuit; its solver supplies the tap order. */
const GENERATED_LEVEL = 58;

interface DirectionalSpotText {
  cell: string;
  heading: string;
  kind: string;
  current: string;
}

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  directionals: DirectionalSpotText[];
  pendingFlips: string[];
  spotGlyphTurns: Record<string, number>;
  stops: string[];
  settledPaths: Record<string, Cell[]>;
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
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

interface TutorialState {
  active: boolean;
  highlightId?: string;
  gate?: string[];
}

interface Frame {
  frame: string;
  state: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

/** Click an arrow where the renderer currently projects it on screen. */
async function clickArrow(page: Page, arrowId: string): Promise<void> {
  const point = (await state(page)).visibleProjectedArrowPositions.find(
    (entry) => entry.id === arrowId,
  );
  assert.ok(point, `Arrow ${arrowId} must be visible to click`);
  const bounds = await page.locator("canvas").boundingBox();
  assert.ok(bounds);
  await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
  await finishMotion(page);
}

async function activate(page: Page, arrowId: string): Promise<void> {
  await page.evaluate(
    (id) => window.__PAR_ARROWS_TEST__?.activate(id),
    arrowId,
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

/** Orbit until `face` looks at the camera. */
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

/**
 * Starts a move and reads the diagnostics at each elapsed time inside one
 * page task, so the live animation loop cannot advance the motion between
 * frames.
 */
async function captureMotion(
  page: Page,
  arrowId: string,
  times: readonly number[],
): Promise<Frame[]> {
  return page.evaluate(
    ({ arrowId, times }) => {
      const test = window.__PAR_ARROWS_TEST__;
      const canvas = document.querySelector("canvas");
      if (!test || !canvas) throw new Error("Test hooks and canvas required");
      test.activate(arrowId);
      let elapsed = 0;
      return times.map((time) => {
        window.advanceTime?.(time - elapsed);
        elapsed = time;
        test.render();
        return {
          frame: canvas.toDataURL("image/png"),
          state: window.render_game_to_text?.() ?? "{}",
        };
      });
    },
    { arrowId, times },
  );
}

function frameBuffer(frame: Frame): Buffer {
  return Buffer.from(
    frame.frame.replace(/^data:image\/png;base64,/, ""),
    "base64",
  );
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

/** Pixels in the CSS-pixel rect whose color moved by more than a small tolerance. */
async function changedPixels(
  first: Buffer,
  second: Buffer,
  rect: Rect,
  ratio: number,
): Promise<number> {
  const [left, right] = await Promise.all([decode(first), decode(second)]);
  assert.equal(left.width, right.width);
  assert.equal(left.height, right.height);
  const { width, height } = left;
  const x0 = Math.max(0, Math.round(rect.x * ratio));
  const y0 = Math.max(0, Math.round(rect.y * ratio));
  const x1 = Math.min(width, Math.round((rect.x + rect.width) * ratio));
  const y1 = Math.min(height, Math.round((rect.y + rect.height) * ratio));
  assert.ok(x1 > x0 && y1 > y0, "Crop must fall inside the canvas");
  let changed = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.abs(
          (left.data[offset + channel] ?? 0) -
            (right.data[offset + channel] ?? 0),
        );
        if (delta > 24) {
          changed += 1;
          break;
        }
      }
    }
  }
  return changed;
}

/** Pixels in the CSS-pixel rect that satisfy `match`. */
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

// Light rotor 0x8f6f1a and dark rotor 0xc9a24a. Each window excludes the
// brighter wrap-edge yellow and nudge orange of its theme.
const lightAmber = (r: number, g: number, b: number): boolean =>
  r >= 115 && r <= 172 && g >= 85 && g <= 135 && b <= 60 && r - g >= 15;
const darkAmber = (r: number, g: number, b: number): boolean =>
  r >= 175 &&
  r <= 225 &&
  g >= 135 &&
  g <= 185 &&
  b >= 45 &&
  b <= 105 &&
  r - g >= 20 &&
  r - g <= 60;

/** Canvas-relative CSS position of a cell center under the current camera. */
async function projectCell(
  page: Page,
  cell: Cell,
  gridSize: number,
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
  const [x, y, z] = cellToWorld(cell, gridSize);
  const point = new Vector3(x, y, z).project(camera);
  return {
    x: ((point.x + 1) * bounds.width) / 2,
    y: ((1 - point.y) * bounds.height) / 2,
  };
}

/** A square around a cell whose half side is `share` of the projected cell pitch. */
async function cellRect(
  page: Page,
  cell: Cell,
  gridSize: number,
  share: number,
): Promise<Rect> {
  const center = await projectCell(page, cell, gridSize);
  const neighbor = await projectCell(
    page,
    { ...cell, x: cell.x + (cell.x + 1 < gridSize ? 1 : -1) },
    gridSize,
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

export async function assertRotorIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/rotor`, { recursive: true });
  await assertPreviewEntry(browser, url, output);
  await assertScriptedWalkthrough(browser, url, output);
  await assertSeenPlayAndReload(browser, url, output);
  await assertGeneratedCore(browser, url, output);
}

/**
 * `?feature=rotor` opens the introduction as a preview: no walkthrough runs,
 * no campaign save is written, and the rotor draws in its own amber in both
 * themes.
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
  try {
    // `url` already carries `?test=1`.
    await page.goto(`${url}&feature=rotor`);
    await waitForReady(page);
    const current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, ROTOR_INTRO_LEVEL.id);
    assert.deepEqual(
      current.directionals.map((spot) => [spot.cell, spot.kind, spot.current]),
      [[ROTOR_KEY, "rotor", "west"]],
    );
    assert.deepEqual(current.pendingFlips, []);
    assert.deepEqual(current.spotGlyphTurns, { [ROTOR_KEY]: 0 });
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A preview must not run the walkthrough",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Rotor preview must not create campaign state",
    );

    await resetCamera(page);
    await faceCamera(page, ROTOR.face);
    const rect = await cellRect(page, ROTOR, ROTOR_INTRO_LEVEL.gridSize, 0.5);
    const light = await canvasShot(page);
    const ratio = await canvasRatio(page, light);
    await writeFile(`${output}/rotor/00-preview-light.png`, light);

    // A theme swap restyles the rotor from its light amber to its dark amber.
    await page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>("#theme-select");
      if (!select) throw new Error("Theme select required");
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      window.__PAR_ARROWS_TEST__?.render();
    });
    const dark = await canvasShot(page);
    await writeFile(`${output}/rotor/00-preview-dark.png`, dark);
    const lightInLight = await matchingPixels(light, rect, ratio, lightAmber);
    const darkInDark = await matchingPixels(dark, rect, ratio, darkAmber);
    const lightInDark = await matchingPixels(dark, rect, ratio, lightAmber);
    console.log(
      `rotor: glyph amber ${lightInLight} px light, ${darkInDark} px dark, ${lightInDark} px light-amber after the swap`,
    );
    assert.ok(
      lightInLight > 60,
      `The light-theme rotor must show its amber (${lightInLight} px)`,
    );
    assert.ok(
      darkInDark > 60,
      `The dark-theme rotor must show its amber (${darkInDark} px)`,
    );
    assert.ok(
      lightInDark * 4 < lightInLight,
      `The theme swap must restyle the rotor (${lightInDark} light-amber px remain)`,
    );
    assert.deepEqual(errors, [], "No page errors in the rotor preview");
  } finally {
    await context.close();
  }
}

/**
 * First-run walkthrough, in campaign play (preview sessions never run the
 * script): the gate refuses the bender, the turner runs head-on into the
 * rotor and reverses out, the glyph turns a quarter once its body has passed,
 * and the bender then bends north through the turned rotor.
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
    await openCampaignLevel(page, ROTOR_INTRO_LEVEL.id);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, 40);
    assert.deepEqual(
      current.directionals.map((spot) => [spot.cell, spot.kind, spot.current]),
      [[ROTOR_KEY, "rotor", "west"]],
    );
    assert.deepEqual(current.pendingFlips, []);
    const script = await tutorialState(page);
    assert.ok(script.active, "The walkthrough must run on first sight");
    assert.equal(script.highlightId, TURNER);
    assert.deepEqual(script.gate, [TURNER]);
    await page.screenshot({ path: `${output}/rotor/01-intro.png` });

    // Walkthrough gate: the bender does not respond before the turner.
    await clickArrow(page, BENDER);
    current = await state(page);
    assert.equal(current.lives, ROTOR_INTRO_LEVEL.lives, "Gated taps are free");
    assert.deepEqual(current.failedIds, []);
    assert.equal(current.remainingIds.length, ROTOR_INTRO_LEVEL.arrows.length);
    assert.equal(current.directionals[0]?.current, "west");
    assert.equal((await tutorialState(page)).highlightId, TURNER);

    // The turner's 850 ms exit reports the advance after 3 head steps, so the
    // glyph turns between about 300 and 402 ms of travel: untouched at 250,
    // part-way at 350 and a full quarter at 460, while the diagnostic spot
    // state only settles once the move ends.
    await page.waitForTimeout(700);
    const frames = await captureMotion(page, TURNER, [250, 350, 460]);
    const turns = frames.map((frame) => {
      const text = JSON.parse(frame.state) as State;
      assert.equal(text.moving?.kind, "exit");
      assert.equal(text.directionals[0]?.current, "west");
      return text.spotGlyphTurns[ROTOR_KEY] ?? Number.NaN;
    });
    const [before, during, after] = frames;
    assert.ok(before && during && after);
    await writeFile(`${output}/rotor/02-turn-250ms.png`, frameBuffer(before));
    await writeFile(`${output}/rotor/02-turn-350ms.png`, frameBuffer(during));
    await writeFile(`${output}/rotor/02-turn-460ms.png`, frameBuffer(after));
    console.log(`rotor: level 40 glyph turns at 250/350/460 ms ${turns}`);
    assert.equal(turns[0], 0, "The glyph waits while the turner covers it");
    assert.ok(
      (turns[1] ?? 0) > 0 && (turns[1] ?? 1) < 1,
      `The glyph is mid-turn at 350 ms (${turns[1]})`,
    );
    assert.equal(turns[2], 1, "The glyph completes its quarter turn");

    await finishMotion(page);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(TURNER));
    assert.equal(current.directionals[0]?.current, "north");
    assert.deepEqual(current.spotGlyphTurns, { [ROTOR_KEY]: 1 });
    assert.deepEqual(current.pendingFlips, []);
    assert.equal(current.lives, ROTOR_INTRO_LEVEL.lives);
    assert.equal((await tutorialState(page)).highlightId, BENDER);
    await page.screenshot({ path: `${output}/rotor/03-after-turner.png` });

    await clickArrow(page, BENDER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(BENDER));
    assert.equal(current.directionals[0]?.current, "east");
    assert.deepEqual(current.spotGlyphTurns, { [ROTOR_KEY]: 2 });
    assert.equal(current.lives, ROTOR_INTRO_LEVEL.lives);
    await page.screenshot({ path: `${output}/rotor/04-after-bender.png` });

    current = await state(page);
    assert.deepEqual(current.remainingIds, [], "Free play clears the cube");
    assert.equal(current.lives, ROTOR_INTRO_LEVEL.lives);
    assert.equal((await tutorialState(page)).active, false);
    assert.deepEqual(errors, [], "No page errors during the walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * With the walkthrough seen, the turned rotor survives a reload partway
 * through level 40 with its glyph matching the diagnostic, and the bender
 * then bends out through it.
 */
async function assertSeenPlayAndReload(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  // The rule under test: the bender runs straight into the turner at the
  // authored west heading, and bends clear once the turner has turned it.
  const initial = createGameState(ROTOR_INTRO_LEVEL);
  assert.equal(
    simulateMove(ROTOR_INTRO_LEVEL, initial, BENDER).blockerId,
    TURNER,
  );
  const afterTurner = applyMove(
    ROTOR_INTRO_LEVEL,
    initial,
    simulateMove(ROTOR_INTRO_LEVEL, initial, TURNER),
  );
  assert.equal(
    simulateMove(ROTOR_INTRO_LEVEL, afterTurner, BENDER).kind,
    "exit",
  );

  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  await context.addInitScript(
    (settings) => {
      if (!localStorage.getItem("par-arrows:settings:v1"))
        localStorage.setItem("par-arrows:settings:v1", settings);
    },
    JSON.stringify({
      gridLines: true,
      reducedMotion: false,
      theme: "light",
      tutorialSeenLevels: [ROTOR_INTRO_LEVEL.id],
    }),
  );
  const page = await context.newPage();
  const errors = watchErrors(page);
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, ROTOR_INTRO_LEVEL.id);
    assert.equal((await tutorialState(page)).active, false);

    await resetCamera(page);
    const rect = await cellRect(page, ROTOR, ROTOR_INTRO_LEVEL.gridSize, 0.38);
    const west = await canvasShot(page);

    await activate(page, TURNER);
    let current = await state(page);
    assert.equal(current.directionals[0]?.current, "north");
    assert.deepEqual(current.pendingFlips, []);
    await resetCamera(page);
    const north = await canvasShot(page);

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, ROTOR_INTRO_LEVEL.id);
    assert.equal(
      current.directionals[0]?.current,
      "north",
      "The turned rotor survives a reload",
    );
    assert.deepEqual(current.spotGlyphTurns, { [ROTOR_KEY]: 1 });
    assert.ok(!current.remainingIds.includes(TURNER));
    assert.ok(current.remainingIds.includes(BENDER));
    assert.equal(current.lives, ROTOR_INTRO_LEVEL.lives);
    await resetCamera(page);
    const reloaded = await canvasShot(page);
    await writeFile(`${output}/rotor/05-glyph-west.png`, west);
    await writeFile(`${output}/rotor/06-glyph-north.png`, north);
    await writeFile(`${output}/rotor/07-glyph-reloaded.png`, reloaded);

    const ratio = await canvasRatio(page, reloaded);
    const drift = await changedPixels(north, reloaded, rect, ratio);
    const turned = await changedPixels(west, reloaded, rect, ratio);
    console.log(
      `rotor: glyph after reload drift ${drift} px vs north, ${turned} px vs west`,
    );
    assert.ok(
      turned > 40 && turned > Math.max(1, drift) * 5,
      `The reloaded glyph must match the north diagnostic (drift ${drift} px, turned ${turned} px)`,
    );

    await activate(page, BENDER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(BENDER));
    assert.deepEqual(current.failedIds, []);
    assert.equal(current.lives, ROTOR_INTRO_LEVEL.lives);
    assert.equal(current.directionals[0]?.current, "east");
    await page.screenshot({ path: `${output}/rotor/08-bender-out.png` });
    assert.deepEqual(errors, [], "No page errors during seen play");
  } finally {
    await context.close();
  }
}

/**
 * A synthesized rotor circuit plays through on the full board: its parker
 * passes the rotor and pauses, a reload keeps its exact path and the turned
 * heading, and the remaining lane circuit clears without losing a life.
 */
async function assertGeneratedCore(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const level = generateLevel(GENERATED_LEVEL);
  const rotors = (level.directionals ?? []).filter(
    (spot) => spot.kind === "rotor",
  );
  assert.equal(rotors.length, 1, `Level ${GENERATED_LEVEL} carries one rotor`);
  const rotor = rotors[0];
  assert.ok(rotor);
  const rotorKey = cellKey(rotor.cell);
  const ids = rotorCoreIds(level.arrows);
  const inside = new Set(ids);
  const targets = solveLevelTargets({
    ...level,
    arrows: level.arrows.filter((arrow) => inside.has(arrow.id)),
  });
  assert.ok(targets, "The synthesized rotor circuit has a safe tap order");
  const order = targets.map((target) => target.arrowId);
  const opener = order[0] as string;

  // Replay the core in Node on the full board to fix the expected headings.
  let replay = createGameState(level);
  const expected: { kind: string; heading: Heading }[] = [];
  for (const id of order) {
    const result = simulateMove(level, replay, id);
    assert.ok(
      result.kind === "exit" || result.kind === "paused",
      `${id} must move without a collision (${result.kind})`,
    );
    replay = applyMove(level, replay, result);
    expected.push({
      kind: result.kind,
      heading: replay.spotHeadings?.[rotorKey] ?? rotor.heading,
    });
  }
  assert.equal(expected[0]?.kind, "paused", "The opener parks first");
  const parkedPath = applyMove(
    level,
    createGameState(level),
    simulateMove(level, createGameState(level), opener),
  ).settledPaths?.[opener];
  assert.ok(parkedPath, "A lone single on a rotor level parks by exact path");
  assert.ok(
    new Set([rotor.heading, ...expected.map((step) => step.heading)]).size >= 3,
    "The phased circuit settles multiple quarter-turns",
  );

  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
  const rotorOf = (current: State) =>
    current.directionals.find((spot) => spot.cell === rotorKey);
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, GENERATED_LEVEL);
    const pagePaths = await page.evaluate(
      (wanted) =>
        wanted.map((id) =>
          window.__PAR_ARROWS_TEST__
            ?.getLevel()
            .arrows.find((arrow) => arrow.id === id)
            ?.path.map((cell) => `${cell.face}:${cell.x}:${cell.y}`),
        ),
      ids,
    );
    assert.deepEqual(
      pagePaths,
      ids.map((id) =>
        level.arrows.find((arrow) => arrow.id === id)?.path.map(cellKey),
      ),
      "The page must build the same cube as the Node generator",
    );
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(rotorOf(current)?.kind, "rotor");
    assert.equal(rotorOf(current)?.current, rotor.heading);
    await faceCamera(page, rotor.cell.face);
    await page.screenshot({
      path: `${output}/rotor/09-level${GENERATED_LEVEL}-start.png`,
    });

    await activate(page, opener);
    current = await state(page);
    assert.deepEqual(
      current.settledPaths[opener]?.map(cellKey),
      parkedPath.map(cellKey),
      "The opener parks on the core's circle",
    );
    assert.ok(current.stops.includes(cellKey(parkedPath.at(-1) as Cell)));
    assert.equal(rotorOf(current)?.current, expected[0]?.heading);
    assert.equal(
      current.spotGlyphTurns[rotorKey],
      spotStates(rotor).indexOf(expected[0]?.heading as Heading),
    );
    assert.equal(current.lives, level.lives);

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, GENERATED_LEVEL);
    assert.deepEqual(
      current.settledPaths[opener]?.map(cellKey),
      parkedPath.map(cellKey),
      "The parked single survives a reload",
    );
    assert.equal(
      rotorOf(current)?.current,
      expected[0]?.heading,
      "The turned rotor survives a reload",
    );

    const seen: string[] = [rotor.heading, expected[0]?.heading as string];
    for (const [index, id] of order.entries()) {
      if (index === 0) continue;
      await activate(page, id);
      current = await state(page);
      const step = expected[index];
      assert.ok(step);
      assert.ok(!current.remainingIds.includes(id), `${id} leaves the cube`);
      assert.equal(current.lives, level.lives, `${id} costs no life`);
      assert.equal(rotorOf(current)?.current, step.heading);
      assert.equal(
        current.spotGlyphTurns[rotorKey],
        spotStates(rotor).indexOf(step.heading),
        `The glyph settles on ${step.heading} after ${id}`,
      );
      seen.push(step.heading);
    }
    await faceCamera(page, rotor.cell.face);
    await page.screenshot({
      path: `${output}/rotor/10-level${GENERATED_LEVEL}-core-cleared.png`,
    });
    console.log(
      `rotor: level ${GENERATED_LEVEL} core parks ${opener} across a reload and turns ${rotorKey} ${seen.join(" -> ")}`,
    );
    assert.deepEqual(current.failedIds, []);
    assert.deepEqual(
      errors,
      [],
      `No page errors during the level ${GENERATED_LEVEL} core`,
    );
  } finally {
    await context.close();
  }
}
