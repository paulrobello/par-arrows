import assert from "node:assert/strict";
import type { Browser, Page } from "playwright";
import { generateLevel } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { overlappingArrowIds } from "../src/core/overlap";
import type {
  GameState,
  LevelDefinition,
  MoveResult,
  MoveTarget,
} from "../src/core/types";
import { gameStateKey } from "../src/core/undo";
import { solveLevelTargets } from "../src/core/validation";
import {
  activate,
  campaignRow,
  dispatchPowerup,
  openCampaign,
  runPowerupBrowser,
  savedRow,
} from "./powerup-browser-fixtures";
import { waitForReady } from "./runtime-fixtures";

interface Fixture {
  level: LevelDefinition;
  before: GameState;
  target: MoveTarget;
  result: MoveResult;
}
type Vec = [number, number, number];
interface View {
  coins: number;
  lives: number;
  moving: { phase: string; duration: number; anticipation: number } | null;
  heldCollision: { arrowId: string } | null;
  renderedHeads: Record<string, Vec>;
  visibleProjectedArrowPositions: { id: string; x: number; y: number }[];
  spotGlyphTurns: Record<string, number>;
  fragileGlyphCollapse: Record<string, number>;
  lockGlyphOpen: Record<string, number>;
}
const view = (page: Page): Promise<View> =>
  page.evaluate(() => JSON.parse(window.render_game_to_text?.() ?? "{}"));
const advance = (page: Page, ms: number) =>
  page.evaluate((ms) => window.advanceTime?.(ms), ms);
const distance = (a: Vec, b: Vec) =>
  Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
const head = (state: View, id: string): Vec => {
  const point = state.renderedHeads[id];
  assert.ok(point, `Rendered head exists for ${id}`);
  return point;
};

/** Burn distinct legal first collisions without moving the candidate's board. */
export function fatalFixture(
  level: LevelDefinition,
  accepts: (r: MoveResult, s: GameState) => boolean,
): Fixture {
  let prefix = createGameState(level);
  const solution = solveLevelTargets(level) ?? [];
  for (let step = 0; step <= solution.length; step++) {
    for (const arrow of level.arrows)
      for (const endpoint of arrow.kind === "double"
        ? (["head", "tail"] as const)
        : (["head"] as const)) {
        const target = { arrowId: arrow.id, endpoint };
        const result = simulateMove(level, prefix, arrow.id, endpoint);
        if (result.kind !== "blocked" || !accepts(result, prefix)) continue;
        const group = overlappingArrowIds(level, arrow.id);
        let before = prefix;
        for (const other of level.arrows) {
          if (before.lives === 1) break;
          if (group.includes(other.id)) continue;
          const failure = simulateMove(level, before, other.id);
          const next = applyMove(level, before, failure);
          if (failure.kind === "blocked" && next.lives === before.lives - 1)
            before = next;
        }
        const fatal = simulateMove(level, before, arrow.id, endpoint);
        if (before.lives === 1 && applyMove(level, before, fatal).lives === 0)
          return { level, before, target, result: fatal };
      }
    const target = solution[step];
    if (!target) break;
    prefix = applyMove(
      level,
      prefix,
      simulateMove(level, prefix, target.arrowId, target.endpoint),
    );
  }
  throw new Error(`No fatal fixture on level ${level.id}`);
}

