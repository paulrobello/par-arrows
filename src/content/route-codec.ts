import { stepSurface } from "../core/topology";
import type { Cell, FaceId, Heading } from "../core/types";

export interface FrozenRoute {
  readonly id: string;
  readonly start: readonly [FaceId, number, number];
  readonly steps: string;
}

const HEADING: Readonly<Record<string, Heading>> = {
  E: "east",
  W: "west",
  S: "south",
  N: "north",
};

export function decodeRoute(
  route: FrozenRoute,
  gridSize: number,
): readonly Cell[] {
  let current: Cell = {
    face: route.start[0],
    x: route.start[1],
    y: route.start[2],
  };
  const path: Cell[] = [current];
  for (const token of route.steps) {
    const heading = HEADING[token];
    if (!heading)
      throw new Error(
        `Frozen route ${route.id} has an invalid direction token.`,
      );
    current = stepSurface(current, heading, gridSize);
    path.push(current);
  }
  return path;
}
