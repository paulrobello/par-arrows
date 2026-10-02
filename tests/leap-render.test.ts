import { describe, expect, test } from "bun:test";
import { THEME_PALETTES } from "../src/render/renderer";

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

describe("leap palette", () => {
  test("the leap amber stands apart from every mechanic color and the cube in both themes", () => {
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
        palette.hole.cavity,
        palette.mirror,
        ...palette.wormhole,
        ...palette.wormholeDots,
        ...palette.lock,
        palette.nudge,
        palette.failed,
        palette.selected,
        palette.doubleTail,
        palette.doubleHead,
        WRAP[theme as keyof typeof WRAP],
      ];
      for (const other of others) {
        expect(distance(palette.leap, other)).toBeGreaterThan(40);
      }
    }
  });
});