async function checkFixture(
  browser: Browser,
  url: string,
  output: string,
  name: string,
  fixture: Fixture,
  mobile = false,
) {
  const { level, before, target, result } = fixture;
  const { page, context, errors } = await openCampaign(
    browser,
    url,
    campaignRow(level, before),
    mobile,
  );
  const ids = (result.members ?? [result]).map((m) => m.arrowId);
  try {
    const initial = await view(page);
    assert.equal(
      (await savedRow(page)).state.lives,
      1,
      `${name}: fixture survives validation`,
    );
    await activate(page, target.arrowId, target.endpoint, false);
    const outbound = await view(page);
    assert.equal(outbound.moving?.phase, "impact");
    await advance(
      page,
      (outbound.moving?.anticipation ?? 0) +
        (outbound.moving?.duration ?? 0) / 2,
    );
    assert.equal(
      (await view(page)).lives,
      1,
      "Life display changes at actual impact",
    );
    await advance(page, 10000);
    const held = await view(page);
    assert.equal(held.moving, null);
    assert.equal(held.heldCollision?.arrowId, target.arrowId);
    assert.equal(held.lives, 0);
    assert.equal(await page.locator("#recovery-undo").isVisible(), true);
    assert.match(
      await page.locator("#state-copy").innerText(),
      /stopped at the collision/,
    );
    assert.equal(held.coins, 200);
    assert.ok(
      ids.some((id) => distance(head(initial, id), head(held, id)) > 0.01),
      `${name}: actual displacement to contact`,
    );
    await advance(page, 10000);
    assert.deepEqual(
      (await view(page)).renderedHeads,
      held.renderedHeads,
      "Impact stays put indefinitely",
    );
    await page.screenshot({ path: `${output}/fatal-${name}-held.png` });
    await page.reload();
    await waitForReady(page);
    assert.deepEqual(
      (await view(page)).renderedHeads,
      held.renderedHeads,
      "Reload reconstructs exact impact geometry",
    );
    assert.equal(await page.locator("#state-card").isVisible(), false);
    await advance(page, 2001);
    await page.locator("#recovery-undo").click();
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").moving?.phase ===
        "rewind",
    );
    const start = await view(page);
    assert.deepEqual(
      start.renderedHeads,
      held.renderedHeads,
      "No snap before paid rewind",
    );
    assert.equal(start.coins, 180);
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(before),
      "Complete restore is durable before animation finishes",
    );
    assert.equal((await savedRow(page)).undo, null);
    await advance(page, (start.moving?.duration ?? 0) / 2);
    const midway = await view(page);
    assert.equal(midway.moving?.phase, "rewind");
    assert.ok(
      ids.some((id) => distance(head(midway, id), head(held, id)) > 0.001),
      `${name}: rewind visibly moves`,
    );
    assert.ok(
      ids.some((id) => distance(head(midway, id), head(initial, id)) > 0.001),
      `${name}: rewind has not snapped to start`,
    );
    await page.screenshot({ path: `${output}/fatal-${name}-rewinding.png` });
    await dispatchPowerup(page, "undo", 4);
    await dispatchPowerup(page, "hint", 2);
    await dispatchPowerup(page, "delete", 2);
    await activate(page, target.arrowId, target.endpoint, false);
    const visible = midway.visibleProjectedArrowPositions[0];
    const bounds = await page.locator("canvas").first().boundingBox();
    if (visible && bounds) {
      if (mobile)
        await page.touchscreen.tap(bounds.x + visible.x, bounds.y + visible.y);
      else await page.mouse.click(bounds.x + visible.x, bounds.y + visible.y);
    }
    await advance(page, 10000);
    const restored = await view(page);
    assert.equal(restored.moving, null);
    assert.equal(restored.heldCollision, null);
    assert.equal(restored.lives, 1);
    assert.equal(
      restored.coins,
      180,
      "No duplicate or concurrent paid action charges",
    );
    assert.deepEqual(
      restored.renderedHeads,
      initial.renderedHeads,
      "Every linked body/double endpoint returns exactly",
    );
    assert.deepEqual(restored.spotGlyphTurns, initial.spotGlyphTurns);
    assert.deepEqual(
      restored.fragileGlyphCollapse,
      initial.fragileGlyphCollapse,
    );
    assert.deepEqual(restored.lockGlyphOpen, initial.lockGlyphOpen);
    assert.equal(
      gameStateKey((await savedRow(page)).state),
      gameStateKey(before),
      "Buffered taps never run after rewind",
    );
    await page.reload();
    await waitForReady(page);
    assert.deepEqual((await view(page)).renderedHeads, initial.renderedHeads);
    assert.equal((await view(page)).coins, 180);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function failureAndRestart(
  browser: Browser,
  url: string,
  fixture: Fixture,
) {
  const { level, before, target } = fixture;
  const { page, context } = await openCampaign(
    browser,
    url,
    campaignRow(level, before),
  );
  try {
    await activate(page, target.arrowId, target.endpoint);
    const held = await view(page);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "par-arrows:campaign:v1")
          throw new DOMException("Denied", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    await dispatchPowerup(page, "undo", 3);
    await page.waitForFunction(() =>
      document
        .querySelector("#undo-status")
        ?.textContent?.includes("No coins spent"),
    );
    assert.deepEqual((await view(page)).renderedHeads, held.renderedHeads);
    assert.equal((await savedRow(page)).economy.coins, 200);
    await page.reload();
    await waitForReady(page);
    await dispatchPowerup(page, "undo");
    await page.waitForFunction(
      () =>
        JSON.parse(window.render_game_to_text?.() ?? "{}").moving?.phase ===
        "rewind",
    );
    await page.reload();
    await waitForReady(page);
    assert.equal((await view(page)).heldCollision, null);
    assert.equal((await view(page)).moving, null);
    assert.equal((await view(page)).lives, 1);
    assert.equal(
      (await view(page)).coins,
      180,
      "Closing mid-rewind cannot undo a successful debit",
    );
    await activate(page, target.arrowId, target.endpoint);
    await page.locator("#state-button").click();
    assert.equal((await savedRow(page)).state.lives, level.lives);
    assert.equal((await view(page)).heldCollision, null);
    assert.equal((await view(page)).coins, 180, "Restart stays free");
  } finally {
    await context.close();
  }
}

