import * as THREE from "three";

import { spotStates } from "../core/directionals";
import { overlappingArrowIds } from "../core/overlap";
import {
  advanceWithPortals,
  isPortalLink,
  type PortalSource,
} from "../core/wormholes";
import type { PickCandidate } from "../pick";
import { splitExpandedPath } from "./ribbon-geometry";
import { failurePositionKey, settledPathOf } from "../core/stops";
import {
  cellKey,
  cellToWorld,
  faceHeadingVector,
  faceNormal,
} from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  DirectionalSpotDefinition,
  GameState,
  FaceId,
  Heading,
  LevelDefinition,
  MoveResult,
  MoveTarget,
} from "../core/types";

const PICK_RADIUS = 0.14;
const PICK_LAYER = 1;
const FACING_EPSILON = 0.04;
const WRAPPING_EDGE_RADIUS = 0.007;
const STOP_CIRCLE_RADIUS = 0.34;
const STOP_CIRCLE_THICKNESS = 0.1;
const DIRECTIONAL_CHEVRON_SPAN = 0.24;
const DIRECTIONAL_CHEVRON_DEPTH = 0.16;
const DIRECTIONAL_CHEVRON_BAND = 0.08;
const ROTOR_RING_RADIUS = 0.4;
const ROTOR_RING_THICKNESS = 0.07;
/** Half of each rotor ring arc; the arcs center on the diagonals, so a notch marks each heading. */
const ROTOR_ARC_HALF_SPAN = (Math.PI / 180) * 34;
const GRID_LINE_OFFSET = 0.004;
/** Half the side of a hole's square cavity, and its border frame, per pitch. */
const HOLE_HALF = 0.34;
const HOLE_FRAME = 0.1;
/** How far a hole's floor sits below the face, per pitch. */
const HOLE_DEPTH = 0.45;
/** How far a falling head sinks below the face, per pitch, before it vanishes. */
const FALL_DEPTH = 1.2;
const CUBE_FACES: readonly FaceId[] = [
  "front",
  "back",
  "left",
  "right",
  "top",
  "bottom",
];

export type Theme = "light" | "dark";

interface ThemePalette {
  readonly background: number;
  readonly cube: number;
  readonly edges: number;
  readonly grid: number;
  readonly arrow: number;
  readonly failed: number;
  readonly selected: number;
  readonly nudge: number;
  readonly farSide: number;
  readonly stop: number;
  readonly directional: number;
  readonly flip: number;
  readonly rotor: number;
  /** A fragile cell's crack glyph. */
  readonly fragile: number;
  /** A collapsed cell: its border frame and its recessed cavity. */
  readonly hole: { readonly rim: number; readonly cavity: number };
  readonly wormhole: readonly [number, number];
  /** Side-marker colors, indexed by `wormholeDotColorIndex`. */
  readonly wormholeDots: readonly [number, number, number, number];
  readonly doubleTail: number;
  readonly doubleHead: number;
}

interface HintFocus {
  readonly target: MoveTarget;
  readonly fromOrientation: THREE.Quaternion;
  readonly targetOrientation: THREE.Quaternion;
  readonly fromDistance: number;
}

export const THEME_PALETTES: Readonly<Record<Theme, ThemePalette>> = {
  light: {
    background: 0xe9f4f7,
    cube: 0xfffcf4,
    edges: 0xa9c5ce,
    grid: 0x6f9baa,
    arrow: 0x0b1015,
    failed: 0xd94841,
    selected: 0x108acb,
    nudge: 0xd07a00,
    farSide: 0x6f9fb2,
    stop: 0x1d9a86,
    directional: 0x0f7fa8,
    flip: 0xc0266d,
    rotor: 0x8f6f1a,
    fragile: 0x6b5b4b,
    hole: { rim: 0x3b2f2a, cavity: 0x17110e },
    wormhole: [0xe07a10, 0x1f3fbf],
    wormholeDots: [0xe11d48, 0xeab308, 0x0d9488, 0x7c3aed],
    doubleTail: 0x6d28d9,
    doubleHead: 0x4d7c0f,
  },
  dark: {
    background: 0x101820,
    cube: 0x253641,
    edges: 0x597784,
    grid: 0x6f8f9d,
    arrow: 0xf7f0dc,
    failed: 0xff776c,
    selected: 0x54d6ee,
    nudge: 0xffd24d,
    farSide: 0x516a7a,
    stop: 0x3fe0c0,
    directional: 0x3ac8f0,
    flip: 0xff6fb5,
    rotor: 0xc9a24a,
    fragile: 0xb8a48c,
    hole: { rim: 0xe6d5bd, cavity: 0x05080b },
    wormhole: [0xffa040, 0x4f6bff],
    wormholeDots: [0xfb7185, 0xfde047, 0x2dd4bf, 0xa78bfa],
    doubleTail: 0xc084fc,
    doubleHead: 0xa3e635,
  },
};

const DOT_SIDES: readonly Heading[] = ["north", "east", "south", "west"];

/**
 * Palette index of the direction dot on one side of a wormhole end. End b's
 * pattern is end a's turned half a revolution, so a head crossing a dot on
 * either end leaves the partner across the dot of the same color.
 */
export function wormholeDotColorIndex(side: Heading, end: "a" | "b"): number {
  const index = DOT_SIDES.indexOf(side);
  return end === "a" ? index : (index + 2) % 4;
}

const FLIP_TURN_WINDOW = 0.12;

/**
 * How far (0..1) a flip or rotor glyph has turned through one advance at
 * `travel` along a move whose world-space `distance` is measured like
 * `motionDistance` (one cell is 2 / gridSize), for an advance reported in
 * `spotFlips` after `step` head cell steps. Step 0 fires as the body slides
 * out after the head has left the cube.
 */
export function flipTurnProgress(
  step: number,
  gridSize: number,
  distance: number,
  travel: number,
): number {
  const at =
    step === 0 || distance <= 0
      ? 1
      : Math.min(1, (step * 2) / gridSize / distance);
  return Math.min(1, Math.max(0, (travel - at) / FLIP_TURN_WINDOW));
}

/**
 * The in-plane angle, about the face's outward normal, of one advance of a
 * stateful spot's glyph: half a turn for a flip, and a quarter turn for a
 * rotor, negative because face-local north turns to east clockwise when seen
 * from outside the cube.
 */
export function spotTurnAngle(kind: DirectionalSpotDefinition["kind"]): number {
  return kind === "rotor" ? -Math.PI / 2 : Math.PI;
}

export function arrowDimensions(
  gridSize: number,
  arrowScale = 1,
): {
  readonly ribbonWidth: number;
  readonly headLength: number;
} {
  const displayPitch = (2 / gridSize) * arrowScale;
  return {
    ribbonWidth: displayPitch * 0.15 * 1.2,
    headLength: displayPitch * 0.35,
  };
}

interface SegmentVisual {
  readonly ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly picker: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
  readonly failure: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  endpoint: MoveTarget["endpoint"];
  face: Cell["face"] | undefined;
}

interface ArrowVisual {
  readonly arrow: ArrowDefinition;
  readonly group: THREE.Group;
  readonly segments: readonly SegmentVisual[];
  readonly head: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly tailHead?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
  readonly tailMaterial?: THREE.MeshBasicMaterial;
  readonly headFailure: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  readonly tailFailure?: THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  readonly pickers: readonly THREE.Object3D[];
  path: ExpandedPath;
  /** Cell-key fingerprint of the settled path currently laid out. */
  settledKey: string;
  readonly ribbonWidth: number;
  readonly headLength: number;
}

export interface ProjectedArrow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface CameraDiagnostics {
  readonly orientation: readonly [number, number, number, number];
  readonly position: readonly [number, number, number];
  readonly distance: number;
  readonly cubeScreenBounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

const INITIAL_CAMERA_ORIENTATION = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-0.43, -0.72, 0, "YXZ"),
);

/** Screen-space gap between a point and a finite line segment. */
function distanceToSegment(
  point: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3,
): number {
  const axis = end.clone().sub(start);
  const lengthSquared = axis.lengthSq();
  const along =
    lengthSquared > 0
      ? clamp(point.clone().sub(start).dot(axis) / lengthSquared, 0, 1)
      : 0;
  return start.clone().addScaledVector(axis, along).distanceTo(point);
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function cellPoint(cell: Cell, gridSize: number): THREE.Vector3 {
  const [x, y, z] = cellToWorld(cell, gridSize);
  return new THREE.Vector3(x, y, z);
}

function seamPoint(
  first: THREE.Vector3,
  second: THREE.Vector3,
  firstFace: Cell["face"],
  secondFace: Cell["face"],
): THREE.Vector3 {
  const firstNormal = faceNormal(firstFace);
  const secondNormal = faceNormal(secondFace);
  const edge = new THREE.Vector3();
  for (const [index, axis] of ["x", "y", "z"].entries()) {
    const firstComponent = firstNormal[index] ?? 0;
    const secondComponent = secondNormal[index] ?? 0;
    edge[axis as "x" | "y" | "z"] =
      firstComponent !== 0 || secondComponent !== 0
        ? firstComponent + secondComponent
        : (first[axis as "x" | "y" | "z"] + second[axis as "x" | "y" | "z"]) /
          2;
  }
  return edge;
}

export interface ExpandedPath {
  readonly points: readonly THREE.Vector3[];
  readonly segmentFaces: readonly Cell["face"][];
  readonly gaps?: readonly boolean[];
}

export interface WrappingEdgeSegment {
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly faceNormals: readonly [THREE.Vector3, THREE.Vector3];
}

export function wrappingEdgeOpacity(
  edge: WrappingEdgeSegment,
  cameraPosition: THREE.Vector3,
): number {
  return edge.faceNormals.some((normal) => normal.dot(cameraPosition) >= 1)
    ? 1
    : 0.32;
}

/** Dims a stop circle whose face turns away from the camera, like arrows. */
export function stopCircleOpacity(
  faceNormal: THREE.Vector3,
  position: THREE.Vector3,
  cameraPosition: THREE.Vector3,
): number {
  return faceNormal.dot(cameraPosition.clone().sub(position)) > 0 ? 1 : 0.32;
}

/**
 * The in-plane rotation that aims a spot's local +Y along its heading once the
 * +Z-to-face-normal quaternion is applied.
 */
function inPlaneHeadingAngle(
  face: FaceId,
  heading: Heading,
  quaternion: THREE.Quaternion,
): number {
  const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const headingVector = new THREE.Vector3(...faceHeadingVector(face, heading));
  const [nx, ny, nz] = faceNormal(face);
  const normal = new THREE.Vector3(nx, ny, nz);
  return Math.atan2(
    normal.dot(new THREE.Vector3().crossVectors(localUp, headingVector)),
    localUp.dot(headingVector),
  );
}

/** Returns one world-space segment for each continued physical cube edge. */
export function wrappingEdgeSegments(
  level: LevelDefinition,
): readonly WrappingEdgeSegment[] {
  const segments = new Map<string, WrappingEdgeSegment>();
  for (const policy of level.edgePolicies ?? []) {
    if (policy.policy !== "continue") continue;
    const [nx, ny, nz] = faceNormal(policy.face);
    const [ex, ey, ez] = faceHeadingVector(policy.face, policy.edge);
    const normal = new THREE.Vector3(nx, ny, nz);
    const outward = new THREE.Vector3(ex, ey, ez);
    const along = normal.clone().cross(outward).normalize();
    const offset = normal
      .clone()
      .add(outward)
      .normalize()
      .multiplyScalar(0.006);
    const start = normal.clone().add(outward).sub(along).add(offset);
    const end = normal.clone().add(outward).add(along).add(offset);
    const pointKey = (point: THREE.Vector3): string =>
      point
        .toArray()
        .map((value) => value.toFixed(4))
        .join(",");
    const key = [pointKey(start), pointKey(end)].sort().join("|");
    if (!segments.has(key))
      segments.set(key, { start, end, faceNormals: [normal, outward] });
  }
  return [...segments.values()];
}

interface RibbonSlice extends ExpandedPath {
  readonly headFace: Cell["face"] | undefined;
}

function makeRibbonGeometry(vertexCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3),
  );
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  return geometry;
}

function makeHeadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(9), 3),
  );
  return geometry;
}

export interface RibbonCrossSection {
  readonly left: THREE.Vector3;
  readonly right: THREE.Vector3;
}

interface SegmentCrossSections {
  start: RibbonCrossSection;
  end: RibbonCrossSection;
  /** Extra normal offset of a segment that folds over earlier ribbon. */
  lift?: number;
}

/**
 * Normal offset per self-overlap layer. A 24-bit depth buffer with the
 * camera's 0.1 near plane resolves about 2.5e-4 world units at distance 20,
 * and the arrowhead sits only 0.001 above its ribbon.
 */
export const SELF_OVERLAP_LIFT = 0.0015;

function segmentOverlaps(
  start: THREE.Vector3,
  end: THREE.Vector3,
  startArc: number,
  otherStart: THREE.Vector3,
  otherEnd: THREE.Vector3,
  otherStartArc: number,
  width: number,
): boolean {
  const length = start.distanceTo(end);
  const other = otherEnd.clone().sub(otherStart);
  const otherLength = other.length();
  const samples = Math.max(2, Math.ceil(length / (width / 2)) + 1);
  const point = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const relative = new THREE.Vector3();
  for (let sample = 0; sample < samples; sample += 1) {
    const t = (sample / (samples - 1)) * length;
    point.copy(start).lerp(end, length === 0 ? 0 : t / length);
    const s =
      otherLength === 0
        ? 0
        : THREE.MathUtils.clamp(
            relative.copy(point).sub(otherStart).dot(other) / otherLength,
            0,
            otherLength,
          );
    closest
      .copy(otherStart)
      .lerp(otherEnd, otherLength === 0 ? 0 : s / otherLength);
    const distance = point.distanceTo(closest);
    const gap = startArc + t - (otherStartArc + s);
    // Along a straight run or a mitered turn the arc gap never exceeds
    // sqrt(2) times the chord, so only a fold or crossing passes this; the
    // width margin ignores sub-width slice artifacts next to a corner.
    if (distance < width * 0.95 && gap > distance * 1.5 + width * 0.25)
      return true;
  }
  return false;
}

/** Monotone overlap layer per segment, rising toward the last segment. */
export function selfOverlapLayers(
  points: readonly THREE.Vector3[],
  segmentFaces: readonly Cell["face"][],
  width: number,
): readonly number[] {
  const layers: number[] = [];
  const arcs: number[] = [];
  let arc = 0;
  for (let index = 0; index < segmentFaces.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const face = segmentFaces[index];
    arcs.push(arc);
    if (!start || !end || !face) {
      layers.push(layers.at(-1) ?? 0);
      continue;
    }
    let layer = layers.at(-1) ?? 0;
    const reach = start.distanceTo(end) + width;
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (segmentFaces[earlier] !== face) continue;
      const earlierLayer = layers[earlier] ?? 0;
      if (earlierLayer + 1 <= layer) continue;
      const otherStart = points[earlier];
      const otherEnd = points[earlier + 1];
      if (!otherStart || !otherEnd) continue;
      if (
        start.distanceTo(otherStart) >
        reach + otherStart.distanceTo(otherEnd)
      )
        continue;
      if (
        segmentOverlaps(
          start,
          end,
          arc,
          otherStart,
          otherEnd,
          arcs[earlier] ?? 0,
          width,
        )
      )
        layer = earlierLayer + 1;
    }
    layers.push(layer);
    arc += start.distanceTo(end);
  }
  return layers;
}

function liftedSection(
  section: RibbonCrossSection,
  lift: THREE.Vector3,
): RibbonCrossSection {
  return {
    left: section.left.clone().add(lift),
    right: section.right.clone().add(lift),
  };
}

function liftOverlaps(
  sections: readonly SegmentCrossSections[],
  segmentFaces: readonly Cell["face"][],
  layers: readonly number[],
): readonly SegmentCrossSections[] {
  return sections.map((section, index) => {
    const layer = layers[index] ?? 0;
    const face = segmentFaces[index];
    if (layer === 0 || !face) return { ...section };
    const lift = layer * SELF_OVERLAP_LIFT;
    const normal = new THREE.Vector3(...faceNormal(face));
    const offsetAt = (neighbor: Cell["face"] | undefined): THREE.Vector3 => {
      const offset = normal.clone().multiplyScalar(lift);
      // A seam corner lies on both lifted planes and must stay on both.
      if (neighbor && neighbor !== face)
        offset.addScaledVector(
          new THREE.Vector3(...faceNormal(neighbor)),
          lift,
        );
      return offset;
    };
    return {
      start: liftedSection(section.start, offsetAt(segmentFaces[index - 1])),
      end: liftedSection(section.end, offsetAt(segmentFaces[index + 1])),
      lift,
    };
  });
}

function crossSection(
  point: THREE.Vector3,
  normal: THREE.Vector3,
  tangent: THREE.Vector3,
  width: number,
): RibbonCrossSection {
  const side = normal
    .clone()
    .cross(tangent)
    .normalize()
    .multiplyScalar(width / 2);
  const offset = normal.clone().multiplyScalar(0.004);
  return {
    left: point.clone().sub(side).add(offset),
    right: point.clone().add(side).add(offset),
  };
}

/**
 * Joins same-face turns and lifted cube folds with shared cross-sections.
 * Ribbon that folds back over itself is layered so the moving end, the last
 * segment unless `risesTowardStart`, draws on top.
 */
export function ribbonSections(
  points: readonly THREE.Vector3[],
  segmentFaces: readonly Cell["face"][],
  width: number,
  risesTowardStart = false,
  gaps: readonly boolean[] = [],
): readonly SegmentCrossSections[] {
  const sections: SegmentCrossSections[] = [];
  for (let index = 0; index < segmentFaces.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const face = segmentFaces[index];
    if (!start || !end || !face || gaps[index]) continue;
    const [nx, ny, nz] = faceNormal(face);
    const normal = new THREE.Vector3(nx, ny, nz);
    const tangent = end.clone().sub(start);
    if (tangent.lengthSq() === 0) {
      tangent.copy(
        normal
          .clone()
          .cross(
            Math.abs(normal.y) < 0.9
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(1, 0, 0),
          )
          .normalize(),
      );
    } else {
      tangent.normalize();
    }
    sections[index] = {
      start: crossSection(start, normal, tangent, width),
      end: crossSection(end, normal, tangent, width),
    };
  }
  for (let index = 1; index < sections.length; index += 1) {
    const previousFace = segmentFaces[index - 1];
    const nextFace = segmentFaces[index];
    const joint = points[index];
    const previousStart = points[index - 1];
    const nextEnd = points[index + 1];
    if (
      gaps[index - 1] ||
      gaps[index] ||
      !previousFace ||
      !nextFace ||
      !joint ||
      !previousStart ||
      !nextEnd
    )
      continue;
    if (previousFace !== nextFace) {
      const previous = sections[index - 1];
      const next = sections[index];
      if (!previous || !next) continue;
      const previousNormal = new THREE.Vector3(...faceNormal(previousFace));
      const nextNormal = new THREE.Vector3(...faceNormal(nextFace));
      const side = previousNormal
        .clone()
        .cross(nextNormal)
        .multiplyScalar(width / 2);
      // Both lifted face planes must meet at the same physical corner.
      const center = joint
        .clone()
        .addScaledVector(previousNormal, 0.004)
        .addScaledVector(nextNormal, 0.004);
      const shared: RibbonCrossSection = {
        left: center.clone().sub(side),
        right: center.clone().add(side),
      };
      previous.end = shared;
      next.start = shared;
      continue;
    }
    const [nx, ny, nz] = faceNormal(previousFace);
    const normal = new THREE.Vector3(nx, ny, nz);
    const incoming = joint.clone().sub(previousStart).normalize();
    const outgoing = nextEnd.clone().sub(joint).normalize();
    if (incoming.lengthSq() < 1e-10 || outgoing.lengthSq() < 1e-10) continue;
    const incomingSide = normal.clone().cross(incoming).normalize();
    const outgoingSide = normal.clone().cross(outgoing).normalize();
    const bisector = incomingSide.clone().add(outgoingSide);
    if (bisector.lengthSq() < 1e-8) continue;
    bisector.normalize();
    const denominator = bisector.dot(outgoingSide);
    if (Math.abs(denominator) < 0.25) continue;
    const miterLength = width / 2 / denominator;
    if (!Number.isFinite(miterLength) || Math.abs(miterLength) > width * 2)
      continue;
    const miter = bisector.multiplyScalar(miterLength);
    const offset = normal.multiplyScalar(0.004);
    const shared: RibbonCrossSection = {
      left: joint.clone().sub(miter).add(offset),
      right: joint.clone().add(miter).add(offset),
    };
    const previous = sections[index - 1];
    const next = sections[index];
    if (previous && next) {
      previous.end = shared;
      next.start = shared;
    }
  }
  if (gaps.some(Boolean)) {
    // Overlap lifting is local to each contiguous ribbon, never across a jump.
    for (let start = 0; start < segmentFaces.length; ) {
      while (gaps[start] && start < segmentFaces.length) start += 1;
      let end = start;
      while (end < segmentFaces.length && !gaps[end]) end += 1;
      if (end > start) {
        const run = ribbonSections(
          points.slice(start, end + 1),
          segmentFaces.slice(start, end),
          width,
          risesTowardStart,
        );
        sections.splice(start, run.length, ...run);
      }
      start = end + 1;
    }
    return sections;
  }
  const layers = risesTowardStart
    ? [
        ...selfOverlapLayers(
          [...points].reverse(),
          [...segmentFaces].reverse(),
          width,
        ),
      ].reverse()
    : selfOverlapLayers(points, segmentFaces, width);
  // Unfolded paths keep their exact vertices, including signed zeros.
  if (layers.every((layer) => layer === 0)) return sections;
  return liftOverlaps(sections, segmentFaces, layers);
}

