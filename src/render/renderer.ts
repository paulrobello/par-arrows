import * as THREE from "three";

import { cellToWorld, faceNormal } from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  GameState,
  LevelDefinition,
  MoveResult,
} from "../core/types";

const PICK_RADIUS = 0.14;
const PICK_LAYER = 1;

interface SegmentVisual {
  readonly ribbon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly picker: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
  face: Cell["face"] | undefined;
}

interface ArrowVisual {
  readonly arrow: ArrowDefinition;
  readonly group: THREE.Group;
  readonly segments: readonly SegmentVisual[];
  readonly head: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
  readonly pickers: readonly THREE.Object3D[];
  readonly path: ExpandedPath;
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

/** Computes shared cross-sections for every same-face path joint. */
export function ribbonSections(
  points: readonly THREE.Vector3[],
  segmentFaces: readonly Cell["face"][],
  width: number,
): readonly SegmentCrossSections[] {
  const sections: SegmentCrossSections[] = [];
  for (let index = 0; index < segmentFaces.length; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const face = segmentFaces[index];
    if (!start || !end || !face) continue;
    const [nx, ny, nz] = faceNormal(face);
    const normal = new THREE.Vector3(nx, ny, nz);
    const tangent = end.clone().sub(start);
    if (tangent.lengthSq() < 1e-10) {
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
    sections.push({
      start: crossSection(start, normal, tangent, width),
      end: crossSection(end, normal, tangent, width),
    });
  }
  for (let index = 1; index < sections.length; index += 1) {
    const previousFace = segmentFaces[index - 1];
    const nextFace = segmentFaces[index];
    const joint = points[index];
    const previousStart = points[index - 1];
    const nextEnd = points[index + 1];
    if (
      !previousFace ||
      !nextFace ||
      !joint ||
      !previousStart ||
      !nextEnd ||
      previousFace !== nextFace
    )
      continue;
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
  return sections;
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

function pathLength(path: ExpandedPath): number {
  let length = 0;
  for (let index = 1; index < path.points.length; index += 1) {
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
  let walked = 0;
  const endOffset = offset + length;
  for (let index = 0; index < path.segmentFaces.length; index += 1) {
    const start = path.points[index];
    const end = path.points[index + 1];
    const face = path.segmentFaces[index];
    if (!start || !end || !face) continue;
    const segmentLength = start.distanceTo(end);
    const segmentStart = walked;
    const segmentEnd = walked + segmentLength;
    const from = Math.max(offset, segmentStart);
    const to = Math.min(endOffset, segmentEnd);
    if (to > from || (segmentLength === 0 && from === to)) {
      const at = (distance: number): THREE.Vector3 =>
        start
          .clone()
          .lerp(
            end,
            segmentLength === 0 ? 0 : (distance - segmentStart) / segmentLength,
          );
      const fromPoint = at(from);
      const toPoint = at(to);
      if (points.length === 0) points.push(fromPoint);
      points.push(toPoint);
      segmentFaces.push(face);
    }
    walked = segmentEnd;
  }
  if (points.length !== segmentFaces.length + 1) {
    throw new Error(
      "Ribbon path slices must have exactly one more point than segment face.",
    );
  }
  return { points, segmentFaces, headFace: segmentFaces.at(-1) };
}

function concatPaths(first: ExpandedPath, second: ExpandedPath): ExpandedPath {
  return {
    points: [...first.points, ...second.points.slice(1)],
    segmentFaces: [...first.segmentFaces, ...second.segmentFaces],
  };
}

function arrowFace(arrow: ArrowDefinition): Cell["face"] {
  return arrow.path.at(-1)?.face ?? "front";
}

export function expandedPoints(
  cells: readonly Cell[],
  gridSize: number,
): ExpandedPath {
  const first = cells[0];
  if (!first) {
    return { points: [], segmentFaces: [] };
  }
  const points: THREE.Vector3[] = [cellPoint(first, gridSize)];
  const segmentFaces: Cell["face"][] = [];
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1];
    const current = cells[index];
    if (!previous || !current) {
      continue;
    }
    const previousPoint = cellPoint(previous, gridSize);
    const currentPoint = cellPoint(current, gridSize);
    if (previous.face !== current.face) {
      points.push(
        seamPoint(previousPoint, currentPoint, previous.face, current.face),
      );
      segmentFaces.push(previous.face);
    } else {
      segmentFaces.push(previous.face);
    }
    points.push(currentPoint);
    if (previous.face !== current.face) {
      segmentFaces.push(current.face);
    }
  }
  return { points, segmentFaces };
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
  private readonly arrowsGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly pickers: THREE.Object3D[] = [];
  private readonly visuals = new Map<string, ArrowVisual>();
  private level: LevelDefinition | undefined;
  private state: GameState | undefined;
  private selectedId: string | undefined;
  private readonly orientation = INITIAL_CAMERA_ORIENTATION.clone();
  private distance = 7.5;
  private fitDistance = 7.5;
  private hasFitted = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.raycaster.layers.set(PICK_LAYER);
    this.canvas = this.renderer.domElement;
    this.canvas.className = "game-canvas";
    this.renderer.setClearColor(0xe9f4f7, 1);
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        /iPhone|iPad|Android/i.test(navigator.userAgent) ? 1.5 : 2,
      ),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.canvas);

    this.scene.add(this.cubeGroup, this.arrowsGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb7d5df, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xf7fbff, 1.4));
    this.createCube();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setLevel(level: LevelDefinition, state: GameState): void {
    this.clearArrows();
    this.level = level;
    this.state = state;
    for (const arrow of level.arrows) {
      const visual = this.createArrow(arrow, level.gridSize);
      this.visuals.set(arrow.id, visual);
      this.arrowsGroup.add(visual.group);
      this.pickers.push(...visual.pickers);
    }
    this.updateState(state);
    this.render();
  }

