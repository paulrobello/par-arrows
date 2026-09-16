import { describe, expect, test } from "bun:test";
import * as THREE from "three";

import { createGameState, simulateMove } from "../src/core/game-state";
import {
  edgePoint,
  faceHeadingVector,
  faceNormal,
  seamTransition,
  stepAcrossSeam,
} from "../src/core/topology";
import type { Cell, FaceId, Heading, MoveResult } from "../src/core/types";
import {
  arrowMotionDuration,
  arrowMotionTrack,
  expandedPoints,
  ribbonSections,
  ribbonVertices,
  slicePath,
  stopCircleOpacity,
  wrappingEdgeOpacity,
  wrappingEdgeSegments,
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

function result(
  kind: MoveResult["kind"],
  route: readonly Cell[],
  edgePoint?: readonly [number, number, number],
  tangent?: readonly [number, number, number],
  distance = 0,
): MoveResult {
  return {
    arrowId: "test",
    endpoint: "head",
    kind,
    distance,
    route,
    waypoints: [],
    stateRevision: 0,
    offset: 0,
    ...(edgePoint && tangent ? { exit: { edgePoint, tangent } } : {}),
  };
}

function polylineLength(points: readonly THREE.Vector3[]): number {
  return points
    .slice(1)
    .reduce(
      (total, point, index) => total + point.distanceTo(points[index] ?? point),
      0,
    );
}

describe("flat ribbon geometry", () => {
  test("a short group member keeps its whole ribbon while traveling beside a longer member", () => {
    const path = expandedPoints(
      [
        { face: "front", x: 0, y: 1 },
        { face: "front", x: 1, y: 1 },
      ],
      4,
    );
    const move = result(
      "exit",
      [{ face: "front", x: 1, y: 1 }],
      [1, 0.25, 1],
      [1, 0, 0],
    );
    const { track, bodyLength } = arrowMotionTrack(path, move, 4, 8);
    const start = slicePath(track, 0, bodyLength);
    const outbound = slicePath(track, 7, bodyLength);
    const returning = slicePath(track, 3, bodyLength);
    expect(polylineLength(outbound.points)).toBeCloseTo(bodyLength, 7);
    expect(polylineLength(returning.points)).toBeCloseTo(bodyLength, 7);
    expectEqualPoint(
      start.points[0] as THREE.Vector3,
      path.points[0] as THREE.Vector3,
    );
    expect((outbound.points.at(-1) as THREE.Vector3).x).toBeGreaterThan(
      (returning.points.at(-1) as THREE.Vector3).x,
    );
  });

  test("dims hidden wrapping edges and keeps visible faces and outlines bright", () => {
    const faces: readonly FaceId[] = [
      "front",
      "back",
      "left",
      "right",
      "top",
      "bottom",
    ];
    const headings: readonly Heading[] = ["east", "west", "north", "south"];
    const edges = wrappingEdgeSegments({
      id: 11,
      title: "Edge visibility",
      gridSize: 4,
      lives: 3,
      arrows: [],
      edgePolicies: faces.flatMap((face) =>
        headings.map((edge) => {
          const boundary: Cell = {
            face,
            x: edge === "east" ? 3 : edge === "west" ? 0 : 1,
            y: edge === "south" ? 3 : edge === "north" ? 0 : 1,
          };
          const next = seamTransition(boundary, edge, 4);
          return {
            face,
            edge,
            policy: "continue" as const,
            neighbor: { face: next.cell.face, entering: next.heading },
          };
        }),
      ),
    });
    expect(edges).toHaveLength(12);
    for (const edge of edges) {
      const [first, second] = edge.faceNormals;
      expect(wrappingEdgeOpacity(edge, first.clone().multiplyScalar(5))).toBe(
        1,
      );
      expect(wrappingEdgeOpacity(edge, second.clone().multiplyScalar(5))).toBe(
        1,
      );
      expect(
        wrappingEdgeOpacity(edge, first.clone().add(second).multiplyScalar(-5)),
      ).toBe(0.32);
      expect(
        wrappingEdgeOpacity(edge, first.clone().add(second).multiplyScalar(5)),
      ).toBe(1);
      expect(
        wrappingEdgeOpacity(edge, first.clone().addScaledVector(second, -5)),
      ).toBe(1);
      const overhead = first
        .clone()
        .cross(second)
        .multiplyScalar(5)
        .addScaledVector(first, 0.5)
        .addScaledVector(second, 0.5);
      expect(wrappingEdgeOpacity(edge, overhead)).toBe(0.32);
    }
  });
  test("keeps near and far exits at the same five-unit world speed", () => {
    const nearPath = expandedPoints(
      [
        { face: "front", x: 2, y: 1 },
        { face: "front", x: 3, y: 1 },
      ],
      4,
    );
    const farPath = expandedPoints(
      [
        { face: "front", x: 0, y: 1 },
        { face: "front", x: 1, y: 1 },
      ],
      4,
    );
    const near = arrowMotionTrack(
      nearPath,
      result(
        "exit",
        [{ face: "front", x: 3, y: 1 }],
        edgePoint({ face: "front", x: 3, y: 1 }, "east", 4),
        [1, 0, 0],
      ),
      4,
    );
    const far = arrowMotionTrack(
      farPath,
      result(
        "exit",
        [
          { face: "front", x: 1, y: 1 },
          { face: "front", x: 2, y: 1 },
          { face: "front", x: 3, y: 1 },
        ],
        edgePoint({ face: "front", x: 3, y: 1 }, "east", 4),
        [1, 0, 0],
      ),
      4,
    );
    for (const motion of [near, far]) {
      const duration = arrowMotionDuration(motion.distance, "exit");
      expect(motion.distance / (duration / 1000)).toBeCloseTo(5, 8);
    }
    expect(far.distance).toBeGreaterThan(near.distance);
    const sampleDuration = 100;
    expect(
      near.distance *
        (sampleDuration / arrowMotionDuration(near.distance, "exit")),
    ).toBeCloseTo(
      far.distance *
        (sampleDuration / arrowMotionDuration(far.distance, "exit")),
      8,
    );
    expect(arrowMotionDuration(far.distance, "exit")).toBeGreaterThan(
      arrowMotionDuration(near.distance, "exit"),
    );
  });

  test("bounds exit flight by actual body length plus two world units", () => {
    for (const gridSize of [4, 8]) {
      const path = expandedPoints(
        [
          { face: "front", x: gridSize - 3, y: 2 },
          { face: "front", x: gridSize - 2, y: 2 },
          { face: "front", x: gridSize - 1, y: 2 },
        ],
        gridSize,
      );
      const motion = arrowMotionTrack(
        path,
        result(
          "exit",
          [{ face: "front", x: gridSize - 1, y: 2 }],
          edgePoint({ face: "front", x: gridSize - 1, y: 2 }, "east", gridSize),
          [1, 0, 0],
        ),
        gridSize,
      );
      const end = motion.track.points.at(-1) ?? new THREE.Vector3();
      const edge = new THREE.Vector3(
        ...edgePoint(
          { face: "front", x: gridSize - 1, y: 2 },
          "east",
          gridSize,
        ),
      );
      expect(end.distanceTo(edge)).toBeCloseTo(motion.bodyLength + 2, 6);
      expect(
        motion.distance / (arrowMotionDuration(motion.distance, "exit") / 1000),
      ).toBeCloseTo(5, 8);
    }
  });

  test("measures a folded route along its world-space seam arc", () => {
    const boundary: Cell = { face: "front", x: 3, y: 1 };
    const across = stepAcrossSeam(boundary, "east", 4);
    const routeCells = [
      { face: "front", x: 2, y: 1 } as const,
      boundary,
      across,
      ...[1, 2, 3].map((x): Cell => ({ face: "right", x, y: across.y })),
    ];
    const exitCell: Cell = { face: "right", x: 3, y: across.y };
    const route = expandedPoints(routeCells, 4);
    const path = expandedPoints(
      [
        { face: "front", x: 1, y: 1 },
        { face: "front", x: 2, y: 1 },
      ],
      4,
    );
    const endpointArray = edgePoint(exitCell, "east", 4);
    const tangent = faceHeadingVector("right", "east");
    const motion = arrowMotionTrack(
      path,
      result("exit", routeCells, endpointArray, tangent, 2),
      4,
    );
    expect(motion.distance).toBeCloseTo(
      polylineLength(route.points) + 0.25 + motion.bodyLength + 2,
      6,
    );
    expect(
      motion.distance / (arrowMotionDuration(motion.distance, "exit") / 1000),
    ).toBeCloseTo(5, 8);
  });

  test("reverses blocked motion at the same speed and preserves reduced motion timing", () => {
    const route = expandedPoints(
      [
        { face: "front", x: 2, y: 1 },
        { face: "front", x: 3, y: 1 },
      ],
      4,
    );
    const path = expandedPoints(
      [
        { face: "front", x: 1, y: 1 },
        { face: "front", x: 2, y: 1 },
      ],
      4,
    );
    const blockedResult = result(
      "blocked",
      [
        { face: "front", x: 2, y: 1 },
        { face: "front", x: 3, y: 1 },
      ],
      undefined,
      undefined,
      0.5,
    );
    const motion = arrowMotionTrack(path, blockedResult, 4);
    const duration = arrowMotionDuration(motion.distance, "blocked");
    expect(motion.distance).toBeCloseTo(polylineLength(route.points) - 0.25, 7);
    expect(motion.distance).toBeCloseTo(blockedResult.distance * (2 / 4), 7);
    expect(motion.distance / (duration / 2000)).toBeCloseTo(5, 8);
    expect(arrowMotionDuration(motion.distance, "blocked", true)).toBeCloseTo(
      70.4,
      8,
    );
  });

  test("matches simulated blocker contact distance to the rendered route", () => {
    const level = {
      id: 13,
      title: "Block contact",
      gridSize: 4,
      lives: 2,
      arrows: [
        {
          id: "moving",
          path: [
            { face: "front", x: 1, y: 1 },
            { face: "front", x: 2, y: 1 },
          ],
        },
        {
          id: "blocker",
          path: [
            { face: "front", x: 3, y: 1 },
            { face: "front", x: 3, y: 2 },
          ],
        },
      ],
    } as const;
    const move = simulateMove(level, createGameState(level), "moving");
    const motion = arrowMotionTrack(
      expandedPoints(level.arrows[0].path, level.gridSize),
      move,
      level.gridSize,
    );
    expect(move.kind).toBe("blocked");
    expect(motion.distance).toBeCloseTo(
      move.distance * (2 / level.gridSize),
      8,
    );
  });

  test("renders reciprocal continuation policies as one physical cube seam", () => {
    const segments = wrappingEdgeSegments({
      id: 11,
      title: "Wrapped edge",
      gridSize: 4,
      lives: 1,
      arrows: [],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
        {
          face: "right",
          edge: "west",
          policy: "continue",
          neighbor: { face: "front", entering: "west" },
        },
      ],
    });
    expect(segments).toHaveLength(1);
    expect(
      segments[0]?.start.distanceTo(segments[0]?.end ?? new THREE.Vector3()),
    ).toBeCloseTo(2, 5);
    for (const point of [segments[0]?.start, segments[0]?.end]) {
      expect(point?.x).toBeGreaterThan(1);
      expect(point?.z).toBeGreaterThan(1);
    }
  });

  test("keeps distinct continued cube edges separate", () => {
    const segments = wrappingEdgeSegments({
      id: 12,
      title: "Wrapped corner",
      gridSize: 4,
      lives: 1,
      arrows: [],
      edgePolicies: [
        {
          face: "front",
          edge: "east",
          policy: "continue",
          neighbor: { face: "right", entering: "east" },
        },
        {
          face: "front",
          edge: "north",
          policy: "continue",
          neighbor: { face: "top", entering: "north" },
        },
      ],
    });
    expect(segments).toHaveLength(2);
    expect(
      segments[0]?.start.distanceTo(segments[1]?.start ?? new THREE.Vector3()),
    ).toBeGreaterThan(0.5);
  });

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

  test("closes every oriented cube fold at the shared lifted face intersection", () => {
    const faces: readonly FaceId[] = [
      "front",
      "back",
      "right",
      "left",
      "top",
      "bottom",
    ];
    const headings: readonly Heading[] = ["east", "west", "south", "north"];
    for (const size of [4, 26]) {
      for (const face of faces) {
        for (const heading of headings) {
          for (const lane of [0, Math.floor(size / 2), size - 1]) {
            const boundary: Cell = {
              face,
              x: heading === "east" ? size - 1 : heading === "west" ? 0 : lane,
              y:
                heading === "south" ? size - 1 : heading === "north" ? 0 : lane,
            };
            const neighbor = stepAcrossSeam(boundary, heading, size);
            const path = expandedPoints([boundary, neighbor], size);
            for (const offset of [0, 1 / size - 1e-8]) {
              const slice = slicePath(path, offset, 2 / size - offset);
              const sections = ribbonSections(
                slice.points,
                slice.segmentFaces,
                0.025,
              );
              const before = sections[0];
              const after = sections[1];
              if (!before || !after)
                throw new Error("Expected both sides of the cube fold.");
              expectEqualPoint(before.end.left, after.start.left);
              expectEqualPoint(before.end.right, after.start.right);
              const firstNormal = new THREE.Vector3(...faceNormal(face));
              const nextNormal = new THREE.Vector3(
                ...faceNormal(neighbor.face),
              );
              const side = firstNormal.clone().cross(nextNormal);
              for (const point of [before.end.left, before.end.right]) {
                expect(point.dot(firstNormal)).toBeCloseTo(1.004, 7);
                expect(point.dot(nextNormal)).toBeCloseTo(1.004, 7);
              }
              for (const section of [
                before.start,
                before.end,
                after.start,
                after.end,
              ]) {
                expect(
                  section.right.clone().sub(section.left).dot(side),
                ).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }
  });

  test("moves the active head onto the neighboring face after a seam", () => {
    const boundary: Cell = { face: "front", x: 3, y: 2 };
    const path = expandedPoints(
      [boundary, stepAcrossSeam(boundary, "east", 4)],
      4,
    );
    const movingHead = slicePath(path, 0.3, 0.2);
    expect(path.segmentFaces).toEqual(["front", "right"]);
    expect(movingHead.segmentFaces).toEqual(["right"]);
    expect(movingHead.headFace).toBe("right");
    expect(movingHead.points.at(-1)?.x).toBeCloseTo(1, 5);
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
    expectEqualPoint(
      sections[1]?.end.left ?? new THREE.Vector3(),
      sections[2]?.start.left ?? new THREE.Vector3(),
    );
    expectEqualPoint(
      sections[1]?.end.right ?? new THREE.Vector3(),
      sections[2]?.start.right ?? new THREE.Vector3(),
    );
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

  test("stop circles dim when their face turns away from the camera", () => {
    const normal = new THREE.Vector3(0, 0, 1);
    const position = new THREE.Vector3(0.25, -0.25, 1.001);
    expect(
      stopCircleOpacity(normal, position, new THREE.Vector3(0, 0, 5)),
    ).toBe(1);
    expect(
      stopCircleOpacity(normal, position, new THREE.Vector3(0, 0, -5)),
    ).toBe(0.32);
    expect(
      stopCircleOpacity(normal, position, new THREE.Vector3(5, 0, 0)),
    ).toBe(0.32);
  });
});
