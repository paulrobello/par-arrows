import { expect, test } from "bun:test";
import { constructWormhole } from "../src/content/wormhole";
import { generateLevel, Rng } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import {
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { cellKey } from "../src/core/topology";
import type { LevelDefinition } from "../src/core/types";
import { mechanicStructure, blockingStructure } from "./mechanic-structure";
const base: LevelDefinition = {
  id: 90,
  title: "grown portal circuit",
  gridSize: 16,
  lives: 3,
  arrows: [],
};
test("wormhole topology grows varied required circuits with a real far-side dependency", () => {
  const whole = new Set<string>(),
    heads = new Set<string>(),
    graphs = new Set<string>(),
    sizes = new Set<number>();
  let threeFaces = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const core = constructWormhole(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(core, `seed ${seed}`).toBeDefined();
    if (!core) continue;
    const level = { ...base, arrows: core.arrows, wormholes: [core.wormhole] };
    expect(validateLevel(level).errors).toEqual([]);
    const initial = createGameState(level);
    const portal = level.arrows.find((a) => a.id.endsWith("-portal"))!;
    const far = level.arrows.find((a) => a.id.endsWith("-far"))!;
    expect(far.path.length).toBeGreaterThanOrEqual(3);
    const blocked = simulateMove(level, initial, portal.id);
    expect(blocked.kind).toBe("blocked");
    expect(blocked.blockerId).toBe(far.id);
    expect(blocked.portals).toHaveLength(1);
    const first = simulateMove(level, initial, far.id);
    expect(first.kind).toBe("exit");
    const cleared = applyMove(level, initial, first);
    const jump = simulateMove(level, cleared, portal.id);
    expect(jump.kind).toBe("exit");
    expect(jump.portals).toHaveLength(1);
    expect(solveLevelTargets({ ...level, wormholes: [] })).toBeUndefined();
    expect(hasStrandingState(level)).toBe(false);
    let state = initial;
    for (const target of core.certificate) {
      const move = simulateMove(level, state, target.arrowId, target.endpoint);
      expect(move.kind).toBe("exit");
      state = applyMove(level, state, move);
    }
    expect(state.status).toBe("won");
    expect(state.lives).toBe(level.lives);
    whole.add(mechanicStructure(level));
    heads.add(
      mechanicStructure({
        ...level,
        arrows: level.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
      }),
    );
    graphs.add(blockingStructure(level, initial));
    sizes.add(level.arrows.length);
    if (
      new Set(level.arrows.flatMap((a) => a.path.map((c) => c.face))).size >= 3
    )
      threeFaces++;
  }
  console.log({
    whole: whole.size,
    heads: heads.size,
    blockingGraphs: graphs.size,
    sizes: [...sizes],
    threeFaces,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(heads.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
  expect(sizes.size).toBeGreaterThan(1);
  expect(threeFaces).toBeGreaterThanOrEqual(8);
});
test("wormhole construction is deterministic and has bounded omission without a stamp fallback", () => {
  const construct = () => constructWormhole(base, new Rng(0xabcdef), new Set());
  expect(construct()).toEqual(construct());
  expect(constructWormhole(base, new Rng(1), new Set(), "", 0)).toBeUndefined();
  const occupied = new Set<string>();
  for (const face of [
    "front",
    "back",
    "left",
    "right",
    "top",
    "bottom",
  ] as const)
    for (let x = 0; x < base.gridSize; x++)
      for (let y = 0; y < base.gridSize; y++)
        occupied.add(cellKey({ face, x, y }));
  expect(constructWormhole(base, new Rng(1), occupied, "", 1)).toBeUndefined();
});

// Larger portal circuits exposed a false static dependency cycle inside the
// co-generated phased region: 57 retries took 15 seconds and omitted its flip.
test("grown wormholes retain a proved phased region without false-cycle retries", () => {
  const started = performance.now();
  const level = generateLevel(5_510_804_256_712_186);
  expect(performance.now() - started).toBeLessThan(8000);
  expect(level.wormholes).toHaveLength(2);
  expect(level.directionals?.some((spot) => spot.kind === "flip")).toBe(true);
  expect(validateLevel(level).errors).toEqual([]);
  const targets = solveLevelTargets(level);
  expect(targets).toBeDefined();
  let state = createGameState(level);
  for (const target of targets ?? []) {
    const move = simulateMove(level, state, target.arrowId, target.endpoint);
    expect(["exit", "paused"]).toContain(move.kind);
    state = applyMove(level, state, move);
  }
  expect(state.status).toBe("won");
  expect(state.lives).toBe(level.lives);
}, 60_000);
