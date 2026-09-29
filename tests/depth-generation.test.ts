import { expect, test } from "bun:test";
import { cachedLevel } from "./generated-levels";
import { closureStats, meetsDepthGate } from "../src/content/difficulty";
import { generateLevel, isAuthoredLevel } from "../src/content/procedural";
import { arrowTrack } from "../src/core/stops";
import { cellKey } from "../src/core/topology";
import { layoutFingerprint } from "../src/storage";

test("every generated id 2-200 meets its depth gate and density floor", () => {
  const misses: number[] = [];
  for (let id = 2; id <= 200; id += 1) {
    if (isAuthoredLevel(id)) continue;
    const level = cachedLevel(id);
    const board = level.wormholes ? { ...level, wormholes: [] } : level;
    if (!meetsDepthGate(id, closureStats(board))) misses.push(id);
    const covered = new Set(
      level.arrows.flatMap((arrow) => arrow.path.map(cellKey)),
    ).size;
    if (level.gridSize >= 13) {
      expect(covered / (6 * level.gridSize ** 2)).toBeGreaterThanOrEqual(0.78);
    }
    for (const arrow of level.arrows) {
      if (!/^r\d+-\d+$/.test(arrow.id)) continue;
      expect(arrowTrack(level, arrow).length).toBeGreaterThan(
        arrow.path.length,
      );
    }
  }
  expect(misses).toEqual([]);
}, 900_000);

test("no fill route enters a wormhole end", () => {
  for (let id = 36; id <= 200; id += 1) {
    const level = cachedLevel(id);
    const ends = new Set(
      (level.wormholes ?? []).flatMap((hole) => [
        cellKey(hole.a),
        cellKey(hole.b),
      ]),
    );
    if (ends.size === 0) continue;
    for (const arrow of level.arrows) {
      if (arrow.id.includes("-wormhole-")) continue;
      const route = arrowTrack({ ...level, wormholes: [] }, arrow).slice(
        arrow.path.length,
      );
      for (const cell of route) expect(ends.has(cellKey(cell))).toBe(false);
    }
  }
}, 600_000);

test("generation stays under one second per level", () => {
  for (const id of [12, 44, 60, 100, 150, 200]) {
    const started = performance.now();
    generateLevel(id);
    expect(performance.now() - started).toBeLessThan(1000);
  }
}, 60_000);

test("generation is deterministic", () => {
  expect(layoutFingerprint(generateLevel(41))).toBe(
    layoutFingerprint(generateLevel(41)),
  );
  expect(layoutFingerprint(generateLevel(120))).toBe(
    layoutFingerprint(generateLevel(120)),
  );
});
