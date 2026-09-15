import { simulateMove } from "../src/core/movement";
import { headingBetween, seamTransition } from "../src/core/topology";
import type { Cell, FaceId, Heading, LevelDefinition } from "../src/core/types";

export function bendCount(path: readonly Cell[]): number {
  let count = 0;
  for (let index = 2; index < path.length; index += 1) {
    const a = path[index - 2];
    const b = path[index - 1];
    const c = path[index];
    if (!a || !b || !c || a.face !== b.face || b.face !== c.face) continue;
    if ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) === 0) count += 1;
  }
  return count;
}

export function runLengths(path: readonly Cell[]): readonly number[] {
  const lengths: number[] = [];
  let direction = "";
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1];
    const b = path[index];
    if (!a || !b) continue;
    if (a.face !== b.face) {
      if (length > 0) lengths.push(length);
      direction = "";
      length = 0;
      continue;
    }
    const next = `${b.x - a.x},${b.y - a.y}`;
    if (next !== direction) {
      if (length > 0) lengths.push(length);
      direction = next;
      length = 0;
    }
    length += 1;
  }
  if (length > 0) lengths.push(length);
  return lengths;
}

/** Same footprint regardless of translation, rotation, reflection, or head end. */
export function canonicalFootprint(path: readonly Cell[]): string | undefined {
  if (path.length === 0 || new Set(path.map((cell) => cell.face)).size !== 1)
    return undefined;
  const variants: string[] = [];
  for (const swap of [false, true]) {
    for (const signX of [-1, 1]) {
      for (const signY of [-1, 1]) {
        const points = path.map((cell) =>
          swap
            ? ([cell.y * signX, cell.x * signY] as const)
            : ([cell.x * signX, cell.y * signY] as const),
        );
        const minX = Math.min(...points.map(([x]) => x));
        const minY = Math.min(...points.map(([, y]) => y));
        const normalized = points.map(([x, y]) => `${x - minX},${y - minY}`);
        variants.push(
          normalized.join(";"),
          [...normalized].reverse().join(";"),
        );
      }
    }
  }
  return variants.sort()[0];
}

/** Compare path geometry on an unfolded surface, so moving a stamp over a seam is not new geometry. */
export function unfoldedFootprint(
  path: readonly Cell[],
  gridSize: number,
): string | undefined {
  if (path.length === 0) return undefined;
  const headings: readonly Heading[] = ["east", "south", "west", "north"];
  const offsets = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const;
  const flat: Cell[] = [{ face: "front", x: 0, y: 0 }];
  let arrival: Heading | undefined;
  let direction = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const previous = flat.at(-1);
    if (!from || !to || !previous)
      throw new Error("Incomplete path for shape analysis.");
    const heading = headingBetween(from, to, gridSize);
    if (!heading) throw new Error("Non-adjacent path for shape analysis.");
    if (arrival)
      direction =
        (direction +
          headings.indexOf(heading) -
          headings.indexOf(arrival) +
          4) %
        4;
    const offset = offsets[direction];
    if (!offset) throw new Error("Invalid unfolded direction.");
    flat.push({
      face: "front",
      x: previous.x + offset[0],
      y: previous.y + offset[1],
    });
    arrival =
      from.face === to.face
        ? heading
        : seamTransition(from, heading, gridSize).heading;
  }
  return canonicalFootprint(flat);
}

export interface CampaignQuality {
  readonly level: number;
  readonly grid: number;
  readonly arrows: number;
  readonly cells: number;
  readonly multiBend: number;
  readonly maxBends: number;
  readonly singleFaceMultiBend: number;
  readonly uniqueBendFootprints: number;
  readonly maxBendCopies: number;
  readonly uniqueUnfoldedBends: number;
  readonly maxUnfoldedCopies: number;
  readonly irregularRuns: number;
  readonly narrowWinders: number;
  readonly wrapped: number;
  readonly interiorHeads: number;
  readonly initiallyBlocked: number;
  readonly faceCells: Readonly<Record<FaceId, number>>;
}

export function analyzeLevel(level: LevelDefinition): CampaignQuality {
  const footprints = new Map<string, number>();
  const unfolded = new Map<string, number>();
  const faceCells: Record<FaceId, number> = {
    front: 0,
    back: 0,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  };
  let cells = 0;
  let multiBend = 0;
  let maxBends = 0;
  let singleFaceMultiBend = 0;
  let irregularRuns = 0;
  let narrowWinders = 0;
  let wrapped = 0;
  let interiorHeads = 0;
  for (const arrow of level.arrows) {
    cells += arrow.path.length;
    for (const cell of arrow.path) faceCells[cell.face] += 1;
    const bends = bendCount(arrow.path);
    maxBends = Math.max(maxBends, bends);
    if (new Set(arrow.path.map((cell) => cell.face)).size > 1) wrapped += 1;
    const head = arrow.path.at(-1);
    if (
      head &&
      head.x > 0 &&
      head.y > 0 &&
      head.x < level.gridSize - 1 &&
      head.y < level.gridSize - 1
    )
      interiorHeads += 1;
    if (bends < 3) continue;
    multiBend += 1;
    const unfoldedKey = unfoldedFootprint(arrow.path, level.gridSize);
    if (unfoldedKey)
      unfolded.set(unfoldedKey, (unfolded.get(unfoldedKey) ?? 0) + 1);
    if (new Set(runLengths(arrow.path)).size >= 3) irregularRuns += 1;
    const footprint = canonicalFootprint(arrow.path);
    if (!footprint) continue;
    singleFaceMultiBend += 1;
    footprints.set(footprint, (footprints.get(footprint) ?? 0) + 1);
    const width =
      Math.max(...arrow.path.map((cell) => cell.x)) -
      Math.min(...arrow.path.map((cell) => cell.x)) +
      1;
    const height =
      Math.max(...arrow.path.map((cell) => cell.y)) -
      Math.min(...arrow.path.map((cell) => cell.y)) +
      1;
    if (bends >= 6 && Math.max(width, height) / Math.min(width, height) >= 4)
      narrowWinders += 1;
  }
  const ids = level.arrows.map((arrow) => arrow.id);
  return {
    level: level.id,
    grid: level.gridSize,
    arrows: level.arrows.length,
    cells,
    multiBend,
    maxBends,
    singleFaceMultiBend,
    uniqueBendFootprints: footprints.size,
    maxBendCopies: Math.max(0, ...footprints.values()),
    uniqueUnfoldedBends: unfolded.size,
    maxUnfoldedCopies: Math.max(0, ...unfolded.values()),
    irregularRuns,
    narrowWinders,
    wrapped,
    interiorHeads,
    initiallyBlocked: level.arrows.filter(
      (arrow) => simulateMove(level, ids, arrow.id).kind === "blocked",
    ).length,
    faceCells,
  };
}

if (import.meta.main) {
  const { LEVELS } = await import("../src/content/levels");
  console.log(JSON.stringify(LEVELS.map(analyzeLevel), null, 2));
}
