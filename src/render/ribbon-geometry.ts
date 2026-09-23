import * as THREE from "three";
import type { FaceId } from "../core/types";

export interface SplitPath {
  readonly points: readonly THREE.Vector3[];
  readonly segmentFaces: readonly FaceId[];
  readonly startDistance: number;
  readonly endDistance: number;
}

export interface ExpandedPathSplit {
  readonly tail: SplitPath;
  readonly head: SplitPath;
  readonly totalDistance: number;
}

/** Splits an expanded surface path at a fraction of its accumulated distance. */
export function splitExpandedPath(
  points: readonly THREE.Vector3[],
  segmentFaces: readonly FaceId[],
  fraction: number,
): ExpandedPathSplit {
  const lengths = points
    .slice(1)
    .map((point, index) => point.distanceTo(points[index] ?? point));
  const totalDistance = lengths.reduce((total, length) => total + length, 0);
  const target = Math.min(1, Math.max(0, fraction)) * totalDistance;
  if (points.length < 2 || totalDistance === 0) {
    const point = points[0]?.clone() ?? new THREE.Vector3();
    return {
      tail: {
        points: [point],
        segmentFaces: [],
        startDistance: 0,
        endDistance: 0,
      },
      head: {
        points: [point.clone()],
        segmentFaces: [],
        startDistance: 0,
        endDistance: 0,
      },
      totalDistance,
    };
  }

  let travelled = 0;
  let splitIndex = 0;
  let splitAlong = 0;
  let midpoint = points[0]?.clone() ?? new THREE.Vector3();
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    if (travelled + length >= target) {
      const along = length === 0 ? 0 : (target - travelled) / length;
      midpoint = start.clone().lerp(end, along);
      splitIndex = index;
      splitAlong = along;
      break;
    }
    travelled += length;
  }

  const atStart = Math.abs(splitAlong) < 1e-9;
  const atEnd = Math.abs(splitAlong - 1) < 1e-9;
  const vertexIndex = atEnd ? splitIndex + 1 : splitIndex;
  const tailPoints =
    atStart || atEnd
      ? points.slice(0, vertexIndex + 1).map((point) => point.clone())
      : [
          ...points.slice(0, splitIndex + 1).map((point) => point.clone()),
          midpoint.clone(),
        ];
  const headPoints =
    atStart || atEnd
      ? points.slice(vertexIndex).map((point) => point.clone())
      : [
          midpoint.clone(),
          ...points.slice(splitIndex + 1).map((point) => point.clone()),
        ];
  const headFaceIndex = atStart || atEnd ? vertexIndex : splitIndex;
  return {
    tail: {
      points: tailPoints,
      segmentFaces: segmentFaces.slice(0, tailPoints.length - 1),
      startDistance: 0,
      endDistance: target,
    },
    head: {
      points: headPoints,
      segmentFaces: segmentFaces.slice(
        headFaceIndex,
        headFaceIndex + headPoints.length - 1,
      ),
      startDistance: target,
      endDistance: totalDistance,
    },
    totalDistance,
  };
}
