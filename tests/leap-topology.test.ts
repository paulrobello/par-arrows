import { expect, test } from "bun:test";
import { constructLeap } from "../src/content/leap";
import { Rng, isAuthoredLevel } from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import { cellKey } from "../src/core/topology";
import {
  solveLevelTargets,
  validateLevel,
  hasStrandingState,
  hasSoftLockState,
} from "../src/core/validation";
import type { LevelDefinition } from "../src/core/types";
import { mechanicStructure, blockingStructure } from "./mechanic-structure";
import { cachedLevel } from "./generated-levels";
const base: LevelDefinition = {
  id: 80,
  title: "grown skipped contacts",
  gridSize: 14,
  lives: 3,
  arrows: [],
};
function prove(level: LevelDefinition) {
  expect(validateLevel(level).errors).toEqual([]);
  const plain = { ...level, leaps: [] },
    initial = createGameState(level),
    p = level.arrows.find((a) => a.id.endsWith("-leaper"))!;
  for (const a of level.arrows) {
    expect(a.path.length).toBeGreaterThanOrEqual(3);
    expect(simulateMove(plain, createGameState(plain), a.id).kind).toBe(
      "blocked",
    );
  }
  const before = simulateMove(plain, createGameState(plain), p.id),
    jump = simulateMove(level, initial, p.id);
  expect(jump.kind).toBe("exit");
  expect(jump.leaps).toHaveLength(1);
  const leap = jump.leaps![0]!;
  expect(cellKey(leap.over)).toBe(cellKey(before.contact!.cell));
  const blocker = level.arrows.find((a) => a.id === before.blockerId)!;
  expect(blocker.path.some((c) => cellKey(c) === cellKey(leap.over))).toBe(
    true,
  );
  expect(
    level.arrows
      .filter((a) => a.id !== p.id)
      .some((a) => a.path.some((c) => cellKey(c) === cellKey(leap.to))),
  ).toBe(false);
  expect(solveLevelTargets(plain)).toBeUndefined();
  expect(hasStrandingState(level)).toBe(false);
  expect(hasSoftLockState(level)).toBe(false);
  const certificate = solveLevelTargets(level);
  expect(certificate).toBeDefined();
  let state = initial;
  for (const t of certificate!) {
    const m = simulateMove(level, state, t.arrowId, t.endpoint);
    expect(m.kind).toBe("exit");
    state = applyMove(level, state, m);
  }
  expect(state.status).toBe("won");
  expect(state.lives).toBe(level.lives);
  return blocker.path.findIndex((c) => cellKey(c) === cellKey(leap.over));
}
function heads(l: LevelDefinition) {
  return {
    ...l,
    arrows: l.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
  };
}
test("leap grows real skipped-body contacts with varied topology", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set(),
    sizes = new Set(),
    contacts = new Set();
  let multiFace = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const c = constructLeap(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(c, "seed " + seed).toBeDefined();
    if (!c) continue;
    const l = { ...base, arrows: c.arrows, leaps: [c.pad] };
    contacts.add(prove(l));
    whole.add(mechanicStructure(l));
    headLayouts.add(mechanicStructure(heads(l)));
    graphs.add(blockingStructure({ ...l, leaps: [] }, createGameState(l)));
    sizes.add(l.arrows.length);
    if (new Set(l.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1)
      multiFace++;
  }
  console.log({
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
    sizes: [...sizes],
    contacts: [...contacts],
    multiFace,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(headLayouts.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
  expect(sizes.size).toBeGreaterThan(1);
  expect(contacts.size).toBeGreaterThan(1);
  expect(multiFace).toBeGreaterThan(8);
}, 20000);
test("leap exhaustion and glyph reservations never supply a stamped fallback", () => {
  const run = () => constructLeap(base, new Rng(0x123456), new Set());
  expect(run()).toEqual(run());
  expect(constructLeap(base, new Rng(1), new Set(), 0)).toBeUndefined();
  const occupied = new Set<string>();
  for (const face of ["front", "back", "left", "right", "top", "bottom"])
    for (let x = 0; x < 14; x++)
      for (let y = 0; y < 14; y++) occupied.add(face + ":" + x + ":" + y);
  expect(constructLeap(base, new Rng(1), occupied, 1)).toBeUndefined();
  expect(
    constructLeap(base, new Rng(1), new Set(), 1, occupied),
  ).toBeUndefined();
});
test("shipping leaps retain occupied skips and structural variation", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set();
  let placed = 0;
  for (let id = 61; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id),
      arrows = level.arrows.filter((a) => a.id.includes("-leap-"));
    if (!arrows.length) continue;
    placed++;
    const l: LevelDefinition = {
      id,
      title: "shipping skipped contacts",
      gridSize: level.gridSize,
      lives: level.lives,
      arrows,
      leaps: level.leaps!,
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
    };
    prove(l);
    whole.add(mechanicStructure(l));
    headLayouts.add(mechanicStructure(heads(l)));
    graphs.add(blockingStructure({ ...l, leaps: [] }, createGameState(l)));
  }
  console.log({
    placed,
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
  });
  expect(placed).toBeGreaterThanOrEqual(64);
  expect(whole.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(headLayouts.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
}, 600000);
