import { expect, test } from "bun:test";
import { constructMirror } from "../src/content/mirror";
import { Rng, isAuthoredLevel } from "../src/content/procedural";
import {
  createGameState,
  simulateMove,
  applyMove,
} from "../src/core/game-state";
import { cellKey, headingForPath, oppositeHeading } from "../src/core/topology";
import { arrowTrack } from "../src/core/stops";
import {
  validateLevel,
  solveLevelTargets,
  hasStrandingState,
  hasSoftLockState,
} from "../src/core/validation";
import type { LevelDefinition } from "../src/core/types";
import { mechanicStructure, blockingStructure } from "./mechanic-structure";
import { cachedLevel } from "./generated-levels";
const base: LevelDefinition = {
  id: 80,
  title: "grown reflected contacts",
  gridSize: 14,
  lives: 3,
  arrows: [],
};
function entries(level: LevelDefinition) {
  const glyph = cellKey(level.mirrors![0]!.cell);
  return ["-north", "-south"].map((suffix) => {
    const arrow = level.arrows.find((a) => a.id.endsWith(suffix))!,
      track = arrowTrack({ ...level, mirrors: [] }, arrow),
      at = track.findIndex((c) => cellKey(c) === glyph);
    expect(at).toBeGreaterThanOrEqual(arrow.path.length);
    return headingForPath(track.slice(at - 1, at + 1), level.gridSize)!;
  });
}
function prove(level: LevelDefinition) {
  expect(validateLevel(level).errors).toEqual([]);
  for (const a of level.arrows)
    expect(a.path.length, a.id).toBeGreaterThanOrEqual(3);
  const [north, south] = entries(level);
  expect(north).not.toBe(south);
  const stripped = { ...level, mirrors: [] };
  expect(solveLevelTargets(stripped)).toBeUndefined();
  const certificate = solveLevelTargets(level);
  expect(certificate).toBeDefined();
  let state = createGameState(level);
  for (const t of certificate!) {
    const move = simulateMove(level, state, t.arrowId, t.endpoint);
    expect(move.kind).toBe("exit");
    state = applyMove(level, state, move);
  }
  expect(state.status).toBe("won");
  expect(state.lives).toBe(level.lives);
  expect(hasStrandingState(level)).toBe(false);
  expect(hasSoftLockState(level)).toBe(false);
  // Independently enumerate actual safe choices. Primary reflection must
  // release an exit; the secondary must gain or lose a clear move.
  let primaryRequired = false,
    secondaryChanged = false;
  const seen = new Set<string>(),
    queue = [createGameState(level)];
  const primary = level.arrows.find((a) => a.id.endsWith("-north"))!,
    secondary = level.arrows.find((a) => a.id.endsWith("-south"))!;
  const groundState = createGameState(stripped);
  for (const arrow of level.arrows) {
    const move = simulateMove(stripped, groundState, arrow.id);
    if (move.kind !== "blocked" || !move.blockerId) continue;
    const blocker = level.arrows.find((a) => a.id === move.blockerId)!;
    const back = simulateMove(stripped, groundState, blocker.id);
    expect(
      Boolean(
        back.blockerId === arrow.id &&
          move.contact &&
          back.contact &&
          cellKey(move.contact.cell) === cellKey(blocker.path.at(-1)!) &&
          cellKey(back.contact.cell) === cellKey(arrow.path.at(-1)!),
      ),
      "reciprocal head stamp",
    ).toBe(false);
  }
  while (queue.length) {
    const current = queue.pop()!,
      key = current.remainingIds.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (
      current.remainingIds.includes(primary.id) &&
      current.remainingIds.includes(secondary.id)
    ) {
      const a = simulateMove(stripped, current, primary.id),
        b = simulateMove(stripped, current, secondary.id);
      expect(
        Boolean(
          a.blockerId === secondary.id &&
            b.blockerId === primary.id &&
            a.contact &&
            b.contact &&
            cellKey(a.contact.cell) === cellKey(secondary.path.at(-1)!) &&
            cellKey(b.contact.cell) === cellKey(primary.path.at(-1)!),
        ),
        "head stamp after a safe prefix",
      ).toBe(false);
    }
    if (
      current.remainingIds.includes(primary.id) &&
      simulateMove(level, current, primary.id).kind === "exit" &&
      simulateMove(stripped, current, primary.id).kind === "blocked"
    )
      primaryRequired = true;
    if (current.remainingIds.includes(secondary.id)) {
      const actual = simulateMove(level, current, secondary.id).kind,
        plain = simulateMove(stripped, current, secondary.id).kind;
      if (
        (actual === "exit" && plain === "blocked") ||
        (actual === "blocked" && plain === "exit")
      )
        secondaryChanged = true;
    }
    for (const id of current.remainingIds) {
      const move = simulateMove(level, current, id);
      if (move.kind === "exit") queue.push(applyMove(level, current, move));
    }
  }
  expect(primaryRequired).toBe(true);
  expect(secondaryChanged).toBe(true);
}
function heads(level: LevelDefinition): LevelDefinition {
  return {
    ...level,
    arrows: level.arrows.map((a) => ({ ...a, path: a.path.slice(-2) })),
  };
}
test("mirrors grow routed two-destination contacts with real graph variation", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set(),
    sizes = new Set(),
    lengths = new Set();
  let angled = 0,
    multiFace = 0;
  for (let seed = 1; seed <= 64; seed++) {
    const c = constructMirror(
      base,
      new Rng(Math.imul(seed, 0x9e3779b9) >>> 0),
      new Set(),
    );
    expect(c, String(seed)).toBeDefined();
    if (!c) continue;
    const level = { ...base, arrows: c.arrows, mirrors: [c.mirror] };
    prove(level);
    whole.add(mechanicStructure(level));
    headLayouts.add(mechanicStructure(heads(level)));
    graphs.add(
      blockingStructure({ ...level, mirrors: [] }, createGameState(level)),
    );
    sizes.add(c.arrows.length);
    for (const a of c.arrows) lengths.add(a.path.length);
    const [a, b] = entries(level);
    if (oppositeHeading(a!) !== b) angled++;
    if (new Set(c.arrows.flatMap((a) => a.path.map((c) => c.face))).size > 1)
      multiFace++;
  }
  console.log({
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
    sizes: [...sizes],
    lengths: [...lengths],
    angled,
    multiFace,
  });
  expect(whole.size).toBeGreaterThanOrEqual(61);
  expect(headLayouts.size).toBeGreaterThanOrEqual(61);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
  expect([...sizes].sort()).toEqual([4, 5, 6]);
  expect(multiFace).toBeGreaterThan(16);
}, 20000);
test("mirror growth is deterministic and exhaustion supplies no face-off stamp", () => {
  const run = () => constructMirror(base, new Rng(0x123456), new Set());
  expect(run()).toEqual(run());
  expect(constructMirror(base, new Rng(1), new Set(), 0)).toBeUndefined();
  const occupied = new Set<string>();
  for (const face of ["front", "back", "left", "right", "top", "bottom"])
    for (let x = 0; x < base.gridSize; x++)
      for (let y = 0; y < base.gridSize; y++)
        occupied.add(face + ":" + x + ":" + y);
  expect(constructMirror(base, new Rng(1), occupied, 1)).toBeUndefined();
  expect(
    constructMirror(base, new Rng(1), new Set(), 1, occupied),
  ).toBeUndefined();
});
test("shipping mirrors vary real approaches and prove reflected ordering", () => {
  const whole = new Set(),
    headLayouts = new Set(),
    graphs = new Set();
  let placed = 0,
    angled = 0;
  for (let id = 56; id <= 200; id++) {
    if (isAuthoredLevel(id)) continue;
    const l = cachedLevel(id),
      arrows = l.arrows.filter((a) => a.id.includes("-mirror-"));
    if (!arrows.length) continue;
    placed++;
    const core: LevelDefinition = {
      id,
      title: "shipping reflected contacts",
      gridSize: l.gridSize,
      lives: l.lives,
      arrows,
      mirrors: l.mirrors!,
      ...(l.edgePolicies ? { edgePolicies: l.edgePolicies } : {}),
    };
    prove(core);
    whole.add(mechanicStructure(core));
    headLayouts.add(mechanicStructure(heads(core)));
    graphs.add(
      blockingStructure({ ...core, mirrors: [] }, createGameState(core)),
    );
    const [a, b] = entries(core);
    if (oppositeHeading(a!) !== b) angled++;
  }
  console.log({
    placed,
    whole: whole.size,
    heads: headLayouts.size,
    graphs: graphs.size,
    angled,
  });
  expect(placed).toBeGreaterThanOrEqual(57);
  expect(whole.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(headLayouts.size / placed).toBeGreaterThanOrEqual(0.95);
  expect(graphs.size).toBeGreaterThanOrEqual(6);
}, 600000);
