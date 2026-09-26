import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Browser, Page } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { generateLevel } from "../src/content/procedural";
import { WORMHOLE_INTRO_LEVEL } from "../src/content/wormhole-intro";
import { cellToWorld, faceNormal } from "../src/core/topology";
import type { Cell } from "../src/core/types";
import { waitForReady } from "./runtime-fixtures";

interface State {
  mode: "preview" | "campaign";
  level: { id: number };
  wormholes?: { id: string; a: Cell; b: Cell; color: number }[];
  lives: number;
  remainingIds: string[];
  failedIds: string[];
  moving: {
    kind: string;
    headPosition: [number, number, number];
    duration: number;
    elapsed: number;
  } | null;
  camera: {
    position: [number, number, number];
    orientation: [number, number, number, number];
  };
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

async function state(page: Page): Promise<State> {
  const raw = await page.evaluate(() => window.render_game_to_text?.());
  assert.ok(raw);
  return JSON.parse(raw) as State;
}

async function finishMotion(page: Page): Promise<void> {
  const motion = (await state(page)).moving;
  if (motion)
    await page.evaluate(
      (time) => window.advanceTime?.(time),
      motion.duration - motion.elapsed + 32,
    );
}

async function project(
  page: Page,
  position: readonly number[],
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
  const point = new Vector3().fromArray(position).project(camera);
  return {
    x: ((point.x + 1) * bounds.width) / 2,
    y: ((1 - point.y) * bounds.height) / 2,
  };
}

async function pixels(
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

function countNear(
  image: { data: Buffer; width: number; height: number },
  x: number,
  y: number,
  radius: number,
  match: (r: number, g: number, b: number) => boolean,
): number {
  let found = 0;
  for (
    let py = Math.max(0, Math.floor(y - radius));
    py < Math.min(image.height, y + radius);
    py += 1
  ) {
    for (
      let px = Math.max(0, Math.floor(x - radius));
      px < Math.min(image.width, x + radius);
      px += 1
    ) {
      const offset = (py * image.width + px) * 3;
      if (
        match(
          image.data[offset] ?? 0,
          image.data[offset + 1] ?? 0,
          image.data[offset + 2] ?? 0,
        )
      )
        found += 1;
    }
  }
  return found;
}

const orange = (r: number, g: number, b: number): boolean =>
  r > 125 && g > 45 && r > g * 1.3 && g > b * 1.35;
const blue = (r: number, g: number, b: number): boolean =>
  b > 90 && b > r * 1.25 && b > g * 1.1;
const darkRibbon = (r: number, g: number, b: number): boolean =>
  r < 55 && g < 65 && b < 75;

async function activate(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (arrowId) => window.__PAR_ARROWS_TEST__?.activate(arrowId),
    id,
  );
  await finishMotion(page);
}

export async function assertWormholeIntro(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  await mkdir(`${output}/wormhole`, { recursive: true });
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
    await page.goto(`${url}&level=35`);
    await waitForReady(page);
    let current = await state(page);
    assert.equal(current.mode, "preview");
    assert.equal(current.level.id, 35);
    assert.deepEqual(current.wormholes, [
      { ...WORMHOLE_INTRO_LEVEL.wormholes?.[0], color: 0 },
    ]);

    // Preview allows the intentionally blocked gate before the walkthrough sequence.
    await activate(page, "wormhole-intro-gate");
    current = await state(page);
    assert.equal(current.lives, WORMHOLE_INTRO_LEVEL.lives - 1);
    assert.ok(current.failedIds.includes("wormhole-intro-gate"));
    assert.ok(current.remainingIds.includes("wormhole-intro-gate"));
    const gatePath = await page.evaluate(
      () =>
        window.__PAR_ARROWS_TEST__
          ?.getLevel()
          .arrows.find((arrow) => arrow.id === "wormhole-intro-gate")?.path,
    );
    assert.deepEqual(
      gatePath,
      WORMHOLE_INTRO_LEVEL.arrows[1]?.path,
      "The gate rewinds to its authored path",
    );
    await page.screenshot({ path: `${output}/wormhole/01-gate-blocked.png` });

    const introHole = WORMHOLE_INTRO_LEVEL.wormholes?.[0];
    assert.ok(introHole);
    const { a, b } = introHole;
    const before = await pixels(await page.locator("canvas").screenshot());
    const aPoint = await project(page, cellToWorld(a, 4));
    const bPoint = await project(page, cellToWorld(b, 4));
    const shot = await page.evaluate(() => {
      const test = window.__PAR_ARROWS_TEST__;
      const canvas = document.querySelector("canvas");
      if (!test || !canvas) throw new Error("Test hooks and canvas required");
      test.activate("wormhole-intro-portal");
      window.advanceTime?.(150);
      test.render();
      return {
        image: canvas.toDataURL("image/png"),
        state: window.render_game_to_text?.() ?? "{}",
      };
    });
    const moving = JSON.parse(shot.state) as State;
    assert.equal(moving.moving?.kind, "exit");
    const headPosition = moving.moving?.headPosition;
    assert.ok(headPosition, "The travelling head has a position");
    const headPoint = await project(page, headPosition);
    assert.ok(
      Math.hypot(headPoint.x - bPoint.x, headPoint.y - bPoint.y) < 110,
      "The head appears near exit B, not between the ends",
    );
    const frame = Buffer.from(shot.image.split(",")[1] ?? "", "base64");
    await writeFile(`${output}/wormhole/02-mid-move.png`, frame);
    const after = await pixels(frame);
    const canvasBounds = await page.locator("canvas").boundingBox();
    assert.ok(canvasBounds);
    const ratio = after.width / canvasBounds.width;
    // Sample the middle third of the projected jump, away from both rings.
    let extraBridgePixels = 0;
    for (let i = 0; i < 40; i += 1) {
      const t = 0.34 + (i / 40) * 0.32;
      const x = (aPoint.x + (bPoint.x - aPoint.x) * t) * ratio;
      const y = (aPoint.y + (bPoint.y - aPoint.y) * t) * ratio;
      const prior = countNear(before, x, y, 2, darkRibbon);
      const now = countNear(after, x, y, 2, darkRibbon);
      extraBridgePixels += Math.max(0, now - prior);
    }
    assert.ok(
      extraBridgePixels < 30,
      `No ribbon may span A to B (${extraBridgePixels} new dark pixels)`,
    );
    await finishMotion(page);
    current = await state(page);
    assert.ok(!current.remainingIds.includes("wormhole-intro-portal"));
    await activate(page, "wormhole-intro-gate");
    assert.ok(
      !(await state(page)).remainingIds.includes("wormhole-intro-gate"),
    );

    await page.reload();
    await waitForReady(page);
    current = await state(page);
    assert.equal(current.level.id, 35);
    assert.deepEqual(
      current.wormholes?.map((hole) => hole.color),
      [0],
    );
    assert.deepEqual(errors, [], "No errors in level 35 preview");
  } finally {
    await context.close();
  }

