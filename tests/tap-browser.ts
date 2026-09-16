import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { generateLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { waitForReady } from "./runtime-fixtures";

interface TapState {
  selectedArrowId?: string;
  remainingIds: string[];
  failedIds: string[];
  parkedOffsets: Record<string, number>;
  lives: number;
  moving: { arrowId: string; duration: number } | null;
  camera: { distance: number };
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
}

interface Gesture {
  down(x: number, y: number): Promise<unknown>;
  move(x: number, y: number): Promise<unknown>;
  up(): Promise<unknown>;
}

async function snapshot(page: Page): Promise<TapState> {
  return JSON.parse(
    await page.evaluate(() => window.render_game_to_text?.() ?? "{}"),
  ) as TapState;
}

async function eventCount(page: Page, type: string): Promise<number> {
  return page.evaluate(
    (type) =>
      (Reflect.get(window, "tapEventCounts") as Record<string, number>)[type] ??
      0,
    type,
  );
}

async function dispatch(
  page: Page,
  type: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const before = await eventCount(page, type);
  await action();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await eventCount(page, type)) > before) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Browser did not deliver ${type}`);
}

async function resetLevel(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.__PAR_ARROWS_TEST__?.loadLevel(10);
    document.querySelector<HTMLButtonElement>('[data-action="reset"]')?.click();
  });
}

async function settle(page: Page): Promise<void> {
  const moving = (await snapshot(page)).moving;
  if (moving)
    await page.evaluate(
      (duration) => window.advanceTime?.(duration + 1),
      moving.duration,
    );
}

export async function assertReliableTaps(
  browser: Browser,
  url: string,
  output: string,
): Promise<void> {
  for (const touch of browser.browserType().name() === "chromium"
    ? [false, true]
    : [false]) {
    const context = await browser.newContext({
      viewport: touch
        ? { width: 390, height: 844 }
        : { width: 1100, height: 760 },
      hasTouch: touch,
      isMobile: touch,
      colorScheme: "light",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.clock.install({ time: new Date("2026-09-15T12:00:00Z") });
      await page.goto(url);
      await waitForReady(page);
      await page.clock.pauseAt(new Date("2026-09-15T13:00:00Z"));
      await page.evaluate(() => {
        const counts: Record<string, number> = {};
        Reflect.set(window, "tapEventCounts", counts);
        for (const type of ["pointerdown", "pointermove", "pointerup", "wheel"])
          document.querySelector("canvas")?.addEventListener(type, () => {
            counts[type] = (counts[type] ?? 0) + 1;
          });
      });
      const client = touch ? await context.newCDPSession(page) : undefined;
      const gesture: Gesture = client
        ? {
            down: (x, y) =>
              client.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1 }],
              }),
            move: (x, y) =>
              client.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1 }],
              }),
            up: () =>
              client.send("Input.dispatchTouchEvent", {
                type: "touchEnd",
                touchPoints: [],
              }),
          }
        : {
            down: async (x, y) => {
              await page.mouse.move(x, y);
              await page.mouse.down();
            },
            move: (x, y) => page.mouse.move(x, y),
            up: () => page.mouse.up(),
          };
      await resetLevel(page);
      const level = generateLevel(10);
      const initial = createGameState(level);
      const points = [
        ...(await snapshot(page)).visibleProjectedArrowPositions,
      ].sort(
        (a, b) =>
          (level.arrows.find((arrow) => arrow.id === b.id)?.path.length ?? 0) -
          (level.arrows.find((arrow) => arrow.id === a.id)?.path.length ?? 0),
      );
      const target = points[0];
      assert.ok(target);
      const bounds = await page.locator("canvas").boundingBox();
      assert.ok(bounds);
      const x = target.x + bounds.x;
      const y = target.y + bounds.y;
      const expected = simulateMove(level, initial, target.id);
      assert.notEqual(expected.kind, "invalid");
      const offsets = [
        [0, 0],
        [4, 0],
        [-4, 0],
        [0, 4],
        [0, -4],
        [5, 5],
        [-5, 5],
        [5, -5],
        [-5, -5],
        [8, 0],
        [0, 8],
      ] as const;
      for (const [dx, dy] of offsets) {
        await resetLevel(page);
        await dispatch(page, "pointerdown", () => gesture.down(x, y));
        assert.equal(
          (await snapshot(page)).selectedArrowId,
          target.id,
          "The intended arrow must highlight on press",
        );
        if (dx || dy)
          await dispatch(page, "pointermove", () =>
            gesture.move(x + dx, y + dy),
          );
        assert.equal(
          (await snapshot(page)).selectedArrowId,
          target.id,
          "Tap-sized drift must keep the pressed arrow",
        );
        await dispatch(page, "pointerup", () => gesture.up());
        await settle(page);
        const result = await snapshot(page);
        const missed = `Missed ${touch ? "touch" : "mouse"} release at ${dx},${dy}`;
        if (expected.kind === "exit")
          assert.equal(result.remainingIds.includes(target.id), false, missed);
        else if (expected.kind === "paused")
          // A park keeps the arrow on the cube and costs it nothing.
          assert.deepEqual(
            result.parkedOffsets,
            { [target.id]: expected.pausedSteps },
            missed,
          );
        else assert.deepEqual(result.failedIds, [target.id], missed);
        assert.equal(
          result.lives,
          level.lives - (expected.kind === "blocked" ? 1 : 0),
        );
      }
      await resetLevel(page);
      await dispatch(page, "pointerdown", () => gesture.down(x, y));
      await dispatch(page, "pointermove", () => gesture.move(x + 20, y));
      await dispatch(page, "pointermove", () => gesture.move(x, y));
      await dispatch(page, "pointerup", () => gesture.up());
      assert.deepEqual((await snapshot(page)).failedIds, []);
      assert.equal(
        (await snapshot(page)).remainingIds.length,
        level.arrows.length,
      );

      if (!touch) {
        await resetLevel(page);
        await dispatch(page, "pointerdown", () => gesture.down(x, y));
        await dispatch(page, "wheel", () => page.mouse.wheel(0, -80));
        await dispatch(page, "pointerup", () => gesture.up());
        assert.equal((await snapshot(page)).moving, null);
        assert.deepEqual((await snapshot(page)).failedIds, []);
      } else if (client) {
        await resetLevel(page);
        const distance = (await snapshot(page)).camera.distance;
        await dispatch(page, "pointerdown", () => gesture.down(x, y));
        const secondX = x > bounds.width / 2 ? x - 70 : x + 70;
        await dispatch(page, "pointerdown", () =>
          client.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { id: 1, x, y },
              { id: 2, x: secondX, y },
            ],
          }),
        );
        assert.equal((await snapshot(page)).selectedArrowId, undefined);
        await dispatch(page, "pointermove", () =>
          client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              { id: 1, x: x - 12, y },
              { id: 2, x: secondX + 12, y },
            ],
          }),
        );
        await dispatch(page, "pointerup", () =>
          client.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          }),
        );
        const pinched = await snapshot(page);
        assert.notEqual(pinched.camera.distance, distance);
        assert.deepEqual(pinched.failedIds, []);
        assert.equal(pinched.remainingIds.length, level.arrows.length);
      }

      await resetLevel(page);
      const clear = points.find(
        (point) => simulateMove(level, initial, point.id).kind === "exit",
      );
      const other = points.find((point) => point.id !== clear?.id);
      assert.ok(clear && other);
      await page.evaluate(
        (id) => window.__PAR_ARROWS_TEST__?.activate(id),
        clear.id,
      );
      await dispatch(page, "pointerdown", () =>
        gesture.down(bounds.x + other.x, bounds.y + other.y),
      );
      assert.equal(
        (await snapshot(page)).selectedArrowId,
        undefined,
        "A busy press must not imply an accepted arrow click",
      );
      await dispatch(page, "pointerup", () => gesture.up());
      assert.equal(
        (await snapshot(page)).moving?.arrowId,
        clear.id,
        "A busy tap must not preempt the running move",
      );
      await settle(page);
      assert.equal(
        (await snapshot(page)).moving?.arrowId,
        other.id,
        "The busy tap must buffer and start once the running move settles",
      );
      await settle(page);
      const busyResult = await snapshot(page);
      const otherExpected = simulateMove(
        level,
        applyMove(level, initial, simulateMove(level, initial, clear.id)),
        other.id,
      );
      if (otherExpected.kind === "exit")
        assert.equal(busyResult.remainingIds.includes(other.id), false);
      else if (otherExpected.kind === "paused")
        assert.deepEqual(busyResult.parkedOffsets, {
          ...busyResult.parkedOffsets,
          [other.id]: otherExpected.pausedSteps,
        });
      else assert.deepEqual(busyResult.failedIds, [other.id]);
      assert.equal(
        busyResult.remainingIds.length,
        level.arrows.length - (otherExpected.kind === "exit" ? 2 : 1),
      );
      assert.deepEqual(
        busyResult.failedIds.length,
        otherExpected.kind === "blocked" ? 1 : 0,
      );
      await page.screenshot({
        path: `${output}/reliable-taps-${touch ? "touch" : "mouse"}.png`,
      });
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${touch ? "native touch" : "mouse"} tap jitter, drag cancellation, and buffered busy taps (${offsets.length} release offsets)`,
      );
      await client?.detach();
    } finally {
      await context.close();
    }
  }
}
