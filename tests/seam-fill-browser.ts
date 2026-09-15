import assert from "node:assert/strict";
import type { Browser } from "playwright";
import sharp from "sharp";
import { PerspectiveCamera, Vector3 } from "three";
import { generateLevel } from "../src/content/procedural";
import { faceNormal } from "../src/core/topology";
import { arrowDimensions, expandedPoints } from "../src/render/renderer";

export async function assertSeamFills(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const gaps: {
    levelId: number;
    pixels: { x: number; y: number; rgb: number[] }[];
  }[] = [];
  try {
    await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
    await page.goto(url);
    await page.waitForFunction(
      () =>
        window.__PAR_ARROWS_TEST__ &&
        !JSON.parse(window.render_game_to_text?.() ?? "{}").loading,
    );
    await page.clock.pauseAt(new Date("2026-09-15T13:00:00Z"));
    await page.evaluate(() => {
      const select =
        document.querySelector<HTMLSelectElement>("#theme-select")!;
      select.value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    for (const id of [10, 26]) {
      await page.evaluate(
        (id) => window.__PAR_ARROWS_TEST__?.loadLevel(id),
        id,
      );
      await page.evaluate(() =>
        document
          .querySelector<HTMLButtonElement>('[data-action="reset"]')
          ?.click(),
      );
      await page.mouse.move(650, 700);
      await page.mouse.down();
      await page.mouse.move(530, 700, { steps: 12 });
      await page.mouse.up();
      const level = generateLevel(id);
      assert.equal(
        level.edgePolicies?.some(
          (policy) =>
            policy.face === "front" &&
            policy.edge === "east" &&
            policy.policy === "continue",
        ) ?? false,
        id === 26,
        "Keep one ordinary-edge fixture and one yellow-edge fixture",
      );
      const bounds = await page.locator("canvas").boundingBox();
      assert.ok(bounds);
      const diagnostic = await page.evaluate(() =>
        JSON.parse(window.render_game_to_text?.() ?? "{}"),
      );
      const camera = new PerspectiveCamera(
        32,
        bounds.width / bounds.height,
        0.1,
        40,
      );
      camera.position.fromArray(diagnostic.camera.position);
      camera.quaternion.fromArray(diagnostic.camera.orientation);
      camera.updateMatrixWorld();
      assert.ok(
        camera.position.x > 1 && camera.position.z > 1,
        "Both sides of the tested fold must be exposed",
      );
      const centers: Vector3[] = [];
      const width = arrowDimensions(
        level.gridSize,
        level.arrowScale,
      ).ribbonWidth;
      for (const arrow of level.arrows) {
        const path = expandedPoints(arrow.path, level.gridSize);
        for (let index = 1; index < path.segmentFaces.length; index += 1) {
          const from = path.segmentFaces[index - 1];
          const to = path.segmentFaces[index];
          const joint = path.points[index];
          if (
            !from ||
            !to ||
            !joint ||
            !([from, to].includes("front") && [from, to].includes("right"))
          )
            continue;
          const firstNormal = new Vector3(...faceNormal(from));
          const nextNormal = new Vector3(...faceNormal(to));
          const side = firstNormal.clone().cross(nextNormal);
          for (const across of [-0.2, 0, 0.2])
            centers.push(
              joint
                .clone()
                .addScaledVector(firstNormal, 0.004)
                .addScaledVector(nextNormal, 0.004)
                .addScaledVector(side, width * across),
            );
        }
      }
      assert.ok(
        centers.length >= 3,
        `Level ${id} must contain a ribbon across the tested edge`,
      );
      const capture = await page.locator("canvas").screenshot();
      const { data, info } = await sharp(capture)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const failures: { x: number; y: number; rgb: number[] }[] = [];
      for (const center of centers) {
        const projected = center.clone().project(camera);
        const x = Math.floor(((projected.x + 1) * info.width) / 2);
        const y = Math.floor(((1 - projected.y) * info.height) / 2);
        const pixel = (y * info.width + x) * 3;
        const rgb = [...data.subarray(pixel, pixel + 3)];
        if ((rgb[0] ?? 0) < 230 || (rgb[1] ?? 0) < 220 || (rgb[2] ?? 0) < 195)
          failures.push({ x, y, rgb });
      }
      await page.screenshot({ path: `${output}/solid-seam-level-${id}.png` });
      const detailCenter = centers[Math.floor(centers.length / 2)]
        ?.clone()
        .project(camera);
      assert.ok(detailCenter);
      await page.screenshot({
        path: `${output}/solid-seam-level-${id}-detail.png`,
        clip: {
          x: bounds.x + ((detailCenter.x + 1) * bounds.width) / 2 - 65,
          y: bounds.y + ((1 - detailCenter.y) * bounds.height) / 2 - 55,
          width: 130,
          height: 110,
        },
      });
      if (failures.length > 0) gaps.push({ levelId: id, pixels: failures });
    }
    assert.deepEqual(
      gaps,
      [],
      "Cube edges must not leave gaps through opaque arrow fills",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS opaque ribbon pixels across ordinary and yellow cube seams",
    );
  } finally {
    await context.close();
  }
}
