import { expect, test } from "bun:test";
import { constructLock } from "../src/content/lock";
import { Rng, isAuthoredLevel } from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import {
  validateLevel,
  hasStrandingState,
  hasSoftLockState,
  solveLevelTargets,
} from "../src/core/validation";
import { mechanicStructure, blockingStructure } from "./mechanic-structure";
import { cachedLevel } from "./generated-levels";
import type { LevelDefinition } from "../src/core/types";

const base: LevelDefinition = {
  id: 90,
  title: "grown key dependency",
  gridSize: 16,
  lives: 3,
  arrows: [],
};
function prove(level: LevelDefinition): void {
  expect(validateLevel(level).errors).toEqual([]);
  for (const arrow of level.arrows)
    expect(arrow.path.length, arrow.id).toBeGreaterThanOrEqual(3);
  const lock = level.locks![0]!,
    opener = level.arrows.find((a) => a.id.endsWith("-opener"))!,
    key = level.arrows.find((a) => a.id.endsWith("-key"))!;
  const initial = createGameState(level),
    gated = simulateMove(level, initial, opener.id);
  expect(gated.kind).toBe("gated");
  expect(applyMove(level, initial, gated).lives).toBe(level.lives);
  expect(simulateMove({ ...level, locks: [] }, initial, opener.id).kind).toBe(
    "exit",
  );
  const certificate = solveLevelTargets(level);
  expect(certificate).toBeDefined();
  const ids = certificate!.map((t) => t.arrowId);
  expect(ids.indexOf(key.id)).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf(key.id)).toBeLessThan(ids.indexOf(opener.id));
  let current = initial;
  let opened = false;
  for (const target of certificate!) {
    const move = simulateMove(level, current, target.arrowId, target.endpoint);
    expect(move.kind).toBe("exit");
    if (target.arrowId === key.id) {
      expect(move.unlocks?.map((e) => e.id)).toEqual([lock.id]);
      opened = true;
    } else expect(move.unlocks ?? []).toEqual([]);
    if (target.arrowId === opener.id) {
      expect(opened).toBe(true);
      expect(current.unlocked).toEqual([lock.id]);
    }
    current = applyMove(level, current, move);
  }
  expect(current.status).toBe("won");
  expect(current.lives).toBe(level.lives);
  expect(current.unlocked).toEqual([lock.id]);
  expect(hasStrandingState(level)).toBe(false);
  expect(hasSoftLockState(level)).toBe(false);
}
function heads(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    arrows: level.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
  };
}
test("lock circuits grow actual keyed routes and variable dependency graphs", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set(),
    sizes = new Set(),
    lengths = new Set();
  let cross = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const core = constructLock(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(core, String(seed)).toBeDefined();
    if (!core) continue;
    const level = { ...base, arrows: core.arrows, locks: [core.lock] };
    prove(level);
    whole.add(mechanicStructure(level));
    headLayouts.add(mechanicStructure(heads(level)));
    graphs.add(blockingStructure(level, createGameState(level)));
    sizes.add(core.arrows.length);
    for (const arrow of core.arrows) lengths.add(arrow.path.length);
    if (core.lock.key.face !== core.lock.lock.face) cross++;
  }
  console.log({
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
    sizes: [...sizes],
    lengths: [...lengths],
    cross,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(headLayouts.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(4);
  expect([...sizes].sort()).toEqual([2, 3, 4]);
  expect(cross).toBeGreaterThan(16);
  expect(cross).toBeLessThan(64);
});
test("lock construction is deterministic and bounded without an authored fallback", () => {
  const run = () => constructLock(base, new Rng(0x123456), new Set());
  expect(run()).toEqual(run());
  expect(constructLock(base, new Rng(1), new Set(), 0)).toBeUndefined();
  const occupied = new Set<string>();
  for (const face of ["front", "back", "left", "right", "top", "bottom"]) {
    for (let x = 0; x < base.gridSize; x++)
      for (let y = 0; y < base.gridSize; y++)
        occupied.add(face + ":" + x + ":" + y);
  }
  expect(constructLock(base, new Rng(1), occupied, 1)).toBeUndefined();
});
test("shipping lock circuits vary real bodies and glyph relations while retaining safe unlock order", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set();
  let placed = 0;
  for (let id = 51; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id),
      arrows = level.arrows.filter((a) => a.id.includes("-lock-"));
    if (!arrows.length) continue;
    placed++;
    const core: LevelDefinition = {
      id,
      title: "shipping key",
      gridSize: level.gridSize,
      lives: level.lives,
      arrows,
      locks: level.locks!,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
    };
    prove(core);
    whole.add(mechanicStructure(core));
    headLayouts.add(mechanicStructure(heads(core)));
    graphs.add(blockingStructure(core, createGameState(core)));
  }
  console.log({
    placed,
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
  });
  expect(placed).toBeGreaterThanOrEqual(65);
  expect(whole.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(headLayouts.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(graphs.size).toBeGreaterThanOrEqual(4);
}, 600000);

test("coupled keyed and reflected circuits retain actual stateful completion", () => {
  for (const id of [158, 163]) {
    const level = cachedLevel(id);
    expect(level.locks?.length, String(id)).toBe(1);
    expect(level.mirrors?.length, String(id)).toBe(1);
    const certificate = solveLevelTargets(level);
    expect(certificate).toBeDefined();
    let state = createGameState(level);
    for (const target of certificate!) {
      const move = simulateMove(level, state, target.arrowId, target.endpoint);
      expect(["exit", "paused"], String(id)).toContain(move.kind);
      state = applyMove(level, state, move);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(level.lives);
  }
}, 20000);
