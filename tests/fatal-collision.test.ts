import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { LEVEL_ONE, WRAP_INTRO_LEVEL } from "../src/content/intro";
import { OVERLAP_INTRO_LEVEL } from "../src/content/overlap-intro";
import { DOUBLE_INTRO_LEVEL } from "../src/content/double-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { settledPathOf } from "../src/core/stops";
import type { Cell, LevelDefinition } from "../src/core/types";
import {
  fatalCollisionForUndo,
  undoState,
  type UndoSnapshot,
} from "../src/core/undo";
import {
  arrowAnimationProgress,
  arrowMotionDuration,
  arrowMotionTrack,
  expandedPoints,
  slicePath,
} from "../src/render/renderer";

const c = (x: number, y: number, face: Cell["face"] = "front"): Cell => ({
  face,
  x,
  y,
});
const player = { id: "p", path: [c(0, 2), c(1, 2)] };
const straight: LevelDefinition = {
  id: 99,
  title: "Fatal route",
  gridSize: 6,
  lives: 1,
  arrows: [player, { id: "g", path: [c(5, 2), c(5, 1)] }],
};
const variants: [string, LevelDefinition, string][] = [
  ["straight", straight, "p"],
  [
    "double-tail",
    {
      ...straight,
      arrows: [
        { id: "p", kind: "double", path: [c(3, 2), c(4, 2)] },
        { id: "g", path: [c(0, 2), c(0, 1)] },
      ],
    },
    "p",
  ],
  [
    "wrap",
    {
      ...straight,
      arrows: [
        { id: "p", path: [c(4, 2), c(5, 2)] },
        { id: "g", path: [c(2, 2, "right"), c(2, 1, "right")] },
      ],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
    },
    "p",
  ],
  [
    "flip",
    {
      ...straight,
      directionals: [{ cell: c(2, 2), heading: "east", kind: "flip" }],
    },
    "p",
  ],
  [
    "rotor",
    {
      ...straight,
      directionals: [{ cell: c(2, 2), heading: "east", kind: "rotor" }],
    },
    "p",
  ],
  ["fragile", { ...straight, fragile: [c(2, 2)] }, "p"],
  [
    "key",
    { ...straight, locks: [{ id: "k", key: c(2, 2), lock: c(4, 4) }] },
    "p",
  ],
  ["leap", { ...straight, leaps: [c(2, 2)] }, "p"],
  [
    "leap-landing",
    {
      ...straight,
      arrows: [player, { id: "g", path: [c(4, 2), c(4, 1)] }],
      leaps: [c(2, 2)],
    },
    "p",
  ],
  [
    "mirror",
    {
      ...straight,
      arrows: [player, { id: "g", path: [c(2, 0), c(3, 0)] }],
      mirrors: [{ cell: c(2, 2), orientation: "/" }],
    },
    "p",
  ],
  [
    "portal",
    {
      ...straight,
      arrows: [player, { id: "g", path: [c(4, 2, "right"), c(4, 1, "right")] }],
      wormholes: [{ id: "w", a: c(2, 2), b: c(2, 2, "right") }],
    },
    "p",
  ],
  [
    "portal-exit-contact",
    {
      ...straight,
      arrows: [player, { id: "g", path: [c(2, 2, "right"), c(2, 1, "right")] }],
      wormholes: [{ id: "w", a: c(2, 2), b: c(2, 2, "right") }],
    },
    "p",
  ],
  ["linked", { ...OVERLAP_INTRO_LEVEL, lives: 1 }, "overlap-intro-pair-a"],
  ["double", { ...DOUBLE_INTRO_LEVEL, lives: 1 }, "double-intro-choice"],
];

for (const [name, level, preferred] of variants) {
  test(`fatal ${name} keeps an exact trace whose return restores the complete pre-move body`, () => {
    const before = createGameState(level);
    const arrow = level.arrows.find((a) => a.id === preferred);
    assert.ok(arrow);
    if (name.startsWith("double")) expect(arrow.kind).toBe("double");
    const target = {
      arrowId: arrow.id,
      endpoint: name === "double-tail" ? ("tail" as const) : ("head" as const),
    };
    const result = simulateMove(level, before, target.arrowId, target.endpoint);
    expect(result.kind).toBe("blocked");
    const after = applyMove(level, before, result);
    const snapshot: UndoSnapshot = {
      version: 1,
      id: name,
      before,
      target,
      tutorialComplete: true,
    };
    expect(fatalCollisionForUndo(level, after, snapshot)).toEqual(result);
    expect(after.lives).toBe(0);
    expect(undoState(after, snapshot)).toEqual({
      ...before,
      revision: after.revision + 1,
    });
    if (name === "flip" || name === "rotor")
      expect(result.spotFlips?.length).toBeGreaterThan(0);
    if (name === "fragile") expect(result.collapses?.length).toBeGreaterThan(0);
    if (name === "key") expect(result.unlocks?.length).toBeGreaterThan(0);
    if (name.startsWith("portal"))
      expect(result.portals?.length).toBeGreaterThan(0);
    if (name.startsWith("leap"))
      expect(result.leaps?.length).toBeGreaterThan(0);
    if (name === "linked") expect(result.members?.length).toBeGreaterThan(1);
    for (const member of result.members ?? [result]) {
      const definition = level.arrows.find((a) => a.id === member.arrowId);
      assert.ok(definition);
      const body = expandedPoints(definition.path, level.gridSize, level);
      const motion = arrowMotionTrack(
        body,
        member,
        level.gridSize,
        0,
        level,
        true,
      );
      const impact = slicePath(
        motion.track,
        motion.distance,
        motion.bodyLength,
      );
      if (member.kind === "blocked" && member.contact) {
        const contact = impact.points.at(-1);
        assert.ok(contact);
        expect(
          contact.distanceTo(new Vector3(...member.contact.point)),
        ).toBeLessThan(1e-8);
        if (name === "portal-exit-contact") {
          const ordinary = arrowMotionTrack(
            body,
            member,
            level.gridSize,
            0,
            level,
          );
          const legacyTip = slicePath(
            ordinary.track,
            ordinary.distance,
            ordinary.bodyLength,
          ).points.at(-1);
          assert.ok(legacyTip);
          expect(legacyTip.distanceTo(contact)).toBeGreaterThan(0.1);
        }
      }
      const returning = slicePath(
        motion.track,
        motion.distance / 2,
        motion.bodyLength,
      );
      const restored = slicePath(motion.track, 0, motion.bodyLength);
      const start = restored.points[0],
        end = restored.points.at(-1),
        originalStart = body.points[0],
        originalEnd = body.points.at(-1);
      assert.ok(start && end && originalStart && originalEnd);
      expect(
        start.distanceTo(
          member.endpoint === "tail" ? originalEnd : originalStart,
        ),
      ).toBeLessThan(1e-8);
      expect(
        end.distanceTo(
          member.endpoint === "tail" ? originalStart : originalEnd,
        ),
      ).toBeLessThan(1e-8);
      expect(impact.points.every((p) => p instanceof Vector3)).toBe(true);
      expect(returning.points.length).toBeGreaterThan(1);
    }
  });
}