  const campaign = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const campaignPage = await campaign.newPage();
  try {
    await campaignPage.goto(url);
    await waitForReady(campaignPage);
    await campaignPage.evaluate(() =>
      window.__PAR_ARROWS_TEST__?.loadLevel(35),
    );
    await campaignPage.waitForFunction(
      () => JSON.parse(window.render_game_to_text?.() ?? "{}").level?.id === 35,
    );
    const tutorial = async (): Promise<{
      active: boolean;
      highlightId?: string;
      gate?: string[];
    }> =>
      (await campaignPage.evaluate(() => window.get_tutorial_state?.())) ?? {
        active: false,
      };
    assert.equal((await state(campaignPage)).mode, "campaign");
    assert.equal((await tutorial()).highlightId, "wormhole-intro-portal");
    await activate(campaignPage, "wormhole-intro-portal");
    assert.equal((await tutorial()).highlightId, "wormhole-intro-gate");
    assert.ok(
      !(await state(campaignPage)).remainingIds.includes(
        "wormhole-intro-portal",
      ),
    );
    await campaignPage.reload();
    await waitForReady(campaignPage);
    const restored = await state(campaignPage);
    assert.equal(restored.level.id, 35);
    assert.equal(restored.lives, WORMHOLE_INTRO_LEVEL.lives);
    assert.ok(!restored.remainingIds.includes("wormhole-intro-portal"));
    assert.ok(restored.remainingIds.includes("wormhole-intro-gate"));
    assert.equal((await tutorial()).highlightId, "wormhole-intro-gate");
    await activate(campaignPage, "wormhole-intro-gate");
    assert.ok(
      !(await state(campaignPage)).remainingIds.includes("wormhole-intro-gate"),
    );
  } finally {
    await campaign.close();
  }