/** Returns a face-parallel ribbon quad, suitable for geometry buffer updates. */
export function ribbonVertices(
  start: THREE.Vector3,
  end: THREE.Vector3,
  normal: THREE.Vector3,
  width: number,
  startSection?: RibbonCrossSection,
  endSection?: RibbonCrossSection,
): Float32Array {
  const tangent = end.clone().sub(start).normalize();
  const side = normal
    .clone()
    .cross(tangent)
    .normalize()
    .multiplyScalar(width / 2);
  const offset = normal.clone().multiplyScalar(0.004);
  const corners = [
    startSection?.left ?? start.clone().sub(side).add(offset),
    startSection?.right ?? start.clone().add(side).add(offset),
    endSection?.left ?? end.clone().sub(side).add(offset),
    endSection?.right ?? end.clone().add(side).add(offset),
  ];
  return new Float32Array(
    corners.flatMap((point) => [point.x, point.y, point.z]),
  );
}

export function pathLength(path: ExpandedPath): number {
  let length = 0;
  for (let index = 1; index < path.points.length; index += 1) {
    if (path.gaps?.[index - 1]) continue;
    length +=
      path.points[index - 1]?.distanceTo(
        path.points[index] ?? new THREE.Vector3(),
      ) ?? 0;
  }
  return length;
}

export function slicePath(
  path: ExpandedPath,
  offset: number,
  length: number,
): RibbonSlice {
  const points: THREE.Vector3[] = [];
  const segmentFaces: Cell["face"][] = [];
  const gaps: boolean[] = [];
  let walked = 0;
  const endOffset = offset + length;
  for (let index = 0; index < path.segmentFaces.length; index += 1) {
    const start = path.points[index];
    const end = path.points[index + 1];
    const face = path.segmentFaces[index];
    if (!start || !end || !face) continue;
    const gap = path.gaps?.[index] ?? false;
    const segmentLength = gap ? 0 : start.distanceTo(end);
    const segmentStart = walked;
    const segmentEnd = walked + segmentLength;
    const from = Math.max(offset, segmentStart);
    const to = Math.min(endOffset, segmentEnd);
    if (
      to > from ||
      (segmentLength === 0 &&
        from === to &&
        from >= offset &&
        from <= endOffset)
    ) {
      const at = (distance: number): THREE.Vector3 =>
        start
          .clone()
          .lerp(
            end,
            segmentLength === 0 ? 0 : (distance - segmentStart) / segmentLength,
          );
      const fromPoint = gap ? start.clone() : at(from);
      const toPoint = gap ? end.clone() : at(to);
      if (points.length === 0) points.push(fromPoint);
      points.push(toPoint);
      segmentFaces.push(face);
      gaps.push(gap);
    }
    walked = segmentEnd;
  }
  if (points.length !== segmentFaces.length + 1) {
    throw new Error(
      "Ribbon path slices must have exactly one more point than segment face.",
    );
  }
  return { points, segmentFaces, gaps, headFace: segmentFaces.at(-1) };
}

function reversePath(path: ExpandedPath): ExpandedPath {
  return {
    points: [...path.points].reverse(),
    segmentFaces: [...path.segmentFaces].reverse(),
    ...(path.gaps ? { gaps: [...path.gaps].reverse() } : {}),
  };
}

function concatPaths(first: ExpandedPath, second: ExpandedPath): ExpandedPath {
  return {
    points: [...first.points, ...second.points.slice(1)],
    segmentFaces: [...first.segmentFaces, ...second.segmentFaces],
    gaps: [
      ...(first.gaps ?? first.segmentFaces.map(() => false)),
      ...(second.gaps ?? second.segmentFaces.map(() => false)),
    ],
  };
}

export interface ArrowMotionTrack {
  readonly track: ExpandedPath;
  readonly bodyLength: number;
  /** Outbound surface and flight distance, or outbound distance for rebounds. */
  readonly distance: number;
}

export function arrowMotionTrack(
  path: ExpandedPath,
  result: MoveResult,
  gridSize: number,
  minimumDistance = 0,
  level?: PortalSource,
): ArrowMotionTrack {
  const route = expandedPoints(result.route, gridSize, level);
  const orientedPath = result.endpoint === "tail" ? reversePath(path) : path;
  const bodyLength = pathLength(orientedPath);
  let track = concatPaths(orientedPath, route);
  if (result.kind === "exit") {
    const tail = track.points.at(-1) ?? new THREE.Vector3();
    const lastFace =
      track.segmentFaces.at(-1) ?? result.route.at(-1)?.face ?? "front";
    const tangent = new THREE.Vector3(0, 0, 1);
    const flightPoints = [tail];
    if (result.exit) {
      const [x, y, z] = result.exit.edgePoint;
      const [tx, ty, tz] = result.exit.tangent;
      const edge = new THREE.Vector3(x, y, z);
      tangent.set(tx, ty, tz).normalize();
      flightPoints.push(
        edge,
        edge
          .clone()
          .addScaledVector(tangent, Math.max(bodyLength + 2, minimumDistance)),
      );
    } else {
      flightPoints.push(tail.clone().addScaledVector(tangent, bodyLength + 2));
    }
    track = concatPaths(track, {
      points: flightPoints,
      segmentFaces: Array.from(
        { length: flightPoints.length - 1 },
        () => lastFace,
      ),
    });
  }
  if (result.kind === "fall" && result.hole) {
    // The head reaches the hole's center, then turns inward along the face
    // normal and sinks into the cube, the body following it down.
    const center = cellPoint(result.hole, gridSize);
    const inward = new THREE.Vector3(...faceNormal(result.hole.face)).negate();
    const depth = Math.max(
      bodyLength + (FALL_DEPTH * 2) / gridSize,
      minimumDistance - (pathLength(track) - bodyLength),
    );
    track = concatPaths(track, {
      points: [center, center.clone().addScaledVector(inward, depth)],
      segmentFaces: [result.hole.face],
    });
  }
  const distance =
    result.kind === "exit" || result.kind === "fall"
      ? pathLength(track) - bodyLength
      : result.kind === "blocked"
        ? Math.max(0, pathLength(route) - 1 / gridSize)
        : // A pause travels the whole route and stays parked on the circle.
          result.kind === "paused"
          ? pathLength(route)
          : 0;
  return { track, bodyLength, distance };
}

const NORMAL_ARROW_SPEED = 5;
const REDUCED_MOTION_DURATION = 110 / 1.5625;
const PAUSE_MINIMUM_DURATION = 160;

export function arrowMotionDuration(
  distance: number,
  kind: MoveResult["kind"],
  reducedMotion = false,
): number {
  if (reducedMotion) return REDUCED_MOTION_DURATION;
  const outboundAndReturn = kind === "blocked" ? 2 : 1;
  const travel = (distance * outboundAndReturn * 1000) / NORMAL_ARROW_SPEED;
  // Cells are small on a dense cube, so a one-step park would otherwise finish
  // inside a frame and read as a jump rather than as stopping at the circle.
  return kind === "paused" ? Math.max(travel, PAUSE_MINIMUM_DURATION) : travel;
}

function arrowFace(arrow: ArrowDefinition): Cell["face"] {
  return arrow.path.at(-1)?.face ?? "front";
}

export function expandedPoints(
  cells: readonly Cell[],
  gridSize: number,
  level?: PortalSource,
): ExpandedPath {
  const first = cells[0];
  if (!first) {
    return { points: [], segmentFaces: [] };
  }
  const points: THREE.Vector3[] = [cellPoint(first, gridSize)];
  const segmentFaces: Cell["face"][] = [];
  const gaps: boolean[] = [];
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1];
    const current = cells[index];
    if (!previous || !current) {
      continue;
    }
    const previousPoint = cellPoint(previous, gridSize);
    const currentPoint = cellPoint(current, gridSize);
    if (level && isPortalLink(level, previous, current)) {
      const heading = ["north", "south", "east", "west"] as const;
      const entry = heading
        .map((direction) => advanceWithPortals(level, previous, direction))
        .find(
          (step) =>
            step.portal &&
            step.next &&
            step.next.face === current.face &&
            step.next.x === current.x &&
            step.next.y === current.y,
        )?.portal;
      if (!entry) throw new Error("Portal link has no entry cell");
      const entryPoint = cellPoint(entry, gridSize);
      if (entry.face !== previous.face) {
        points.push(
          seamPoint(previousPoint, entryPoint, previous.face, entry.face),
        );
        segmentFaces.push(previous.face);
        gaps.push(false);
      }
      points.push(entryPoint, currentPoint);
      segmentFaces.push(entry.face, current.face);
      gaps.push(false, true);
      continue;
    }
    if (previous.face !== current.face) {
      points.push(
        seamPoint(previousPoint, currentPoint, previous.face, current.face),
      );
      segmentFaces.push(previous.face);
      gaps.push(false);
    } else {
      segmentFaces.push(previous.face);
      gaps.push(false);
    }
    points.push(currentPoint);
    if (previous.face !== current.face) {
      segmentFaces.push(current.face);
      gaps.push(false);
    }
  }
  return { points, segmentFaces, gaps };
}

function disposeTree(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.Material | THREE.Material[]
    >;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      material?.dispose();
    }
  });
}

export class PuzzleRenderer {
  readonly canvas: HTMLCanvasElement;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly cubeGroup = new THREE.Group();
  private readonly gridLinesGroup = new THREE.Group();
  private readonly wrappingEdgesGroup = new THREE.Group();
  private readonly stopCirclesGroup = new THREE.Group();
  private readonly directionalsGroup = new THREE.Group();
  private readonly wormholesGroup = new THREE.Group();
  private readonly fragileGroup = new THREE.Group();
  /** Settled advance count of each flip or rotor glyph, keyed by cell. */
  private readonly flipTurns = new Map<string, number>();
  private flipMotion = false;
  private readonly arrowsGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly pickers: THREE.Object3D[] = [];
  private readonly visuals = new Map<string, ArrowVisual>();
  private cubeMaterial: THREE.MeshStandardMaterial | undefined;
  private edgeMaterial: THREE.LineBasicMaterial | undefined;
  private gridLineMaterial: THREE.LineBasicMaterial | undefined;
  private gridLinesEnabled = false;
  private theme: Theme = "light";
  private level: LevelDefinition | undefined;
  private state: GameState | undefined;
  private selectedTarget: MoveTarget | undefined;
  private hintFocus: HintFocus | undefined;
  private hintLit = false;
  private tutorialHighlightTarget: MoveTarget | undefined;
  private tutorialNudge = false;
  private readonly orientation = INITIAL_CAMERA_ORIENTATION.clone();
  private distance = 7.5;
  private fitDistance = 7.5;
  private hasFitted = false;