test("a parked double's fatal collision returns to its saved path rather than its authored start", () => {
  const level: LevelDefinition = {
    ...straight,
    stops: [c(3, 2)],
    arrows: [
      { ...player, kind: "double" },
      straight.arrows[1] as LevelDefinition["arrows"][number],
    ],
  };
  const initial = createGameState(level);
  const park = simulateMove(level, initial, "p");
  expect(park.kind).toBe("paused");
  const before = applyMove(level, initial, park);
  const result = simulateMove(level, before, "p");
  expect(result.kind).toBe("blocked");
  const after = applyMove(level, before, result);
  const target = { arrowId: "p", endpoint: "head" as const };
  const snapshot: UndoSnapshot = {
    version: 1,
    id: "parked",
    before,
    target,
    tutorialComplete: true,
  };
  expect(fatalCollisionForUndo(level, after, snapshot)).toEqual(result);
  expect(undoState(after, snapshot).settledPaths).toEqual(before.settledPaths);
  const body = expandedPoints(
    settledPathOf(
      level,
      before,
      level.arrows[0] as LevelDefinition["arrows"][number],
    ),
    level.gridSize,
    level,
  );
  const motion = arrowMotionTrack(body, result, level.gridSize, 0, level);
  expect(slicePath(motion.track, 0, motion.bodyLength).points).toEqual(
    body.points,
  );
});

test("normal moves retain round-trip timing while impact and rewind share its two legs", () => {
  expect([0, 0.5, 1].map((p) => arrowAnimationProgress(p, "impact"))).toEqual([
    0, 0.25, 0.5,
  ]);
  expect([0, 0.5, 1].map((p) => arrowAnimationProgress(p, "rewind"))).toEqual([
    0.5, 0.75, 1,
  ]);
  expect(arrowAnimationProgress(0.7, "move")).toBe(0.7);
  const normal = arrowMotionDuration(2, "blocked");
  expect(arrowMotionDuration(2, "blocked", false, "impact") * 2).toBe(normal);
  expect(arrowMotionDuration(2, "blocked", false, "rewind") * 2).toBe(normal);
  expect(arrowMotionDuration(0, "blocked", false, "rewind")).toBeGreaterThan(0);
  expect(arrowMotionDuration(2, "blocked", true, "rewind")).toBeLessThan(110);
});

test("only a verified fatal collision reconstructs an impact, never deletes, falls or stale history", () => {
  const before = createGameState(LEVEL_ONE);
  const target = { arrowId: "l1-front-blocked", endpoint: "head" as const };
  const snapshot: UndoSnapshot = {
    version: 1,
    id: "ordinary",
    before,
    target,
    tutorialComplete: true,
  };
  const after = applyMove(
    LEVEL_ONE,
    before,
    simulateMove(LEVEL_ONE, before, target.arrowId),
  );
  expect(fatalCollisionForUndo(LEVEL_ONE, after, snapshot)).toBeUndefined();
  const level = { ...LEVEL_ONE, lives: 1 };
  const start = createGameState(level);
  const end = applyMove(
    level,
    start,
    simulateMove(level, start, target.arrowId),
  );
  const entry = { ...snapshot, before: start };
  expect(fatalCollisionForUndo(level, end, entry)).toBeDefined();
  expect(fatalCollisionForUndo(level, end, null)).toBeUndefined();
  expect(
    fatalCollisionForUndo(level, end, { ...entry, kind: "delete" }),
  ).toBeUndefined();
  expect(
    fatalCollisionForUndo(level, { ...end, failedIds: [] }, entry),
  ).toBeUndefined();
  expect(fatalCollisionForUndo(WRAP_INTRO_LEVEL, end, entry)).toBeUndefined();
});
