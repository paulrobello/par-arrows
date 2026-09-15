import { describe, expect, test } from "bun:test";
import * as THREE from "three";

import { faceNormal, stepAcrossSeam } from "../src/core/topology";
import type { Cell, FaceId } from "../src/core/types";
import {
  expandedPoints,
  ribbonSections,
  ribbonVertices,
  slicePath,
} from "../src/render/renderer";

function vertices(values: Float32Array): readonly THREE.Vector3[] {
  return Array.from(
    { length: 4 },
    (_, index) =>
      new THREE.Vector3(
        values[index * 3],
        values[index * 3 + 1],
        values[index * 3 + 2],
      ),
  );
}

function expectFacePlane(
  values: Float32Array,
  normal: THREE.Vector3,
  offset: number,
): void {
  for (const point of vertices(values)) {
    expect(point.dot(normal)).toBeCloseTo(offset, 5);
  }
}

function expectEqualPoint(first: THREE.Vector3, second: THREE.Vector3): void {
  expect(first.x).toBeCloseTo(second.x, 7);
  expect(first.y).toBeCloseTo(second.y, 7);
  expect(first.z).toBeCloseTo(second.z, 7);
}

describe("flat ribbon geometry", () => {
  test("keeps a straight and bent front-face path planar", () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const straight = ribbonVertices(
      new THREE.Vector3(-0.5, 0, 1),
      new THREE.Vector3(0.5, 0, 1),
      normal,
      0.2,
    );
    const bent = ribbonVertices(
      new THREE.Vector3(0.5, 0, 1),
      new THREE.Vector3(0.5, 0.5, 1),
      normal,
      0.2,
    );
    expectFacePlane(straight, normal, 1.004);
    expectFacePlane(bent, normal, 1.004);
  });

  test("folds a wrapped route onto each owning face plane", () => {
    const front = ribbonVertices(
      new THREE.Vector3(0.5, 0, 1),
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(0, 0, 1),
      0.2,
    );
    const right = ribbonVertices(
      new THREE.Vector3(1, 0, 1),
      new THREE.Vector3(1, 0, 0.5),
      new THREE.Vector3(1, 0, 0),
      0.2,
    );
    expectFacePlane(front, new THREE.Vector3(0, 0, 1), 1.004);
    expectFacePlane(right, new THREE.Vector3(1, 0, 0), 1.004);
  });

  test("preserves off-center lanes at front-right and top-back folds", () => {
    const front: Cell = { face: "front", x: 3, y: 3 };
    const frontRight = expandedPoints(
      [front, stepAcrossSeam(front, "east", 4)],
      4,
    );
    const top: Cell = { face: "top", x: 1, y: 0 };
    const topBack = expandedPoints([top, stepAcrossSeam(top, "north", 4)], 4);
    const frontSeam = frontRight.points[1];
    const topSeam = topBack.points[1];
    expect(frontSeam?.y).toBeCloseTo(-0.75, 5);
    expect(topSeam?.x).toBeCloseTo(-0.25, 5);
    expectFacePlane(
      ribbonVertices(
        frontRight.points[0] ?? new THREE.Vector3(),
        frontSeam ?? new THREE.Vector3(),
        new THREE.Vector3(0, 0, 1),
        0.2,
      ),
      new THREE.Vector3(0, 0, 1),
      1.004,
    );
    expectFacePlane(
      ribbonVertices(
        frontSeam ?? new THREE.Vector3(),
        frontRight.points[2] ?? new THREE.Vector3(),
        new THREE.Vector3(1, 0, 0),
        0.2,
      ),
      new THREE.Vector3(1, 0, 0),
      1.004,
    );
    expectFacePlane(
      ribbonVertices(
        topSeam ?? new THREE.Vector3(),
        topBack.points[2] ?? new THREE.Vector3(),
        new THREE.Vector3(0, 0, -1),
        0.2,
      ),
      new THREE.Vector3(0, 0, -1),
      1.004,
    );
  });

  test("keeps one face owner per segment through fractional seam slices", () => {
    const beforeSeam: Cell = { face: "front", x: 2, y: 1 };
    const boundary: Cell = { face: "front", x: 3, y: 1 };
    const path = expandedPoints(
      [beforeSeam, boundary, stepAcrossSeam(boundary, "east", 4)],
      4,
    );
    const sliced = slicePath(path, 0.13, 0.71);
    expect(sliced.points.length).toBe(sliced.segmentFaces.length + 1);
    expect(sliced.segmentFaces).toEqual(["front", "front", "right"]);
    const sections = ribbonSections(sliced.points, sliced.segmentFaces, 0.2);
    expectEqualPoint(
      sections[0]?.end.left ?? new THREE.Vector3(),
      sections[1]?.start.left ?? new THREE.Vector3(),
    );
    expect(
      sections[1]?.end.left.distanceTo(
        sections[2]?.start.left ?? new THREE.Vector3(),
      ),
    ).toBeGreaterThan(0.001);
    expect(
      sliced.points
        .at(-1)
        ?.distanceTo(path.points.at(-1) ?? new THREE.Vector3()),
    ).toBeLessThan(0.5);
  });

  test("does not shift later miter slots after a tiny fractional leading segment", () => {
    const path = {
      points: [
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(1, 0, 1),
        new THREE.Vector3(2, 0, 1),
        new THREE.Vector3(2, 1, 1),
      ],
      segmentFaces: ["front", "front", "front"] as const,
    };
    const sliced = slicePath(path, 0.99999999, 2);
    const sections = ribbonSections(sliced.points, sliced.segmentFaces, 0.2);
    expect(sections.length).toBe(sliced.segmentFaces.length);
    expect(
      sliced.points[1]?.distanceTo(sliced.points[0] ?? new THREE.Vector3()),
    ).toBeLessThan(0.000001);
    expectEqualPoint(
      sections[1]?.end.left ?? new THREE.Vector3(),
      sections[2]?.start.left ?? new THREE.Vector3(),
    );
    expectEqualPoint(
      sections[1]?.end.right ?? new THREE.Vector3(),
      sections[2]?.start.right ?? new THREE.Vector3(),
    );
  });

  test("shares exact miter sections with known inner and outer front corners", () => {
    const left = ribbonSections(
      [
        new THREE.Vector3(-1, 0, 1),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 1),
      ],
      ["front", "front"],
      0.2,
    );
    const right = ribbonSections(
      [
        new THREE.Vector3(-1, 0, 1),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, -1, 1),
      ],
      ["front", "front"],
      0.2,
    );
    expectEqualPoint(
      left[0]?.end.left ?? new THREE.Vector3(),
      left[1]?.start.left ?? new THREE.Vector3(),
    );
    expectEqualPoint(
      left[0]?.end.right ?? new THREE.Vector3(),
      left[1]?.start.right ?? new THREE.Vector3(),
    );
    expect(left[0]?.end.left.x).toBeCloseTo(0.1, 6);
    expect(left[0]?.end.left.y).toBeCloseTo(-0.1, 6);
    expect(left[0]?.end.right.x).toBeCloseTo(-0.1, 6);
    expect(left[0]?.end.right.y).toBeCloseTo(0.1, 6);
    expect(right[0]?.end.left.x).toBeCloseTo(-0.1, 6);
    expect(right[0]?.end.left.y).toBeCloseTo(-0.1, 6);
    expect(right[0]?.end.right.x).toBeCloseTo(0.1, 6);
    expect(right[0]?.end.right.y).toBeCloseTo(0.1, 6);
  });

  test("keeps square ends and applies stable miters for left and right turns on every face", () => {
    const faces: readonly FaceId[] = [
      "front",
      "back",
      "right",
      "left",
      "top",
      "bottom",
    ];
    for (const face of faces) {
      const [nx, ny, nz] = faceNormal(face);
      const normal = new THREE.Vector3(nx, ny, nz);
      const first = normal
        .clone()
        .cross(
          Math.abs(ny) < 0.9
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0),
        )
        .normalize();
      const leftTurn = normal.clone().cross(first).normalize();
      for (const turn of [leftTurn, leftTurn.clone().negate()]) {
        const sections = ribbonSections(
          [first.clone().negate(), new THREE.Vector3(), turn],
          [face, face],
          0.2,
        );
        expectEqualPoint(
          sections[0]?.end.left ?? new THREE.Vector3(),
          sections[1]?.start.left ?? new THREE.Vector3(),
        );
        expectEqualPoint(
          sections[0]?.end.right ?? new THREE.Vector3(),
          sections[1]?.start.right ?? new THREE.Vector3(),
        );
        for (const point of [sections[0]?.end.left, sections[0]?.end.right]) {
          expect(point?.dot(normal)).toBeCloseTo(0.004, 6);
        }
      }
      const straight = ribbonSections(
        [first.clone().negate(), new THREE.Vector3(), first],
        [face, face],
        0.2,
      );
      expect(
        straight[0]?.end.left.distanceTo(
          straight[1]?.start.left ?? new THREE.Vector3(),
        ),
      ).toBeCloseTo(0, 7);
      expect(
        straight[0]?.start.left.distanceTo(new THREE.Vector3()),
      ).toBeGreaterThan(0.9);
    }
  });
});
