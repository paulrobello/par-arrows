import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
import {
  generateLevel,
  LOCK_CORE_MARKER,
  lockCorePlanned,
} from "../src/content/procedural";
import { cellKey, cellToWorld, faceNormal } from "../src/core/topology";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { solveLevelTargets } from "../src/core/validation";
import type { Cell, FaceId } from "../src/core/types";
import { THEME_PALETTES } from "../src/render/renderer";
import { waitForReady } from "./runtime-fixtures";

const OPENER = "lock-intro-opener";
const KEY_ARROW = "lock-intro-key";
const LOCK_ID = "lock-intro";
const GATE = LOCK_INTRO_LEVEL.locks?.[0]?.lock as Cell;
const KEY = LOCK_INTRO_LEVEL.locks?.[0]?.key as Cell;

interface LockText {
  id: string;
  key: string;
  lock: string;
  open: boolean;
  color: number;
}

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  lives: number;
  status: string;
  revision?: number;
  remainingIds: string[];
  failedIds: string[];
  locks: LockText[];
  unlockedIds: string[];
  lockGlyphOpen: Record<string, number>;
  keyFlights: { lockId: string; progress: number }[];
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

/** Within `tolerance` of `color` on every channel. */
function near(color: number, tolerance = 22) {
  const [cr, cg, cb] = rgb(color);
  return (r: number, g: number, b: number): boolean =>
    Math.abs(r - cr) <= tolerance &&
    Math.abs(g - cg) <= tolerance &&
    Math.abs(b - cb) <= tolerance;
}

/** Canvas-relative CSS position of a world point under the current camera. */
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

/** A square around a cell whose half side is `share` of the projected cell pitch. */
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

/** Pixels of a lock's color (first lock of the theme) over one cell. */
async function lockPixels(
  page: Page,
  image: Buffer,
  cell: Cell,
  gridSize: number,
  theme: "light" | "dark",
): Promise<number> {
  const ratio = await canvasRatio(page, image);
  const rect = await cellRect(page, cell, gridSize, 0.48);
  return matchingPixels(
    image,
    rect,
    ratio,
    near(THEME_PALETTES[theme].lock[0]),
  );
}

