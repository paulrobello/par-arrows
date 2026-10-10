import { expect, test } from "bun:test";
import {
  AUTHORED_LEVEL_IDS,
  generateLevel,
  seedForLevel,
} from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import { settledPathOf } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import {
  hasStrandingState,
  hasSoftLockState,
  validateLevel,
} from "../src/core/validation";
import { scriptForLevel, TutorialRunner } from "../src/tutorial";
import { mechanicStructure } from "./mechanic-structure";

function ground(level: ReturnType<typeof generateLevel>) {
  return {
    id: level.id,
    title: level.title,
    gridSize: level.gridSize,
    lives: level.lives,
    arrows: level.arrows,
    ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
  };
}
test("all thirteen introductions have distinct whole and head geometry after cube symmetries", () => {
  const whole = new Map<string, number>(),
    heads = new Map<string, number>();
  expect(AUTHORED_LEVEL_IDS.length).toBe(13);
  for (const id of AUTHORED_LEVEL_IDS) {
    const bare = ground(generateLevel(id));
    for (const [seen, board] of [
      [whole, bare],
      [
        heads,
        {
          ...bare,
          arrows: bare.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
        },
      ],
    ] as const) {
      const shape = mechanicStructure(board);
      expect(
        seen.get(shape),
        `lesson ${id} copies lesson ${seen.get(shape)}`,
      ).toBeUndefined();
      seen.set(shape, id);
    }
  }
});
test("authored lessons contain no reciprocal head-only stamp after any safe prefix", () => {
  for (const id of AUTHORED_LEVEL_IDS) {
    const level = generateLevel(id),
      bare = ground(level),
      queue = [createGameState(level)],
      seen = new Set<string>();
    while (queue.length) {
      const state = queue.pop()!,
        key = JSON.stringify(state);
      if (seen.has(key)) continue;
      seen.add(key);
      expect(seen.size).toBeLessThan(5000);
      for (const arrow of level.arrows.filter((a) =>
        state.remainingIds.includes(a.id),
      )) {
        const move = simulateMove(bare, state, arrow.id);
        if (move.blockerId && move.contact) {
          const other = level.arrows.find((a) => a.id === move.blockerId)!;
          const back = simulateMove(bare, state, other.id);
          expect(
            Boolean(
              back.blockerId === arrow.id &&
                back.contact &&
                cellKey(move.contact.cell) ===
                  cellKey(settledPathOf(level, state, other).at(-1)!) &&
                cellKey(back.contact.cell) ===
                  cellKey(settledPathOf(level, state, arrow).at(-1)!),
            ),
            `head pair in lesson ${id}: ${arrow.id}/${other.id}`,
          ).toBe(false);
        }
        for (const endpoint of arrow.kind === "double"
          ? (["head", "tail"] as const)
          : (["head"] as const)) {
          const actual = simulateMove(level, state, arrow.id, endpoint);
          if (actual.kind === "exit" || actual.kind === "paused")
            queue.push(applyMove(level, state, actual));
        }
      }
    }
  }
});
test.each([20, 40, 55])(
  "revised lesson %s replays its actual guided sequence safely and deterministically",
  (id) => {
    const level = generateLevel(id);
    expect(generateLevel(id)).toEqual(level);
    expect(seedForLevel(id)).toEndWith("intro:2");
    expect(validateLevel(level).errors).toEqual([]);
    expect(hasStrandingState(level)).toBe(false);
    expect(hasSoftLockState(level)).toBe(false);
    expect(level.arrows.every((a) => a.path.length >= 3)).toBe(true);
    const script = scriptForLevel(id)!;
    expect(script).toBeDefined();
    const runner = new TutorialRunner(script);
    let state = createGameState(level);
    for (const step of script.steps) {
      if (step.advance.kind === "won") {
        runner.onWon();
        continue;
      }
      const arrowId = step.advance.arrowIds[0]!;
      expect(runner.current.highlightId).toBe(step.highlightId);
      expect([...(runner.gate ?? [])]).toContain(arrowId);
      const move = simulateMove(level, state, arrowId, step.advance.endpoint);
      expect(step.advance.outcomes).toContain(move.kind);
      expect(move.kind).toBe("exit");
      state = applyMove(level, state, move);
      runner.onMove(move);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(5);
    expect(state.failedIds).toEqual([]);
    expect(runner.done).toBe(true);
  },
);
