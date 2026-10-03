import type { Cell, FaceId, LevelDefinition } from "../core/types";

function cell(face: FaceId, x: number, y: number): Cell {
  return { face, x, y };
}

/** First two-headed-arrow lesson: the violet tail must leave before the blocker. */
export const DOUBLE_INTRO_LEVEL: LevelDefinition = {
  id: 25,
  title: "Cube 25",
  gridSize: 4,
  lives: 5,
  arrowScale: 1,
  directionals: [{ cell: cell("front", 1, 2), heading: "north" }],
  arrows: [
    {
      id: "double-intro-choice",
      kind: "double",
      path: [cell("front", 1, 1), cell("front", 2, 1)],
    },
    {
      id: "double-intro-blocker",
      path: [cell("front", 3, 1), cell("front", 3, 2), cell("front", 2, 2)],
    },
  ],
};