export async function assertLockIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/lock`, { recursive: true });
  await assertPreviewEntry(browser, url, output);
  await assertScriptedWalkthrough(browser, url, output);
  await assertUnlockAcrossReload(browser, url, output);
  await assertGeneratedCore(browser, url, output);
  await assertCrossFaceFlight(browser, url, output);
}

/**
 * `?feature=lock` opens the introduction as a preview: no walkthrough runs,
 * no campaign save is written, and the gate and key draw in the lock's color
 * in both themes and restyle on a theme swap. The opener's first tap meets
 * the closed gate and rewinds with no life lost and no red mark.
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
  const grid = LOCK_INTRO_LEVEL.gridSize;
  try {
    // `url` already carries `?test=1`.
    await page.goto(`${url}&feature=lock`);
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, LOCK_INTRO_LEVEL.id);
    assert.deepEqual(current.locks, [
      {
        id: LOCK_ID,
        key: cellKey(KEY),
        lock: cellKey(GATE),
        open: false,
        color: 0,
      },
    ]);
    assert.deepEqual(current.unlockedIds, []);
    assert.deepEqual(current.lockGlyphOpen, { [LOCK_ID]: 0 });
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A preview must not run the walkthrough",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Lock preview must not create campaign state",
    );

    await resetCamera(page);
    await faceCamera(page, GATE.face);
    const light = await canvasShot(page);
    await writeFile(`${output}/lock/00-gate-light.png`, light);
    await setTheme(page, "dark");
    const dark = await canvasShot(page);
    await writeFile(`${output}/lock/00-gate-dark.png`, dark);
    const lightGate = await lockPixels(page, light, GATE, grid, "light");
    const darkGate = await lockPixels(page, dark, GATE, grid, "dark");
    const staleGate = await lockPixels(page, dark, GATE, grid, "light");
    const lightKey = await lockPixels(page, light, KEY, grid, "light");
    const darkKey = await lockPixels(page, dark, KEY, grid, "dark");
    console.log(
      `lock: gate ${lightGate}/${darkGate} px, key ${lightKey}/${darkKey} px (light/dark), ${staleGate} px light-gate after the swap`,
    );
    assert.ok(lightGate > 40, `Light gate shows (${lightGate} px)`);
    assert.ok(darkGate > 40, `Dark gate shows (${darkGate} px)`);
    assert.ok(lightKey > 15, `Light key shows (${lightKey} px)`);
    assert.ok(darkKey > 15, `Dark key shows (${darkKey} px)`);
    assert.ok(
      staleGate * 4 < lightGate,
      `The theme swap must restyle the gate (${staleGate} px remain)`,
    );

    // The opener runs into the closed gate and rewinds for free.
    await page.evaluate(
      (id) => window.__PAR_ARROWS_TEST__?.activate(id, "head"),
      OPENER,
    );
    current = await state(page);
    assert.equal(current.moving?.kind, "gated");
    await finishMotion(page);
    current = await state(page);
    assert.ok(current.remainingIds.includes(OPENER));
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);
    assert.deepEqual(current.failedIds, [], "A gate leaves no red mark");
    assert.deepEqual(current.unlockedIds, []);
    await activate(page, OPENER);
    current = await state(page);
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives, "Repeats are free");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Play in a preview must not write campaign state",
    );
    assert.deepEqual(errors, [], "No page errors in the lock preview");
  } finally {
    await context.close();
  }
}

/**
 * First-run walkthrough in campaign play: the walkthrough refuses the opener,
 * the key arrow crosses the key and the gate opens partway through its
 * move, and the walkthrough then asks for the opener, which leaves through
 * the open gate.
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
    await openCampaignLevel(page, LOCK_INTRO_LEVEL.id);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    const script = await tutorialState(page);
    assert.ok(script.active, "The walkthrough must run on first sight");
    assert.equal(script.highlightId, KEY_ARROW);
    assert.deepEqual(script.gate, [KEY_ARROW]);
    await page.screenshot({ path: `${output}/lock/01-intro.png` });

    // Walkthrough gate: the opener does not respond yet.
    await activate(page, OPENER);
    current = await state(page);
    assert.equal(current.moving, null, "The walkthrough holds the opener");
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);
    assert.equal(current.remainingIds.length, LOCK_INTRO_LEVEL.arrows.length);

    // The key arrow crosses the key partway through its move: the gate
    // glyph opens while it travels and is fully open once it settles.
    await page.waitForTimeout(700);
    const opening = await page.evaluate((id) => {
      const test = window.__PAR_ARROWS_TEST__;
      if (!test) throw new Error("Test hooks required");
      test.activate(id, "head");
      const read = () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}") as {
          moving: { duration: number } | null;
          lockGlyphOpen: Record<string, number>;
        };
      const duration = read().moving?.duration ?? 0;
      const samples: number[] = [];
      let elapsed = 0;
      for (const share of [0.02, 0.35, 0.6, 0.85]) {
        const time = Math.round(duration * share);
        window.advanceTime?.(time - elapsed);
        elapsed = time;
        test.render();
        samples.push(read().lockGlyphOpen["lock-intro"] ?? -1);
      }
      return { duration, samples };
    }, KEY_ARROW);
    console.log(
      `lock: gate glyph open during the key move ${opening.samples.map((value) => value.toFixed(2)).join(", ")}`,
    );
    assert.ok(opening.duration > 0, "The key arrow must be moving");
    assert.equal(opening.samples[0], 0, "The gate starts barred");
    assert.ok(
      (opening.samples.at(-1) ?? 0) > (opening.samples[0] ?? 0),
      "The gate opens as the head crosses the key",
    );
    await finishMotion(page);
    current = await state(page);
    assert.deepEqual(current.unlockedIds, [LOCK_ID]);
    assert.deepEqual(current.lockGlyphOpen, { [LOCK_ID]: 1 });
    assert.equal(current.locks[0]?.open, true);
    assert.equal((await tutorialState(page)).highlightId, OPENER);
    await page.screenshot({ path: `${output}/lock/02-after-key.png` });

    await activate(page, OPENER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(OPENER), "The opener leaves");
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);
    current = await state(page);
    assert.deepEqual(current.remainingIds, [], "Free play clears the cube");
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);
    assert.equal((await tutorialState(page)).active, false);
    await page.screenshot({ path: `${output}/lock/03-cleared.png` });
    assert.deepEqual(errors, [], "No page errors during the walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * With the walkthrough seen: a gated rewind persists with its lives whole,
 * the key arrow's move is interrupted by a reload partway through (the
 * attempt saves its settled result as it starts), and the reloaded board
 * shows the gate open and lets the opener through.
 */
async function assertUnlockAcrossReload(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "dark",
  });
  await context.addInitScript(
    (settings) => {
      if (!localStorage.getItem("par-arrows:settings:v1"))
        localStorage.setItem("par-arrows:settings:v1", settings);
    },
    JSON.stringify({
      gridLines: true,
      reducedMotion: false,
      theme: "dark",
      tutorialSeenLevels: [LOCK_INTRO_LEVEL.id],
    }),
  );
  const page = await context.newPage();
  const errors = watchErrors(page);
  const grid = LOCK_INTRO_LEVEL.gridSize;
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, LOCK_INTRO_LEVEL.id);
    assert.equal((await tutorialState(page)).active, false);
    await activate(page, OPENER);
    let current = await state(page);
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, LOCK_INTRO_LEVEL.id);
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);
    assert.deepEqual(current.failedIds, []);
    assert.deepEqual(current.unlockedIds, []);
    await resetCamera(page);
    await faceCamera(page, GATE.face);
    const barred = await canvasShot(page);
    await writeFile(`${output}/lock/04-barred-dark.png`, barred);
    const barredPixels = await lockPixels(page, barred, GATE, grid, "dark");

    // Start the key arrow's move and reload partway through it.
    await page.evaluate((id) => {
      const test = window.__PAR_ARROWS_TEST__;
      if (!test) throw new Error("Test hooks required");
      test.activate(id, "head");
      window.advanceTime?.(40);
    }, KEY_ARROW);
    current = await state(page);
    assert.ok(current.moving, "The key arrow is mid-move at the reload");
    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.deepEqual(
      current.unlockedIds,
      [LOCK_ID],
      "The unlock survives a reload mid-move",
    );
    assert.ok(!current.remainingIds.includes(KEY_ARROW));
    assert.deepEqual(current.lockGlyphOpen, { [LOCK_ID]: 1 });
    await resetCamera(page);
    await faceCamera(page, GATE.face);
    const open = await canvasShot(page);
    await writeFile(`${output}/lock/05-open-reloaded-dark.png`, open);
    const openPixels = await lockPixels(page, open, GATE, grid, "dark");
    console.log(
      `lock: gate ${barredPixels} px barred, ${openPixels} px open after the reload`,
    );
    assert.ok(
      openPixels * 2 < barredPixels,
      `The reloaded gate draws open (${openPixels} px against ${barredPixels} barred)`,
    );

    await activate(page, OPENER);
    current = await state(page);
    assert.ok(!current.remainingIds.includes(OPENER), "The opener leaves");
    assert.equal(current.lives, LOCK_INTRO_LEVEL.lives);
    assert.deepEqual(errors, [], "No page errors across the reloads");
  } finally {
    await context.close();
  }
}

/** The first generated id that places a lock core. */
function firstGeneratedLockLevel(): number {
  for (let id = 51; id <= 200; id += 1) {
    if (lockCorePlanned(id) && (generateLevel(id).locks?.length ?? 0) > 0)
      return id;
  }
  throw new Error("No generated lock core over 51-200.");
}

/**
 * A generated lock core plays through on the full board: the opener is
 * barred, the key arrow opens the gate, and the opener leaves with no life
 * lost, the certified order.
 */
async function assertGeneratedCore(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const id = firstGeneratedLockLevel();
  const level = generateLevel(id);
  const lock = level.locks?.[0];
  assert.ok(lock, `Level ${id} carries a lock`);
  const opener = `r${id}${LOCK_CORE_MARKER}opener`;
  const keyArrow = `r${id}${LOCK_CORE_MARKER}key`;
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
      [opener, keyArrow],
    );
    assert.deepEqual(
      pagePaths,
      [opener, keyArrow].map((arrowId) =>
        level.arrows.find((arrow) => arrow.id === arrowId)?.path.map(cellKey),
      ),
      "The page must build the same cube as the Node generator",
    );
    let current = await state(page);
    assert.deepEqual(
      current.locks.map((entry) => entry.open),
      [false],
    );
    await faceCamera(page, lock.lock.face);
    await page.screenshot({ path: `${output}/lock/06-level${id}-start.png` });

    // Lane blockers entangle the core, so replay the solver's zero-life
    // order: the key arrow must precede the opener.
    const certificate = solveLevelTargets(level);
    assert.ok(certificate, `Level ${id} is solvable`);
    const keyAt = certificate.findIndex((t) => t.arrowId === keyArrow);
    const openerAt = certificate.findIndex((t) => t.arrowId === opener);
    assert.ok(keyAt >= 0 && openerAt > keyAt, "The key arrow leaves first");
    assert.ok(
      certificate
        .slice(0, keyAt)
        .some((t) => !t.arrowId.includes(LOCK_CORE_MARKER)),
      "A non-core arrow precedes the key arrow in the certificate",
    );
    for (const target of certificate.slice(0, keyAt)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    // Just before the key arrow moves, the opener's first tap is the free
    // gated rewind when its lane is clear to the gate. A lane blocker still
    // on the board makes it an ordinary collision instead, which would cost
    // a life, so that case is asserted explicitly and not tapped.
    let before = createGameState(level);
    for (const target of certificate.slice(0, keyAt)) {
      const result = simulateMove(
        level,
        before,
        target.arrowId,
        target.endpoint,
      );
      before = applyMove(level, before, result);
    }
    const openerKind = simulateMove(level, before, opener).kind;
    assert.ok(
      openerKind === "gated" || openerKind === "blocked",
      `The opener meets the closed gate or a lane blocker (${openerKind})`,
    );
    if (openerKind === "gated") {
      await activate(page, opener);
      current = await state(page);
      assert.ok(current.remainingIds.includes(opener), "The opener rewinds");
      assert.equal(current.lives, level.lives, "A gated rewind is free");
      assert.deepEqual(current.failedIds, []);
    } else {
      console.log(
        `lock: level ${id} opener lane holds a blocker before the key, so no free rewind is tapped`,
      );
    }
    await activate(page, keyArrow);
    current = await state(page);
    assert.ok(current.remainingIds.includes(opener), "The opener waits");
    assert.ok(!current.remainingIds.includes(keyArrow));
    assert.deepEqual(current.unlockedIds, [lock.id]);
    for (const target of certificate.slice(keyAt + 1, openerAt + 1)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    current = await state(page);
    assert.ok(!current.remainingIds.includes(opener));
    assert.equal(current.lives, level.lives);
    assert.deepEqual(current.failedIds, []);
    await page.screenshot({
      path: `${output}/lock/07-level${id}-core-cleared.png`,
    });
    console.log(`lock: level ${id} core cleared in certified order`);
    assert.deepEqual(errors, [], `No page errors during the level ${id} core`);
  } finally {
    await context.close();
  }
}

/** The first generated id whose lock core placed cross-face, if any. */
function firstCrossFaceLockLevel(): number | undefined {
  for (let id = 51; id <= 200; id += 1) {
    if (!lockCorePlanned(id)) continue;
    const lock = generateLevel(id).locks?.[0];
    if (lock && lock.key.face !== lock.lock.face) return id;
  }
  return undefined;
}

/**
 * The first cross-face core plays its key flight: the flight diagnostic
 * reports the key airborne, the padlock stays present while it flies, and
 * the padlock reads removed once the key lands - with the key and gate on
 * different faces.
 */
async function assertCrossFaceFlight(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const id = firstCrossFaceLockLevel();
  assert.ok(id, "A cross-face lock core exists over 51-200");
  const level = generateLevel(id);
  const lock = level.locks?.[0];
  assert.ok(lock);
  assert.notEqual(lock.key.face, lock.lock.face);
  const keyArrow = `r${id}${LOCK_CORE_MARKER}key`;
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
    let current = await state(page);
    assert.deepEqual(current.lockGlyphOpen, { [lock.id]: 0 });
    // Lane blockers entangle the core: clear the arrows ahead of the key
    // arrow in the solver's order, then activate it without fast-forwarding
    // so the flight is sampled airborne during its travel.
    const certificate = solveLevelTargets(level);
    assert.ok(certificate, `Level ${id} is solvable`);
    const keyAt = certificate.findIndex((t) => t.arrowId === keyArrow);
    assert.ok(keyAt >= 0, "The key arrow is in the certificate");
    for (const target of certificate.slice(0, keyAt)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    await page.evaluate((arrow) => {
      window.__PAR_ARROWS_TEST__?.activate(arrow, "head");
    }, keyArrow);
    current = await state(page);
    assert.ok(current.moving, "The key arrow is moving");
    let sawFlight = false;
    let sawPresentWhileFlying = false;
    let sawRemoved = false;
    for (let step = 0; step < 24 && !sawRemoved; step += 1) {
      await page.evaluate(() => window.advanceTime?.(120));
      current = await state(page);
      const flight = current.keyFlights[0];
      if (flight) {
        sawFlight = true;
        if (current.lockGlyphOpen[lock.id] === 0) sawPresentWhileFlying = true;
      }
      if (!flight && sawFlight && current.lockGlyphOpen[lock.id] === 1)
        sawRemoved = true;
    }
    assert.ok(sawFlight, "The key flies across the faces");
    assert.ok(
      sawPresentWhileFlying,
      "The padlock stays present while the key flies",
    );
    assert.ok(sawRemoved, "The padlock reads removed once the key lands");
    console.log(`lock: cross-face flight verified on level ${id}`);
    assert.deepEqual(errors, [], "No page errors during the flight");
  } finally {
    await context.close();
  }
}
