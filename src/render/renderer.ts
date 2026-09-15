import * as THREE from "three";

import { cellToWorld, faceNormal } from "../core/topology";
import type {
  ArrowDefinition,
  Cell,
  GameState,
  LevelDefinition,
  MoveResult,
} from "../core/types";

const SURFACE_OFFSET = 0.045;
const PICK_RADIUS = 0.14;

interface SegmentVisual {
  readonly line: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly picker: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  readonly joint: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
}

interface ArrowVisual {
  readonly arrow: ArrowDefinition;
  readonly group: THREE.Group;
  readonly segments: readonly SegmentVisual[];
  readonly head: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  readonly material: THREE.MeshBasicMaterial;
  readonly headOffset: number;
  readonly pickers: readonly THREE.Object3D[];
  readonly points: readonly THREE.Vector3[];
}

export interface ProjectedArrow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

export interface CameraDiagnostics {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly cubeScreenBounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function cellPoint(cell: Cell, gridSize: number): THREE.Vector3 {
  const [x, y, z] = cellToWorld(cell, gridSize);
  const [nx, ny, nz] = faceNormal(cell.face);
  return new THREE.Vector3(
    x + nx * SURFACE_OFFSET,
    y + ny * SURFACE_OFFSET,
    z + nz * SURFACE_OFFSET,
  );
}

function seamPoint(first: THREE.Vector3, second: THREE.Vector3): THREE.Vector3 {
  const edge = new THREE.Vector3();
  for (const axis of ["x", "y", "z"] as const) {
    const total = first[axis] + second[axis];
    edge[axis] =
      Math.abs(total) > 1 ? Math.sign(total) : (first[axis] + second[axis]) / 2;
  }
  return edge;
}

interface ExpandedPath {
  readonly points: readonly THREE.Vector3[];
  readonly segmentFaces: readonly Cell["face"][];
}

function expandedPoints(
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
      points.push(seamPoint(previousPoint, currentPoint));
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
  private yaw = -0.72;
  private pitch = 0.43;
  private distance = 7.5;
  private fitDistance = 7.5;
  private hasFitted = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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
    this.yaw -= deltaX * 0.012;
    this.pitch = clamp(this.pitch - deltaY * 0.012, -1.18, 1.18);
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
    this.yaw = -0.72;
    this.pitch = 0.43;
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
      .intersectObjects(this.pickers, false)
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
    const path = visual.points;
    const route = expandedPoints(result.route, this.level.gridSize);
    const track = [...path, ...route.points.slice(1)];
    if (result.kind === "exit") {
      const tail = track.at(-1) ?? path.at(-1) ?? new THREE.Vector3();
      const previous =
        track.at(-2) ?? path.at(-2) ?? new THREE.Vector3(0, 0, 1);
      const tangent = tail.clone().sub(previous).normalize();
      if (result.exit) {
        const [x, y, z] = result.exit.edgePoint;
        const [tx, ty, tz] = result.exit.tangent;
        track.push(new THREE.Vector3(x, y, z));
        tangent.set(tx, ty, tz).normalize();
      }
      for (let index = 1; index <= visual.arrow.path.length + 3; index += 1) {
        track.push(tail.clone().addScaledVector(tangent, index * 0.42));
      }
    }
    const distance =
      result.kind === "exit"
        ? result.distance + travel * (visual.arrow.path.length + 2)
        : result.distance * travel;
    this.updatePathVisual(
      visual,
      this.samplePath(
        track,
        visual.points,
        distance * (2 / this.level.gridSize),
      ),
    );
    this.render();
  }