export async function assertFatalCollisionPreferencesAndLifecycle(
  browser: Browser,
  url: string,
) {
  const fixture = fatalFixture(generateLevel(2), (r) => r.distance > 1);
  for (const action of ["retry", "level", "reset"] as const) {
    const { page, context, errors } = await openCampaign(
      browser,
      url,
      campaignRow(fixture.level, fixture.before),
    );
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await activate(
        page,
        fixture.target.arrowId,
        fixture.target.endpoint,
        false,
      );
      const outbound = await view(page);
      assert.equal(outbound.moving?.anticipation, 0);
      assert.ok(outbound.moving && outbound.moving.duration < 110);
      await advance(page, 200);
      assert.equal(
        (await view(page)).heldCollision?.arrowId,
        fixture.target.arrowId,
      );
      await dispatchPowerup(page, "undo");
      await page.waitForFunction(
        () =>
          JSON.parse(window.render_game_to_text?.() ?? "{}").moving?.phase ===
          "rewind",
      );
      const rewind = await view(page);
      assert.ok(rewind.moving && rewind.moving.duration < 110);
      if (action === "retry") {
        await page.locator('.dock-button[data-action="retry"]').click();
        await page.waitForFunction(
          () =>
            JSON.parse(localStorage.getItem("par-arrows:campaign:v1") ?? "{}")
              .state?.revision === 0,
        );
      } else if (action === "level") {
        await page.locator("#level-input").fill("1");
        await page.locator("#level-form button").click();
        await page.waitForFunction(
          () =>
            JSON.parse(window.render_game_to_text?.() ?? "{}").level.id === 1,
        );
        await waitForReady(page);
      } else {
        await page.evaluate(() => window.__PAR_ARROWS_TEST__?.resetProgress());
        await page.waitForFunction(
          () => localStorage.getItem("par-arrows:campaign:v1") === null,
        );
      }
      await advance(page, 10000);
      const settled = await view(page);
      assert.equal(settled.moving, null);
      assert.equal(settled.heldCollision, null);
      assert.equal(settled.coins, action === "reset" ? 0 : 180);
      if (action !== "reset")
        assert.equal(
          (await savedRow(page)).state.revision,
          0,
          "Cancelled rewind never writes an older board back",
        );
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  console.log(
    "PASS fatal collision reduced motion and retry/navigation/reset during paid rewind",
  );
}

export async function assertFatalCollisionRewind(
  browser: Browser,
  url: string,
  output: string,
) {
  const plain = fatalFixture(generateLevel(2), (r) => r.distance > 1);
  await checkFixture(browser, url, output, "desktop", plain);
  await checkFixture(browser, url, output, "mobile", plain, true);
  const level26 = generateLevel(26);
  const level34 = generateLevel(34);
  await checkFixture(
    browser,
    url,
    output,
    "linked",
    fatalFixture(level26, (r) => (r.members?.length ?? 0) > 1),
  );
  await checkFixture(
    browser,
    url,
    output,
    "double",
    fatalFixture(
      level34,
      (r) =>
        r.endpoint === "tail" &&
        level34.arrows.find((a) => a.id === r.arrowId)?.kind === "double",
    ),
  );
  await checkFixture(
    browser,
    url,
    output,
    "portal",
    fatalFixture(generateLevel(44), (r) => (r.portals?.length ?? 0) > 0),
  );
  await checkFixture(
    browser,
    url,
    output,
    "parked-rotor",
    fatalFixture(generateLevel(58), (r, s) => !!s.settledPaths?.[r.arrowId]),
  );
  await failureAndRestart(browser, url, plain);
  await assertFatalCollisionPreferencesAndLifecycle(browser, url);
  console.log(
    "PASS fatal collision: desktop/mobile contact hold, exact reload pose, paid animated rewind, doubles/groups/portals/parked rotor, full mechanics restore, duplicate/input guards, storage failure, interrupted rewind and free restart",
  );
}

if (import.meta.main)
  await runPowerupBrowser("fatal-collision", assertFatalCollisionRewind);
