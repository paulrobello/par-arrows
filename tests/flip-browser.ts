import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { FLIP_INTRO_LEVEL } from "../src/content/flip-intro";
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey, cellToWorld, faceNormal } from "../src/core/topology";
import type { Cell, Endpoint } from "../src/core/types";
import { solveLevelTargets } from "../src/core/validation";
import { cachedLevel } from "./generated-levels";
import { waitForReady } from "./runtime-fixtures";

const REVERSER = "flip-intro-reverser";
const GUARD = "flip-intro-guard";
const RUNNER = "flip-intro-runner";
const SPOT: Cell = { face: "front", x: 1, y: 1 };

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
  stops: string[];
  settledPaths: Record<string, Cell[]>;
  parkedOffsets: Record<string, number>;
  hint: { arrowId: string } | null;
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
  ratio: number;
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

async function activate(
  page: Page,
  arrowId: string,
  endpoint: Endpoint = "head",
): Promise<void> {
  await page.evaluate(
    ({ id, end }) => window.__PAR_ARROWS_TEST__?.activate(id, end),
    { id: arrowId, end: endpoint },
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

/**
 * Starts a move and captures the canvas at each elapsed time inside one page
 * task, so the live animation loop cannot advance the motion between frames.
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
          ratio: canvas.width / canvas.clientWidth,
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

/** Pixels in the CSS-pixel rect whose color moved by more than a small tolerance. */
async function changedPixels(
  first: Buffer,
  second: Buffer,
  rect: Rect,
  ratio: number,
): Promise<number> {
  const decode = (image: Buffer) =>
    sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [left, right] = await Promise.all([decode(first), decode(second)]);
  assert.equal(left.info.width, right.info.width);
  assert.equal(left.info.height, right.info.height);
  const { width, height } = left.info;
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

async function canvasShot(page: Page): Promise<Buffer> {
  return page.locator("canvas").screenshot();
}

export async function assertFlipIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/flip`, { recursive: true });
  await assertPreviewEntry(browser, url, output);
  await assertScriptedWalkthrough(browser, url, output);
  await assertSeenPlayAndReload(browser, url, output);
  await assertGeneratedReversal(browser, url, output);
  await assertEntangledCore(browser, url);
  await assertRegionPark(browser, url);
}

/**
 * `?feature=flip` opens the introduction as a preview: no walkthrough runs
 * and no campaign save is written.
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
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    // `url` already carries `?test=1`.
    await page.goto(`${url}&feature=flip`);
    await waitForReady(page);
    const current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, FLIP_INTRO_LEVEL.id);
    assert.deepEqual(
      current.directionals.map((spot) => [spot.cell, spot.kind, spot.current]),
      [["front:1:1", "flip", "south"]],
    );
    assert.deepEqual(current.pendingFlips, []);
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A preview must not run the walkthrough",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Flip preview must not create campaign state",
    );
    await page.screenshot({ path: `${output}/flip/00-preview.png` });
    assert.deepEqual(errors, [], "No page errors in the flip preview");
  } finally {
    await context.close();
  }
}

/**
 * First-run walkthrough, in campaign play (preview sessions never run the
 * script): the gate refuses the runner, the reverser turns back over itself
 * on the spot, the glyph flips once its body has passed, and the guard then
 * the runner clear through the flipped and re-flipped spot.
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
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, FLIP_INTRO_LEVEL.id);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, 30);
    assert.deepEqual(
      current.directionals.map((spot) => [spot.cell, spot.kind, spot.current]),
      [["front:1:1", "flip", "south"]],
    );
    assert.deepEqual(current.pendingFlips, []);
    const script = await tutorialState(page);
    assert.ok(script.active, "The walkthrough must run on first sight");
    assert.equal(script.highlightId, REVERSER);
    assert.deepEqual(script.gate, [REVERSER]);
    await page.screenshot({ path: `${output}/flip/01-intro.png` });

    // Walkthrough gate: the runner does not respond before the reverser.
    await clickArrow(page, RUNNER);
    current = await state(page);
    assert.equal(current.lives, FLIP_INTRO_LEVEL.lives, "Gated taps are free");
    assert.deepEqual(current.failedIds, []);
    assert.equal(current.remainingIds.length, FLIP_INTRO_LEVEL.arrows.length);

    // The head enters the spot one cell (100 ms on this 4 x 4 cube) into the
    // move and the body clears it at about 300 ms, so both frames fall while
    // the reverser is turning back over itself on the spot.
    const reverserPoint = current.visibleProjectedArrowPositions.find(
      (entry) => entry.id === REVERSER,
    );
    assert.ok(reverserPoint, "The reverser must be on screen");
    // Let the refused tap's nudge settle so only the move changes the frames.
    await page.waitForTimeout(700);
    const frames = await captureMotion(page, REVERSER, [150, 250]);
    const [early, late] = frames;
    assert.ok(early && late);
    for (const [frame, expected] of [
      [early, 150],
      [late, 250],
    ] as const) {
      const text = JSON.parse(frame.state) as State;
      assert.equal(text.moving?.kind, "exit");
      assert.ok(
        Math.abs((text.moving?.elapsed ?? 0) - expected) <= 1,
        `Frame must land at ${expected} ms, got ${text.moving?.elapsed}`,
      );
      // The glyph has not turned mid-move: the reverser is still on the spot.
      assert.equal(text.directionals[0]?.current, "south");
    }
    await writeFile(
      `${output}/flip/02-reverser-mid-150ms.png`,
      frameBuffer(early),
    );
    await writeFile(
      `${output}/flip/02-reverser-mid-250ms.png`,
      frameBuffer(late),
    );
    const reverseRect = {
      x: reverserPoint.x - 130,
      y: reverserPoint.y - 200,
      width: 260,
      height: 300,
    };
    const moved = await changedPixels(
      frameBuffer(early),
      frameBuffer(late),
      reverseRect,
      early.ratio,
    );
    console.log(
      `flip: level 30 reverser frames 150/250 ms, ${moved} px changed`,
    );
    assert.ok(
      moved > 150,
      `The reversal must visibly animate around the arrow (${moved} px changed)`,
    );

    await finishMotion(page);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(REVERSER));
    assert.equal(current.directionals[0]?.current, "north");
    assert.deepEqual(current.pendingFlips, []);
    assert.equal(current.lives, FLIP_INTRO_LEVEL.lives);
    assert.equal((await tutorialState(page)).highlightId, GUARD);
    await page.screenshot({ path: `${output}/flip/03-after-reverse.png` });

    // Non-discriminating: the walkthrough gates hints to the guard, and the
    // guard also leads the level's candidate order, so this cannot land on the
    // runner whatever the spot reads. assertSeenPlayAndReload pins the rule.
    await page.click("#hint-button");
    const hinted = (await state(page)).hint;
    assert.ok(hinted, "A hint must be showing");
    assert.notEqual(
      hinted.arrowId,
      RUNNER,
      "The hint must read the flipped spot",
    );
    assert.equal(hinted.arrowId, GUARD);
    await page.evaluate(() => window.advanceTime?.(3200));
    assert.equal((await state(page)).hint, null);

    await clickArrow(page, GUARD);
    assert.equal((await tutorialState(page)).highlightId, RUNNER);
    await clickArrow(page, RUNNER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(RUNNER));
    assert.equal(current.directionals[0]?.current, "south");
    assert.deepEqual(current.pendingFlips, []);
    assert.equal(current.lives, 5);
    await page.screenshot({ path: `${output}/flip/04-after-runner.png` });

    current = await state(page);
    assert.deepEqual(current.remainingIds, [], "Free play clears the cube");
    assert.equal(current.lives, 5);
    assert.equal((await tutorialState(page)).active, false);
    assert.deepEqual(errors, [], "No page errors during the walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * With the walkthrough seen, the flipped spot survives a reload with its glyph
 * matching the diagnostic, and the runner (safe before the reversal, now
 * turned north into the guard) collides and costs a life.
 */
async function assertSeenPlayAndReload(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  // The rule under test: before the reversal the runner is blocked by the
  // reverser itself; after it, the flipped spot turns it into the guard.
  const initial = createGameState(FLIP_INTRO_LEVEL);
  assert.equal(
    simulateMove(FLIP_INTRO_LEVEL, initial, RUNNER).blockerId,
    REVERSER,
  );
  const afterReverse = applyMove(
    FLIP_INTRO_LEVEL,
    initial,
    simulateMove(FLIP_INTRO_LEVEL, initial, REVERSER),
  );
  const runnerAfter = simulateMove(FLIP_INTRO_LEVEL, afterReverse, RUNNER);
  assert.equal(runnerAfter.kind, "blocked");
  assert.equal(runnerAfter.blockerId, GUARD);

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
      tutorialSeenLevels: [FLIP_INTRO_LEVEL.id],
    }),
  );
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, FLIP_INTRO_LEVEL.id);
    assert.equal((await tutorialState(page)).active, false);

    const glyphRect = async (): Promise<Rect> => {
      const center = await projectCell(page, SPOT, FLIP_INTRO_LEVEL.gridSize);
      const neighbor = await projectCell(
        page,
        { ...SPOT, x: SPOT.x + 1 },
        FLIP_INTRO_LEVEL.gridSize,
      );
      const half =
        Math.hypot(neighbor.x - center.x, neighbor.y - center.y) * 0.38;
      return {
        x: center.x - half,
        y: center.y - half,
        width: half * 2,
        height: half * 2,
      };
    };

    await resetCamera(page);
    const rect = await glyphRect();
    const bounds = await page.locator("canvas").boundingBox();
    assert.ok(bounds);
    const ratioOf = async (image: Buffer): Promise<number> =>
      ((await sharp(image).metadata()).width ?? 0) / bounds.width;
    const south = await canvasShot(page);

    await activate(page, REVERSER);
    let current = await state(page);
    assert.equal(current.directionals[0]?.current, "north");
    assert.deepEqual(current.pendingFlips, []);
    await resetCamera(page);
    const north = await canvasShot(page);

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, FLIP_INTRO_LEVEL.id);
    assert.equal(current.directionals[0]?.current, "north");
    assert.ok(!current.remainingIds.includes(REVERSER));
    assert.deepEqual(current.pendingFlips, []);
    assert.equal(current.lives, FLIP_INTRO_LEVEL.lives);
    await resetCamera(page);
    const reloaded = await canvasShot(page);
    await writeFile(`${output}/flip/05-glyph-south.png`, south);
    await writeFile(`${output}/flip/06-glyph-north.png`, north);
    await writeFile(`${output}/flip/07-glyph-reloaded.png`, reloaded);

    const ratio = await ratioOf(reloaded);
    const drift = await changedPixels(north, reloaded, rect, ratio);
    const turned = await changedPixels(south, reloaded, rect, ratio);
    console.log(
      `flip: glyph after reload drift ${drift} px vs north, ${turned} px vs south`,
    );
    assert.ok(
      turned > 40 && turned > Math.max(1, drift) * 5,
      `The reloaded glyph must match the north diagnostic (drift ${drift} px, turned ${turned} px)`,
    );

    // Non-discriminating for the same reason as the walkthrough check: the
    // guard is the first safe candidate in level order in either spot state.
    await page.click("#hint-button");
    const hinted = (await state(page)).hint;
    assert.ok(hinted, "A hint must be showing");
    assert.notEqual(hinted.arrowId, RUNNER);
    await page.evaluate(() => window.advanceTime?.(3200));

    // Discriminating: the flipped spot now turns the runner into the guard.
    await activate(page, RUNNER);
    current = await state(page);
    assert.equal(current.lives, FLIP_INTRO_LEVEL.lives - 1);
    assert.ok(current.failedIds.includes(RUNNER));
    assert.ok(current.remainingIds.includes(RUNNER));
    assert.equal(current.directionals[0]?.current, "north");
    assert.deepEqual(current.pendingFlips, []);
    await page.screenshot({ path: `${output}/flip/08-runner-collision.png` });
    assert.deepEqual(errors, [], "No page errors during seen play");
  } finally {
    await context.close();
  }
}

/**
 * A generated cube's 180-degree reversal animates visibly: two frames around
 * the turn differ near the arrow. Generation re-rolls layouts (the wormhole
 * release re-rolled every generated id from 36 up), so the suite scans for the
 * first cube that still carries a bounce-style U-turn reverser.
 */
async function assertGeneratedReversal(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  let found:
    | {
        levelId: number;
        level: ReturnType<typeof generateLevel>;
        initial: ReturnType<typeof createGameState>;
        reverser: ReturnType<typeof generateLevel>["arrows"][number];
      }
    | undefined;
  for (let candidate = 31; candidate <= 200 && !found; candidate += 1) {
    const level = generateLevel(candidate);
    const initial = createGameState(level);
    const reverser = level.arrows.find((arrow) => {
      const result = simulateMove(level, initial, arrow.id);
      const keys = result.route.map(cellKey);
      return result.kind === "exit" && new Set(keys).size < keys.length;
    });
    if (reverser) found = { levelId: candidate, level, initial, reverser };
  }
  assert.ok(
    found,
    "A generated level from 31 through 200 must hold a reversing arrow",
  );
  const { levelId, level, initial, reverser } = found;

  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
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
    await openCampaignLevel(page, levelId);
    const pagePath = await page.evaluate(
      (id) =>
        window.__PAR_ARROWS_TEST__
          ?.getLevel()
          .arrows.find((arrow) => arrow.id === id)
          ?.path.map((cell) => `${cell.face}:${cell.x}:${cell.y}`),
      reverser.id,
    );
    assert.deepEqual(
      pagePath,
      reverser.path.map(cellKey),
      "The page must build the same cube as the Node generator",
    );

    // Turn the camera until the face carrying the reversal faces it.
    const route = simulateMove(level, initial, reverser.id).route;
    const routeKeys = route.map(cellKey);
    const turnStep = routeKeys.findIndex(
      (key, index) => routeKeys.indexOf(key) < index,
    );
    const turnCell = route[turnStep - 1];
    assert.ok(turnCell, "The reversal must turn on a surface cell");
    const [nx, ny, nz] = faceNormal(turnCell.face);
    const facing = async (): Promise<number> => {
      const [x, y, z] = (await state(page)).camera.position;
      return (x * nx + y * ny + z * nz) / Math.hypot(x, y, z);
    };
    // Horizontal orbit alone cannot face the top or bottom face, so probe
    // both axes each step and keep the direction that improves the facing.
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
        await page.evaluate(
          ([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y),
          [dx, dy] as const,
        );
        const candidate = await facing();
        await page.evaluate(
          ([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y),
          [-dx, -dy] as const,
        );
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
    assert.ok(score >= 0.8, `The ${turnCell.face} face must face the camera`);
    assert.ok(
      (await state(page)).visibleProjectedArrowPositions.some(
        (entry) => entry.id === reverser.id,
      ),
      `Arrow ${reverser.id} must be on screen`,
    );
    const point = await projectCell(page, turnCell, level.gridSize);

    // One cell takes (2 / gridSize) / 5 seconds; frames straddle the turn.
    const cellMs = (2 / level.gridSize / 5) * 1000;
    const times = [
      Math.round(cellMs * Math.max(1, turnStep - 1.5)),
      Math.round(cellMs * (turnStep + 1.5)),
    ];
    const [before, after] = await captureMotion(page, reverser.id, times);
    assert.ok(before && after);
    for (const frame of [before, after]) {
      assert.equal((JSON.parse(frame.state) as State).moving?.kind, "exit");
    }
    await writeFile(
      `${output}/flip/09-level75-reversal-a.png`,
      frameBuffer(before),
    );
    await writeFile(
      `${output}/flip/09-level75-reversal-b.png`,
      frameBuffer(after),
    );
    const moved = await changedPixels(
      frameBuffer(before),
      frameBuffer(after),
      { x: point.x - 60, y: point.y - 60, width: 120, height: 120 },
      before.ratio,
    );
    console.log(
      `flip: level ${levelId} ${reverser.id} turns on ${cellKey(turnCell)} at head step ${turnStep - 1}; frames ${times.join("/")} ms, ${moved} px changed`,
    );
    await page.screenshot({ path: `${output}/flip/09-level75-settled.png` });
    assert.ok(
      moved > 20,
      `The level ${levelId} reversal must visibly animate (${moved} px changed)`,
    );
    await finishMotion(page);
    assert.ok(!(await state(page)).remainingIds.includes(reverser.id));
    assert.deepEqual(
      errors,
      [],
      `No page errors during the level ${levelId} reversal`,
    );
  } finally {
    await context.close();
  }
}

/**
 * A generated region park that leaves a flip pending. The target is the first
 * generated level (31-200) where an arrow's opening tap parks it on a stop
 * circle with part of its body still on a flip spot, and where clearing the
 * other exits greedily lets it resume, leave the spot and flip it. The park
 * and the pending flip survive a reload, then the planned taps fire the flip.
 */
async function assertRegionPark(browser: Browser, url: string): Promise<void> {
  let found:
    | {
        levelId: number;
        level: ReturnType<typeof generateLevel>;
        traverser: string;
        circle: string;
        spotKey: string;
        before: string;
        after: string;
        rest: string[];
      }
    | undefined;
  for (let candidate = 31; candidate <= 200 && !found; candidate += 1) {
    if (isAuthoredLevel(candidate)) continue;
    const level = cachedLevel(candidate);
    const flips = (level.directionals ?? []).filter(
      (spot) => spot.kind === "flip",
    );
    if (flips.length === 0 || !level.stops?.length) continue;
    const flipKeys = new Set(flips.map((spot) => cellKey(spot.cell)));
    const initial = createGameState(level);
    for (const arrow of level.arrows) {
      if (found) break;
      const park = simulateMove(level, initial, arrow.id);
      if (park.kind !== "paused") continue;
      const parked = applyMove(level, initial, park);
      const path = parked.settledPaths?.[arrow.id];
      if (!path) continue;
      const circle = cellKey(path[path.length - 1] as Cell);
      const spotKey = path
        .slice(0, -1)
        .map(cellKey)
        .find((key) => flipKeys.has(key));
      if (!spotKey) continue;
      const headingOf = (game: typeof parked): string | undefined =>
        game.spotHeadings?.[spotKey] ??
        flips.find((spot) => cellKey(spot.cell) === spotKey)?.heading;
      const before = headingOf(parked);
      let current = parked;
      const rest: string[] = [];
      let resumed = false;
      for (let guard = 0; guard < 400 && !resumed; guard += 1) {
        const pick = level.arrows.find(
          (other) =>
            current.remainingIds.includes(other.id) &&
            other.id !== arrow.id &&
            simulateMove(level, current, other.id).kind === "exit",
        );
        const id = pick?.id ?? arrow.id;
        const move = simulateMove(level, current, id);
        if (move.kind !== "exit") break;
        current = applyMove(level, current, move);
        rest.push(id);
        if (id === arrow.id) resumed = true;
      }
      const after = headingOf(current);
      if (!resumed || !before || !after || before === after) continue;
      found = {
        levelId: candidate,
        level,
        traverser: arrow.id,
        circle,
        spotKey,
        before,
        after,
        rest,
      };
    }
  }
  assert.ok(
    found,
    "A generated level from 31 through 200 must park an arrow over a flip spot",
  );
  const { levelId, level, traverser, circle, spotKey, before, after, rest } =
    found;

  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const spotOf = (current: State) =>
    current.directionals.find((spot) => spot.cell === spotKey);
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, levelId);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.ok(current.stops.includes(circle));
    assert.equal(spotOf(current)?.kind, "flip");
    assert.equal(spotOf(current)?.current, before);
    assert.deepEqual(current.pendingFlips, []);

    await activate(page, traverser);
    current = await state(page);
    assert.equal(
      current.settledPaths[traverser]?.map(cellKey).at(-1),
      circle,
      "The traverser parks on the region circle",
    );
    assert.deepEqual(current.pendingFlips, [spotKey], "The flip is pending");
    assert.equal(spotOf(current)?.current, before);
    assert.equal(current.lives, level.lives);

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, levelId);
    assert.equal(
      current.settledPaths[traverser]?.map(cellKey).at(-1),
      circle,
      "The park survives a reload",
    );
    assert.deepEqual(
      current.pendingFlips,
      [spotKey],
      "The pending flip survives a reload",
    );
    assert.equal(spotOf(current)?.current, before);

    for (const id of rest) {
      await activate(page, id);
      current = await state(page);
      assert.ok(!current.remainingIds.includes(id), `${id} clears`);
      if (id !== traverser) {
        assert.equal(spotOf(current)?.current, before, "Flip still pending");
      }
    }
    assert.deepEqual(current.pendingFlips, []);
    assert.equal(
      spotOf(current)?.current,
      after,
      "The traverser moves off the spot and flips it",
    );
    console.log(
      `flip: level ${levelId} parks ${traverser} on ${circle} over ${spotKey}, keeps the flip pending across a reload, then flips it ${before} to ${after} on resume`,
    );
    assert.deepEqual(errors, [], "No page errors during the region park");
  } finally {
    await context.close();
  }
}

const CORE_MARKERS = [
  "-flip-",
  "-rotor-",
  "-fragile-",
  "-lock-",
  "-mirror-",
  "-leap-",
  "-wormhole-",
] as const;

const isCoreArrowId = (id: string): boolean =>
  CORE_MARKERS.some((marker) => id.includes(marker));

/**
 * The first generated cube whose core of any mechanic is entangled (carries
 * `-flipb-` or `-xblock-` lane blockers), cleared in the solver's proven order
 * with a reload halfway. The order opens with a blocker move, never a core
 * arrow.
 */
async function assertEntangledCore(
  browser: Browser,
  url: string,
): Promise<void> {
  const firstWith = (marker: string): number => {
    for (let id = 31; id <= 200; id += 1) {
      if (isAuthoredLevel(id)) continue;
      if (cachedLevel(id).arrows.some((arrow) => arrow.id.includes(marker))) {
        return id;
      }
    }
    return 0;
  };
  // The -xblock- path is the newer one, so it gets the real-engine check first.
  const target = firstWith("-xblock-") || firstWith("-flipb-");
  assert.ok(target > 0, "An entangled cube must exist in 31-200");
  const level = cachedLevel(target);
  const entangledKind = [
    ...new Set(
      level.arrows
        .map((arrow) => /-(flipb|xblock)-([a-z]*)/.exec(arrow.id))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => (m[1] === "flipb" ? "flip" : m[2])),
    ),
  ].join("+");
  const targets = solveLevelTargets(level) ?? [];
  assert.ok(targets.length > 0, "The entangled cube must solve");
  assert.ok(
    !isCoreArrowId(targets[0]?.arrowId ?? ""),
    "The proven order opens with a blocker move, never a core arrow",
  );

  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
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
    await openCampaignLevel(page, target);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.remainingIds.length, level.arrows.length);

    const half = Math.ceil(targets.length / 2);
    for (const move of targets.slice(0, half)) {
      await activate(page, move.arrowId, move.endpoint);
    }
    current = await state(page);
    assert.equal(current.lives, level.lives, "The proven order costs no life");
    const remaining = [...current.remainingIds].sort();
    assert.ok(remaining.length < level.arrows.length, "Half the order clears");
    assert.ok(remaining.length > 0, "The level is not finished at half");
    const settled = current.settledPaths;

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, target);
    assert.deepEqual(
      [...current.remainingIds].sort(),
      remaining,
      "Cleared arrows survive a reload",
    );
    assert.deepEqual(
      current.settledPaths,
      settled,
      "Parked paths survive a reload",
    );

    for (const move of targets.slice(half)) {
      await activate(page, move.arrowId, move.endpoint);
    }
    current = await state(page);
    assert.deepEqual(current.remainingIds, [], "Every arrow clears");
    assert.equal(current.lives, level.lives, "No life is lost");
    console.log(
      `flip: entangled level ${target} (${entangledKind}) clears in its proven order of ${targets.length} taps across a mid-level reload`,
    );
    assert.deepEqual(errors, [], "No page errors on the entangled cube");
  } finally {
    await context.close();
  }
}
