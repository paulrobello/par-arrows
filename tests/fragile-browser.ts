import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { FRAGILE_INTRO_LEVEL } from "../src/content/fragile-intro";
import { FRAGILE_CORE_MARKER, generateLevel } from "../src/content/procedural";
import { cellKey, cellToWorld, faceNormal } from "../src/core/topology";
import { solveLevelTargets } from "../src/core/validation";
import type { Cell, FaceId } from "../src/core/types";
import { THEME_PALETTES } from "../src/render/renderer";
import { waitForReady } from "./runtime-fixtures";

const CROSSER = "fragile-intro-crosser";
const DOUBLE = "fragile-intro-double";
const BRIDGE: Cell = { face: "front", x: 1, y: 1 };
const BRIDGE_KEY = cellKey(BRIDGE);
/** The first generated id that places a fragile core. */
const GENERATED_LEVEL = 46;

interface FragileText {
  cell: string;
  collapsed: boolean;
}

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  lives: number;
  status: string;
  remainingIds: string[];
  failedIds: string[];
  fallenIds: string[];
  fragile: FragileText[];
  pendingCollapses: string[];
  fragileGlyphCollapse: Record<string, number>;
  moving: {
    kind: string;
    duration: number;
    elapsed: number;
    anticipation?: number;
    headPosition?: [number, number, number];
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

/**
 * Starts a move and reads the diagnostics at each elapsed time inside one
 * page task, so the live animation loop cannot advance the motion between
 * frames.
 */
async function captureMotion(
  page: Page,
  arrowId: string,
  endpoint: "head" | "tail",
  times: readonly number[],
): Promise<Frame[]> {
  return page.evaluate(
    ({ arrowId, endpoint, times }) => {
      const test = window.__PAR_ARROWS_TEST__;
      const canvas = document.querySelector("canvas");
      if (!test || !canvas) throw new Error("Test hooks and canvas required");
      test.activate(arrowId, endpoint);
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
    { arrowId, endpoint, times },
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

/**
 * Pixel counts of a fragile cell's looks in one theme: the crack glyph, the
 * hole's border frame and its cavity. The crack is measured over the whole
 * cell, the frame over the ring past the opening, and the cavity over the
 * opening's inner half so a tilted view of the walls still counts.
 */
async function fragileLooks(
  page: Page,
  image: Buffer,
  cell: Cell,
  gridSize: number,
  theme: "light" | "dark",
): Promise<{ crack: number; rim: number; cavity: number }> {
  const palette = THEME_PALETTES[theme];
  const ratio = await canvasRatio(page, image);
  const whole = await cellRect(page, cell, gridSize, 0.48);
  const inner = await cellRect(page, cell, gridSize, 0.22);
  return {
    crack: await matchingPixels(image, whole, ratio, near(palette.fragile)),
    rim: await matchingPixels(image, whole, ratio, near(palette.hole.rim)),
    cavity: await matchingPixels(
      image,
      inner,
      ratio,
      near(palette.hole.cavity, 26),
    ),
  };
}

export async function assertFragileIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/fragile`, { recursive: true });
  await assertPreviewEntry(browser, url, output);
  await assertScriptedWalkthrough(browser, url, output);
  await assertFallAndReload(browser, url, output);
  await assertGeneratedCore(browser, url, output);
}

/**
 * `?feature=fragile` opens the introduction as a preview: no walkthrough
 * runs, no campaign save is written, and the crack draws in its own color in
 * both themes. Crossing the bridge opens the bordered hole, which also reads
 * in both themes and restyles on a theme swap.
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
  const grid = FRAGILE_INTRO_LEVEL.gridSize;
  try {
    // `url` already carries `?test=1`.
    await page.goto(`${url}&feature=fragile`);
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, FRAGILE_INTRO_LEVEL.id);
    assert.deepEqual(current.fragile, [{ cell: BRIDGE_KEY, collapsed: false }]);
    assert.deepEqual(current.pendingCollapses, []);
    assert.deepEqual(current.fragileGlyphCollapse, { [BRIDGE_KEY]: 0 });
    assert.equal(
      (await tutorialState(page)).active,
      false,
      "A preview must not run the walkthrough",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Fragile preview must not create campaign state",
    );

    await resetCamera(page);
    await faceCamera(page, BRIDGE.face);
    const crackLight = await canvasShot(page);
    await writeFile(`${output}/fragile/00-crack-light.png`, crackLight);
    await setTheme(page, "dark");
    const crackDark = await canvasShot(page);
    await writeFile(`${output}/fragile/00-crack-dark.png`, crackDark);
    const lightCrack = await fragileLooks(
      page,
      crackLight,
      BRIDGE,
      grid,
      "light",
    );
    const darkCrack = await fragileLooks(page, crackDark, BRIDGE, grid, "dark");
    const staleCrack = await fragileLooks(
      page,
      crackDark,
      BRIDGE,
      grid,
      "light",
    );
    console.log(
      `fragile: crack ${lightCrack.crack} px light, ${darkCrack.crack} px dark, ${staleCrack.crack} px light-crack after the swap`,
    );
    assert.ok(
      lightCrack.crack > 30,
      `Light crack shows (${lightCrack.crack} px)`,
    );
    assert.ok(darkCrack.crack > 30, `Dark crack shows (${darkCrack.crack} px)`);
    assert.ok(
      staleCrack.crack * 4 < lightCrack.crack,
      `The theme swap must restyle the crack (${staleCrack.crack} px remain)`,
    );
    assert.ok(
      lightCrack.cavity < 10 && darkCrack.rim < 10,
      "An intact cell shows no hole",
    );

    // The crosser crosses and the bridge collapses into a bordered hole.
    await activate(page, CROSSER);
    current = await state(page);
    assert.deepEqual(current.fragile, [{ cell: BRIDGE_KEY, collapsed: true }]);
    assert.deepEqual(current.fragileGlyphCollapse, { [BRIDGE_KEY]: 1 });
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives);
    await faceCamera(page, BRIDGE.face);
    const holeDark = await canvasShot(page);
    await writeFile(`${output}/fragile/01-hole-dark.png`, holeDark);
    await setTheme(page, "light");
    const holeLight = await canvasShot(page);
    await writeFile(`${output}/fragile/01-hole-light.png`, holeLight);
    const lightHole = await fragileLooks(
      page,
      holeLight,
      BRIDGE,
      grid,
      "light",
    );
    const darkHole = await fragileLooks(page, holeDark, BRIDGE, grid, "dark");
    const staleHole = await fragileLooks(page, holeLight, BRIDGE, grid, "dark");
    console.log(
      `fragile: hole rim ${lightHole.rim}/${darkHole.rim} px, cavity ${lightHole.cavity}/${darkHole.cavity} px (light/dark), crack ${lightHole.crack}/${darkHole.crack} px`,
    );
    for (const [theme, looks] of [
      ["light", lightHole],
      ["dark", darkHole],
    ] as const) {
      assert.ok(
        looks.rim > 40,
        `The ${theme} hole shows its frame (${looks.rim} px)`,
      );
      assert.ok(
        looks.cavity > 40,
        `The ${theme} hole shows its cavity (${looks.cavity} px)`,
      );
      // The crack's color sits between the frame and the face, so the
      // frame's antialiased edge alone matches a few dozen of its pixels.
      // The crack itself is gone when its count falls well below the glyph's.
      const intact = theme === "light" ? lightCrack.crack : darkCrack.crack;
      assert.ok(
        looks.crack * 4 < intact,
        `The ${theme} crack is gone (${looks.crack} px against ${intact} intact)`,
      );
    }
    assert.ok(
      staleHole.rim * 4 < lightHole.rim,
      `The theme swap must restyle the frame (${staleHole.rim} dark-rim px remain)`,
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("par-arrows:campaign:v1")),
      null,
      "Play in a preview must not write campaign state",
    );
    assert.deepEqual(errors, [], "No page errors in the fragile preview");
  } finally {
    await context.close();
  }
}

/**
 * First-run walkthrough in campaign play: the gate refuses the double, the
 * crosser crosses and the crack opens into a hole as its body clears it, and
 * the walkthrough then asks for the double's tail, which leaves the long way
 * round without a life lost.
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
    await openCampaignLevel(page, FRAGILE_INTRO_LEVEL.id);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    const script = await tutorialState(page);
    assert.ok(script.active, "The walkthrough must run on first sight");
    assert.equal(script.highlightId, CROSSER);
    assert.deepEqual(script.gate, [CROSSER]);
    await page.screenshot({ path: `${output}/fragile/02-intro.png` });

    // Walkthrough gate: neither end of the double responds yet.
    await activate(page, DOUBLE, "head");
    await activate(page, DOUBLE, "tail");
    current = await state(page);
    assert.equal(
      current.lives,
      FRAGILE_INTRO_LEVEL.lives,
      "Gated taps are free",
    );
    assert.equal(
      current.remainingIds.length,
      FRAGILE_INTRO_LEVEL.arrows.length,
    );
    assert.deepEqual(current.fragile, [{ cell: BRIDGE_KEY, collapsed: false }]);

    // The crosser's exit reports the collapse after its body clears the
    // bridge: the glyph is intact early, then sinks into a hole, while the
    // diagnostic collapse state only settles once the move ends.
    await page.waitForTimeout(700);
    const probe = await captureMotion(page, CROSSER, "head", [1]);
    const duration = (JSON.parse(probe[0]?.state ?? "{}") as State).moving
      ?.duration;
    assert.ok(duration && duration > 0, "The crosser must be moving");
    await finishMotion(page);
    current = await state(page);
    assert.deepEqual(current.fragile, [{ cell: BRIDGE_KEY, collapsed: true }]);
    assert.deepEqual(current.fragileGlyphCollapse, { [BRIDGE_KEY]: 1 });
    assert.deepEqual(current.pendingCollapses, []);
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives);
    const next = await tutorialState(page);
    assert.equal(next.highlightId, DOUBLE);
    await page.screenshot({ path: `${output}/fragile/03-after-crossing.png` });

    // The double's head end is refused by the tail-only step; its tail leaves.
    await activate(page, DOUBLE, "head");
    current = await state(page);
    assert.ok(current.remainingIds.includes(DOUBLE), "The head end is gated");
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives);
    await activate(page, DOUBLE, "tail");
    current = await state(page);
    assert.ok(!current.remainingIds.includes(DOUBLE));
    assert.deepEqual(current.fallenIds, []);
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives);

    current = await state(page);
    assert.deepEqual(current.remainingIds, [], "Free play clears the cube");
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives);
    assert.equal((await tutorialState(page)).active, false);
    await page.screenshot({ path: `${output}/fragile/04-cleared.png` });
    assert.deepEqual(errors, [], "No page errors during the walkthrough");
  } finally {
    await context.close();
  }
}

/**
 * With the walkthrough seen: the collapse survives a reload, then the
 * double's head runs into the hole, bends into the cube along the face
 * normal, sinks out of sight, and costs one life; the fall survives a second
 * reload.
 */
async function assertFallAndReload(
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
      tutorialSeenLevels: [FRAGILE_INTRO_LEVEL.id],
    }),
  );
  const page = await context.newPage();
  const errors = watchErrors(page);
  const grid = FRAGILE_INTRO_LEVEL.gridSize;
  try {
    await page.goto(url);
    await waitForReady(page);
    await openCampaignLevel(page, FRAGILE_INTRO_LEVEL.id);
    assert.equal((await tutorialState(page)).active, false);
    await activate(page, CROSSER);

    await page.reload();
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "campaign");
    assert.equal(current.level.id, FRAGILE_INTRO_LEVEL.id);
    assert.deepEqual(
      current.fragile,
      [{ cell: BRIDGE_KEY, collapsed: true }],
      "The collapse survives a reload",
    );
    assert.deepEqual(current.fragileGlyphCollapse, { [BRIDGE_KEY]: 1 });
    assert.ok(!current.remainingIds.includes(CROSSER));
    await resetCamera(page);
    await faceCamera(page, BRIDGE.face);
    const reloaded = await canvasShot(page);
    await writeFile(`${output}/fragile/05-hole-reloaded-dark.png`, reloaded);
    const looks = await fragileLooks(page, reloaded, BRIDGE, grid, "dark");
    assert.ok(
      looks.rim > 40 && looks.cavity > 40,
      `The reloaded board draws the hole (rim ${looks.rim}, cavity ${looks.cavity})`,
    );

    // The fall: sample the dive and check the head sinks below the face.
    const probe = await captureMotion(page, DOUBLE, "head", [1]);
    const moving = (JSON.parse(probe[0]?.state ?? "{}") as State).moving;
    assert.equal(moving?.kind, "fall");
    const duration = moving?.duration ?? 0;
    const samples = [0.3, 0.55, 0.75, 0.95].map((share) =>
      Math.round(duration * share),
    );
    const frames: Frame[] = [];
    for (const time of samples) {
      frames.push(
        ...(await page.evaluate(
          ({ time }) => {
            const test = window.__PAR_ARROWS_TEST__;
            const canvas = document.querySelector("canvas");
            if (!test || !canvas) throw new Error("Hooks required");
            const raw = JSON.parse(window.render_game_to_text?.() ?? "{}");
            window.advanceTime?.(time - (raw.moving?.elapsed ?? 0));
            test.render();
            return [
              {
                frame: canvas.toDataURL("image/png"),
                state: window.render_game_to_text?.() ?? "{}",
              },
            ];
          },
          { time },
        )),
      );
    }
    const normal = faceNormal(BRIDGE.face);
    const hole = cellToWorld(BRIDGE, grid);
    const heights = frames.map((frame) => {
      const text = JSON.parse(frame.state) as State;
      const head = text.moving?.headPosition;
      assert.ok(head, "The diving head reports its position");
      return (
        (head[0] - hole[0]) * normal[0] +
        (head[1] - hole[1]) * normal[1] +
        (head[2] - hole[2]) * normal[2]
      );
    });
    for (const [index, frame] of frames.entries()) {
      await writeFile(
        `${output}/fragile/06-fall-${samples[index]}ms.png`,
        frameBuffer(frame),
      );
    }
    console.log(
      `fragile: head height over the face during the fall ${heights.map((h) => h.toFixed(3)).join(", ")}`,
    );
    const last = heights.at(-1) ?? 0;
    assert.ok(
      last < -0.2,
      `The head sinks into the cube along the face normal (${last})`,
    );
    for (let index = 1; index < heights.length; index += 1) {
      assert.ok(
        (heights[index] ?? 0) <= (heights[index - 1] ?? 0) + 1e-6,
        "The head never rises while it falls",
      );
    }
    const midFall = JSON.parse(frames.at(-1)?.state ?? "{}") as State;
    assert.equal(
      midFall.lives,
      FRAGILE_INTRO_LEVEL.lives - 1,
      "The life is lost once the head reaches the hole",
    );

    await finishMotion(page);
    current = await state(page);
    assert.ok(
      !current.remainingIds.includes(DOUBLE),
      "The fallen arrow is gone",
    );
    assert.deepEqual(current.fallenIds, [DOUBLE]);
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives - 1);
    assert.deepEqual(current.failedIds, []);
    await page.screenshot({ path: `${output}/fragile/07-after-fall.png` });

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.deepEqual(current.fallenIds, [DOUBLE], "The fall survives a reload");
    assert.equal(current.lives, FRAGILE_INTRO_LEVEL.lives - 1);
    assert.deepEqual(current.fragile, [{ cell: BRIDGE_KEY, collapsed: true }]);
    assert.deepEqual(errors, [], "No page errors during the fall");
  } finally {
    await context.close();
  }
}

/**
 * A generated fragile core plays through on the full board: the crosser
 * crosses and collapses the cell, and the double leaves by its tail with no
 * life lost, the certified order.
 */
async function assertGeneratedCore(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const level = generateLevel(GENERATED_LEVEL);
  const cell = level.fragile?.[0];
  assert.ok(cell, `Level ${GENERATED_LEVEL} carries a fragile cell`);
  const key = cellKey(cell);
  const crosser = `r${GENERATED_LEVEL}${FRAGILE_CORE_MARKER}crosser`;
  const double = `r${GENERATED_LEVEL}${FRAGILE_CORE_MARKER}double`;
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = watchErrors(page);
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
            ?.path.map((entry) => `${entry.face}:${entry.x}:${entry.y}`),
        ),
      [crosser, double],
    );
    assert.deepEqual(
      pagePaths,
      [crosser, double].map((id) =>
        level.arrows.find((arrow) => arrow.id === id)?.path.map(cellKey),
      ),
      "The page must build the same cube as the Node generator",
    );
    let current = await state(page);
    assert.deepEqual(current.fragile, [{ cell: key, collapsed: false }]);
    await faceCamera(page, cell.face);
    await page.screenshot({
      path: `${output}/fragile/08-level${GENERATED_LEVEL}-start.png`,
    });

    // Lane blockers entangle the core, so the certificate clears the arrows
    // ahead of the crosser first.
    const certificate = solveLevelTargets(level);
    assert.ok(certificate, `Level ${GENERATED_LEVEL} is solvable`);
    const crosserAt = certificate.findIndex((t) => t.arrowId === crosser);
    const doubleAt = certificate.findIndex((t) => t.arrowId === double);
    assert.ok(crosserAt >= 0 && doubleAt > crosserAt);
    assert.ok(
      certificate
        .slice(0, crosserAt)
        .some((t) => !t.arrowId.includes(FRAGILE_CORE_MARKER)),
      "A non-core arrow precedes the crosser in the certificate",
    );
    for (const target of certificate.slice(0, crosserAt + 1)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    current = await state(page);
    assert.ok(!current.remainingIds.includes(crosser));
    assert.deepEqual(current.fragile, [{ cell: key, collapsed: true }]);
    assert.equal(current.lives, level.lives);
    await faceCamera(page, cell.face);
    const shot = await canvasShot(page);
    await writeFile(
      `${output}/fragile/09-level${GENERATED_LEVEL}-hole.png`,
      shot,
    );
    const looks = await fragileLooks(page, shot, cell, level.gridSize, "light");
    console.log(
      `fragile: level ${GENERATED_LEVEL} hole at ${key} rim ${looks.rim} px, cavity ${looks.cavity} px`,
    );
    assert.ok(
      looks.rim > 4,
      `The generated hole shows its frame (${looks.rim})`,
    );

    for (const target of certificate.slice(crosserAt + 1, doubleAt + 1)) {
      await activate(page, target.arrowId, target.endpoint);
    }
    current = await state(page);
    assert.ok(!current.remainingIds.includes(double));
    assert.deepEqual(current.fallenIds, []);
    assert.equal(current.lives, level.lives);
    await page.screenshot({
      path: `${output}/fragile/10-level${GENERATED_LEVEL}-core-cleared.png`,
    });
    assert.deepEqual(
      errors,
      [],
      `No page errors during the level ${GENERATED_LEVEL} core`,
    );
  } finally {
    await context.close();
  }
}
