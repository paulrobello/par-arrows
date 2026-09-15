import { describe, expect, test } from "bun:test";
import * as THREE from "three";

import { stepAcrossSeam } from "../src/core/topology";
import type { Cell } from "../src/core/types";
import {
  expandedPoints,
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
    expect(
      sliced.points
        .at(-1)
        ?.distanceTo(path.points.at(-1) ?? new THREE.Vector3()),
    ).toBeLessThan(0.5);
  });
});
