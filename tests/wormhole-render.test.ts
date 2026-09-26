import { describe, expect, test } from "bun:test";
import { Vector3 } from "three";
import { faceNormal, oppositeHeading } from "../src/core/topology";
import type { Cell, FaceId, LevelDefinition } from "../src/core/types";
import {
  expandedPoints,
  pathLength,
  ribbonSections,
  ribbonVertices,
  slicePath,
  THEME_PALETTES,
  wormholeDotColorIndex,
} from "../src/render/renderer";

const c = (face: FaceId, x: number, y: number): Cell => ({ face, x, y });
const level: LevelDefinition = {
  id: 99,
  title: "t",
  gridSize: 4,
  lives: 3,
  arrows: [],
  wormholes: [{ id: "w1", a: c("front", 2, 1), b: c("right", 1, 2) }],
};

describe("portal ribbons", () => {
  test("an approach that wraps a seam onto an end stays on the cube surface", () => {
    const seamLevel: LevelDefinition = {
      ...level,
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
      ],
      wormholes: [{ id: "w1", a: c("right", 0, 1), b: c("top", 2, 2) }],
    };
    const path = expandedPoints(
      [c("front", 2, 1), c("front", 3, 1), c("top", 2, 2)],
      4,
      seamLevel,
    );
    // Every drawn (non-gap) segment must stay on one face: both ends lie on
    // that face's plane, so no segment cuts through the cube.
    path.segmentFaces.forEach((face, index) => {
      if (path.gaps?.[index]) return;
      const start = path.points[index] as Vector3;
      const end = path.points[index + 1] as Vector3;
      const normal = new Vector3(...faceNormal(face));
      expect(start.dot(normal)).toBeCloseTo(1, 5);
      expect(end.dot(normal)).toBeCloseTo(1, 5);
    });
  });

  test("a portal link becomes a zero-length gap with no bridge quad", () => {
    const path = expandedPoints(
      [c("front", 1, 1), c("right", 1, 2), c("right", 2, 2)],
      4,
      level,
    );
    const plain = expandedPoints(
      [c("front", 1, 1), c("front", 2, 1), c("front", 3, 1)],
      4,
    );
    expect(path.gaps?.filter(Boolean).length).toBe(1);
    expect(Math.abs(pathLength(path) - pathLength(plain))).toBeLessThan(1e-6);
    const full = slicePath(path, 0, 100);
    expect(full.gaps?.filter(Boolean).length).toBe(1);
    const sections = ribbonSections(
      full.points,
      full.segmentFaces,
      0.1,
      false,
      full.gaps,
    );
    const jump = (full.gaps ?? []).findIndex(Boolean);
    const a = full.points[jump];
    const b = full.points[jump + 1];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    if (!a || !b) throw new Error("Portal endpoints missing");
    for (let i = 0; i < full.segmentFaces.length; i += 1) {
      if (full.gaps?.[i]) {
        expect(sections[i]).toBeUndefined();
        continue;
      }
      const start = full.points[i];
      const end = full.points[i + 1];
      const face = full.segmentFaces[i];
      if (!start || !end || !face) continue;
      const normal =
        face === "front" ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      const quad = ribbonVertices(
        start,
        end,
        normal,
        0.1,
        sections[i]?.start,
        sections[i]?.end,
      );
      expect(quad.length).toBe(12);
      expect(start.distanceTo(a) + end.distanceTo(b)).toBeGreaterThan(0.1);
    }
  });

  test("wormhole colors are unique and distinct from every mechanic color", () => {
    for (const palette of Object.values(THEME_PALETTES)) {
      const [first, second] = palette.wormhole;
      expect(first).not.toBe(second);
      const others = [
        palette.stop,
        palette.directional,
        palette.flip,
        palette.doubleTail,
        palette.doubleHead,
        palette.failed,
        palette.arrow,
        palette.selected,
        palette.nudge,
      ];
      expect(others).not.toContain(first);
      expect(others).not.toContain(second);
    }
  });
});

describe("wormhole direction dots", () => {
  const sides = ["east", "west", "south", "north"] as const;

  test("the side a head enters by matches the color of the side it leaves by, both ways", () => {
    for (const heading of sides) {
      // A head travelling `heading` enters an end through its opposite side
      // and leaves the partner through its `heading` side.
      expect(wormholeDotColorIndex(oppositeHeading(heading), "a")).toBe(
        wormholeDotColorIndex(heading, "b"),
      );
      expect(wormholeDotColorIndex(oppositeHeading(heading), "b")).toBe(
        wormholeDotColorIndex(heading, "a"),
      );
    }
  });

  test("the four sides of each end use four distinct colors", () => {
    for (const end of ["a", "b"] as const) {
      expect(
        new Set(sides.map((side) => wormholeDotColorIndex(side, end))).size,
      ).toBe(4);
    }
  });

  test("direction dot colors are distinct from each other and every other color", () => {
    for (const palette of Object.values(THEME_PALETTES)) {
      expect(new Set(palette.wormholeDots).size).toBe(4);
      const others = [
        ...palette.wormhole,
        palette.stop,
        palette.directional,
        palette.flip,
        palette.doubleTail,
        palette.doubleHead,
        palette.failed,
        palette.arrow,
        palette.selected,
        palette.nudge,
        palette.cube,
      ];
      for (const dot of palette.wormholeDots) expect(others).not.toContain(dot);
    }
  });
});