  constructor(container: HTMLElement) {
    // The stencil buffer masks each hole's cavity to its opening.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: true,
    });
    this.raycaster.layers.set(PICK_LAYER);
    this.canvas = this.renderer.domElement;
    this.canvas.className = "game-canvas";
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        /iPhone|iPad|Android/i.test(navigator.userAgent) ? 1.5 : 2,
      ),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.canvas);

    this.scene.add(this.cubeGroup, this.arrowsGroup);
    this.cubeGroup.add(
      this.gridLinesGroup,
      this.wrappingEdgesGroup,
      this.stopCirclesGroup,
      this.directionalsGroup,
      this.wormholesGroup,
      this.fragileGroup,
    );
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb7d5df, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xf7fbff, 1.4));
    this.createCube();
    this.setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
    this.resize();
    window.addEventListener("resize", () => this.resize());
    // iOS fires window resize before the rotated layout is committed and never
    // fires a second one, so the element's own box must drive the resize too.
    new ResizeObserver(() => this.resize()).observe(container);
    // three.js re-initializes its GL state on webglcontextrestored, but
    // rendering is on-demand: without this repaint a restored context stays
    // blank until the next interaction.
    this.canvas.addEventListener("webglcontextrestored", () => this.render());
  }

  setLevel(level: LevelDefinition, state: GameState): void {
    this.clearHint();
    this.tutorialHighlightTarget = undefined;
    this.clearArrows();
    this.clearWrappingEdges();
    this.clearStopCircles();
    this.clearDirectionals();
    this.clearWormholes();
    this.clearFragile();
    this.flipMotion = false;
    this.level = level;
    this.state = state;
    this.createGridLines(level.gridSize);
    this.createWrappingEdges(level);
    this.createStopCircles(level);
    this.createDirectionals(level);
    this.createWormholes(level);
    this.createFragile(level);
    for (const arrow of level.arrows) {
      const visual = this.createArrow(arrow, level.gridSize, level.arrowScale);
      this.visuals.set(arrow.id, visual);
      this.arrowsGroup.add(visual.group);
      this.pickers.push(...visual.pickers);
      this.pickers.push(visual.head);
      if (visual.tailHead) this.pickers.push(visual.tailHead);
    }
    this.updateState(state);
    this.render();
  }

  updateState(state: GameState): void {
    this.state = state;
    this.refreshSettledPaths(state);
    if (!this.flipMotion) {
      this.setSpotHeadings(state.spotHeadings);
      this.setCollapsed(state.collapsed);
    }
    for (const [id, visual] of this.visuals) {
      visual.group.visible = state.remainingIds.includes(id);
    }
    this.render();
  }

  setSelected(target: MoveTarget | undefined): void {
    this.selectedTarget = target;
    this.render();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    const palette = this.palette;
    this.renderer.setClearColor(palette.background, 1);
    this.cubeMaterial?.color.set(palette.cube);
    this.edgeMaterial?.color.set(palette.edges);
    if (this.gridLineMaterial) {
      this.gridLineMaterial.color.set(palette.grid);
      this.gridLineMaterial.opacity = theme === "light" ? 0.52 : 0.6;
    }
    this.wrappingEdgesGroup.traverse((child) => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.color.set(theme === "light" ? 0xb77900 : 0xffd84a);
      }
    });
    this.stopCirclesGroup.traverse((child) => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.color.set(palette.stop);
      }
    });
    this.wormholesGroup.traverse((child) => {
      const mesh = child as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      if (!(mesh.material instanceof THREE.MeshBasicMaterial)) return;
      const dot = mesh.userData.dotIndex as number | undefined;
      mesh.material.color.set(
        dot === undefined
          ? palette.wormhole[mesh.userData.wormholeIndex as 0 | 1]
          : (palette.wormholeDots[dot] as number),
      );
    });
    this.fragileGroup.traverse((child) => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      if (!(mesh.material instanceof THREE.MeshBasicMaterial)) return;
      const part = mesh.userData.fragilePart as
        | "crack"
        | "rim"
        | "cavity"
        | undefined;
      if (part === "crack") mesh.material.color.set(palette.fragile);
      else if (part === "rim") mesh.material.color.set(palette.hole.rim);
      else if (part === "cavity") mesh.material.color.set(palette.hole.cavity);
    });
    this.directionalsGroup.traverse((child) => {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        const kind = mesh.userData.spotKind as
          | DirectionalSpotDefinition["kind"]
          | undefined;
        mesh.material.color.set(
          kind === "flip"
            ? palette.flip
            : kind === "rotor"
              ? palette.rotor
              : palette.directional,
        );
      }
    });
    this.render();
  }

  setGridLines(enabled: boolean): void {
    this.gridLinesEnabled = enabled;
    this.gridLinesGroup.visible = enabled;
    this.render();
  }

  visibleGridLineCount(): number {
    if (!this.gridLinesEnabled) return 0;
    return this.gridLinesGroup.children.reduce(
      (count, child) =>
        count +
        (child.visible
          ? ((child as THREE.LineSegments).geometry.getAttribute("position")
              .count ?? 0) / 2
          : 0),
      0,
    );
  }

  orbit(deltaX: number, deltaY: number): void {
    const angle = Math.hypot(deltaX, deltaY) * 0.012;
    if (angle === 0) return;
    const axis = new THREE.Vector3(-deltaY, -deltaX, 0).normalize();
    this.orientation
      .multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle))
      .normalize();
    this.render();
  }

  zoom(delta: number): void {
    this.distance = clamp(
      this.distance + delta * 0.006,
      this.fitDistance * 0.4,
      this.fitDistance * 1.7,
    );
    this.render();
  }

  resetView(): void {
    this.orientation.copy(INITIAL_CAMERA_ORIENTATION);
    this.distance = this.fitDistance;
    this.render();
  }

  private faceTargetOrientation(face: Cell["face"]): THREE.Quaternion {
    const [x, y, z] = faceNormal(face);
    const normal = new THREE.Vector3(x, y, z);
    const targetCamera = new THREE.PerspectiveCamera();
    targetCamera.position.copy(normal);
    targetCamera.up.set(
      0,
      Math.abs(normal.y) > 0.9 ? 0 : 1,
      Math.abs(normal.y) > 0.9 ? -1 : 0,
    );
    targetCamera.lookAt(0, 0, 0);
    return targetCamera.quaternion.clone();
  }

  private startFaceFocus(target: MoveTarget, face: Cell["face"]): void {
    this.hintFocus = {
      target,
      fromOrientation: this.orientation.clone(),
      targetOrientation: this.faceTargetOrientation(face),
      fromDistance: this.distance,
    };
    this.render();
  }

  /** Focuses the chosen arrow's actual head face, without changing game state. */
  beginHint(target: MoveTarget): boolean {
    const visual = this.visuals.get(target.arrowId);
    const hintedHead =
      target.endpoint === "tail" ? visual?.tailHead : visual?.head;
    const face = hintedHead?.userData.face as Cell["face"] | undefined;
    if (!visual || !face || !visual.group.visible) {
      return false;
    }
    this.hintLit = false;
    this.startFaceFocus(target, face);
    return true;
  }

  /**
   * Aims the camera at a tutorial highlight whose head face is hidden, so a
   * scripted step never asks for a tap on an arrow the player cannot see.
   * Returns false when the arrow is missing or already faces the camera.
   */
  focusArrow(target: MoveTarget): boolean {
    const visual = this.visuals.get(target.arrowId);
    const focusedHead =
      target.endpoint === "tail" ? visual?.tailHead : visual?.head;
    const face = focusedHead?.userData.face as Cell["face"] | undefined;
    if (
      !visual ||
      !face ||
      !focusedHead ||
      !visual.group.visible ||
      this.isFrontFacing(focusedHead)
    ) {
      return false;
    }
    this.startFaceFocus(target, face);
    return true;
  }

  animateHintFocus(progress: number): void {
    const hint = this.hintFocus;
    if (!hint) return;
    this.orientation
      .copy(hint.fromOrientation)
      .slerp(hint.targetOrientation, clamp(progress, 0, 1));
    this.distance = THREE.MathUtils.lerp(
      hint.fromDistance,
      this.fitDistance,
      clamp(progress, 0, 1),
    );
    this.render();
  }

  flashHint(on: boolean): void {
    if (!this.hintFocus) return;
    this.hintLit = on;
    this.render();
  }

  clearHint(): void {
    this.hintFocus = undefined;
    this.hintLit = false;
    this.render();
  }

  /** Sustains the tutorial's step highlight without moving the camera. */
  setTutorialHighlight(target: MoveTarget | undefined): void {
    if (
      this.tutorialHighlightTarget?.arrowId === target?.arrowId &&
      this.tutorialHighlightTarget?.endpoint === target?.endpoint
    )
      return;
    this.tutorialHighlightTarget = target;
    this.render();
  }

  /** Flashes the tutorial arrows after a tap the walkthrough rejects. */
  setTutorialNudge(active: boolean): void {
    if (this.tutorialNudge === active) return;
    this.tutorialNudge = active;
  }

  /**
   * Every arrow the pointer could plausibly mean, nearest first. Direct hits
   * report a zero gap; arrows merely close to the pointer report the screen
   * distance to their exposed ribbon or head. The margin is a fingertip in
   * CSS pixels, so every candidate it returns really did sit under the press.
   */
  pickCandidates(
    clientX: number,
    clientY: number,
    marginPx: number,
  ): readonly PickCandidate[] {
    if (this.state?.status !== "playing") {
      return [];
    }
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const direct: MoveTarget[] = [];
    for (const hit of this.raycaster.intersectObjects(
      this.pickers.filter((picker) => this.isPickable(picker)),
      false,
    )) {
      const id = hit.object.userData.arrowId as string | undefined;
      const endpoint = hit.object.userData.endpoint as
        | MoveTarget["endpoint"]
        | undefined;
      const face = hit.object.userData.face as Cell["face"] | undefined;
      if (
        !id ||
        !endpoint ||
        !face ||
        direct.some(
          (target) => target.arrowId === id && target.endpoint === endpoint,
        )
      )
        continue;
      const [nx, ny, nz] = faceNormal(face);
      if (
        new THREE.Vector3(nx, ny, nz).dot(
          this.camera.position.clone().sub(hit.point),
        ) > FACING_EPSILON
      ) {
        direct.push({ arrowId: id, endpoint });
      }
    }

    const pointer = new THREE.Vector3(
      clientX - bounds.left,
      clientY - bounds.top,
      0,
    );
    const nearby: PickCandidate[] = [];
    for (const [arrowId, visual] of this.visuals) {
      if (
        direct.some((target) => target.arrowId === arrowId) ||
        !visual.group.visible ||
        !this.state.remainingIds.includes(arrowId)
      )
        continue;
      const endpoints: readonly MoveTarget["endpoint"][] =
        visual.arrow.kind === "double" ? ["head", "tail"] : ["head"];
      for (const endpoint of endpoints) {
        const distancePx = this.screenDistanceToArrow(
          visual,
          endpoint,
          pointer,
          bounds,
        );
        if (distancePx !== undefined && distancePx <= marginPx) {
          nearby.push({ target: { arrowId, endpoint }, distancePx });
        }
      }
    }
    nearby.sort((a, b) => a.distancePx - b.distancePx);
    return [...direct.map((target) => ({ target, distancePx: 0 })), ...nearby];
  }

  private isPickable(object: THREE.Object3D): boolean {
    const id = object.userData.arrowId as string | undefined;
    return Boolean(
      object.visible &&
        object.parent?.visible &&
        id &&
        this.state?.remainingIds.includes(id),
    );
  }

  /** True when the cube face carrying this part turns toward the camera. */
  private isFrontFacing(object: THREE.Object3D): boolean {
    const face = object.userData.face as Cell["face"] | undefined;
    if (!face) return false;
    const [nx, ny, nz] = faceNormal(face);
    return (
      new THREE.Vector3(nx, ny, nz).dot(
        this.camera.position
          .clone()
          .sub(object.getWorldPosition(new THREE.Vector3())),
      ) > FACING_EPSILON
    );
  }

  private toScreen(
    worldPoint: THREE.Vector3,
    bounds: DOMRect,
  ): THREE.Vector3 | undefined {
    const projected = worldPoint.project(this.camera);
    if (
      !projected.toArray().every(Number.isFinite) ||
      projected.z < -1 ||
      projected.z > 1
    ) {
      return undefined;
    }
    return new THREE.Vector3(
      ((projected.x + 1) * bounds.width) / 2,
      ((1 - projected.y) * bounds.height) / 2,
      0,
    );
  }

  /** Nearest screen gap between the pointer and the arrow's exposed parts. */
  private screenDistanceToArrow(
    visual: ArrowVisual,
    endpoint: MoveTarget["endpoint"],
    pointer: THREE.Vector3,
    bounds: DOMRect,
  ): number | undefined {
    let nearest: number | undefined;
    const consider = (distance: number): void => {
      nearest = nearest === undefined ? distance : Math.min(nearest, distance);
    };
    const endpointHead = endpoint === "tail" ? visual.tailHead : visual.head;
    if (endpointHead?.visible && this.isFrontFacing(endpointHead)) {
      const positions = endpointHead.geometry.getAttribute("position");
      const [a, b, c] = [0, 1, 2].map((index) =>
        this.toScreen(
          endpointHead.localToWorld(
            new THREE.Vector3().fromBufferAttribute(positions, index),
          ),
          bounds,
        ),
      );
      if (a && b && c) {
        consider(
          new THREE.Triangle(a, b, c)
            .closestPointToPoint(pointer, new THREE.Vector3())
            .distanceTo(pointer),
        );
      }
    }
    for (const { picker, endpoint: segmentEndpoint } of visual.segments) {
      if (
        segmentEndpoint !== endpoint ||
        !picker.visible ||
        !this.isFrontFacing(picker)
      )
        continue;
      const start = this.toScreen(
        picker.localToWorld(new THREE.Vector3(0, -0.5, 0)),
        bounds,
      );
      const end = this.toScreen(
        picker.localToWorld(new THREE.Vector3(0, 0.5, 0)),
        bounds,
      );
      if (start && end) consider(distanceToSegment(pointer, start, end));
    }
    return nearest;
  }

  animate(arrowId: string, result: MoveResult, progress: number): void {
    if (!this.level) {
      return;
    }
    const travel =
      result.kind === "blocked"
        ? progress < 0.5
          ? progress * 2
          : (1 - progress) * 2
        : progress;
    const distance = this.motionDistance(arrowId, result);
    for (const member of result.members ?? [result]) {
      const visual = this.visuals.get(member.arrowId);
      if (!visual) continue;
      const { track, bodyLength } = arrowMotionTrack(
        visual.path,
        member,
        this.level.gridSize,
        distance,
        this.level,
      );
      const slice = slicePath(track, travel * distance, bodyLength);
      this.updatePathVisual(
        visual,
        member.endpoint === "tail"
          ? {
              ...reversePath(slice),
              headFace: slice.segmentFaces[0],
            }
          : slice,
        member.endpoint === "tail",
      );
    }
    this.flipMotion = progress < 1;
    this.animateFlips(result, distance, travel);
    this.animateCollapses(result, distance, travel);
    this.render();
  }

  /**
   * Show each fragile cell as its crack glyph or its hole. `collapse` maps a
   * cell to how far (0..1) it has sunk; a settled state passes whole holes.
   */
  private showFragile(collapse: ReadonlyMap<string, number>): void {
    for (const child of this.fragileGroup.children) {
      const key = child.userData.fragile as string;
      const sunk = collapse.get(key) ?? 0;
      child.userData.collapse = sunk;
      const crack = child.userData.crack as THREE.Object3D;
      const hole = child.userData.hole as THREE.Object3D;
      crack.visible = sunk < 1;
      hole.visible = sunk > 0;
      // The hole opens from the cell's center as the crack gives way.
      hole.scale.set(sunk, sunk, sunk);
    }
  }

  /** Snap every fragile cell to the settled collapse state. */
  setCollapsed(collapsed: readonly string[] | undefined): void {
    this.showFragile(new Map((collapsed ?? []).map((key) => [key, 1])));
  }

  private animateCollapses(
    result: MoveResult,
    distance: number,
    travel: number,
  ): void {
    const gridSize = this.level?.gridSize;
    if (gridSize === undefined || this.fragileGroup.children.length === 0)
      return;
    const collapse = new Map<string, number>(
      (this.state?.collapsed ?? []).map((key) => [key, 1]),
    );
    // During a move, `state` already holds the settled result, so cells this
    // move collapses restart from intact and sink at their share of travel.
    for (const member of result.members ?? [result]) {
      for (const entry of member.collapses ?? []) {
        collapse.set(
          cellKey(entry.cell),
          flipTurnProgress(entry.step, gridSize, distance, travel),
        );
      }
    }
    this.showFragile(collapse);
  }

  /** How far (0..1) each fragile cell's collapse currently shows, keyed by cell. */
  fragileCollapseProgress(): Record<string, number> {
    const shown: Record<string, number> = {};
    for (const child of this.fragileGroup.children) {
      shown[child.userData.fragile as string] =
        (child.userData.collapse as number | undefined) ?? 0;
    }
    return shown;
  }

  /** Snap every flip and rotor glyph to the settled spot state. */
  setSpotHeadings(
    headings: Readonly<Record<string, Heading>> | undefined,
  ): void {
    for (const child of this.directionalsGroup.children) {
      const key = child.userData.stateful as string | undefined;
      if (!key) continue;
      const spot = this.level?.directionals?.find(
        (entry) => cellKey(entry.cell) === key,
      );
      const current = headings?.[key];
      const turns =
        spot === undefined || current === undefined
          ? 0
          : Math.max(0, spotStates(spot).indexOf(current));
      this.flipTurns.set(key, turns);
      this.orientFlip(child, turns);
    }
  }

  private animateFlips(
    result: MoveResult,
    distance: number,
    travel: number,
  ): void {
    const gridSize = this.level?.gridSize;
    if (gridSize === undefined) return;
    const turns = new Map<string, number>();
    for (const member of result.members ?? [result]) {
      for (const flip of member.spotFlips ?? []) {
        const key = cellKey(flip.cell);
        turns.set(
          key,
          (turns.get(key) ?? 0) +
            flipTurnProgress(flip.step, gridSize, distance, travel),
        );
      }
    }
    if (turns.size === 0) return;
    for (const child of this.directionalsGroup.children) {
      const key = child.userData.stateful as string | undefined;
      const turn = key === undefined ? undefined : turns.get(key);
      if (key === undefined || turn === undefined) continue;
      this.orientFlip(child, (this.flipTurns.get(key) ?? 0) + turn);
    }
  }

  /** Advances each flip or rotor glyph currently shows, keyed by cell; fractional mid-turn. */
  spotGlyphTurns(): Record<string, number> {
    const turns: Record<string, number> = {};
    for (const child of this.directionalsGroup.children) {
      const key = child.userData.stateful as string | undefined;
      if (key) turns[key] = (child.userData.turns as number | undefined) ?? 0;
    }
    return turns;
  }

  /** Turn a flip or rotor glyph `turns` advances (fractional mid-move) from its authored heading. */
  private orientFlip(mesh: THREE.Object3D, turns: number): void {
    mesh.userData.turns = turns;
    const base = mesh.userData.baseQuaternion as THREE.Quaternion;
    const normal = mesh.userData.normal as THREE.Vector3;
    const step = mesh.userData.turnAngle as number;
    mesh.quaternion
      .copy(base)
      .premultiply(
        new THREE.Quaternion().setFromAxisAngle(normal, step * turns),
      );
  }

  settle(arrowId: string): void {
    this.flipMotion = false;
    this.setSpotHeadings(this.state?.spotHeadings);
    this.setCollapsed(this.state?.collapsed);
    for (const id of this.level
      ? overlappingArrowIds(this.level, arrowId)
      : [arrowId]) {
      const visual = this.visuals.get(id);
      if (visual) {
        this.updatePathVisual(visual, {
          ...visual.path,
          headFace: visual.path.segmentFaces.at(-1),
        });
      }
    }
    this.render();
  }

  projectedArrows(): readonly ProjectedArrow[] {
    if (!this.level || !this.state) {
      return [];
    }
    return this.level.arrows
      .filter((arrow) => this.state?.remainingIds.includes(arrow.id))
      .map((arrow) => {
        const visual = this.visuals.get(arrow.id);
        const picker = visual?.pickers.find((candidate) => {
          const face = candidate.userData.face as Cell["face"] | undefined;
          if (!face) return false;
          const [nx, ny, nz] = faceNormal(face);
          return (
            new THREE.Vector3(nx, ny, nz).dot(
              this.camera.position
                .clone()
                .sub(candidate.getWorldPosition(new THREE.Vector3())),
            ) > 0
          );
        });
        const point =
          (
            picker?.getWorldPosition(new THREE.Vector3()) ??
            visual?.path.points.at(-1)?.clone() ??
            new THREE.Vector3()
          ).project(this.camera) ?? new THREE.Vector3();
        return {
          id: arrow.id,
          x: Math.round(((point.x + 1) / 2) * this.canvas.clientWidth),
          y: Math.round(((1 - point.y) / 2) * this.canvas.clientHeight),
          visible: this.isArrowFacingCamera(arrow),
        };
      });
  }

  cameraDiagnostics(): CameraDiagnostics {
    const corners = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map((z) => new THREE.Vector3(x, y, z).project(this.camera)),
      ),
    );
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    return {
      orientation: [
        this.orientation.x,
        this.orientation.y,
        this.orientation.z,
        this.orientation.w,
      ],
      position: [
        this.camera.position.x,
        this.camera.position.y,
        this.camera.position.z,
      ],
      distance: this.distance,
      cubeScreenBounds: {
        left: Math.round(
          Math.min(...corners.map((point) => ((point.x + 1) / 2) * width)),
        ),
        top: Math.round(
          Math.min(...corners.map((point) => ((1 - point.y) / 2) * height)),
        ),
        right: Math.round(
          Math.max(...corners.map((point) => ((point.x + 1) / 2) * width)),
        ),
        bottom: Math.round(
          Math.max(...corners.map((point) => ((1 - point.y) / 2) * height)),
        ),
      },
    };
  }

  wrappingEdgeCount(): number {
    return this.wrappingEdgesGroup.children.length;
  }

  wrappingEdgeOpacities(): readonly number[] {
    return this.wrappingEdgesGroup.children.map(
      (child) =>
        (child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>)
          .material.opacity,
    );
  }

  selectedArrowId(): string | undefined {
    return this.selectedTarget?.arrowId;
  }

  selectedEndpoint(): MoveTarget["endpoint"] | undefined {
    return this.selectedTarget?.endpoint;
  }

  arrowHeadFace(arrowId: string): Cell["face"] | undefined {
    return this.visuals.get(arrowId)?.head.userData.face as
      | Cell["face"]
      | undefined;
  }

  arrowHeadPosition(
    arrowId: string,
  ): readonly [number, number, number] | undefined {
    const head = this.visuals.get(arrowId)?.head;
    if (!head) return undefined;
    const position = head.geometry.getAttribute("position");
    const tip = head.localToWorld(
      new THREE.Vector3().fromBufferAttribute(position, 2),
    );
    return [tip.x, tip.y, tip.z];
  }

  motionDistance(arrowId: string, result: MoveResult): number {
    if (result.members) {
      const members =
        result.kind === "blocked"
          ? result.members.filter((member) => member.kind === "blocked")
          : result.members;
      const distances = members.map((member) =>
        this.motionDistance(member.arrowId, member),
      );
      return result.kind === "blocked"
        ? Math.min(...distances)
        : Math.max(...distances);
    }
    const visual = this.visuals.get(arrowId);
    if (!visual || !this.level) return 0;
    return arrowMotionTrack(
      visual.path,
      result,
      this.level.gridSize,
      0,
      this.level,
    ).distance;
  }

  render(): void {
    this.updateCamera();
    for (const child of this.gridLinesGroup.children) {
      const normal = child.userData.normal as THREE.Vector3;
      child.visible =
        this.gridLinesEnabled && normal.dot(this.camera.position) > 0;
    }
    const selectedIds =
      this.level && this.selectedTarget
        ? overlappingArrowIds(this.level, this.selectedTarget.arrowId)
        : [];
    const tutorialIds =
      this.level && this.tutorialHighlightTarget
        ? overlappingArrowIds(this.level, this.tutorialHighlightTarget.arrowId)
        : [];
    const hintedIds =
      this.level && this.hintFocus && this.hintLit
        ? overlappingArrowIds(this.level, this.hintFocus.target.arrowId)
        : tutorialIds;
    for (const child of this.wrappingEdgesGroup.children) {
      const mesh = child as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      mesh.material.opacity = wrappingEdgeOpacity(
        mesh.userData.edge as WrappingEdgeSegment,
        this.camera.position,
      );
    }
    for (const child of this.stopCirclesGroup.children) {
      const mesh = child as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      mesh.material.opacity = stopCircleOpacity(
        mesh.userData.normal as THREE.Vector3,
        mesh.position,
        this.camera.position,
      );
    }
    for (const child of this.directionalsGroup.children) {
      const mesh = child as THREE.Mesh<
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial
      >;
      mesh.material.opacity = stopCircleOpacity(
        mesh.userData.normal as THREE.Vector3,
        mesh.position,
        this.camera.position,
      );
    }
    for (const child of this.fragileGroup.children) {
      const facing =
        stopCircleOpacity(
          child.userData.normal as THREE.Vector3,
          child.position,
          this.camera.position,
        ) === 1;
      child.traverse((part) => {
        const mesh = part as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.MeshBasicMaterial
        >;
        if (mesh.material instanceof THREE.MeshBasicMaterial)
          mesh.material.opacity = facing ? 1 : 0.32;
      });
    }
    for (const visual of this.visuals.values()) {
      const nudged =
        this.tutorialNudge && tutorialIds.includes(visual.arrow.id);
      const doubleFailed =
        visual.arrow.kind === "double" && this.level && this.state
          ? (this.state.failedPositions ?? []).includes(
              failurePositionKey(
                visual.arrow.id,
                settledPathOf(this.level, this.state, visual.arrow),
              ),
            )
          : false;
      const endpointColor = (endpoint: MoveTarget["endpoint"]): number => {
        const endpointSelected =
          this.selectedTarget?.arrowId === visual.arrow.id &&
          this.selectedTarget.endpoint === endpoint;
        const endpointHinted =
          this.hintFocus?.target.arrowId === visual.arrow.id &&
          this.hintFocus.target.endpoint === endpoint &&
          this.hintLit;
        const endpointTutorial =
          this.tutorialHighlightTarget?.arrowId === visual.arrow.id &&
          this.tutorialHighlightTarget.endpoint === endpoint;
        if (nudged) return this.palette.nudge;
        if (endpointSelected || endpointHinted || endpointTutorial)
          return this.palette.selected;
        if (visual.arrow.kind === "double") {
          return endpoint === "tail"
            ? this.palette.doubleTail
            : this.palette.doubleHead;
        }
        if (
          hintedIds.includes(visual.arrow.id) ||
          selectedIds.includes(visual.arrow.id)
        ) {
          return this.palette.selected;
        }
        return this.state?.failedIds.includes(visual.arrow.id)
          ? this.palette.failed
          : this.palette.arrow;
      };
      for (const segment of visual.segments) {
        const face = segment.picker.userData.face as Cell["face"] | undefined;
        const [nx, ny, nz] = face ? faceNormal(face) : [0, 0, 0];
        const exposed =
          new THREE.Vector3(nx, ny, nz).dot(
            this.camera.position.clone().sub(segment.picker.position),
          ) > 0;
        segment.material.opacity = exposed ? 1 : 0.32;
        segment.material.color.set(
          exposed ? endpointColor(segment.endpoint) : this.palette.farSide,
        );
        segment.failure.visible = doubleFailed && exposed;
      }
      const colorHead = (
        mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
        failure: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
        endpoint: MoveTarget["endpoint"],
      ): void => {
        const face = mesh.userData.face as Cell["face"] | undefined;
        const [nx, ny, nz] = face ? faceNormal(face) : [0, 0, 0];
        const center = mesh.localToWorld(
          mesh.geometry.boundingSphere?.center.clone() ?? new THREE.Vector3(),
        );
        const facing =
          new THREE.Vector3(nx, ny, nz).dot(
            this.camera.position.clone().sub(center),
          ) > 0;
        mesh.material.opacity = facing ? 1 : 0.32;
        mesh.material.color.set(
          facing ? endpointColor(endpoint) : this.palette.farSide,
        );
        failure.visible = doubleFailed && facing && mesh.visible;
      };
      colorHead(visual.head, visual.headFailure, "head");
      if (visual.tailHead && visual.tailFailure) {
        colorHead(visual.tailHead, visual.tailFailure, "tail");
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearArrows();
    this.clearWrappingEdges();
    disposeTree(this.cubeGroup);
    this.renderer.dispose();
    this.canvas.remove();
  }

  private createCube(): void {
    this.cubeMaterial = new THREE.MeshStandardMaterial({
      color: this.palette.cube,
      roughness: 0.88,
      metalness: 0,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    });
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      this.cubeMaterial,
    );
    cube.renderOrder = -2;
    // Edge colors share the transparent pass, between the cube and arrows.
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: this.palette.edges,
      transparent: true,
      depthWrite: false,
    });
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      this.edgeMaterial,
    );
    edges.renderOrder = -1;
    this.cubeGroup.add(cube, edges);
  }

  private createGridLines(gridSize: number): void {
    for (const child of this.gridLinesGroup.children) {
      (child as THREE.LineSegments).geometry.dispose();
    }
    this.gridLinesGroup.clear();
    this.gridLineMaterial?.dispose();
    this.gridLineMaterial = new THREE.LineBasicMaterial({
      color: this.palette.grid,
      transparent: true,
      opacity: this.theme === "light" ? 0.52 : 0.6,
      depthWrite: false,
      toneMapped: false,
    });
    if (gridSize <= 1) return;
    for (const face of CUBE_FACES) {
      const first = new THREE.Vector3(
        ...cellToWorld({ face, x: 0, y: 0 }, gridSize),
      );
      const east = new THREE.Vector3(
        ...cellToWorld({ face, x: 1, y: 0 }, gridSize),
      ).sub(first);
      const south = new THREE.Vector3(
        ...cellToWorld({ face, x: 0, y: 1 }, gridSize),
      ).sub(first);
      const normal = new THREE.Vector3(...faceNormal(face));
      const corner = first
        .clone()
        .addScaledVector(east, -0.5)
        .addScaledVector(south, -0.5)
        .addScaledVector(normal, GRID_LINE_OFFSET);
      const vertices: THREE.Vector3[] = [];
      for (let index = 1; index < gridSize; index += 1) {
        vertices.push(
          corner.clone().addScaledVector(east, index),
          corner
            .clone()
            .addScaledVector(east, index)
            .addScaledVector(south, gridSize),
          corner.clone().addScaledVector(south, index),
          corner
            .clone()
            .addScaledVector(south, index)
            .addScaledVector(east, gridSize),
        );
      }
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(vertices),
        this.gridLineMaterial,
      );
      lines.renderOrder = 0;
      lines.userData.normal = normal;
      this.gridLinesGroup.add(lines);
    }
    this.gridLinesGroup.visible = this.gridLinesEnabled;
  }

  private createWrappingEdges(level: LevelDefinition): void {
    const segments = wrappingEdgeSegments(level);
    if (segments.length === 0) return;
    const color = this.theme === "light" ? 0xb77900 : 0xffd84a;
    for (const edge of segments) {
      const { start, end } = edge;
      const material = new THREE.MeshBasicMaterial({
        color,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      });
      const direction = end.clone().sub(start);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(
          WRAPPING_EDGE_RADIUS,
          WRAPPING_EDGE_RADIUS,
          direction.length(),
          8,
        ),
        material,
      );
      mesh.renderOrder = -1;
      mesh.userData.edge = edge;
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      );
      this.wrappingEdgesGroup.add(mesh);
    }
  }

  private clearWrappingEdges(): void {
    disposeTree(this.wrappingEdgesGroup);
    this.wrappingEdgesGroup.clear();
  }

  /** A flat ring laid on each stop-circle cell, just above its cube face. */
  private createStopCircles(level: LevelDefinition): void {
    const pitch = 2 / level.gridSize;
    const inner = pitch * (STOP_CIRCLE_RADIUS - STOP_CIRCLE_THICKNESS / 2);
    const outer = pitch * (STOP_CIRCLE_RADIUS + STOP_CIRCLE_THICKNESS / 2);
    for (const stop of level.stops ?? []) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 28),
        new THREE.MeshBasicMaterial({
          color: this.palette.stop,
          side: THREE.DoubleSide,
          toneMapped: false,
          transparent: true,
          depthWrite: false,
        }),
      );
      const [nx, ny, nz] = faceNormal(stop.face);
      const normal = new THREE.Vector3(nx, ny, nz);
      mesh.position
        .copy(cellPoint(stop, level.gridSize))
        .addScaledVector(normal, 0.001);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mesh.renderOrder = -1;
      mesh.userData.stop = cellKey(stop);
      mesh.userData.normal = normal;
      this.stopCirclesGroup.add(mesh);
    }
  }

  private clearStopCircles(): void {
    disposeTree(this.stopCirclesGroup);
    this.stopCirclesGroup.clear();
  }

  /**
   * Flat glyphs on each directional-spot cell, pointing along the spot's
   * heading, just above its cube face like stop circles: two chevrons for a
   * static spot, a chevron over a dot for a flip spot, and a chevron inside a
   * ring notched at each of the four headings a rotor cycles through.
   */
  private createDirectionals(level: LevelDefinition): void {
    const pitch = 2 / level.gridSize;
    for (const spot of level.directionals ?? []) {
      const apex = pitch * 0.18;
      const span = pitch * DIRECTIONAL_CHEVRON_SPAN;
      const depth = pitch * DIRECTIONAL_CHEVRON_DEPTH;
      const band = pitch * DIRECTIONAL_CHEVRON_BAND;
      const chevron = (offset: number): THREE.Vector2[] =>
        [
          [-span, offset - depth],
          [0, offset],
          [span, offset - depth],
          [span, offset - depth - band],
          [0, offset - band],
          [-span, offset - depth - band],
        ].map(([x, y]) => new THREE.Vector2(x as number, y as number));
      const arc = (center: number): THREE.Shape => {
        const outer = pitch * (ROTOR_RING_RADIUS + ROTOR_RING_THICKNESS / 2);
        const inner = pitch * (ROTOR_RING_RADIUS - ROTOR_RING_THICKNESS / 2);
        const from = center - ROTOR_ARC_HALF_SPAN;
        const to = center + ROTOR_ARC_HALF_SPAN;
        const shape = new THREE.Shape();
        shape.absarc(0, 0, outer, from, to, false);
        shape.absarc(0, 0, inner, to, from, true);
        return shape;
      };
      const shapes =
        spot.kind === "flip"
          ? [
              new THREE.Shape(chevron(apex)),
              new THREE.Shape().absarc(
                0,
                apex - band - pitch * 0.2,
                pitch * 0.11,
                0,
                Math.PI * 2,
                false,
              ),
            ]
          : spot.kind === "rotor"
            ? [
                new THREE.Shape(chevron(apex + band / 2)),
                ...[1, 3, 5, 7].map((eighth) => arc((eighth * Math.PI) / 4)),
              ]
            : [apex, apex - band - pitch * 0.14].map(
                (offset) => new THREE.Shape(chevron(offset)),
              );
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shapes),
        new THREE.MeshBasicMaterial({
          color:
            spot.kind === "flip"
              ? this.palette.flip
              : spot.kind === "rotor"
                ? this.palette.rotor
                : this.palette.directional,
          side: THREE.DoubleSide,
          toneMapped: false,
          transparent: true,
          depthWrite: false,
        }),
      );
      const [nx, ny, nz] = faceNormal(spot.cell.face);
      const normal = new THREE.Vector3(nx, ny, nz);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal,
      );
      mesh.position
        .copy(cellPoint(spot.cell, level.gridSize))
        .addScaledVector(normal, 0.001);
      mesh.quaternion
        .copy(quaternion)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            inPlaneHeadingAngle(spot.cell.face, spot.heading, quaternion),
          ),
        );
      mesh.renderOrder = -1;
      mesh.userData.directional = cellKey(spot.cell);
      mesh.userData.normal = normal;
      mesh.userData.spotKind = spot.kind ?? "static";
      if (spot.kind === "flip" || spot.kind === "rotor") {
        mesh.userData.stateful = cellKey(spot.cell);
        mesh.userData.turnAngle = spotTurnAngle(spot.kind);
        mesh.userData.baseQuaternion = mesh.quaternion.clone();
      }
      this.directionalsGroup.add(mesh);
    }
  }

  private createWormholes(level: LevelDefinition): void {
    const pitch = 2 / level.gridSize;
    for (const [index, hole] of (level.wormholes ?? []).entries()) {
      for (const [end, cell] of [
        ["a", hole.a],
        ["b", hole.b],
      ] as const) {
        const normal = new THREE.Vector3(...faceNormal(cell.face));
        const group = new THREE.Group();
        group.position
          .copy(cellPoint(cell, level.gridSize))
          .addScaledVector(normal, 0.008);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        const material = () =>
          new THREE.MeshBasicMaterial({
            color: this.palette.wormhole[index as 0 | 1],
            side: THREE.DoubleSide,
            toneMapped: false,
            transparent: true,
            depthWrite: false,
          });
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(pitch * 0.28, pitch * 0.36, 32),
          material(),
        );
        const swirl = new THREE.Mesh(
          new THREE.TorusGeometry(
            pitch * 0.17,
            pitch * 0.023,
            6,
            32,
            Math.PI * 1.65,
          ),
          material(),
        );
        swirl.position.z = 0.001;
        swirl.rotation.z = (index * Math.PI) / 2;
        ring.renderOrder = -1;
        swirl.renderOrder = -1;
        ring.userData.wormholeIndex = index;
        swirl.userData.wormholeIndex = index;
        group.add(ring, swirl);
        this.wormholesGroup.add(group);
        const center = cellPoint(cell, level.gridSize).addScaledVector(
          normal,
          0.009,
        );
        for (const side of DOT_SIDES) {
          const dotIndex = wormholeDotColorIndex(side, end);
          const dot = new THREE.Mesh(
            new THREE.CircleGeometry(pitch * 0.055, 16),
            new THREE.MeshBasicMaterial({
              color: this.palette.wormholeDots[dotIndex] as number,
              side: THREE.DoubleSide,
              toneMapped: false,
              transparent: true,
              depthWrite: false,
            }),
          );
          dot.position
            .copy(center)
            .addScaledVector(
              new THREE.Vector3(...faceHeadingVector(cell.face, side)),
              pitch * 0.43,
            );
          dot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
          dot.renderOrder = -1;
          dot.userData.dotIndex = dotIndex;
          this.wormholesGroup.add(dot);
        }
      }
    }
  }

  /**
   * Each fragile cell carries two looks, one shown at a time. Intact, a crack
   * glyph: a jagged fracture across the cell with two short branches, flat on
   * the face like a spot. Collapsed, a hole: a dark square floor sunk
   * `HOLE_DEPTH` into the cube, four dark walls from the face down to it, and
   * a square border frame lying on the face around the opening. A square
   * frame and an unlit cavity keep it apart from round stop circles and
   * wormhole rings.
   */
  private createFragile(level: LevelDefinition): void {
    const pitch = 2 / level.gridSize;
    const material = (color: number, depthTest = true) =>
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
        depthTest,
      });
    const stroke = (
      points: readonly (readonly [number, number])[],
      width: number,
    ): THREE.Shape[] =>
      points.slice(1).map(([x2, y2], index) => {
        const [x1, y1] = points[index] as readonly [number, number];
        const length = Math.hypot(x2 - x1, y2 - y1);
        const nx = (-(y2 - y1) / length) * (width / 2);
        const ny = ((x2 - x1) / length) * (width / 2);
        return new THREE.Shape(
          [
            [x1 + nx, y1 + ny],
            [x2 + nx, y2 + ny],
            [x2 - nx, y2 - ny],
            [x1 - nx, y1 - ny],
          ].map(([x, y]) => new THREE.Vector2(x as number, y as number)),
        );
      });
    for (const cell of level.fragile ?? []) {
      const normal = new THREE.Vector3(...faceNormal(cell.face));
      const group = new THREE.Group();
      group.position
        .copy(cellPoint(cell, level.gridSize))
        .addScaledVector(normal, 0.001);
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const unit = (x: number, y: number) => [x * pitch, y * pitch] as const;
      const crack = new THREE.Mesh(
        new THREE.ShapeGeometry([
          ...stroke(
            [
              unit(-0.38, 0.3),
              unit(-0.14, 0.1),
              unit(-0.02, 0.2),
              unit(0.12, -0.06),
              unit(0.38, -0.3),
            ],
            pitch * 0.07,
          ),
          ...stroke([unit(-0.14, 0.1), unit(-0.2, -0.18)], pitch * 0.05),
          ...stroke([unit(0.12, -0.06), unit(0.3, 0.12)], pitch * 0.05),
        ]),
        material(this.palette.fragile),
      );
      crack.renderOrder = -1;
      crack.userData.fragilePart = "crack";
      const half = pitch * HOLE_HALF;
      const depth = pitch * HOLE_DEPTH;
      const hole = new THREE.Group();
      // The cavity draws only through the opening: a colorless quad in the
      // opening marks the stencil first, and the floor and walls, which
      // ignore depth so the translucent face cannot hide them, test it.
      // Without the mask the walls would show beside the opening through
      // the face and read as a raised box.
      const mask = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2, half * 2),
        new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          stencilWrite: true,
          stencilRef: 1,
          stencilFunc: THREE.AlwaysStencilFunc,
          stencilZPass: THREE.ReplaceStencilOp,
        }),
      );
      mask.renderOrder = -1.5;
      const cavityMaterial = (): THREE.MeshBasicMaterial => {
        const cavity = material(this.palette.hole.cavity, false);
        cavity.stencilWrite = true;
        cavity.stencilRef = 1;
        cavity.stencilFunc = THREE.EqualStencilFunc;
        return cavity;
      };
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2, half * 2),
        cavityMaterial(),
      );
      floor.position.z = -depth;
      const walls = [0, 1, 2, 3].map((side) => {
        const wall = new THREE.Mesh(
          new THREE.PlaneGeometry(half * 2, depth),
          cavityMaterial(),
        );
        // A plane stands up along z facing the cell's center, one per side.
        const angle = (side * Math.PI) / 2;
        wall.position.set(
          Math.cos(angle) * half,
          Math.sin(angle) * half,
          -depth / 2,
        );
        wall.rotation.order = "ZXY";
        wall.rotation.set(Math.PI / 2, 0, angle + Math.PI / 2);
        return wall;
      });
      const outer = half + pitch * HOLE_FRAME;
      const frameShape = new THREE.Shape(
        [
          [-outer, -outer],
          [outer, -outer],
          [outer, outer],
          [-outer, outer],
        ].map(([x, y]) => new THREE.Vector2(x as number, y as number)),
      );
      frameShape.holes.push(
        new THREE.Path(
          [
            [-half, -half],
            [-half, half],
            [half, half],
            [half, -half],
          ].map(([x, y]) => new THREE.Vector2(x as number, y as number)),
        ),
      );
      const frame = new THREE.Mesh(
        new THREE.ShapeGeometry(frameShape),
        material(this.palette.hole.rim),
      );
      frame.position.z = 0.001;
      for (const part of [floor, ...walls]) {
        part.renderOrder = -1;
        part.userData.fragilePart = "cavity";
      }
      frame.renderOrder = -1;
      frame.userData.fragilePart = "rim";
      hole.add(mask, floor, ...walls, frame);
      hole.visible = false;
      group.add(crack, hole);
      group.userData.fragile = cellKey(cell);
      group.userData.normal = normal;
      group.userData.crack = crack;
      group.userData.hole = hole;
      group.userData.collapse = 0;
      this.fragileGroup.add(group);
    }
  }

  private clearFragile(): void {
    disposeTree(this.fragileGroup);
    this.fragileGroup.clear();
  }

  private clearWormholes(): void {
    disposeTree(this.wormholesGroup);
    this.wormholesGroup.clear();
  }

  private clearDirectionals(): void {
    disposeTree(this.directionalsGroup);
    this.directionalsGroup.clear();
  }

  /**
   * Re-lay any arrow whose parked offset moved it since the last settled
   * state. The pickers ride the ribbon, so a parked arrow stays tappable.
   */
  private refreshSettledPaths(state: GameState): void {
    if (!this.level) return;
    for (const arrow of this.level.arrows) {
      const visual = this.visuals.get(arrow.id);
      if (!visual) continue;
      const cells = settledPathOf(this.level, state, arrow);
      const key = cells.map(cellKey).join("|");
      if (visual.settledKey === key) continue;
      visual.settledKey = key;
      visual.path = expandedPoints(cells, this.level.gridSize, this.level);
      this.updatePathVisual(visual, {
        ...visual.path,
        headFace: visual.path.segmentFaces.at(-1),
      });
    }
  }

  private createArrow(
    arrow: ArrowDefinition,
    gridSize: number,
    arrowScale = 1,
  ): ArrowVisual {
    const group = new THREE.Group();
    const pitch = 2 / gridSize;
    const { ribbonWidth, headLength } = arrowDimensions(gridSize, arrowScale);
    const pickRadius = Math.min(PICK_RADIUS, pitch * 0.28);
    const material = new THREE.MeshBasicMaterial({
      color: this.palette.arrow,
      transparent: true,
      forceSinglePass: true,
    });
    const tailMaterial =
      arrow.kind === "double"
        ? new THREE.MeshBasicMaterial({
            transparent: true,
            forceSinglePass: true,
          })
        : undefined;
    const failureMaterial = new THREE.MeshBasicMaterial({
      color: this.palette.failed,
      wireframe: true,
      transparent: true,
      opacity: 0.95,
    });
    const expanded = expandedPoints(arrow.path, gridSize, this.level);
    const segments: SegmentVisual[] = [];
    const pickers: THREE.Object3D[] = [];
    const segmentCount = Math.max(1, arrow.path.length * 3 + 8);
    for (let index = 0; index < segmentCount; index += 1) {
      const endpoint: MoveTarget["endpoint"] =
        arrow.kind === "double" && index < segmentCount / 2 ? "tail" : "head";
      const segmentMaterial =
        endpoint === "tail" && tailMaterial
          ? tailMaterial.clone()
          : material.clone();
      segmentMaterial.side = THREE.DoubleSide;
      const ribbon = new THREE.Mesh(makeRibbonGeometry(4), segmentMaterial);
      ribbon.frustumCulled = false;
      const failure = new THREE.Mesh(
        makeRibbonGeometry(4),
        failureMaterial.clone(),
      );
      failure.frustumCulled = false;
      failure.visible = false;
      failure.renderOrder = 5;
      const picker = new THREE.Mesh(
        new THREE.CylinderGeometry(pickRadius, pickRadius, 1, 8),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      picker.layers.set(PICK_LAYER);
      picker.userData.arrowId = arrow.id;
      picker.userData.endpoint = endpoint;
      picker.userData.face = expanded.segmentFaces[index];
      group.add(ribbon, failure, picker);
      segments.push({
        ribbon,
        picker,
        material: segmentMaterial,
        failure,
        endpoint,
        face: expanded.segmentFaces[index],
      });
      pickers.push(picker);
    }
    material.side = THREE.DoubleSide;
    if (tailMaterial) tailMaterial.side = THREE.DoubleSide;
    const head = new THREE.Mesh(makeHeadGeometry(), material);
    head.frustumCulled = false;
    head.layers.enable(PICK_LAYER);
    head.userData.arrowId = arrow.id;
    head.userData.endpoint = "head";
    const headFailure = new THREE.Mesh(
      makeHeadGeometry(),
      failureMaterial.clone(),
    );
    headFailure.visible = false;
    headFailure.renderOrder = 5;
    const tailHead = tailMaterial
      ? new THREE.Mesh(makeHeadGeometry(), tailMaterial)
      : undefined;
    if (tailHead) {
      tailHead.frustumCulled = false;
      tailHead.layers.enable(PICK_LAYER);
      tailHead.userData.arrowId = arrow.id;
      tailHead.userData.endpoint = "tail";
    }
    const tailFailure = tailHead
      ? new THREE.Mesh(makeHeadGeometry(), failureMaterial.clone())
      : undefined;
    if (tailFailure) {
      tailFailure.visible = false;
      tailFailure.renderOrder = 5;
    }
    group.add(head, headFailure);
    if (tailHead && tailFailure) group.add(tailHead, tailFailure);
    const visual: ArrowVisual = {
      arrow,
      group,
      segments,
      head,
      ...(tailHead ? { tailHead } : {}),
      material,
      ...(tailMaterial ? { tailMaterial } : {}),
      headFailure,
      ...(tailFailure ? { tailFailure } : {}),
      pickers,
      path: expanded,
      settledKey: arrow.path.map(cellKey).join("|"),
      ribbonWidth,
      headLength,
    };
    this.updatePathVisual(visual, {
      ...expanded,
      headFace: expanded.segmentFaces.at(-1),
    });
    return visual;
  }

  private updatePathVisual(
    visual: ArrowVisual,
    path: RibbonSlice,
    movingTail = false,
  ): void {
    const up = new THREE.Vector3(0, 1, 0);
    const split =
      visual.arrow.kind === "double" && !path.gaps?.some(Boolean)
        ? splitExpandedPath(path.points, path.segmentFaces, 0.5)
        : undefined;
    const layoutPath: RibbonSlice = split
      ? {
          points: [...split.tail.points, ...split.head.points.slice(1)],
          segmentFaces: [
            ...split.tail.segmentFaces,
            ...split.head.segmentFaces,
          ],
          headFace: path.headFace,
          ...(path.gaps ? { gaps: path.gaps } : {}),
        }
      : path;
    const sections = ribbonSections(
      layoutPath.points,
      layoutPath.segmentFaces,
      visual.ribbonWidth,
      movingTail,
      layoutPath.gaps,
    );
    let travelled = 0;
    for (let index = 0; index < visual.segments.length; index += 1) {
      const segment = visual.segments[index];
      if (!segment) {
        continue;
      }
      const start = layoutPath.points[index];
      const end = layoutPath.points[index + 1];
      const face = layoutPath.segmentFaces[index];
      if (!start || !end || !face || layoutPath.gaps?.[index]) {
        segment.ribbon.visible = false;
        segment.picker.visible = false;
        segment.failure.visible = false;
        segment.face = undefined;
        segment.picker.userData.face = undefined;
        continue;
      }
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), 0.001);
      const midpointDistance =
        travelled + (layoutPath.gaps?.[index] ? 0 : length / 2);
      segment.endpoint =
        visual.arrow.kind === "double" &&
        midpointDistance < pathLength(path) / 2
          ? "tail"
          : "head";
      segment.picker.userData.endpoint = segment.endpoint;
      travelled += layoutPath.gaps?.[index] ? 0 : length;
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const [nx, ny, nz] = faceNormal(face);
      const vertices = ribbonVertices(
        start,
        end,
        new THREE.Vector3(nx, ny, nz),
        visual.ribbonWidth,
        sections[index]?.start,
        sections[index]?.end,
      );
      const attribute = segment.ribbon.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      attribute.array.set(vertices);
      attribute.needsUpdate = true;
      const failureAttribute = segment.failure.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      failureAttribute.array.set(vertices);
      failureAttribute.needsUpdate = true;
      segment.ribbon.visible = true;
      segment.face = face;
      segment.picker.userData.face = face;
      segment.picker.position.copy(midpoint);
      segment.picker.scale.set(1, length, 1);
      segment.picker.quaternion.setFromUnitVectors(up, direction.normalize());
      segment.picker.visible = true;
    }
    const layoutHead = (
      head: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
      failure: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>,
      headPoint: THREE.Vector3,
      previous: THREE.Vector3,
      face: Cell["face"],
      lift: number,
    ): void => {
      const heading = headPoint.clone().sub(previous).normalize();
      const [nx, ny, nz] = faceNormal(face);
      const normal = new THREE.Vector3(nx, ny, nz);
      const side = normal
        .clone()
        .cross(heading)
        .normalize()
        .multiplyScalar(visual.ribbonWidth * 0.8);
      const base = headPoint.clone().addScaledVector(normal, 0.005 + lift);
      const vertices = new Float32Array([
        base.x - side.x,
        base.y - side.y,
        base.z - side.z,
        base.x + side.x,
        base.y + side.y,
        base.z + side.z,
        base.x + heading.x * visual.headLength,
        base.y + heading.y * visual.headLength,
        base.z + heading.z * visual.headLength,
      ]);
      for (const mesh of [head, failure]) {
        const attribute = mesh.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        attribute.array.set(vertices);
        attribute.needsUpdate = true;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
        mesh.userData.face = face;
        mesh.visible = path.points.length > 1 && mesh === head;
      }
    };
    const headPoint = layoutPath.points.at(-1) ?? new THREE.Vector3();
    const previous =
      layoutPath.points.at(-2) ??
      headPoint.clone().add(new THREE.Vector3(0, -1, 0));
    layoutHead(
      visual.head,
      visual.headFailure,
      headPoint,
      previous,
      path.headFace ?? arrowFace(visual.arrow),
      sections.at(-1)?.lift ?? 0,
    );
    if (visual.tailHead && visual.tailFailure) {
      const tailPoint = layoutPath.points[0] ?? new THREE.Vector3();
      const next =
        layoutPath.points[1] ??
        tailPoint.clone().add(new THREE.Vector3(0, 1, 0));
      const tailFace = layoutPath.segmentFaces[0] ?? arrowFace(visual.arrow);
      layoutHead(
        visual.tailHead,
        visual.tailFailure,
        tailPoint,
        next,
        tailFace,
        sections[0]?.lift ?? 0,
      );
    }
  }

  private get palette(): ThemePalette {
    return THEME_PALETTES[this.theme];
  }

  private isArrowFacingCamera(arrow: ArrowDefinition): boolean {
    const cells =
      this.level && this.state
        ? settledPathOf(this.level, this.state, arrow)
        : arrow.path;
    const visibleCell = cells.find((cell) => {
      const point = cellPoint(cell, this.level?.gridSize ?? 1);
      const [nx, ny, nz] = faceNormal(cell.face);
      return (
        new THREE.Vector3(nx, ny, nz).dot(
          this.camera.position.clone().sub(point),
        ) > 0
      );
    });
    return Boolean(visibleCell);
  }

  private updateCamera(): void {
    this.camera.quaternion.copy(this.orientation);
    this.camera.position
      .set(0, 0, this.distance)
      .applyQuaternion(this.orientation);
    this.camera.updateMatrixWorld();
  }

  private resize(): void {
    const bounds = this.canvas.parentElement?.getBoundingClientRect();
    const width = Math.max(1, bounds?.width ?? window.innerWidth);
    const height = Math.max(1, bounds?.height ?? window.innerHeight);
    const previousFit = this.fitDistance;
    const aspect = width / height;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const verticalShare = aspect > 1 ? 0.68 : 0.78;
    this.fitDistance = Math.max(
      5.2,
      1.76 / (Math.tan(halfFov) * verticalShare),
      1.76 / (Math.tan(halfFov) * aspect * 0.8),
    );
    this.distance = this.hasFitted
      ? clamp(
          (this.distance / previousFit) * this.fitDistance,
          this.fitDistance * 0.56,
          this.fitDistance * 1.7,
        )
      : this.fitDistance;
    this.hasFitted = true;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  private clearArrows(): void {
    for (const visual of this.visuals.values()) {
      this.arrowsGroup.remove(visual.group);
      disposeTree(visual.group);
    }
    this.visuals.clear();
    this.pickers.length = 0;
  }
}
