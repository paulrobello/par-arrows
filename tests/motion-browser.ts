import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import {
  GENERATOR_VERSION,
  generateLevel,
  seedForLevel,
} from "../src/content/procedural";
import { createGameState } from "../src/core/game-state";
import { simulateMove } from "../src/core/movement";
import type { ArrowDefinition, LevelDefinition } from "../src/core/types";
import { waitForReady } from "./runtime-fixtures";

interface MotionSample {
  readonly duration: number;
  readonly elapsed: number;
  readonly headFace: string;
  readonly headPosition: readonly [number, number, number];
}

interface MotionCase {
  readonly name: string;
  readonly level: LevelDefinition;
  readonly arrow: ArrowDefinition;
  readonly blocked?: boolean;
  readonly wrapped?: boolean;
}

async function sample(page: Page): Promise<MotionSample> {
  const motion = await page.evaluate(
    () => JSON.parse(window.render_game_to_text?.() ?? "{}").moving,
  );
  assert.ok(
    motion?.headPosition,
    "The rendered arrow tip must be available during motion",
  );
  return motion as MotionSample;
}

function measuredSpeed(
  before: MotionSample,
  after: MotionSample,
  delta: number,
): number {
  assert.equal(
    after.headFace,
    before.headFace,
    "Measure within one straight face segment",
  );
  const distance = Math.hypot(
    ...after.headPosition.map(
      (value, axis) => value - (before.headPosition[axis] ?? 0),
    ),
  );
  return distance / (delta / 1000);
}

export async function assertConsistentMotion(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  const early = generateLevel(2);
  const ordinary = early.arrows
    .filter((arrow) => arrow.path.at(-1)?.face === "front")
    .sort(
      (a, b) =>
        simulateMove(early, [a.id], a.id).distance -
        simulateMove(early, [b.id], b.id).distance,
    );
  const near = ordinary[0];
  const far = ordinary.at(-1);
  assert.ok(near && far);
  assert.ok(
    simulateMove(early, [far.id], far.id).distance >
      simulateMove(early, [near.id], near.id).distance,
  );
  const dense = generateLevel(10);
  const denseArrow = dense.arrows.find(
    (arrow) => arrow.path.at(-1)?.face === "front",
  );
  const wrapped = generateLevel(11);
  const wrappingArrow = wrapped.arrows.find(
    (arrow) => arrow.id === "r11-wrap-0",
  );
  const blocker = early.arrows.find((arrow) => {
    const result = simulateMove(
      early,
      early.arrows.map((entry) => entry.id),
      arrow.id,
    );
    return (
      result.kind === "blocked" && (result.distance * 2) / early.gridSize >= 0.5
    );
  });
  assert.ok(denseArrow && wrappingArrow && blocker);
  const cases: readonly MotionCase[] = [
    { name: "near", level: early, arrow: near },
    { name: "far", level: early, arrow: far },
    { name: "dense", level: dense, arrow: denseArrow },
    { name: "wrapped", level: wrapped, arrow: wrappingArrow, wrapped: true },
    { name: "blocked", level: early, arrow: blocker, blocked: true },
  ];
  const measurements: {
    name: string;
    duration: number;
    speed: number;
    returnSpeed: number | undefined;
  }[] = [];
  for (const fixture of cases) {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 760 },
      reducedMotion: "no-preference",
    });
    const initial = createGameState(fixture.level);
    const remainingIds = fixture.blocked
      ? initial.remainingIds
      : [fixture.arrow.id];
    await context.addInitScript(
      (saved) => localStorage.setItem("par-arrows:campaign:v1", saved),
      JSON.stringify({
        currentLevelId: fixture.level.id,
        unlockedLevelId: fixture.level.id,
        tutorialComplete: true,
        contentVersion: 6,
        generatorVersion: GENERATOR_VERSION,
        seed: seedForLevel(fixture.level.id),
        state: {
          ...initial,
          remainingIds,
          revision: fixture.level.arrows.length - remainingIds.length,
        },
      }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
      await page.goto(url);
      await waitForReady(page);
      await page.clock.pauseAt(new Date("2026-09-15T13:00:00Z"));
      await page.evaluate(
        (id) => window.__PAR_ARROWS_TEST__?.activate(id),
        fixture.arrow.id,
      );
      if (fixture.wrapped) await page.evaluate(() => window.advanceTime?.(80));
      const before = await sample(page);
      if (fixture.wrapped)
        assert.notEqual(before.headFace, fixture.arrow.path.at(-1)?.face);
      const delta = Math.min(50, before.duration / 8);
      await page.evaluate(
        (milliseconds) => window.advanceTime?.(milliseconds),
        delta,
      );
      const after = await sample(page);
      const speed = measuredSpeed(before, after, delta);
      assert.ok(
        Math.abs(speed - 5) < 0.005,
        `${fixture.name} rendered speed was ${speed}, expected 5 units/s`,
      );
      let returnSpeed: number | undefined;
      if (fixture.blocked) {
        await page.evaluate(
          (milliseconds) => window.advanceTime?.(milliseconds),
          before.duration * 0.7 - after.elapsed,
        );
        const returning = await sample(page);
        await page.evaluate(
          (milliseconds) => window.advanceTime?.(milliseconds),
          delta,
        );
        returnSpeed = measuredSpeed(returning, await sample(page), delta);
        assert.ok(
          Math.abs(returnSpeed - 5) < 0.005,
          `Rebound speed was ${returnSpeed}`,
        );
      }
      await page.screenshot({
        path: `${output}/motion-speed-${fixture.name}.png`,
      });
      measurements.push({
        name: fixture.name,
        duration: before.duration,
        speed,
        returnSpeed,
      });
      await page.evaluate(
        (milliseconds) => window.advanceTime?.(milliseconds),
        before.duration + 1,
      );
      const settled = await page.evaluate(() =>
        JSON.parse(window.render_game_to_text?.() ?? "{}"),
      );
      assert.equal(settled.moving, null);
      assert.equal(
        settled.remainingIds.includes(fixture.arrow.id),
        fixture.blocked === true,
      );
      assert.equal(
        settled.lives,
        fixture.level.lives - (fixture.blocked ? 1 : 0),
      );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  await Bun.write(
    `${output}/motion-speed-measurements.json`,
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    "PASS rendered constant speed for near/far exits, different grids, yellow wrapping, and both rebound legs",
  );
}