  const two = Array.from({ length: 151 }, (_, index) => index + 50)
    .map((id) => generateLevel(id))
    .find((level) => level.wormholes?.length === 2);
  assert.ok(
    two,
    "A generated level from 50 through 200 must have two wormholes",
  );
  const generatedContext = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    colorScheme: "light",
  });
  const generatedPage = await generatedContext.newPage();
  try {
    await generatedPage.goto(`${url}&level=${two.id}`);
    await waitForReady(generatedPage);
    const current = await state(generatedPage);
    assert.equal(current.level.id, two.id);
    assert.deepEqual(
      current.wormholes?.map((hole) => hole.color),
      [0, 1],
    );
    assert.deepEqual(
      current.wormholes?.map(({ id, a, b }) => ({ id, a, b })),
      two.wormholes,
    );
    const bounds = await generatedPage.locator("canvas").boundingBox();
    assert.ok(bounds);
    // Face each ring directly: a projected center can be inside the canvas even when occluded.
    assert.ok(two.wormholes);
    for (const [index, hole] of two.wormholes.entries()) {
      const end = hole.a;
      const position = new Vector3(...cellToWorld(end, two.gridSize));
      const normal = new Vector3(...faceNormal(end.face));
      const facing = async (): Promise<number> => {
        const camera = (await state(generatedPage)).camera.position;
        return normal.dot(new Vector3(...camera).normalize());
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
          await generatedPage.evaluate(
            ([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y),
            [dx, dy] as const,
          );
          const candidate = await facing();
          await generatedPage.evaluate(
            ([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y),
            [-dx, -dy] as const,
          );
          if (candidate > bestScore) {
            bestScore = candidate;
            best = [dx, dy];
          }
        }
        if (!best) break;
        await generatedPage.evaluate(
          ([x, y]) => window.__PAR_ARROWS_TEST__?.orbit(x, y),
          best,
        );
        score = bestScore;
      }
      assert.ok(score >= 0.8, `Ring ${index} face must face the camera`);
      const projected = await project(generatedPage, position.toArray());
      await generatedPage.evaluate(() => window.__PAR_ARROWS_TEST__?.render());
      const image = await pixels(
        await generatedPage.locator("canvas").screenshot(),
      );
      const ratio = image.width / bounds.width;
      const matching = countNear(
        image,
        projected.x * ratio,
        projected.y * ratio,
        18 * ratio,
        index === 0 ? orange : blue,
      );
      await generatedPage.screenshot({
        path: `${output}/wormhole/03-generated-ring-${index}.png`,
      });
      assert.ok(
        matching > 10,
        `Ring ${index} must show its own hue (${matching} pixels)`,
      );
    }
    console.log(
      `PASS wormhole intro and generated two-color rings on level ${two.id}`,
    );
  } finally {
    await generatedContext.close();
  }
}