  settle(arrowId: string): void {
    const visual = this.visuals.get(arrowId);
    if (visual) {
      this.updatePathVisual(visual, visual.points);
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
            visual?.points.at(-1)?.clone() ??
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
      yaw: this.yaw,
      pitch: this.pitch,
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
            this.camera.position.clone().sub(segment.line.position),
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
    const pathRadius = pitch * 0.075;
    const headRadius = pitch * 0.18;
    const headLength = pitch * 0.35;
    const material = new THREE.MeshBasicMaterial({
      color: 0x0b1015,
      transparent: true,
    });
    const expanded = expandedPoints(arrow.path, gridSize);
    const points = expanded.points;
    const segments: SegmentVisual[] = [];
    const pickers: THREE.Object3D[] = [];
    const segmentCount = Math.max(1, points.length - 1);
    for (let index = 0; index < segmentCount; index += 1) {
      const segmentMaterial = material.clone();
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(pathRadius, pathRadius, 1, 8),
        segmentMaterial,
      );
      const picker = new THREE.Mesh(
        new THREE.CylinderGeometry(PICK_RADIUS, PICK_RADIUS, 1, 8),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      picker.userData.arrowId = arrow.id;
      picker.userData.face = expanded.segmentFaces[index];
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(pathRadius, 8, 6),
        segmentMaterial,
      );
      group.add(line, picker, joint);
      segments.push({ line, picker, joint, material: segmentMaterial });
      pickers.push(picker);
    }
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(headRadius, headLength, 8),
      material,
    );
    group.add(head);
    const visual: ArrowVisual = {
      arrow,
      group,
      segments,
      head,
      material,
      headOffset: headLength * 0.36,
      pickers,
      points,
    };
    this.updatePathVisual(visual, points);
    return visual;
  }

  private updatePathVisual(
    visual: ArrowVisual,
    points: readonly THREE.Vector3[],
  ): void {
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < visual.segments.length; index += 1) {
      const segment = visual.segments[index];
      if (!segment) {
        continue;
      }
      const start =
        points[Math.min(index, points.length - 1)] ?? new THREE.Vector3();
      const end = points[Math.min(index + 1, points.length - 1)] ?? start;
      const direction = end.clone().sub(start);
      const length = Math.max(direction.length(), 0.001);
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      for (const mesh of [segment.line, segment.picker]) {
        mesh.position.copy(midpoint);
        mesh.scale.set(1, length, 1);
        mesh.quaternion.setFromUnitVectors(up, direction.normalize());
        mesh.visible = index < points.length - 1;
      }
      segment.joint.position.copy(start);
      segment.joint.visible = index < points.length - 1;
    }
    const headPoint = points.at(-1) ?? new THREE.Vector3();
    const previous =
      points.at(-2) ?? headPoint.clone().add(new THREE.Vector3(0, -1, 0));
    const heading = headPoint.clone().sub(previous).normalize();
    visual.head.position.copy(
      headPoint.clone().addScaledVector(heading, visual.headOffset),
    );
    visual.head.quaternion.setFromUnitVectors(up, heading);
  }

  private samplePath(
    track: readonly THREE.Vector3[],
    template: readonly THREE.Vector3[],
    offset: number,
  ): readonly THREE.Vector3[] {
    let distance = 0;
    return template.map((point, index) => {
      if (index > 0) {
        distance += point.distanceTo(template[index - 1] ?? point);
      }
      return this.pointAtDistance(track, distance + offset);
    });
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

  private pointAtDistance(
    points: readonly THREE.Vector3[],
    target: number,
  ): THREE.Vector3 {
    if (points.length === 0) return new THREE.Vector3();
    let walked = 0;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1] ?? new THREE.Vector3();
      const end = points[index] ?? start;
      const length = start.distanceTo(end);
      if (walked + length >= target) {
        return start
          .clone()
          .lerp(end, length === 0 ? 0 : (target - walked) / length);
      }
      walked += length;
    }
    return points.at(-1)?.clone() ?? new THREE.Vector3();
  }

  private updateCamera(): void {
    const planar = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      Math.sin(this.yaw) * planar,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * planar,
    );
    this.camera.lookAt(0, 0, 0);
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