  updateState(state: GameState): void {
    this.state = state;
    for (const [id, visual] of this.visuals) {
      visual.group.visible = state.remainingIds.includes(id);
      const red = state.failedIds.includes(id);
      visual.material.color.set(red ? 0xd94841 : 0x0b1015);
      for (const segment of visual.segments) {
        segment.material.color.set(red ? 0xd94841 : 0x0b1015);
      }
    }
    this.applySelection();
    this.render();
  }

  setSelected(id: string | undefined): void {
    this.selectedId = id;
    this.applySelection();
    this.render();
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
      this.fitDistance * 0.56,
      this.fitDistance * 1.7,
    );
    this.render();
  }

  resetView(): void {
    this.orientation.copy(INITIAL_CAMERA_ORIENTATION);
    this.distance = this.fitDistance;
    this.render();
  }

  pick(clientX: number, clientY: number): string | undefined {
    if (this.state?.status !== "playing") {
      return undefined;
    }
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster
      .intersectObjects(
        this.pickers.filter((picker) => {
          const id = picker.userData.arrowId as string | undefined;
          return Boolean(
            picker.visible &&
              picker.parent?.visible &&
              id &&
              this.state?.remainingIds.includes(id),
          );
        }),
        false,
      )
      .find((candidate) => {
        const face = candidate.object.userData.face as Cell["face"] | undefined;
        if (!face) {
          return false;
        }
        const [nx, ny, nz] = faceNormal(face);
        const normal = new THREE.Vector3(nx, ny, nz);
        return (
          normal.dot(this.camera.position.clone().sub(candidate.point)) > 0.04
        );
      });
    const id = hit?.object.userData.arrowId as string | undefined;
    return id && this.state.remainingIds.includes(id) ? id : undefined;
  }

  animate(arrowId: string, result: MoveResult, progress: number): void {
    const visual = this.visuals.get(arrowId);
    if (!visual || !this.level) {
      return;
    }
    const travel =
      result.kind === "blocked"
        ? progress < 0.5
          ? progress * 2
          : (1 - progress) * 2
        : progress;
    const path = visual.path;
    const route = expandedPoints(result.route, this.level.gridSize);
    let track = concatPaths(path, route);
    if (result.kind === "exit") {
      const tail = track.points.at(-1) ?? new THREE.Vector3();
      const lastFace = track.segmentFaces.at(-1) ?? arrowFace(visual.arrow);
      const tangent = new THREE.Vector3(0, 0, 1);
      const flightPoints = [tail];
      if (result.exit) {
        const [x, y, z] = result.exit.edgePoint;
        const [tx, ty, tz] = result.exit.tangent;
        flightPoints.push(new THREE.Vector3(x, y, z));
        tangent.set(tx, ty, tz).normalize();
      }
      for (let index = 1; index <= visual.arrow.path.length + 3; index += 1) {
        flightPoints.push(tail.clone().addScaledVector(tangent, index * 0.42));
      }
      track = concatPaths(track, {
        points: flightPoints,
        segmentFaces: Array.from(
          { length: flightPoints.length - 1 },
          () => lastFace,
        ),
      });
    }
    const total =
      result.kind === "exit"
        ? pathLength(track) - pathLength(path)
        : result.distance * (2 / this.level.gridSize);
    this.updatePathVisual(
      visual,
      slicePath(track, travel * total, pathLength(path)),
    );
    this.render();
  }

  settle(arrowId: string): void {
    const visual = this.visuals.get(arrowId);
    if (visual) {
      this.updatePathVisual(visual, {
        ...visual.path,
        headFace: visual.path.segmentFaces.at(-1),
      });
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

  render(): void {
    this.updateCamera();
    for (const visual of this.visuals.values()) {
      const activeColor =
        visual.arrow.id === this.selectedId
          ? 0x108acb
          : this.state?.failedIds.includes(visual.arrow.id)
            ? 0xd94841
            : 0x0b1015;
      for (const segment of visual.segments) {
        const face = segment.picker.userData.face as Cell["face"] | undefined;
        const [nx, ny, nz] = face ? faceNormal(face) : [0, 0, 0];
        const exposed =
          new THREE.Vector3(nx, ny, nz).dot(
            this.camera.position.clone().sub(segment.picker.position),
          ) > 0;
        segment.material.opacity = exposed ? 1 : 0.32;
        segment.material.color.set(exposed ? activeColor : 0x6f9fb2);
      }
      const headFace = visual.arrow.path.at(-1)?.face;
      const [nx, ny, nz] = headFace ? faceNormal(headFace) : [0, 0, 0];
      visual.material.opacity =
        new THREE.Vector3(nx, ny, nz).dot(
          this.camera.position.clone().sub(visual.head.position),
        ) > 0
          ? 1
          : 0.32;
      visual.material.color.set(
        visual.material.opacity === 1 ? activeColor : 0x6f9fb2,
      );
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.clearArrows();
    disposeTree(this.cubeGroup);
    this.renderer.dispose();
    this.canvas.remove();
  }

  private createCube(): void {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshStandardMaterial({
        color: 0xfffcf4,
        roughness: 0.88,
        metalness: 0,
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      new THREE.LineBasicMaterial({ color: 0xa9c5ce }),
    );
    this.cubeGroup.add(cube, edges);
  }

  private createArrow(arrow: ArrowDefinition, gridSize: number): ArrowVisual {
    const group = new THREE.Group();
    const pitch = 2 / gridSize;
    const ribbonWidth = pitch * 0.15;
    const headLength = pitch * 0.35;
    const pickRadius = Math.min(PICK_RADIUS, pitch * 0.28);
    const material = new THREE.MeshBasicMaterial({
      color: 0x0b1015,
      transparent: true,
      forceSinglePass: true,
    });
    const expanded = expandedPoints(arrow.path, gridSize);
    const segments: SegmentVisual[] = [];
    const pickers: THREE.Object3D[] = [];
    const segmentCount = Math.max(1, arrow.path.length * 3 + 8);
    for (let index = 0; index < segmentCount; index += 1) {
      const segmentMaterial = material.clone();
      segmentMaterial.side = THREE.DoubleSide;
      const ribbon = new THREE.Mesh(makeRibbonGeometry(4), segmentMaterial);
      ribbon.frustumCulled = false;
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
      picker.userData.face = expanded.segmentFaces[index];
      group.add(ribbon, picker);
      segments.push({
        ribbon,
        picker,
        material: segmentMaterial,
        face: expanded.segmentFaces[index],
      });
      pickers.push(picker);
    }
    material.side = THREE.DoubleSide;
    const head = new THREE.Mesh(makeHeadGeometry(), material);
    head.frustumCulled = false;
    group.add(head);
    const visual: ArrowVisual = {
      arrow,
      group,
      segments,
      head,
      material,
      pickers,
      path: expanded,
      ribbonWidth,
      headLength,
    };
    this.updatePathVisual(visual, {
      ...expanded,
      headFace: expanded.segmentFaces.at(-1),
    });
    return visual;
  }

  private updatePathVisual(visual: ArrowVisual, path: RibbonSlice): void {
    const up = new THREE.Vector3(0, 1, 0);
    const sections = ribbonSections(
      path.points,
      path.segmentFaces,
      visual.ribbonWidth,
    );
    for (let index = 0; index < visual.segments.length; index += 1) {
      const segment = visual.segments[index];
      if (!segment) {
        continue;
      }
      const start = path.points[index];
      const end = path.points[index + 1];
      const face = path.segmentFaces[index];
      if (!start || !end || !face) {
        segment.ribbon.visible = false;
        segment.picker.visible = false;
        segment.face = undefined;
        segment.picker.userData.face = undefined;
        continue;
      }
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), 0.001);
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
      segment.ribbon.visible = true;
      segment.face = face;
      segment.picker.userData.face = face;
      segment.picker.position.copy(midpoint);
      segment.picker.scale.set(1, length, 1);
      segment.picker.quaternion.setFromUnitVectors(up, direction.normalize());
      segment.picker.visible = true;
    }
    const headPoint = path.points.at(-1) ?? new THREE.Vector3();
    const previous =
      path.points.at(-2) ?? headPoint.clone().add(new THREE.Vector3(0, -1, 0));
    const heading = headPoint.clone().sub(previous).normalize();
    const face = path.headFace ?? arrowFace(visual.arrow);
    const [nx, ny, nz] = faceNormal(face);
    const normal = new THREE.Vector3(nx, ny, nz);
    const side = normal
      .clone()
      .cross(heading)
      .normalize()
      .multiplyScalar(visual.ribbonWidth * 0.8);
    const base = headPoint.clone().addScaledVector(normal, 0.005);
    const headVertices = new Float32Array([
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
    const headAttribute = visual.head.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    headAttribute.array.set(headVertices);
    headAttribute.needsUpdate = true;
    visual.head.visible = path.points.length > 1;
  }

  private applySelection(): void {
    for (const [id, visual] of this.visuals) {
      const selected = id === this.selectedId;
      visual.material.color.set(
        selected
          ? 0x108acb
          : this.state?.failedIds.includes(id)
            ? 0xd94841
            : 0x0b1015,
      );
      for (const segment of visual.segments) {
        segment.material.color.copy(visual.material.color);
      }
    }
  }

  private isArrowFacingCamera(arrow: ArrowDefinition): boolean {
    const visibleCell = arrow.path.find((cell) => {
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
