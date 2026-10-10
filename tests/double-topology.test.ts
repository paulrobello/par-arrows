import { expect, test } from "bun:test";
import { constructDouble } from "../src/content/double";
import { isAuthoredLevel, Rng } from "../src/content/procedural";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type { LevelDefinition } from "../src/core/types";
import {
  hasStrandingState,
  solveLevelTargets,
  validateLevel,
} from "../src/core/validation";
import { blockingStructure, mechanicStructure } from "./mechanic-structure";
import { cachedLevel } from "./generated-levels";

const base: LevelDefinition = {
  id: 90,
  title: "grown endpoint circuit",
  gridSize: 16,
  lives: 3,
  arrows: [],
};

test("double topology varies contacts and cycles while requiring the tail endpoint", () => {
  const whole = new Set<string>();
  const heads = new Set<string>();
  const graphs = new Set<string>();
  const sizes = new Set<number>();
  const lengths = new Set<number>();
  let multiFace = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const core = constructDouble(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(core, `seed ${seed}`).toBeDefined();
    if (!core) continue;
    const level = { ...base, arrows: core.arrows };
    expect(validateLevel(level).errors).toEqual([]);
    const double = level.arrows.find((a) => a.kind === "double")!;
    expect(double.path.length).toBeGreaterThanOrEqual(5);
    expect(double.path.length).toBeLessThanOrEqual(10);
    const initial = createGameState(level);
    expect(simulateMove(level, initial, double.id).kind).toBe("blocked");
    expect(simulateMove(level, initial, double.id, "tail").kind).toBe("exit");
    expect(
      level.arrows
        .filter((a) => a.id !== double.id)
        .every((a) => simulateMove(level, initial, a.id).kind === "blocked"),
    ).toBe(true);
    const single = {
      ...level,
      arrows: level.arrows.map((a) => ({ id: a.id, path: a.path })),
    };
    expect(solveLevelTargets(single)).toBeUndefined();
    expect(hasStrandingState(level)).toBe(false);
    expect(core.certificate[0]).toEqual({
      arrowId: double.id,
      endpoint: "tail",
    });
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
    graphs.add(blockingStructure(single, createGameState(single)));
    sizes.add(level.arrows.length);
    lengths.add(double.path.length);
    if (
      new Set(level.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1
    )
      multiFace++;
  }
  console.log({
    whole: whole.size,
    heads: heads.size,
    blockingGraphs: graphs.size,
    sizes: [...sizes],
    lengths: [...lengths],
    multiFace,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(heads.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
  expect(sizes.size).toBeGreaterThan(1);
  expect(lengths.size).toBeGreaterThanOrEqual(5);
  expect(multiFace).toBeGreaterThanOrEqual(8);
});

test("double construction is deterministic and bounded without adjacent-blocker fallback", () => {
  const construct = () => constructDouble(base, new Rng(0xabcdef), new Set());
  expect(construct()).toEqual(construct());
  expect(constructDouble(base, new Rng(1), new Set(), 0)).toBeUndefined();
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
  expect(constructDouble(base, new Rng(1), occupied, 1)).toBeUndefined();
});

test("shipped double circuits vary structurally and keep endpoint dependence after assembly", () => {
  const whole = new Set<string>();
  const heads = new Set<string>();
  const graphs = new Set<string>();
  let found = 0;
  for (let id = 26; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const arrows = level.arrows.filter((a) => a.id.includes("-double-"));
    const double = arrows.find((a) => a.kind === "double");
    if (!double) continue;
    found++;
    // Later terrain and optional spots must preserve the core's required
    // endpoint, rather than turn its grown dependency cycle into decoration.
    const core = { ...level, arrows };
    const single = {
      ...core,
      arrows: arrows.map((a) => ({ id: a.id, path: a.path })),
    };
    expect(solveLevelTargets(core), `double core ${id}`).toBeDefined();
    expect(
      solveLevelTargets(single),
      `single counterfactual ${id}`,
    ).toBeUndefined();
    const certificate = solveLevelTargets(level);
    expect(certificate).toBeDefined();
    let state = createGameState(level);
    for (const target of certificate ?? []) {
      if (target.arrowId === double.id) {
        expect(target.endpoint, `level ${id}`).toBe("tail");
        expect(simulateMove(level, state, double.id).kind, `head ${id}`).toBe(
          "blocked",
        );
        expect(
          simulateMove(level, state, double.id, "tail").kind,
          `tail ${id}`,
        ).toBe("exit");
        break;
      }
      state = applyMove(
        level,
        state,
        simulateMove(level, state, target.arrowId, target.endpoint),
      );
    }
    // Canonicalize only this mechanic, keeping its actual wrap topology.
    const geometry = { ...base, gridSize: level.gridSize, arrows };
    whole.add(mechanicStructure(geometry));
    heads.add(
      mechanicStructure({
        ...geometry,
        arrows: arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
      }),
    );
    graphs.add(blockingStructure(single, createGameState(single)));
  }
  console.log({
    shipped: found,
    whole: whole.size,
    heads: heads.size,
    graphs: graphs.size,
  });
  expect(found).toBeGreaterThan(40);
  expect(whole.size / found).toBeGreaterThanOrEqual(0.95);
  expect(heads.size / found).toBeGreaterThanOrEqual(0.95);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
}, 600_000);
