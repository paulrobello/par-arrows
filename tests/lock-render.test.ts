import { describe, expect, test } from "bun:test";
import { LOCK_INTRO_LEVEL } from "../src/content/lock-intro";
import { createGameState, simulateMove } from "../src/core/game-state";
import {
  arrowMotionDuration,
  arrowMotionTrack,
  expandedPoints,
  lockGlyphOpacity,
  THEME_PALETTES,
} from "../src/render/renderer";

// Wrapping edges draw in 0xb77900 (light) and 0xffd84a (dark), outside the palette.
const WRAP = { light: 0xb77900, dark: 0xffd84a } as const;

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function distance(left: number, right: number): number {
  const [r1, g1, b1] = channels(left);
  const [r2, g2, b2] = channels(right);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

describe("lock palette", () => {
  test("each lock color stands apart from every mechanic color and the cube in both themes", () => {
    for (const [theme, palette] of Object.entries(THEME_PALETTES)) {
      const others = [
        palette.cube,
        palette.arrow,
        palette.directional,
        palette.flip,
        palette.rotor,
        palette.stop,
        palette.fragile,
        palette.hole.rim,
        ...palette.wormhole,
        ...palette.wormholeDots,
        palette.nudge,
        palette.failed,
        palette.selected,
        palette.doubleTail,
        palette.doubleHead,
        WRAP[theme as keyof typeof WRAP],
      ];
      for (const color of palette.lock) {
        for (const other of others) {
          expect(distance(color, other)).toBeGreaterThan(40);
        }
      }
      // A gate and its key share one color, and two locks never share one.
      expect(distance(palette.lock[0], palette.lock[1])).toBeGreaterThan(60);
    }
  });

  test("the themes restyle each lock to its own color", () => {
    expect(THEME_PALETTES.light.lock).not.toEqual(THEME_PALETTES.dark.lock);
    expect(THEME_PALETTES.light.lock).toHaveLength(2);
    expect(THEME_PALETTES.dark.lock).toHaveLength(2);
  });
});

describe("gate motion", () => {
  const level = LOCK_INTRO_LEVEL;
  const opener = level.arrows.find((arrow) => arrow.id === "lock-intro-opener");
  if (!opener) throw new Error("Level 50 has no opener.");
  const gated = simulateMove(level, createGameState(level), opener.id);

  test("a gated attempt travels out and back like a rebound", () => {
    expect(gated.kind).toBe("gated");
    expect(arrowMotionDuration(1, "gated")).toBe(
      2 * arrowMotionDuration(1, "exit"),
    );
  });

  test("a doomed attempt plays at three quarters time", () => {
    expect(arrowMotionDuration(1, "blocked")).toBeCloseTo(
      arrowMotionDuration(1, "gated") / 0.75,
    );
    // Gates are terrain, not collisions: the free rewind stays full speed.
    expect(arrowMotionDuration(1, "fall")).toBe(arrowMotionDuration(1, "exit"));
  });

  test("the head stops half a cell short of the gate", () => {
    const body = expandedPoints(opener.path, level.gridSize);
    const blocked = { ...gated, kind: "blocked" as const };
    expect(arrowMotionTrack(body, gated, level.gridSize).distance).toBeCloseTo(
      arrowMotionTrack(body, blocked, level.gridSize).distance,
    );
    expect(
      arrowMotionTrack(body, gated, level.gridSize).distance,
    ).toBeGreaterThan(0);
  });
});

describe("lock far-side dim", () => {
  test("the open-gate fade composes with the far-side dim", () => {
    const closed = 1;
    const open = 0.35;
    const facing = 1;
    const dimmed = 0.32;
    expect(lockGlyphOpacity(0, facing)).toBe(closed);
    expect(lockGlyphOpacity(1, facing)).toBe(open);
    // A gate seen through the cube dims like every other mechanic instead of
    // drawing at the facing gate's strength.
    expect(lockGlyphOpacity(0, dimmed)).toBeCloseTo(0.32);
    expect(lockGlyphOpacity(1, dimmed)).toBeCloseTo(0.32 * 0.35);
  });
});
