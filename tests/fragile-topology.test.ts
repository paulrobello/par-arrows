import { expect, test } from "bun:test";
import { constructFragile } from "../src/content/fragile";
import { Rng, isAuthoredLevel } from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import type { LevelDefinition } from "../src/core/types";
import {
  validateLevel,
  hasSoftLockState,
  solveLevelTargets,
} from "../src/core/validation";
import {
  mechanicStructure,
  endpointBlockingStructure,
} from "./mechanic-structure";
import { cachedLevel } from "./generated-levels";

const base: LevelDefinition = {
  id: 80,
  title: "grown crack ordering",
  gridSize: 14,
  lives: 3,
  arrows: [],
};

function headGeometry(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    arrows: level.arrows.map((a) => ({
      ...a,
      path:
        a.kind === "double"
          ? [...a.path.slice(0, 2), ...a.path.slice(-2)]
          : a.path.slice(-2),
    })),
  };
}

function proveOrdering(level: LevelDefinition): void {
  expect(validateLevel(level).errors).toEqual([]);
  const double = level.arrows.find((a) => a.kind === "double")!;
  const crosser = level.arrows.find((a) => a.id.endsWith("-crosser"))!;
  for (const arrow of level.arrows)
    expect(arrow.path.length, arrow.id).toBeGreaterThanOrEqual(
      arrow.kind === "double" ? 5 : 3,
    );
  const state = createGameState(level);
  expect(simulateMove(level, state, crosser.id).kind).toBe("exit");
  expect(simulateMove(level, state, double.id, "tail").kind).toBe("blocked");
  const wrong = simulateMove(level, state, double.id, "head");
  expect(wrong.kind).toBe("exit");
  expect(wrong.collapses?.map((event) => cellKey(event.cell))).toEqual([
    cellKey(level.fragile![0]!),
  ]);
  const afterHead = applyMove(level, state, wrong);
  const fall = simulateMove(level, afterHead, crosser.id);
  expect(fall.kind).toBe("fall");
  expect(applyMove(level, afterHead, fall).lives).toBe(level.lives - 1);
  const ground = { ...level, fragile: [] };
  const plain = createGameState(ground);
  const plainHead = simulateMove(ground, plain, double.id, "head");
  expect(plainHead.kind).toBe("exit");
  expect(
    simulateMove(ground, applyMove(ground, plain, plainHead), crosser.id).kind,
  ).toBe("exit");
  const certificate = solveLevelTargets(level);
  expect(certificate).toBeDefined();
  expect(certificate?.find((t) => t.arrowId === double.id)?.endpoint).toBe(
    "tail",
  );
  let current = state;
  for (const target of certificate ?? []) {
    const move = simulateMove(level, current, target.arrowId, target.endpoint);
    expect(move.kind).toBe("exit");
    current = applyMove(level, current, move);
  }
  expect(current.status).toBe("won");
  expect(current.lives).toBe(level.lives);
  expect(current.collapsed).toEqual([cellKey(level.fragile![0]!)]);
  expect(hasSoftLockState(level)).toBe(false);
}

test("fragile topology grows independent crack approaches and real endpoint dependencies", () => {
  const whole = new Set<string>(),
    heads = new Set<string>(),
    graphs = new Set<string>(),
    sizes = new Set<number>(),
    lengths = new Set<number>();
  let multiFace = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const core = constructFragile(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(core, String(seed)).toBeDefined();
    if (!core) continue;
    const board = { ...base, arrows: core.arrows, fragile: [core.cell] };
    proveOrdering(board);
    whole.add(mechanicStructure(board));
    heads.add(mechanicStructure(headGeometry(board)));
    graphs.add(endpointBlockingStructure(board, createGameState(board)));
    sizes.add(board.arrows.length);
    lengths.add(board.arrows.find((a) => a.kind === "double")!.path.length);
    if (
      new Set(board.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1
    )
      multiFace++;
  }
  console.log({
    whole: whole.size,
    heads: heads.size,
    graphs: graphs.size,
    sizes: [...sizes],
    lengths: [...lengths],
    multiFace,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(heads.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(4);
  expect([...sizes].sort()).toEqual([2, 3, 4]);
  expect([...lengths].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
  expect(multiFace).toBeGreaterThanOrEqual(16);
});

test("fragile construction is deterministic and bounded without an intro stamp", () => {
  const construct = () => constructFragile(base, new Rng(0x123456), new Set());
  expect(construct()).toEqual(construct());
  expect(constructFragile(base, new Rng(1), new Set(), 0)).toBeUndefined();
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
  expect(constructFragile(base, new Rng(1), occupied, 1)).toBeUndefined();
});

test("shipped fragile cores preserve the crack ordering and vary beyond their glyph orientation", () => {
  const whole = new Set<string>(),
    heads = new Set<string>(),
    graphs = new Set<string>();
  let placed = 0;
  for (let id = 46; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id),
      arrows = level.arrows.filter((a) => a.id.includes("-fragile-"));
    if (!arrows.length) continue;
    placed++;
    const core: LevelDefinition = {
      id,
      title: "shipping crack",
      gridSize: level.gridSize,
      lives: level.lives,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
      arrows,
      fragile: level.fragile!,
    };
    proveOrdering(core);
    whole.add(mechanicStructure(core));
    heads.add(mechanicStructure(headGeometry(core)));
    graphs.add(endpointBlockingStructure(core, createGameState(core)));
  }
  console.log({
    placed,
    whole: whole.size,
    heads: heads.size,
    graphs: graphs.size,
  });
  expect(placed).toBeGreaterThan(65);
  expect(whole.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(heads.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(graphs.size).toBeGreaterThanOrEqual(4);
}, 600_000);
