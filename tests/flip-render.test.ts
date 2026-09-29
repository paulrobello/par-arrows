import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { flippedHeading, rotatedHeading } from "../src/core/directionals";
import { faceHeadingVector, faceNormal } from "../src/core/topology";
import {
  flipTurnProgress,
  spotTurnAngle,
  THEME_PALETTES,
} from "../src/render/renderer";

const GRID = 8;
const CELL = 2 / GRID;
const DISTANCE = 10 * CELL;

function blockedTravel(progress: number): number {
  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}

describe("flipTurnProgress", () => {
  test("a step-0 flip fires only at the end of an exit", () => {
    expect(flipTurnProgress(0, GRID, DISTANCE, 0)).toBe(0);
    expect(flipTurnProgress(0, GRID, DISTANCE, 0.9)).toBe(0);
    expect(flipTurnProgress(0, GRID, DISTANCE, 1)).toBe(0);
  });

  test("a step-k flip starts turning at its world-space share of travel", () => {
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.39)).toBe(0);
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.4)).toBe(0);
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.46)).toBeCloseTo(0.5);
    expect(flipTurnProgress(4, GRID, DISTANCE, 0.52)).toBeCloseTo(1);
    expect(flipTurnProgress(4, GRID, DISTANCE, 1)).toBe(1);
  });

  test("the fire point scales with grid pitch, not cell count", () => {
    const large = 16;
    const distance = 10 * (2 / large);
    expect(flipTurnProgress(4, large, distance, 0.46)).toBeCloseTo(0.5);
  });

  test("a flip past the motion distance clamps to the end", () => {
    expect(flipTurnProgress(12, GRID, DISTANCE, 0.99)).toBe(0);
  });

  test("a blocked rebound turns the glyph and returns it to 0", () => {
    const distance = 5 * CELL;
    const turns = [0, 0.1, 0.2, 0.3, 0.5, 0.7, 0.8, 1].map((progress) =>
      flipTurnProgress(2, GRID, distance, blockedTravel(progress)),
    );
    expect(turns[1]).toBe(0);
    expect(turns[3]).toBeGreaterThan(0);
    expect(turns[4]).toBe(1);
    expect(turns[5]).toBeGreaterThan(0);
    expect(turns.at(-1)).toBe(0);
  });
});

describe("rotor glyph color", () => {
  // Wrapping edges draw in 0xb77900 (light) and 0xffd84a (dark), outside the palette.
  const WRAP = { light: 0xb77900, dark: 0xffd84a } as const;
  const channels = (color: number): [number, number, number] => [
    (color >> 16) & 0xff,
    (color >> 8) & 0xff,
    color & 0xff,
  ];
  const distance = (left: number, right: number): number => {
    const [r1, g1, b1] = channels(left);
    const [r2, g2, b2] = channels(right);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };

  test("the rotor color stands apart from every other mechanic color in both themes", () => {
    for (const [theme, palette] of Object.entries(THEME_PALETTES)) {
      const others = [
        palette.directional,
        palette.flip,
        palette.stop,
        ...palette.wormhole,
        ...palette.wormholeDots,
        palette.nudge,
        palette.failed,
        palette.doubleTail,
        palette.doubleHead,
        palette.cube,
        WRAP[theme as keyof typeof WRAP],
      ];
      for (const other of others) {
        expect(distance(palette.rotor, other)).toBeGreaterThan(40);
      }
    }
  });
});

describe("spotTurnAngle", () => {
  const faces = ["front", "back", "right", "left", "top", "bottom"] as const;
  const headings = ["north", "east", "south", "west"] as const;

  function turned(
    face: (typeof faces)[number],
    heading: (typeof headings)[number],
    angle: number,
  ): Vector3 {
    return new Vector3(...faceHeadingVector(face, heading)).applyAxisAngle(
      new Vector3(...faceNormal(face)),
      angle,
    );
  }

  test("one rotor advance turns the glyph onto the rotor's next heading on every face", () => {
    for (const face of faces) {
      for (const heading of headings) {
        const next = new Vector3(
          ...faceHeadingVector(face, rotatedHeading(heading)),
        );
        expect(
          turned(face, heading, spotTurnAngle("rotor")).distanceTo(next),
        ).toBeLessThan(1e-9);
      }
    }
  });

  test("one flip advance turns the glyph onto the opposite heading", () => {
    for (const face of faces) {
      for (const heading of headings) {
        const opposite = new Vector3(
          ...faceHeadingVector(face, flippedHeading(heading)),
        );
        expect(
          turned(face, heading, spotTurnAngle("flip")).distanceTo(opposite),
        ).toBeLessThan(1e-9);
      }
    }
  });
});
