import { expect, test } from "bun:test";
import { constructDirectional } from "../src/content/directional";
import { Rng, isAuthoredLevel } from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import { cellKey, headingForPath, oppositeHeading } from "../src/core/topology";
import { arrowTrack } from "../src/core/stops";
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
  title: "grown required reversal",
  gridSize: 14,
  lives: 3,
  arrows: [],
};
function rootSpot(level: LevelDefinition) {
  const p = level.arrows.find((a) => a.id.endsWith("-dir-a"))!,
    track = arrowTrack({ ...level, directionals: [] }, p),
    at = track.findIndex(
      (c, i) =>
        i >= p.path.length &&
        level.directionals?.some((s) => cellKey(s.cell) === cellKey(c)),
    );
  expect(at).toBeGreaterThanOrEqual(p.path.length);
  const spot = level.directionals!.find(
    (s) => cellKey(s.cell) === cellKey(track[at]!),
  )!;
  expect(spot.heading).toBe(
    oppositeHeading(
      headingForPath(track.slice(at - 1, at + 1), level.gridSize)!,
    ),
  );
  return spot;
}
function prove(level: LevelDefinition) {
  expect(validateLevel(level).errors).toEqual([]);
  rootSpot(level);
  const ground = { ...level, directionals: [] },
    initial = createGameState(level),
    p = level.arrows.find((a) => a.id.endsWith("-dir-a"))!;
  for (const a of level.arrows) {
    expect(a.path.length).toBeGreaterThanOrEqual(3);
    expect(simulateMove(ground, createGameState(ground), a.id).kind).toBe(
      "blocked",
    );
  }
  const move = simulateMove(level, initial, p.id);
  expect(move.kind).toBe("exit");
  expect(
    move.route!.some((c, i, r) => i > 1 && cellKey(c) === cellKey(r[i - 2]!)),
  ).toBe(true);
  expect(solveLevelTargets(ground)).toBeUndefined();
  expect(hasStrandingState(level)).toBe(false);
  expect(hasSoftLockState(level)).toBe(false);
  const cert = solveLevelTargets(level);
  expect(cert).toBeDefined();
  let state = initial;
  for (const t of cert!) {
    const m = simulateMove(level, state, t.arrowId, t.endpoint);
    expect(m.kind).toBe("exit");
    state = applyMove(level, state, m);
  }
  expect(state.status).toBe("won");
  expect(state.lives).toBe(level.lives);
  const queue = [initial],
    seen = new Set<string>();
  while (queue.length) {
    const s = queue.pop()!,
      key = s.remainingIds.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    for (const id of s.remainingIds) {
      const a = level.arrows.find((a) => a.id === id)!,
        m = simulateMove(ground, s, id);
      if (m.blockerId && m.contact) {
        const b = level.arrows.find((b) => b.id === m.blockerId)!,
          n = simulateMove(ground, s, b.id);
        expect(
          Boolean(
            n.blockerId === id &&
              n.contact &&
              cellKey(m.contact.cell) === cellKey(b.path.at(-1)!) &&
              cellKey(n.contact.cell) === cellKey(a.path.at(-1)!),
          ),
          "head stamp after a safe prefix",
        ).toBe(false);
      }
      const actual = simulateMove(level, s, id);
      if (actual.kind === "exit") queue.push(applyMove(level, s, actual));
    }
  }
}
function heads(l: LevelDefinition) {
  return {
    ...l,
    arrows: l.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
  };
}
test("directional growth varies real body cycles and required head-on reversals", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set(),
    sizes = new Set(),
    lengths = new Set();
  let multiFace = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const c = constructDirectional(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(c, "seed " + seed).toBeDefined();
    if (!c) continue;
    prove(c);
    whole.add(mechanicStructure(c));
    headLayouts.add(mechanicStructure(heads(c)));
    graphs.add(
      blockingStructure({ ...c, directionals: [] }, createGameState(c)),
    );
    sizes.add(c.arrows.length);
    for (const a of c.arrows) lengths.add(a.path.length);
    if (new Set(c.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1)
      multiFace++;
  }
  console.log({
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
    sizes: [...sizes],
    lengths: [...lengths],
    multiFace,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(headLayouts.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
  expect(sizes.size).toBeGreaterThan(1);
  expect(lengths.size).toBeGreaterThan(4);
  expect(multiFace).toBeGreaterThan(8);
}, 20000);
test("directional exhaustion never restores opposed flankers", () => {
  const run = () => constructDirectional(base, new Rng(0x123456), new Set());
  expect(run()).toEqual(run());
  expect(
    constructDirectional(base, new Rng(1), new Set(), undefined, 0),
  ).toBeUndefined();
  const occupied = new Set<string>();
  for (const face of ["front", "back", "left", "right", "top", "bottom"])
    for (let x = 0; x < 14; x++)
      for (let y = 0; y < 14; y++) occupied.add(face + ":" + x + ":" + y);
  expect(
    constructDirectional(base, new Rng(1), occupied, undefined, 1),
  ).toBeUndefined();
  expect(
    constructDirectional(base, new Rng(1), new Set(), undefined, 1, occupied),
  ).toBeUndefined();
});
test("shipping directionals retain native variation without head-pair stamps", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set();
  let placed = 0;
  for (let id = 21; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id),
      arrows = level.arrows.filter((a) => a.id.includes("-dir-"));
    if (!arrows.length) continue;
    placed++;
    let l: LevelDefinition = {
      id,
      title: "shipping reversal",
      gridSize: level.gridSize,
      lives: level.lives,
      arrows,
      directionals: level.directionals!.filter(
        (s) => s.kind !== "flip" && s.kind !== "rotor",
      ),
      ...(level.edgePolicies ? { edgePolicies: level.edgePolicies } : {}),
    };
    l = { ...l, directionals: [rootSpot(l)] };
    prove(l);
    whole.add(mechanicStructure(l));
    headLayouts.add(mechanicStructure(heads(l)));
    graphs.add(
      blockingStructure({ ...l, directionals: [] }, createGameState(l)),
    );
  }
  console.log({
    placed,
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
  });
  expect(placed).toBeGreaterThan(100);
  expect(whole.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(headLayouts.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
}, 600000);
