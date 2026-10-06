import * as THREE from "three";
import type { Cell, MoveTarget } from "../core/types";

/** Per-instance pick identity for the instanced raycast targets. */
export interface PickerRecord {
  arrowId: string;
  endpoint: MoveTarget["endpoint"];
  face: Cell["face"];
}

const VERTEX_SHADER = `
attribute vec3 a0;
attribute vec3 a1;
attribute vec3 a2;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec3 world = a0 * position.x + a1 * position.y + a2 * position.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
}
`;

/**
 * One instanced draw for every ribbon quad and arrowhead triangle of one
 * exposure class (near the camera, or dimmed through the cube). Each instance
 * is a single triangle whose three world-space corners arrive as per-instance
 * attributes, so a ribbon quad is two instances and a head is one — no
 * per-instance matrix, no per-segment mesh, no per-segment material.
 */
export class TriangleBatch {
  readonly mesh: THREE.Mesh<
    THREE.InstancedBufferGeometry,
    THREE.ShaderMaterial
  >;

  private readonly a0: THREE.InstancedBufferAttribute;
  private readonly a1: THREE.InstancedBufferAttribute;
  private readonly a2: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aAlpha: THREE.InstancedBufferAttribute;
  private capacity: number;
  private count = 0;

  constructor(capacity: number, renderOrder: number) {
    this.capacity = capacity;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
        3,
      ),
    );
    geometry.setIndex([0, 1, 2]);
    this.a0 = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.a1 = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.a2 = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.aColor = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * 3),
      3,
    );
    this.aAlpha = new THREE.InstancedBufferAttribute(
      new Float32Array(capacity),
      1,
    );
    geometry.setAttribute("a0", this.a0);
    geometry.setAttribute("a1", this.a1);
    geometry.setAttribute("a2", this.a2);
    geometry.setAttribute("aColor", this.aColor);
    geometry.setAttribute("aAlpha", this.aAlpha);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    geometry.instanceCount = 0;
  }

  /** Append one triangle from three world-space corners. */
  push(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    color: THREE.Color,
    alpha: number,
  ): void {
    if (this.count >= this.capacity) return;
    const offset = this.count * 3;
    this.a0.array[offset] = a.x;
    this.a0.array[offset + 1] = a.y;
    this.a0.array[offset + 2] = a.z;
    this.a1.array[offset] = b.x;
    this.a1.array[offset + 1] = b.y;
    this.a1.array[offset + 2] = b.z;
    this.a2.array[offset] = c.x;
    this.a2.array[offset + 1] = c.y;
    this.a2.array[offset + 2] = c.z;
    this.aColor.array[offset] = color.r;
    this.aColor.array[offset + 1] = color.g;
    this.aColor.array[offset + 2] = color.b;
    this.aAlpha.array[this.count] = alpha;
    this.count += 1;
  }

  /** Publish the frame's instance range to the GPU, then start a fresh frame. */
  commit(): void {
    this.mesh.geometry.instanceCount = this.count;
    for (const attribute of [
      this.a0,
      this.a1,
      this.a2,
      this.aColor,
      this.aAlpha,
    ]) {
      attribute.needsUpdate = true;
    }
    this.count = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/**
 * Instanced raycast targets for the arrow field: one cylinder per ribbon
 * segment (the widened touch proxy) and one exact triangle per arrowhead.
 * Instances exist only for arrows that are visible and still on the board,
 * rebuilt by the renderer every pass; `records` arrays run parallel to the
 * committed instance order so a raycast's instanceId maps back to the arrow.
 */
export class PickerBatches {
  readonly cylinders: THREE.InstancedMesh<
    THREE.CylinderGeometry,
    THREE.MeshBasicMaterial
  >;
  readonly heads: THREE.InstancedMesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  cylinderRecords: PickerRecord[] = [];
  headRecords: PickerRecord[] = [];
  private capacity: number;
  private cylinderCount = 0;
  private headCount = 0;
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(capacity: number, pickRadius: number, pickLayer: number) {
    this.capacity = capacity;
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.cylinders = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(pickRadius, pickRadius, 1, 8),
      material,
      capacity,
    );
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([0, -1, 0, 0, 1, 0, 1, 0, 0]),
        3,
      ),
    );
    this.heads = new THREE.InstancedMesh(triangle, material.clone(), capacity);
    for (const mesh of [this.cylinders, this.heads]) {
      mesh.layers.set(pickLayer);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }

  /** Drop last frame's instances and records. */
  beginFrame(): void {
    this.cylinderRecords.length = 0;
    this.headRecords.length = 0;
    this.cylinderCount = 0;
    this.headCount = 0;
  }

  /** One widened cylinder from the segment's endpoints (the touch proxy). */
  pushCylinder(
    start: THREE.Vector3,
    end: THREE.Vector3,
    record: PickerRecord,
  ): void {
    if (this.cylinderCount >= this.capacity) return;
    const direction = end.clone().sub(start);
    const length = Math.max(direction.length(), 0.001);
    const matrix = new THREE.Matrix4();
    matrix.compose(
      start.clone().add(end).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(this.up, direction.normalize()),
      new THREE.Vector3(1, length, 1),
    );
    this.cylinders.setMatrixAt(this.cylinderCount, matrix);
    this.cylinderRecords.push(record);
    this.cylinderCount += 1;
  }

  /** One exact head triangle via an affine basis from the canonical triangle. */
  pushHeadTriangle(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    record: PickerRecord,
  ): void {
    if (this.headCount >= this.capacity) return;
    const base = a.clone().add(b).multiplyScalar(0.5);
    const xAxis = c.clone().sub(base);
    const yAxis = b.clone().sub(base);
    const zAxis = xAxis.clone().cross(yAxis);
    const matrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    matrix.setPosition(base);
    this.heads.setMatrixAt(this.headCount, matrix);
    this.headRecords.push(record);
    this.headCount += 1;
  }

  /** Publish both meshes' instance counts and matrices. */
  commit(): void {
    this.cylinders.count = this.cylinderCount;
    this.heads.count = this.headCount;
    this.cylinders.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.cylinders.dispose();
    this.heads.dispose();
  }
}
