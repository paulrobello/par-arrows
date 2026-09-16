import assert from "node:assert/strict";
import type { Browser, CDPSession, Page } from "playwright";
import { generateLevel } from "../src/content/procedural";
import { createGameState, simulateMove } from "../src/core/game-state";
import type { LevelDefinition } from "../src/core/types";
import { waitForReady } from "./runtime-fixtures";

/** Levels the sweep runs over: the second is the densest generated grid. */
const LEVEL_IDS = [2, 10] as const;
/** How far off an arrow a finger may land and still mean that arrow. */
const OFFSET_PX = 7;
/** Directions probed around each arrow. */
const RING = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [0.7, -0.7],
  [-0.7, -0.7],
] as const;
/**
 * Fraction of near-miss presses that must reach an arrow. Measured against the
 * same sweep with the margin disabled, which scores 0.49 (level 2) and 0.54
 * (level 10), so this cannot pass without the widened zone.
 */
const MINIMUM_COVERAGE = 0.75;

interface PickState {
  selectedArrowId?: string;
  remainingIds: string[];
  failedIds: string[];
  lives: number;
  moving: { arrowId: string; duration: number } | null;
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

async function snapshot(page: Page): Promise<PickState> {
  return JSON.parse(
    await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
  ) as PickState;
}

async function loadLevel(page: Page, levelId: number): Promise<void> {
  await page.evaluate(async (id) => {
    await window.__PAR_ARROWS_TEST__?.loadLevel(id);
    document.querySelector<HTMLButtonElement>('[data-action="reset"]')?.click();
  }, levelId);
}

function isSafe(
  level: LevelDefinition,
  state: ReturnType<typeof createGameState>,
  arrowId: string,
): boolean {
  return ["exit", "paused"].includes(simulateMove(level, state, arrowId).kind);
}

export async function assertWidePickTargets(
  browser: Browser,
  url: string,
): Promise<void> {
  if (browser.browserType().name() !== "chromium") return;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    colorScheme: "light",
    baseURL: url,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await waitForReady(page);
    const client = await context.newCDPSession(page);
    const touch = async (
      session: CDPSession,
      x: number,
      y: number,
    ): Promise<void> => {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1 }],
      });
    };
    /**
     * Reads the press highlight, then drops the press through the app's blur
     * path so probing never activates an arrow or orbits the cube.
     */
    const pressOnly = async (
      x: number,
      y: number,
    ): Promise<string | undefined> => {
      await touch(client, x, y);
      const selected = (await snapshot(page)).selectedArrowId;
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      return selected;
    };

    for (const levelId of LEVEL_IDS) {
      await loadLevel(page, levelId);
      const level = generateLevel(levelId);
      const initial = createGameState(level);
      const bounds = await page.locator("canvas").boundingBox();
      assert.ok(bounds, "The cube must be on screen");
      const allPoints = (await snapshot(page)).visibleProjectedArrowPositions;
      const points = allPoints.slice(0, 20);
      assert.ok(points.length >= 10, "The sweep needs several exposed arrows");

      let reached = 0;
      let probes = 0;
      let safePreferred = 0;
      for (const point of points) {
        for (const [dx, dy] of RING) {
          probes += 1;
          const x = point.x + dx * OFFSET_PX;
          const y = point.y + dy * OFFSET_PX;
          const selected = await pressOnly(x + bounds.x, y + bounds.y);
          if (!selected) continue;
          reached += 1;
          // The preference fired if a colliding arrow sat nearer the press
          // than the safe one the game handed back.
          const gap = (id: string): number => {
            const at = allPoints.find((entry) => entry.id === id);
            return at
              ? Math.hypot(at.x - x, at.y - y)
              : Number.POSITIVE_INFINITY;
          };
          if (
            isSafe(level, initial, selected) &&
            allPoints.some(
              (other) =>
                other.id !== selected &&
                !isSafe(level, initial, other.id) &&
                Math.hypot(other.x - x, other.y - y) < gap(selected),
            )
          )
            safePreferred += 1;
        }
      }
      const coverage = reached / probes;
      assert.ok(
        coverage >= MINIMUM_COVERAGE,
        `Level ${levelId} near-miss presses reached an arrow ${reached}/${probes} (${coverage.toFixed(2)}), below ${MINIMUM_COVERAGE}`,
      );
      assert.ok(
        safePreferred > 0,
        `Level ${levelId} never preferred a safe arrow over a nearer colliding one across ${probes} near-miss presses`,
      );

      // A press aimed squarely at an arrow keeps that arrow, even when a safe
      // neighbour sits inside the widened zone.
      const contested = allPoints.find((point) => {
        if (isSafe(level, initial, point.id)) return false;
        return allPoints.some(
          (other) =>
            other.id !== point.id &&
            isSafe(level, initial, other.id) &&
            Math.hypot(other.x - point.x, other.y - point.y) <= OFFSET_PX * 2,
        );
      });
      assert.ok(
        contested,
        `Level ${levelId} must contain a colliding arrow beside a safe one`,
      );
      await loadLevel(page, levelId);
      assert.equal(
        await pressOnly(contested.x + bounds.x, contested.y + bounds.y),
        contested.id,
        `Level ${levelId} press aimed at ${contested.id} must keep it`,
      );

      // The same widened zone must carry through to a real activation.
      await loadLevel(page, levelId);
      const target = points[0];
      assert.ok(target);
      let offset: (typeof RING)[number] | undefined;
      for (const candidate of RING) {
        const selected = await pressOnly(
          target.x + bounds.x + candidate[0] * OFFSET_PX,
          target.y + bounds.y + candidate[1] * OFFSET_PX,
        );
        if (selected === target.id) {
          offset = candidate;
          break;
        }
      }
      assert.ok(
        offset,
        `Level ${levelId} arrow ${target.id} was unreachable ${OFFSET_PX}px off centre`,
      );
      const expected = simulateMove(level, initial, target.id);
      const x = target.x + bounds.x + offset[0] * OFFSET_PX;
      const y = target.y + bounds.y + offset[1] * OFFSET_PX;
      await touch(client, x, y);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      const moving = (await snapshot(page)).moving;
      if (moving)
        await page.evaluate(
          (duration) => window.advanceTime?.(duration + 1),
          moving.duration,
        );
      const settled = await snapshot(page);
      if (expected.kind === "exit")
        assert.equal(
          settled.remainingIds.includes(target.id),
          false,
          `Level ${levelId} off-centre tap failed to launch ${target.id}`,
        );
      else
        assert.ok(
          settled.failedIds.includes(target.id) ||
            !settled.remainingIds.includes(target.id) ||
            settled.lives < level.lives,
          `Level ${levelId} off-centre tap did nothing for ${target.id}`,
        );
    }
    assert.deepEqual(errors, [], "The widened pick sweep must not log errors");
    console.log(
      "PASS widened touch targets, safe-preference picking, and off-centre activation",
    );
  } finally {
    await context.close();
  }
}
