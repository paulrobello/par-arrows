import type { Cell, FaceId, ForwardInfo, Heading } from "./types";

export type Vector3 = readonly [number, number, number];

interface FaceBasis {
  readonly normal: Vector3;
  readonly east: Vector3;
  readonly south: Vector3;
}

const BASES: Readonly<Record<FaceId, FaceBasis>> = {
  front: { normal: [0, 0, 1], east: [1, 0, 0], south: [0, -1, 0] },
  back: { normal: [0, 0, -1], east: [-1, 0, 0], south: [0, -1, 0] },
  right: { normal: [1, 0, 0], east: [0, 0, -1], south: [0, -1, 0] },
  left: { normal: [-1, 0, 0], east: [0, 0, 1], south: [0, -1, 0] },
  top: { normal: [0, 1, 0], east: [1, 0, 0], south: [0, 0, 1] },
  bottom: { normal: [0, -1, 0], east: [1, 0, 0], south: [0, 0, -1] },
};

const HEADINGS: readonly Heading[] = ["east", "west", "south", "north"];

function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vector3, value: number): Vector3 {
  const component = (index: 0 | 1 | 2): number => {
    const scaled = a[index] * value;
    return Object.is(scaled, -0) ? 0 : scaled;
  };
  return [component(0), component(1), component(2)];
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function equalVector(a: Vector3, b: Vector3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function basis(face: FaceId): FaceBasis {
  return BASES[face];
}

/** Unit local tangent for a heading, using the same basis as `cellToWorld`. */
export function faceHeadingVector(face: FaceId, heading: Heading): Vector3 {
  const current = basis(face);
  switch (heading) {
    case "east":
      return current.east;
    case "west":
      return scale(current.east, -1);
    case "south":
      return current.south;
    case "north":
      return scale(current.south, -1);
  }
}

export function oppositeHeading(heading: Heading): Heading {
  switch (heading) {
    case "east":
      return "west";
    case "west":
      return "east";
    case "south":
      return "north";
    case "north":
      return "south";
  }
}

function faceForNormal(normal: Vector3): FaceId {
  const match = (Object.keys(BASES) as FaceId[]).find((face) =>
    equalVector(BASES[face].normal, normal),
  );
  if (!match) {
    throw new Error("Cube topology received a non-cardinal normal.");
  }
  return match;
}

function coordinateToIndex(value: number, gridSize: number): number {
  return Math.max(
    0,
    Math.min(gridSize - 1, Math.round(((value + 1) * gridSize) / 2 - 0.5)),
  );
}

function cellCoordinate(index: number, gridSize: number): number {
  return -1 + (2 * (index + 0.5)) / gridSize;
}

function isInBounds(cell: Cell, gridSize: number): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < gridSize && cell.y < gridSize;
}

/** Unit normal, pointing out from the cube, for use by the renderer. */
export function faceNormal(face: FaceId): Vector3 {
  return basis(face).normal;
}

/**
 * World-space cube surface center.  The shared renderer convention is +Y up;
 * each face's local y grows down its visible surface.
 */
export function cellToWorld(cell: Cell, gridSize: number): Vector3 {
  const current = basis(cell.face);
  return add(
    current.normal,
    add(
      scale(current.east, cellCoordinate(cell.x, gridSize)),
      scale(current.south, cellCoordinate(cell.y, gridSize)),
    ),
  );
}

/** The next local cell if the head stays on its current face. */
export function forwardInfo(
  cell: Cell,
  heading: Heading,
  gridSize: number,
): ForwardInfo {
  const delta: Record<Heading, readonly [number, number]> = {
    east: [1, 0],
    west: [-1, 0],
    south: [0, 1],
    north: [0, -1],
  };
  const [dx, dy] = delta[heading];
  const next: Cell = { face: cell.face, x: cell.x + dx, y: cell.y + dy };
  return isInBounds(next, gridSize)
    ? { heading, next, exits: false }
    : { heading, exits: true };
}

/** Exact point on the current face edge where an ordinary head exit begins. */
export function edgePoint(
  cell: Cell,
  heading: Heading,
  gridSize: number,
): Vector3 {
  return add(
    cellToWorld(cell, gridSize),
    scale(faceHeadingVector(cell.face, heading), 1 / gridSize),
  );
}

/**
 * Cross an authored body seam. Heads do not call this during ordinary MVP
 * movement; it is for validating and rendering the stored wrapped route.
 */
export function stepAcrossSeam(
  cell: Cell,
  heading: Heading,
  gridSize: number,
): Cell {
  if (!forwardInfo(cell, heading, gridSize).exits) {
    throw new Error(
      "stepAcrossSeam requires a cell at the requested boundary.",
    );
  }
  const source = basis(cell.face);
  const targetFace = faceForNormal(faceHeadingVector(cell.face, heading));
  const target = basis(targetFace);
  const sourceLateral =
    heading === "east" || heading === "west"
      ? cellCoordinate(cell.y, gridSize)
      : cellCoordinate(cell.x, gridSize);
  const sourceLateralVector =
    heading === "east" || heading === "west" ? source.south : source.east;
  const sourceNormalComponent = source.normal;

  const coordinates = {
    east:
      dot(target.east, sourceNormalComponent) +
      dot(target.east, sourceLateralVector) * sourceLateral,
    south:
      dot(target.south, sourceNormalComponent) +
      dot(target.south, sourceLateralVector) * sourceLateral,
  };
  const crossed: Cell = {
    face: targetFace,
    x: coordinateToIndex(coordinates.east, gridSize),
    y: coordinateToIndex(coordinates.south, gridSize),
  };
  if (!isInBounds(crossed, gridSize)) {
    throw new Error("Cube seam mapping produced an out-of-bounds cell.");
  }
  return crossed;
}

/** Directional seam map: its returned heading continues inward on the target face. */
export function seamTransition(
  cell: Cell,
  heading: Heading,
  gridSize: number,
): { readonly cell: Cell; readonly heading: Heading } {
  const crossed = stepAcrossSeam(cell, heading, gridSize);
  if (crossed.x === 0) return { cell: crossed, heading: "east" };
  if (crossed.x === gridSize - 1) return { cell: crossed, heading: "west" };
  if (crossed.y === 0) return { cell: crossed, heading: "south" };
  return { cell: crossed, heading: "north" };
}

/** Advance an authored route through an on-face neighbor or a cube seam. */
export function stepSurface(
  cell: Cell,
  heading: Heading,
  gridSize: number,
): Cell {
  return (
    forwardInfo(cell, heading, gridSize).next ??
    stepAcrossSeam(cell, heading, gridSize)
  );
}

/** Find the directed cardinal step that connects adjacent authored path cells. */
export function headingBetween(
  from: Cell,
  to: Cell,
  gridSize: number,
): Heading | undefined {
  return HEADINGS.find((heading) => {
    const candidate = stepSurface(from, heading, gridSize);
    return (
      candidate.face === to.face && candidate.x === to.x && candidate.y === to.y
    );
  });
}

/** Derive the active head heading from the final link of a tail-to-head route. */
export function headingForPath(
  path: readonly Cell[],
  gridSize: number,
): Heading | undefined {
  if (path.length < 2) {
    return undefined;
  }
  const previous = path[path.length - 2];
  const head = path[path.length - 1];
  if (!previous || !head) {
    return undefined;
  }
  return headingBetween(previous, head, gridSize);
}

export function cellsEqual(first: Cell, second: Cell): boolean {
  return (
    first.face === second.face && first.x === second.x && first.y === second.y
  );
}

export function cellKey(cell: Cell): string {
  return `${cell.face}:${cell.x}:${cell.y}`;
}

/** Canonical undirected link identity, shared by either traversal direction. */
export function linkKey(first: Cell, second: Cell): string {
  return [cellKey(first), cellKey(second)].sort().join("|");
}
