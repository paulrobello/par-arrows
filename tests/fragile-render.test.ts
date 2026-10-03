import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { FRAGILE_INTRO_LEVEL } from "../src/content/fragile-intro";
import {
  applyMove,
  createGameState,
  simulateMove,
} from "../src/core/game-state";
import { cellToWorld, faceNormal } from "../src/core/topology";
import {
  arrowMotionDuration,
  arrowMotionTrack,
  expandedPoints,
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

function luminance(color: number): number {
  const [r, g, b] = channels(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("fragile palette", () => {
  test("the crack and hole colors stand apart from every mechanic color in both themes", () => {
    for (const [theme, palette] of Object.entries(THEME_PALETTES)) {
      const others = [
        palette.directional,
        palette.flip,
        palette.rotor,
        palette.stop,
        ...palette.wormhole,
        ...palette.wormholeDots,
        palette.nudge,
        palette.failed,
        palette.doubleTail,
        palette.doubleHead,
        WRAP[theme as keyof typeof WRAP],
      ];
      for (const color of [
        palette.fragile,
        palette.hole.rim,
        palette.hole.cavity,
      ]) {
        for (const other of others) {
          expect(distance(color, other)).toBeGreaterThan(40);
        }
      }
      // The frame reads against both the cube and the dark cavity.
      expect(distance(palette.hole.rim, palette.cube)).toBeGreaterThan(40);
      expect(distance(palette.hole.rim, palette.hole.cavity)).toBeGreaterThan(
        40,
      );
      // The cavity is the darkest thing on the face.
      expect(luminance(palette.hole.cavity)).toBeLessThan(
        luminance(palette.cube),
      );
      expect(luminance(palette.hole.cavity)).toBeLessThan(30);
    }
  });
});

describe("fall motion", () => {
  const level = FRAGILE_INTRO_LEVEL;
  const crossed = (() => {
    const state = createGameState(level);
    return applyMove(
      level,
      state,
      simulateMove(level, state, "fragile-intro-crosser"),
    );
  })();
  const fall = simulateMove(level, crossed, "fragile-intro-double", "head");
  const double = level.arrows.find(
    (arrow) => arrow.id === "fragile-intro-double",
  );
  if (!double) throw new Error("Level 45 has no double.");

  test("the head reaches the hole, then turns inward along the face normal", () => {
    expect(fall.kind).toBe("fall");
    const body = expandedPoints(double.path, level.gridSize);
    const {
      track,
      bodyLength,
      distance: travel,
    } = arrowMotionTrack(body, fall, level.gridSize);
    if (!fall.hole) throw new Error("A fall reports its hole.");
    const hole = new Vector3(...cellToWorld(fall.hole, level.gridSize));
    const points = track.points;
    const last = points.at(-1) as Vector3;
    const beforeLast = points.at(-2) as Vector3;
    // The penultimate point is the hole's center on the face.
    expect(beforeLast.distanceTo(hole)).toBeLessThan(1e-6);
    const dive = last.clone().sub(beforeLast).normalize();
    const inward = new Vector3(...faceNormal("front")).negate();
    expect(dive.dot(inward)).toBeCloseTo(1);
    // The dive sinks the whole body below the face.
    expect(last.distanceTo(beforeLast)).toBeGreaterThanOrEqual(bodyLength);
    expect(travel).toBeGreaterThan(0);
  });

  test("a fall travels once, like an exit, not out and back like a rebound", () => {
    expect(arrowMotionDuration(1, "fall")).toBe(arrowMotionDuration(1, "exit"));
    expect(arrowMotionDuration(1, "blocked")).toBeCloseTo(
      (2 * arrowMotionDuration(1, "exit")) / 0.75,
    );
  });
});
